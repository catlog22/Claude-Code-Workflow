/**
 * CLI Stream Viewer Component
 * Real-time streaming output viewer for CLI executions
 */

// ===== State Management =====
let cliStreamExecutions = {};  // { executionId: { tool, mode, output, status, startTime, endTime } }
let activeStreamTab = null;
let autoScrollEnabled = true;
let isCliStreamViewerOpen = false;
let searchFilter = '';  // Search filter for output content

const MAX_OUTPUT_LINES = 5000;  // Prevent memory issues

// ===== State Synchronization =====
/**
 * Sync active executions from server
 * Called on initialization to recover state when view is opened mid-execution
 */
async function syncActiveExecutions() {
  // Only sync in server mode
  if (!window.SERVER_MODE) return;

  try {
    const response = await fetch('/api/cli/active');
    if (!response.ok) return;

    const { executions } = await response.json();
    if (!executions || executions.length === 0) return;

    executions.forEach(exec => {
      // Skip if already tracked (avoid overwriting live data)
      if (cliStreamExecutions[exec.id]) return;

      // Rebuild execution state
      cliStreamExecutions[exec.id] = {
        tool: exec.tool || 'cli',
        mode: exec.mode || 'analysis',
        output: [],
        status: exec.status || 'running',
        startTime: exec.startTime || Date.now(),
        endTime: null
      };

      // Add system start message
      cliStreamExecutions[exec.id].output.push({
        type: 'system',
        content: `[${new Date(exec.startTime).toLocaleTimeString()}] CLI execution started: ${exec.tool} (${exec.mode} mode)`,
        timestamp: exec.startTime
      });

      // Fill historical output (limit to last MAX_OUTPUT_LINES)
      if (exec.output) {
        const lines = exec.output.split('\n');
        const startIndex = Math.max(0, lines.length - MAX_OUTPUT_LINES + 1);
        lines.slice(startIndex).forEach(line => {
          if (line.trim()) {
            cliStreamExecutions[exec.id].output.push({
              type: 'stdout',
              content: line,
              timestamp: Date.now()
            });
          }
        });
      }
    });

    // Update UI if we recovered any executions
    if (executions.length > 0) {
      // Set active tab to first running execution
      const runningExec = executions.find(e => e.status === 'running');
      if (runningExec && !activeStreamTab) {
        activeStreamTab = runningExec.id;
      }

      renderStreamTabs();
      updateStreamBadge();

      // If viewer is open, render content
      if (isCliStreamViewerOpen) {
        renderStreamContent(activeStreamTab);
      }
    }

    console.log(`[CLI Stream] Synced ${executions.length} active execution(s)`);
  } catch (e) {
    console.error('[CLI Stream] Sync failed:', e);
  }
}

// ===== Initialization =====
function initCliStreamViewer() {
  // Initialize keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isCliStreamViewerOpen) {
      if (searchFilter) {
        clearSearch();
      } else {
        toggleCliStreamViewer();
      }
    }
    // Ctrl+F to focus search when viewer is open
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isCliStreamViewerOpen) {
      e.preventDefault();
      const searchInput = document.getElementById('cliStreamSearchInput');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // Initialize scroll detection for auto-scroll
  const content = document.getElementById('cliStreamContent');
  if (content) {
    content.addEventListener('scroll', handleStreamContentScroll);
  }

  // Sync active executions from server (recover state for mid-execution joins)
  syncActiveExecutions();
}

