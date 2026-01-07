// CLAUDE.md Manager View
// Three-column layout: File Tree | Viewer/Editor | Metadata & Actions

// ========== State Management ==========
var claudeFilesData = {
  user: { main: null },
  project: { main: null },
  modules: [],
  summary: { totalFiles: 0, totalSize: 0 }
};
var selectedFile = null;
var isEditMode = false;
var isDirty = false;
var fileTreeExpanded = {
  user: true,
  project: true,
  modules: {}
};
var searchQuery = '';
var freshnessData = {}; // { [filePath]: FreshnessResult }
var freshnessSummary = null;

// ========== Main Render Function ==========
async function renderClaudeManager() {
  var container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search for claude-manager view
  var statsGrid = document.getElementById('statsGrid');
  var searchInput = document.getElementById('searchInput');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchInput) searchInput.parentElement.style.display = 'none';

  // Show loading state
  container.innerHTML = '<div class="claude-manager-view loading">' +
    '<div class="loading-spinner"><i data-lucide="loader-2" class="w-8 h-8 animate-spin"></i></div>' +
    '<p>' + t('common.loading') + '</p>' +
    '</div>';

  // Load file data first (fast operation)
  await loadClaudeFiles();

  // Render layout immediately without waiting for freshness data
  container.innerHTML = '<div class="claude-manager-view">' +
    '<div class="claude-manager-header">' +
    '<div class="claude-manager-header-left">' +
    '<h2><i data-lucide="file-code" class="w-5 h-5"></i> ' + t('claudeManager.title') + '</h2>' +
    '<span class="file-count-badge">' + claudeFilesData.summary.totalFiles + ' ' + t('claudeManager.files') + '</span>' +
    '</div>' +
    '<div class="claude-manager-header-right">' +
    '<button class="btn btn-sm btn-primary" onclick="showCreateFileDialog()">' +
    '<i data-lucide="file-plus" class="w-4 h-4"></i> ' + t('claude.createFile') +
    '</button>' +
    '<button class="btn btn-sm btn-secondary" onclick="refreshClaudeFiles()">' +
    '<i data-lucide="refresh-cw" class="w-4 h-4"></i> ' + t('common.refresh') +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="claude-manager-columns">' +
    '<div class="claude-manager-column left" id="claude-file-tree"></div>' +
    '<div class="claude-manager-column center" id="claude-file-viewer"></div>' +
    '<div class="claude-manager-column right" id="claude-file-metadata"></div>' +
    '</div>' +
    '</div>';

  // Render each column immediately (without freshness data)
  renderFileTree();
  renderFileViewer();
  renderFileMetadata();

  // Initialize Lucide icons
  if (window.lucide) lucide.createIcons();

  // Load freshness data asynchronously in the background (non-blocking)
  loadFreshnessDataAsync();
}

// Async freshness loader - loads in background and updates UI when ready
function loadFreshnessDataAsync() {
  // Use setTimeout to ensure UI is rendered first
  setTimeout(async function() {
    try {
      await loadFreshnessData();
      // Re-render file tree and metadata with freshness data
      renderFileTree();
      if (selectedFile) {
        renderFileMetadata();
      }
      if (window.lucide) lucide.createIcons();
    } catch (error) {
      console.error('Error loading freshness data in background:', error);
    }
  }, 100);
}

// ========== Data Loading ==========
async function loadClaudeFiles() {
  try {
    var res = await fetch('/api/memory/claude/scan?path=' + encodeURIComponent(projectPath || ''));
    if (!res.ok) throw new Error('Failed to load CLAUDE.md files');
    claudeFilesData = await res.json();
    updateClaudeBadge(); // Update navigation badge
  } catch (error) {
    console.error('Error loading CLAUDE.md files:', error);
    showRefreshToast(t('claudeManager.loadError') || 'Failed to load files', 'error');
    addGlobalNotification('error', t('claudeManager.loadError'), null, 'CLAUDE.md');
  }
}

