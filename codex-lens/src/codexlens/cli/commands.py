"""Typer commands for CodexLens."""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Annotated, Any, Dict, Iterable, List, Optional

import typer
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from codexlens.config import Config
from codexlens.entities import IndexedFile, SearchResult, Symbol
from codexlens.errors import CodexLensError, ConfigError, ParseError, StorageError, SearchError
from codexlens.parsers.factory import ParserFactory
from codexlens.storage.path_mapper import PathMapper
from codexlens.storage.registry import RegistryStore, ProjectInfo
from codexlens.storage.index_tree import IndexTreeBuilder
from codexlens.storage.dir_index import DirIndexStore
from codexlens.search.chain_search import ChainSearchEngine, SearchOptions
from codexlens.watcher import WatcherManager, WatcherConfig

from .output import (
    console,
    print_json,
    render_file_inspect,
    render_search_results,
    render_status,
    render_symbols,
)

app = typer.Typer(help="CodexLens CLI — local code indexing and search.")

# Index subcommand group for reorganized commands
index_app = typer.Typer(help="Index management commands (init, embeddings, splade, binary, status, migrate, all)")
app.add_typer(index_app, name="index")


def _deprecated_command_warning(old_name: str, new_name: str) -> None:
    """Display deprecation warning for renamed commands.

    Args:
        old_name: The old command name being deprecated
        new_name: The new command name to use instead
    """
    console.print(
        f"[yellow]Warning:[/yellow] '{old_name}' is deprecated. "
        f"Use '{new_name}' instead."
    )


def _configure_logging(verbose: bool, json_mode: bool = False) -> None:
    """Configure logging level.

    In JSON mode, suppress INFO logs to keep stderr clean for error parsing.
    Only WARNING and above are shown to avoid mixing logs with JSON output.
    """
    if json_mode and not verbose:
        # In JSON mode, suppress INFO logs to keep stderr clean
        level = logging.WARNING
    else:
        level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def _parse_languages(raw: Optional[List[str]]) -> Optional[List[str]]:
    if not raw:
        return None
    langs: List[str] = []
    for item in raw:
        for part in item.split(","):
            part = part.strip()
            if part:
                langs.append(part)
    return langs or None


def _get_index_root() -> Path:
    """Get the index root directory from config or default.

    Priority order:
    1. CODEXLENS_INDEX_DIR environment variable
    2. index_dir from ~/.codexlens/config.json
    3. Default: ~/.codexlens/indexes
    """
    env_override = os.getenv("CODEXLENS_INDEX_DIR")
    if env_override:
        return Path(env_override).expanduser().resolve()

    # Read from config.json
    config_file = Path.home() / ".codexlens" / "config.json"
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text(encoding="utf-8"))
            if "index_dir" in cfg:
                return Path(cfg["index_dir"]).expanduser().resolve()
        except (json.JSONDecodeError, OSError):
            pass  # Fall through to default

    return Path.home() / ".codexlens" / "indexes"


def _get_registry_path() -> Path:
    """Get the registry database path."""
    env_override = os.getenv("CODEXLENS_DATA_DIR")
    if env_override:
        return Path(env_override).expanduser().resolve() / "registry.db"
    return Path.home() / ".codexlens" / "registry.db"


