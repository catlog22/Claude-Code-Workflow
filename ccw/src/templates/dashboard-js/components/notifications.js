// ==========================================
// NOTIFICATIONS COMPONENT
// ==========================================
// Real-time silent refresh (no notification bubbles)

/**
 * Format JSON object for display in notifications
 * Parses JSON strings and formats objects into readable key-value pairs
 * @param {Object|string} obj - Object or JSON string to format
 * @param {number} maxLen - Max string length (unused, kept for compatibility)
 * @returns {string} Formatted string with key: value pairs
 */
function formatJsonDetails(obj, maxLen = 150) {
  // Handle null/undefined
  if (obj === null || obj === undefined) return '';

  // If it is a string, try to parse as JSON
  if (typeof obj === 'string') {
    // Check if it looks like JSON
    const trimmed = obj.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        obj = JSON.parse(trimmed);
      } catch (e) {
        // Not valid JSON, return as-is
        return obj;
      }
    } else {
      // Plain string, return as-is
      return obj;
    }
  }

  // Handle non-objects (numbers, booleans, etc.)
  if (typeof obj !== 'object') return String(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '(empty array)';
    return obj.slice(0, 5).map((item, i) => {
      const itemStr = typeof item === 'object' ? JSON.stringify(item) : String(item);
      return `[${i}] ${itemStr.length > 50 ? itemStr.substring(0, 47) + '...' : itemStr}`;
    }).join('\n') + (obj.length > 5 ? `\n... +${obj.length - 5} more` : '');
  }

  // Handle objects - format as readable key: value pairs
  try {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '(empty object)';

    // Format each entry with proper value display
    const lines = entries.slice(0, 8).map(([key, val]) => {
      let valStr;
      if (val === null) {
        valStr = 'null';
      } else if (val === undefined) {
        valStr = 'undefined';
      } else if (typeof val === 'boolean') {
        valStr = val ? 'true' : 'false';
      } else if (typeof val === 'number') {
        valStr = String(val);
      } else if (typeof val === 'object') {
        valStr = JSON.stringify(val);
        if (valStr.length > 40) valStr = valStr.substring(0, 37) + '...';
      } else {
        valStr = String(val);
        if (valStr.length > 50) valStr = valStr.substring(0, 47) + '...';
      }
      return `${key}: ${valStr}`;
    });

    if (entries.length > 8) {
      lines.push(`... +${entries.length - 8} more fields`);
    }

    return lines.join('\n');
  } catch (e) {
    // Fallback to stringified version
    const str = JSON.stringify(obj);
    return str.length > 200 ? str.substring(0, 197) + '...' : str;
  }
}

let wsConnection = null;
let autoRefreshInterval = null;
let lastDataHash = null;
const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 seconds

// Custom event handlers registry for components to subscribe to specific events
const wsEventHandlers = {};

/**
 * Register a custom handler for a specific WebSocket event type
 * @param {string} eventType - The event type to listen for
 * @param {Function} handler - The handler function
 */
function registerWsEventHandler(eventType, handler) {
  if (!wsEventHandlers[eventType]) {
    wsEventHandlers[eventType] = [];
  }
  wsEventHandlers[eventType].push(handler);
}

/**
 * Unregister a custom handler for a specific WebSocket event type
 * @param {string} eventType - The event type
 * @param {Function} handler - The handler function to remove
 */
function unregisterWsEventHandler(eventType, handler) {
  if (wsEventHandlers[eventType]) {
    wsEventHandlers[eventType] = wsEventHandlers[eventType].filter(h => h !== handler);
  }
}

/**
 * Dispatch event to registered handlers
 * @param {string} eventType - The event type
 * @param {Object} data - The full event data
 */
function dispatchToEventHandlers(eventType, data) {
  if (wsEventHandlers[eventType]) {
    wsEventHandlers[eventType].forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error('[WS] Error in custom handler for', eventType, e);
      }
    });
  }
}

// ========== WebSocket Connection ==========
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      console.log('[WS] Connected');
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleNotification(data);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    wsConnection.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 5s...');
      setTimeout(initWebSocket, 5000);
    };

    wsConnection.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
  } catch (e) {
    console.log('[WS] WebSocket not available, using polling');
  }
}