async function refreshClaudeFiles() {
  await loadClaudeFiles();
  // Re-render file tree immediately
  renderFileTree();
  renderFileViewer();
  renderFileMetadata();
  if (window.lucide) lucide.createIcons();
  showRefreshToast(t('claudeManager.refreshed') || 'Files refreshed', 'success');
  addGlobalNotification('success', t('claudeManager.refreshed'), null, 'CLAUDE.md');
  // Load freshness data in background
  loadFreshnessDataAsync();
}

// ========== Freshness Data Loading ==========
async function loadFreshnessData() {
  try {
    var res = await fetch('/api/memory/claude/freshness?path=' + encodeURIComponent(projectPath || ''));
    if (!res.ok) throw new Error('Failed to load freshness data');
    var data = await res.json();

    // Build lookup map
    freshnessData = {};
    if (data.files) {
      data.files.forEach(function(f) {
        freshnessData[f.path] = f;
      });
    }
    freshnessSummary = data.summary || null;
  } catch (error) {
    console.error('Error loading freshness data:', error);
    freshnessData = {};
    freshnessSummary = null;
  }
}

async function markFileAsUpdated() {
  if (!selectedFile) return;

  try {
    var res = await fetch('/api/memory/claude/mark-updated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: selectedFile.path,
        source: 'dashboard'
      })
    });

    if (!res.ok) throw new Error('Failed to mark file as updated');

    showRefreshToast(t('claudeManager.markedAsUpdated') || 'Marked as updated', 'success');
    addGlobalNotification('success', t('claudeManager.markedAsUpdated') || 'Marked as updated', null, 'CLAUDE.md');

    // Reload freshness data
    await loadFreshnessData();
    renderFileTree();
    renderFileMetadata();
  } catch (error) {
    console.error('Error marking file as updated:', error);
    showRefreshToast(t('claudeManager.markUpdateError') || 'Failed to mark as updated', 'error');
    addGlobalNotification('error', t('claudeManager.markUpdateError') || 'Failed to mark as updated', null, 'CLAUDE.md');
  }
}

