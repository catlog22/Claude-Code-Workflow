"""Configuration system for CodexLens."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any, Dict, List, Optional

from .errors import ConfigError


# Workspace-local directory name
WORKSPACE_DIR_NAME = ".codexlens"

# Settings file name
SETTINGS_FILE_NAME = "settings.json"

# SPLADE index database name (centralized storage)
SPLADE_DB_NAME = "_splade.db"

# Dense vector storage names (centralized storage)
VECTORS_HNSW_NAME = "_vectors.hnsw"
VECTORS_META_DB_NAME = "_vectors_meta.db"
BINARY_VECTORS_MMAP_NAME = "_binary_vectors.mmap"

log = logging.getLogger(__name__)


def _default_global_dir() -> Path:
    """Get global CodexLens data directory."""
    env_override = os.getenv("CODEXLENS_DATA_DIR")
    if env_override:
        return Path(env_override).expanduser().resolve()
    return (Path.home() / ".codexlens").resolve()


def find_workspace_root(start_path: Path) -> Optional[Path]:
    """Find the workspace root by looking for .codexlens directory.

    Searches from start_path upward to find an existing .codexlens directory.
    Returns None if not found.
    """
    current = start_path.resolve()

    # Search up to filesystem root
    while current != current.parent:
        workspace_dir = current / WORKSPACE_DIR_NAME
        if workspace_dir.is_dir():
            return current
        current = current.parent

    # Check root as well
    workspace_dir = current / WORKSPACE_DIR_NAME
    if workspace_dir.is_dir():
        return current

    return None


@dataclass
class Config:
    """Runtime configuration for CodexLens.

    - data_dir: Base directory for all persistent CodexLens data.
    - venv_path: Optional virtualenv used for language tooling.
    - supported_languages: Language IDs and their associated file extensions.
    - parsing_rules: Per-language parsing and chunking hints.
    """

    data_dir: Path = field(default_factory=_default_global_dir)
    venv_path: Path = field(default_factory=lambda: _default_global_dir() / "venv")
    supported_languages: Dict[str, Dict[str, Any]] = field(
        default_factory=lambda: {
            # Source code languages (category: "code")
            "python": {"extensions": [".py"], "tree_sitter_language": "python", "category": "code"},
            "javascript": {"extensions": [".js", ".jsx"], "tree_sitter_language": "javascript", "category": "code"},
            "typescript": {"extensions": [".ts", ".tsx"], "tree_sitter_language": "typescript", "category": "code"},
            "java": {"extensions": [".java"], "tree_sitter_language": "java", "category": "code"},
            "go": {"extensions": [".go"], "tree_sitter_language": "go", "category": "code"},
            "zig": {"extensions": [".zig"], "tree_sitter_language": "zig", "category": "code"},
            "objective-c": {"extensions": [".m", ".mm"], "tree_sitter_language": "objc", "category": "code"},
            "c": {"extensions": [".c", ".h"], "tree_sitter_language": "c", "category": "code"},
            "cpp": {"extensions": [".cc", ".cpp", ".hpp", ".cxx"], "tree_sitter_language": "cpp", "category": "code"},
            "rust": {"extensions": [".rs"], "tree_sitter_language": "rust", "category": "code"},
        }
    )
    parsing_rules: Dict[str, Dict[str, Any]] = field(
        default_factory=lambda: {
            "default": {
                "max_chunk_chars": 4000,
                "max_chunk_lines": 200,
                "overlap_lines": 20,
            }
        }
    )

    llm_enabled: bool = False
    llm_tool: str = "gemini"
    llm_timeout_ms: int = 300000
    llm_batch_size: int = 5

    # Hybrid chunker configuration
    hybrid_max_chunk_size: int = 2000  # Max characters per chunk before LLM refinement
    hybrid_llm_refinement: bool = False  # Enable LLM-based semantic boundary refinement

    # Embedding configuration
    embedding_backend: str = "fastembed"  # "fastembed" (local) or "litellm" (API)
    embedding_model: str = "code"  # For fastembed: profile (fast/code/multilingual/balanced)
                                   # For litellm: model name from config (e.g., "qwen3-embedding")
    embedding_use_gpu: bool = True  # For fastembed: whether to use GPU acceleration

    # SPLADE sparse retrieval configuration
    enable_splade: bool = False  # Disable SPLADE by default (slow ~360ms, use FTS instead)
    splade_model: str = "naver/splade-cocondenser-ensembledistil"
    splade_threshold: float = 0.01  # Min weight to store in index
    splade_onnx_path: Optional[str] = None  # Custom ONNX model path

    # FTS fallback (disabled by default, available via --use-fts)
    use_fts_fallback: bool = True  # Use FTS for sparse search (fast, SPLADE disabled)

    # Indexing/search optimizations
    global_symbol_index_enabled: bool = True  # Enable project-wide symbol index fast path
    enable_merkle_detection: bool = True  # Enable content-hash based incremental indexing

    # Graph expansion (search-time, uses precomputed neighbors)
    enable_graph_expansion: bool = False
    graph_expansion_depth: int = 2

    # Optional search reranking (disabled by default)
    enable_reranking: bool = False
    reranking_top_k: int = 50
    symbol_boost_factor: float = 1.5

    # Optional cross-encoder reranking (second stage; requires optional reranker deps)
    enable_cross_encoder_rerank: bool = False
    reranker_backend: str = "onnx"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    reranker_top_k: int = 50
    reranker_max_input_tokens: int = 8192  # Maximum tokens for reranker API batching

    # Cascade search configuration (two-stage retrieval)
    enable_cascade_search: bool = False  # Enable cascade search (coarse + fine ranking)
    cascade_coarse_k: int = 100  # Number of coarse candidates from first stage
    cascade_fine_k: int = 10  # Number of final results after reranking
    cascade_strategy: str = "binary"  # "binary" (fast binary+dense) or "hybrid" (FTS+SPLADE+Vector+CrossEncoder)

    # RRF fusion configuration
    fusion_method: str = "rrf"  # "simple" (weighted sum) or "rrf" (reciprocal rank fusion)
    rrf_k: int = 60  # RRF constant (default 60)

    # Category-based filtering to separate code/doc results
    enable_category_filter: bool = True  # Enable code/doc result separation

    # Multi-endpoint configuration for litellm backend
    embedding_endpoints: List[Dict[str, Any]] = field(default_factory=list)
    # List of endpoint configs: [{"model": "...", "api_key": "...", "api_base": "...", "weight": 1.0}]
    embedding_pool_enabled: bool = False  # Enable high availability pool for embeddings
    embedding_strategy: str = "latency_aware"  # round_robin, latency_aware, weighted_random
    embedding_cooldown: float = 60.0  # Default cooldown seconds for rate-limited endpoints

    # Reranker multi-endpoint configuration
    reranker_pool_enabled: bool = False  # Enable high availability pool for reranker
    reranker_strategy: str = "latency_aware"  # round_robin, latency_aware, weighted_random
    reranker_cooldown: float = 60.0  # Default cooldown seconds for rate-limited endpoints

    # API concurrency settings
    api_max_workers: int = 4  # Max concurrent API calls for embedding/reranking
    api_batch_size: int = 8  # Batch size for API requests

    def __post_init__(self) -> None:
        try:
            self.data_dir = self.data_dir.expanduser().resolve()
            self.venv_path = self.venv_path.expanduser().resolve()
            self.data_dir.mkdir(parents=True, exist_ok=True)
        except PermissionError as exc:
            raise ConfigError(
                f"Permission denied initializing paths (data_dir={self.data_dir}, venv_path={self.venv_path}) "
                f"[{type(exc).__name__}]: {exc}"
            ) from exc
        except OSError as exc:
            raise ConfigError(
                f"Filesystem error initializing paths (data_dir={self.data_dir}, venv_path={self.venv_path}) "
                f"[{type(exc).__name__}]: {exc}"
            ) from exc
        except Exception as exc:
            raise ConfigError(
                f"Unexpected error initializing paths (data_dir={self.data_dir}, venv_path={self.venv_path}) "
                f"[{type(exc).__name__}]: {exc}"
            ) from exc

    @cached_property
    def cache_dir(self) -> Path:
        """Directory for transient caches."""
        return self.data_dir / "cache"

    @cached_property
    def index_dir(self) -> Path:
        """Directory where index artifacts are stored."""
        return self.data_dir / "index"

    @cached_property
    def db_path(self) -> Path:
        """Default SQLite index path."""
        return self.index_dir / "codexlens.db"

    def ensure_runtime_dirs(self) -> None:
        """Create standard runtime directories if missing."""
        for directory in (self.cache_dir, self.index_dir):
            try:
                directory.mkdir(parents=True, exist_ok=True)
            except PermissionError as exc:
                raise ConfigError(
                    f"Permission denied creating directory {directory} [{type(exc).__name__}]: {exc}"
                ) from exc
            except OSError as exc:
                raise ConfigError(
                    f"Filesystem error creating directory {directory} [{type(exc).__name__}]: {exc}"
                ) from exc
            except Exception as exc:
                raise ConfigError(
                    f"Unexpected error creating directory {directory} [{type(exc).__name__}]: {exc}"
                ) from exc

    def language_for_path(self, path: str | Path) -> str | None:
        """Infer a supported language ID from a file path."""
        extension = Path(path).suffix.lower()
        for language_id, spec in self.supported_languages.items():
            extensions: List[str] = spec.get("extensions", [])
            if extension in extensions:
                return language_id
        return None

    def category_for_path(self, path: str | Path) -> str | None:
        """Get file category ('code' or 'doc') from a file path."""
        language = self.language_for_path(path)
        if language is None:
            return None
        spec = self.supported_languages.get(language, {})
        return spec.get("category")

    def rules_for_language(self, language_id: str) -> Dict[str, Any]:
        """Get parsing rules for a specific language, falling back to defaults."""
        return {**self.parsing_rules.get("default", {}), **self.parsing_rules.get(language_id, {})}

    @cached_property
    def settings_path(self) -> Path:
        """Path to the settings file."""
        return self.data_dir / SETTINGS_FILE_NAME

    def save_settings(self) -> None:
        """Save embedding and other settings to file."""
        embedding_config = {
            "backend": self.embedding_backend,
            "model": self.embedding_model,
            "use_gpu": self.embedding_use_gpu,
            "pool_enabled": self.embedding_pool_enabled,
            "strategy": self.embedding_strategy,
            "cooldown": self.embedding_cooldown,
        }
        # Include multi-endpoint config if present
        if self.embedding_endpoints:
            embedding_config["endpoints"] = self.embedding_endpoints

        settings = {
            "embedding": embedding_config,
            "llm": {
                "enabled": self.llm_enabled,
                "tool": self.llm_tool,
                "timeout_ms": self.llm_timeout_ms,
                "batch_size": self.llm_batch_size,
            },
            "reranker": {
                "enabled": self.enable_cross_encoder_rerank,
                "backend": self.reranker_backend,
                "model": self.reranker_model,
                "top_k": self.reranker_top_k,
                "max_input_tokens": self.reranker_max_input_tokens,
                "pool_enabled": self.reranker_pool_enabled,
                "strategy": self.reranker_strategy,
                "cooldown": self.reranker_cooldown,
            },
            "cascade": {
                "strategy": self.cascade_strategy,
                "coarse_k": self.cascade_coarse_k,
                "fine_k": self.cascade_fine_k,
            },
            "api": {
                "max_workers": self.api_max_workers,
                "batch_size": self.api_batch_size,
            },
        }
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)

    def load_settings(self) -> None:
        """Load settings from file if exists."""
        if not self.settings_path.exists():
            return

        try:
            with open(self.settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)

            # Load embedding settings
            embedding = settings.get("embedding", {})
            if "backend" in embedding:
                backend = embedding["backend"]
                if backend in {"fastembed", "litellm"}:
                    self.embedding_backend = backend
                else:
                    log.warning(
                        "Invalid embedding backend in %s: %r (expected 'fastembed' or 'litellm')",
                        self.settings_path,
                        backend,
                    )
            if "model" in embedding:
                self.embedding_model = embedding["model"]
            if "use_gpu" in embedding:
                self.embedding_use_gpu = embedding["use_gpu"]

            # Load multi-endpoint configuration
            if "endpoints" in embedding:
                self.embedding_endpoints = embedding["endpoints"]
            if "pool_enabled" in embedding:
                self.embedding_pool_enabled = embedding["pool_enabled"]
            if "strategy" in embedding:
                self.embedding_strategy = embedding["strategy"]
            if "cooldown" in embedding:
                self.embedding_cooldown = embedding["cooldown"]

            # Load LLM settings
            llm = settings.get("llm", {})
            if "enabled" in llm:
                self.llm_enabled = llm["enabled"]
            if "tool" in llm:
                self.llm_tool = llm["tool"]
            if "timeout_ms" in llm:
                self.llm_timeout_ms = llm["timeout_ms"]
            if "batch_size" in llm:
                self.llm_batch_size = llm["batch_size"]

            # Load reranker settings
            reranker = settings.get("reranker", {})
            if "enabled" in reranker:
                self.enable_cross_encoder_rerank = reranker["enabled"]
            if "backend" in reranker:
                backend = reranker["backend"]
                if backend in {"fastembed", "onnx", "api", "litellm", "legacy"}:
                    self.reranker_backend = backend
                else:
                    log.warning(
                        "Invalid reranker backend in %s: %r (expected 'fastembed', 'onnx', 'api', 'litellm', or 'legacy')",
                        self.settings_path,
                        backend,
                    )
            if "model" in reranker:
                self.reranker_model = reranker["model"]
            if "top_k" in reranker:
                self.reranker_top_k = reranker["top_k"]
            if "max_input_tokens" in reranker:
                self.reranker_max_input_tokens = reranker["max_input_tokens"]
            if "pool_enabled" in reranker:
                self.reranker_pool_enabled = reranker["pool_enabled"]
            if "strategy" in reranker:
                self.reranker_strategy = reranker["strategy"]
            if "cooldown" in reranker:
                self.reranker_cooldown = reranker["cooldown"]

            # Load cascade settings
            cascade = settings.get("cascade", {})
            if "strategy" in cascade:
                strategy = cascade["strategy"]
                if strategy in {"binary", "hybrid", "binary_rerank", "dense_rerank"}:
                    self.cascade_strategy = strategy
                else:
                    log.warning(
                        "Invalid cascade strategy in %s: %r (expected 'binary', 'hybrid', 'binary_rerank', or 'dense_rerank')",
                        self.settings_path,
                        strategy,
                    )
            if "coarse_k" in cascade:
                self.cascade_coarse_k = cascade["coarse_k"]
            if "fine_k" in cascade:
                self.cascade_fine_k = cascade["fine_k"]

            # Load API settings
            api = settings.get("api", {})
            if "max_workers" in api:
                self.api_max_workers = api["max_workers"]
            if "batch_size" in api:
                self.api_batch_size = api["batch_size"]
        except Exception as exc:
            log.warning(
                "Failed to load settings from %s (%s): %s",
                self.settings_path,
                type(exc).__name__,
                exc,
            )

        # Apply .env overrides (highest priority)
        self._apply_env_overrides()

    def _apply_env_overrides(self) -> None:
        """Apply environment variable overrides from .env file.

        Priority: default → settings.json → .env (highest)

        Supported variables:
            EMBEDDING_MODEL: Override embedding model/profile
            EMBEDDING_BACKEND: Override embedding backend (fastembed/litellm)
            EMBEDDING_POOL_ENABLED: Enable embedding high availability pool
            EMBEDDING_STRATEGY: Load balance strategy for embedding
            EMBEDDING_COOLDOWN: Rate limit cooldown for embedding
            RERANKER_MODEL: Override reranker model
            RERANKER_BACKEND: Override reranker backend
            RERANKER_ENABLED: Override reranker enabled state (true/false)
            RERANKER_POOL_ENABLED: Enable reranker high availability pool
            RERANKER_STRATEGY: Load balance strategy for reranker
            RERANKER_COOLDOWN: Rate limit cooldown for reranker
        """
        from .env_config import load_global_env

        env_vars = load_global_env()
        if not env_vars:
            return

        # Embedding overrides
        if "EMBEDDING_MODEL" in env_vars:
            self.embedding_model = env_vars["EMBEDDING_MODEL"]
            log.debug("Overriding embedding_model from .env: %s", self.embedding_model)

        if "EMBEDDING_BACKEND" in env_vars:
            backend = env_vars["EMBEDDING_BACKEND"].lower()
            if backend in {"fastembed", "litellm"}:
                self.embedding_backend = backend
                log.debug("Overriding embedding_backend from .env: %s", backend)
            else:
                log.warning("Invalid EMBEDDING_BACKEND in .env: %r", backend)

        if "EMBEDDING_POOL_ENABLED" in env_vars:
            value = env_vars["EMBEDDING_POOL_ENABLED"].lower()
            self.embedding_pool_enabled = value in {"true", "1", "yes", "on"}
            log.debug("Overriding embedding_pool_enabled from .env: %s", self.embedding_pool_enabled)

        if "EMBEDDING_STRATEGY" in env_vars:
            strategy = env_vars["EMBEDDING_STRATEGY"].lower()
            if strategy in {"round_robin", "latency_aware", "weighted_random"}:
                self.embedding_strategy = strategy
                log.debug("Overriding embedding_strategy from .env: %s", strategy)
            else:
                log.warning("Invalid EMBEDDING_STRATEGY in .env: %r", strategy)

        if "EMBEDDING_COOLDOWN" in env_vars:
            try:
                self.embedding_cooldown = float(env_vars["EMBEDDING_COOLDOWN"])
                log.debug("Overriding embedding_cooldown from .env: %s", self.embedding_cooldown)
            except ValueError:
                log.warning("Invalid EMBEDDING_COOLDOWN in .env: %r", env_vars["EMBEDDING_COOLDOWN"])

        # Reranker overrides
        if "RERANKER_MODEL" in env_vars:
            self.reranker_model = env_vars["RERANKER_MODEL"]
            log.debug("Overriding reranker_model from .env: %s", self.reranker_model)

        if "RERANKER_BACKEND" in env_vars:
            backend = env_vars["RERANKER_BACKEND"].lower()
            if backend in {"fastembed", "onnx", "api", "litellm", "legacy"}:
                self.reranker_backend = backend
                log.debug("Overriding reranker_backend from .env: %s", backend)
            else:
                log.warning("Invalid RERANKER_BACKEND in .env: %r", backend)

        if "RERANKER_ENABLED" in env_vars:
            value = env_vars["RERANKER_ENABLED"].lower()
            self.enable_cross_encoder_rerank = value in {"true", "1", "yes", "on"}
            log.debug("Overriding reranker_enabled from .env: %s", self.enable_cross_encoder_rerank)

        if "RERANKER_POOL_ENABLED" in env_vars:
            value = env_vars["RERANKER_POOL_ENABLED"].lower()
            self.reranker_pool_enabled = value in {"true", "1", "yes", "on"}
            log.debug("Overriding reranker_pool_enabled from .env: %s", self.reranker_pool_enabled)

        if "RERANKER_STRATEGY" in env_vars:
            strategy = env_vars["RERANKER_STRATEGY"].lower()
            if strategy in {"round_robin", "latency_aware", "weighted_random"}:
                self.reranker_strategy = strategy
                log.debug("Overriding reranker_strategy from .env: %s", strategy)
            else:
                log.warning("Invalid RERANKER_STRATEGY in .env: %r", strategy)

        if "RERANKER_COOLDOWN" in env_vars:
            try:
                self.reranker_cooldown = float(env_vars["RERANKER_COOLDOWN"])
                log.debug("Overriding reranker_cooldown from .env: %s", self.reranker_cooldown)
            except ValueError:
                log.warning("Invalid RERANKER_COOLDOWN in .env: %r", env_vars["RERANKER_COOLDOWN"])

        if "RERANKER_MAX_INPUT_TOKENS" in env_vars:
            try:
                self.reranker_max_input_tokens = int(env_vars["RERANKER_MAX_INPUT_TOKENS"])
                log.debug("Overriding reranker_max_input_tokens from .env: %s", self.reranker_max_input_tokens)
            except ValueError:
                log.warning("Invalid RERANKER_MAX_INPUT_TOKENS in .env: %r", env_vars["RERANKER_MAX_INPUT_TOKENS"])

    @classmethod
    def load(cls) -> "Config":
        """Load config with settings from file."""
        config = cls()
        config.load_settings()
        return config


@dataclass
class WorkspaceConfig:
    """Workspace-local configuration for CodexLens.

    Stores index data in project/.codexlens/ directory.
    """

    workspace_root: Path

    def __post_init__(self) -> None:
        self.workspace_root = Path(self.workspace_root).resolve()

    @property
    def codexlens_dir(self) -> Path:
        """The .codexlens directory in workspace root."""
        return self.workspace_root / WORKSPACE_DIR_NAME

    @property
    def db_path(self) -> Path:
        """SQLite index path for this workspace."""
        return self.codexlens_dir / "index.db"

    @property
    def cache_dir(self) -> Path:
        """Cache directory for this workspace."""
        return self.codexlens_dir / "cache"

    @property
    def env_path(self) -> Path:
        """Path to workspace .env file."""
        return self.codexlens_dir / ".env"

    def load_env(self, *, override: bool = False) -> int:
        """Load .env file and apply to os.environ.

        Args:
            override: If True, override existing environment variables

        Returns:
            Number of variables applied
        """
        from .env_config import apply_workspace_env
        return apply_workspace_env(self.workspace_root, override=override)

    def get_api_config(self, prefix: str) -> dict:
        """Get API configuration from environment.

        Args:
            prefix: Environment variable prefix (e.g., "RERANKER", "EMBEDDING")

        Returns:
            Dictionary with api_key, api_base, model, etc.
        """
        from .env_config import get_api_config
        return get_api_config(prefix, workspace_root=self.workspace_root)

    def initialize(self) -> None:
        """Create the .codexlens directory structure."""
        try:
            self.codexlens_dir.mkdir(parents=True, exist_ok=True)
            self.cache_dir.mkdir(parents=True, exist_ok=True)

            # Create .gitignore to exclude cache but keep index
            gitignore_path = self.codexlens_dir / ".gitignore"
            if not gitignore_path.exists():
                gitignore_path.write_text(
                    "# CodexLens workspace data\n"
                    "cache/\n"
                    "*.log\n"
                    ".env\n"  # Exclude .env from git
                )
        except Exception as exc:
            raise ConfigError(f"Failed to initialize workspace at {self.codexlens_dir}: {exc}") from exc

    def exists(self) -> bool:
        """Check if workspace is already initialized."""
        return self.codexlens_dir.is_dir() and self.db_path.exists()

    @classmethod
    def from_path(cls, path: Path) -> Optional["WorkspaceConfig"]:
        """Create WorkspaceConfig from a path by finding workspace root.

        Returns None if no workspace found.
        """
        root = find_workspace_root(path)
        if root is None:
            return None
        return cls(workspace_root=root)

    @classmethod
    def create_at(cls, path: Path) -> "WorkspaceConfig":
        """Create a new workspace at the given path."""
        config = cls(workspace_root=path)
        config.initialize()
        return config