// ========== Notification Handler ==========
function handleNotification(data) {
  const { type, payload } = data;

  // Silent refresh - no notification bubbles
  switch (type) {
    case 'session_updated':
    case 'summary_written':
    case 'task_completed':
    case 'new_session':
      // Just refresh data silently
      refreshIfNeeded();
      // Optionally highlight in carousel if it's the current session
      if (payload.sessionId && typeof carouselGoTo === 'function') {
        carouselGoTo(payload.sessionId);
      }
      break;

    case 'SESSION_CREATED':
    case 'SESSION_ARCHIVED':
    case 'TASK_UPDATED':
    case 'SESSION_UPDATED':
    case 'TASK_CREATED':
    case 'SUMMARY_WRITTEN':
    case 'PLAN_UPDATED':
    case 'REVIEW_UPDATED':
    case 'CONTENT_WRITTEN':
    case 'FILE_DELETED':
    case 'DIRECTORY_CREATED':
      // Route to state reducer for granular updates
      if (typeof handleWorkflowEvent === 'function') {
        handleWorkflowEvent({ type, ...payload });
      } else {
        // Fallback to full refresh if reducer not available
        refreshIfNeeded();
      }
      break;

    case 'tool_execution':
      // Handle tool execution notifications from MCP tools
      handleToolExecutionNotification(payload);
      break;

    case 'cli_execution':
      // Handle CLI command notifications (ccw cli -p)
      handleCliCommandNotification(payload);
      break;

    // CLI Tool Execution Events
    case 'CLI_EXECUTION_STARTED':
      if (typeof handleCliExecutionStarted === 'function') {
        handleCliExecutionStarted(payload);
      }
      // Route to CLI Stream Viewer
      if (typeof handleCliStreamStarted === 'function') {
        handleCliStreamStarted(payload);
      }
      break;

    case 'CLI_OUTPUT':
      if (typeof handleCliOutput === 'function') {
        handleCliOutput(payload);
      }
      // Route to CLI Stream Viewer
      if (typeof handleCliStreamOutput === 'function') {
        handleCliStreamOutput(payload);
      }
      break;

    case 'CLI_EXECUTION_COMPLETED':
      if (typeof handleCliExecutionCompleted === 'function') {
        handleCliExecutionCompleted(payload);
      }
      // Route to CLI Stream Viewer
      if (typeof handleCliStreamCompleted === 'function') {
        handleCliStreamCompleted(payload);
      }
      break;

    case 'CLI_EXECUTION_ERROR':
      if (typeof handleCliExecutionError === 'function') {
        handleCliExecutionError(payload);
      }
      // Route to CLI Stream Viewer
      if (typeof handleCliStreamError === 'function') {
        handleCliStreamError(payload);
      }
      break;

    // CLI Review Events
    case 'CLI_REVIEW_UPDATED':
      if (typeof handleCliReviewUpdated === 'function') {
        handleCliReviewUpdated(payload);
      }
      // Also refresh CLI history to show review status
      if (typeof refreshCliHistory === 'function') {
        refreshCliHistory();
      }
      break;

    // System Notify Events (from CLI commands)
    case 'REFRESH_REQUIRED':
      handleRefreshRequired(payload);
      break;

    case 'MEMORY_UPDATED':
      if (typeof handleMemoryUpdated === 'function') {
        handleMemoryUpdated(payload);
      }
      // Force refresh of memory view
      if (typeof loadMemoryStats === 'function') {
        loadMemoryStats().then(function() {
          if (typeof renderHotspotsColumn === 'function') renderHotspotsColumn();
        }).catch(function(err) {
          console.error('[Memory] Failed to refresh stats:', err);
        });
      }
      break;

    case 'HISTORY_UPDATED':
      // Refresh CLI history when updated externally
      if (typeof refreshCliHistory === 'function') {
        refreshCliHistory();
      }
      break;

    case 'INSIGHT_GENERATED':
      // Refresh insights when new insight is generated
      if (typeof loadInsightsHistory === 'function') {
        loadInsightsHistory();
      }
      break;

    case 'ACTIVE_MEMORY_SYNCED':
      // Handle Active Memory sync completion
      if (typeof addGlobalNotification === 'function') {
        const { filesAnalyzed, tool, usedCli } = payload;
        const method = usedCli ? `CLI (${tool})` : 'Basic';
        addGlobalNotification(
          'success',
          'Active Memory synced',
          {
            'Files Analyzed': filesAnalyzed,
            'Method': method,
            'Timestamp': new Date(payload.timestamp).toLocaleTimeString()
          },
          'Memory'
        );
      }
      // Refresh Active Memory status
      if (typeof loadActiveMemoryStatus === 'function') {
        loadActiveMemoryStatus().catch(function(err) {
          console.error('[Active Memory] Failed to refresh status:', err);
        });
      }
      console.log('[Active Memory] Sync completed:', payload);
      break;

    case 'CLAUDE_FILE_SYNCED':
      // Handle CLAUDE.md file sync completion
      if (typeof addGlobalNotification === 'function') {
        const { path, level, tool, mode } = payload;
        const fileName = path.split(/[/\\]/).pop();
        addGlobalNotification(
          'success',
          `${fileName} synced`,
          {
            'Level': level,
            'Tool': tool,
            'Mode': mode,
            'Time': new Date(payload.timestamp).toLocaleTimeString()
          },
          'CLAUDE.md'
        );
      }
      // Refresh file list
      if (typeof loadClaudeFiles === 'function') {
        loadClaudeFiles().then(() => {
          // Re-render the view to show updated content
          if (typeof renderClaudeManager === 'function') {
            renderClaudeManager();
          }
        }).catch(err => console.error('[CLAUDE.md] Failed to refresh files:', err));
      }
      console.log('[CLAUDE.md] Sync completed:', payload);
      break;

    case 'CLI_TOOL_INSTALLED':
      // Handle CLI tool installation completion
      if (typeof addGlobalNotification === 'function') {
        const { tool } = payload;
        addGlobalNotification(
          'success',
          `${tool} installed successfully`,
          {
            'Tool': tool,
            'Time': new Date(payload.timestamp).toLocaleTimeString()
          },
          'CLI Tools'
        );
      }
      // Refresh CLI manager
      if (typeof loadCliToolStatus === 'function') {
        loadCliToolStatus().then(() => {
          if (typeof renderToolsSection === 'function') {
            renderToolsSection();
          }
        }).catch(err => console.error('[CLI Tools] Failed to refresh status:', err));
      }
      console.log('[CLI Tools] Installation completed:', payload);
      break;

    case 'CLI_TOOL_UNINSTALLED':
      // Handle CLI tool uninstallation completion
      if (typeof addGlobalNotification === 'function') {
        const { tool } = payload;
        addGlobalNotification(
          'success',
          `${tool} uninstalled successfully`,
          {
            'Tool': tool,
            'Time': new Date(payload.timestamp).toLocaleTimeString()
          },
          'CLI Tools'
        );
      }
      // Refresh CLI manager
      if (typeof loadCliToolStatus === 'function') {
        loadCliToolStatus().then(() => {
          if (typeof renderToolsSection === 'function') {
            renderToolsSection();
          }
        }).catch(err => console.error('[CLI Tools] Failed to refresh status:', err));
      }
      console.log('[CLI Tools] Uninstallation completed:', payload);
      break;

    case 'CODEXLENS_INSTALLED':
      // Handle CodexLens installation completion
      if (typeof addGlobalNotification === 'function') {
        const { version } = payload;
        addGlobalNotification(
          'success',
          `CodexLens installed successfully`,
          {
            'Version': version || 'latest',
            'Time': new Date(payload.timestamp).toLocaleTimeString()
          },
          'CodexLens'
        );
      }
      // Refresh CLI status if active
      if (typeof loadCodexLensStatus === 'function') {
        loadCodexLensStatus().then(() => {
          if (typeof renderCliStatus === 'function') {
            renderCliStatus();
          }
        });
      }
      console.log('[CodexLens] Installation completed:', payload);
      break;

    case 'CODEXLENS_UNINSTALLED':
      // Handle CodexLens uninstallation completion
      if (typeof addGlobalNotification === 'function') {
        addGlobalNotification(
          'success',
          `CodexLens uninstalled successfully`,
          {
            'Time': new Date(payload.timestamp).toLocaleTimeString()
          },
          'CodexLens'
        );
      }
      // Refresh CLI status if active
      if (typeof loadCodexLensStatus === 'function') {
        loadCodexLensStatus().then(() => {
          if (typeof renderCliStatus === 'function') {
            renderCliStatus();
          }
        });
      }
      console.log('[CodexLens] Uninstallation completed:', payload);
      break;

    case 'CODEXLENS_INDEX_PROGRESS':
      // Handle CodexLens index progress updates
      dispatchToEventHandlers('CODEXLENS_INDEX_PROGRESS', data);
      console.log('[CodexLens] Index progress:', payload.stage, payload.percent + '%');
      break;

    case 'CODEXLENS_WATCHER_STATUS':
      // Handle CodexLens file watcher status updates
      if (typeof handleWatcherStatusUpdate === 'function') {
        handleWatcherStatusUpdate(payload);
      }
      if (payload.error) {
        console.error('[CodexLens] Watcher error:', payload.error);
        if (typeof showRefreshToast === 'function') {
          showRefreshToast('Watcher error: ' + payload.error, 'error');
        }
      } else if (payload.running) {
        console.log('[CodexLens] Watcher running:', payload.path);
      } else {
        console.log('[CodexLens] Watcher stopped');
      }
      break;

    case 'CODEXLENS_WATCHER_UPDATE':
      // Handle CodexLens watcher real-time updates (file changes detected)
      if (typeof handleWatcherStatusUpdate === 'function') {
        handleWatcherStatusUpdate(payload);
      }
      console.log('[CodexLens] Watcher update:', payload.events_processed, 'events');
      break;

    case 'CODEXLENS_WATCHER_QUEUE_UPDATE':
      // Handle pending queue status updates
      if (typeof updatePendingQueueUI === 'function') {
        updatePendingQueueUI(payload.queue);
      }
      // Add activity log entries only for NEW files (not already logged)
      if (payload.queue && payload.queue.files && payload.queue.files.length > 0) {
        if (typeof addWatcherLogEntry === 'function') {
          // Track logged files to avoid duplicates
          window._watcherLoggedFiles = window._watcherLoggedFiles || new Set();
          var newFiles = payload.queue.files.filter(function(f) {
            return !window._watcherLoggedFiles.has(f);
          });
          // Only show first few new files to avoid spam
          newFiles.slice(0, 5).forEach(function(fileName) {
            window._watcherLoggedFiles.add(fileName);
            addWatcherLogEntry('modified', fileName);
          });
          // Clear tracking when queue is empty (after flush)
          if (payload.queue.file_count === 0) {
            window._watcherLoggedFiles.clear();
          }
        }
      }
      console.log('[CodexLens] Queue update:', payload.queue?.file_count, 'files pending');
      break;

    case 'CODEXLENS_WATCHER_INDEX_COMPLETE':
      // Handle index completion event
      if (typeof updateLastIndexResult === 'function') {
        updateLastIndexResult(payload.result);
      }
      // Clear logged files tracking after index completes
      if (window._watcherLoggedFiles) {
        window._watcherLoggedFiles.clear();
      }
      // Add activity log entry for index completion
      if (typeof addWatcherLogEntry === 'function' && payload.result) {
        var summary = 'Indexed ' + (payload.result.files_indexed || 0) + ' files';
        addWatcherLogEntry('indexed', summary);
      }
      // Show toast notification
      if (typeof showRefreshToast === 'function' && payload.result) {
        var indexMsg = 'Indexed ' + (payload.result.files_indexed || 0) + ' files, ' +
                       (payload.result.symbols_added || 0) + ' symbols';
        var toastType = (payload.result.errors && payload.result.errors.length > 0) ? 'warning' : 'success';
        showRefreshToast(indexMsg, toastType);
      }
      console.log('[CodexLens] Index complete:', payload.result?.files_indexed, 'files indexed');
      break;

    default:
      console.log('[WS] Unknown notification type:', type);
  }
}