// ========== File Tree Rendering ==========
function renderFileTree() {
  var container = document.getElementById('claude-file-tree');
  if (!container) return;

  var html = '<div class="file-tree">' +
    // Search Box
    '<div class="file-tree-search">' +
    '<input type="text" id="fileSearchInput" placeholder="' + t('claude.searchPlaceholder') + '" ' +
    'value="' + escapeHtml(searchQuery) + '" oninput="filterFileTree(this.value)">' +
    '<i data-lucide="search" class="w-4 h-4"></i>' +
    '</div>' +
    renderClaudeFilesTree() +
    '</div>'; // end file-tree

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function renderClaudeFilesTree() {
  var html = '<div class="file-tree-section">' +
    '<div class="file-tree-header" onclick="toggleTreeSection(\'user\')">' +
    '<i data-lucide="' + (fileTreeExpanded.user ? 'chevron-down' : 'chevron-right') + '" class="w-4 h-4"></i>' +
    '<i data-lucide="user" class="w-4 h-4 text-orange-500"></i>' +
    '<span>' + t('claudeManager.userLevel') + '</span>' +
    '<span class="file-count">' + (claudeFilesData.user.main ? 1 : 0) + '</span>' +
    '</div>';

  if (fileTreeExpanded.user) {
    // User CLAUDE.md (only main file, no rules)
    if (claudeFilesData.user.main) {
      html += renderFileTreeItem(claudeFilesData.user.main, 1);
    } else {
      html += '<div class="file-tree-item empty" style="padding-left: 1.5rem;">' +
        '<i data-lucide="file-x" class="w-4 h-4"></i>' +
        '<span>' + t('claudeManager.noFile') + '</span>' +
        '</div>';
    }
  }

  html += '</div>'; // end user section

  // Project section
  html += '<div class="file-tree-section">' +
    '<div class="file-tree-header" onclick="toggleTreeSection(\'project\')">' +
    '<i data-lucide="' + (fileTreeExpanded.project ? 'chevron-down' : 'chevron-right') + '" class="w-4 h-4"></i>' +
    '<i data-lucide="folder" class="w-4 h-4 text-green-500"></i>' +
    '<span>' + t('claudeManager.projectLevel') + '</span>' +
    '<span class="file-count">' + (claudeFilesData.project.main ? 1 : 0) + '</span>' +
    '</div>';

  if (fileTreeExpanded.project) {
    // Project CLAUDE.md (only main file, no rules)
    if (claudeFilesData.project.main) {
      html += renderFileTreeItem(claudeFilesData.project.main, 1);
    } else {
      html += '<div class="file-tree-item empty" style="padding-left: 1.5rem;">' +
        '<i data-lucide="file-x" class="w-4 h-4"></i>' +
        '<span>' + t('claudeManager.noFile') + '</span>' +
        '</div>';
    }
  }

  html += '</div>'; // end project section

  // Modules section
  html += '<div class="file-tree-section">' +
    '<div class="file-tree-header">' +
    '<i data-lucide="package" class="w-4 h-4 text-blue-500"></i>' +
    '<span>' + t('claudeManager.moduleLevel') + '</span>' +
    '<span class="file-count">' + claudeFilesData.modules.length + '</span>' +
    '</div>';

  if (claudeFilesData.modules.length > 0) {
    claudeFilesData.modules.forEach(function (file) {
      html += renderFileTreeItem(file, 1);
    });
  } else {
    html += '<div class="file-tree-item empty" style="padding-left: 1.5rem;">' +
      '<i data-lucide="file-x" class="w-4 h-4"></i>' +
      '<span>' + t('claudeManager.noModules') + '</span>' +
      '</div>';
  }

  html += '</div>'; // end modules section

  return html;
}

function renderFileTreeItem(file, indentLevel) {
  var isSelected = selectedFile && selectedFile.id === file.id;
  var indentPx = indentLevel * 1.5;
  var safeId = file.id.replace(/'/g, "&apos;");

  // Get freshness data for this file
  var fd = freshnessData[file.path];
  var freshnessClass = '';
  var freshnessBadge = '';

  // Check if freshness data is loaded (freshnessSummary is set after load)
  var freshnessLoaded = freshnessSummary !== null || Object.keys(freshnessData).length > 0;

  if (fd) {
    if (fd.freshness >= 75) {
      freshnessClass = ' freshness-good';
      freshnessBadge = '<span class="freshness-badge good">' + fd.freshness + '%</span>';
    } else if (fd.freshness >= 50) {
      freshnessClass = ' freshness-warn';
      freshnessBadge = '<span class="freshness-badge warn">' + fd.freshness + '%</span>';
    } else {
      freshnessClass = ' freshness-stale';
      freshnessBadge = '<span class="freshness-badge stale">' + fd.freshness + '%</span>';
    }
  } else if (!freshnessLoaded) {
    // Show loading badge while freshness data is being fetched
    freshnessBadge = '<span class="freshness-badge loading">...</span>';
  }

  return '<div class="file-tree-item' + freshnessClass + (isSelected ? ' selected' : '') + '" ' +
    'onclick="selectClaudeFile(\'' + safeId + '\')" ' +
    'style="padding-left: ' + indentPx + 'rem;">' +
    '<i data-lucide="file-text" class="w-4 h-4"></i>' +
    '<span class="file-name">' + escapeHtml(file.name) + '</span>' +
    freshnessBadge +
    (file.parentDirectory ? '<span class="file-path-hint">' + escapeHtml(file.parentDirectory) + '</span>' : '') +
    '</div>';
}

function toggleTreeSection(section) {
  fileTreeExpanded[section] = !fileTreeExpanded[section];
  renderFileTree();
}

async function selectClaudeFile(fileId) {
  // Find file in data (only main CLAUDE.md files, no rules)
  var allFiles = [
    claudeFilesData.user.main,
    claudeFilesData.project.main,
    ...claudeFilesData.modules
  ].filter(function (f) { return f !== null; });

  selectedFile = allFiles.find(function (f) { return f.id === fileId; }) || null;

  if (selectedFile) {
    // Load full content if not already loaded
    if (!selectedFile.content) {
      try {
        var res = await fetch('/api/memory/claude/file?path=' + encodeURIComponent(selectedFile.path));
        if (res.ok) {
          var data = await res.json();
          selectedFile.content = data.content;
          selectedFile.stats = data.stats;
        }
      } catch (error) {
        console.error('Error loading file content:', error);
      }
    }
  }

  renderFileTree();
  renderFileViewer();
  renderFileMetadata();
}

// ========== File Viewer Rendering ==========
function renderFileViewer() {
  var container = document.getElementById('claude-file-viewer');
  if (!container) return;

  if (!selectedFile) {
    container.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="file-search" class="w-12 h-12 opacity-20"></i>' +
      '<p>' + t('claudeManager.selectFile') + '</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = '<div class="file-viewer">' +
    '<div class="file-viewer-header">' +
    '<h3>' + escapeHtml(selectedFile.name) + '</h3>' +
    '<div class="file-viewer-actions">' +
    '<button class="btn btn-sm btn-secondary" onclick="copyFileContent()" title="' + t('claude.copyContent') + '">' +
    '<i data-lucide="copy" class="w-4 h-4"></i>' +
    '</button>' +
    '<button class="btn btn-sm btn-secondary" onclick="toggleEditMode()" title="' + t('common.edit') + '">' +
    '<i data-lucide="' + (isEditMode ? 'eye' : 'edit-2') + '" class="w-4 h-4"></i>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="file-viewer-content">' +
    (isEditMode ? renderEditor() : renderMarkdownContent(selectedFile.content || '')) +
    '</div>' +
    '</div>';

  if (window.lucide) lucide.createIcons();
}

function renderMarkdownContent(content) {
  // Check if marked.js is available for enhanced rendering
  if (typeof marked !== 'undefined') {
    try {
      marked.setOptions({
        gfm: true,
        breaks: true,
        tables: true,
        smartLists: true,
        highlight: function(code, lang) {
          // Check if highlight.js or Prism is available
          if (typeof hljs !== 'undefined' && lang) {
            try {
              return hljs.highlight(code, { language: lang }).value;
            } catch (e) {
              return escapeHtml(code);
            }
          } else if (typeof Prism !== 'undefined' && lang && Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
          }
          return escapeHtml(code);
        }
      });
      return '<div class="markdown-content">' + marked.parse(content) + '</div>';
    } catch (e) {
      console.error('Error rendering markdown with marked.js:', e);
    }
  }

  // Fallback: Enhanced basic rendering
  var html = escapeHtml(content);

  // Headers
  html = html
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>');

  // Inline formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Task lists
  html = html
    .replace(/- \[ \] (.+)$/gim, '<li class="task-list-item"><input type="checkbox" disabled> $1</li>')
    .replace(/- \[x\] (.+)$/gim, '<li class="task-list-item"><input type="checkbox" disabled checked> $1</li>');

  // Lists
  html = html.replace(/^- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
    return '<pre><code class="language-' + (lang || 'plaintext') + '">' + code + '</code></pre>';
  });

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return '<div class="markdown-content">' + html + '</div>';
}

function renderEditor() {
  return '<textarea id="claudeFileEditor" class="file-editor" ' +
    'oninput="markDirty()">' +
    escapeHtml(selectedFile.content || '') +
    '</textarea>';
}

function toggleEditMode() {
  if (isEditMode && isDirty) {
    if (!confirm(t('claudeManager.unsavedChanges'))) {
      return;
    }
  }

  isEditMode = !isEditMode;
  isDirty = false;
  renderFileViewer();
}

function markDirty() {
  isDirty = true;
}

async function saveClaudeFile() {
  if (!selectedFile || !isEditMode) return;

  var editor = document.getElementById('claudeFileEditor');
  if (!editor) return;

  var newContent = editor.value;

  try {
    var res = await fetch('/api/memory/claude/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: selectedFile.path,
        content: newContent,
        createBackup: true
      })
    });

    if (!res.ok) throw new Error('Failed to save file');

    selectedFile.content = newContent;
    selectedFile.stats = calculateFileStats(newContent);
    isDirty = false;

    showRefreshToast(t('claudeManager.saved') || 'File saved', 'success');
    addGlobalNotification('success', t('claudeManager.saved'), null, 'CLAUDE.md');
    renderFileMetadata();
  } catch (error) {
    console.error('Error saving file:', error);
    showRefreshToast(t('claudeManager.saveError') || 'Save failed', 'error');
    addGlobalNotification('error', t('claudeManager.saveError'), null, 'CLAUDE.md');
  }
}

