"""Watcher manager for coordinating file watching and incremental indexing."""

from __future__ import annotations

import json
import logging
import signal
import threading
import time
from pathlib import Path
from typing import Callable, List, Optional

from codexlens.config import Config
from codexlens.storage.path_mapper import PathMapper
from codexlens.storage.registry import RegistryStore

from .events import FileEvent, IndexResult, PendingQueueStatus, WatcherConfig, WatcherStats
from .file_watcher import FileWatcher
from .incremental_indexer import IncrementalIndexer

logger = logging.getLogger(__name__)


class WatcherManager:
    """High-level manager for file watching and incremental indexing.
    
    Coordinates FileWatcher and IncrementalIndexer with:
    - Lifecycle management (start/stop)
    - Signal handling (SIGINT/SIGTERM)
    - Statistics tracking
    - Graceful shutdown
    """
    
    def __init__(
        self,
        root_path: Path,
        config: Optional[Config] = None,
        watcher_config: Optional[WatcherConfig] = None,
        on_indexed: Optional[Callable[[IndexResult], None]] = None,
        on_queue_change: Optional[Callable[[PendingQueueStatus], None]] = None,
    ) -> None:
        self.root_path = Path(root_path).resolve()
        self.config = config or Config()
        self.watcher_config = watcher_config or WatcherConfig()
        self.on_indexed = on_indexed
        self.on_queue_change = on_queue_change

        self._registry: Optional[RegistryStore] = None
        self._mapper: Optional[PathMapper] = None
        self._watcher: Optional[FileWatcher] = None
        self._indexer: Optional[IncrementalIndexer] = None

        self._running = False
        self._stop_event = threading.Event()
        self._lock = threading.RLock()

        # Statistics
        self._stats = WatcherStats()
        self._original_sigint = None
        self._original_sigterm = None

        # Index history for tracking recent results
        self._index_history: List[IndexResult] = []
        self._max_history_size = 10
    
    def _handle_changes(self, events: List[FileEvent]) -> None:
        """Handle file change events from watcher."""
        if not self._indexer or not events:
            return

        logger.info("Processing %d file changes", len(events))
        result = self._indexer.process_changes(events)

        # Update stats
        self._stats.events_processed += len(events)
        self._stats.last_event_time = time.time()

        # Save to history
        self._index_history.append(result)
        if len(self._index_history) > self._max_history_size:
            self._index_history.pop(0)

        if result.files_indexed > 0 or result.files_removed > 0:
            logger.info(
                "Indexed %d files, removed %d files, %d errors",
                result.files_indexed, result.files_removed, len(result.errors)
            )

        # Output JSON for TypeScript backend parsing
        result_data = {
            "files_indexed": result.files_indexed,
            "files_removed": result.files_removed,
            "symbols_added": result.symbols_added,
            "symbols_removed": result.symbols_removed,
            "files_success": result.files_success[:20],  # Limit output
            "files_failed": result.files_failed[:20],
            "errors": result.errors[:10],
            "timestamp": result.timestamp
        }
        print(f"[INDEX_RESULT] {json.dumps(result_data)}", flush=True)

        if self.on_indexed:
            try:
                self.on_indexed(result)
            except Exception as exc:
                logger.error("Error in on_indexed callback: %s", exc)
    
    def _signal_handler(self, signum, frame) -> None:
        """Handle shutdown signals."""
        logger.info("Received signal %d, stopping...", signum)
        self.stop()
    
    def _install_signal_handlers(self) -> None:
        """Install signal handlers for graceful shutdown."""
        try:
            self._original_sigint = signal.signal(signal.SIGINT, self._signal_handler)
            if hasattr(signal, 'SIGTERM'):
                self._original_sigterm = signal.signal(signal.SIGTERM, self._signal_handler)
        except (ValueError, OSError):
            # Signal handling not available (e.g., not main thread)
            pass
    
    def _restore_signal_handlers(self) -> None:
        """Restore original signal handlers."""
        try:
            if self._original_sigint is not None:
                signal.signal(signal.SIGINT, self._original_sigint)
            if self._original_sigterm is not None and hasattr(signal, 'SIGTERM'):
                signal.signal(signal.SIGTERM, self._original_sigterm)
        except (ValueError, OSError):
            pass
    
    def start(self) -> None:
        """Start watching and indexing."""
        with self._lock:
            if self._running:
                logger.warning("WatcherManager already running")
                return
            
            # Validate path
            if not self.root_path.exists():
                raise ValueError(f"Root path does not exist: {self.root_path}")
            
            # Initialize components
            self._registry = RegistryStore()
            self._registry.initialize()
            self._mapper = PathMapper()
            
            self._indexer = IncrementalIndexer(
                self._registry, self._mapper, self.config
            )
            
            self._watcher = FileWatcher(
                self.root_path, self.watcher_config, self._handle_changes
            )

            # Always register queue change callback for stdout output (TypeScript backend)
            # The wrapper prints [QUEUE_STATUS] JSON and optionally calls on_queue_change
            self._watcher.register_queue_change_callback(self._on_queue_change_wrapper)

            # Install signal handlers
            self._install_signal_handlers()
            
            # Start watcher
            self._running = True
            self._stats.is_running = True
            self._stop_event.clear()
            self._watcher.start()
            
            logger.info("WatcherManager started for: %s", self.root_path)
    
    def stop(self) -> None:
        """Stop watching and clean up."""
        with self._lock:
            if not self._running:
                return
            
            self._running = False
            self._stats.is_running = False
            self._stop_event.set()
            
            # Stop watcher
            if self._watcher:
                self._watcher.stop()
                self._watcher = None
            
            # Close indexer
            if self._indexer:
                self._indexer.close()
                self._indexer = None
            
            # Close registry
            if self._registry:
                self._registry.close()
                self._registry = None
            
            # Restore signal handlers
            self._restore_signal_handlers()
            
            logger.info("WatcherManager stopped")
    
    def wait(self) -> None:
        """Block until stopped."""
        try:
            while self._running:
                self._stop_event.wait(timeout=1.0)
        except KeyboardInterrupt:
            logger.info("Interrupted, stopping...")
            self.stop()
    
    @property
    def is_running(self) -> bool:
        """Check if manager is running."""
        return self._running
    
    def get_stats(self) -> WatcherStats:
        """Get runtime statistics."""
        return WatcherStats(
            files_watched=self._stats.files_watched,
            events_processed=self._stats.events_processed,
            last_event_time=self._stats.last_event_time,
            is_running=self._running,
        )

    def _on_queue_change_wrapper(self, status: PendingQueueStatus) -> None:
        """Wrapper for queue change callback with JSON output."""
        # Output JSON for TypeScript backend parsing
        status_data = {
            "file_count": status.file_count,
            "files": status.files,
            "countdown_seconds": status.countdown_seconds,
            "last_event_time": status.last_event_time
        }
        print(f"[QUEUE_STATUS] {json.dumps(status_data)}", flush=True)

        if self.on_queue_change:
            try:
                self.on_queue_change(status)
            except Exception as exc:
                logger.error("Error in on_queue_change callback: %s", exc)

    def flush_now(self) -> None:
        """Immediately flush pending queue (manual trigger)."""
        if self._watcher:
            self._watcher.flush_now()

    def get_pending_queue_status(self) -> Optional[PendingQueueStatus]:
        """Get current pending queue status."""
        if self._watcher:
            return self._watcher.get_pending_queue_status()
        return None

    def get_index_history(self, limit: int = 5) -> List[IndexResult]:
        """Get recent index history."""
        return self._index_history[-limit:]
