"""Event types for file watcher."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List, Optional, Set


class ChangeType(Enum):
    """Type of file system change."""
    CREATED = "created"
    MODIFIED = "modified"
    DELETED = "deleted"
    MOVED = "moved"


@dataclass
class FileEvent:
    """A file system change event."""
    path: Path
    change_type: ChangeType
    timestamp: float
    old_path: Optional[Path] = None  # For MOVED events


@dataclass
class WatcherConfig:
    """Configuration for file watcher."""
    debounce_ms: int = 60000  # Default 60 seconds for debounce
    ignored_patterns: Set[str] = field(default_factory=lambda: {
        # Version control
        ".git", ".svn", ".hg",
        # Python environments & cache
        ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        # Node.js
        "node_modules", "bower_components", ".npm", ".yarn",
        # Build artifacts
        "dist", "build", "out", "target", "bin", "obj", "_build", "coverage", "htmlcov",
        # IDE & Editor
        ".idea", ".vscode", ".vs", ".eclipse",
        # CodexLens internal
        ".codexlens",
        # Package manager caches
        ".cache", ".parcel-cache", ".turbo", ".next", ".nuxt",
        # Logs & temp
        "logs", "tmp", "temp",
    })
    languages: Optional[List[str]] = None  # None = all supported


@dataclass
class PendingQueueStatus:
    """Status of pending file changes queue."""
    file_count: int = 0
    files: List[str] = field(default_factory=list)  # Limited to 20 files
    countdown_seconds: int = 0
    last_event_time: Optional[float] = None


@dataclass
class IndexResult:
    """Result of processing file changes."""
    files_indexed: int = 0
    files_removed: int = 0
    symbols_added: int = 0
    symbols_removed: int = 0
    files_success: List[str] = field(default_factory=list)
    files_failed: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)


@dataclass
class WatcherStats:
    """Runtime statistics for watcher."""
    files_watched: int = 0
    events_processed: int = 0
    last_event_time: Optional[float] = None
    is_running: bool = False