function calculateFileStats(content) {
  var lines = content.split('\n').length;
  var words = content.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
  var characters = content.length;
  return { lines: lines, words: words, characters: characters };
}

// ========== File Metadata Rendering ==========
function renderFileMetadata() {
  var container = document.getElementById('claude-file-metadata');
  if (!container) return;

  if (!selectedFile) {
    container.innerHTML = '<div class="empty-state">' +
      '<i data-lucide="info" class="w-8 h-8 opacity-20"></i>' +
      '<p>' + t('claudeManager.noMetadata') + '</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  var html = '<div class="file-metadata">' +
    '<div class="metadata-section">' +
    '<h4>' + t('claudeManager.fileInfo') + '</h4>' +
    '<div class="metadata-item">' +
    '<span class="label">' + t('claudeManager.level') + '</span>' +
    '<span class="value">' + t('claudeManager.level_' + selectedFile.level) + '</span>' +
    '</div>' +
    '<div class="metadata-item">' +
    '<span class="label">' + t('claudeManager.path') + '</span>' +
    '<span class="value path">' + escapeHtml(selectedFile.relativePath) + '</span>' +
    '</div>' +
    '<div class="metadata-item">' +
    '<span class="label">' + t('claudeManager.size') + '</span>' +
    '<span class="value">' + formatFileSize(selectedFile.size) + '</span>' +
    '</div>' +
    '<div class="metadata-item">' +
    '<span class="label">' + t('claudeManager.modified') + '</span>' +
    '<span class="value">' + formatDate(selectedFile.lastModified) + '</span>' +
    '</div>' +
    '</div>';

  if (selectedFile.stats) {
    html += '<div class="metadata-section">' +
      '<h4>' + t('claudeManager.statistics') + '</h4>' +
      '<div class="metadata-item">' +
      '<span class="label">' + t('claudeManager.lines') + '</span>' +
      '<span class="value">' + selectedFile.stats.lines + '</span>' +
      '</div>' +
      '<div class="metadata-item">' +
      '<span class="label">' + t('claudeManager.words') + '</span>' +
      '<span class="value">' + selectedFile.stats.words + '</span>' +
      '</div>' +
      '<div class="metadata-item">' +
      '<span class="label">' + t('claudeManager.characters') + '</span>' +
      '<span class="value">' + selectedFile.stats.characters + '</span>' +
      '</div>' +
      '</div>';
  }

  // Freshness section
  var fd = freshnessData[selectedFile.path];
  var freshnessLoaded = freshnessSummary !== null || Object.keys(freshnessData).length > 0;

  if (fd) {
    var freshnessBarClass = fd.freshness >= 75 ? 'good' : fd.freshness >= 50 ? 'warn' : 'stale';
    html += '<div class="metadata-section freshness-section">' +
      '<h4><i data-lucide="activity" class="w-4 h-4"></i> ' + (t('claudeManager.freshness') || 'Freshness') + '</h4>' +
      '<div class="freshness-gauge">' +
      '<div class="freshness-bar ' + freshnessBarClass + '" style="width: ' + fd.freshness + '%"></div>' +
      '</div>' +
      '<div class="freshness-value-display">' + fd.freshness + '%</div>' +
      '<div class="metadata-item">' +
      '<span class="label">' + (t('claudeManager.lastContentUpdate') || 'Last Content Update') + '</span>' +
      '<span class="value">' + (fd.lastUpdated ? formatDate(fd.lastUpdated) : (t('claudeManager.never') || 'Never tracked')) + '</span>' +
      '</div>' +
      '<div class="metadata-item">' +
      '<span class="label">' + (t('claudeManager.changedFiles') || 'Changed Files') + '</span>' +
      '<span class="value">' + fd.changedFilesCount + ' ' + (t('claudeManager.filesSinceUpdate') || 'files since update') + '</span>' +
      '</div>';

    if (fd.needsUpdate) {
      html += '<div class="update-reminder">' +
        '<i data-lucide="alert-triangle" class="w-4 h-4"></i>' +
        '<span>' + (t('claudeManager.updateReminder') || 'This file may need updating') + '</span>' +
        '</div>';
    }

    html += '<button class="btn btn-sm btn-secondary full-width" onclick="markFileAsUpdated()">' +
      '<i data-lucide="check-circle" class="w-4 h-4"></i> ' + (t('claudeManager.markAsUpdated') || 'Mark as Updated') +
      '</button>' +
      '</div>';
  } else if (!freshnessLoaded) {
    // Show loading state while freshness data is being fetched
    html += '<div class="metadata-section freshness-section">' +
      '<h4><i data-lucide="activity" class="w-4 h-4"></i> ' + (t('claudeManager.freshness') || 'Freshness') + '</h4>' +
      '<div class="freshness-loading">' +
      '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>' +
      '<span>' + (t('claudeManager.loadingFreshness') || 'Loading freshness data...') + '</span>' +
      '</div>' +
      '</div>';
  }

  html += '<div class="metadata-section">' +
    '<h4>' + t('claudeManager.actions') + '</h4>';

  if (isEditMode) {
    html += '<button class="btn btn-sm btn-primary full-width" onclick="saveClaudeFile()"' +
      (isDirty ? '' : ' disabled') + '>' +
      '<i data-lucide="save" class="w-4 h-4"></i> ' + t('common.save') +
      '</button>';
    html += '<button class="btn btn-sm btn-secondary full-width" onclick="toggleEditMode()">' +
      '<i data-lucide="x" class="w-4 h-4"></i> ' + t('common.cancel') +
      '</button>';
  } else {
    html += '<button class="btn btn-sm btn-secondary full-width" onclick="toggleEditMode()">' +
      '<i data-lucide="edit-2" class="w-4 h-4"></i> ' + t('common.edit') +
      '</button>';
  }

  // Delete button (only for CLAUDE.md files, not in edit mode)
  if (!isEditMode && selectedFile.level !== 'file') {
    html += '<button class="btn btn-sm btn-danger full-width" onclick="confirmDeleteFile()">' +
      '<i data-lucide="trash-2" class="w-4 h-4"></i> ' + t('claude.deleteFile') +
      '</button>';
  }

  html += '</div>'; // end actions section

  // CLI Sync Panel
  html += '<div class="metadata-section cli-sync-panel">' +
    '<div class="panel-header">' +
    '<i data-lucide="sparkles" class="w-4 h-4"></i>' +
    '<span>' + (t('claude.cliSync') || 'CLI Auto-Sync') + '</span>' +
    '</div>' +
    '<div class="sync-config">' +
    '<label>' + (t('claude.tool') || 'Tool') + '</label>' +
    '<select id="cliToolSelect" class="sync-select">' +
    '<option value="gemini">Gemini</option>' +
    '<option value="qwen">Qwen</option>' +
    '</select>' +
    '</div>' +
    '<button class="btn btn-sm btn-primary full-width sync-button" onclick="syncFileWithCLI()" id="cliSyncButton">' +
    '<i data-lucide="refresh-cw" class="w-4 h-4"></i> ' +
    (t('claude.syncButton') || 'Sync with CLI') +
    '</button>' +
    '<div id="syncProgress" class="sync-progress" style="display:none;">' +
    '<i data-lucide="loader" class="w-4 h-4"></i>' +
    '<span id="syncProgressText">' + (t('claude.syncing') || 'Analyzing...') + '</span>' +
    '</div>' +
    '</div>'; // end cli-sync-panel

  html += '</div>'; // end file-metadata

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// ========== CLI Sync Functions ==========
async function syncFileWithCLI() {
  if (!selectedFile) return;

  var tool = document.getElementById('cliToolSelect').value;
  var mode = 'generate'; // Default to full replace mode

  // Show progress
  showSyncProgress(true, tool);

  // Disable sync button
  var syncButton = document.getElementById('cliSyncButton');
  if (syncButton) syncButton.disabled = true;

  try {
    var response = await fetch('/api/memory/claude/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: selectedFile.level,
        path: selectedFile.level === 'module' ? selectedFile.path.replace(/CLAUDE\.md$/, '').replace(/\/$/, '') : undefined,
        tool: tool,
        mode: mode
      })
    });

    var result = await response.json();

    if (result.success) {
      // Reload file content and freshness data
      var fileData = await loadFileContent(selectedFile.path);
      if (fileData) {
        selectedFile = fileData;
        await loadFreshnessData();
        renderFileTree();
        renderFileViewer();
        renderFileMetadata();
      }
      showClaudeNotification('success', (t('claude.syncSuccess') || 'Synced successfully').replace('{file}', selectedFile.name));
    } else {
      showClaudeNotification('error', (t('claude.syncError') || 'Sync failed').replace('{error}', result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('CLI sync error:', error);
    showClaudeNotification('error', (t('claude.syncError') || 'Sync failed').replace('{error}', error.message));
  } finally {
    showSyncProgress(false);
    if (syncButton) syncButton.disabled = false;
  }
}

function showSyncProgress(show, tool) {
  var progressEl = document.getElementById('syncProgress');
  var progressText = document.getElementById('syncProgressText');
  if (!progressEl) return;

  if (show) {
    progressEl.style.display = 'flex';
    if (progressText) {
      var text = (t('claude.syncing') || 'Analyzing with {tool}...').replace('{tool}', tool || 'CLI');
      progressText.textContent = text;
    }
    if (window.lucide) lucide.createIcons();
  } else {
    progressEl.style.display = 'none';
  }
}

async function loadFileContent(filePath) {
  try {
    var res = await fetch('/api/memory/claude/file?path=' + encodeURIComponent(filePath));
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Error loading file content:', error);
    return null;
  }
}

function showClaudeNotification(type, message) {
  // Show toast for immediate feedback
  if (typeof showRefreshToast === 'function') {
    showRefreshToast(message, type);
  }
  // Also add to global notification system if available
  if (typeof addGlobalNotification === 'function') {
    addGlobalNotification(type, message, null, 'CLAUDE.md');
  }
}

// ========== Search Functions ==========
function filterFileTree(query) {
  searchQuery = query.toLowerCase();
  renderFileTree();

  // Add keyboard shortcut handler
  if (query && !window.claudeSearchKeyboardHandlerAdded) {
    document.addEventListener('keydown', handleSearchKeyboard);
    window.claudeSearchKeyboardHandlerAdded = true;
  }
}

function handleSearchKeyboard(e) {
  // Ctrl+F or Cmd+F
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    var searchInput = document.getElementById('fileSearchInput');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }
}

// ========== File Creation Functions ==========
function showCreateFileDialog() {
  var dialog = '<div class="modal-overlay" onclick="closeCreateDialog()">' +
    '<div class="create-dialog" onclick="event.stopPropagation()">' +
    '<h3>' + t('claude.createDialogTitle') + '</h3>' +
    '<div class="dialog-form">' +
    '<label>' + t('claude.selectLevel') + '</label>' +
    '<select id="createLevel" onchange="toggleModulePathInput(this.value)">' +
    '<option value="user">' + t('claude.levelUser') + '</option>' +
    '<option value="project">' + t('claude.levelProject') + '</option>' +
    '<option value="module">' + t('claude.levelModule') + '</option>' +
    '</select>' +
    '<label id="modulePathLabel" style="display:none;">' + t('claude.modulePath') + '</label>' +
    '<input id="modulePath" type="text" style="display:none;" placeholder="e.g., src/components">' +
    '<label>' + t('claude.selectTemplate') + '</label>' +
    '<select id="createTemplate">' +
    '<option value="default">' + t('claude.templateDefault') + '</option>' +
    '<option value="minimal">' + t('claude.templateMinimal') + '</option>' +
    '<option value="comprehensive">' + t('claude.templateComprehensive') + '</option>' +
    '</select>' +
    '</div>' +
    '<div class="dialog-buttons">' +
    '<button onclick="closeCreateDialog()" class="btn btn-sm btn-secondary">' + t('common.cancel') + '</button>' +
    '<button onclick="createNewFile()" class="btn btn-sm btn-primary">' + t('claude.createFile') + '</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', dialog);
  if (window.lucide) lucide.createIcons();
}