// ===== Panel Control =====
function toggleCliStreamViewer() {
  const viewer = document.getElementById('cliStreamViewer');
  const overlay = document.getElementById('cliStreamOverlay');
  
  if (!viewer || !overlay) return;
  
  isCliStreamViewerOpen = !isCliStreamViewerOpen;
  
  if (isCliStreamViewerOpen) {
    viewer.classList.add('open');
    overlay.classList.add('open');
    
    // If no active tab but have executions, select the first one
    if (!activeStreamTab && Object.keys(cliStreamExecutions).length > 0) {
      const firstId = Object.keys(cliStreamExecutions)[0];
      switchStreamTab(firstId);
    } else {
      renderStreamContent(activeStreamTab);
    }
    
    // Re-init lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } else {
    viewer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

// ===== WebSocket Event Handlers =====
function handleCliStreamStarted(payload) {
  const { executionId, tool, mode, timestamp } = payload;
  
  // Create new execution record
  cliStreamExecutions[executionId] = {
    tool: tool || 'cli',
    mode: mode || 'analysis',
    output: [],
    status: 'running',
    startTime: timestamp ? new Date(timestamp).getTime() : Date.now(),
    endTime: null
  };
  
  // Add system message
  cliStreamExecutions[executionId].output.push({
    type: 'system',
    content: `[${new Date().toLocaleTimeString()}] CLI execution started: ${tool} (${mode} mode)`,
    timestamp: Date.now()
  });
  
  // If this is the first execution or panel is open, select it
  if (!activeStreamTab || isCliStreamViewerOpen) {
    activeStreamTab = executionId;
  }
  
  renderStreamTabs();
  renderStreamContent(activeStreamTab);
  updateStreamBadge();
  
  // Auto-open panel if configured (optional)
  // if (!isCliStreamViewerOpen) toggleCliStreamViewer();
}

function handleCliStreamOutput(payload) {
  const { executionId, chunkType, data } = payload;
  
  const exec = cliStreamExecutions[executionId];
  if (!exec) return;
  
  // Parse and add output lines
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = content.split('\n');
  
  lines.forEach(line => {
    if (line.trim() || lines.length === 1) {  // Keep empty lines if it's the only content
      exec.output.push({
        type: chunkType || 'stdout',
        content: line,
        timestamp: Date.now()
      });
    }
  });
  
  // Trim if too long
  if (exec.output.length > MAX_OUTPUT_LINES) {
    exec.output = exec.output.slice(-MAX_OUTPUT_LINES);
  }
  
  // Update UI if this is the active tab
  if (activeStreamTab === executionId && isCliStreamViewerOpen) {
    requestAnimationFrame(() => {
      renderStreamContent(executionId);
    });
  }
  
  // Update badge to show activity
  updateStreamBadge();
}

function handleCliStreamCompleted(payload) {
  const { executionId, success, duration, timestamp } = payload;
  
  const exec = cliStreamExecutions[executionId];
  if (!exec) return;
  
  exec.status = success ? 'completed' : 'error';
  exec.endTime = timestamp ? new Date(timestamp).getTime() : Date.now();
  
  // Add completion message
  const durationText = duration ? ` (${formatDuration(duration)})` : '';
  const statusText = success ? 'completed successfully' : 'failed';
  exec.output.push({
    type: 'system',
    content: `[${new Date().toLocaleTimeString()}] CLI execution ${statusText}${durationText}`,
    timestamp: Date.now()
  });
  
  renderStreamTabs();
  if (activeStreamTab === executionId) {
    renderStreamContent(executionId);
  }
  updateStreamBadge();
}

function handleCliStreamError(payload) {
  const { executionId, error, timestamp } = payload;
  
  const exec = cliStreamExecutions[executionId];
  if (!exec) return;
  
  exec.status = 'error';
  exec.endTime = timestamp ? new Date(timestamp).getTime() : Date.now();
  
  // Add error message
  exec.output.push({
    type: 'stderr',
    content: `[ERROR] ${error || 'Unknown error occurred'}`,
    timestamp: Date.now()
  });
  
  renderStreamTabs();
  if (activeStreamTab === executionId) {
    renderStreamContent(executionId);
  }
  updateStreamBadge();
}

// ===== Message Type Parsing =====
const MESSAGE_TYPE_PATTERNS = {
  system: /^\[系统\]/,
  thinking: /^\[思考\]/,
  response: /^\[响应\]/,
  result: /^\[结果\]/,
  error: /^\[错误\]/,
  warning: /^\[警告\]/,
  info: /^\[信息\]/
};

const MESSAGE_TYPE_ICONS = {
  system: 'settings',
  thinking: 'brain',
  response: 'message-circle',
  result: 'check-circle',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info'
};

const MESSAGE_TYPE_LABELS = {
  system: '系统',
  thinking: '思考',
  response: '响应',
  result: '结果',
  error: '错误',
  warning: '警告',
  info: '信息'
};

/**
 * Parse message content to extract type and clean content
 * @param {string} content - Raw message content
 * @returns {{ type: string, label: string, content: string, hasPrefix: boolean }}
 */
function parseMessageType(content) {
  for (const [type, pattern] of Object.entries(MESSAGE_TYPE_PATTERNS)) {
    if (pattern.test(content)) {
      return {
        type,
        label: MESSAGE_TYPE_LABELS[type],
        content: content.replace(pattern, '').trim(),
        hasPrefix: true
      };
    }
  }
  return {
    type: 'default',
    label: '',
    content: content,
    hasPrefix: false
  };
}

/**
 * Render a formatted message line with type badge
 * @param {Object} line - Line object with type and content
 * @param {string} searchFilter - Current search filter
 * @returns {string} - HTML string
 */
function renderFormattedLine(line, searchFilter) {
  const parsed = parseMessageType(line.content);
  let content = escapeHtml(parsed.content);

  // Apply search highlighting
  if (searchFilter && searchFilter.trim()) {
    const searchRegex = new RegExp(`(${escapeRegex(searchFilter)})`, 'gi');
    content = content.replace(searchRegex, '<mark class="cli-stream-highlight">$1</mark>');
  }

  // Format code blocks
  content = formatCodeBlocks(content);

  // Format inline code
  content = content.replace(/`([^`]+)`/g, '<code class="cli-inline-code">$1</code>');

  // Build type badge if has prefix
  const typeBadge = parsed.hasPrefix ?
    `<span class="cli-msg-badge cli-msg-${parsed.type}">
      <i data-lucide="${MESSAGE_TYPE_ICONS[parsed.type] || 'circle'}"></i>
      <span>${parsed.label}</span>
    </span>` : '';

  // Determine line class based on original type and parsed type
  const lineClass = parsed.hasPrefix ? `cli-stream-line formatted ${parsed.type}` :
                    `cli-stream-line ${line.type}`;

  return `<div class="${lineClass}">${typeBadge}<span class="cli-msg-content">${content}</span></div>`;
}

/**
 * Format code blocks in content
 */
function formatCodeBlocks(content) {
  // Handle multi-line code blocks (already escaped)
  // Just apply styling class for now
  return content;
}

// ===== UI Rendering =====
function renderStreamTabs() {
  const tabsContainer = document.getElementById('cliStreamTabs');
  if (!tabsContainer) return;
  
  const execIds = Object.keys(cliStreamExecutions);
  
  if (execIds.length === 0) {
    tabsContainer.innerHTML = '';
    return;
  }
  
  // Sort: running first, then by start time (newest first)
  execIds.sort((a, b) => {
    const execA = cliStreamExecutions[a];
    const execB = cliStreamExecutions[b];
    
    if (execA.status === 'running' && execB.status !== 'running') return -1;
    if (execA.status !== 'running' && execB.status === 'running') return 1;
    return execB.startTime - execA.startTime;
  });
  
  tabsContainer.innerHTML = execIds.map(id => {
    const exec = cliStreamExecutions[id];
    const isActive = id === activeStreamTab;
    const canClose = exec.status !== 'running';
    
    return `
      <div class="cli-stream-tab ${isActive ? 'active' : ''}" 
           onclick="switchStreamTab('${id}')" 
           data-execution-id="${id}">
        <span class="cli-stream-tab-status ${exec.status}"></span>
        <span class="cli-stream-tab-tool">${escapeHtml(exec.tool)}</span>
        <span class="cli-stream-tab-mode">${exec.mode}</span>
        <button class="cli-stream-tab-close ${canClose ? '' : 'disabled'}" 
                onclick="event.stopPropagation(); closeStream('${id}')"
                title="${canClose ? _streamT('cliStream.close') : _streamT('cliStream.cannotCloseRunning')}"
                ${canClose ? '' : 'disabled'}>×</button>
      </div>
    `;
  }).join('');
  
  // Update count badge
  const countBadge = document.getElementById('cliStreamCountBadge');
  if (countBadge) {
    const runningCount = execIds.filter(id => cliStreamExecutions[id].status === 'running').length;
    countBadge.textContent = execIds.length;
    countBadge.classList.toggle('has-running', runningCount > 0);
  }
}

function renderStreamContent(executionId) {
  const contentContainer = document.getElementById('cliStreamContent');
  if (!contentContainer) return;

  const exec = executionId ? cliStreamExecutions[executionId] : null;

  if (!exec) {
    // Show empty state
    contentContainer.innerHTML = `
      <div class="cli-stream-empty">
        <i data-lucide="terminal"></i>
        <div class="cli-stream-empty-title" data-i18n="cliStream.noStreams">${_streamT('cliStream.noStreams')}</div>
        <div class="cli-stream-empty-hint" data-i18n="cliStream.noStreamsHint">${_streamT('cliStream.noStreamsHint')}</div>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  // Check if should auto-scroll
  const wasAtBottom = contentContainer.scrollHeight - contentContainer.scrollTop <= contentContainer.clientHeight + 50;

  // Filter output lines based on search
  let filteredOutput = exec.output;
  if (searchFilter.trim()) {
    const searchLower = searchFilter.toLowerCase();
    filteredOutput = exec.output.filter(line =>
      line.content.toLowerCase().includes(searchLower)
    );
  }

  // Render output lines with formatted styling
  contentContainer.innerHTML = filteredOutput.map(line =>
    renderFormattedLine(line, searchFilter)
  ).join('');

  // Initialize Lucide icons for message badges
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ attrs: { class: 'cli-msg-icon' } });
  }

  // Show filter result count if filtering
  if (searchFilter.trim() && filteredOutput.length !== exec.output.length) {
    const filterInfo = document.createElement('div');
    filterInfo.className = 'cli-stream-filter-info';
    filterInfo.textContent = `${filteredOutput.length} / ${exec.output.length} lines`;
    contentContainer.insertBefore(filterInfo, contentContainer.firstChild);
  }

  // Auto-scroll if enabled and was at bottom
  if (autoScrollEnabled && wasAtBottom) {
    contentContainer.scrollTop = contentContainer.scrollHeight;
  }

  // Update status bar
  renderStreamStatus(executionId);
}