@index_app.command("init")
def index_init(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to index."),
    language: Optional[List[str]] = typer.Option(
        None,
        "--language",
        "-l",
        help="Limit indexing to specific languages (repeat or comma-separated).",
    ),
    workers: Optional[int] = typer.Option(None, "--workers", "-w", min=1, help="Parallel worker processes (default: auto-detect based on CPU count)."),
    force: bool = typer.Option(False, "--force", "-f", help="Force full reindex (skip incremental mode)."),
    no_embeddings: bool = typer.Option(False, "--no-embeddings", help="Skip automatic embedding generation (if semantic deps installed)."),
    backend: Optional[str] = typer.Option(None, "--backend", "-b", help="Embedding backend: fastembed (local) or litellm (remote API). Defaults to settings.json config."),
    model: Optional[str] = typer.Option(None, "--model", "-m", help="Embedding model: profile name for fastembed or model name for litellm. Defaults to settings.json config."),
    max_workers: int = typer.Option(1, "--max-workers", min=1, help="Max concurrent API calls for embedding generation. Recommended: 4-8 for litellm backend."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Initialize or rebuild the index for a directory.

    Indexes are stored in ~/.codexlens/indexes/ with mirrored directory structure.
    Set CODEXLENS_INDEX_DIR to customize the index location.

    By default, uses incremental indexing (skip unchanged files).
    Use --force to rebuild all files regardless of modification time.

    If semantic search dependencies are installed, automatically generates embeddings
    after indexing completes. Use --no-embeddings to skip this step.

    Backend Options (--backend):
      - fastembed: Local ONNX-based embeddings (default, no API calls)
      - litellm: Remote API embeddings via ccw-litellm (requires API keys)

    Model Options (--model):
      - For fastembed backend: Use profile names (fast, code, multilingual, balanced)
      - For litellm backend: Use model names (e.g., text-embedding-3-small, text-embedding-ada-002)
    """
    _configure_logging(verbose, json_mode)
    config = Config()

    # Fallback to settings.json config if CLI params not provided
    config.load_settings()  # Ensure settings are loaded
    actual_backend = backend or config.embedding_backend
    actual_model = model or config.embedding_model

    languages = _parse_languages(language)
    base_path = path.expanduser().resolve()

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        builder = IndexTreeBuilder(registry, mapper, config, incremental=not force)

        if force:
            console.print(f"[bold]Building index for:[/bold] {base_path} [yellow](FULL reindex)[/yellow]")
        else:
            console.print(f"[bold]Building index for:[/bold] {base_path} [dim](incremental)[/dim]")

        build_result = builder.build(
            source_root=base_path,
            languages=languages,
            workers=workers,
            force_full=force,
        )

        result = {
            "path": str(base_path),
            "files_indexed": build_result.total_files,
            "dirs_indexed": build_result.total_dirs,
            "index_root": str(build_result.index_root),
            "project_id": build_result.project_id,
            "languages": languages or sorted(config.supported_languages.keys()),
            "errors": len(build_result.errors),
        }

        if not json_mode:
            console.print(f"[green]OK[/green] Indexed [bold]{build_result.total_files}[/bold] files in [bold]{build_result.total_dirs}[/bold] directories")
            console.print(f"  Index root: {build_result.index_root}")
            if build_result.errors:
                console.print(f"  [yellow]Warnings:[/yellow] {len(build_result.errors)} errors")

        # Auto-generate embeddings if the requested backend is available
        if not no_embeddings:
            try:
                from codexlens.semantic import is_embedding_backend_available
                from codexlens.cli.embedding_manager import generate_embeddings_recursive, get_embeddings_status

                # Validate embedding backend
                valid_backends = ["fastembed", "litellm"]
                if actual_backend not in valid_backends:
                    error_msg = f"Invalid embedding backend: {actual_backend}. Must be one of: {', '.join(valid_backends)}"
                    if json_mode:
                        print_json(success=False, error=error_msg)
                    else:
                        console.print(f"[red]Error:[/red] {error_msg}")
                    raise typer.Exit(code=1)

                backend_available, backend_error = is_embedding_backend_available(actual_backend)

                if backend_available:
                    # Use the index root directory (not the _index.db file)
                    index_root = Path(build_result.index_root)

                    if not json_mode:
                        console.print("\n[bold]Generating embeddings...[/bold]")
                        console.print(f"Backend: [cyan]{actual_backend}[/cyan]")
                        console.print(f"Model: [cyan]{actual_model}[/cyan]")
                    else:
                        # Output progress message for JSON mode (parsed by Node.js)
                        print("Generating embeddings...", flush=True)

                    # Progress callback - outputs progress for both json and non-json modes
                    # Node.js parseProgressLine() expects formats like:
                    # - "Batch X: N files, M chunks"
                    # - "Processing N files"
                    # - "Finalizing index"
                    def progress_update(msg: str):
                        if json_mode:
                            # Output without prefix so Node.js can parse it
                            # Strip leading spaces that embedding_manager adds
                            print(msg.strip(), flush=True)
                        elif verbose:
                            console.print(f"  {msg}")

                    embed_result = generate_embeddings_recursive(
                        index_root,
                        embedding_backend=actual_backend,
                        model_profile=actual_model,
                        force=False,  # Don't force regenerate during init
                        chunk_size=2000,
                        progress_callback=progress_update,  # Always use callback
                        max_workers=max_workers,
                    )

                    if embed_result["success"]:
                        embed_data = embed_result["result"]

                        # Output completion message for Node.js to parse
                        if json_mode:
                            print(f"Embeddings complete: {embed_data['total_chunks_created']} chunks", flush=True)

                        # Get comprehensive coverage statistics
                        status_result = get_embeddings_status(index_root)
                        if status_result["success"]:
                            coverage = status_result["result"]
                            result["embeddings"] = {
                                "generated": True,
                                "total_indexes": coverage["total_indexes"],
                                "total_files": coverage["total_files"],
                                "files_with_embeddings": coverage["files_with_embeddings"],
                                "coverage_percent": coverage["coverage_percent"],
                                "total_chunks": coverage["total_chunks"],
                            }
                        else:
                            result["embeddings"] = {
                                "generated": True,
                                "total_chunks": embed_data["total_chunks_created"],
                                "files_processed": embed_data["total_files_processed"],
                            }

                        if not json_mode:
                            console.print(f"[green]✓[/green] Generated embeddings for [bold]{embed_data['total_files_processed']}[/bold] files")
                            console.print(f"  Total chunks: [bold]{embed_data['total_chunks_created']}[/bold]")
                            console.print(f"  Indexes processed: [bold]{embed_data['indexes_successful']}/{embed_data['indexes_processed']}[/bold]")
                    else:
                        if not json_mode:
                            console.print(f"[yellow]Warning:[/yellow] Embedding generation failed: {embed_result.get('error', 'Unknown error')}")
                        result["embeddings"] = {
                            "generated": False,
                            "error": embed_result.get("error"),
                        }
                else:
                    if not json_mode and verbose:
                        console.print(f"[dim]Embedding backend '{actual_backend}' not available. Skipping embeddings.[/dim]")
                    result["embeddings"] = {
                        "generated": False,
                        "error": backend_error or "Embedding backend not available",
                    }
            except Exception as e:
                if not json_mode and verbose:
                    console.print(f"[yellow]Warning:[/yellow] Could not generate embeddings: {e}")
                result["embeddings"] = {
                    "generated": False,
                    "error": str(e),
                }
        else:
            result["embeddings"] = {
                "generated": False,
                "error": "Skipped (--no-embeddings)",
            }

        # Output final JSON result with embeddings status
        if json_mode:
            print_json(success=True, result=result)

    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Init failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except ConfigError as exc:
        if json_mode:
            print_json(success=False, error=f"Configuration error: {exc}")
        else:
            console.print(f"[red]Init failed (config):[/red] {exc}")
            raise typer.Exit(code=1)
    except ParseError as exc:
        if json_mode:
            print_json(success=False, error=f"Parse error: {exc}")
        else:
            console.print(f"[red]Init failed (parse):[/red] {exc}")
            raise typer.Exit(code=1)
    except PermissionError as exc:
        if json_mode:
            print_json(success=False, error=f"Permission denied: {exc}")
        else:
            console.print(f"[red]Init failed (permission denied):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Init failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def watch(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to watch."),
    language: Optional[List[str]] = typer.Option(
        None,
        "--language",
        "-l",
        help="Limit watching to specific languages (repeat or comma-separated).",
    ),
    debounce: int = typer.Option(1000, "--debounce", "-d", min=100, max=10000, help="Debounce interval in milliseconds."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose logging."),
) -> None:
    """Watch directory for changes and update index incrementally.

    Monitors filesystem events and automatically updates the index
    when files are created, modified, or deleted.

    The directory must already be indexed (run 'codexlens init' first).

    Press Ctrl+C to stop watching.

    Examples:
        codexlens watch .
        codexlens watch /path/to/project --debounce 500 --verbose
        codexlens watch . --language python,typescript
    """
    _configure_logging(verbose)

    from codexlens.watcher.events import IndexResult

    base_path = path.expanduser().resolve()

    # Check if path is indexed
    mapper = PathMapper()
    index_db = mapper.source_to_index_db(base_path)
    if not index_db.exists():
        console.print(f"[red]Error:[/red] Directory not indexed: {base_path}")
        console.print("Run 'codexlens init' first to create the index.")
        raise typer.Exit(code=1)

    # Parse languages
    languages = _parse_languages(language)

    # Create watcher config
    watcher_config = WatcherConfig(
        debounce_ms=debounce,
        languages=languages,
    )

    # Callback for indexed files
    def on_indexed(result: IndexResult) -> None:
        if result.files_indexed > 0:
            console.print(f"  [green]Indexed:[/green] {result.files_indexed} files ({result.symbols_added} symbols)")
        if result.files_removed > 0:
            console.print(f"  [yellow]Removed:[/yellow] {result.files_removed} files")
        if result.errors:
            for error in result.errors[:3]:  # Show first 3 errors
                console.print(f"  [red]Error:[/red] {error}")

    console.print(f"[bold]Watching:[/bold] {base_path}")
    console.print(f"  Debounce: {debounce}ms")
    if languages:
        console.print(f"  Languages: {', '.join(languages)}")
    console.print("  Press Ctrl+C to stop.\n")

    manager: WatcherManager | None = None
    try:
        manager = WatcherManager(
            root_path=base_path,
            watcher_config=watcher_config,
            on_indexed=on_indexed,
        )
        manager.start()
        manager.wait()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1)
    finally:
        if manager is not None:
            manager.stop()
        console.print("\n[dim]Watcher stopped.[/dim]")


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query."),
    path: Path = typer.Option(Path("."), "--path", "-p", help="Directory to search from."),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=500, help="Max results."),
    offset: int = typer.Option(0, "--offset", min=0, help="Pagination offset - skip first N results."),
    depth: int = typer.Option(-1, "--depth", "-d", help="Search depth (-1 = unlimited, 0 = current only)."),
    files_only: bool = typer.Option(False, "--files-only", "-f", help="Return only file paths without content snippets."),
    method: str = typer.Option("dense_rerank", "--method", "-m", help="Search method: 'dense_rerank' (semantic, default), 'fts' (exact keyword)."),
    use_fuzzy: bool = typer.Option(False, "--use-fuzzy", help="Enable fuzzy matching in FTS method."),
    code_only: bool = typer.Option(False, "--code-only", help="Only return code files (excludes md, txt, json, yaml, xml, etc.)."),
    exclude_extensions: Optional[str] = typer.Option(None, "--exclude-extensions", help="Comma-separated list of file extensions to exclude (e.g., 'md,txt,json')."),
    # Hidden advanced options for backward compatibility
    weights: Optional[str] = typer.Option(
        None,
        "--weights", "-w",
        hidden=True,
        help="[Advanced] RRF weights as key=value pairs."
    ),
    cascade_strategy: Optional[str] = typer.Option(
        None,
        "--cascade-strategy",
        hidden=True,
        help="[Advanced] Cascade strategy for --method cascade."
    ),
    # Hidden deprecated parameter for backward compatibility
    mode: Optional[str] = typer.Option(None, "--mode", hidden=True, help="[DEPRECATED] Use --method instead."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Search indexed file contents.

    Uses chain search across directory indexes.
    Use --depth to limit search recursion (0 = current dir only).

    Search Methods:
      - dense_rerank (default): Semantic search using Dense embedding coarse retrieval +
        Cross-encoder reranking. Best for natural language queries and code understanding.
      - fts: Full-text search using FTS5 (unicode61 tokenizer). Best for exact code
        identifiers like function/class names. Use --use-fuzzy for typo tolerance.

    Method Selection Guide:
      - Code identifiers (function/class names): fts
      - Natural language queries: dense_rerank (default)
      - Typo-tolerant search: fts --use-fuzzy

    Requirements:
      The dense_rerank method requires pre-generated embeddings.
      Use 'codexlens embeddings-generate' to create embeddings first.

    Examples:
      # Default semantic search (dense_rerank)
      codexlens search "authentication logic"

      # Exact code identifier search
      codexlens search "authenticate_user" --method fts

      # Typo-tolerant fuzzy search
      codexlens search "authentcate" --method fts --use-fuzzy
    """
    _configure_logging(verbose, json_mode)
    search_path = path.expanduser().resolve()

    # Handle deprecated --mode parameter
    actual_method = method
    if mode is not None:
        # Show deprecation warning
        if not json_mode:
            console.print("[yellow]Warning: --mode is deprecated, use --method instead.[/yellow]")

        # Map old mode values to new method values
        mode_to_method = {
            "auto": "hybrid",
            "exact": "fts",
            "fuzzy": "fts",  # with use_fuzzy=True
            "hybrid": "hybrid",
            "vector": "vector",
            "pure-vector": "vector",
        }

        if mode in mode_to_method:
            actual_method = mode_to_method[mode]
            # Enable fuzzy for old fuzzy mode
            if mode == "fuzzy":
                use_fuzzy = True
        else:
            if json_mode:
                print_json(success=False, error=f"Invalid deprecated mode: {mode}. Use --method instead.")
            else:
                console.print(f"[red]Invalid deprecated mode:[/red] {mode}")
                console.print("[dim]Use --method with: fts, vector, splade, hybrid, cascade[/dim]")
            raise typer.Exit(code=1)

    # Configure search (load settings from file)
    config = Config.load()

    # Validate method - simplified interface exposes only dense_rerank and fts
    # Other methods (vector, splade, hybrid, cascade) are hidden but still work for backward compatibility
    valid_methods = ["fts", "dense_rerank", "vector", "splade", "hybrid", "cascade"]
    if actual_method not in valid_methods:
        if json_mode:
            print_json(success=False, error=f"Invalid method: {actual_method}. Use 'dense_rerank' (semantic) or 'fts' (exact keyword).")
        else:
            console.print(f"[red]Invalid method:[/red] {actual_method}")
            console.print("[dim]Use 'dense_rerank' (semantic, default) or 'fts' (exact keyword)[/dim]")
        raise typer.Exit(code=1)

    # Map dense_rerank to cascade method internally
    internal_cascade_strategy = cascade_strategy
    if actual_method == "dense_rerank":
        actual_method = "cascade"
        internal_cascade_strategy = "dense_rerank"

    # Validate cascade_strategy if provided (for advanced users)
    if internal_cascade_strategy is not None:
        valid_strategies = ["binary", "hybrid", "binary_rerank", "dense_rerank"]
        if internal_cascade_strategy not in valid_strategies:
            if json_mode:
                print_json(success=False, error=f"Invalid cascade strategy: {internal_cascade_strategy}. Must be one of: {', '.join(valid_strategies)}")
            else:
                console.print(f"[red]Invalid cascade strategy:[/red] {internal_cascade_strategy}")
                console.print(f"[dim]Valid strategies: {', '.join(valid_strategies)}[/dim]")
            raise typer.Exit(code=1)

    # Parse custom weights if provided
    hybrid_weights = None
    if weights:
        try:
            # Check if using key=value format (new) or legacy comma-separated format
            if "=" in weights:
                # New format: splade=0.4,vector=0.6 or exact=0.3,fuzzy=0.1,vector=0.6
                weight_dict = {}
                for pair in weights.split(","):
                    if "=" in pair:
                        key, val = pair.split("=", 1)
                        weight_dict[key.strip()] = float(val.strip())
                    else:
                        raise ValueError("Mixed format not supported - use all key=value pairs")
                
                # Validate and normalize weights
                weight_sum = sum(weight_dict.values())
                if abs(weight_sum - 1.0) > 0.01:
                    if not json_mode:
                        console.print(f"[yellow]Warning: Weights sum to {weight_sum:.2f}, should sum to 1.0. Normalizing...[/yellow]")
                    weight_dict = {k: v / weight_sum for k, v in weight_dict.items()}
                
                hybrid_weights = weight_dict
            else:
                # Legacy format: 0.3,0.1,0.6 (exact,fuzzy,vector)
                weight_parts = [float(w.strip()) for w in weights.split(",")]
                if len(weight_parts) == 3:
                    weight_sum = sum(weight_parts)
                    if abs(weight_sum - 1.0) > 0.01:
                        if not json_mode:
                            console.print(f"[yellow]Warning: Weights sum to {weight_sum:.2f}, should sum to 1.0. Normalizing...[/yellow]")
                        weight_parts = [w / weight_sum for w in weight_parts]
                    hybrid_weights = {
                        "exact": weight_parts[0],
                        "fuzzy": weight_parts[1],
                        "vector": weight_parts[2],
                    }
                elif len(weight_parts) == 2:
                    # Two values: assume splade,vector
                    weight_sum = sum(weight_parts)
                    if abs(weight_sum - 1.0) > 0.01:
                        if not json_mode:
                            console.print(f"[yellow]Warning: Weights sum to {weight_sum:.2f}, should sum to 1.0. Normalizing...[/yellow]")
                        weight_parts = [w / weight_sum for w in weight_parts]
                    hybrid_weights = {
                        "splade": weight_parts[0],
                        "vector": weight_parts[1],
                    }
                else:
                    if not json_mode:
                        console.print("[yellow]Warning: Invalid weights format. Using defaults.[/yellow]")
        except ValueError as e:
            if not json_mode:
                console.print(f"[yellow]Warning: Invalid weights format ({e}). Using defaults.[/yellow]")

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        engine = ChainSearchEngine(registry, mapper, config=config)

        # Map method to SearchOptions flags
        # fts: FTS-only search (optionally with fuzzy)
        # vector: Pure vector semantic search
        # splade: SPLADE sparse neural search
        # hybrid: RRF fusion of sparse + dense
        # cascade: Two-stage binary + dense retrieval
        if actual_method == "fts":
            hybrid_mode = False
            enable_fuzzy = use_fuzzy
            enable_vector = False
            pure_vector = False
            enable_splade = False
            enable_cascade = False
        elif actual_method == "vector":
            hybrid_mode = True
            enable_fuzzy = False
            enable_vector = True
            pure_vector = True
            enable_splade = False
            enable_cascade = False
        elif actual_method == "splade":
            hybrid_mode = True
            enable_fuzzy = False
            enable_vector = False
            pure_vector = False
            enable_splade = True
            enable_cascade = False
        elif actual_method == "hybrid":
            hybrid_mode = True
            enable_fuzzy = use_fuzzy
            enable_vector = True
            pure_vector = False
            enable_splade = True  # SPLADE is preferred sparse in hybrid
            enable_cascade = False
        elif actual_method == "cascade":
            hybrid_mode = True
            enable_fuzzy = False
            enable_vector = True
            pure_vector = False
            enable_splade = False
            enable_cascade = True
        else:
            raise ValueError(f"Invalid method: {actual_method}")

        # Parse exclude_extensions from comma-separated string
        exclude_exts_list = None
        if exclude_extensions:
            exclude_exts_list = [ext.strip() for ext in exclude_extensions.split(',') if ext.strip()]

        options = SearchOptions(
            depth=depth,
            total_limit=limit,
            offset=offset,
            files_only=files_only,
            code_only=code_only,
            exclude_extensions=exclude_exts_list,
            hybrid_mode=hybrid_mode,
            enable_fuzzy=enable_fuzzy,
            enable_vector=enable_vector,
            pure_vector=pure_vector,
            enable_splade=enable_splade,
            enable_cascade=enable_cascade,
            hybrid_weights=hybrid_weights,
        )

        if files_only:
            file_paths = engine.search_files_only(query, search_path, options)
            payload = {"query": query, "count": len(file_paths), "files": file_paths}
            if json_mode:
                print_json(success=True, result=payload)
            else:
                for fp in file_paths:
                    console.print(fp)
        else:
            # Dispatch to cascade_search for cascade method
            if actual_method == "cascade":
                result = engine.cascade_search(query, search_path, k=limit, options=options, strategy=internal_cascade_strategy)
            else:
                result = engine.search(query, search_path, options)
            results_list = [
                {
                    "path": r.path,
                    "score": r.score,
                    "excerpt": r.excerpt,
                    "content": r.content,  # Full function/class body
                    "source": getattr(r, "search_source", None),
                    "symbol": getattr(r, "symbol", None),
                }
                for r in result.results
            ]

            payload = {
                "query": query,
                "method": actual_method,
                "count": len(results_list),
                "results": results_list,
                "stats": {
                    "dirs_searched": result.stats.dirs_searched,
                    "files_matched": result.stats.files_matched,
                    "time_ms": result.stats.time_ms,
                },
            }
            if json_mode:
                print_json(success=True, result=payload)
            else:
                render_search_results(result.results, verbose=verbose)
                console.print(f"[dim]Method: {actual_method} | Searched {result.stats.dirs_searched} directories in {result.stats.time_ms:.1f}ms[/dim]")

    except SearchError as exc:
        if json_mode:
            print_json(success=False, error=f"Search error: {exc}")
        else:
            console.print(f"[red]Search failed (query):[/red] {exc}")
            raise typer.Exit(code=1)
    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Search failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Search failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def symbol(
    name: str = typer.Argument(..., help="Symbol name to look up."),
    path: Path = typer.Option(Path("."), "--path", "-p", help="Directory to search from."),
    kind: Optional[str] = typer.Option(
        None,
        "--kind",
        "-k",
        help="Filter by kind (function|class|method).",
    ),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=500, help="Max symbols."),
    depth: int = typer.Option(-1, "--depth", "-d", help="Search depth (-1 = unlimited)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Look up symbols by name and optional kind."""
    _configure_logging(verbose, json_mode)
    search_path = path.expanduser().resolve()

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        engine = ChainSearchEngine(registry, mapper, config=config)
        options = SearchOptions(depth=depth, total_limit=limit)

        syms = engine.search_symbols(name, search_path, kind=kind, options=options)

        payload = {"name": name, "kind": kind, "count": len(syms), "symbols": syms}
        if json_mode:
            print_json(success=True, result=payload)
        else:
            render_symbols(syms)

    except SearchError as exc:
        if json_mode:
            print_json(success=False, error=f"Search error: {exc}")
        else:
            console.print(f"[red]Symbol lookup failed (search):[/red] {exc}")
            raise typer.Exit(code=1)
    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Symbol lookup failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Symbol lookup failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def inspect(
    file: Path = typer.Argument(..., exists=True, dir_okay=False, help="File to analyze."),
    symbols: bool = typer.Option(True, "--symbols/--no-symbols", help="Show discovered symbols."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Analyze a single file and display symbols."""
    _configure_logging(verbose, json_mode)
    config = Config()
    factory = ParserFactory(config)

    file_path = file.expanduser().resolve()
    try:
        text = file_path.read_text(encoding="utf-8", errors="ignore")
        language_id = config.language_for_path(file_path) or "unknown"
        parser = factory.get_parser(language_id)
        indexed = parser.parse(text, file_path)
        payload = {"file": indexed, "content_lines": len(text.splitlines())}
        if json_mode:
            print_json(success=True, result=payload)
        else:
            if symbols:
                render_file_inspect(indexed.path, indexed.language, indexed.symbols)
            else:
                render_status({"file": indexed.path, "language": indexed.language})
    except ParseError as exc:
        if json_mode:
            print_json(success=False, error=f"Parse error: {exc}")
        else:
            console.print(f"[red]Inspect failed (parse):[/red] {exc}")
            raise typer.Exit(code=1)
    except FileNotFoundError as exc:
        if json_mode:
            print_json(success=False, error=f"File not found: {exc}")
        else:
            console.print(f"[red]Inspect failed (file not found):[/red] {exc}")
            raise typer.Exit(code=1)
    except PermissionError as exc:
        if json_mode:
            print_json(success=False, error=f"Permission denied: {exc}")
        else:
            console.print(f"[red]Inspect failed (permission denied):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Inspect failed:[/red] {exc}")
            raise typer.Exit(code=1)


@app.command()
def status(
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Show index status and configuration."""
    _configure_logging(verbose, json_mode)

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        # Get all projects
        projects = registry.list_projects()

        # Calculate total stats
        total_files = sum(p.total_files for p in projects)
        total_dirs = sum(p.total_dirs for p in projects)

        # Get index root size
        index_root = mapper.index_root
        index_size = 0
        if index_root.exists():
            for f in index_root.rglob("*"):
                if f.is_file():
                    index_size += f.stat().st_size

        # Check schema version and enabled features
        schema_version = None
        has_dual_fts = False
        if projects and index_root.exists():
            # Check first index database for features
            index_files = list(index_root.rglob("_index.db"))
            if index_files:
                try:
                    with DirIndexStore(index_files[0]) as store:
                        with store._lock:
                            conn = store._get_connection()
                            schema_version = store._get_schema_version(conn)
                            # Check if dual FTS tables exist
                            cursor = conn.execute(
                                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('files_fts_exact', 'files_fts_fuzzy')"
                            )
                            fts_tables = [row[0] for row in cursor.fetchall()]
                            has_dual_fts = len(fts_tables) == 2
                except Exception:
                    pass

        # Check embeddings coverage
        embeddings_info = None
        has_vector_search = False
        try:
            from codexlens.cli.embedding_manager import get_embeddings_status
            
            if index_root.exists():
                embed_status = get_embeddings_status(index_root)
                if embed_status["success"]:
                    embeddings_info = embed_status["result"]
                    # Enable vector search if coverage >= 50%
                    has_vector_search = embeddings_info["coverage_percent"] >= 50.0
        except ImportError:
            # Embedding manager not available
            pass
        except Exception as e:
            logging.debug(f"Failed to get embeddings status: {e}")

        stats = {
            "index_root": str(index_root),
            "registry_path": str(_get_registry_path()),
            "projects_count": len(projects),
            "total_files": total_files,
            "total_dirs": total_dirs,
            "index_size_bytes": index_size,
            "index_size_mb": round(index_size / (1024 * 1024), 2),
            "schema_version": schema_version,
            "features": {
                "exact_fts": True,  # Always available
                "fuzzy_fts": has_dual_fts,
                "hybrid_search": has_dual_fts,
                "vector_search": has_vector_search,
            },
        }
        
        # Add embeddings info if available
        if embeddings_info:
            stats["embeddings"] = embeddings_info

        if json_mode:
            print_json(success=True, result=stats)
        else:
            console.print("[bold]CodexLens Status[/bold]")
            console.print(f"  Index Root: {stats['index_root']}")
            console.print(f"  Registry: {stats['registry_path']}")
            console.print(f"  Projects: {stats['projects_count']}")
            console.print(f"  Total Files: {stats['total_files']}")
            console.print(f"  Total Directories: {stats['total_dirs']}")
            console.print(f"  Index Size: {stats['index_size_mb']} MB")
            if schema_version:
                console.print(f"  Schema Version: {schema_version}")
            console.print("\n[bold]Search Backends:[/bold]")
            console.print(f"  Exact FTS: ✓ (unicode61)")
            if has_dual_fts:
                console.print(f"  Fuzzy FTS: ✓ (trigram)")
                console.print(f"  Hybrid Search: ✓ (RRF fusion)")
            else:
                console.print(f"  Fuzzy FTS: ✗ (run 'migrate' to enable)")
                console.print(f"  Hybrid Search: ✗ (run 'migrate' to enable)")
            
            if has_vector_search:
                console.print(f"  Vector Search: ✓ (embeddings available)")
            else:
                console.print(f"  Vector Search: ✗ (no embeddings or coverage < 50%)")
            
            # Display embeddings statistics if available
            if embeddings_info:
                console.print("\n[bold]Embeddings Coverage:[/bold]")
                console.print(f"  Total Indexes: {embeddings_info['total_indexes']}")
                console.print(f"  Total Files: {embeddings_info['total_files']}")
                console.print(f"  Files with Embeddings: {embeddings_info['files_with_embeddings']}")
                console.print(f"  Coverage: {embeddings_info['coverage_percent']:.1f}%")
                console.print(f"  Total Chunks: {embeddings_info['total_chunks']}")

                # Display model information if available
                model_info = embeddings_info.get('model_info')
                if model_info:
                    console.print("\n[bold]Embedding Model:[/bold]")
                    console.print(f"  Backend: [cyan]{model_info.get('backend', 'unknown')}[/cyan]")
                    console.print(f"  Model: [cyan]{model_info.get('model_profile', 'unknown')}[/cyan] ({model_info.get('model_name', '')})")
                    console.print(f"  Dimensions: {model_info.get('embedding_dim', 'unknown')}")
                    if model_info.get('updated_at'):
                        console.print(f"  Last Updated: {model_info['updated_at']}")

    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Status failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Status failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def projects(
    action: str = typer.Argument("list", help="Action: list, show, remove"),
    project_path: Optional[Path] = typer.Argument(None, help="Project path (for show/remove)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Manage registered projects in the global registry.

    Actions:
    - list: Show all registered projects
    - show <path>: Show details for a specific project
    - remove <path>: Remove a project from the registry
    """
    _configure_logging(verbose, json_mode)

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()

        if action == "list":
            project_list = registry.list_projects()
            if json_mode:
                result = [
                    {
                        "id": p.id,
                        "source_root": str(p.source_root),
                        "index_root": str(p.index_root),
                        "total_files": p.total_files,
                        "total_dirs": p.total_dirs,
                        "status": p.status,
                    }
                    for p in project_list
                ]
                print_json(success=True, result=result)
            else:
                if not project_list:
                    console.print("[yellow]No projects registered.[/yellow]")
                else:
                    table = Table(title="Registered Projects")
                    table.add_column("ID", style="dim")
                    table.add_column("Source Root")
                    table.add_column("Files", justify="right")
                    table.add_column("Dirs", justify="right")
                    table.add_column("Status")

                    for p in project_list:
                        table.add_row(
                            str(p.id),
                            str(p.source_root),
                            str(p.total_files),
                            str(p.total_dirs),
                            p.status,
                        )
                    console.print(table)

        elif action == "show":
            if not project_path:
                raise typer.BadParameter("Project path required for 'show' action")

            project_path = project_path.expanduser().resolve()
            project_info = registry.get_project(project_path)

            if not project_info:
                if json_mode:
                    print_json(success=False, error=f"Project not found: {project_path}")
                else:
                    console.print(f"[red]Project not found:[/red] {project_path}")
                raise typer.Exit(code=1)

            if json_mode:
                result = {
                    "id": project_info.id,
                    "source_root": str(project_info.source_root),
                    "index_root": str(project_info.index_root),
                    "total_files": project_info.total_files,
                    "total_dirs": project_info.total_dirs,
                    "status": project_info.status,
                    "created_at": project_info.created_at,
                    "last_indexed": project_info.last_indexed,
                }
                print_json(success=True, result=result)
            else:
                console.print(f"[bold]Project:[/bold] {project_info.source_root}")
                console.print(f"  ID: {project_info.id}")
                console.print(f"  Index Root: {project_info.index_root}")
                console.print(f"  Files: {project_info.total_files}")
                console.print(f"  Directories: {project_info.total_dirs}")
                console.print(f"  Status: {project_info.status}")

                # Show directory breakdown
                dirs = registry.get_project_dirs(project_info.id)
                if dirs:
                    console.print(f"\n  [bold]Indexed Directories:[/bold] {len(dirs)}")
                    for d in dirs[:10]:
                        console.print(f"    - {d.source_path.name}/ ({d.files_count} files)")
                    if len(dirs) > 10:
                        console.print(f"    ... and {len(dirs) - 10} more")

        elif action == "remove":
            if not project_path:
                raise typer.BadParameter("Project path required for 'remove' action")

            project_path = project_path.expanduser().resolve()
            removed = registry.unregister_project(project_path)

            if removed:
                mapper = PathMapper()
                index_root = mapper.source_to_index_dir(project_path)
                if index_root.exists():
                    shutil.rmtree(index_root)

                if json_mode:
                    print_json(success=True, result={"removed": str(project_path)})
                else:
                    console.print(f"[green]Removed:[/green] {project_path}")
            else:
                if json_mode:
                    print_json(success=False, error=f"Project not found: {project_path}")
                else:
                    console.print(f"[yellow]Project not found:[/yellow] {project_path}")

        else:
            raise typer.BadParameter(f"Unknown action: {action}. Use list, show, or remove.")

    except typer.BadParameter:
        raise
    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Projects command failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except PermissionError as exc:
        if json_mode:
            print_json(success=False, error=f"Permission denied: {exc}")
        else:
            console.print(f"[red]Projects command failed (permission denied):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Projects command failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def config(
    action: str = typer.Argument("show", help="Action: show, set, migrate"),
    key: Optional[str] = typer.Argument(None, help="Config key (for set action)."),
    value: Optional[str] = typer.Argument(None, help="Config value (for set action)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Manage CodexLens configuration.

    Actions:
    - show: Display current configuration
    - set <key> <value>: Set configuration value
    - migrate <new_path>: Migrate indexes to new location

    Config keys:
    - index_dir: Directory to store indexes (default: ~/.codexlens/indexes)
    - reranker_backend: Reranker backend (onnx, api, litellm, legacy)
    - reranker_model: Reranker model name
    - reranker_enabled: Enable reranking (true/false)
    - reranker_top_k: Number of results to rerank
    - reranker_api_provider: API provider for reranker (siliconflow, cohere, jina)
    - embedding_backend: Embedding backend (fastembed, litellm)
    - embedding_model: Embedding model profile or name
    """
    _configure_logging(verbose, json_mode)

    config_file = Path.home() / ".codexlens" / "config.json"

    def load_config() -> Dict[str, Any]:
        if config_file.exists():
            return json.loads(config_file.read_text(encoding="utf-8"))
        return {}

    def save_config(cfg: Dict[str, Any]) -> None:
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    try:
        if action == "show":
            cfg = load_config()
            current_index_dir = os.getenv("CODEXLENS_INDEX_DIR") or cfg.get("index_dir") or str(Path.home() / ".codexlens" / "indexes")

            result = {
                "config_file": str(config_file),
                "index_dir": current_index_dir,
                "env_override": os.getenv("CODEXLENS_INDEX_DIR"),
            }

            # Load settings.json for reranker and other runtime settings
            settings_file = Path.home() / ".codexlens" / "settings.json"
            if settings_file.exists():
                try:
                    settings = json.loads(settings_file.read_text(encoding="utf-8"))
                    # Extract reranker settings (flat keys for CCW compatibility)
                    reranker = settings.get("reranker", {})
                    if reranker.get("backend"):
                        result["reranker_backend"] = reranker["backend"]
                    if reranker.get("model"):
                        result["reranker_model"] = reranker["model"]
                    if reranker.get("enabled") is not None:
                        result["reranker_enabled"] = reranker["enabled"]
                    if reranker.get("top_k"):
                        result["reranker_top_k"] = reranker["top_k"]
                    if reranker.get("api_provider"):
                        result["reranker_api_provider"] = reranker["api_provider"]
                    # Extract embedding settings
                    embedding = settings.get("embedding", {})
                    if embedding.get("backend"):
                        result["embedding_backend"] = embedding["backend"]
                    if embedding.get("model"):
                        result["embedding_model"] = embedding["model"]
                except (json.JSONDecodeError, OSError):
                    pass  # Settings file not readable, continue with defaults

            # Load .env overrides from global ~/.codexlens/.env
            env_overrides: Dict[str, str] = {}
            try:
                from codexlens.env_config import load_global_env
                env_overrides = load_global_env()
            except ImportError:
                pass

            # Apply .env overrides (highest priority) and track them
            if env_overrides.get("EMBEDDING_MODEL"):
                result["embedding_model"] = env_overrides["EMBEDDING_MODEL"]
                result["embedding_model_source"] = ".env"
            if env_overrides.get("EMBEDDING_BACKEND"):
                result["embedding_backend"] = env_overrides["EMBEDDING_BACKEND"]
                result["embedding_backend_source"] = ".env"
            if env_overrides.get("RERANKER_MODEL"):
                result["reranker_model"] = env_overrides["RERANKER_MODEL"]
                result["reranker_model_source"] = ".env"
            if env_overrides.get("RERANKER_BACKEND"):
                result["reranker_backend"] = env_overrides["RERANKER_BACKEND"]
                result["reranker_backend_source"] = ".env"
            if env_overrides.get("RERANKER_ENABLED"):
                result["reranker_enabled"] = env_overrides["RERANKER_ENABLED"].lower() in ("true", "1", "yes", "on")
                result["reranker_enabled_source"] = ".env"
            if env_overrides.get("RERANKER_PROVIDER") or os.getenv("RERANKER_PROVIDER"):
                result["reranker_api_provider"] = env_overrides.get("RERANKER_PROVIDER") or os.getenv("RERANKER_PROVIDER")

            if json_mode:
                print_json(success=True, result=result)
            else:
                console.print("[bold]CodexLens Configuration[/bold]")
                console.print(f"  Config File: {result['config_file']}")
                console.print(f"  Index Directory: {result['index_dir']}")
                if result['env_override']:
                    console.print(f"  [dim](Override via CODEXLENS_INDEX_DIR)[/dim]")

                # Show embedding settings
                console.print(f"\n[bold]Embedding[/bold]")
                backend = result.get('embedding_backend', 'fastembed')
                backend_source = result.get('embedding_backend_source', 'settings.json')
                console.print(f"  Backend: {backend} [dim]({backend_source})[/dim]")
                model = result.get('embedding_model', 'code')
                model_source = result.get('embedding_model_source', 'settings.json')
                console.print(f"  Model: {model} [dim]({model_source})[/dim]")

                # Show reranker settings
                console.print(f"\n[bold]Reranker[/bold]")
                backend = result.get('reranker_backend', 'fastembed')
                backend_source = result.get('reranker_backend_source', 'settings.json')
                console.print(f"  Backend: {backend} [dim]({backend_source})[/dim]")
                model = result.get('reranker_model', 'N/A')
                model_source = result.get('reranker_model_source', 'settings.json')
                console.print(f"  Model: {model} [dim]({model_source})[/dim]")
                enabled = result.get('reranker_enabled', False)
                enabled_source = result.get('reranker_enabled_source', 'settings.json')
                console.print(f"  Enabled: {enabled} [dim]({enabled_source})[/dim]")

        elif action == "set":
            if not key:
                raise typer.BadParameter("Config key required for 'set' action")
            if not value:
                raise typer.BadParameter("Config value required for 'set' action")

            cfg = load_config()

            if key == "index_dir":
                new_path = Path(value).expanduser().resolve()
                cfg["index_dir"] = str(new_path)
                save_config(cfg)

                if json_mode:
                    print_json(success=True, result={"key": key, "value": str(new_path)})
                else:
                    console.print(f"[green]Set {key}=[/green] {new_path}")
                    console.print("[yellow]Note: Existing indexes remain at old location. Use 'config migrate' to move them.[/yellow]")

            # Handle reranker and embedding settings (stored in settings.json)
            elif key in ("reranker_backend", "reranker_model", "reranker_enabled", "reranker_top_k",
                         "embedding_backend", "embedding_model", "reranker_api_provider"):
                settings_file = Path.home() / ".codexlens" / "settings.json"
                settings_file.parent.mkdir(parents=True, exist_ok=True)

                # Load existing settings
                settings: Dict[str, Any] = {}
                if settings_file.exists():
                    try:
                        settings = json.loads(settings_file.read_text(encoding="utf-8"))
                    except (json.JSONDecodeError, OSError):
                        pass

                # Ensure nested structures exist
                if "reranker" not in settings:
                    settings["reranker"] = {}
                if "embedding" not in settings:
                    settings["embedding"] = {}

                # Map flat keys to nested structure
                if key == "reranker_backend":
                    settings["reranker"]["backend"] = value
                elif key == "reranker_model":
                    settings["reranker"]["model"] = value
                elif key == "reranker_enabled":
                    settings["reranker"]["enabled"] = value.lower() in ("true", "1", "yes")
                elif key == "reranker_top_k":
                    settings["reranker"]["top_k"] = int(value)
                elif key == "reranker_api_provider":
                    settings["reranker"]["api_provider"] = value
                elif key == "embedding_backend":
                    settings["embedding"]["backend"] = value
                elif key == "embedding_model":
                    settings["embedding"]["model"] = value

                # Save settings
                settings_file.write_text(json.dumps(settings, indent=2), encoding="utf-8")

                if json_mode:
                    print_json(success=True, result={"key": key, "value": value})
                else:
                    console.print(f"[green]Set {key}=[/green] {value}")
            else:
                raise typer.BadParameter(f"Unknown config key: {key}")

        elif action == "migrate":
            if not key:
                raise typer.BadParameter("New path required for 'migrate' action")

            new_path = Path(key).expanduser().resolve()
            mapper = PathMapper()
            old_path = mapper.index_root

            if not old_path.exists():
                if json_mode:
                    print_json(success=False, error="No indexes to migrate")
                else:
                    console.print("[yellow]No indexes to migrate.[/yellow]")
                return

            # Create new directory
            new_path.mkdir(parents=True, exist_ok=True)

            # Count items to migrate
            items = list(old_path.iterdir())
            migrated = 0

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TextColumn("{task.completed}/{task.total}"),
                TimeElapsedColumn(),
                console=console,
            ) as progress:
                task = progress.add_task("Migrating indexes", total=len(items))

                for item in items:
                    dest = new_path / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest)
                    migrated += 1
                    progress.advance(task)

            # Update config
            cfg = load_config()
            cfg["index_dir"] = str(new_path)
            save_config(cfg)

            # Update registry paths
            registry = RegistryStore()
            registry.initialize()
            registry.update_index_paths(old_path, new_path)
            registry.close()

            result = {
                "migrated_from": str(old_path),
                "migrated_to": str(new_path),
                "items_migrated": migrated,
            }

            if json_mode:
                print_json(success=True, result=result)
            else:
                console.print(f"[green]Migrated {migrated} items to:[/green] {new_path}")
                console.print("[dim]Old indexes can be manually deleted after verifying migration.[/dim]")

        else:
            raise typer.BadParameter(f"Unknown action: {action}. Use show, set, or migrate.")

    except typer.BadParameter:
        raise
    except ConfigError as exc:
        if json_mode:
            print_json(success=False, error=f"Configuration error: {exc}")
        else:
            console.print(f"[red]Config command failed (config):[/red] {exc}")
            raise typer.Exit(code=1)
    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Config command failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except PermissionError as exc:
        if json_mode:
            print_json(success=False, error=f"Permission denied: {exc}")
        else:
            console.print(f"[red]Config command failed (permission denied):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Config command failed:[/red] {exc}")
            raise typer.Exit(code=1)


@app.command()
def migrate(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to migrate."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Migrate project indexes to latest schema (Dual-FTS upgrade).

    Upgrades all _index.db files in the project to schema version 4, which includes:
    - Dual FTS tables (exact + fuzzy)
    - Encoding detection support
    - Incremental indexing metadata

    This is a safe operation that preserves all existing data.
    Progress is shown during migration.
    """
    _configure_logging(verbose, json_mode)
    base_path = path.expanduser().resolve()

    registry: RegistryStore | None = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        # Find project
        project_info = registry.get_project(base_path)
        if not project_info:
            raise CodexLensError(f"No index found for: {base_path}. Run 'codex-lens init' first.")

        index_dir = mapper.source_to_index_dir(base_path)
        if not index_dir.exists():
            raise CodexLensError(f"Index directory not found: {index_dir}")

        # Find all _index.db files
        index_files = list(index_dir.rglob("_index.db"))

        if not index_files:
            if json_mode:
                print_json(success=True, result={"message": "No indexes to migrate", "migrated": 0})
            else:
                console.print("[yellow]No indexes found to migrate.[/yellow]")
            return

        migrated_count = 0
        error_count = 0
        already_migrated = 0

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TextColumn("({task.completed}/{task.total})"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(f"Migrating {len(index_files)} indexes...", total=len(index_files))

            for db_path in index_files:
                try:
                    store = DirIndexStore(db_path)

                    # Check current version
                    with store._lock:
                        conn = store._get_connection()
                        current_version = store._get_schema_version(conn)

                        if current_version >= DirIndexStore.SCHEMA_VERSION:
                            already_migrated += 1
                            if verbose:
                                progress.console.print(f"[dim]Already migrated: {db_path.parent.name}[/dim]")
                        elif current_version > 0:
                            # Apply migrations
                            store._apply_migrations(conn, current_version)
                            store._set_schema_version(conn, DirIndexStore.SCHEMA_VERSION)
                            conn.commit()
                            migrated_count += 1
                            if verbose:
                                progress.console.print(f"[green]Migrated: {db_path.parent.name} (v{current_version} → v{DirIndexStore.SCHEMA_VERSION})[/green]")
                        else:
                            # New database, initialize directly
                            store.initialize()
                            migrated_count += 1

                    store.close()

                except Exception as e:
                    error_count += 1
                    if verbose:
                        progress.console.print(f"[red]Error migrating {db_path}: {e}[/red]")

                progress.update(task, advance=1)

        result = {
            "path": str(base_path),
            "total_indexes": len(index_files),
            "migrated": migrated_count,
            "already_migrated": already_migrated,
            "errors": error_count,
        }

        if json_mode:
            print_json(success=True, result=result)
        else:
            console.print(f"[green]Migration complete:[/green]")
            console.print(f"  Total indexes: {len(index_files)}")
            console.print(f"  Migrated: {migrated_count}")
            console.print(f"  Already up-to-date: {already_migrated}")
            if error_count > 0:
                console.print(f"  [yellow]Errors: {error_count}[/yellow]")

    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Migration failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Migration failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


@app.command()
def clean(
    path: Optional[Path] = typer.Argument(None, help="Project path to clean (removes project index)."),
    all_indexes: bool = typer.Option(False, "--all", "-a", help="Remove all indexes."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Remove CodexLens index data.

    Without arguments, shows current index size.
    With path, removes that project's indexes.
    With --all, removes all indexes (use with caution).
    """
    _configure_logging(verbose, json_mode)

    try:
        mapper = PathMapper()
        index_root = mapper.index_root

        if all_indexes:
            # Remove everything
            if not index_root.exists():
                if json_mode:
                    print_json(success=True, result={"cleaned": None, "message": "No indexes to clean"})
                else:
                    console.print("[yellow]No indexes to clean.[/yellow]")
                return

            # Calculate size before removal
            total_size = 0
            for f in index_root.rglob("*"):
                if f.is_file():
                    total_size += f.stat().st_size

            # Remove registry first
            registry_path = _get_registry_path()
            if registry_path.exists():
                registry_path.unlink()

            # Remove all indexes
            shutil.rmtree(index_root)

            result = {
                "cleaned": str(index_root),
                "size_freed_mb": round(total_size / (1024 * 1024), 2),
            }

            if json_mode:
                print_json(success=True, result=result)
            else:
                console.print(f"[green]Removed all indexes:[/green] {result['size_freed_mb']} MB freed")

        elif path:
            # Remove specific project
            project_path = path.expanduser().resolve()
            project_index = mapper.source_to_index_dir(project_path)

            if not project_index.exists():
                if json_mode:
                    print_json(success=False, error=f"No index found for: {project_path}")
                else:
                    console.print(f"[yellow]No index found for:[/yellow] {project_path}")
                return

            # Calculate size
            total_size = 0
            for f in project_index.rglob("*"):
                if f.is_file():
                    total_size += f.stat().st_size

            # Remove from registry
            registry = RegistryStore()
            registry.initialize()
            registry.unregister_project(project_path)
            registry.close()

            # Remove indexes
            shutil.rmtree(project_index)

            result = {
                "cleaned": str(project_path),
                "index_path": str(project_index),
                "size_freed_mb": round(total_size / (1024 * 1024), 2),
            }

            if json_mode:
                print_json(success=True, result=result)
            else:
                console.print(f"[green]Removed indexes for:[/green] {project_path}")
                console.print(f"  Freed: {result['size_freed_mb']} MB")

        else:
            # Show current status
            if not index_root.exists():
                if json_mode:
                    print_json(success=True, result={"index_root": str(index_root), "exists": False})
                else:
                    console.print("[yellow]No indexes found.[/yellow]")
                return

            total_size = 0
            for f in index_root.rglob("*"):
                if f.is_file():
                    total_size += f.stat().st_size

            registry = RegistryStore()
            registry.initialize()
            projects = registry.list_projects()
            registry.close()

            result = {
                "index_root": str(index_root),
                "projects_count": len(projects),
                "total_size_mb": round(total_size / (1024 * 1024), 2),
            }

            if json_mode:
                print_json(success=True, result=result)
            else:
                console.print("[bold]Index Status[/bold]")
                console.print(f"  Location: {result['index_root']}")
                console.print(f"  Projects: {result['projects_count']}")
                console.print(f"  Total Size: {result['total_size_mb']} MB")
                console.print("\n[dim]Use 'clean <path>' to remove a specific project or 'clean --all' to remove everything.[/dim]")

    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Clean failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except PermissionError as exc:
        if json_mode:
            print_json(success=False, error=f"Permission denied: {exc}")
        else:
            console.print(f"[red]Clean failed (permission denied):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Clean failed:[/red] {exc}")
            raise typer.Exit(code=1)


@app.command("semantic-list")
def semantic_list(
    path: Path = typer.Option(Path("."), "--path", "-p", help="Project path to list metadata from."),
    offset: int = typer.Option(0, "--offset", "-o", min=0, help="Number of records to skip."),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=100, help="Maximum records to return."),
    tool_filter: Optional[str] = typer.Option(None, "--tool", "-t", help="Filter by LLM tool (gemini/qwen)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """List semantic metadata entries for indexed files.

    Shows files that have LLM-generated summaries and keywords.
    Results are aggregated from all index databases in the project.
    """
    _configure_logging(verbose, json_mode)
    base_path = path.expanduser().resolve()

    registry: Optional[RegistryStore] = None
    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        project_info = registry.get_project(base_path)
        if not project_info:
            raise CodexLensError(f"No index found for: {base_path}. Run 'codex-lens init' first.")

        index_dir = Path(project_info.index_root)
        if not index_dir.exists():
            raise CodexLensError(f"Index directory not found: {index_dir}")

        all_results: list = []
        total_count = 0

        index_files = sorted(index_dir.rglob("_index.db"))

        for db_path in index_files:
            try:
                store = DirIndexStore(db_path)
                store.initialize()

                results, count = store.list_semantic_metadata(
                    offset=0,
                    limit=1000,
                    llm_tool=tool_filter,
                )

                source_dir = mapper.index_to_source(db_path.parent)
                for r in results:
                    r["source_dir"] = str(source_dir)

                all_results.extend(results)
                total_count += count

                store.close()
            except Exception as e:
                if verbose:
                    console.print(f"[yellow]Warning: Error reading {db_path}: {e}[/yellow]")

        all_results.sort(key=lambda x: x["generated_at"], reverse=True)
        paginated = all_results[offset : offset + limit]

        result = {
            "path": str(base_path),
            "total": total_count,
            "offset": offset,
            "limit": limit,
            "count": len(paginated),
            "entries": paginated,
        }

        if json_mode:
            print_json(success=True, result=result)
        else:
            if not paginated:
                console.print("[yellow]No semantic metadata found.[/yellow]")
                console.print("Run 'codex-lens enhance' to generate metadata for indexed files.")
            else:
                table = Table(title=f"Semantic Metadata ({total_count} total)")
                table.add_column("File", style="cyan", max_width=40)
                table.add_column("Language", style="dim")
                table.add_column("Purpose", max_width=30)
                table.add_column("Keywords", max_width=25)
                table.add_column("Tool")

                for entry in paginated:
                    keywords_str = ", ".join(entry["keywords"][:3])
                    if len(entry["keywords"]) > 3:
                        keywords_str += f" (+{len(entry['keywords']) - 3})"

                    table.add_row(
                        entry["file_name"],
                        entry["language"] or "-",
                        (entry["purpose"] or "-")[:30],
                        keywords_str or "-",
                        entry["llm_tool"] or "-",
                    )

                console.print(table)

                if total_count > len(paginated):
                    console.print(
                        f"[dim]Showing {offset + 1}-{offset + len(paginated)} of {total_count}. "
                        "Use --offset and --limit for pagination.[/dim]"
                    )

    except StorageError as exc:
        if json_mode:
            print_json(success=False, error=f"Storage error: {exc}")
        else:
            console.print(f"[red]Semantic-list failed (storage):[/red] {exc}")
            raise typer.Exit(code=1)
    except CodexLensError as exc:
        if json_mode:
            print_json(success=False, error=str(exc))
        else:
            console.print(f"[red]Semantic-list failed:[/red] {exc}")
            raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


# ==================== Model Management Commands ====================

@app.command(name="model-list")
def model_list(
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """List available embedding models and their installation status.

    Shows 4 model profiles (fast, code, multilingual, balanced) with:
    - Installation status
    - Model size and dimensions
    - Use case recommendations
    """
    try:
        from codexlens.cli.model_manager import list_models

        result = list_models()

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            models = data["models"]
            cache_dir = data["cache_dir"]
            cache_exists = data["cache_exists"]

            console.print("[bold]Available Embedding Models:[/bold]")
            console.print(f"Cache directory: [dim]{cache_dir}[/dim] {'(exists)' if cache_exists else '(not found)'}\n")

            table = Table(show_header=True, header_style="bold")
            table.add_column("Profile", style="cyan")
            table.add_column("Model Name", style="blue")
            table.add_column("Dims", justify="right")
            table.add_column("Size (MB)", justify="right")
            table.add_column("Status", justify="center")
            table.add_column("Use Case", style="dim")

            for model in models:
                status_icon = "[green]✓[/green]" if model["installed"] else "[dim]—[/dim]"
                size_display = (
                    f"{model['actual_size_mb']:.1f}" if model["installed"]
                    else f"~{model['estimated_size_mb']}"
                )
                table.add_row(
                    model["profile"],
                    model["model_name"],
                    str(model["dimensions"]),
                    size_display,
                    status_icon,
                    model["use_case"][:40] + "..." if len(model["use_case"]) > 40 else model["use_case"],
                )

            console.print(table)
            console.print("\n[dim]Use 'codexlens model-download <profile>' to download a model[/dim]")

    except ImportError:
        if json_mode:
            print_json(success=False, error="fastembed not installed. Install with: pip install codexlens[semantic]")
        else:
            console.print("[red]Error:[/red] fastembed not installed")
            console.print("[yellow]Install with:[/yellow] pip install codexlens[semantic]")
            raise typer.Exit(code=1)


@app.command(name="model-download")
def model_download(
    profile: str = typer.Argument(..., help="Model profile to download (fast, code, multilingual, balanced)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Download an embedding model by profile name.

    Example:
        codexlens model-download code  # Download code-optimized model
    """
    try:
        from codexlens.cli.model_manager import download_model

        if not json_mode:
            console.print(f"[bold]Downloading model:[/bold] {profile}")
            console.print("[dim]This may take a few minutes depending on your internet connection...[/dim]\n")

        # Create progress callback for non-JSON mode
        progress_callback = None if json_mode else lambda msg: console.print(f"[cyan]{msg}[/cyan]")

        result = download_model(profile, progress_callback=progress_callback)

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            console.print(f"[green]✓[/green] Model downloaded successfully!")
            console.print(f"  Profile: {data['profile']}")
            console.print(f"  Model: {data['model_name']}")
            console.print(f"  Cache size: {data['cache_size_mb']:.1f} MB")
            console.print(f"  Location: [dim]{data['cache_path']}[/dim]")

    except ImportError:
        if json_mode:
            print_json(success=False, error="fastembed not installed. Install with: pip install codexlens[semantic]")
        else:
            console.print("[red]Error:[/red] fastembed not installed")
            console.print("[yellow]Install with:[/yellow] pip install codexlens[semantic]")
            raise typer.Exit(code=1)


@app.command(name="model-delete")
def model_delete(
    profile: str = typer.Argument(..., help="Model profile to delete (fast, code, multilingual, balanced)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Delete a downloaded embedding model from cache.

    Example:
        codexlens model-delete fast  # Delete fast model
    """
    from codexlens.cli.model_manager import delete_model

    if not json_mode:
        console.print(f"[bold yellow]Deleting model:[/bold yellow] {profile}")

    result = delete_model(profile)

    if json_mode:
        print_json(**result)
    else:
        if not result["success"]:
            console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
            raise typer.Exit(code=1)

        data = result["result"]
        console.print(f"[green]✓[/green] Model deleted successfully!")
        console.print(f"  Profile: {data['profile']}")
        console.print(f"  Model: {data['model_name']}")
        console.print(f"  Freed space: {data['deleted_size_mb']:.1f} MB")


@app.command(name="model-info")
def model_info(
    profile: str = typer.Argument(..., help="Model profile to get info (fast, code, multilingual, balanced)."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Get detailed information about a model profile.

    Example:
        codexlens model-info code  # Get code model details
    """
    from codexlens.cli.model_manager import get_model_info

    result = get_model_info(profile)

    if json_mode:
        print_json(**result)
    else:
        if not result["success"]:
            console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
            raise typer.Exit(code=1)

        data = result["result"]
        console.print(f"[bold]Model Profile:[/bold] {data['profile']}")
        console.print(f"  Model name: {data['model_name']}")
        console.print(f"  Dimensions: {data['dimensions']}")
        console.print(f"  Status: {'[green]Installed[/green]' if data['installed'] else '[dim]Not installed[/dim]'}")
        if data['installed'] and data['actual_size_mb']:
            console.print(f"  Cache size: {data['actual_size_mb']:.1f} MB")
            console.print(f"  Location: [dim]{data['cache_path']}[/dim]")
        else:
            console.print(f"  Estimated size: ~{data['estimated_size_mb']} MB")
        console.print(f"\n  Description: {data['description']}")
        console.print(f"  Use case: {data['use_case']}")


# ==================== Reranker Model Management Commands ====================


@app.command(name="reranker-model-list")
def reranker_model_list(
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """List available reranker models and their installation status.

    Shows reranker model profiles with:
    - Installation status
    - Model size
    - Use case recommendations
    """
    try:
        from codexlens.cli.model_manager import list_reranker_models

        result = list_reranker_models()

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            models = data["models"]
            cache_dir = data["cache_dir"]
            cache_exists = data["cache_exists"]

            console.print("[bold]Available Reranker Models:[/bold]")
            console.print(f"Cache directory: [dim]{cache_dir}[/dim] {'(exists)' if cache_exists else '(not found)'}\n")

            table = Table(show_header=True, header_style="bold")
            table.add_column("Profile", style="cyan")
            table.add_column("Model", style="dim")
            table.add_column("Size", justify="right")
            table.add_column("Status")
            table.add_column("Description")

            for m in models:
                status = "[green]✓ Installed[/green]" if m["installed"] else "[dim]Not installed[/dim]"
                size = f"{m['actual_size_mb']:.1f} MB" if m["installed"] and m["actual_size_mb"] else f"~{m['estimated_size_mb']} MB"
                rec = " [yellow]★[/yellow]" if m.get("recommended") else ""
                table.add_row(m["profile"] + rec, m["model_name"], size, status, m["description"])

            console.print(table)
            console.print("\n[yellow]★[/yellow] = Recommended")

    except ImportError:
        if json_mode:
            print_json(success=False, error="fastembed reranker not available. Install with: pip install fastembed>=0.4.0")
        else:
            console.print("[red]Error:[/red] fastembed reranker not available")
            console.print("Install with: [cyan]pip install fastembed>=0.4.0[/cyan]")
        raise typer.Exit(code=1)


@app.command(name="reranker-model-download")
def reranker_model_download(
    profile: str = typer.Argument(..., help="Reranker model profile to download."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Download a reranker model by profile name.

    Example:
        codexlens reranker-model-download ms-marco-mini  # Download default reranker
    """
    try:
        from codexlens.cli.model_manager import download_reranker_model

        if not json_mode:
            console.print(f"[bold]Downloading reranker model:[/bold] {profile}")
            console.print("[dim]This may take a few minutes depending on your internet connection...[/dim]\n")

        progress_callback = None if json_mode else lambda msg: console.print(f"[cyan]{msg}[/cyan]")

        result = download_reranker_model(profile, progress_callback=progress_callback)

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            console.print(f"[green]✓[/green] Reranker model downloaded successfully!")
            console.print(f"  Profile: {data['profile']}")
            console.print(f"  Model: {data['model_name']}")
            console.print(f"  Cache size: {data['cache_size_mb']:.1f} MB")
            console.print(f"  Location: [dim]{data['cache_path']}[/dim]")

    except ImportError:
        if json_mode:
            print_json(success=False, error="fastembed reranker not available. Install with: pip install fastembed>=0.4.0")
        else:
            console.print("[red]Error:[/red] fastembed reranker not available")
            console.print("Install with: [cyan]pip install fastembed>=0.4.0[/cyan]")
        raise typer.Exit(code=1)


@app.command(name="reranker-model-delete")
def reranker_model_delete(
    profile: str = typer.Argument(..., help="Reranker model profile to delete."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Delete a downloaded reranker model from cache.

    Example:
        codexlens reranker-model-delete ms-marco-mini  # Delete reranker model
    """
    from codexlens.cli.model_manager import delete_reranker_model

    if not json_mode:
        console.print(f"[bold yellow]Deleting reranker model:[/bold yellow] {profile}")

    result = delete_reranker_model(profile)

    if json_mode:
        print_json(**result)
    else:
        if not result["success"]:
            console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
            raise typer.Exit(code=1)

        data = result["result"]
        console.print(f"[green]✓[/green] Reranker model deleted successfully!")
        console.print(f"  Profile: {data['profile']}")
        console.print(f"  Model: {data['model_name']}")
        console.print(f"  Freed space: {data['deleted_size_mb']:.1f} MB")


@app.command(name="reranker-model-info")
def reranker_model_info(
    profile: str = typer.Argument(..., help="Reranker model profile to get info."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Get detailed information about a reranker model profile.

    Example:
        codexlens reranker-model-info ms-marco-mini  # Get reranker model details
    """
    from codexlens.cli.model_manager import get_reranker_model_info

    result = get_reranker_model_info(profile)

    if json_mode:
        print_json(**result)
    else:
        if not result["success"]:
            console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
            raise typer.Exit(code=1)

        data = result["result"]
        console.print(f"[bold]Reranker Model Profile:[/bold] {data['profile']}")
        console.print(f"  Model name: {data['model_name']}")
        console.print(f"  Status: {'[green]Installed[/green]' if data['installed'] else '[dim]Not installed[/dim]'}")
        if data['installed'] and data['actual_size_mb']:
            console.print(f"  Cache size: {data['actual_size_mb']:.1f} MB")
            console.print(f"  Location: [dim]{data['cache_path']}[/dim]")
        else:
            console.print(f"  Estimated size: ~{data['estimated_size_mb']} MB")
        console.print(f"  Recommended: {'[green]Yes[/green]' if data.get('recommended') else '[dim]No[/dim]'}")
        console.print(f"\n  Description: {data['description']}")
        console.print(f"  Use case: {data['use_case']}")


# ==================== Embedding Management Commands ====================

@app.command(name="embeddings-status", hidden=True, deprecated=True)
def embeddings_status(
    path: Optional[Path] = typer.Argument(
        None,
        exists=True,
        help="Path to specific _index.db file or directory containing indexes. If not specified, uses default index root.",
    ),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """[Deprecated] Use 'codexlens index status' instead.

    Check embedding status for one or all indexes.

    Shows embedding statistics including:
    - Number of chunks generated
    - File coverage percentage
    - Files missing embeddings

    Examples:
        codexlens embeddings-status                                    # Check all indexes
        codexlens embeddings-status ~/.codexlens/indexes/project/_index.db  # Check specific index
        codexlens embeddings-status ~/projects/my-app                  # Check project (auto-finds index)
    """
    _deprecated_command_warning("embeddings-status", "index status")
    from codexlens.cli.embedding_manager import check_index_embeddings, get_embedding_stats_summary

    # Determine what to check
    if path is None:
        # Check all indexes in default root
        index_root = _get_index_root()
        result = get_embedding_stats_summary(index_root)

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            total = data["total_indexes"]
            with_emb = data["indexes_with_embeddings"]
            total_chunks = data["total_chunks"]

            console.print(f"[bold]Embedding Status Summary[/bold]")
            console.print(f"Index root: [dim]{index_root}[/dim]\n")
            console.print(f"Total indexes: {total}")
            console.print(f"Indexes with embeddings: [{'green' if with_emb > 0 else 'yellow'}]{with_emb}[/]/{total}")
            console.print(f"Total chunks: {total_chunks:,}\n")

            if data["indexes"]:
                table = Table(show_header=True, header_style="bold")
                table.add_column("Project", style="cyan")
                table.add_column("Files", justify="right")
                table.add_column("Chunks", justify="right")
                table.add_column("Coverage", justify="right")
                table.add_column("Status", justify="center")

                for idx_stat in data["indexes"]:
                    status_icon = "[green]✓[/green]" if idx_stat["has_embeddings"] else "[dim]—[/dim]"
                    coverage = f"{idx_stat['coverage_percent']:.1f}%" if idx_stat["has_embeddings"] else "—"

                    table.add_row(
                        idx_stat["project"],
                        str(idx_stat["total_files"]),
                        f"{idx_stat['total_chunks']:,}" if idx_stat["has_embeddings"] else "0",
                        coverage,
                        status_icon,
                    )

                console.print(table)

    else:
        # Check specific index or find index for project
        target_path = path.expanduser().resolve()

        if target_path.is_file() and target_path.name == "_index.db":
            # Direct index file
            index_path = target_path
        elif target_path.is_dir():
            # Try to find index for this project
            registry = RegistryStore()
            try:
                registry.initialize()
                mapper = PathMapper()
                index_path = mapper.source_to_index_db(target_path)

                if not index_path.exists():
                    console.print(f"[red]Error:[/red] No index found for {target_path}")
                    console.print("Run 'codexlens init' first to create an index")
                    raise typer.Exit(code=1)
            finally:
                registry.close()
        else:
            console.print(f"[red]Error:[/red] Path must be _index.db file or directory")
            raise typer.Exit(code=1)

        result = check_index_embeddings(index_path)

        if json_mode:
            print_json(**result)
        else:
            if not result["success"]:
                console.print(f"[red]Error:[/red] {result.get('error', 'Unknown error')}")
                raise typer.Exit(code=1)

            data = result["result"]
            has_emb = data["has_embeddings"]

            console.print(f"[bold]Embedding Status[/bold]")
            console.print(f"Index: [dim]{data['index_path']}[/dim]\n")

            if has_emb:
                console.print(f"[green]✓[/green] Embeddings available")
                console.print(f"  Total chunks: {data['total_chunks']:,}")
                console.print(f"  Total files: {data['total_files']:,}")
                console.print(f"  Files with embeddings: {data['files_with_chunks']:,}/{data['total_files']}")
                console.print(f"  Coverage: {data['coverage_percent']:.1f}%")

                if data["files_without_chunks"] > 0:
                    console.print(f"\n[yellow]Warning:[/yellow] {data['files_without_chunks']} files missing embeddings")
                    if data["missing_files_sample"]:
                        console.print("  Sample missing files:")
                        for file in data["missing_files_sample"]:
                            console.print(f"    [dim]{file}[/dim]")
            else:
                console.print(f"[yellow]—[/yellow] No embeddings found")
                console.print(f"  Total files indexed: {data['total_files']:,}")
                console.print("\n[dim]Generate embeddings with:[/dim]")
                console.print(f"  [cyan]codexlens embeddings-generate {index_path}[/cyan]")


@index_app.command("embeddings")
def index_embeddings(
    path: Path = typer.Argument(
        ...,
        exists=True,
        help="Path to _index.db file or project directory.",
    ),
    backend: str = typer.Option(
        "fastembed",
        "--backend",
        "-b",
        help="Embedding backend: fastembed (local) or litellm (remote API).",
    ),
    model: str = typer.Option(
        "code",
        "--model",
        "-m",
        help="Model: profile name for fastembed (fast/code/multilingual/balanced) or model name for litellm (e.g. text-embedding-3-small).",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Force regeneration even if embeddings exist.",
    ),
    chunk_size: int = typer.Option(
        2000,
        "--chunk-size",
        help="Maximum chunk size in characters.",
    ),
    max_workers: int = typer.Option(
        1,
        "--max-workers",
        "-w",
        min=1,
        help="Max concurrent API calls. Recommended: 4-8 for litellm backend. Default: 1 (sequential).",
    ),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
    centralized: bool = typer.Option(
        True,
        "--centralized/--distributed",
        "-c/-d",
        help="Use centralized vector storage (default) or distributed per-directory indexes.",
    ),
) -> None:
    """Generate semantic embeddings for code search.

    Creates vector embeddings for all files in an index to enable
    semantic search capabilities. Embeddings are stored in the same
    database as the FTS index.

    Storage Modes:
      - Default: Per-directory HNSW indexes alongside _index.db files
      - Centralized: Single HNSW index at project root (_vectors.hnsw)

    Embedding Backend Options:
      - fastembed: Local ONNX-based embeddings (default, no API calls)
      - litellm: Remote API embeddings via ccw-litellm (requires API keys)

    Model Options:
      For fastembed backend (profiles):
        - fast: BAAI/bge-small-en-v1.5 (384 dims, ~80MB)
        - code: jinaai/jina-embeddings-v2-base-code (768 dims, ~150MB) [recommended]
        - multilingual: intfloat/multilingual-e5-large (1024 dims, ~1GB)
        - balanced: mixedbread-ai/mxbai-embed-large-v1 (1024 dims, ~600MB)

      For litellm backend (model names):
        - text-embedding-3-small, text-embedding-3-large (OpenAI)
        - text-embedding-ada-002 (OpenAI legacy)
        - Any model supported by ccw-litellm

    Examples:
        codexlens index embeddings ~/projects/my-app              # Auto-find index (fastembed, code profile)
        codexlens index embeddings ~/.codexlens/indexes/project/_index.db  # Specific index
        codexlens index embeddings ~/projects/my-app --backend litellm --model text-embedding-3-small  # Use LiteLLM
        codexlens index embeddings ~/projects/my-app --model fast --force  # Regenerate with fast profile
        codexlens index embeddings ~/projects/my-app --centralized  # Centralized vector storage
    """
    _configure_logging(verbose, json_mode)

    from codexlens.cli.embedding_manager import (
        generate_embeddings,
        generate_dense_embeddings_centralized,
        scan_for_model_conflicts,
        check_global_model_lock,
        set_locked_model_config,
    )

    # Validate backend
    valid_backends = ["fastembed", "litellm"]
    if backend not in valid_backends:
        error_msg = f"Invalid backend: {backend}. Must be one of: {', '.join(valid_backends)}"
        if json_mode:
            print_json(success=False, error=error_msg)
        else:
            console.print(f"[red]Error:[/red] {error_msg}")
            console.print(f"[dim]Valid backends: {', '.join(valid_backends)}[/dim]")
        raise typer.Exit(code=1)

    # Resolve path
    target_path = path.expanduser().resolve()

    # Determine index path or root for centralized mode
    index_path = None
    index_root = None

    if target_path.is_file() and target_path.name == "_index.db":
        # Direct index file
        index_path = target_path
        index_root = target_path.parent
    elif target_path.is_dir():
        # Directory: Find index location from registry
        registry = RegistryStore()
        try:
            registry.initialize()
            mapper = PathMapper()
            index_path = mapper.source_to_index_db(target_path)

            if not index_path.exists():
                console.print(f"[red]Error:[/red] No index found for {target_path}")
                console.print("Run 'codexlens init' first to create an index")
                raise typer.Exit(code=1)
            index_root = index_path.parent  # Use index directory for both modes
        finally:
            registry.close()
    else:
        console.print(f"[red]Error:[/red] Path must be _index.db file or directory")
        raise typer.Exit(code=1)

    # Progress callback
    def progress_update(msg: str):
        if not json_mode and verbose:
            console.print(f"  {msg}")

    console.print(f"[bold]Generating embeddings[/bold]")
    if centralized:
        effective_root = index_root if index_root else (index_path.parent if index_path else target_path)
        console.print(f"Index root: [dim]{effective_root}[/dim]")
        console.print(f"Mode: [green]Centralized[/green]")
    else:
        console.print(f"Index: [dim]{index_path}[/dim]")
    console.print(f"Backend: [cyan]{backend}[/cyan]")
    console.print(f"Model: [cyan]{model}[/cyan]")
    if max_workers > 1:
        console.print(f"Concurrency: [cyan]{max_workers} workers[/cyan]")
    console.print()

    # Check global model lock (prevents mixing different models)
    if not force:
        lock_result = check_global_model_lock(backend, model)
        if lock_result["has_conflict"]:
            locked = lock_result["locked_config"]
            if json_mode:
                print_json(
                    success=False,
                    error="Global model lock conflict",
                    code="MODEL_LOCKED",
                    locked_config=locked,
                    target_config=lock_result["target_config"],
                    hint="Use --force to override the lock and switch to a different model (will regenerate all embeddings)",
                )
                raise typer.Exit(code=1)
            else:
                console.print("[red]⛔ Global Model Lock Active[/red]")
                console.print(f"  Locked model: [cyan]{locked['backend']}/{locked['model']}[/cyan]")
                console.print(f"  Requested: [yellow]{backend}/{model}[/yellow]")
                console.print(f"  Locked at: {locked.get('locked_at', 'unknown')}")
                console.print()
                console.print("[dim]All indexes must use the same embedding model.[/dim]")
                console.print("[dim]Use --force to switch models (will regenerate all embeddings).[/dim]")
                raise typer.Exit(code=1)

    # Pre-check for model conflicts (only if not forcing)
    if not force:
        # Determine the index root for conflict scanning
        scan_root = index_root if index_root else (index_path.parent if index_path else None)

        if scan_root:
            conflict_result = scan_for_model_conflicts(scan_root, backend, model)

            if conflict_result["has_conflict"]:
                existing = conflict_result["existing_config"]
                conflict_count = len(conflict_result["conflicts"])

                if json_mode:
                    # JSON mode: return structured error for UI handling
                    print_json(
                        success=False,
                        error="Model conflict detected",
                        code="MODEL_CONFLICT",
                        existing_config=existing,
                        target_config=conflict_result["target_config"],
                        conflict_count=conflict_count,
                        conflicts=conflict_result["conflicts"][:5],  # Show first 5 conflicts
                        hint="Use --force to overwrite existing embeddings with the new model",
                    )
                    raise typer.Exit(code=1)
                else:
                    # Interactive mode: show warning and ask for confirmation
                    console.print("[yellow]⚠ Model Conflict Detected[/yellow]")
                    console.print(f"  Existing: [red]{existing['backend']}/{existing['model']}[/red] ({existing.get('embedding_dim', '?')} dim)")
                    console.print(f"  Requested: [green]{backend}/{model}[/green]")
                    console.print(f"  Affected indexes: [yellow]{conflict_count}[/yellow]")
                    console.print()
                    console.print("[dim]Mixing different embedding models in the same index is not supported.[/dim]")
                    console.print("[dim]Overwriting will delete all existing embeddings and regenerate with the new model.[/dim]")
                    console.print()

                    # Ask for confirmation
                    if typer.confirm("Overwrite existing embeddings with the new model?", default=False):
                        force = True
                        console.print("[green]Confirmed.[/green] Proceeding with overwrite...\n")
                    else:
                        console.print("[yellow]Cancelled.[/yellow] Use --force to skip this prompt.")
                        raise typer.Exit(code=0)

    if centralized:
        # Centralized mode: single HNSW index at project root
        if not index_root:
            index_root = index_path.parent if index_path else target_path
        result = generate_dense_embeddings_centralized(
            index_root,
            embedding_backend=backend,
            model_profile=model,
            force=force,
            chunk_size=chunk_size,
            progress_callback=progress_update,
            max_workers=max_workers,
        )
    else:
        result = generate_embeddings(
            index_path,
            embedding_backend=backend,
            model_profile=model,
            force=force,
            chunk_size=chunk_size,
            progress_callback=progress_update,
            max_workers=max_workers,
        )

    if json_mode:
        print_json(**result)
    else:
        if not result["success"]:
            error_msg = result.get("error", "Unknown error")
            console.print(f"[red]Error:[/red] {error_msg}")

            # Provide helpful hints
            if "already has" in error_msg:
                console.print("\n[dim]Use --force to regenerate existing embeddings[/dim]")
            elif "fastembed not available" in error_msg or "Semantic search not available" in error_msg:
                console.print("\n[dim]Install semantic dependencies:[/dim]")
                console.print("  [cyan]pip install codexlens[semantic][/cyan]")
            elif "ccw-litellm not available" in error_msg:
                console.print("\n[dim]Install LiteLLM backend dependencies:[/dim]")
                console.print("  [cyan]pip install ccw-litellm[/cyan]")

            raise typer.Exit(code=1)

        data = result["result"]

        # Set global model lock after successful generation
        # This prevents using different models for future indexes
        set_locked_model_config(backend, model)

        if centralized:
            # Centralized mode output
            elapsed = data.get("elapsed_time", 0)
            console.print(f"[green]v[/green] Centralized embeddings generated successfully!")
            console.print(f"  Model: {data.get('model_name', model)}")
            console.print(f"  Chunks created: {data['chunks_created']:,}")
            console.print(f"  Files processed: {data['files_processed']}")
            if data.get("files_failed", 0) > 0:
                console.print(f"  [yellow]Files failed: {data['files_failed']}[/yellow]")
            console.print(f"  Central index: {data.get('central_index_path', 'N/A')}")
            console.print(f"  Time: {elapsed:.1f}s")
        else:
            # Single index mode output
            elapsed = data["elapsed_time"]

            console.print(f"[green]v[/green] Embeddings generated successfully!")
            console.print(f"  Model: {data['model_name']}")
            console.print(f"  Chunks created: {data['chunks_created']:,}")
            console.print(f"  Files processed: {data['files_processed']}")

            if data["files_failed"] > 0:
                console.print(f"  [yellow]Files failed: {data['files_failed']}[/yellow]")
                if data["failed_files"]:
                    console.print("  [dim]First failures:[/dim]")
                    for file_path, error in data["failed_files"]:
                        console.print(f"    [dim]{file_path}: {error}[/dim]")

            console.print(f"  Time: {elapsed:.1f}s")

        console.print("\n[dim]Use vector search with:[/dim]")
        console.print("  [cyan]codexlens search 'your query' --mode pure-vector[/cyan]")


# ==================== GPU Management Commands ====================

@app.command(name="gpu-list")
def gpu_list(
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """List available GPU devices for embedding acceleration.

    Shows all detected GPU devices with their capabilities and selection status.
    Discrete GPUs (NVIDIA, AMD) are automatically preferred over integrated GPUs.

    Examples:
        codexlens gpu-list                    # List all GPUs
        codexlens gpu-list --json             # JSON output for scripting
    """
    from codexlens.semantic.gpu_support import get_gpu_devices, detect_gpu, get_selected_device_id

    gpu_info = detect_gpu()
    devices = get_gpu_devices()
    selected_id = get_selected_device_id()

    if json_mode:
        print_json(
            success=True,
            result={
                "devices": devices,
                "selected_device_id": selected_id,
                "gpu_available": gpu_info.gpu_available,
                "providers": gpu_info.onnx_providers,
            }
        )
    else:
        if not devices:
            console.print("[yellow]No GPU devices detected[/yellow]")
            console.print(f"ONNX Providers: [dim]{', '.join(gpu_info.onnx_providers)}[/dim]")
            return

        console.print("[bold]Available GPU Devices[/bold]\n")

        table = Table(show_header=True, header_style="bold")
        table.add_column("ID", justify="center")
        table.add_column("Name")
        table.add_column("Vendor", justify="center")
        table.add_column("Type", justify="center")
        table.add_column("Status", justify="center")

        for dev in devices:
            type_str = "[green]Discrete[/green]" if dev["is_discrete"] else "[dim]Integrated[/dim]"
            vendor_color = {
                "nvidia": "green",
                "amd": "red",
                "intel": "blue"
            }.get(dev["vendor"], "white")
            vendor_str = f"[{vendor_color}]{dev['vendor'].upper()}[/{vendor_color}]"

            status_parts = []
            if dev["is_preferred"]:
                status_parts.append("[cyan]Auto[/cyan]")
            if dev["is_selected"]:
                status_parts.append("[green]✓ Selected[/green]")

            status_str = " ".join(status_parts) if status_parts else "[dim]—[/dim]"

            table.add_row(
                str(dev["device_id"]),
                dev["name"],
                vendor_str,
                type_str,
                status_str,
            )

        console.print(table)
        console.print(f"\nONNX Providers: [dim]{', '.join(gpu_info.onnx_providers)}[/dim]")
        console.print("\n[dim]Select GPU with:[/dim]")
        console.print("  [cyan]codexlens gpu-select <device_id>[/cyan]")


@app.command(name="gpu-select")
def gpu_select(
    device_id: int = typer.Argument(
        ...,
        help="GPU device ID to use for embeddings. Use 'codexlens gpu-list' to see available IDs.",
    ),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Select a specific GPU device for embedding generation.

    By default, CodexLens automatically selects the most powerful GPU (discrete over integrated).
    Use this command to override the selection.

    Examples:
        codexlens gpu-select 1                # Use GPU device 1
        codexlens gpu-select 0 --json         # Select GPU 0 with JSON output
    """
    from codexlens.semantic.gpu_support import set_selected_device_id, get_gpu_devices
    from codexlens.semantic.embedder import clear_embedder_cache

    devices = get_gpu_devices()
    valid_ids = [dev["device_id"] for dev in devices]

    if device_id not in valid_ids:
        if json_mode:
            print_json(success=False, error=f"Invalid device_id {device_id}. Valid IDs: {valid_ids}")
        else:
            console.print(f"[red]Error:[/red] Invalid device_id {device_id}")
            console.print(f"Valid IDs: {valid_ids}")
            console.print("\n[dim]Use 'codexlens gpu-list' to see available devices[/dim]")
        raise typer.Exit(code=1)

    success = set_selected_device_id(device_id)

    if success:
        # Clear embedder cache to force reload with new GPU
        clear_embedder_cache()

        device_name = next((dev["name"] for dev in devices if dev["device_id"] == device_id), "Unknown")

        if json_mode:
            print_json(
                success=True,
                result={
                    "device_id": device_id,
                    "device_name": device_name,
                    "message": f"GPU selection set to device {device_id}: {device_name}",
                }
            )
        else:
            console.print(f"[green]✓[/green] GPU selection updated")
            console.print(f"  Device ID: {device_id}")
            console.print(f"  Device: [cyan]{device_name}[/cyan]")
            console.print("\n[dim]New embeddings will use this GPU[/dim]")
    else:
        if json_mode:
            print_json(success=False, error="Failed to set GPU selection")
        else:
            console.print("[red]Error:[/red] Failed to set GPU selection")
        raise typer.Exit(code=1)


@app.command(name="gpu-reset")
def gpu_reset(
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
) -> None:
    """Reset GPU selection to automatic detection.

    Clears any manual GPU selection and returns to automatic selection
    (discrete GPU preferred over integrated).

    Examples:
        codexlens gpu-reset                   # Reset to auto-detection
    """
    from codexlens.semantic.gpu_support import set_selected_device_id, detect_gpu
    from codexlens.semantic.embedder import clear_embedder_cache

    set_selected_device_id(None)
    clear_embedder_cache()

    gpu_info = detect_gpu(force_refresh=True)

    if json_mode:
        print_json(
            success=True,
            result={
                "message": "GPU selection reset to auto-detection",
                "preferred_device_id": gpu_info.preferred_device_id,
                "preferred_device_name": gpu_info.gpu_name,
            }
        )
    else:
        console.print("[green]✓[/green] GPU selection reset to auto-detection")
        if gpu_info.preferred_device_id is not None:
            console.print(f"  Auto-selected device: {gpu_info.preferred_device_id}")
            console.print(f"  Device: [cyan]{gpu_info.gpu_name}[/cyan]")



# ==================== SPLADE Commands ====================

@index_app.command("splade")
def index_splade(
    path: Path = typer.Argument(..., help="Project path to index"),
    rebuild: bool = typer.Option(False, "--rebuild", "-r", help="Force rebuild SPLADE index"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
) -> None:
    """Generate SPLADE sparse index for existing codebase.

    Encodes all semantic chunks with SPLADE model and builds inverted index
    for efficient sparse retrieval.

    This command discovers all _index.db files recursively in the project's
    index directory and builds SPLADE encodings for chunks across all of them.

    Examples:
        codexlens index splade ~/projects/my-app
        codexlens index splade . --rebuild
    """
    _configure_logging(verbose)

    from codexlens.semantic.splade_encoder import get_splade_encoder, check_splade_available
    from codexlens.storage.splade_index import SpladeIndex
    from codexlens.semantic.vector_store import VectorStore

    # Check SPLADE availability
    ok, err = check_splade_available()
    if not ok:
        console.print(f"[red]SPLADE not available: {err}[/red]")
        console.print("[dim]Install with: pip install transformers torch[/dim]")
        raise typer.Exit(1)

    # Find index root directory
    target_path = path.expanduser().resolve()

    # Determine index root directory (containing _index.db files)
    if target_path.is_file() and target_path.name == "_index.db":
        index_root = target_path.parent
    elif target_path.is_dir():
        # Check for local .codexlens/_index.db
        local_index = target_path / ".codexlens" / "_index.db"
        if local_index.exists():
            index_root = local_index.parent
        else:
            # Try to find via registry
            registry = RegistryStore()
            try:
                registry.initialize()
                mapper = PathMapper()
                index_db = mapper.source_to_index_db(target_path)
                if not index_db.exists():
                    console.print(f"[red]Error:[/red] No index found for {target_path}")
                    console.print("Run 'codexlens init' first to create an index")
                    raise typer.Exit(1)
                index_root = index_db.parent
            finally:
                registry.close()
    else:
        console.print(f"[red]Error:[/red] Path must be _index.db file or indexed directory")
        raise typer.Exit(1)

    # Discover all _index.db files recursively
    all_index_dbs = sorted(index_root.rglob("_index.db"))
    if not all_index_dbs:
        console.print(f"[red]Error:[/red] No _index.db files found in {index_root}")
        raise typer.Exit(1)

    console.print(f"[blue]Discovered {len(all_index_dbs)} index databases[/blue]")

    # SPLADE index is stored alongside the root _index.db
    from codexlens.config import SPLADE_DB_NAME
    splade_db = index_root / SPLADE_DB_NAME

    if splade_db.exists() and not rebuild:
        console.print("[yellow]SPLADE index exists. Use --rebuild to regenerate.[/yellow]")
        return

    # If rebuild, delete existing splade database
    if splade_db.exists() and rebuild:
        splade_db.unlink()

    # Collect all chunks from all distributed index databases
    # Assign globally unique IDs to avoid collisions (each DB starts with ID 1)
    console.print(f"[blue]Loading chunks from {len(all_index_dbs)} distributed indexes...[/blue]")
    all_chunks = []  # (global_id, chunk) pairs
    total_files_checked = 0
    indexes_with_chunks = 0
    global_id = 0  # Sequential global ID across all databases

    for index_db in all_index_dbs:
        total_files_checked += 1
        try:
            vector_store = VectorStore(index_db)
            chunks = vector_store.get_all_chunks()
            if chunks:
                indexes_with_chunks += 1
                # Assign sequential global IDs to avoid collisions
                for chunk in chunks:
                    global_id += 1
                    all_chunks.append((global_id, chunk, index_db))
                if verbose:
                    console.print(f"  [dim]{index_db.parent.name}: {len(chunks)} chunks[/dim]")
            vector_store.close()
        except Exception as e:
            if verbose:
                console.print(f"  [yellow]Warning: Failed to read {index_db}: {e}[/yellow]")

    if not all_chunks:
        console.print("[yellow]No chunks found in any index database[/yellow]")
        console.print(f"[dim]Checked {total_files_checked} index files, found 0 chunks[/dim]")
        console.print("[dim]Generate embeddings first with 'codexlens embeddings-generate --recursive'[/dim]")
        raise typer.Exit(1)

    console.print(f"[blue]Found {len(all_chunks)} chunks across {indexes_with_chunks} indexes[/blue]")
    console.print(f"[blue]Encoding with SPLADE...[/blue]")

    # Initialize SPLADE
    encoder = get_splade_encoder()
    splade_index = SpladeIndex(splade_db)
    splade_index.create_tables()

    # Encode in batches with progress bar
    chunk_metadata_batch = []
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Encoding...", total=len(all_chunks))
        for global_id, chunk, source_db_path in all_chunks:
            sparse_vec = encoder.encode_text(chunk.content)
            splade_index.add_posting(global_id, sparse_vec)
            # Store chunk metadata for self-contained search
            # Serialize metadata dict to JSON string
            metadata_str = None
            if hasattr(chunk, 'metadata') and chunk.metadata:
                try:
                    metadata_str = json.dumps(chunk.metadata) if isinstance(chunk.metadata, dict) else chunk.metadata
                except Exception:
                    pass
            chunk_metadata_batch.append((
                global_id,
                chunk.file_path or "",
                chunk.content,
                metadata_str,
                str(source_db_path)
            ))
            progress.advance(task)

    # Batch insert chunk metadata
    if chunk_metadata_batch:
        splade_index.add_chunks_metadata_batch(chunk_metadata_batch)

    # Set metadata
    splade_index.set_metadata(
        model_name=encoder.model_name,
        vocab_size=encoder.vocab_size
    )

    stats = splade_index.get_stats()
    console.print(f"[green]OK[/green] SPLADE index built: {stats['unique_chunks']} chunks, {stats['total_postings']} postings")
    console.print(f"  Source indexes: {indexes_with_chunks}")
    console.print(f"  Database: [dim]{splade_db}[/dim]")


@app.command("splade-status", hidden=True, deprecated=True)
def splade_status_command(
    path: Path = typer.Argument(..., help="Project path"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
) -> None:
    """[Deprecated] Use 'codexlens index status' instead.

    Show SPLADE index status and statistics.

    Examples:
        codexlens splade-status ~/projects/my-app
        codexlens splade-status .
    """
    _deprecated_command_warning("splade-status", "index status")
    _configure_logging(verbose)

    from codexlens.storage.splade_index import SpladeIndex
    from codexlens.semantic.splade_encoder import check_splade_available
    from codexlens.config import SPLADE_DB_NAME

    # Find index database
    target_path = path.expanduser().resolve()

    if target_path.is_file() and target_path.name == "_index.db":
        splade_db = target_path.parent / SPLADE_DB_NAME
    elif target_path.is_dir():
        # Check for local .codexlens/_splade.db
        local_splade = target_path / ".codexlens" / SPLADE_DB_NAME
        if local_splade.exists():
            splade_db = local_splade
        else:
            # Try to find via registry
            registry = RegistryStore()
            try:
                registry.initialize()
                mapper = PathMapper()
                index_db = mapper.source_to_index_db(target_path)
                splade_db = index_db.parent / SPLADE_DB_NAME
            finally:
                registry.close()
    else:
        console.print(f"[red]Error:[/red] Path must be _index.db file or indexed directory")
        raise typer.Exit(1)

    if not splade_db.exists():
        console.print("[yellow]No SPLADE index found[/yellow]")
        console.print(f"[dim]Run 'codexlens splade-index {path}' to create one[/dim]")
        return

    splade_index = SpladeIndex(splade_db)

    if not splade_index.has_index():
        console.print("[yellow]SPLADE tables not initialized[/yellow]")
        return

    metadata = splade_index.get_metadata()
    stats = splade_index.get_stats()

    # Create status table
    table = Table(title="SPLADE Index Status", show_header=False)
    table.add_column("Property", style="cyan")
    table.add_column("Value")

    table.add_row("Database", str(splade_db))
    if metadata:
        table.add_row("Model", metadata['model_name'])
        table.add_row("Vocab Size", str(metadata['vocab_size']))
    table.add_row("Chunks", str(stats['unique_chunks']))
    table.add_row("Unique Tokens", str(stats['unique_tokens']))
    table.add_row("Total Postings", str(stats['total_postings']))

    ok, err = check_splade_available()
    status_text = "[green]Yes[/green]" if ok else f"[red]No[/red] - {err}"
    table.add_row("SPLADE Available", status_text)

    console.print(table)


# ==================== Watch Command ====================

@app.command()
def watch(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to watch."),
    language: Optional[List[str]] = typer.Option(None, "--language", "-l", help="Languages to watch (comma-separated)."),
    debounce: int = typer.Option(1000, "--debounce", "-d", min=100, max=10000, help="Debounce interval in milliseconds."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Watch a directory for file changes and incrementally update the index.

    Monitors the specified directory for file system changes (create, modify, delete)
    and automatically updates the CodexLens index. The directory must already be indexed
    using 'codexlens init' before watching.

    Examples:
      # Watch current directory
      codexlens watch .

      # Watch with custom debounce interval
      codexlens watch . --debounce 2000

      # Watch only Python and JavaScript files
      codexlens watch . --language python,javascript

    Press Ctrl+C to stop watching.
    """
    _configure_logging(verbose)
    watch_path = path.expanduser().resolve()

    registry: RegistryStore | None = None
    try:
        # Validate that path is indexed
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        project_record = registry.find_by_source_path(str(watch_path))
        if not project_record:
            console.print(f"[red]Error:[/red] Directory is not indexed: {watch_path}")
            console.print("[dim]Run 'codexlens init' first to create an index.[/dim]")
            raise typer.Exit(code=1)

        # Parse languages
        languages = _parse_languages(language)

        # Create watcher config
        watcher_config = WatcherConfig(
            debounce_ms=debounce,
            languages=languages,
        )

        # Display startup message
        console.print(f"[green]Starting watcher for:[/green] {watch_path}")
        console.print(f"[dim]Debounce interval: {debounce}ms[/dim]")
        if languages:
            console.print(f"[dim]Watching languages: {', '.join(languages)}[/dim]")
        console.print("[dim]Press Ctrl+C to stop[/dim]\n")

        # Create and start watcher manager
        manager = WatcherManager(
            root_path=watch_path,
            watcher_config=watcher_config,
            on_indexed=lambda result: _display_index_result(result),
        )

        manager.start()
        manager.wait()

    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping watcher...[/yellow]")
    except CodexLensError as exc:
        console.print(f"[red]Watch failed:[/red] {exc}")
        raise typer.Exit(code=1)
    except Exception as exc:
        console.print(f"[red]Unexpected error:[/red] {exc}")
        raise typer.Exit(code=1)
    finally:
        if registry is not None:
            registry.close()


def _display_index_result(result) -> None:
    """Display indexing result in real-time."""
    if result.files_indexed > 0 or result.files_removed > 0:
        parts = []
        if result.files_indexed > 0:
            parts.append(f"[green]✓ Indexed {result.files_indexed} file(s)[/green]")
        if result.files_removed > 0:
            parts.append(f"[yellow]✗ Removed {result.files_removed} file(s)[/yellow]")
        console.print(" | ".join(parts))

        if result.errors:
            for error in result.errors[:3]:  # Show max 3 errors
                console.print(f"  [red]Error:[/red] {error}")
            if len(result.errors) > 3:
                console.print(f"  [dim]... and {len(result.errors) - 3} more errors[/dim]")



# ==================== Cascade Index Commands ====================


def get_binary_index_path(db_path: Path) -> Path:
    """Get the path for binary ANN index file.

    Args:
        db_path: Path to the _index.db file

    Returns:
        Path to the binary index file (_index_binary.bin)
    """
    return db_path.parent / f"{db_path.stem}_binary.bin"


@index_app.command("binary")
def index_binary(
    path: Annotated[Path, typer.Argument(help="Directory to index")],
    force: Annotated[bool, typer.Option("--force", "-f", help="Force regenerate")] = False,
    batch_size: Annotated[int, typer.Option("--batch-size", "-b", help="Batch size for embedding")] = 32,
    json_mode: Annotated[bool, typer.Option("--json", help="Output JSON response")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable verbose logging")] = False,
) -> None:
    """Generate cascade embeddings (binary + dense) for two-stage retrieval.

    Cascade retrieval uses a two-stage approach:
    1. Binary search (fast, 32 bytes/vector) -> coarse filtering
    2. Dense rerank (precise, 8KB/vector) -> final results

    This command:
    - Finds all _index.db files in the directory
    - Generates binary (256-dim) and dense (2048-dim) embeddings for each chunk
    - Stores embeddings in the database (embedding_binary, embedding_dense columns)
    - Creates a BinaryANNIndex file for fast coarse retrieval

    Examples:
        codexlens index binary ~/projects/my-app
        codexlens index binary . --force
        codexlens index binary . --batch-size 64 --verbose
    """
    _configure_logging(verbose, json_mode)

    target_path = path.expanduser().resolve()

    # Find index database(s)
    if target_path.is_file() and target_path.name == "_index.db":
        index_dbs = [target_path]
    elif target_path.is_dir():
        # Check local .codexlens/_index.db first
        local_index = target_path / ".codexlens" / "_index.db"
        if local_index.exists():
            index_dbs = [local_index]
        else:
            # Find via registry
            registry = RegistryStore()
            try:
                registry.initialize()
                mapper = PathMapper()
                index_db = mapper.source_to_index_db(target_path)
                if not index_db.exists():
                    if json_mode:
                        print_json(success=False, error=f"No index found for {target_path}")
                    else:
                        console.print(f"[red]Error:[/red] No index found for {target_path}")
                        console.print("Run 'codexlens init' first to create an index")
                    raise typer.Exit(code=1)
                # Find all _index.db files under the index root
                index_root = index_db.parent
                index_dbs = list(index_root.rglob("_index.db"))
            finally:
                registry.close()
    else:
        if json_mode:
            print_json(success=False, error="Path must be _index.db file or indexed directory")
        else:
            console.print("[red]Error:[/red] Path must be _index.db file or indexed directory")
        raise typer.Exit(code=1)

    if not index_dbs:
        if json_mode:
            print_json(success=False, error="No index databases found")
        else:
            console.print("[yellow]No index databases found[/yellow]")
        raise typer.Exit(code=1)

    # Import cascade embedding backend
    try:
        from codexlens.indexing.embedding import CascadeEmbeddingBackend
        from codexlens.semantic.ann_index import BinaryANNIndex
        from codexlens.indexing.embedding import pack_binary_embedding
    except ImportError as e:
        error_msg = f"Cascade embedding dependencies not available: {e}"
        if json_mode:
            print_json(success=False, error=error_msg)
        else:
            console.print(f"[red]Error:[/red] {error_msg}")
            console.print("[dim]Install with: pip install codexlens[semantic][/dim]")
        raise typer.Exit(code=1)

    if not json_mode:
        console.print(f"[bold]Generating cascade embeddings[/bold]")
        console.print(f"Path: [dim]{target_path}[/dim]")
        console.print(f"Index databases: [cyan]{len(index_dbs)}[/cyan]")
        console.print(f"Batch size: [cyan]{batch_size}[/cyan]")
        console.print()

    # Initialize cascade embedding backend
    try:
        cascade_backend = CascadeEmbeddingBackend()
    except Exception as e:
        error_msg = f"Failed to initialize cascade embedding backend: {e}"
        if json_mode:
            print_json(success=False, error=error_msg)
        else:
            console.print(f"[red]Error:[/red] {error_msg}")
        raise typer.Exit(code=1)

    # Process statistics
    total_chunks_processed = 0
    total_indexes_processed = 0
    total_indexes_successful = 0
    total_binary_indexes_created = 0
    errors_list: List[str] = []

    # Process each index database
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TextColumn("({task.completed}/{task.total})"),
        TimeElapsedColumn(),
        console=console,
        disable=json_mode,
    ) as progress:
        db_task = progress.add_task("Processing indexes...", total=len(index_dbs))

        for db_path in index_dbs:
            total_indexes_processed += 1
            index_name = db_path.parent.name

            try:
                # Open the index store
                store = DirIndexStore(db_path)
                store.initialize()

                # Get connection for direct queries
                conn = store._get_connection()

                # Ensure cascade columns exist in semantic_chunks table
                try:
                    conn.execute("ALTER TABLE semantic_chunks ADD COLUMN embedding_binary BLOB")
                except Exception:
                    pass  # Column already exists
                try:
                    conn.execute("ALTER TABLE semantic_chunks ADD COLUMN embedding_dense BLOB")
                except Exception:
                    pass  # Column already exists
                conn.commit()

                # Check if semantic_chunks table exists and has data
                try:
                    cursor = conn.execute("SELECT COUNT(*) FROM semantic_chunks")
                    chunk_count = cursor.fetchone()[0]
                except Exception:
                    # semantic_chunks table doesn't exist or is empty
                    chunk_count = 0

                if chunk_count == 0:
                    if verbose and not json_mode:
                        console.print(f"  [dim]Skipping {index_name}: no chunks found[/dim]")
                    progress.advance(db_task)
                    store.close()
                    continue

                # Check if embeddings already exist (unless force)
                if not force:
                    cursor = conn.execute(
                        "SELECT COUNT(*) FROM semantic_chunks WHERE embedding_binary IS NOT NULL"
                    )
                    existing_count = cursor.fetchone()[0]
                    if existing_count > 0:
                        if verbose and not json_mode:
                            console.print(f"  [dim]Skipping {index_name}: embeddings exist (use --force to regenerate)[/dim]")
                        progress.advance(db_task)
                        store.close()
                        continue

                # If force, clear existing cascade embeddings
                if force:
                    conn.execute(
                        "UPDATE semantic_chunks SET embedding_binary = NULL, embedding_dense = NULL"
                    )
                    conn.commit()

                # Get all chunks
                cursor = conn.execute("SELECT id, content FROM semantic_chunks")
                chunks = cursor.fetchall()

                if not chunks:
                    progress.advance(db_task)
                    store.close()
                    continue

                if verbose and not json_mode:
                    console.print(f"  Processing {index_name}: {len(chunks)} chunks")

                # Process in batches
                chunk_task = progress.add_task(
                    f"  {index_name}", total=len(chunks)
                )

                # Prepare for BinaryANNIndex
                binary_index_path = get_binary_index_path(db_path)
                binary_ann_index = BinaryANNIndex(db_path, dim=256)

                for i in range(0, len(chunks), batch_size):
                    batch_chunks = chunks[i:i + batch_size]
                    batch_ids = [c[0] for c in batch_chunks]
                    batch_contents = [c[1] for c in batch_chunks]

                    # Generate cascade embeddings
                    binary_embeddings, dense_embeddings = cascade_backend.encode_cascade(
                        batch_contents, batch_size=batch_size
                    )

                    # Pack binary embeddings and convert dense to bytes
                    packed_binaries = []
                    dense_bytes_list = []

                    for j in range(len(batch_ids)):
                        # Pack binary embedding (256 bits -> 32 bytes)
                        packed_binary = pack_binary_embedding(binary_embeddings[j])
                        packed_binaries.append(packed_binary)

                        # Convert dense embedding to bytes
                        import numpy as np
                        dense_blob = dense_embeddings[j].astype(np.float32).tobytes()
                        dense_bytes_list.append(dense_blob)

                    # Update database
                    for j, chunk_id in enumerate(batch_ids):
                        conn.execute(
                            """
                            UPDATE semantic_chunks
                            SET embedding_binary = ?, embedding_dense = ?
                            WHERE id = ?
                            """,
                            (packed_binaries[j], dense_bytes_list[j], chunk_id)
                        )

                    # Add to binary ANN index
                    binary_ann_index.add_vectors(batch_ids, packed_binaries)

                    conn.commit()
                    total_chunks_processed += len(batch_ids)
                    progress.advance(chunk_task, len(batch_ids))

                # Save binary ANN index
                binary_ann_index.save()
                total_binary_indexes_created += 1

                progress.remove_task(chunk_task)
                store.close()
                total_indexes_successful += 1

            except Exception as e:
                error_msg = f"{index_name}: {e}"
                errors_list.append(error_msg)
                if verbose and not json_mode:
                    console.print(f"  [red]Error processing {index_name}:[/red] {e}")

            progress.advance(db_task)

    # Build result
    result = {
        "path": str(target_path),
        "indexes_processed": total_indexes_processed,
        "indexes_successful": total_indexes_successful,
        "chunks_processed": total_chunks_processed,
        "binary_indexes_created": total_binary_indexes_created,
        "errors": len(errors_list),
        "error_details": errors_list[:5] if errors_list else [],
    }

    if json_mode:
        print_json(success=True, result=result)
    else:
        console.print(f"\n[green]Cascade indexing complete[/green]")
        console.print(f"  Indexes processed: {total_indexes_processed}")
        console.print(f"  Indexes successful: {total_indexes_successful}")
        console.print(f"  Chunks processed: {total_chunks_processed:,}")
        console.print(f"  Binary indexes created: {total_binary_indexes_created}")
        if errors_list:
            console.print(f"  [yellow]Errors: {len(errors_list)}[/yellow]")
            for err in errors_list[:3]:
                console.print(f"    [dim]{err}[/dim]")
            if len(errors_list) > 3:
                console.print(f"    [dim]... and {len(errors_list) - 3} more[/dim]")


# ==================== Index Status Command ====================

@index_app.command("status")
def index_status(
    path: Optional[Path] = typer.Argument(
        None,
        help="Path to project directory or _index.db file. If not specified, uses default index root.",
    ),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
) -> None:
    """Show comprehensive index status (embeddings + SPLADE).

    Shows combined status for all index types:
    - Dense vector embeddings (HNSW)
    - SPLADE sparse embeddings
    - Binary cascade embeddings

    Examples:
        codexlens index status                     # Check all indexes
        codexlens index status ~/projects/my-app   # Check specific project
        codexlens index status --json              # JSON output
    """
    _configure_logging(verbose, json_mode)

    from codexlens.cli.embedding_manager import check_index_embeddings, get_embedding_stats_summary
    from codexlens.storage.splade_index import SpladeIndex
    from codexlens.semantic.splade_encoder import check_splade_available
    from codexlens.config import SPLADE_DB_NAME

    # Determine target path and index root
    if path is None:
        index_root = _get_index_root()
        target_path = None
    else:
        target_path = path.resolve()
        if target_path.is_file() and target_path.name == "_index.db":
            index_root = target_path.parent
        elif target_path.is_dir():
            # Try to find index for this project
            registry = RegistryStore()
            try:
                registry.initialize()
                mapper = PathMapper()
                index_path = mapper.source_to_index_db(target_path)
                if index_path.exists():
                    index_root = index_path.parent
                else:
                    if json_mode:
                        print_json(success=False, error=f"No index found for {target_path}")
                    else:
                        console.print(f"[red]Error:[/red] No index found for {target_path}")
                        console.print("Run 'codexlens index init' first to create an index")
                    raise typer.Exit(code=1)
            finally:
                registry.close()
        else:
            if json_mode:
                print_json(success=False, error="Path must be _index.db file or directory")
            else:
                console.print(f"[red]Error:[/red] Path must be _index.db file or directory")
            raise typer.Exit(code=1)

    # Get embeddings status
    embeddings_result = get_embedding_stats_summary(index_root)

    # Get SPLADE status
    splade_db = index_root / SPLADE_DB_NAME
    splade_status = {
        "available": False,
        "has_index": False,
        "stats": None,
        "metadata": None,
    }

    splade_available, splade_err = check_splade_available()
    splade_status["available"] = splade_available

    if splade_db.exists():
        try:
            splade_index = SpladeIndex(splade_db)
            if splade_index.has_index():
                splade_status["has_index"] = True
                splade_status["stats"] = splade_index.get_stats()
                splade_status["metadata"] = splade_index.get_metadata()
            splade_index.close()
        except Exception as e:
            if verbose:
                console.print(f"[yellow]Warning: Failed to read SPLADE index: {e}[/yellow]")

    # Build combined result
    result = {
        "index_root": str(index_root),
        "embeddings": embeddings_result.get("result") if embeddings_result.get("success") else None,
        "embeddings_error": embeddings_result.get("error") if not embeddings_result.get("success") else None,
        "splade": splade_status,
    }

    if json_mode:
        print_json(success=True, result=result)
    else:
        console.print(f"[bold]Index Status[/bold]")
        console.print(f"Index root: [dim]{index_root}[/dim]\n")

        # Embeddings section
        console.print("[bold]Dense Embeddings (HNSW):[/bold]")
        if embeddings_result.get("success"):
            data = embeddings_result["result"]
            total = data.get("total_indexes", 0)
            with_emb = data.get("indexes_with_embeddings", 0)
            total_chunks = data.get("total_chunks", 0)

            console.print(f"  Total indexes: {total}")
            console.print(f"  Indexes with embeddings: [{'green' if with_emb > 0 else 'yellow'}]{with_emb}[/]/{total}")
            console.print(f"  Total chunks: {total_chunks:,}")
        else:
            console.print(f"  [yellow]--[/yellow] {embeddings_result.get('error', 'Not available')}")

        # SPLADE section
        console.print("\n[bold]SPLADE Sparse Index:[/bold]")
        if splade_status["has_index"]:
            stats = splade_status["stats"] or {}
            metadata = splade_status["metadata"] or {}
            console.print(f"  [green]OK[/green] SPLADE index available")
            console.print(f"  Chunks: {stats.get('unique_chunks', 0):,}")
            console.print(f"  Unique tokens: {stats.get('unique_tokens', 0):,}")
            console.print(f"  Total postings: {stats.get('total_postings', 0):,}")
            if metadata.get("model_name"):
                console.print(f"  Model: {metadata['model_name']}")
        elif splade_available:
            console.print(f"  [yellow]--[/yellow] No SPLADE index found")
            console.print(f"  [dim]Run 'codexlens index splade <path>' to create one[/dim]")
        else:
            console.print(f"  [yellow]--[/yellow] SPLADE not available: {splade_err}")

        # Runtime availability
        console.print("\n[bold]Runtime Availability:[/bold]")
        console.print(f"  SPLADE encoder: {'[green]Yes[/green]' if splade_available else f'[red]No[/red] ({splade_err})'}")


# ==================== Index All Command ====================

@index_app.command("all")
def index_all(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to index."),
    language: Optional[List[str]] = typer.Option(
        None,
        "--language",
        "-l",
        help="Limit indexing to specific languages (repeat or comma-separated).",
    ),
    workers: Optional[int] = typer.Option(None, "--workers", "-w", min=1, help="Parallel worker processes."),
    force: bool = typer.Option(False, "--force", "-f", help="Force full reindex."),
    backend: str = typer.Option("fastembed", "--backend", "-b", help="Embedding backend: fastembed or litellm."),
    model: str = typer.Option("code", "--model", "-m", help="Embedding model profile or name."),
    max_workers: int = typer.Option(1, "--max-workers", min=1, help="Max concurrent API calls."),
    skip_splade: bool = typer.Option(False, "--skip-splade", help="Skip SPLADE index generation."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """Run all indexing operations in sequence (init, embeddings, splade).

    This is a convenience command that runs the complete indexing pipeline:
    1. FTS index initialization (index init)
    2. Dense vector embeddings (index embeddings)
    3. SPLADE sparse index (index splade) - unless --skip-splade

    Examples:
        codexlens index all ~/projects/my-app
        codexlens index all . --force
        codexlens index all . --backend litellm --model text-embedding-3-small
        codexlens index all . --skip-splade
    """
    _configure_logging(verbose, json_mode)

    base_path = path.expanduser().resolve()
    results = {
        "path": str(base_path),
        "steps": {},
    }

    # Step 1: Run init
    if not json_mode:
        console.print(f"[bold]Step 1/3: Initializing FTS index...[/bold]")

    try:
        # Import and call the init function directly
        from codexlens.config import Config
        from codexlens.storage.index_tree import IndexTreeBuilder

        config = Config()
        languages = _parse_languages(language)
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        builder = IndexTreeBuilder(registry, mapper, config, incremental=not force)
        build_result = builder.build(
            source_root=base_path,
            languages=languages,
            workers=workers,
            force_full=force,
        )

        results["steps"]["init"] = {
            "success": True,
            "files_indexed": build_result.total_files,
            "dirs_indexed": build_result.total_dirs,
            "index_root": str(build_result.index_root),
        }

        if not json_mode:
            console.print(f"  [green]OK[/green] Indexed {build_result.total_files} files in {build_result.total_dirs} directories")

        index_root = Path(build_result.index_root)
        registry.close()

    except Exception as e:
        results["steps"]["init"] = {"success": False, "error": str(e)}
        if json_mode:
            print_json(success=False, result=results, error=f"Init failed: {e}")
        else:
            console.print(f"  [red]Error:[/red] {e}")
        raise typer.Exit(code=1)

    # Step 2: Generate embeddings
    if not json_mode:
        console.print(f"\n[bold]Step 2/3: Generating dense embeddings...[/bold]")

    try:
        from codexlens.cli.embedding_manager import generate_dense_embeddings_centralized

        def progress_update(msg: str):
            if not json_mode and verbose:
                console.print(f"  {msg}")

        embed_result = generate_dense_embeddings_centralized(
            index_root,
            embedding_backend=backend,
            model_profile=model,
            force=force,
            chunk_size=2000,
            progress_callback=progress_update,
            max_workers=max_workers,
        )

        if embed_result["success"]:
            data = embed_result["result"]
            results["steps"]["embeddings"] = {
                "success": True,
                "chunks_created": data.get("chunks_created", 0),
                "files_processed": data.get("files_processed", 0),
            }
            if not json_mode:
                console.print(f"  [green]OK[/green] Generated {data.get('chunks_created', 0)} chunks for {data.get('files_processed', 0)} files")
        else:
            results["steps"]["embeddings"] = {
                "success": False,
                "error": embed_result.get("error"),
            }
            if not json_mode:
                console.print(f"  [yellow]Warning:[/yellow] {embed_result.get('error', 'Unknown error')}")

    except Exception as e:
        results["steps"]["embeddings"] = {"success": False, "error": str(e)}
        if not json_mode:
            console.print(f"  [yellow]Warning:[/yellow] {e}")

    # Step 3: Generate SPLADE index (unless skipped)
    if not skip_splade:
        if not json_mode:
            console.print(f"\n[bold]Step 3/3: Generating SPLADE index...[/bold]")

        try:
            from codexlens.semantic.splade_encoder import get_splade_encoder, check_splade_available
            from codexlens.storage.splade_index import SpladeIndex
            from codexlens.semantic.vector_store import VectorStore
            from codexlens.config import SPLADE_DB_NAME

            ok, err = check_splade_available()
            if not ok:
                results["steps"]["splade"] = {"success": False, "error": f"SPLADE not available: {err}"}
                if not json_mode:
                    console.print(f"  [yellow]Skipped:[/yellow] SPLADE not available ({err})")
            else:
                # Discover all _index.db files
                all_index_dbs = sorted(index_root.rglob("_index.db"))
                if not all_index_dbs:
                    results["steps"]["splade"] = {"success": False, "error": "No index databases found"}
                    if not json_mode:
                        console.print(f"  [yellow]Skipped:[/yellow] No index databases found")
                else:
                    # Collect chunks
                    all_chunks = []
                    global_id = 0
                    for index_db in all_index_dbs:
                        try:
                            vector_store = VectorStore(index_db)
                            chunks = vector_store.get_all_chunks()
                            for chunk in chunks:
                                global_id += 1
                                all_chunks.append((global_id, chunk, index_db))
                            vector_store.close()
                        except Exception:
                            pass

                    if all_chunks:
                        splade_db = index_root / SPLADE_DB_NAME
                        if splade_db.exists() and force:
                            splade_db.unlink()

                        encoder = get_splade_encoder()
                        splade_index = SpladeIndex(splade_db)
                        splade_index.create_tables()

                        chunk_metadata_batch = []
                        import json as json_module
                        for gid, chunk, source_db_path in all_chunks:
                            sparse_vec = encoder.encode_text(chunk.content)
                            splade_index.add_posting(gid, sparse_vec)
                            metadata_str = None
                            if hasattr(chunk, 'metadata') and chunk.metadata:
                                try:
                                    metadata_str = json_module.dumps(chunk.metadata) if isinstance(chunk.metadata, dict) else chunk.metadata
                                except Exception:
                                    pass
                            chunk_metadata_batch.append((
                                gid,
                                chunk.file_path or "",
                                chunk.content,
                                metadata_str,
                                str(source_db_path)
                            ))

                        if chunk_metadata_batch:
                            splade_index.add_chunks_metadata_batch(chunk_metadata_batch)

                        splade_index.set_metadata(
                            model_name=encoder.model_name,
                            vocab_size=encoder.vocab_size
                        )

                        stats = splade_index.get_stats()
                        results["steps"]["splade"] = {
                            "success": True,
                            "chunks": stats['unique_chunks'],
                            "postings": stats['total_postings'],
                        }
                        if not json_mode:
                            console.print(f"  [green]OK[/green] SPLADE index built: {stats['unique_chunks']} chunks, {stats['total_postings']} postings")
                    else:
                        results["steps"]["splade"] = {"success": False, "error": "No chunks found"}
                        if not json_mode:
                            console.print(f"  [yellow]Skipped:[/yellow] No chunks found in indexes")

        except Exception as e:
            results["steps"]["splade"] = {"success": False, "error": str(e)}
            if not json_mode:
                console.print(f"  [yellow]Warning:[/yellow] {e}")
    else:
        results["steps"]["splade"] = {"success": True, "skipped": True}
        if not json_mode:
            console.print(f"\n[bold]Step 3/3: SPLADE index...[/bold]")
            console.print(f"  [dim]Skipped (--skip-splade)[/dim]")

    # Summary
    if json_mode:
        print_json(success=True, result=results)
    else:
        console.print(f"\n[bold]Indexing Complete[/bold]")
        init_ok = results["steps"].get("init", {}).get("success", False)
        emb_ok = results["steps"].get("embeddings", {}).get("success", False)
        splade_ok = results["steps"].get("splade", {}).get("success", False)
        console.print(f"  FTS Index: {'[green]OK[/green]' if init_ok else '[red]Failed[/red]'}")
        console.print(f"  Embeddings: {'[green]OK[/green]' if emb_ok else '[yellow]Partial/Skipped[/yellow]'}")
        console.print(f"  SPLADE: {'[green]OK[/green]' if splade_ok else '[yellow]Partial/Skipped[/yellow]'}")


# ==================== Index Migration Commands ====================

# Index version for migration tracking (file-based version marker)
INDEX_FORMAT_VERSION = "2.0"
INDEX_VERSION_FILE = "_index_version.txt"


def _get_index_version(index_root: Path) -> Optional[str]:
    """Read index format version from version marker file.

    Args:
        index_root: Root directory of the index

    Returns:
        Version string if file exists, None otherwise
    """
    version_file = index_root / INDEX_VERSION_FILE
    if version_file.exists():
        try:
            return version_file.read_text(encoding="utf-8").strip()
        except Exception:
            return None
    return None


def _set_index_version(index_root: Path, version: str) -> None:
    """Write index format version to version marker file.

    Args:
        index_root: Root directory of the index
        version: Version string to write
    """
    version_file = index_root / INDEX_VERSION_FILE
    version_file.write_text(version, encoding="utf-8")


def _discover_distributed_splade(index_root: Path) -> List[Dict[str, Any]]:
    """Discover distributed SPLADE data in _index.db files.

    Scans all _index.db files for embedded splade_postings tables.
    This is the old distributed format that needs migration.

    Args:
        index_root: Root directory to scan

    Returns:
        List of dicts with db_path, posting_count, chunk_count
    """
    results = []

    for db_path in index_root.rglob("_index.db"):
        try:
            conn = sqlite3.connect(db_path, timeout=5.0)
            conn.row_factory = sqlite3.Row

            # Check if splade_postings table exists (old embedded format)
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='splade_postings'"
            )
            if cursor.fetchone():
                # Count postings and chunks
                try:
                    row = conn.execute(
                        "SELECT COUNT(*) as postings, COUNT(DISTINCT chunk_id) as chunks FROM splade_postings"
                    ).fetchone()
                    results.append({
                        "db_path": db_path,
                        "posting_count": row["postings"] if row else 0,
                        "chunk_count": row["chunks"] if row else 0,
                    })
                except Exception:
                    pass

            conn.close()
        except Exception:
            pass

    return results


def _discover_distributed_hnsw(index_root: Path) -> List[Dict[str, Any]]:
    """Discover distributed HNSW index files.

    Scans for .hnsw files that are stored alongside _index.db files.
    This is the old distributed format that needs migration.

    Args:
        index_root: Root directory to scan

    Returns:
        List of dicts with hnsw_path, size_bytes
    """
    results = []

    for hnsw_path in index_root.rglob("*.hnsw"):
        try:
            size = hnsw_path.stat().st_size
            results.append({
                "hnsw_path": hnsw_path,
                "size_bytes": size,
            })
        except Exception:
            pass

    return results


def _check_centralized_storage(index_root: Path) -> Dict[str, Any]:
    """Check for centralized storage files.

    Args:
        index_root: Root directory to check

    Returns:
        Dict with has_splade, has_vectors, splade_stats, vector_stats
    """
    from codexlens.config import SPLADE_DB_NAME, VECTORS_HNSW_NAME

    splade_db = index_root / SPLADE_DB_NAME
    vectors_hnsw = index_root / VECTORS_HNSW_NAME

    result = {
        "has_splade": splade_db.exists(),
        "has_vectors": vectors_hnsw.exists(),
        "splade_path": str(splade_db) if splade_db.exists() else None,
        "vectors_path": str(vectors_hnsw) if vectors_hnsw.exists() else None,
        "splade_stats": None,
        "vector_stats": None,
    }

    # Get SPLADE stats if exists
    if splade_db.exists():
        try:
            from codexlens.storage.splade_index import SpladeIndex
            splade = SpladeIndex(splade_db)
            if splade.has_index():
                result["splade_stats"] = splade.get_stats()
            splade.close()
        except Exception:
            pass

    # Get vector stats if exists
    if vectors_hnsw.exists():
        try:
            result["vector_stats"] = {
                "size_bytes": vectors_hnsw.stat().st_size,
            }
        except Exception:
            pass

    return result


@index_app.command("migrate")
def index_migrate_cmd(
    path: Annotated[Optional[str], typer.Argument(help="Project path to migrate")] = None,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Show what would be migrated without making changes")] = False,
    force: Annotated[bool, typer.Option("--force", help="Force migration even if already migrated")] = False,
    json_mode: Annotated[bool, typer.Option("--json", help="Output JSON response")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable verbose output")] = False,
) -> None:
    """Migrate old distributed index to new centralized architecture.

    This command upgrades indexes from the old distributed storage format
    (where SPLADE/vectors were stored in each _index.db) to the new centralized
    format (single _splade.db and _vectors.hnsw at index root).

    Migration Steps:
      1. Detect if migration is needed (check version marker)
      2. Discover distributed SPLADE data in _index.db files
      3. Discover distributed .hnsw files
      4. Report current status
      5. Create version marker (unless --dry-run)

    Use --dry-run to preview what would be migrated without making changes.
    Use --force to re-run migration even if version marker exists.

    Note: For full data migration (SPLADE/vectors consolidation), run:
      codexlens index splade <path> --rebuild
      codexlens index embeddings <path> --force

    Examples:
        codexlens index migrate ~/projects/my-app --dry-run
        codexlens index migrate . --force
        codexlens index migrate --json
    """
    _configure_logging(verbose, json_mode)

    # Resolve target path
    if path:
        target_path = Path(path).expanduser().resolve()
    else:
        target_path = Path.cwd()

    if not target_path.exists():
        if json_mode:
            print_json(success=False, error=f"Path does not exist: {target_path}")
        else:
            console.print(f"[red]Error:[/red] Path does not exist: {target_path}")
        raise typer.Exit(code=1)

    # Find index root
    registry: RegistryStore | None = None
    index_root: Optional[Path] = None

    try:
        registry = RegistryStore()
        registry.initialize()
        mapper = PathMapper()

        # Check if path is a project with an index
        project_info = registry.get_project(target_path)
        if project_info:
            index_root = Path(project_info.index_root)
        else:
            # Try to find index via mapper
            index_db = mapper.source_to_index_db(target_path)
            if index_db.exists():
                index_root = index_db.parent
    finally:
        if registry:
            registry.close()

    if not index_root or not index_root.exists():
        if json_mode:
            print_json(success=False, error=f"No index found for: {target_path}")
        else:
            console.print(f"[red]Error:[/red] No index found for: {target_path}")
            console.print("[dim]Run 'codexlens init' first to create an index.[/dim]")
        raise typer.Exit(code=1)

    if not json_mode:
        console.print(f"[bold]Index Migration Check[/bold]")
        console.print(f"Source path: [dim]{target_path}[/dim]")
        console.print(f"Index root: [dim]{index_root}[/dim]")
        if dry_run:
            console.print("[yellow]Mode: DRY RUN (no changes will be made)[/yellow]")
        console.print()

    # Check current version
    current_version = _get_index_version(index_root)
    needs_migration = current_version is None or (force and current_version != INDEX_FORMAT_VERSION)

    if current_version and current_version >= INDEX_FORMAT_VERSION and not force:
        result = {
            "path": str(target_path),
            "index_root": str(index_root),
            "current_version": current_version,
            "target_version": INDEX_FORMAT_VERSION,
            "needs_migration": False,
            "message": "Index is already at the latest version",
        }

        if json_mode:
            print_json(success=True, result=result)
        else:
            console.print(f"[green]OK[/green] Index is already at version {current_version}")
            console.print("[dim]No migration needed. Use --force to re-run migration.[/dim]")
        return

    # Discover distributed data
    distributed_splade = _discover_distributed_splade(index_root)
    distributed_hnsw = _discover_distributed_hnsw(index_root)
    centralized = _check_centralized_storage(index_root)

    # Count all _index.db files
    all_index_dbs = list(index_root.rglob("_index.db"))

    # Build migration report
    migration_report = {
        "path": str(target_path),
        "index_root": str(index_root),
        "dry_run": dry_run,
        "current_version": current_version,
        "target_version": INDEX_FORMAT_VERSION,
        "needs_migration": needs_migration,
        "discovery": {
            "total_index_dbs": len(all_index_dbs),
            "distributed_splade_count": len(distributed_splade),
            "distributed_splade_total_postings": sum(d["posting_count"] for d in distributed_splade),
            "distributed_hnsw_count": len(distributed_hnsw),
            "distributed_hnsw_total_bytes": sum(d["size_bytes"] for d in distributed_hnsw),
        },
        "centralized": centralized,
        "recommendations": [],
    }

    # Generate recommendations
    if distributed_splade and not centralized["has_splade"]:
        migration_report["recommendations"].append(
            f"Run 'codexlens splade-index {target_path} --rebuild' to consolidate SPLADE data"
        )

    if distributed_hnsw and not centralized["has_vectors"]:
        migration_report["recommendations"].append(
            f"Run 'codexlens embeddings-generate {target_path} --recursive --force' to consolidate vector data"
        )

    if not distributed_splade and not distributed_hnsw:
        migration_report["recommendations"].append(
            "No distributed data found. Index may already be using centralized storage."
        )

    if json_mode:
        # Perform migration action (set version marker) unless dry-run
        if not dry_run and needs_migration:
            _set_index_version(index_root, INDEX_FORMAT_VERSION)
            migration_report["migrated"] = True
            migration_report["new_version"] = INDEX_FORMAT_VERSION
        else:
            migration_report["migrated"] = False

        print_json(success=True, result=migration_report)
    else:
        # Display discovery results
        console.print("[bold]Discovery Results:[/bold]")
        console.print(f"  Total _index.db files: {len(all_index_dbs)}")
        console.print()

        # Distributed SPLADE
        console.print("[bold]Distributed SPLADE Data:[/bold]")
        if distributed_splade:
            total_postings = sum(d["posting_count"] for d in distributed_splade)
            total_chunks = sum(d["chunk_count"] for d in distributed_splade)
            console.print(f"  Found in {len(distributed_splade)} _index.db files")
            console.print(f"  Total postings: {total_postings:,}")
            console.print(f"  Total chunks: {total_chunks:,}")
            if verbose:
                for d in distributed_splade[:5]:
                    console.print(f"    [dim]{d['db_path'].parent.name}: {d['posting_count']} postings[/dim]")
                if len(distributed_splade) > 5:
                    console.print(f"    [dim]... and {len(distributed_splade) - 5} more[/dim]")
        else:
            console.print("  [dim]None found (already centralized or not generated)[/dim]")
        console.print()

        # Distributed HNSW
        console.print("[bold]Distributed HNSW Files:[/bold]")
        if distributed_hnsw:
            total_size = sum(d["size_bytes"] for d in distributed_hnsw)
            console.print(f"  Found {len(distributed_hnsw)} .hnsw files")
            console.print(f"  Total size: {total_size / (1024 * 1024):.1f} MB")
            if verbose:
                for d in distributed_hnsw[:5]:
                    console.print(f"    [dim]{d['hnsw_path'].name}: {d['size_bytes'] / 1024:.1f} KB[/dim]")
                if len(distributed_hnsw) > 5:
                    console.print(f"    [dim]... and {len(distributed_hnsw) - 5} more[/dim]")
        else:
            console.print("  [dim]None found (already centralized or not generated)[/dim]")
        console.print()

        # Centralized storage status
        console.print("[bold]Centralized Storage:[/bold]")
        if centralized["has_splade"]:
            stats = centralized.get("splade_stats") or {}
            console.print(f"  [green]OK[/green] _splade.db exists")
            if stats:
                console.print(f"    Chunks: {stats.get('unique_chunks', 0):,}")
                console.print(f"    Postings: {stats.get('total_postings', 0):,}")
        else:
            console.print(f"  [yellow]--[/yellow] _splade.db not found")

        if centralized["has_vectors"]:
            stats = centralized.get("vector_stats") or {}
            size_mb = stats.get("size_bytes", 0) / (1024 * 1024)
            console.print(f"  [green]OK[/green] _vectors.hnsw exists ({size_mb:.1f} MB)")
        else:
            console.print(f"  [yellow]--[/yellow] _vectors.hnsw not found")
        console.print()

        # Migration action
        if not dry_run and needs_migration:
            _set_index_version(index_root, INDEX_FORMAT_VERSION)
            console.print(f"[green]OK[/green] Version marker created: {INDEX_FORMAT_VERSION}")
        elif dry_run:
            console.print(f"[yellow]DRY RUN:[/yellow] Would create version marker: {INDEX_FORMAT_VERSION}")

        # Recommendations
        if migration_report["recommendations"]:
            console.print("\n[bold]Recommendations:[/bold]")
            for rec in migration_report["recommendations"]:
                console.print(f"  [cyan]>[/cyan] {rec}")


# ==================== Deprecated Command Aliases ====================
# These commands maintain backward compatibility with the old CLI structure.
# They display deprecation warnings and delegate to the new `index` subcommands.


@app.command("embeddings-generate", hidden=True, deprecated=True)
def embeddings_generate_deprecated(
    path: Path = typer.Argument(
        ...,
        exists=True,
        help="Path to _index.db file or project directory.",
    ),
    backend: str = typer.Option(
        "fastembed",
        "--backend",
        "-b",
        help="Embedding backend: fastembed (local) or litellm (remote API).",
    ),
    model: str = typer.Option(
        "code",
        "--model",
        "-m",
        help="Model: profile name for fastembed or model name for litellm.",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Force regeneration even if embeddings exist.",
    ),
    chunk_size: int = typer.Option(
        2000,
        "--chunk-size",
        help="Maximum chunk size in characters.",
    ),
    max_workers: int = typer.Option(
        1,
        "--max-workers",
        "-w",
        min=1,
        help="Max concurrent API calls.",
    ),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
    centralized: bool = typer.Option(
        True,
        "--centralized/--distributed",
        "-c/-d",
        help="Use centralized vector storage (default) or distributed.",
    ),
) -> None:
    """[Deprecated] Use 'codexlens index embeddings' instead."""
    _deprecated_command_warning("embeddings-generate", "index embeddings")
    index_embeddings(
        path=path,
        backend=backend,
        model=model,
        force=force,
        chunk_size=chunk_size,
        max_workers=max_workers,
        json_mode=json_mode,
        verbose=verbose,
        centralized=centralized,
    )


@app.command("init", hidden=True, deprecated=True)
def init_deprecated(
    path: Path = typer.Argument(Path("."), exists=True, file_okay=False, dir_okay=True, help="Project root to index."),
    language: Optional[List[str]] = typer.Option(None, "--language", "-l", help="Limit indexing to specific languages."),
    workers: Optional[int] = typer.Option(None, "--workers", "-w", min=1, help="Parallel worker processes."),
    force: bool = typer.Option(False, "--force", "-f", help="Force full reindex."),
    no_embeddings: bool = typer.Option(False, "--no-embeddings", help="Skip automatic embedding generation."),
    backend: str = typer.Option("fastembed", "--backend", "-b", help="Embedding backend."),
    model: str = typer.Option("code", "--model", "-m", help="Embedding model."),
    max_workers: int = typer.Option(1, "--max-workers", min=1, help="Max concurrent API calls."),
    json_mode: bool = typer.Option(False, "--json", help="Output JSON response."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging."),
) -> None:
    """[Deprecated] Use 'codexlens index init' instead."""
    _deprecated_command_warning("init", "index init")
    index_init(
        path=path,
        language=language,
        workers=workers,
        force=force,
        no_embeddings=no_embeddings,
        backend=backend,
        model=model,
        max_workers=max_workers,
        json_mode=json_mode,
        verbose=verbose,
    )


@app.command("splade-index", hidden=True, deprecated=True)
def splade_index_deprecated(
    path: Path = typer.Argument(..., help="Project path to index"),
    rebuild: bool = typer.Option(False, "--rebuild", "-r", help="Force rebuild SPLADE index"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose output."),
) -> None:
    """[Deprecated] Use 'codexlens index splade' instead."""
    _deprecated_command_warning("splade-index", "index splade")
    index_splade(
        path=path,
        rebuild=rebuild,
        verbose=verbose,
    )


@app.command("cascade-index", hidden=True, deprecated=True)
def cascade_index_deprecated(
    path: Annotated[Path, typer.Argument(help="Directory to index")],
    force: Annotated[bool, typer.Option("--force", "-f", help="Force regenerate")] = False,
    batch_size: Annotated[int, typer.Option("--batch-size", "-b", help="Batch size for embedding")] = 32,
    json_mode: Annotated[bool, typer.Option("--json", help="Output JSON response")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable verbose logging")] = False,
) -> None:
    """[Deprecated] Use 'codexlens index binary' instead."""
    _deprecated_command_warning("cascade-index", "index binary")
    index_binary(
        path=path,
        force=force,
        batch_size=batch_size,
        json_mode=json_mode,
        verbose=verbose,
    )


@app.command("index-migrate", hidden=True, deprecated=True)
def index_migrate_deprecated(
    path: Annotated[Optional[str], typer.Argument(help="Project path to migrate")] = None,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Show what would be migrated")] = False,
    force: Annotated[bool, typer.Option("--force", help="Force migration")] = False,
    json_mode: Annotated[bool, typer.Option("--json", help="Output JSON response")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable verbose output")] = False,
) -> None:
    """[Deprecated] Use 'codexlens index migrate' instead."""
    _deprecated_command_warning("index-migrate", "index migrate")
    index_migrate_cmd(
        path=path,
        dry_run=dry_run,
        force=force,
        json_mode=json_mode,
        verbose=verbose,
    )

