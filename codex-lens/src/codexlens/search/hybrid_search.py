"""Hybrid search engine orchestrating parallel exact/fuzzy/vector searches with RRF fusion.

Coordinates multiple search backends in parallel using ThreadPoolExecutor and combines
results via Reciprocal Rank Fusion (RRF) algorithm.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional


@contextmanager
def timer(name: str, logger: logging.Logger, level: int = logging.DEBUG):
    """Context manager for timing code blocks.

    Args:
        name: Name of the operation being timed
        logger: Logger instance to use
        level: Logging level (default DEBUG)
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.log(level, "[TIMING] %s: %.2fms", name, elapsed_ms)

from codexlens.config import Config
from codexlens.config import VECTORS_HNSW_NAME
from codexlens.entities import SearchResult
from codexlens.search.ranking import (
    DEFAULT_WEIGHTS,
    FTS_FALLBACK_WEIGHTS,
    QueryIntent,
    apply_symbol_boost,
    cross_encoder_rerank,
    detect_query_intent,
    filter_results_by_category,
    get_rrf_weights,
    reciprocal_rank_fusion,
    rerank_results,
    simple_weighted_fusion,
    tag_search_source,
)
from codexlens.storage.dir_index import DirIndexStore


# Three-way fusion weights (FTS + Vector + SPLADE)
THREE_WAY_WEIGHTS = {
    "exact": 0.2,
    "splade": 0.3,
    "vector": 0.5,
}