function renderStreamStatus(executionId) {
  const statusContainer = document.getElementById('cliStreamStatus');
  if (!statusContainer) return;
  
  const exec = executionId ? cliStreamExecutions[executionId] : null;
  
  if (!exec) {
    statusContainer.innerHTML = '';
    return;
  }
  
  const duration = exec.endTime 
    ? formatDuration(exec.endTime - exec.startTime)
    : formatDuration(Date.now() - exec.startTime);
  
  const statusLabel = exec.status === 'running' 
    ? _streamT('cliStream.running')
    : exec.status === 'completed'
      ? _streamT('cliStream.completed')
      : _streamT('cliStream.error');
  
  statusContainer.innerHTML = `
    <div class="cli-stream-status-info">
      <div class="cli-stream-status-item">
        <span class="cli-stream-tab-status ${exec.status}"></span>
        <span>${statusLabel}</span>
      </div>
      <div class="cli-stream-status-item">
        <i data-lucide="clock"></i>
        <span>${duration}</span>
      </div>
      <div class="cli-stream-status-item">
        <i data-lucide="file-text"></i>
        <span>${exec.output.length} ${_streamT('cliStream.lines') || 'lines'}</span>
      </div>
    </div>
    <div class="cli-stream-status-actions">
      <button class="cli-stream-toggle-btn ${autoScrollEnabled ? 'active' : ''}" 
              onclick="toggleAutoScroll()" 
              title="${_streamT('cliStream.autoScroll')}">
        <i data-lucide="arrow-down-to-line"></i>
        <span data-i18n="cliStream.autoScroll">${_streamT('cliStream.autoScroll')}</span>
      </button>
    </div>
  `;
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  // Update duration periodically for running executions
  if (exec.status === 'running') {
    setTimeout(() => {
      if (activeStreamTab === executionId && cliStreamExecutions[executionId]?.status === 'running') {
        renderStreamStatus(executionId);
      }
    }, 1000);
  }
}