/**
 * Handle tool execution notifications from MCP tools
 * @param {Object} payload - Tool execution payload
 */
function handleToolExecutionNotification(payload) {
  const { toolName, status, params, result, error, timestamp } = payload;

  // Determine notification type and message
  let notifType = 'info';
  let message = `Tool: ${toolName}`;
  let details = null;

  switch (status) {
    case 'started':
      notifType = 'info';
      message = `Executing ${toolName}...`;
      // Pass raw object for HTML formatting
      if (params) {
        details = params;
      }
      break;

    case 'completed':
      notifType = 'success';
      message = `${toolName} completed`;
      // Pass raw object for HTML formatting
      if (result) {
        if (result._truncated) {
          details = result.preview;
        } else {
          details = result;
        }
      }
      break;

    case 'failed':
      notifType = 'error';
      message = `${toolName} failed`;
      details = error || 'Unknown error';
      break;

    default:
      notifType = 'info';
      message = `${toolName}: ${status}`;
  }

  // Add to global notifications - pass objects directly for HTML formatting
  if (typeof addGlobalNotification === 'function') {
    addGlobalNotification(notifType, message, details, 'MCP');
  }

  // Log to console
  console.log(`[MCP] ${status}: ${toolName}`, payload);
}

/**
 * Handle CLI command notifications (ccw cli -p)
 * @param {Object} payload - CLI execution payload
 */
