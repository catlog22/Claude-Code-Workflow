"""Chain search engine for recursive multi-directory searching.

Provides parallel search across directory hierarchies using indexed _index.db files.
Supports depth-limited traversal, result aggregation, and symbol search.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Any, Literal, Tuple, TYPE_CHECKING
import json
import logging
import os
import time

from codexlens.entities import SearchResult, Symbol

if TYPE_CHECKING:
    import numpy as np

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
from codexlens.config import Config
from codexlens.storage.registry import RegistryStore, DirMapping
from codexlens.storage.dir_index import DirIndexStore, SubdirLink
from codexlens.storage.global_index import GlobalSymbolIndex
from codexlens.storage.path_mapper import PathMapper
from codexlens.storage.sqlite_store import SQLiteStore
from codexlens.storage.vector_meta_store import VectorMetadataStore
from codexlens.config import VECTORS_META_DB_NAME
from codexlens.search.hybrid_search import HybridSearchEngine


@dataclass
class SearchOptions:
    """Configuration options for chain search.

    Attributes:
        depth: Maximum search depth (-1 = unlimited, 0 = current dir only)
        max_workers: Number of parallel worker threads
        limit_per_dir: Maximum results per directory
        total_limit: Total result limit across all directories
        offset: Pagination offset - skip first N results (default 0)
        include_symbols: Whether to include symbol search results
        files_only: Return only file paths without excerpts
        include_semantic: Whether to include semantic keyword search results
        code_only: Only return code files (excludes md, txt, json, yaml, xml, etc.)
        exclude_extensions: List of file extensions to exclude (e.g., ["md", "txt", "json"])
        hybrid_mode: Enable hybrid search with RRF fusion (default False)
        enable_fuzzy: Enable fuzzy FTS in hybrid mode (default True)
        enable_vector: Enable vector semantic search (default False)
        pure_vector: If True, only use vector search without FTS fallback (default False)
        enable_splade: Enable SPLADE sparse neural search (default False)
        enable_cascade: Enable cascade (binary+dense) two-stage retrieval (default False)
        hybrid_weights: Custom RRF weights for hybrid search (optional)
        group_results: Enable grouping of similar results (default False)
        grouping_threshold: Score threshold for grouping similar results (default 0.01)
    """
    depth: int = -1
    max_workers: int = 8
    limit_per_dir: int = 10
    total_limit: int = 100
    offset: int = 0
    include_symbols: bool = False
    files_only: bool = False
    include_semantic: bool = False
    code_only: bool = False
    exclude_extensions: Optional[List[str]] = None
    hybrid_mode: bool = False
    enable_fuzzy: bool = True
    enable_vector: bool = False
    pure_vector: bool = False
    enable_splade: bool = False
    enable_cascade: bool = False
    hybrid_weights: Optional[Dict[str, float]] = None
    group_results: bool = False
    grouping_threshold: float = 0.01


@dataclass
class SearchStats:
    """Statistics collected during search execution.

    Attributes:
        dirs_searched: Number of directories searched
        files_matched: Number of files with matches
        time_ms: Total search time in milliseconds
        errors: List of error messages encountered
    """
    dirs_searched: int = 0
    files_matched: int = 0
    time_ms: float = 0
    errors: List[str] = field(default_factory=list)


@dataclass
class ChainSearchResult:
    """Comprehensive search result with metadata.

    Attributes:
        query: Original search query
        results: List of SearchResult objects
        related_results: Expanded results from graph neighbors (optional)
        symbols: List of Symbol objects (if include_symbols=True)
        stats: SearchStats with execution metrics
    """
    query: str
    results: List[SearchResult]
    symbols: List[Symbol]
    stats: SearchStats
    related_results: List[SearchResult] = field(default_factory=list)


class ChainSearchEngine:
    """Parallel chain search engine for hierarchical directory indexes.

    Searches across multiple directory indexes in parallel, following subdirectory
    links to recursively traverse the file tree. Supports depth limits, result
    aggregation, and both content and symbol searches.

    Thread-safe with configurable parallelism.

    Attributes:
        registry: Global project registry
        mapper: Path mapping utility
        logger: Python logger instance
    """

    def __init__(self,
                 registry: RegistryStore,
                 mapper: PathMapper,
                 max_workers: int = 8,
                 config: Config | None = None):
        """Initialize chain search engine.

        Args:
            registry: Global project registry for path lookups
            mapper: Path mapper for source/index conversions
            max_workers: Maximum parallel workers (default 8)
        """
        self.registry = registry
        self.mapper = mapper
        self.logger = logging.getLogger(__name__)
        self._max_workers = max_workers
        self._executor: Optional[ThreadPoolExecutor] = None
        self._config = config

    def _get_executor(self, max_workers: Optional[int] = None) -> ThreadPoolExecutor:
        """Get or create the shared thread pool executor.

        Lazy initialization to avoid creating executor if never used.

        Args:
            max_workers: Override default max_workers if specified

        Returns:
            ThreadPoolExecutor instance
        """
        workers = max_workers or self._max_workers
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=workers)
        return self._executor

    def close(self) -> None:
        """Shutdown the thread pool executor."""
        if self._executor is not None:
            self._executor.shutdown(wait=True)
            self._executor = None

    def __enter__(self) -> "ChainSearchEngine":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        """Context manager exit."""
        self.close()

    def search(self, query: str,
               source_path: Path,
               options: Optional[SearchOptions] = None) -> ChainSearchResult:
        """Execute chain search from source_path with recursive traversal.

        Process:
        1. Locate starting index for source_path
        2. Collect all child indexes based on depth limit
        3. Search indexes in parallel using ThreadPoolExecutor
        4. Aggregate, deduplicate, and rank results

        Args:
            query: FTS5 search query string
            source_path: Starting directory path
            options: Search configuration (uses defaults if None)

        Returns:
            ChainSearchResult with results, symbols, and statistics

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper)
            >>> result = engine.search("authentication", Path("D:/project/src"))
            >>> for r in result.results[:5]:
            ...     print(f"{r.path}: {r.score:.2f}")
        """
        options = options or SearchOptions()
        start_time = time.time()
        stats = SearchStats()

        # Step 1: Find starting index
        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 2: Collect all index paths to search
        index_paths = self._collect_index_paths(start_index, options.depth)
        stats.dirs_searched = len(index_paths)

        if not index_paths:
            self.logger.warning(f"No indexes collected from {start_index}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 3: Parallel search
        results, search_stats = self._search_parallel(
            index_paths, query, options
        )
        stats.errors = search_stats.errors

        # Step 3.5: Filter by extension if requested
        if options.code_only or options.exclude_extensions:
            results = self._filter_by_extension(
                results, options.code_only, options.exclude_extensions
            )

        # Step 4: Merge and rank
        final_results = self._merge_and_rank(results, options.total_limit, options.offset)

        # Step 5: Optional grouping of similar results
        if options.group_results:
            from codexlens.search.ranking import group_similar_results
            final_results = group_similar_results(
                final_results, score_threshold_abs=options.grouping_threshold
            )

        stats.files_matched = len(final_results)

        # Optional: Symbol search
        symbols = []
        if options.include_symbols:
            symbols = self._search_symbols_parallel(
                index_paths, query, None, options.total_limit
            )

        # Optional: graph expansion using precomputed neighbors
        related_results: List[SearchResult] = []
        if self._config is not None and getattr(self._config, "enable_graph_expansion", False):
            try:
                from codexlens.search.enrichment import SearchEnrichmentPipeline

                pipeline = SearchEnrichmentPipeline(self.mapper, config=self._config)
                related_results = pipeline.expand_related_results(final_results)
            except Exception as exc:
                self.logger.debug("Graph expansion failed: %s", exc)
                related_results = []

        stats.time_ms = (time.time() - start_time) * 1000

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=symbols,
            stats=stats,
            related_results=related_results,
        )

    def hybrid_cascade_search(
        self,
        query: str,
        source_path: Path,
        k: int = 10,
        coarse_k: int = 100,
        options: Optional[SearchOptions] = None,
    ) -> ChainSearchResult:
        """Execute two-stage cascade search with hybrid coarse retrieval and cross-encoder reranking.

        Hybrid cascade search process:
        1. Stage 1 (Coarse): Fast retrieval using RRF fusion of FTS + SPLADE + Vector
           to get coarse_k candidates
        2. Stage 2 (Fine): CrossEncoder reranking of candidates to get final k results

        This approach balances recall (from broad coarse search) with precision
        (from expensive but accurate cross-encoder scoring).

        Note: This method is the original hybrid approach. For binary vector cascade,
        use binary_cascade_search() instead.

        Args:
            query: Natural language or keyword query string
            source_path: Starting directory path
            k: Number of final results to return (default 10)
            coarse_k: Number of coarse candidates from first stage (default 100)
            options: Search configuration (uses defaults if None)

        Returns:
            ChainSearchResult with reranked results and statistics

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper, config=config)
            >>> result = engine.hybrid_cascade_search(
            ...     "how to authenticate users",
            ...     Path("D:/project/src"),
            ...     k=10,
            ...     coarse_k=100
            ... )
            >>> for r in result.results:
            ...     print(f"{r.path}: {r.score:.3f}")
        """
        options = options or SearchOptions()
        start_time = time.time()
        stats = SearchStats()

        # Use config defaults if available
        if self._config is not None:
            if hasattr(self._config, "cascade_coarse_k"):
                coarse_k = coarse_k or self._config.cascade_coarse_k
            if hasattr(self._config, "cascade_fine_k"):
                k = k or self._config.cascade_fine_k

        # Step 1: Find starting index
        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 2: Collect all index paths
        index_paths = self._collect_index_paths(start_index, options.depth)
        stats.dirs_searched = len(index_paths)

        if not index_paths:
            self.logger.warning(f"No indexes collected from {start_index}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Stage 1: Coarse retrieval with hybrid search (FTS + SPLADE + Vector)
        # Use hybrid mode for multi-signal retrieval
        coarse_options = SearchOptions(
            depth=options.depth,
            max_workers=1,  # Single thread for GPU safety
            limit_per_dir=max(coarse_k // len(index_paths), 20),
            total_limit=coarse_k,
            hybrid_mode=True,
            enable_fuzzy=options.enable_fuzzy,
            enable_vector=True,  # Enable vector for semantic matching
            pure_vector=False,
            hybrid_weights=options.hybrid_weights,
        )

        self.logger.debug(
            "Cascade Stage 1: Coarse retrieval for %d candidates", coarse_k
        )
        coarse_results, search_stats = self._search_parallel(
            index_paths, query, coarse_options
        )
        stats.errors = search_stats.errors

        # Merge and deduplicate coarse results
        coarse_merged = self._merge_and_rank(coarse_results, coarse_k)
        self.logger.debug(
            "Cascade Stage 1 complete: %d candidates retrieved", len(coarse_merged)
        )

        if not coarse_merged:
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Stage 2: Cross-encoder reranking
        self.logger.debug(
            "Cascade Stage 2: Cross-encoder reranking %d candidates to top-%d",
            len(coarse_merged),
            k,
        )

        final_results = self._cross_encoder_rerank(query, coarse_merged, k)

        # Optional: grouping of similar results
        if options.group_results:
            from codexlens.search.ranking import group_similar_results
            final_results = group_similar_results(
                final_results, score_threshold_abs=options.grouping_threshold
            )

        stats.files_matched = len(final_results)
        stats.time_ms = (time.time() - start_time) * 1000

        self.logger.debug(
            "Cascade search complete: %d results in %.2fms",
            len(final_results),
            stats.time_ms,
        )

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=[],
            stats=stats,
        )

    def binary_cascade_search(
        self,
        query: str,
        source_path: Path,
        k: int = 10,
        coarse_k: int = 100,
        options: Optional[SearchOptions] = None,
    ) -> ChainSearchResult:
        """Execute binary cascade search with binary coarse ranking and dense fine ranking.

        Binary cascade search process:
        1. Stage 1 (Coarse): Fast binary vector search using Hamming distance
           to quickly filter to coarse_k candidates (256-dim binary, 32 bytes/vector)
        2. Stage 2 (Fine): Dense vector cosine similarity for precise reranking
           of candidates (2048-dim float32)

        This approach leverages the speed of binary search (~100x faster) while
        maintaining precision through dense vector reranking.

        Performance characteristics:
        - Binary search: O(N) with SIMD-accelerated XOR + popcount
        - Dense rerank: Only applied to top coarse_k candidates
        - Memory: 32 bytes (binary) + 8KB (dense) per chunk

        Args:
            query: Natural language or keyword query string
            source_path: Starting directory path
            k: Number of final results to return (default 10)
            coarse_k: Number of coarse candidates from first stage (default 100)
            options: Search configuration (uses defaults if None)

        Returns:
            ChainSearchResult with reranked results and statistics

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper, config=config)
            >>> result = engine.binary_cascade_search(
            ...     "how to authenticate users",
            ...     Path("D:/project/src"),
            ...     k=10,
            ...     coarse_k=100
            ... )
            >>> for r in result.results:
            ...     print(f"{r.path}: {r.score:.3f}")
        """
        if not NUMPY_AVAILABLE:
            self.logger.warning(
                "NumPy not available, falling back to hybrid cascade search"
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        options = options or SearchOptions()
        start_time = time.time()
        stats = SearchStats()

        # Use config defaults if available
        if self._config is not None:
            if hasattr(self._config, "cascade_coarse_k"):
                coarse_k = coarse_k or self._config.cascade_coarse_k
            if hasattr(self._config, "cascade_fine_k"):
                k = k or self._config.cascade_fine_k

        # Step 1: Find starting index
        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 2: Collect all index paths
        index_paths = self._collect_index_paths(start_index, options.depth)
        stats.dirs_searched = len(index_paths)

        if not index_paths:
            self.logger.warning(f"No indexes collected from {start_index}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Initialize embedding backends
        try:
            from codexlens.indexing.embedding import (
                BinaryEmbeddingBackend,
                DenseEmbeddingBackend,
            )
            from codexlens.semantic.ann_index import BinaryANNIndex
        except ImportError as exc:
            self.logger.warning(
                "Binary cascade dependencies not available: %s. "
                "Falling back to hybrid cascade search.",
                exc
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Stage 1: Binary vector coarse retrieval
        self.logger.debug(
            "Binary Cascade Stage 1: Binary coarse retrieval for %d candidates",
            coarse_k,
        )

        use_gpu = True
        if self._config is not None:
            use_gpu = getattr(self._config, "embedding_use_gpu", True)

        try:
            binary_backend = BinaryEmbeddingBackend(use_gpu=use_gpu)
            query_binary_packed = binary_backend.embed_packed([query])[0]
        except Exception as exc:
            self.logger.warning(
                "Failed to generate binary query embedding: %s. "
                "Falling back to hybrid cascade search.",
                exc
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Try centralized BinarySearcher first (preferred for mmap indexes)
        # The index root is the parent of the first index path
        index_root = index_paths[0].parent if index_paths else None
        all_candidates: List[Tuple[int, int, Path]] = []  # (chunk_id, distance, index_path)
        used_centralized = False

        if index_root:
            centralized_searcher = self._get_centralized_binary_searcher(index_root)
            if centralized_searcher is not None:
                try:
                    # BinarySearcher expects dense vector, not packed binary
                    from codexlens.semantic.embedder import Embedder
                    embedder = Embedder()
                    query_dense = embedder.embed_to_numpy([query])[0]

                    # Centralized search - returns (chunk_id, hamming_distance) tuples
                    results = centralized_searcher.search(query_dense, top_k=coarse_k)
                    for chunk_id, dist in results:
                        all_candidates.append((chunk_id, dist, index_root))
                    used_centralized = True
                    self.logger.debug(
                        "Centralized binary search found %d candidates", len(results)
                    )
                except Exception as exc:
                    self.logger.debug(
                        "Centralized binary search failed: %s, falling back to per-directory",
                        exc
                    )
                    centralized_searcher.clear()

        # Fallback: Search per-directory indexes with legacy BinaryANNIndex
        if not used_centralized:
            for index_path in index_paths:
                try:
                    # Get or create binary index for this path (uses deprecated BinaryANNIndex)
                    binary_index = self._get_or_create_binary_index(index_path)
                    if binary_index is None or binary_index.count() == 0:
                        continue

                    # Search binary index
                    ids, distances = binary_index.search(query_binary_packed, coarse_k)
                    for chunk_id, dist in zip(ids, distances):
                        all_candidates.append((chunk_id, dist, index_path))

                except Exception as exc:
                    self.logger.debug(
                        "Binary search failed for %s: %s", index_path, exc
                    )
                    stats.errors.append(f"Binary search failed for {index_path}: {exc}")

        if not all_candidates:
            self.logger.debug("No binary candidates found, falling back to hybrid")
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Sort by Hamming distance and take top coarse_k
        all_candidates.sort(key=lambda x: x[1])
        coarse_candidates = all_candidates[:coarse_k]

        self.logger.debug(
            "Binary Cascade Stage 1 complete: %d candidates retrieved",
            len(coarse_candidates),
        )

        # Stage 2: Dense vector fine ranking
        self.logger.debug(
            "Binary Cascade Stage 2: Dense reranking %d candidates to top-%d",
            len(coarse_candidates),
            k,
        )

        try:
            dense_backend = DenseEmbeddingBackend(use_gpu=use_gpu)
            query_dense = dense_backend.embed_to_numpy([query])[0]
        except Exception as exc:
            self.logger.warning(
                "Failed to generate dense query embedding: %s. "
                "Using Hamming distance scores only.",
                exc
            )
            # Fall back to using Hamming distance as score
            return self._build_results_from_candidates(
                coarse_candidates[:k], index_paths, stats, query, start_time,
                use_centralized=used_centralized
            )

        # Group candidates by index path for batch retrieval
        candidates_by_index: Dict[Path, List[int]] = {}
        for chunk_id, _, index_path in coarse_candidates:
            if index_path not in candidates_by_index:
                candidates_by_index[index_path] = []
            candidates_by_index[index_path].append(chunk_id)

        # Retrieve dense embeddings and compute cosine similarity
        scored_results: List[Tuple[float, SearchResult]] = []
        import sqlite3

        for index_path, chunk_ids in candidates_by_index.items():
            try:
                # Collect valid rows and dense vectors for batch processing
                valid_rows: List[Dict[str, Any]] = []
                dense_vectors: List["np.ndarray"] = []

                if used_centralized:
                    # Centralized mode: index_path is actually index_root directory
                    # Dense embeddings are in per-directory _index.db files
                    # referenced by source_index_db in chunk_metadata
                    meta_db_path = index_path / VECTORS_META_DB_NAME
                    if not meta_db_path.exists():
                        self.logger.debug(
                            "VectorMetadataStore not found at %s, skipping dense reranking", meta_db_path
                        )
                        continue

                    # Get chunk metadata with source_index_db references
                    meta_store = VectorMetadataStore(meta_db_path)
                    chunks_meta = meta_store.get_chunks_by_ids(chunk_ids)

                    # Group chunks by source_index_db
                    chunks_by_source: Dict[str, List[Dict[str, Any]]] = {}
                    for chunk in chunks_meta:
                        source_db = chunk.get("source_index_db")
                        if source_db:
                            if source_db not in chunks_by_source:
                                chunks_by_source[source_db] = []
                            chunks_by_source[source_db].append(chunk)

                    # Retrieve dense embeddings from each source_index_db
                    for source_db, source_chunks in chunks_by_source.items():
                        try:
                            source_chunk_ids = [c["chunk_id"] for c in source_chunks]
                            conn = sqlite3.connect(source_db)
                            conn.row_factory = sqlite3.Row

                            placeholders = ",".join("?" * len(source_chunk_ids))
                            # Try semantic_chunks first (newer schema), fall back to chunks
                            try:
                                rows = conn.execute(
                                    f"SELECT id, embedding_dense FROM semantic_chunks WHERE id IN ({placeholders})",
                                    source_chunk_ids
                                ).fetchall()
                            except sqlite3.OperationalError:
                                rows = conn.execute(
                                    f"SELECT id, embedding_dense FROM chunks WHERE id IN ({placeholders})",
                                    source_chunk_ids
                                ).fetchall()
                            conn.close()

                            # Build dense vector lookup
                            dense_lookup = {row["id"]: row["embedding_dense"] for row in rows}

                            # Process chunks with their embeddings
                            for chunk in source_chunks:
                                chunk_id = chunk["chunk_id"]
                                dense_bytes = dense_lookup.get(chunk_id)
                                if dense_bytes is not None:
                                    valid_rows.append({
                                        "id": chunk_id,
                                        "file_path": chunk["file_path"],
                                        "content": chunk["content"],
                                    })
                                    dense_vectors.append(np.frombuffer(dense_bytes, dtype=np.float32))
                        except Exception as exc:
                            self.logger.debug(
                                "Failed to get dense embeddings from %s: %s", source_db, exc
                            )
                else:
                    # Per-directory mode: index_path is the _index.db file
                    conn = sqlite3.connect(str(index_path))
                    conn.row_factory = sqlite3.Row

                    placeholders = ",".join("?" * len(chunk_ids))
                    rows = conn.execute(
                        f"SELECT id, file_path, content, embedding_dense FROM semantic_chunks WHERE id IN ({placeholders})",
                        chunk_ids
                    ).fetchall()
                    conn.close()

                    for row in rows:
                        dense_bytes = row["embedding_dense"]
                        if dense_bytes is not None:
                            valid_rows.append(dict(row))
                            dense_vectors.append(np.frombuffer(dense_bytes, dtype=np.float32))

                # Skip if no dense embeddings found
                if not dense_vectors:
                    continue

                # Stack into matrix for batch computation
                doc_matrix = np.vstack(dense_vectors)

                # Batch compute cosine similarities
                scores = self._compute_cosine_similarity_batch(query_dense, doc_matrix)

                # Create search results
                for i, row in enumerate(valid_rows):
                    score = float(scores[i])
                    excerpt = (row.get("content") or "")[:500]
                    result = SearchResult(
                        path=row.get("file_path") or "",
                        score=score,
                        excerpt=excerpt,
                    )
                    scored_results.append((score, result))

            except Exception as exc:
                self.logger.debug(
                    "Dense reranking failed for %s: %s", index_path, exc
                )
                stats.errors.append(f"Dense reranking failed for {index_path}: {exc}")

        # Sort by score descending and deduplicate by path
        scored_results.sort(key=lambda x: x[0], reverse=True)

        path_to_result: Dict[str, SearchResult] = {}
        for score, result in scored_results:
            if result.path not in path_to_result:
                path_to_result[result.path] = result

        final_results = list(path_to_result.values())[:k]

        # Optional: grouping of similar results
        if options.group_results:
            from codexlens.search.ranking import group_similar_results
            final_results = group_similar_results(
                final_results, score_threshold_abs=options.grouping_threshold
            )

        stats.files_matched = len(final_results)
        stats.time_ms = (time.time() - start_time) * 1000

        self.logger.debug(
            "Binary cascade search complete: %d results in %.2fms",
            len(final_results),
            stats.time_ms,
        )

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=[],
            stats=stats,
        )

    def cascade_search(
        self,
        query: str,
        source_path: Path,
        k: int = 10,
        coarse_k: int = 100,
        options: Optional[SearchOptions] = None,
        strategy: Optional[Literal["binary", "hybrid", "binary_rerank", "dense_rerank"]] = None,
    ) -> ChainSearchResult:
        """Unified cascade search entry point with strategy selection.

        Provides a single interface for cascade search with configurable strategy:
        - "binary": Uses binary vector coarse ranking + dense fine ranking (fastest)
        - "hybrid": Uses FTS+SPLADE+Vector coarse ranking + cross-encoder reranking (original)
        - "binary_rerank": Uses binary vector coarse ranking + cross-encoder reranking (best balance)
        - "dense_rerank": Uses dense vector coarse ranking + cross-encoder reranking

        The strategy is determined with the following priority:
        1. The `strategy` parameter (e.g., from CLI --cascade-strategy option)
        2. Config `cascade_strategy` setting from settings.json
        3. Default: "binary"

        Args:
            query: Natural language or keyword query string
            source_path: Starting directory path
            k: Number of final results to return (default 10)
            coarse_k: Number of coarse candidates from first stage (default 100)
            options: Search configuration (uses defaults if None)
            strategy: Cascade strategy - "binary", "hybrid", or "binary_rerank".

        Returns:
            ChainSearchResult with reranked results and statistics

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper, config=config)
            >>> # Use binary cascade (default, fastest)
            >>> result = engine.cascade_search("auth", Path("D:/project"))
            >>> # Use hybrid cascade (original behavior)
            >>> result = engine.cascade_search("auth", Path("D:/project"), strategy="hybrid")
            >>> # Use binary + cross-encoder (best balance of speed and quality)
            >>> result = engine.cascade_search("auth", Path("D:/project"), strategy="binary_rerank")
        """
        # Strategy priority: parameter > config > default
        effective_strategy = strategy
        valid_strategies = ("binary", "hybrid", "binary_rerank", "dense_rerank")
        if effective_strategy is None:
            # Not passed via parameter, check config
            if self._config is not None:
                config_strategy = getattr(self._config, "cascade_strategy", None)
                if config_strategy in valid_strategies:
                    effective_strategy = config_strategy

        # If still not set, apply default
        if effective_strategy not in valid_strategies:
            effective_strategy = "binary"

        if effective_strategy == "binary":
            return self.binary_cascade_search(query, source_path, k, coarse_k, options)
        elif effective_strategy == "binary_rerank":
            return self.binary_rerank_cascade_search(query, source_path, k, coarse_k, options)
        elif effective_strategy == "dense_rerank":
            return self.dense_rerank_cascade_search(query, source_path, k, coarse_k, options)
        else:
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

    def binary_rerank_cascade_search(
        self,
        query: str,
        source_path: Path,
        k: int = 10,
        coarse_k: int = 100,
        options: Optional[SearchOptions] = None,
    ) -> ChainSearchResult:
        """Execute binary cascade search with cross-encoder reranking.

        Combines the speed of binary vector coarse search with the quality of
        cross-encoder reranking for the best balance of speed and accuracy.

        Binary + Reranker cascade process:
        1. Stage 1 (Coarse): Fast binary vector search using Hamming distance
           to quickly filter to coarse_k candidates (256-dim binary, 32 bytes/vector)
        2. Stage 2 (Fine): Cross-encoder reranking for precise semantic ranking
           of candidates using query-document attention

        This approach is typically faster than hybrid_cascade_search while
        achieving similar or better quality through cross-encoder reranking.

        Performance characteristics:
        - Binary search: O(N) with SIMD-accelerated XOR + popcount (~8ms)
        - Cross-encoder: Applied to top coarse_k candidates (~15-20s for API)
        - Total: Faster coarse + high-quality fine = best balance

        Args:
            query: Natural language or keyword query string
            source_path: Starting directory path
            k: Number of final results to return (default 10)
            coarse_k: Number of coarse candidates from first stage (default 100)
            options: Search configuration (uses defaults if None)

        Returns:
            ChainSearchResult with cross-encoder reranked results and statistics

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper, config=config)
            >>> result = engine.binary_rerank_cascade_search(
            ...     "how to authenticate users",
            ...     Path("D:/project/src"),
            ...     k=10,
            ...     coarse_k=100
            ... )
            >>> for r in result.results:
            ...     print(f"{r.path}: {r.score:.3f}")
        """
        if not NUMPY_AVAILABLE:
            self.logger.warning(
                "NumPy not available, falling back to hybrid cascade search"
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        options = options or SearchOptions()
        start_time = time.time()
        stats = SearchStats()

        # Use config defaults if available
        if self._config is not None:
            if hasattr(self._config, "cascade_coarse_k"):
                coarse_k = coarse_k or self._config.cascade_coarse_k
            if hasattr(self._config, "cascade_fine_k"):
                k = k or self._config.cascade_fine_k

        # Step 1: Find starting index
        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 2: Collect all index paths
        index_paths = self._collect_index_paths(start_index, options.depth)
        stats.dirs_searched = len(index_paths)

        if not index_paths:
            self.logger.warning(f"No indexes collected from {start_index}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Initialize binary embedding backend
        try:
            from codexlens.indexing.embedding import BinaryEmbeddingBackend
        except ImportError as exc:
            self.logger.warning(
                "BinaryEmbeddingBackend not available: %s, falling back to hybrid cascade",
                exc
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Step 4: Binary coarse search (same as binary_cascade_search)
        binary_coarse_time = time.time()
        coarse_candidates: List[Tuple[int, int, Path]] = []

        # Try centralized BinarySearcher first (preferred for mmap indexes)
        # The index root is the parent of the first index path
        index_root = index_paths[0].parent if index_paths else None
        used_centralized = False

        if index_root:
            binary_searcher = self._get_centralized_binary_searcher(index_root)
            if binary_searcher is not None:
                try:
                    # BinarySearcher expects dense vector, not packed binary
                    from codexlens.semantic.embedder import Embedder
                    embedder = Embedder()
                    query_dense = embedder.embed_to_numpy([query])[0]

                    results = binary_searcher.search(query_dense, top_k=coarse_k)
                    for chunk_id, distance in results:
                        coarse_candidates.append((chunk_id, distance, index_root))
                    # Only mark as used if we got actual results
                    if coarse_candidates:
                        used_centralized = True
                        self.logger.debug(
                            "Binary coarse search (centralized): %d candidates in %.2fms",
                            len(results), (time.time() - binary_coarse_time) * 1000
                        )
                except Exception as exc:
                    self.logger.debug(f"Centralized binary search failed: {exc}")

        if not used_centralized:
            # Get GPU preference from config
            use_gpu = True
            if self._config is not None:
                use_gpu = getattr(self._config, "embedding_use_gpu", True)

            try:
                binary_backend = BinaryEmbeddingBackend(use_gpu=use_gpu)
                query_binary = binary_backend.embed_packed([query])[0]
            except Exception as exc:
                self.logger.warning(f"Failed to generate binary query embedding: {exc}")
                return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

            # Fallback to per-directory binary indexes
            for index_path in index_paths:
                try:
                    binary_index = self._get_or_create_binary_index(index_path)
                    if binary_index is None or binary_index.count() == 0:
                        continue
                    # BinaryANNIndex returns (ids, distances) arrays
                    ids, distances = binary_index.search(query_binary, coarse_k)
                    for chunk_id, dist in zip(ids, distances):
                        coarse_candidates.append((chunk_id, dist, index_path))
                except Exception as exc:
                    self.logger.debug(
                        "Binary search failed for %s: %s", index_path, exc
                    )

        if not coarse_candidates:
            self.logger.info("No binary candidates found, falling back to hybrid cascade for reranking")
            # Fall back to hybrid_cascade_search which uses FTS+Vector coarse + cross-encoder rerank
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Sort by Hamming distance and take top coarse_k
        coarse_candidates.sort(key=lambda x: x[1])
        coarse_candidates = coarse_candidates[:coarse_k]

        self.logger.debug(
            "Binary coarse search: %d candidates in %.2fms",
            len(coarse_candidates), (time.time() - binary_coarse_time) * 1000
        )

        # Step 5: Build SearchResult objects for cross-encoder reranking
        # Group candidates by index path for efficient retrieval
        candidates_by_index: Dict[Path, List[int]] = {}
        for chunk_id, distance, index_path in coarse_candidates:
            if index_path not in candidates_by_index:
                candidates_by_index[index_path] = []
            candidates_by_index[index_path].append(chunk_id)

        # Retrieve chunk content for reranking
        # Always use centralized VectorMetadataStore since chunks are stored there
        import sqlite3
        coarse_results: List[SearchResult] = []

        # Find the centralized metadata store path (project root)
        # index_root was computed earlier, use it for chunk retrieval
        central_meta_path = index_root / VECTORS_META_DB_NAME if index_root else None
        central_meta_store = None
        if central_meta_path and central_meta_path.exists():
            central_meta_store = VectorMetadataStore(central_meta_path)

        for index_path, chunk_ids in candidates_by_index.items():
            try:
                chunks_data = []
                if central_meta_store:
                    # Try centralized VectorMetadataStore first (preferred)
                    chunks_data = central_meta_store.get_chunks_by_ids(chunk_ids)

                if not chunks_data and used_centralized:
                    # Fallback to per-index-path meta store
                    meta_db_path = index_path / VECTORS_META_DB_NAME
                    if meta_db_path.exists():
                        meta_store = VectorMetadataStore(meta_db_path)
                        chunks_data = meta_store.get_chunks_by_ids(chunk_ids)

                if not chunks_data:
                    # Final fallback: query semantic_chunks table directly
                    # This handles per-directory indexes with semantic_chunks table
                    try:
                        conn = sqlite3.connect(str(index_path))
                        conn.row_factory = sqlite3.Row
                        placeholders = ",".join("?" * len(chunk_ids))
                        cursor = conn.execute(
                            f"""
                            SELECT id, file_path, content, metadata, category
                            FROM semantic_chunks
                            WHERE id IN ({placeholders})
                            """,
                            chunk_ids
                        )
                        chunks_data = [
                            {
                                "id": row["id"],
                                "file_path": row["file_path"],
                                "content": row["content"],
                                "metadata": row["metadata"],
                                "category": row["category"],
                            }
                            for row in cursor.fetchall()
                        ]
                        conn.close()
                    except Exception:
                        pass  # Skip if table doesn't exist

                for chunk in chunks_data:
                    # Find the Hamming distance for this chunk
                    chunk_id = chunk.get("id") or chunk.get("chunk_id")
                    distance = next(
                        (d for cid, d, _ in coarse_candidates if cid == chunk_id),
                        256
                    )
                    # Initial score from Hamming distance (will be replaced by reranker)
                    score = 1.0 - (distance / 256.0)

                    content = chunk.get("content", "")
                    result = SearchResult(
                        path=chunk.get("file_path", ""),
                        score=float(score),
                        excerpt=content[:500] if content else "",
                        content=content,
                    )
                    coarse_results.append(result)
            except Exception as exc:
                self.logger.debug(
                    "Failed to retrieve chunks from %s: %s", index_path, exc
                )

        if not coarse_results:
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query, results=[], symbols=[], stats=stats
            )

        self.logger.debug(
            "Retrieved %d chunks for cross-encoder reranking", len(coarse_results)
        )

        # Step 6: Cross-encoder reranking (same as hybrid_cascade_search)
        rerank_time = time.time()
        reranked_results = self._cross_encoder_rerank(query, coarse_results, top_k=k)

        self.logger.debug(
            "Cross-encoder reranking: %d results in %.2fms",
            len(reranked_results), (time.time() - rerank_time) * 1000
        )

        # Deduplicate by path (keep highest score)
        path_to_result: Dict[str, SearchResult] = {}
        for result in reranked_results:
            if result.path not in path_to_result or result.score > path_to_result[result.path].score:
                path_to_result[result.path] = result

        final_results = list(path_to_result.values())[:k]

        stats.files_matched = len(final_results)
        stats.time_ms = (time.time() - start_time) * 1000

        self.logger.debug(
            "Binary+Rerank cascade search complete: %d results in %.2fms",
            len(final_results),
            stats.time_ms,
        )

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=[],
            stats=stats,
        )

    def dense_rerank_cascade_search(
        self,
        query: str,
        source_path: Path,
        k: int = 10,
        coarse_k: int = 100,
        options: Optional[SearchOptions] = None,
    ) -> ChainSearchResult:
        """Execute dense cascade search with cross-encoder reranking.

        Combines dense vector coarse search (HNSW) with cross-encoder reranking
        for comparison with binary_rerank strategy.

        Dense + Reranker cascade process:
        1. Stage 1 (Coarse): Dense vector search using HNSW (cosine similarity)
           to get coarse_k candidates (2048-dim float32)
        2. Stage 2 (Fine): Cross-encoder reranking for precise semantic ranking

        Args:
            query: Natural language or keyword query string
            source_path: Starting directory path
            k: Number of final results to return (default 10)
            coarse_k: Number of coarse candidates from first stage (default 100)
            options: Search configuration (uses defaults if None)

        Returns:
            ChainSearchResult with cross-encoder reranked results and statistics
        """
        if not NUMPY_AVAILABLE:
            self.logger.warning(
                "NumPy not available, falling back to hybrid cascade search"
            )
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        options = options or SearchOptions()
        start_time = time.time()
        stats = SearchStats()

        # Use config defaults if available
        if self._config is not None:
            if hasattr(self._config, "cascade_coarse_k"):
                coarse_k = coarse_k or self._config.cascade_coarse_k
            if hasattr(self._config, "cascade_fine_k"):
                k = k or self._config.cascade_fine_k

        # Step 1: Find starting index
        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 2: Collect all index paths
        index_paths = self._collect_index_paths(start_index, options.depth)
        stats.dirs_searched = len(index_paths)

        if not index_paths:
            self.logger.warning(f"No indexes collected from {start_index}")
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query,
                results=[],
                symbols=[],
                stats=stats
            )

        # Step 3: Find centralized HNSW index and read model config
        from codexlens.config import VECTORS_HNSW_NAME
        central_hnsw_path = None
        index_root = start_index.parent
        current_dir = index_root
        for _ in range(10):  # Limit search depth
            candidate = current_dir / VECTORS_HNSW_NAME
            if candidate.exists():
                central_hnsw_path = candidate
                index_root = current_dir  # Update to where HNSW was found
                break
            parent = current_dir.parent
            if parent == current_dir:  # Reached root
                break
            current_dir = parent

        # Step 4: Generate query dense embedding using same model as centralized index
        # Read embedding config to match the model used during indexing
        dense_coarse_time = time.time()
        try:
            from codexlens.semantic.factory import get_embedder

            # Get embedding settings from centralized index config (preferred) or fallback to self._config
            embedding_backend = "litellm"  # Default to API for dense
            embedding_model = "qwen3-embedding-sf"  # Default model
            use_gpu = True

            # Try to read model config from centralized index's embeddings_config table
            central_index_db = index_root / "_index.db"
            if central_index_db.exists():
                try:
                    from codexlens.semantic.vector_store import VectorStore
                    with VectorStore(central_index_db) as vs:
                        model_config = vs.get_model_config()
                        if model_config:
                            embedding_backend = model_config.get("backend", embedding_backend)
                            embedding_model = model_config.get("model_name", embedding_model)
                            self.logger.debug(
                                "Read model config from centralized index: %s/%s",
                                embedding_backend, embedding_model
                            )
                except Exception as e:
                    self.logger.debug("Failed to read centralized model config: %s", e)

            # Fallback to self._config if not read from index
            if self._config is not None:
                if embedding_backend == "litellm" and embedding_model == "qwen3-embedding-sf":
                    # Only use config values if we didn't read from centralized index
                    config_backend = getattr(self._config, "embedding_backend", None)
                    config_model = getattr(self._config, "embedding_model", None)
                    if config_backend:
                        embedding_backend = config_backend
                    if config_model:
                        embedding_model = config_model
                use_gpu = getattr(self._config, "embedding_use_gpu", True)

            # Create embedder matching index configuration
            if embedding_backend == "litellm":
                embedder = get_embedder(backend="litellm", model=embedding_model)
            else:
                embedder = get_embedder(backend="fastembed", profile=embedding_model, use_gpu=use_gpu)

            query_dense = embedder.embed_to_numpy([query])[0]
            self.logger.debug(f"Dense query embedding: {query_dense.shape[0]}-dim via {embedding_backend}/{embedding_model}")
        except Exception as exc:
            self.logger.warning(f"Failed to generate dense query embedding: {exc}")
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Step 5: Dense coarse search using centralized HNSW index
        coarse_candidates: List[Tuple[int, float, Path]] = []  # (chunk_id, distance, index_path)

        if central_hnsw_path is not None:
            # Use centralized index
            try:
                from codexlens.semantic.ann_index import ANNIndex
                ann_index = ANNIndex.create_central(
                    index_root=index_root,
                    dim=query_dense.shape[0],
                )
                if ann_index.load() and ann_index.count() > 0:
                    # Search centralized HNSW index
                    ids, distances = ann_index.search(query_dense, top_k=coarse_k)
                    for chunk_id, dist in zip(ids, distances):
                        coarse_candidates.append((chunk_id, dist, index_root / "_index.db"))
                    self.logger.debug(
                        "Centralized dense search: %d candidates from %s",
                        len(ids), central_hnsw_path
                    )
            except Exception as exc:
                self.logger.debug(
                    "Centralized dense search failed for %s: %s", central_hnsw_path, exc
                )

        # Fallback: try per-directory HNSW indexes if centralized not found
        if not coarse_candidates:
            for index_path in index_paths:
                try:
                    # Load HNSW index
                    from codexlens.semantic.ann_index import ANNIndex
                    ann_index = ANNIndex(index_path, dim=query_dense.shape[0])
                    if not ann_index.load():
                        continue

                    if ann_index.count() == 0:
                        continue

                    # Search HNSW index
                    ids, distances = ann_index.search(query_dense, top_k=coarse_k)
                    for chunk_id, dist in zip(ids, distances):
                        coarse_candidates.append((chunk_id, dist, index_path))

                except Exception as exc:
                    self.logger.debug(
                        "Dense search failed for %s: %s", index_path, exc
                    )

        if not coarse_candidates:
            self.logger.info("No dense candidates found, falling back to hybrid cascade")
            return self.hybrid_cascade_search(query, source_path, k, coarse_k, options)

        # Sort by distance (ascending for cosine distance) and take top coarse_k
        coarse_candidates.sort(key=lambda x: x[1])
        coarse_candidates = coarse_candidates[:coarse_k]

        self.logger.debug(
            "Dense coarse search: %d candidates in %.2fms",
            len(coarse_candidates), (time.time() - dense_coarse_time) * 1000
        )

        # Step 6: Build SearchResult objects for cross-encoder reranking
        candidates_by_index: Dict[Path, List[int]] = {}
        for chunk_id, distance, index_path in coarse_candidates:
            if index_path not in candidates_by_index:
                candidates_by_index[index_path] = []
            candidates_by_index[index_path].append(chunk_id)

        # Retrieve chunk content for reranking
        import sqlite3
        coarse_results: List[SearchResult] = []

        for index_path, chunk_ids in candidates_by_index.items():
            try:
                # For centralized index, use _vectors_meta.db for chunk metadata
                # which contains file_path, content, start_line, end_line
                if central_hnsw_path is not None and index_path == index_root / "_index.db":
                    # Use centralized metadata from _vectors_meta.db
                    meta_db_path = index_root / "_vectors_meta.db"
                    if meta_db_path.exists():
                        conn = sqlite3.connect(str(meta_db_path))
                        conn.row_factory = sqlite3.Row
                        placeholders = ",".join("?" * len(chunk_ids))
                        cursor = conn.execute(
                            f"""
                            SELECT chunk_id, file_path, content, start_line, end_line
                            FROM chunk_metadata
                            WHERE chunk_id IN ({placeholders})
                            """,
                            chunk_ids
                        )
                        chunks_data = [
                            {
                                "id": row["chunk_id"],
                                "file_path": row["file_path"],
                                "content": row["content"],
                                "metadata": json.dumps({
                                    "start_line": row["start_line"],
                                    "end_line": row["end_line"]
                                }),
                                "category": "code" if row["file_path"].endswith(('.py', '.ts', '.js', '.java', '.go', '.rs', '.cpp', '.c')) else "doc",
                            }
                            for row in cursor.fetchall()
                        ]
                        conn.close()
                    else:
                        chunks_data = []
                else:
                    # Fall back to per-directory semantic_chunks table
                    conn = sqlite3.connect(str(index_path))
                    conn.row_factory = sqlite3.Row
                    placeholders = ",".join("?" * len(chunk_ids))
                    cursor = conn.execute(
                        f"""
                        SELECT id, file_path, content, metadata, category
                        FROM semantic_chunks
                        WHERE id IN ({placeholders})
                        """,
                        chunk_ids
                    )
                    chunks_data = [
                        {
                            "id": row["id"],
                            "file_path": row["file_path"],
                            "content": row["content"],
                            "metadata": row["metadata"],
                            "category": row["category"],
                        }
                        for row in cursor.fetchall()
                    ]
                    conn.close()

                for chunk in chunks_data:
                    chunk_id = chunk.get("id")
                    distance = next(
                        (d for cid, d, _ in coarse_candidates if cid == chunk_id),
                        1.0
                    )
                    # Convert cosine distance to score (clamp to [0, 1] for Pydantic validation)
                    # Cosine distance can be > 1 for anti-correlated vectors, causing negative scores
                    score = max(0.0, 1.0 - distance)

                    content = chunk.get("content", "")
                    result = SearchResult(
                        path=chunk.get("file_path", ""),
                        score=float(score),
                        excerpt=content[:500] if content else "",
                        content=content,
                    )
                    coarse_results.append(result)
            except Exception as exc:
                self.logger.debug(
                    "Failed to retrieve chunks from %s: %s", index_path, exc
                )

        if not coarse_results:
            stats.time_ms = (time.time() - start_time) * 1000
            return ChainSearchResult(
                query=query, results=[], symbols=[], stats=stats
            )

        self.logger.debug(
            "Retrieved %d chunks for cross-encoder reranking", len(coarse_results)
        )

        # Step 6: Cross-encoder reranking
        rerank_time = time.time()
        reranked_results = self._cross_encoder_rerank(query, coarse_results, top_k=k)

        self.logger.debug(
            "Cross-encoder reranking: %d results in %.2fms",
            len(reranked_results), (time.time() - rerank_time) * 1000
        )

        # Deduplicate by path (keep highest score)
        path_to_result: Dict[str, SearchResult] = {}
        for result in reranked_results:
            if result.path not in path_to_result or result.score > path_to_result[result.path].score:
                path_to_result[result.path] = result

        final_results = list(path_to_result.values())[:k]

        stats.files_matched = len(final_results)
        stats.time_ms = (time.time() - start_time) * 1000

        self.logger.debug(
            "Dense+Rerank cascade search complete: %d results in %.2fms",
            len(final_results),
            stats.time_ms,
        )

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=[],
            stats=stats,
        )

    def _get_or_create_binary_index(self, index_path: Path) -> Optional[Any]:
        """Get or create a BinaryANNIndex for the given index path.

        .. deprecated::
            This method uses the deprecated BinaryANNIndex. For centralized indexes,
            use _get_centralized_binary_searcher() instead.

        Attempts to load an existing binary index from disk. If not found,
        returns None (binary index should be built during indexing).

        Args:
            index_path: Path to the _index.db file

        Returns:
            BinaryANNIndex instance or None if not available
        """
        try:
            import warnings
            # Suppress deprecation warning since we're using it intentionally for legacy support
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=DeprecationWarning)
                from codexlens.semantic.ann_index import BinaryANNIndex

                binary_index = BinaryANNIndex(index_path, dim=256)
                if binary_index.load():
                    return binary_index
            return None
        except Exception as exc:
            self.logger.debug("Failed to load binary index for %s: %s", index_path, exc)
            return None

    def _get_centralized_binary_searcher(self, index_root: Path) -> Optional[Any]:
        """Get centralized BinarySearcher for memory-mapped binary vectors.

        This is the preferred method for centralized indexes, providing faster
        search via memory-mapped files.

        Args:
            index_root: Root directory containing centralized index files

        Returns:
            BinarySearcher instance or None if not available
        """
        try:
            from codexlens.search.binary_searcher import BinarySearcher

            binary_searcher = BinarySearcher(index_root)
            if binary_searcher.load():
                self.logger.debug(
                    "Using centralized BinarySearcher with %d vectors (mmap=%s)",
                    binary_searcher.vector_count,
                    binary_searcher.is_memmap
                )
                return binary_searcher
            return None
        except Exception as exc:
            self.logger.debug("Failed to load centralized binary searcher: %s", exc)
            return None

    def _compute_cosine_similarity(
        self,
        query_vec: "np.ndarray",
        doc_vec: "np.ndarray",
    ) -> float:
        """Compute cosine similarity between query and document vectors.

        Args:
            query_vec: Query embedding vector
            doc_vec: Document embedding vector

        Returns:
            Cosine similarity score in range [-1, 1]
        """
        if not NUMPY_AVAILABLE:
            return 0.0

        # Ensure same shape
        min_len = min(len(query_vec), len(doc_vec))
        q = query_vec[:min_len]
        d = doc_vec[:min_len]

        # Compute cosine similarity
        dot_product = np.dot(q, d)
        norm_q = np.linalg.norm(q)
        norm_d = np.linalg.norm(d)

        if norm_q == 0 or norm_d == 0:
            return 0.0

        return float(dot_product / (norm_q * norm_d))

    def _compute_cosine_similarity_batch(
        self,
        query_vec: "np.ndarray",
        doc_matrix: "np.ndarray",
    ) -> "np.ndarray":
        """Compute cosine similarity between query and multiple document vectors.

        Uses vectorized matrix operations for efficient batch computation.

        Args:
            query_vec: Query embedding vector of shape (dim,)
            doc_matrix: Document embeddings matrix of shape (n_docs, dim)

        Returns:
            Array of cosine similarity scores of shape (n_docs,)
        """
        if not NUMPY_AVAILABLE:
            return np.zeros(doc_matrix.shape[0])

        # Ensure query is 1D
        if query_vec.ndim > 1:
            query_vec = query_vec.flatten()

        # Handle dimension mismatch by truncating to smaller dimension
        min_dim = min(len(query_vec), doc_matrix.shape[1])
        q = query_vec[:min_dim]
        docs = doc_matrix[:, :min_dim]

        # Compute query norm once
        norm_q = np.linalg.norm(q)
        if norm_q == 0:
            return np.zeros(docs.shape[0])

        # Normalize query
        q_normalized = q / norm_q

        # Compute document norms (vectorized)
        doc_norms = np.linalg.norm(docs, axis=1)

        # Avoid division by zero
        nonzero_mask = doc_norms > 0
        scores = np.zeros(docs.shape[0], dtype=np.float32)

        if np.any(nonzero_mask):
            # Normalize documents with non-zero norms
            docs_normalized = docs[nonzero_mask] / doc_norms[nonzero_mask, np.newaxis]

            # Batch dot product: (n_docs, dim) @ (dim,) = (n_docs,)
            scores[nonzero_mask] = docs_normalized @ q_normalized

        return scores

    def _build_results_from_candidates(
        self,
        candidates: List[Tuple[int, int, Path]],
        index_paths: List[Path],
        stats: SearchStats,
        query: str,
        start_time: float,
        use_centralized: bool = False,
    ) -> ChainSearchResult:
        """Build ChainSearchResult from binary candidates using Hamming distance scores.

        Used as fallback when dense embeddings are not available.

        Args:
            candidates: List of (chunk_id, hamming_distance, index_path) tuples
            index_paths: List of all searched index paths
            stats: SearchStats to update
            query: Original query string
            start_time: Search start time for timing
            use_centralized: If True, index_path is the index_root directory
                and VectorMetadataStore should be used instead of SQLiteStore

        Returns:
            ChainSearchResult with results scored by Hamming distance
        """
        results: List[SearchResult] = []

        # Group by index path
        candidates_by_index: Dict[Path, List[Tuple[int, int]]] = {}
        for chunk_id, distance, index_path in candidates:
            if index_path not in candidates_by_index:
                candidates_by_index[index_path] = []
            candidates_by_index[index_path].append((chunk_id, distance))

        for index_path, chunk_tuples in candidates_by_index.items():
            try:
                chunk_ids = [c[0] for c in chunk_tuples]

                # Use VectorMetadataStore for centralized search, SQLiteStore for per-directory
                if use_centralized:
                    # index_path is actually index_root directory for centralized search
                    meta_db_path = index_path / VECTORS_META_DB_NAME
                    if not meta_db_path.exists():
                        self.logger.debug(
                            "VectorMetadataStore not found at %s, skipping", meta_db_path
                        )
                        continue
                    meta_store = VectorMetadataStore(meta_db_path)
                    chunks_data = meta_store.get_chunks_by_ids(chunk_ids)
                else:
                    store = SQLiteStore(index_path)
                    chunks_data = store.get_chunks_by_ids(chunk_ids)

                chunk_content: Dict[int, Dict[str, Any]] = {
                    c["id"]: c for c in chunks_data
                }

                for chunk_id, distance in chunk_tuples:
                    chunk_info = chunk_content.get(chunk_id)
                    if chunk_info is None:
                        continue

                    # Convert Hamming distance to score (lower distance = higher score)
                    # Max Hamming distance for 256-bit is 256
                    score = 1.0 - (distance / 256.0)

                    excerpt = chunk_info.get("content", "")[:500]
                    result = SearchResult(
                        path=chunk_info.get("file_path", ""),
                        score=float(score),
                        excerpt=excerpt,
                    )
                    results.append(result)

            except Exception as exc:
                self.logger.debug(
                    "Failed to build results from %s: %s", index_path, exc
                )

        # Deduplicate by path
        path_to_result: Dict[str, SearchResult] = {}
        for result in results:
            if result.path not in path_to_result or result.score > path_to_result[result.path].score:
                path_to_result[result.path] = result

        final_results = sorted(
            path_to_result.values(),
            key=lambda r: r.score,
            reverse=True,
        )

        stats.files_matched = len(final_results)
        stats.time_ms = (time.time() - start_time) * 1000

        return ChainSearchResult(
            query=query,
            results=final_results,
            symbols=[],
            stats=stats,
        )

    def _cross_encoder_rerank(
        self,
        query: str,
        results: List[SearchResult],
        top_k: int,
    ) -> List[SearchResult]:
        """Rerank results using cross-encoder model.

        Args:
            query: Search query string
            results: Candidate results to rerank
            top_k: Number of top results to return

        Returns:
            Reranked results sorted by cross-encoder score
        """
        if not results:
            return []

        # Try to get reranker from config or create new one
        reranker = None
        try:
            from codexlens.semantic.reranker import (
                check_reranker_available,
                get_reranker,
            )

            # Determine backend and model from config
            backend = "onnx"
            model_name = None
            use_gpu = True

            if self._config is not None:
                backend = getattr(self._config, "reranker_backend", "onnx") or "onnx"
                model_name = getattr(self._config, "reranker_model", None)
                use_gpu = getattr(self._config, "embedding_use_gpu", True)

            ok, err = check_reranker_available(backend)
            if not ok:
                self.logger.debug("Reranker backend unavailable (%s): %s", backend, err)
                return results[:top_k]

            # Create reranker
            kwargs = {}
            if backend == "onnx":
                kwargs["use_gpu"] = use_gpu
            elif backend == "api":
                # Pass max_input_tokens for adaptive batching
                max_tokens = getattr(self._config, "reranker_max_input_tokens", None)
                if max_tokens:
                    kwargs["max_input_tokens"] = max_tokens

            reranker = get_reranker(backend=backend, model_name=model_name, **kwargs)

        except ImportError as exc:
            self.logger.debug("Reranker not available: %s", exc)
            return results[:top_k]
        except Exception as exc:
            self.logger.debug("Failed to initialize reranker: %s", exc)
            return results[:top_k]

        # Use cross_encoder_rerank from ranking module
        from codexlens.search.ranking import cross_encoder_rerank

        return cross_encoder_rerank(
            query=query,
            results=results,
            reranker=reranker,
            top_k=top_k,
            batch_size=32,
        )

    def search_files_only(self, query: str,
                          source_path: Path,
                          options: Optional[SearchOptions] = None) -> List[str]:
        """Search and return only matching file paths.

        Faster than full search when excerpts are not needed.

        Args:
            query: FTS5 search query string
            source_path: Starting directory path
            options: Search configuration (uses defaults if None)

        Returns:
            List of file paths as strings

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper)
            >>> paths = engine.search_files_only("TODO", Path("D:/project"))
            >>> print(f"Found {len(paths)} files with TODOs")
        """
        options = options or SearchOptions()
        options.files_only = True

        result = self.search(query, source_path, options)
        return [r.path for r in result.results]

    def search_symbols(self, name: str,
                       source_path: Path,
                       kind: Optional[str] = None,
                       options: Optional[SearchOptions] = None) -> List[Symbol]:
        """Chain symbol search across directory hierarchy.

        Args:
            name: Symbol name pattern (partial match supported)
            source_path: Starting directory path
            kind: Optional symbol kind filter (e.g., 'function', 'class')
            options: Search configuration (uses defaults if None)

        Returns:
            List of Symbol objects sorted by name

        Examples:
            >>> engine = ChainSearchEngine(registry, mapper)
            >>> funcs = engine.search_symbols("init", Path("D:/project"), kind="function")
            >>> for sym in funcs[:10]:
            ...     print(f"{sym.name} ({sym.kind}): lines {sym.range}")
        """
        options = options or SearchOptions()

        start_index = self._find_start_index(source_path)
        if not start_index:
            self.logger.warning(f"No index found for {source_path}")
            return []

        # Fast path: project-wide global symbol index (avoids chain traversal).
        if self._config is None or getattr(self._config, "global_symbol_index_enabled", True):
            try:
                # Avoid relying on index_to_source() here; use the same logic as _find_start_index
                # to determine the effective search root directory.
                search_root = source_path.resolve()
                exact_index = self.mapper.source_to_index_db(search_root)
                if not exact_index.exists():
                    nearest = self.registry.find_nearest_index(search_root)
                    if nearest:
                        search_root = nearest.source_path

                project = self.registry.find_by_source_path(str(search_root))
                if project:
                    global_db_path = Path(project["index_root"]) / GlobalSymbolIndex.DEFAULT_DB_NAME
                    if global_db_path.exists():
                        query_limit = max(int(options.total_limit) * 10, int(options.total_limit))
                        with GlobalSymbolIndex(global_db_path, project_id=int(project["id"])) as global_index:
                            candidates = global_index.search(name=name, kind=kind, limit=query_limit)

                        # Apply depth constraint relative to the start index directory.
                        filtered: List[Symbol] = []
                        for sym in candidates:
                            if not sym.file:
                                continue
                            try:
                                root_str = str(search_root)
                                file_dir_str = str(Path(sym.file).parent)

                                # Normalize Windows long-path prefix (\\?\) if present.
                                if root_str.startswith("\\\\?\\"):
                                    root_str = root_str[4:]
                                if file_dir_str.startswith("\\\\?\\"):
                                    file_dir_str = file_dir_str[4:]

                                root_cmp = root_str.lower().rstrip("\\/")
                                dir_cmp = file_dir_str.lower().rstrip("\\/")

                                # Guard against Windows cross-drive comparisons (ValueError).
                                if os.name == "nt":
                                    root_drive, _ = os.path.splitdrive(root_cmp)
                                    dir_drive, _ = os.path.splitdrive(dir_cmp)
                                    if root_drive and dir_drive and root_drive != dir_drive:
                                        self.logger.debug(
                                            "Skipping symbol due to cross-drive path (root=%s file=%s name=%s)",
                                            root_cmp,
                                            sym.file,
                                            sym.name,
                                        )
                                        continue

                                if os.path.commonpath([root_cmp, dir_cmp]) != root_cmp:
                                    continue

                                rel = os.path.relpath(dir_cmp, root_cmp)
                                rel_depth = 0 if rel == "." else len(rel.split(os.sep))
                            except ValueError as exc:
                                self.logger.debug(
                                    "Skipping symbol due to path operation failure (root=%s file=%s name=%s): %s",
                                    str(search_root),
                                    sym.file,
                                    sym.name,
                                    exc,
                                )
                                continue
                            except Exception as exc:
                                self.logger.debug(
                                    "Skipping symbol due to unexpected path error (root=%s file=%s name=%s): %s",
                                    str(search_root),
                                    sym.file,
                                    sym.name,
                                    exc,
                                )
                                continue

                            if options.depth >= 0 and rel_depth > options.depth:
                                continue
                            filtered.append(sym)

                        if filtered:
                            # Match existing semantics: dedupe by (name, kind, range), sort by name.
                            seen = set()
                            unique_symbols: List[Symbol] = []
                            for sym in filtered:
                                key = (sym.name, sym.kind, sym.range)
                                if key in seen:
                                    continue
                                seen.add(key)
                                unique_symbols.append(sym)
                            unique_symbols.sort(key=lambda s: s.name)
                            return unique_symbols[: options.total_limit]
            except Exception as exc:
                self.logger.debug("Global symbol index fast path failed: %s", exc)

        index_paths = self._collect_index_paths(start_index, options.depth)
        if not index_paths:
            return []

        return self._search_symbols_parallel(
            index_paths, name, kind, options.total_limit
        )

    # === Internal Methods ===

    def _find_start_index(self, source_path: Path) -> Optional[Path]:
        """Find index database path for source directory.

        Attempts exact match first, then searches for nearest ancestor index.

        Args:
            source_path: Source directory path

        Returns:
            Path to _index.db file, or None if not found
        """
        source_path = source_path.resolve()

        # Try exact match first
        exact_index = self.mapper.source_to_index_db(source_path)
        if exact_index.exists():
            self.logger.debug(f"Found exact index: {exact_index}")
            return exact_index

        # Try nearest ancestor via registry
        nearest = self.registry.find_nearest_index(source_path)
        if nearest:
            self.logger.debug(f"Found nearest index: {nearest.index_path}")
            return nearest.index_path

        self.logger.warning(f"No index found for {source_path}")
        return None

    def _collect_index_paths(self, start_index: Path,
                              depth: int) -> List[Path]:
        """Recursively collect all subdirectory index paths.

        Traverses directory tree via subdirs table in each _index.db,
        respecting depth limit.

        Args:
            start_index: Starting _index.db path
            depth: Maximum depth (-1 = unlimited, 0 = current only)

        Returns:
            List of _index.db paths to search
        """
        collected = []
        visited = set()

        def _collect_recursive(index_path: Path, current_depth: int):
            # Normalize path to avoid duplicates
            normalized = index_path.resolve()
            if normalized in visited:
                return
            visited.add(normalized)

            # Add current index
            if normalized.exists():
                collected.append(normalized)
            else:
                self.logger.debug(f"Index does not exist: {normalized}")
                return

            # Check depth limit
            if depth >= 0 and current_depth >= depth:
                return

            # Read subdirs and recurse
            try:
                with DirIndexStore(normalized) as store:
                    subdirs = store.get_subdirs()
                    for subdir in subdirs:
                        _collect_recursive(subdir.index_path, current_depth + 1)
            except Exception as exc:
                self.logger.warning(f"Failed to read subdirs from {normalized}: {exc}")

        _collect_recursive(start_index, 0)
        self.logger.info(f"Collected {len(collected)} indexes (depth={depth})")
        return collected

    def _search_parallel(self, index_paths: List[Path],
                          query: str,
                          options: SearchOptions) -> tuple[List[SearchResult], SearchStats]:
        """Search multiple indexes in parallel using shared ThreadPoolExecutor.

        Args:
            index_paths: List of _index.db paths to search
            query: FTS5 query string
            options: Search configuration

        Returns:
            Tuple of (all results, search statistics)
        """
        all_results = []
        stats = SearchStats()

        # Force single-threaded execution for vector/hybrid search to avoid GPU crashes
        # DirectML/ONNX have threading issues when multiple threads access GPU resources
        effective_workers = options.max_workers
        if options.enable_vector or options.hybrid_mode:
            effective_workers = 1
            self.logger.debug("Using single-threaded mode for vector search (GPU safety)")
            # Pre-load embedder to avoid initialization overhead per-search
            try:
                from codexlens.semantic.embedder import get_embedder
                get_embedder(profile="code", use_gpu=True)
            except Exception:
                pass  # Ignore pre-load failures

        executor = self._get_executor(effective_workers)
        # Submit all search tasks
        future_to_path = {
            executor.submit(
                self._search_single_index,
                idx_path,
                query,
                options.limit_per_dir,
                options.files_only,
                options.include_semantic,
                options.hybrid_mode,
                options.enable_fuzzy,
                options.enable_vector,
                options.pure_vector,
                options.enable_splade,
                options.hybrid_weights
            ): idx_path
            for idx_path in index_paths
        }

        # Collect results as they complete
        for future in as_completed(future_to_path):
            idx_path = future_to_path[future]
            try:
                results = future.result()
                all_results.extend(results)
                self.logger.debug(f"Got {len(results)} results from {idx_path.parent.name}")
            except Exception as exc:
                error_msg = f"Search failed for {idx_path}: {exc}"
                self.logger.error(error_msg)
                stats.errors.append(error_msg)

        return all_results, stats

    def _search_single_index(self, index_path: Path,
                              query: str,
                              limit: int,
                              files_only: bool = False,
                              include_semantic: bool = False,
                              hybrid_mode: bool = False,
                              enable_fuzzy: bool = True,
                              enable_vector: bool = False,
                              pure_vector: bool = False,
                              enable_splade: bool = False,
                              hybrid_weights: Optional[Dict[str, float]] = None) -> List[SearchResult]:
        """Search a single index database.

        Handles exceptions gracefully, returning empty list on failure.

        Args:
            index_path: Path to _index.db file
            query: FTS5 query string (for FTS) or natural language query (for vector)
            limit: Maximum results from this index
            files_only: If True, skip snippet generation for faster search
            include_semantic: If True, also search semantic keywords and merge results
            hybrid_mode: If True, use hybrid search with RRF fusion
            enable_fuzzy: Enable fuzzy FTS in hybrid mode
            enable_vector: Enable vector semantic search
            pure_vector: If True, only use vector search without FTS fallback
            enable_splade: If True, force SPLADE sparse neural search
            hybrid_weights: Custom RRF weights for hybrid search

        Returns:
            List of SearchResult objects (empty on error)
        """
        try:
            # Use hybrid search if enabled
            if hybrid_mode:
                hybrid_engine = HybridSearchEngine(weights=hybrid_weights)
                fts_results = hybrid_engine.search(
                    index_path,
                    query,
                    limit=limit,
                    enable_fuzzy=enable_fuzzy,
                    enable_vector=enable_vector,
                    pure_vector=pure_vector,
                    enable_splade=enable_splade,
                )
            else:
                # Single-FTS search (exact or fuzzy mode)
                with DirIndexStore(index_path) as store:
                    # Get FTS results
                    if files_only:
                        # Fast path: return paths only without snippets
                        paths = store.search_files_only(query, limit=limit)
                        fts_results = [SearchResult(path=p, score=0.0, excerpt="") for p in paths]
                    else:
                        # Use fuzzy FTS if enable_fuzzy=True (mode="fuzzy"), otherwise exact FTS
                        if enable_fuzzy:
                            fts_results = store.search_fts_fuzzy(
                                query, limit=limit, return_full_content=True
                            )
                        else:
                            fts_results = store.search_fts_exact(
                                query, limit=limit, return_full_content=True
                            )

                    # Optionally add semantic keyword results
                    if include_semantic:
                        try:
                            semantic_matches = store.search_semantic_keywords(query)
                            # Convert semantic matches to SearchResult with 0.8x weight
                            for file_entry, keywords in semantic_matches:
                                # Create excerpt from keywords
                                excerpt = f"Keywords: {', '.join(keywords[:5])}"
                                # Use a base score of 10.0 for semantic matches, weighted by 0.8
                                semantic_result = SearchResult(
                                    path=str(file_entry.full_path),
                                    score=10.0 * 0.8,
                                    excerpt=excerpt
                                )
                                fts_results.append(semantic_result)
                        except Exception as sem_exc:
                            self.logger.debug(f"Semantic search error in {index_path}: {sem_exc}")

            return fts_results
        except Exception as exc:
            self.logger.debug(f"Search error in {index_path}: {exc}")
            return []

    def _filter_by_extension(self, results: List[SearchResult],
                              code_only: bool = False,
                              exclude_extensions: Optional[List[str]] = None) -> List[SearchResult]:
        """Filter search results by file extension.

        Args:
            results: Search results to filter
            code_only: If True, exclude non-code files (md, txt, json, yaml, xml, etc.)
            exclude_extensions: List of extensions to exclude (e.g., ["md", "txt"])

        Returns:
            Filtered results
        """
        # Non-code file extensions (same as MCP tool smart-search.ts)
        NON_CODE_EXTENSIONS = {
            'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log',
            'ini', 'cfg', 'conf', 'toml', 'env', 'properties',
            'html', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp',
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
            'lock', 'sum', 'mod',
        }

        # Build exclusion set
        excluded_exts = set()
        if exclude_extensions:
            # Normalize extensions (remove leading dots, lowercase)
            excluded_exts = {ext.lower().lstrip('.') for ext in exclude_extensions}
        if code_only:
            excluded_exts.update(NON_CODE_EXTENSIONS)

        if not excluded_exts:
            return results

        # Filter results
        filtered = []
        for result in results:
            path_str = result.path
            if not path_str:
                continue

            # Extract extension from path
            if '.' in path_str:
                ext = path_str.rsplit('.', 1)[-1].lower()
                if ext in excluded_exts:
                    continue  # Skip this result

            filtered.append(result)

        return filtered

    def _merge_and_rank(self, results: List[SearchResult],
                         limit: int, offset: int = 0) -> List[SearchResult]:
        """Aggregate, deduplicate, and rank results.

        Process:
        1. Deduplicate by path (keep highest score)
        2. Sort by score descending
        3. Apply offset and limit for pagination

        Args:
            results: Raw results from all indexes
            limit: Maximum results to return
            offset: Number of results to skip (pagination offset)

        Returns:
            Deduplicated and ranked results with pagination
        """
        # Deduplicate by path, keeping best score
        path_to_result: Dict[str, SearchResult] = {}
        for result in results:
            path = result.path
            if path not in path_to_result or result.score > path_to_result[path].score:
                path_to_result[path] = result

        # Sort by score descending
        unique_results = list(path_to_result.values())
        unique_results.sort(key=lambda r: r.score, reverse=True)

        # Apply offset and limit for pagination
        return unique_results[offset:offset + limit]

    def _search_symbols_parallel(self, index_paths: List[Path],
                                  name: str,
                                  kind: Optional[str],
                                  limit: int) -> List[Symbol]:
        """Search symbols across multiple indexes in parallel.

        Args:
            index_paths: List of _index.db paths to search
            name: Symbol name pattern
            kind: Optional symbol kind filter
            limit: Total symbol limit

        Returns:
            Deduplicated and sorted symbols
        """
        all_symbols = []

        executor = self._get_executor()
        # Submit all symbol search tasks
        future_to_path = {
            executor.submit(
                self._search_symbols_single,
                idx_path,
                name,
                kind
            ): idx_path
            for idx_path in index_paths
        }

        # Collect results
        for future in as_completed(future_to_path):
            try:
                symbols = future.result()
                all_symbols.extend(symbols)
            except Exception as exc:
                self.logger.error(f"Symbol search failed: {exc}")

        # Deduplicate by (name, kind, range)
        seen = set()
        unique_symbols = []
        for sym in all_symbols:
            key = (sym.name, sym.kind, sym.range)
            if key not in seen:
                seen.add(key)
                unique_symbols.append(sym)

        # Sort by name
        unique_symbols.sort(key=lambda s: s.name)

        return unique_symbols[:limit]

    def _search_symbols_single(self, index_path: Path,
                                name: str,
                                kind: Optional[str]) -> List[Symbol]:
        """Search symbols in a single index.

        Args:
            index_path: Path to _index.db file
            name: Symbol name pattern
            kind: Optional symbol kind filter

        Returns:
            List of Symbol objects (empty on error)
        """
        try:
            with DirIndexStore(index_path) as store:
                return store.search_symbols(name, kind=kind)
        except Exception as exc:
            self.logger.debug(f"Symbol search error in {index_path}: {exc}")
            return []


# === Convenience Functions ===

def quick_search(query: str,
                 source_path: Path,
                 depth: int = -1) -> List[SearchResult]:
    """Quick search convenience function with automatic initialization.

    Creates temporary registry and mapper instances for one-off searches.
    For repeated searches, create a ChainSearchEngine instance directly.

    Args:
        query: FTS5 search query string
        source_path: Starting directory path
        depth: Maximum search depth (-1 = unlimited)

    Returns:
        List of SearchResult objects sorted by relevance

    Examples:
        >>> from pathlib import Path
        >>> results = quick_search("authentication", Path("D:/project/src"))
        >>> print(f"Found {len(results)} matches")
    """
    registry = RegistryStore()
    registry.initialize()

    mapper = PathMapper()

    with ChainSearchEngine(registry, mapper) as engine:
        options = SearchOptions(depth=depth)
        result = engine.search(query, source_path, options)

    registry.close()

    return result.results