function switchStreamTab(executionId) {
  if (!cliStreamExecutions[executionId]) return;
  
  activeStreamTab = executionId;
  renderStreamTabs();
  renderStreamContent(executionId);
}

function updateStreamBadge() {
  const badge = document.getElementById('cliStreamBadge');
  if (!badge) return;
  
  const runningCount = Object.values(cliStreamExecutions).filter(e => e.status === 'running').length;
  
  if (runningCount > 0) {
    badge.textContent = runningCount;
    badge.classList.add('has-running');
  } else {
    badge.textContent = '';
    badge.classList.remove('has-running');
  }
}

// ===== User Actions =====
function closeStream(executionId) {
  const exec = cliStreamExecutions[executionId];
  if (!exec || exec.status === 'running') return;
  
  delete cliStreamExecutions[executionId];
  
  // Switch to another tab if this was active
  if (activeStreamTab === executionId) {
    const remaining = Object.keys(cliStreamExecutions);
    activeStreamTab = remaining.length > 0 ? remaining[0] : null;
  }
  
  renderStreamTabs();
  renderStreamContent(activeStreamTab);
  updateStreamBadge();
}

function clearCompletedStreams() {
  const toRemove = Object.keys(cliStreamExecutions).filter(
    id => cliStreamExecutions[id].status !== 'running'
  );
  
  toRemove.forEach(id => delete cliStreamExecutions[id]);
  
  // Update active tab if needed
  if (activeStreamTab && !cliStreamExecutions[activeStreamTab]) {
    const remaining = Object.keys(cliStreamExecutions);
    activeStreamTab = remaining.length > 0 ? remaining[0] : null;
  }
  
  renderStreamTabs();
  renderStreamContent(activeStreamTab);
  updateStreamBadge();
}