function handleCliCommandNotification(payload) {
  const { event, tool, mode, prompt_preview, execution_id, success, duration_ms, status, error, turn_count, custom_id } = payload;

  let notifType = 'info';
  let message = '';
  let details = null;

  switch (event) {
    case 'started':
      notifType = 'info';
      message = `CLI ${tool} started`;
      // Pass structured object for rich display
      details = {
        mode: mode,
        prompt: prompt_preview
      };
      if (custom_id) {
        details.id = custom_id;
      }
      break;

    case 'completed':
      if (success) {
        notifType = 'success';
        const turnStr = turn_count > 1 ? ` (turn ${turn_count})` : '';
        message = `CLI ${tool} completed${turnStr}`;
        // Pass structured object for rich display
        details = {
          duration: duration_ms ? `${(duration_ms / 1000).toFixed(1)}s` : '-',
          execution_id: execution_id
        };
        if (turn_count > 1) {
          details.turns = turn_count;
        }
      } else {
        notifType = 'error';
        message = `CLI ${tool} failed`;
        details = {
          status: status || 'Unknown error',
          execution_id: execution_id
        };
      }
      break;

    case 'error':
      notifType = 'error';
      message = `CLI ${tool} error`;
      details = error || 'Unknown error';
      break;

    default:
      notifType = 'info';
      message = `CLI ${tool}: ${event}`;
  }

  // Add to global notifications - pass objects for HTML formatting
  if (typeof addGlobalNotification === 'function') {
    addGlobalNotification(notifType, message, details, 'CLI');
  }

  // Refresh CLI history if on history view
  if (event === 'completed' && typeof currentView !== 'undefined' && 
      (currentView === 'history' || currentView === 'cli-history')) {
    if (typeof loadCliHistory === 'function' && typeof renderCliHistoryView === 'function') {
      loadCliHistory().then(() => renderCliHistoryView());
    }
  }

  // Log to console
  console.log(`[CLI Command] ${event}: ${tool}`, payload);
}