class HybridSearchEngine:
    """Hybrid search engine with parallel execution and RRF fusion.

    Orchestrates searches across exact FTS, fuzzy FTS, and optional vector backends,
    executing them in parallel and fusing results via Reciprocal Rank Fusion.

    Attributes:
        logger: Python logger instance
        default_weights: Default RRF weights for each source
    """

    # NOTE: DEFAULT_WEIGHTS imported from ranking.py - single source of truth
    # Default RRF weights: SPLADE-based hybrid (splade: 0.4, vector: 0.6)
    # FTS fallback mode uses FTS_FALLBACK_WEIGHTS (exact: 0.3, fuzzy: 0.1, vector: 0.6)

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        config: Optional[Config] = None,
        embedder: Any = None,
    ):
        """Initialize hybrid search engine.

        Args:
            weights: Optional custom RRF weights (default: DEFAULT_WEIGHTS)
            config: Optional runtime config (enables optional reranking features)
            embedder: Optional embedder instance for embedding-based reranking

        Raises:
            TypeError: If weights is not a dict (e.g., if a Path is passed)
        """
        self.logger = logging.getLogger(__name__)

        # Validate weights type to catch common usage errors
        if weights is not None and not isinstance(weights, dict):
            raise TypeError(
                f"weights must be a dict, got {type(weights).__name__}. "
                f"Did you mean to pass index_path to search() instead of __init__()?"
            )

        self.weights = weights or DEFAULT_WEIGHTS.copy()
        self._config = config
        self.embedder = embedder
        self.reranker: Any = None
        self._use_gpu = config.embedding_use_gpu if config else True

    def search(
        self,
        index_path: Path,
        query: str,
        limit: int = 20,
        enable_fuzzy: bool = True,
        enable_vector: bool = False,
        pure_vector: bool = False,
        enable_splade: bool = False,
    ) -> List[SearchResult]:
        """Execute hybrid search with parallel retrieval and RRF fusion.

        Args:
            index_path: Path to _index.db file
            query: FTS5 query string (for FTS) or natural language query (for vector)
            limit: Maximum results to return after fusion
            enable_fuzzy: Enable fuzzy FTS search (default True)
            enable_vector: Enable vector search (default False)
            pure_vector: If True, only use vector search without FTS fallback (default False)
            enable_splade: If True, force SPLADE sparse neural search (default False)

        Returns:
            List of SearchResult objects sorted by fusion score

        Examples:
            >>> engine = HybridSearchEngine()
            >>> # Hybrid search (exact + fuzzy + vector)
            >>> results = engine.search(Path("project/_index.db"), "authentication",
            ...                         enable_vector=True)
            >>> # Pure vector search (semantic only)
            >>> results = engine.search(Path("project/_index.db"),
            ...                         "how to authenticate users",
            ...                         enable_vector=True, pure_vector=True)
            >>> # SPLADE sparse neural search
            >>> results = engine.search(Path("project/_index.db"), "auth flow",
            ...                         enable_splade=True, enable_vector=True)
            >>> for r in results[:5]:
            ...     print(f"{r.path}: {r.score:.3f}")
        """
        # Defensive: avoid creating/locking an index database when callers pass
        # an empty placeholder file (common in tests and misconfigured callers).
        try:
            if index_path.exists() and index_path.stat().st_size == 0:
                return []
        except OSError:
            return []

        # Detect query intent early for category filtering at index level
        query_intent = detect_query_intent(query)
        # Map intent to category for vector search:
        # - KEYWORD (code intent) -> filter to 'code' only
        # - SEMANTIC (doc intent) -> no filter (allow docs to surface)
        # - MIXED -> no filter (allow all)
        vector_category: Optional[str] = None
        if query_intent == QueryIntent.KEYWORD:
            vector_category = "code"

        # Determine which backends to use
        backends = {}

        # Check if SPLADE is available
        splade_available = False
        # Respect config.enable_splade flag and use_fts_fallback flag
        if self._config and getattr(self._config, 'use_fts_fallback', False):
            # Config explicitly requests FTS fallback - disable SPLADE
            splade_available = False
        elif self._config and not getattr(self._config, 'enable_splade', True):
            # Config explicitly disabled SPLADE
            splade_available = False
        else:
            # Check if SPLADE dependencies are available
            try:
                from codexlens.semantic.splade_encoder import check_splade_available
                ok, _ = check_splade_available()
                if ok:
                    # SPLADE tables are in main index database, will check table existence in _search_splade
                    splade_available = True
            except Exception:
                pass

        if pure_vector:
            # Pure vector mode: only use vector search, no FTS fallback
            if enable_vector:
                backends["vector"] = True
            else:
                # Invalid configuration: pure_vector=True but enable_vector=False
                self.logger.warning(
                    "pure_vector=True requires enable_vector=True. "
                    "Falling back to exact search. "
                    "To use pure vector search, enable vector search mode."
                )
                backends["exact"] = True
        elif enable_splade:
            # Explicit SPLADE mode requested via CLI --method splade
            if splade_available:
                backends["splade"] = True
                if enable_vector:
                    backends["vector"] = True
            else:
                # SPLADE requested but not available - warn and fallback
                self.logger.warning(
                    "SPLADE search requested but not available. "
                    "Falling back to FTS. Run 'codexlens index splade' to enable."
                )
                backends["exact"] = True
                if enable_fuzzy:
                    backends["fuzzy"] = True
                if enable_vector:
                    backends["vector"] = True
        else:
            # Hybrid mode: default to SPLADE if available, otherwise use FTS
            if splade_available:
                # Default: enable SPLADE, disable exact and fuzzy
                backends["splade"] = True
                if enable_vector:
                    backends["vector"] = True
            else:
                # Fallback mode: enable exact+fuzzy when SPLADE unavailable
                backends["exact"] = True
                if enable_fuzzy:
                    backends["fuzzy"] = True
                if enable_vector:
                    backends["vector"] = True

        # Execute parallel searches
        with timer("parallel_search_total", self.logger):
            results_map = self._search_parallel(index_path, query, backends, limit, vector_category)

        # Provide helpful message if pure-vector mode returns no results
        if pure_vector and enable_vector and len(results_map.get("vector", [])) == 0:
            self.logger.warning(
                "Pure vector search returned no results. "
                "This usually means embeddings haven't been generated. "
                "Run: codexlens embeddings-generate %s",
                index_path.parent if index_path.name == "_index.db" else index_path
            )

        # Apply RRF fusion
        # Filter weights to only active backends
        active_weights = {
            source: weight
            for source, weight in self.weights.items()
            if source in results_map
        }

        # Determine fusion method from config (default: rrf)
        fusion_method = "rrf"
        rrf_k = 60
        if self._config is not None:
            fusion_method = getattr(self._config, "fusion_method", "rrf") or "rrf"
            rrf_k = getattr(self._config, "rrf_k", 60) or 60

        with timer("fusion", self.logger):
            adaptive_weights = get_rrf_weights(query, active_weights)
            if fusion_method == "simple":
                fused_results = simple_weighted_fusion(results_map, adaptive_weights)
            else:
                # Default to RRF
                fused_results = reciprocal_rank_fusion(
                    results_map, adaptive_weights, k=rrf_k
                )

        # Optional: boost results that include explicit symbol matches
        boost_factor = (
            self._config.symbol_boost_factor
            if self._config is not None
            else 1.5
        )
        with timer("symbol_boost", self.logger):
            fused_results = apply_symbol_boost(
                fused_results, boost_factor=boost_factor
            )

        # Optional: embedding-based reranking on top results
        if self._config is not None and self._config.enable_reranking:
            with timer("reranking", self.logger):
                if self.embedder is None:
                    self.embedder = self._get_reranking_embedder()
                fused_results = rerank_results(
                    query,
                    fused_results[:100],
                    self.embedder,
                    top_k=(
                        100
                        if self._config.enable_cross_encoder_rerank
                        else self._config.reranking_top_k
                    ),
                )

        # Optional: cross-encoder reranking as a second stage
        if (
            self._config is not None
            and self._config.enable_reranking
            and self._config.enable_cross_encoder_rerank
        ):
            with timer("cross_encoder_rerank", self.logger):
                if self.reranker is None:
                    self.reranker = self._get_cross_encoder_reranker()
                if self.reranker is not None:
                    fused_results = cross_encoder_rerank(
                        query,
                        fused_results,
                        self.reranker,
                        top_k=self._config.reranker_top_k,
                    )

        # Apply category filtering to avoid code/doc pollution
        # This ensures KEYWORD queries return code files, SEMANTIC queries prefer docs
        enable_category_filter = (
            self._config is None
            or getattr(self._config, 'enable_category_filter', True)
        )
        if enable_category_filter and not pure_vector:
            with timer("category_filter", self.logger):
                query_intent = detect_query_intent(query)
                fused_results = filter_results_by_category(
                    fused_results, query_intent, allow_mixed=True
                )

        # Apply final limit
        return fused_results[:limit]

    def _get_reranking_embedder(self) -> Any:
        """Create an embedder for reranking based on Config embedding settings."""
        if self._config is None:
            return None

        try:
            from codexlens.semantic.factory import get_embedder
        except Exception as exc:
            self.logger.debug("Reranking embedder unavailable: %s", exc)
            return None

        try:
            if self._config.embedding_backend == "fastembed":
                return get_embedder(
                    backend="fastembed",
                    profile=self._config.embedding_model,
                    use_gpu=self._config.embedding_use_gpu,
                )
            if self._config.embedding_backend == "litellm":
                return get_embedder(
                    backend="litellm",
                    model=self._config.embedding_model,
                    endpoints=self._config.embedding_endpoints,
                    strategy=self._config.embedding_strategy,
                    cooldown=self._config.embedding_cooldown,
                )
        except Exception as exc:
            self.logger.debug("Failed to initialize reranking embedder: %s", exc)
            return None

        self.logger.debug(
            "Unknown embedding backend for reranking: %s",
            self._config.embedding_backend,
        )
        return None

    def _get_cross_encoder_reranker(self) -> Any:
        if self._config is None:
            return None

        try:
            from codexlens.semantic.reranker import (
                check_reranker_available,
                get_reranker,
            )
        except Exception as exc:
            self.logger.debug("Reranker factory unavailable: %s", exc)
            return None

        backend = (getattr(self._config, "reranker_backend", "") or "").strip().lower() or "onnx"

        ok, err = check_reranker_available(backend)
        if not ok:
            self.logger.debug(
                "Reranker backend unavailable (backend=%s): %s",
                backend,
                err,
            )
            return None

        try:
            model_name = (getattr(self._config, "reranker_model", "") or "").strip() or None

            if backend != "legacy" and model_name == "cross-encoder/ms-marco-MiniLM-L-6-v2":
                model_name = None

            device: str | None = None
            kwargs: dict[str, Any] = {}

            if backend == "onnx":
                kwargs["use_gpu"] = bool(getattr(self._config, "embedding_use_gpu", True))
            elif backend == "legacy":
                if not bool(getattr(self._config, "embedding_use_gpu", True)):
                    device = "cpu"
            elif backend == "api":
                # Pass max_input_tokens for adaptive batching
                max_tokens = getattr(self._config, "reranker_max_input_tokens", None)
                if max_tokens:
                    kwargs["max_input_tokens"] = max_tokens

            return get_reranker(
                backend=backend,
                model_name=model_name,
                device=device,
                **kwargs,
            )
        except Exception as exc:
            self.logger.debug(
                "Failed to initialize reranker (backend=%s): %s",
                backend,
                exc,
            )
            return None

    def _search_parallel(
        self,
        index_path: Path,
        query: str,
        backends: Dict[str, bool],
        limit: int,
        category: Optional[str] = None,
    ) -> Dict[str, List[SearchResult]]:
        """Execute parallel searches across enabled backends.

        Args:
            index_path: Path to _index.db file
            query: FTS5 query string
            backends: Dictionary of backend name to enabled flag
            limit: Results limit per backend
            category: Optional category filter for vector search ('code' or 'doc')

        Returns:
            Dictionary mapping source name to results list
        """
        results_map: Dict[str, List[SearchResult]] = {}
        timing_data: Dict[str, float] = {}

        # Use ThreadPoolExecutor for parallel I/O-bound searches
        with ThreadPoolExecutor(max_workers=len(backends)) as executor:
            # Submit search tasks with timing
            future_to_source = {}
            submit_times = {}

            if backends.get("exact"):
                submit_times["exact"] = time.perf_counter()
                future = executor.submit(
                    self._search_exact, index_path, query, limit
                )
                future_to_source[future] = "exact"

            if backends.get("fuzzy"):
                submit_times["fuzzy"] = time.perf_counter()
                future = executor.submit(
                    self._search_fuzzy, index_path, query, limit
                )
                future_to_source[future] = "fuzzy"

            if backends.get("vector"):
                submit_times["vector"] = time.perf_counter()
                future = executor.submit(
                    self._search_vector, index_path, query, limit, category
                )
                future_to_source[future] = "vector"

            if backends.get("splade"):
                submit_times["splade"] = time.perf_counter()
                future = executor.submit(
                    self._search_splade, index_path, query, limit
                )
                future_to_source[future] = "splade"

            # Collect results as they complete with timeout protection
            try:
                for future in as_completed(future_to_source, timeout=30.0):
                    source = future_to_source[future]
                    elapsed_ms = (time.perf_counter() - submit_times[source]) * 1000
                    timing_data[source] = elapsed_ms
                    try:
                        results = future.result(timeout=10.0)
                        # Tag results with source for debugging
                        tagged_results = tag_search_source(results, source)
                        results_map[source] = tagged_results
                        self.logger.debug(
                            "[TIMING] %s_search: %.2fms (%d results)",
                            source, elapsed_ms, len(results)
                        )
                    except (Exception, FuturesTimeoutError) as exc:
                        self.logger.error("Search failed for %s: %s", source, exc)
                        results_map[source] = []
            except FuturesTimeoutError:
                self.logger.warning("Search timeout: some backends did not respond in time")
                # Cancel remaining futures
                for future in future_to_source:
                    future.cancel()
                # Set empty results for sources that didn't complete
                for source in backends:
                    if source not in results_map:
                        results_map[source] = []

        # Log timing summary
        if timing_data:
            timing_str = ", ".join(f"{k}={v:.1f}ms" for k, v in timing_data.items())
            self.logger.debug("[TIMING] search_backends: {%s}", timing_str)

        return results_map

    def _search_exact(
        self, index_path: Path, query: str, limit: int
    ) -> List[SearchResult]:
        """Execute exact FTS search using unicode61 tokenizer.

        Args:
            index_path: Path to _index.db file
            query: FTS5 query string
            limit: Maximum results

        Returns:
            List of SearchResult objects
        """
        try:
            with DirIndexStore(index_path) as store:
                return store.search_fts_exact(
                    query, limit=limit, return_full_content=True
                )
        except Exception as exc:
            self.logger.debug("Exact search error: %s", exc)
            return []

    def _search_fuzzy(
        self, index_path: Path, query: str, limit: int
    ) -> List[SearchResult]:
        """Execute fuzzy FTS search using trigram/extended unicode61 tokenizer.

        Args:
            index_path: Path to _index.db file
            query: FTS5 query string
            limit: Maximum results

        Returns:
            List of SearchResult objects
        """
        try:
            with DirIndexStore(index_path) as store:
                return store.search_fts_fuzzy(
                    query, limit=limit, return_full_content=True
                )
        except Exception as exc:
            self.logger.debug("Fuzzy search error: %s", exc)
            return []

    def _find_vectors_hnsw(self, index_path: Path) -> Optional[Path]:
        """Find the centralized _vectors.hnsw file by traversing up from index_path.

        Similar to _search_splade's approach, this method searches for the
        centralized dense vector index file in parent directories.

        Args:
            index_path: Path to the current _index.db file

        Returns:
            Path to _vectors.hnsw if found, None otherwise
        """
        current_dir = index_path.parent
        for _ in range(10):  # Limit search depth
            candidate = current_dir / VECTORS_HNSW_NAME
            if candidate.exists():
                return candidate
            parent = current_dir.parent
            if parent == current_dir:  # Reached root
                break
            current_dir = parent
        return None

    def _search_vector_centralized(
        self,
        index_path: Path,
        hnsw_path: Path,
        query: str,
        limit: int,
        category: Optional[str] = None,
    ) -> List[SearchResult]:
        """Search using centralized vector index.

        Args:
            index_path: Path to _index.db file (for metadata lookup)
            hnsw_path: Path to centralized _vectors.hnsw file
            query: Natural language query string
            limit: Maximum results
            category: Optional category filter ('code' or 'doc')

        Returns:
            List of SearchResult objects ordered by semantic similarity
        """
        try:
            import sqlite3
            import json
            from codexlens.semantic.factory import get_embedder
            from codexlens.semantic.ann_index import ANNIndex

            # Get model config from the first index database we can find
            # (all indexes should use the same embedding model)
            index_root = hnsw_path.parent
            model_config = None

            # Try to get model config from the centralized index root first
            # (not the sub-directory index_path, which may have outdated config)
            try:
                from codexlens.semantic.vector_store import VectorStore
                central_index_path = index_root / "_index.db"
                if central_index_path.exists():
                    with VectorStore(central_index_path) as vs:
                        model_config = vs.get_model_config()
                    self.logger.debug(
                        "Loaded model config from centralized index: %s",
                        model_config
                    )
            except Exception as e:
                self.logger.debug("Failed to load model config from centralized index: %s", e)

            # Detect dimension from HNSW file if model config not found
            if model_config is None:
                self.logger.debug("Model config not found, will detect from HNSW index")
                # Create a temporary ANNIndex to load and detect dimension
                # We need to know the dimension to properly load the index

            # Get embedder based on model config or default
            if model_config:
                backend = model_config.get("backend", "fastembed")
                model_name = model_config["model_name"]
                model_profile = model_config["model_profile"]
                embedding_dim = model_config["embedding_dim"]

                if backend == "litellm":
                    embedder = get_embedder(backend="litellm", model=model_name)
                else:
                    embedder = get_embedder(backend="fastembed", profile=model_profile)
            else:
                # Default to code profile
                embedder = get_embedder(backend="fastembed", profile="code")
                embedding_dim = embedder.embedding_dim

            # Load centralized ANN index
            start_load = time.perf_counter()
            ann_index = ANNIndex.create_central(
                index_root=index_root,
                dim=embedding_dim,
            )
            if not ann_index.load():
                self.logger.warning("Failed to load centralized vector index from %s", hnsw_path)
                return []
            self.logger.debug(
                "[TIMING] central_ann_load: %.2fms (%d vectors)",
                (time.perf_counter() - start_load) * 1000,
                ann_index.count()
            )

            # Generate query embedding
            start_embed = time.perf_counter()
            query_embedding = embedder.embed_single(query)
            self.logger.debug(
                "[TIMING] query_embedding: %.2fms",
                (time.perf_counter() - start_embed) * 1000
            )

            # Search ANN index
            start_search = time.perf_counter()
            import numpy as np
            query_vec = np.array(query_embedding, dtype=np.float32)
            ids, distances = ann_index.search(query_vec, top_k=limit * 2)  # Fetch extra for filtering
            self.logger.debug(
                "[TIMING] central_ann_search: %.2fms (%d results)",
                (time.perf_counter() - start_search) * 1000,
                len(ids) if ids else 0
            )

            if not ids:
                return []

            # Convert distances to similarity scores (for cosine: score = 1 - distance)
            scores = [1.0 - d for d in distances]

            # Fetch chunk metadata from semantic_chunks tables
            # We need to search across all _index.db files in the project
            results = self._fetch_chunks_by_ids_centralized(
                index_root, ids, scores, category
            )

            return results[:limit]

        except ImportError as exc:
            self.logger.debug("Semantic dependencies not available: %s", exc)
            return []
        except Exception as exc:
            self.logger.error("Centralized vector search error: %s", exc)
            return []

    def _fetch_chunks_by_ids_centralized(
        self,
        index_root: Path,
        chunk_ids: List[int],
        scores: List[float],
        category: Optional[str] = None,
    ) -> List[SearchResult]:
        """Fetch chunk metadata from centralized _vectors_meta.db for fast lookup.

        This method uses the centralized VectorMetadataStore for O(1) lookup
        instead of traversing all _index.db files (O(n) where n = number of indexes).

        Falls back to the legacy per-index lookup if centralized metadata is unavailable.

        Args:
            index_root: Root directory containing _vectors_meta.db
            chunk_ids: List of chunk IDs from ANN search
            scores: Corresponding similarity scores
            category: Optional category filter

        Returns:
            List of SearchResult objects
        """
        from codexlens.config import VECTORS_META_DB_NAME

        # Build score map
        score_map = {cid: score for cid, score in zip(chunk_ids, scores)}

        # Try centralized metadata store first (fast path)
        vectors_meta_path = index_root / VECTORS_META_DB_NAME
        if vectors_meta_path.exists():
            try:
                return self._fetch_from_vector_meta_store(
                    vectors_meta_path, chunk_ids, score_map, category
                )
            except Exception as e:
                self.logger.warning(
                    "Centralized metadata lookup failed, falling back to legacy traversal: %s. "
                    "Consider regenerating embeddings with: codexlens embeddings-generate --centralized",
                    e
                )

        # Fallback: traverse _index.db files (legacy path)
        return self._fetch_chunks_by_ids_legacy(
            index_root, chunk_ids, score_map, category
        )

    def _fetch_from_vector_meta_store(
        self,
        meta_db_path: Path,
        chunk_ids: List[int],
        score_map: Dict[int, float],
        category: Optional[str] = None,
    ) -> List[SearchResult]:
        """Fetch chunks from centralized VectorMetadataStore.

        Args:
            meta_db_path: Path to _vectors_meta.db
            chunk_ids: List of chunk IDs to fetch
            score_map: Mapping of chunk_id to score
            category: Optional category filter

        Returns:
            List of SearchResult objects
        """
        from codexlens.storage.vector_meta_store import VectorMetadataStore

        results = []

        with VectorMetadataStore(meta_db_path) as meta_store:
            rows = meta_store.get_chunks_by_ids(chunk_ids, category=category)

            for row in rows:
                chunk_id = row["chunk_id"]
                file_path = row["file_path"]
                content = row["content"] or ""
                metadata = row.get("metadata") or {}
                start_line = row.get("start_line")
                end_line = row.get("end_line")

                score = score_map.get(chunk_id, 0.0)

                # Build excerpt
                excerpt = content[:200] + "..." if len(content) > 200 else content

                # Extract symbol information
                symbol_name = metadata.get("symbol_name")
                symbol_kind = metadata.get("symbol_kind")

                # Build Symbol object if available
                symbol = None
                if symbol_name and symbol_kind and start_line and end_line:
                    try:
                        from codexlens.entities import Symbol
                        symbol = Symbol(
                            name=symbol_name,
                            kind=symbol_kind,
                            range=(start_line, end_line)
                        )
                    except Exception:
                        pass

                results.append(SearchResult(
                    path=file_path,
                    score=score,
                    excerpt=excerpt,
                    content=content,
                    symbol=symbol,
                    metadata=metadata,
                    start_line=start_line,
                    end_line=end_line,
                    symbol_name=symbol_name,
                    symbol_kind=symbol_kind,
                ))

        # Sort by score descending
        results.sort(key=lambda r: r.score, reverse=True)
        return results

    def _fetch_chunks_by_ids_legacy(
        self,
        index_root: Path,
        chunk_ids: List[int],
        score_map: Dict[int, float],
        category: Optional[str] = None,
    ) -> List[SearchResult]:
        """Legacy fallback: fetch chunk metadata by traversing all _index.db files.

        This is the O(n) fallback path used when centralized metadata is unavailable.

        Args:
            index_root: Root directory containing _index.db files
            chunk_ids: List of chunk IDs from ANN search
            score_map: Mapping of chunk_id to score
            category: Optional category filter

        Returns:
            List of SearchResult objects
        """
        import sqlite3
        import json

        # Find all _index.db files
        index_files = list(index_root.rglob("_index.db"))

        results = []
        found_ids = set()

        for index_path in index_files:
            try:
                with sqlite3.connect(index_path) as conn:
                    conn.row_factory = sqlite3.Row

                    # Check if semantic_chunks table exists
                    cursor = conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_chunks'"
                    )
                    if cursor.fetchone() is None:
                        continue

                    # Build query for chunk IDs we haven't found yet
                    remaining_ids = [cid for cid in chunk_ids if cid not in found_ids]
                    if not remaining_ids:
                        break

                    placeholders = ",".join("?" * len(remaining_ids))

                    if category:
                        query = f"""
                            SELECT id, file_path, content, metadata
                            FROM semantic_chunks
                            WHERE id IN ({placeholders}) AND category = ?
                        """
                        params = remaining_ids + [category]
                    else:
                        query = f"""
                            SELECT id, file_path, content, metadata
                            FROM semantic_chunks
                            WHERE id IN ({placeholders})
                        """
                        params = remaining_ids

                    rows = conn.execute(query, params).fetchall()

                    for row in rows:
                        chunk_id = row["id"]
                        if chunk_id in found_ids:
                            continue
                        found_ids.add(chunk_id)

                        file_path = row["file_path"]
                        content = row["content"]
                        metadata_json = row["metadata"]
                        metadata = json.loads(metadata_json) if metadata_json else {}

                        score = score_map.get(chunk_id, 0.0)

                        # Build excerpt
                        excerpt = content[:200] + "..." if len(content) > 200 else content

                        # Extract symbol information
                        symbol_name = metadata.get("symbol_name")
                        symbol_kind = metadata.get("symbol_kind")
                        start_line = metadata.get("start_line")
                        end_line = metadata.get("end_line")

                        # Build Symbol object if available
                        symbol = None
                        if symbol_name and symbol_kind and start_line and end_line:
                            try:
                                from codexlens.entities import Symbol
                                symbol = Symbol(
                                    name=symbol_name,
                                    kind=symbol_kind,
                                    range=(start_line, end_line)
                                )
                            except Exception:
                                pass

                        results.append(SearchResult(
                            path=file_path,
                            score=score,
                            excerpt=excerpt,
                            content=content,
                            symbol=symbol,
                            metadata=metadata,
                            start_line=start_line,
                            end_line=end_line,
                            symbol_name=symbol_name,
                            symbol_kind=symbol_kind,
                        ))

            except Exception as e:
                self.logger.debug("Failed to fetch chunks from %s: %s", index_path, e)
                continue

        # Sort by score descending
        results.sort(key=lambda r: r.score, reverse=True)
        return results

    def _search_vector(
        self, index_path: Path, query: str, limit: int, category: Optional[str] = None
    ) -> List[SearchResult]:
        """Execute vector similarity search using semantic embeddings.

        Supports both centralized vector storage (single _vectors.hnsw at project root)
        and distributed storage (per-directory .hnsw files).

        Args:
            index_path: Path to _index.db file
            query: Natural language query string
            limit: Maximum results
            category: Optional category filter ('code' or 'doc')

        Returns:
            List of SearchResult objects ordered by semantic similarity
        """
        try:
            # First, check for centralized vector index
            central_hnsw_path = self._find_vectors_hnsw(index_path)
            if central_hnsw_path is not None:
                self.logger.debug("Found centralized vector index at %s", central_hnsw_path)
                return self._search_vector_centralized(
                    index_path, central_hnsw_path, query, limit, category
                )

            # Fallback to distributed (per-index) vector storage
            # Check if semantic chunks table exists
            import sqlite3

            start_check = time.perf_counter()
            try:
                with sqlite3.connect(index_path) as conn:
                    cursor = conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_chunks'"
                    )
                    has_semantic_table = cursor.fetchone() is not None
            except sqlite3.Error as e:
                self.logger.error("Database check failed in vector search: %s", e)
                return []
            self.logger.debug(
                "[TIMING] vector_table_check: %.2fms",
                (time.perf_counter() - start_check) * 1000
            )

            if not has_semantic_table:
                self.logger.info(
                    "No embeddings found in index. "
                    "Generate embeddings with: codexlens embeddings-generate %s",
                    index_path.parent if index_path.name == "_index.db" else index_path
                )
                return []

            # Initialize embedder and vector store
            from codexlens.semantic.factory import get_embedder
            from codexlens.semantic.vector_store import VectorStore

            start_init = time.perf_counter()
            vector_store = VectorStore(index_path)
            self.logger.debug(
                "[TIMING] vector_store_init: %.2fms",
                (time.perf_counter() - start_init) * 1000
            )

            # Check if vector store has data
            if vector_store.count_chunks() == 0:
                self.logger.info(
                    "Vector store is empty (0 chunks). "
                    "Generate embeddings with: codexlens embeddings-generate %s",
                    index_path.parent if index_path.name == "_index.db" else index_path
                )
                return []

            # Get stored model configuration (preferred) or auto-detect from dimension
            start_embedder = time.perf_counter()
            model_config = vector_store.get_model_config()
            if model_config:
                backend = model_config.get("backend", "fastembed")
                model_name = model_config["model_name"]
                model_profile = model_config["model_profile"]
                self.logger.debug(
                    "Using stored model config: %s backend, %s (%s, %dd)",
                    backend, model_profile, model_name, model_config["embedding_dim"]
                )

                # Get embedder based on backend
                if backend == "litellm":
                    embedder = get_embedder(backend="litellm", model=model_name)
                else:
                    embedder = get_embedder(backend="fastembed", profile=model_profile)
            else:
                # Fallback: auto-detect from embedding dimension
                detected_dim = vector_store.dimension
                if detected_dim is None:
                    self.logger.info("Vector store dimension unknown, using default profile")
                    embedder = get_embedder(backend="fastembed", profile="code")
                elif detected_dim == 384:
                    embedder = get_embedder(backend="fastembed", profile="fast")
                elif detected_dim == 768:
                    embedder = get_embedder(backend="fastembed", profile="code")
                elif detected_dim == 1024:
                    embedder = get_embedder(backend="fastembed", profile="multilingual")
                elif detected_dim == 1536:
                    # Likely OpenAI text-embedding-3-small or ada-002
                    self.logger.info(
                        "Detected 1536-dim embeddings (likely OpenAI), using litellm backend with text-embedding-3-small"
                    )
                    embedder = get_embedder(backend="litellm", model="text-embedding-3-small")
                elif detected_dim == 3072:
                    # Likely OpenAI text-embedding-3-large
                    self.logger.info(
                        "Detected 3072-dim embeddings (likely OpenAI), using litellm backend with text-embedding-3-large"
                    )
                    embedder = get_embedder(backend="litellm", model="text-embedding-3-large")
                else:
                    self.logger.debug(
                        "Unknown dimension %s, using default fastembed profile 'code'",
                        detected_dim
                    )
                    embedder = get_embedder(backend="fastembed", profile="code")
            self.logger.debug(
                "[TIMING] embedder_init: %.2fms",
                (time.perf_counter() - start_embedder) * 1000
            )

            # Generate query embedding
            start_embed = time.perf_counter()
            query_embedding = embedder.embed_single(query)
            self.logger.debug(
                "[TIMING] query_embedding: %.2fms",
                (time.perf_counter() - start_embed) * 1000
            )

            # Search for similar chunks
            start_search = time.perf_counter()
            results = vector_store.search_similar(
                query_embedding=query_embedding,
                top_k=limit,
                min_score=0.0,  # Return all results, let RRF handle filtering
                return_full_content=True,
                category=category,
            )
            self.logger.debug(
                "[TIMING] vector_similarity_search: %.2fms (%d results)",
                (time.perf_counter() - start_search) * 1000, len(results)
            )

            return results

        except ImportError as exc:
            self.logger.debug("Semantic dependencies not available: %s", exc)
            return []
        except Exception as exc:
            self.logger.error("Vector search error: %s", exc)
            return []

    def _search_splade(
        self, index_path: Path, query: str, limit: int
    ) -> List[SearchResult]:
        """SPLADE sparse retrieval via inverted index.
        
        Args:
            index_path: Path to _index.db file
            query: Natural language query string
            limit: Maximum results
        
        Returns:
            List of SearchResult ordered by SPLADE score
        """
        try:
            from codexlens.semantic.splade_encoder import get_splade_encoder, check_splade_available
            from codexlens.storage.splade_index import SpladeIndex
            from codexlens.config import SPLADE_DB_NAME
            import sqlite3
            import json

            # Check dependencies
            ok, err = check_splade_available()
            if not ok:
                self.logger.debug("SPLADE not available: %s", err)
                return []

            # SPLADE index is stored in _splade.db at the project index root
            # Traverse up from the current index to find the root _splade.db
            current_dir = index_path.parent
            splade_db_path = None
            for _ in range(10):  # Limit search depth
                candidate = current_dir / SPLADE_DB_NAME
                if candidate.exists():
                    splade_db_path = candidate
                    break
                parent = current_dir.parent
                if parent == current_dir:  # Reached root
                    break
                current_dir = parent

            if not splade_db_path:
                self.logger.debug("SPLADE index not found in ancestor directories of %s", index_path)
                return []

            splade_index = SpladeIndex(splade_db_path)
            if not splade_index.has_index():
                self.logger.debug("SPLADE index not initialized")
                return []
            
            # Encode query to sparse vector
            encoder = get_splade_encoder(use_gpu=self._use_gpu)
            query_sparse = encoder.encode_text(query)
            
            # Search inverted index for top matches
            raw_results = splade_index.search(query_sparse, limit=limit, min_score=0.0)
            
            if not raw_results:
                return []

            # Fetch chunk details from splade_chunks table (self-contained)
            chunk_ids = [chunk_id for chunk_id, _ in raw_results]
            score_map = {chunk_id: score for chunk_id, score in raw_results}

            # Get chunk metadata from SPLADE database
            rows = splade_index.get_chunks_by_ids(chunk_ids)

            # Build SearchResult objects
            results = []
            for row in rows:
                chunk_id = row["id"]
                file_path = row["file_path"]
                content = row["content"]
                metadata_json = row["metadata"]
                metadata = json.loads(metadata_json) if metadata_json else {}

                score = score_map.get(chunk_id, 0.0)
                
                # Build excerpt (short preview)
                excerpt = content[:200] + "..." if len(content) > 200 else content
                
                # Extract symbol information from metadata
                symbol_name = metadata.get("symbol_name")
                symbol_kind = metadata.get("symbol_kind")
                start_line = metadata.get("start_line")
                end_line = metadata.get("end_line")
                
                # Build Symbol object if we have symbol info
                symbol = None
                if symbol_name and symbol_kind and start_line and end_line:
                    try:
                        from codexlens.entities import Symbol
                        symbol = Symbol(
                            name=symbol_name,
                            kind=symbol_kind,
                            range=(start_line, end_line)
                        )
                    except Exception:
                        pass
                
                results.append(SearchResult(
                    path=file_path,
                    score=score,
                    excerpt=excerpt,
                    content=content,
                    symbol=symbol,
                    metadata=metadata,
                    start_line=start_line,
                    end_line=end_line,
                    symbol_name=symbol_name,
                    symbol_kind=symbol_kind,
                ))
            
            return results
            
        except Exception as exc:
            self.logger.debug("SPLADE search error: %s", exc)
            return []