function closeCreateDialog() {
  var overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
}

function toggleModulePathInput(level) {
  var pathLabel = document.getElementById('modulePathLabel');
  var pathInput = document.getElementById('modulePath');

  if (level === 'module') {
    pathLabel.style.display = 'block';
    pathInput.style.display = 'block';
  } else {
    pathLabel.style.display = 'none';
    pathInput.style.display = 'none';
  }
}

async function createNewFile() {
  var level = document.getElementById('createLevel').value;
  var template = document.getElementById('createTemplate').value;
  var modulePath = document.getElementById('modulePath').value;

  if (level === 'module' && !modulePath) {
    showRefreshToast(t('claude.modulePathRequired') || 'Module path is required', 'error');
    addGlobalNotification('error', t('claude.modulePathRequired') || 'Module path is required', null, 'CLAUDE.md');
    return;
  }

  try {
    var res = await fetch('/api/memory/claude/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: level,
        path: modulePath || undefined,
        template: template
      })
    });

    if (!res.ok) throw new Error('Failed to create file');

    var result = await res.json();
    closeCreateDialog();
    showRefreshToast(t('claude.fileCreated') || 'File created successfully', 'success');
    addGlobalNotification('success', t('claude.fileCreated') || 'File created successfully', null, 'CLAUDE.md');

    // Refresh file tree
    await refreshClaudeFiles();
  } catch (error) {
    console.error('Error creating file:', error);
    showRefreshToast(t('claude.createFileError') || 'Failed to create file', 'error');
    addGlobalNotification('error', t('claude.createFileError') || 'Failed to create file', null, 'CLAUDE.md');
  }
}