// ========== Auto Refresh ==========
function initAutoRefresh() {
  // Calculate initial hash
  lastDataHash = calculateDataHash();

  // Start polling interval
  autoRefreshInterval = setInterval(checkForChanges, AUTO_REFRESH_INTERVAL_MS);
}

function calculateDataHash() {
  if (!workflowData) return null;

  // Simple hash based on key data points
  const hashData = {
    activeSessions: (workflowData.activeSessions || []).length,
    archivedSessions: (workflowData.archivedSessions || []).length,
    totalTasks: workflowData.statistics?.totalTasks || 0,
    completedTasks: workflowData.statistics?.completedTasks || 0,
    generatedAt: workflowData.generatedAt
  };

  return JSON.stringify(hashData);
}

async function checkForChanges() {
  if (!window.SERVER_MODE) return;

  try {
    const response = await fetch(`/api/data?path=${encodeURIComponent(projectPath)}`);
    if (!response.ok) return;

    const newData = await response.json();
    const newHash = JSON.stringify({
      activeSessions: (newData.activeSessions || []).length,
      archivedSessions: (newData.archivedSessions || []).length,
      totalTasks: newData.statistics?.totalTasks || 0,
      completedTasks: newData.statistics?.completedTasks || 0,
      generatedAt: newData.generatedAt
    });

    if (newHash !== lastDataHash) {
      lastDataHash = newHash;
      // Silent refresh - no notification
      await refreshWorkspaceData(newData);
    }
  } catch (e) {
    console.error('[AutoRefresh] Check failed:', e);
  }
}