function toggleAutoScroll() {
  autoScrollEnabled = !autoScrollEnabled;
  
  if (autoScrollEnabled && activeStreamTab) {
    const content = document.getElementById('cliStreamContent');
    if (content) {
      content.scrollTop = content.scrollHeight;
    }
  }
  
  renderStreamStatus(activeStreamTab);
}

function handleStreamContentScroll() {
  const content = document.getElementById('cliStreamContent');
  if (!content) return;
  
  // If user scrolls up, disable auto-scroll
  const isAtBottom = content.scrollHeight - content.scrollTop <= content.clientHeight + 50;
  if (!isAtBottom && autoScrollEnabled) {
    autoScrollEnabled = false;
    renderStreamStatus(activeStreamTab);
  }
}

// ===== Helper Functions =====
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Search Functions =====
function handleSearchInput(event) {
  searchFilter = event.target.value;
  renderStreamContent(activeStreamTab);
}

function clearSearch() {
  searchFilter = '';
  const searchInput = document.getElementById('cliStreamSearchInput');
  if (searchInput) {
    searchInput.value = '';
  }
  renderStreamContent(activeStreamTab);
}

// Translation helper with fallback (uses global t from i18n.js)
function _streamT(key) {
  // First try global t() from i18n.js
  if (typeof t === 'function' && t !== _streamT) {
    try {
      return t(key);
    } catch (e) {
      // Fall through to fallbacks
    }
  }
  // Fallback values
  const fallbacks = {
    'cliStream.noStreams': 'No active CLI executions',
    'cliStream.noStreamsHint': 'Start a CLI command to see streaming output',
    'cliStream.running': 'Running',
    'cliStream.completed': 'Completed',
    'cliStream.error': 'Error',
    'cliStream.autoScroll': 'Auto-scroll',
    'cliStream.close': 'Close',
    'cliStream.cannotCloseRunning': 'Cannot close running execution',
    'cliStream.lines': 'lines',
    'cliStream.searchPlaceholder': 'Search output...',
    'cliStream.filterResults': 'results'
  };
  return fallbacks[key] || key;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCliStreamViewer);
} else {
  initCliStreamViewer();
}

// ===== Global Exposure =====
window.toggleCliStreamViewer = toggleCliStreamViewer;
window.handleCliStreamStarted = handleCliStreamStarted;
window.handleCliStreamOutput = handleCliStreamOutput;
window.handleCliStreamCompleted = handleCliStreamCompleted;
window.handleCliStreamError = handleCliStreamError;
window.switchStreamTab = switchStreamTab;
window.closeStream = closeStream;
window.clearCompletedStreams = clearCompletedStreams;
window.toggleAutoScroll = toggleAutoScroll;
window.handleSearchInput = handleSearchInput;
window.clearSearch = clearSearch;