// ========== File Deletion Functions ==========
async function confirmDeleteFile() {
  if (!selectedFile) return;

  var confirmed = confirm(
    (t('claude.deleteConfirm') || 'Are you sure you want to delete {file}?').replace('{file}', selectedFile.name) + '\n\n' +
    'Path: ' + selectedFile.path + '\n\n' +
    (t('claude.deleteWarning') || 'This action cannot be undone.')
  );

  if (!confirmed) return;

  try {
    var res = await fetch('/api/memory/claude/file?path=' + encodeURIComponent(selectedFile.path) + '&confirm=true', {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Failed to delete file');

    showRefreshToast(t('claude.fileDeleted') || 'File deleted successfully', 'success');
    addGlobalNotification('success', t('claude.fileDeleted') || 'File deleted successfully', null, 'CLAUDE.md');
    selectedFile = null;

    // Refresh file tree
    await refreshClaudeFiles();
  } catch (error) {
    console.error('Error deleting file:', error);
    showRefreshToast(t('claude.deleteFileError') || 'Failed to delete file', 'error');
    addGlobalNotification('error', t('claude.deleteFileError') || 'Failed to delete file', null, 'CLAUDE.md');
  }
}

// ========== Copy Content Function ==========
function copyFileContent() {
  if (!selectedFile || !selectedFile.content) return;

  navigator.clipboard.writeText(selectedFile.content).then(function() {
    showRefreshToast(t('claude.contentCopied') || 'Content copied to clipboard', 'success');
    addGlobalNotification('success', t('claude.contentCopied') || 'Content copied to clipboard', null, 'CLAUDE.md');
  }).catch(function(error) {
    console.error('Error copying content:', error);
    showRefreshToast(t('claude.copyError') || 'Failed to copy content', 'error');
    addGlobalNotification('error', t('claude.copyError') || 'Failed to copy content', null, 'CLAUDE.md');
  });
}

// ========== Utility Functions ==========
// Note: escapeHtml and formatDate are imported from utils.js

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Update navigation badge with total file count
function updateClaudeBadge() {
  var badge = document.getElementById('badgeClaude');
  if (badge && claudeFilesData && claudeFilesData.summary) {
    var total = claudeFilesData.summary.totalFiles;
    badge.textContent = total;
  }
}