async function refreshIfNeeded() {
  if (!window.SERVER_MODE) return;

  try {
    const response = await fetch(`/api/data?path=${encodeURIComponent(projectPath)}`);
    if (!response.ok) return;

    const newData = await response.json();
    await refreshWorkspaceData(newData);
  } catch (e) {
    console.error('[Refresh] Failed:', e);
  }
}

async function refreshWorkspaceData(newData) {
  // Update global data
  window.workflowData = newData;

  // Clear and repopulate stores
  Object.keys(sessionDataStore).forEach(k => delete sessionDataStore[k]);
  Object.keys(liteTaskDataStore).forEach(k => delete liteTaskDataStore[k]);

  [...(newData.activeSessions || []), ...(newData.archivedSessions || [])].forEach(s => {
    const key = `session-${s.session_id}`.replace(/[^a-zA-Z0-9-]/g, '-');
    sessionDataStore[key] = s;
  });

  [...(newData.liteTasks?.litePlan || []), ...(newData.liteTasks?.liteFix || [])].forEach(s => {
    const key = `lite-${s.session_id}`.replace(/[^a-zA-Z0-9-]/g, '-');
    liteTaskDataStore[key] = s;
  });

  // Update UI silently
  updateStats();
  updateBadges();
  updateCarousel();

  // Re-render current view if needed
  if (currentView === 'sessions') {
    renderSessions();
  } else if (currentView === 'liteTasks') {
    renderLiteTasks();
  }

  lastDataHash = calculateDataHash();
}

/**
 * Handle REFRESH_REQUIRED events from CLI commands
 * @param {Object} payload - Contains scope (memory|history|insights|all)
 */
function handleRefreshRequired(payload) {
  const scope = payload?.scope || 'all';
  console.log('[WS] Refresh required for scope:', scope);

  switch (scope) {
    case 'memory':
      // Refresh memory stats and graph
      if (typeof loadMemoryStats === 'function') {
        loadMemoryStats().then(function() {
          if (typeof renderHotspotsColumn === 'function') renderHotspotsColumn();
        });
      }
      if (typeof loadMemoryGraph === 'function') {
        loadMemoryGraph();
      }
      break;

    case 'history':
      // Refresh CLI history
      if (typeof refreshCliHistory === 'function') {
        refreshCliHistory();
      }
      break;

    case 'insights':
      // Refresh insights history
      if (typeof loadInsightsHistory === 'function') {
        loadInsightsHistory();
      }
      break;

    case 'all':
    default:
      // Refresh everything
      refreshIfNeeded();
      if (typeof loadMemoryStats === 'function') {
        loadMemoryStats().then(function() {
          if (typeof renderHotspotsColumn === 'function') renderHotspotsColumn();
        });
      }
      if (typeof refreshCliHistory === 'function') {
        refreshCliHistory();
      }
      if (typeof loadInsightsHistory === 'function') {
        loadInsightsHistory();
      }
      break;
  }
}

// ========== Cleanup ==========
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

function closeWebSocket() {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}

// ========== Navigation Helper ==========
function goToSession(sessionId) {
  // Find session in carousel and navigate
  const sessionKey = `session-${sessionId}`.replace(/[^a-zA-Z0-9-]/g, '-');

  // Jump to session in carousel if visible
  if (typeof carouselGoTo === 'function') {
    carouselGoTo(sessionId);
  }

  // Navigate to session detail
  if (sessionDataStore[sessionKey]) {
    showSessionDetailPage(sessionKey);
  }
}
