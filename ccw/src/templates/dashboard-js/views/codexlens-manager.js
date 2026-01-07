// CodexLens Manager - Configuration, Model Management, and Semantic Dependencies
// Extracted from cli-manager.js for better maintainability

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// WORKSPACE INDEX STATUS
// ============================================================

/**
 * Refresh workspace index status (FTS and Vector coverage)
 */
async function refreshWorkspaceIndexStatus() {
  var container = document.getElementById('workspaceIndexStatusContent');
  if (!container) return;

  // Show loading state
  container.innerHTML = '<div class="text-xs text-muted-foreground text-center py-2">' +
    '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> ' + (t('common.loading') || 'Loading...') +
    '</div>';
  if (window.lucide) lucide.createIcons();

  try {
    var response = await fetch('/api/codexlens/workspace-status');
    var result = await response.json();

    if (result.success) {
      var html = '';

      if (!result.hasIndex) {
        // No index for current workspace
        html = '<div class="text-center py-3">' +
          '<div class="text-sm text-muted-foreground mb-2">' +
            '<i data-lucide="alert-circle" class="w-4 h-4 inline mr-1"></i> ' +
            (t('codexlens.noIndexFound') || 'No index found for current workspace') +
          '</div>' +
          '<button onclick="runFtsFullIndex()" class="text-xs text-primary hover:underline">' +
            (t('codexlens.createIndex') || 'Create Index') +
          '</button>' +
        '</div>';
      } else {
        // FTS Status
        var ftsPercent = result.fts.percent || 0;
        var ftsColor = ftsPercent >= 100 ? 'bg-success' : (ftsPercent > 0 ? 'bg-blue-500' : 'bg-muted-foreground');
        var ftsTextColor = ftsPercent >= 100 ? 'text-success' : (ftsPercent > 0 ? 'text-blue-500' : 'text-muted-foreground');

        html += '<div class="space-y-1">' +
          '<div class="flex items-center justify-between text-xs">' +
            '<span class="flex items-center gap-1.5">' +
              '<i data-lucide="file-text" class="w-3.5 h-3.5 text-blue-500"></i> ' +
              '<span class="font-medium">' + (t('codexlens.ftsIndex') || 'FTS Index') + '</span>' +
            '</span>' +
            '<span class="' + ftsTextColor + ' font-medium">' + ftsPercent + '%</span>' +
          '</div>' +
          '<div class="h-1.5 bg-muted rounded-full overflow-hidden">' +
            '<div class="h-full ' + ftsColor + ' transition-all duration-300" style="width: ' + ftsPercent + '%"></div>' +
          '</div>' +
          '<div class="text-xs text-muted-foreground">' +
            (result.fts.indexedFiles || 0) + ' / ' + (result.fts.totalFiles || 0) + ' ' + (t('codexlens.filesIndexed') || 'files indexed') +
          '</div>' +
        '</div>';

        // Vector Status
        var vectorPercent = result.vector.percent || 0;
        var vectorColor = vectorPercent >= 100 ? 'bg-success' : (vectorPercent >= 50 ? 'bg-purple-500' : (vectorPercent > 0 ? 'bg-purple-400' : 'bg-muted-foreground'));
        var vectorTextColor = vectorPercent >= 100 ? 'text-success' : (vectorPercent >= 50 ? 'text-purple-500' : (vectorPercent > 0 ? 'text-purple-400' : 'text-muted-foreground'));

        html += '<div class="space-y-1 mt-3">' +
          '<div class="flex items-center justify-between text-xs">' +
            '<span class="flex items-center gap-1.5">' +
              '<i data-lucide="brain" class="w-3.5 h-3.5 text-purple-500"></i> ' +
              '<span class="font-medium">' + (t('codexlens.vectorIndex') || 'Vector Index') + '</span>' +
            '</span>' +
            '<span class="' + vectorTextColor + ' font-medium">' + vectorPercent.toFixed(1) + '%</span>' +
          '</div>' +
          '<div class="h-1.5 bg-muted rounded-full overflow-hidden">' +
            '<div class="h-full ' + vectorColor + ' transition-all duration-300" style="width: ' + vectorPercent + '%"></div>' +
          '</div>' +
          '<div class="text-xs text-muted-foreground">' +
            (result.vector.filesWithEmbeddings || 0) + ' / ' + (result.vector.totalFiles || 0) + ' ' + (t('codexlens.filesWithEmbeddings') || 'files with embeddings') +
            (result.vector.totalChunks > 0 ? ' (' + result.vector.totalChunks + ' chunks)' : '') +
          '</div>' +
        '</div>';

        // Vector search availability indicator
        if (vectorPercent >= 50) {
          html += '<div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">' +
            '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-success"></i>' +
            '<span class="text-xs text-success">' + (t('codexlens.vectorSearchEnabled') || 'Vector search enabled') + '</span>' +
          '</div>';
        } else if (vectorPercent > 0) {
          html += '<div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">' +
            '<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-warning"></i>' +
            '<span class="text-xs text-warning">' + (t('codexlens.vectorSearchPartial') || 'Vector search requires ≥50% coverage') + '</span>' +
          '</div>';
        }
      }

      container.innerHTML = html;
    } else {
      container.innerHTML = '<div class="text-xs text-destructive text-center py-2">' +
        '<i data-lucide="alert-circle" class="w-4 h-4 inline mr-1"></i> ' +
        (result.error || t('common.error') || 'Error loading status') +
        '</div>';
    }
  } catch (err) {
    console.error('[CodexLens] Failed to load workspace status:', err);
    container.innerHTML = '<div class="text-xs text-destructive text-center py-2">' +
      '<i data-lucide="alert-circle" class="w-4 h-4 inline mr-1"></i> ' +
      (t('common.error') || 'Error') + ': ' + err.message +
      '</div>';
  }

  if (window.lucide) lucide.createIcons();
}

// ============================================================
// CODEXLENS CONFIGURATION MODAL
// ============================================================

/**
 * Show CodexLens configuration modal
 */
async function showCodexLensConfigModal() {
  try {
    showRefreshToast(t('codexlens.loadingConfig'), 'info');

    // Fetch current config and status in parallel
    const [configResponse, statusResponse] = await Promise.all([
      fetch('/api/codexlens/config'),
      fetch('/api/codexlens/status')
    ]);
    const config = await configResponse.json();
    const status = await statusResponse.json();

    // Update window.cliToolsStatus to ensure isInstalled is correct
    if (!window.cliToolsStatus) {
      window.cliToolsStatus = {};
    }
    window.cliToolsStatus.codexlens = {
      ...(window.cliToolsStatus.codexlens || {}),
      installed: status.ready || false,
      version: status.version || null
    };

    const modalHtml = buildCodexLensConfigContent(config);

    // Create and show modal
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = modalHtml;
    const modal = tempContainer.firstElementChild;
    document.body.appendChild(modal);

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Initialize event handlers
    initCodexLensConfigEvents(config);
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Build CodexLens configuration modal content - Tabbed Layout
 */
function buildCodexLensConfigContent(config) {
  const indexDir = config.index_dir || '~/.codexlens/indexes';
  const indexCount = config.index_count || 0;
  const isInstalled = window.cliToolsStatus?.codexlens?.installed || false;
  const embeddingCoverage = config.embedding_coverage || 0;
  const apiMaxWorkers = config.api_max_workers || 4;
  const apiBatchSize = config.api_batch_size || 8;

  return '<div class="modal-backdrop" id="codexlensConfigModal">' +
    '<div class="modal-container large">' +
    '<div class="modal-header">' +
      '<div class="flex items-center gap-3">' +
        '<div class="modal-icon">' +
          '<i data-lucide="database" class="w-5 h-5"></i>' +
        '</div>' +
        '<div>' +
          '<h2 class="text-lg font-bold">' + t('codexlens.config') + '</h2>' +
          '<p class="text-xs text-muted-foreground">' + t('codexlens.whereIndexesStored') + '</p>' +
        '</div>' +
      '</div>' +
      '<button onclick="closeModal()" class="text-muted-foreground hover:text-foreground">' +
        '<i data-lucide="x" class="w-5 h-5"></i>' +
      '</button>' +
    '</div>' +

    '<div class="modal-body" style="padding: 0;">' +
      // Tab Navigation
      '<div class="flex border-b border-border bg-muted/30">' +
        '<button class="codexlens-tab active flex-1 px-4 py-2.5 text-sm font-medium text-center border-b-2 border-primary text-primary" data-tab="overview">' +
          '<i data-lucide="layout-dashboard" class="w-4 h-4 inline mr-1.5"></i>Overview' +
        '</button>' +
        '<button class="codexlens-tab flex-1 px-4 py-2.5 text-sm font-medium text-center border-b-2 border-transparent text-muted-foreground hover:text-foreground" data-tab="settings">' +
          '<i data-lucide="settings" class="w-4 h-4 inline mr-1.5"></i>Settings' +
        '</button>' +
        (isInstalled
          ? '<button class="codexlens-tab flex-1 px-4 py-2.5 text-sm font-medium text-center border-b-2 border-transparent text-muted-foreground hover:text-foreground" data-tab="search">' +
              '<i data-lucide="search" class="w-4 h-4 inline mr-1.5"></i>Search' +
            '</button>' +
            '<button class="codexlens-tab flex-1 px-4 py-2.5 text-sm font-medium text-center border-b-2 border-transparent text-muted-foreground hover:text-foreground" data-tab="advanced">' +
              '<i data-lucide="wrench" class="w-4 h-4 inline mr-1.5"></i>Advanced' +
            '</button>'
          : '') +
      '</div>' +

      // Tab Content Container
      '<div class="p-4">' +

      // ========== OVERVIEW TAB ==========
      '<div class="codexlens-tab-content active" data-tab="overview">' +
        // Status Card - Compact grid layout
        '<div class="grid grid-cols-2 gap-3 mb-4">' +
          // Status Card
          '<div class="rounded-lg border border-border p-3 bg-card">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<i data-lucide="circle-check" class="w-4 h-4 text-muted-foreground"></i>' +
              '<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>' +
            '</div>' +
            (isInstalled
              ? '<div class="flex items-center gap-2">' +
                  '<span class="w-2 h-2 rounded-full bg-success animate-pulse"></span>' +
                  '<span class="text-sm font-medium text-success">Installed</span>' +
                '</div>'
              : '<div class="flex items-center gap-2">' +
                  '<span class="w-2 h-2 rounded-full bg-muted-foreground"></span>' +
                  '<span class="text-sm font-medium text-muted-foreground">Not Installed</span>' +
                '</div>') +
          '</div>' +
          // Index Count Card
          '<div class="rounded-lg border border-border p-3 bg-card">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<i data-lucide="database" class="w-4 h-4 text-muted-foreground"></i>' +
              '<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Indexes</span>' +
            '</div>' +
            '<div class="text-2xl font-bold text-primary">' + indexCount + '</div>' +
          '</div>' +
          // Embeddings Coverage Card
          '<div class="rounded-lg border border-border p-3 bg-card">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<i data-lucide="brain" class="w-4 h-4 text-muted-foreground"></i>' +
              '<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Embeddings</span>' +
            '</div>' +
            '<div class="text-sm font-medium">' + embeddingCoverage + '%</div>' +
          '</div>' +
          // Storage Path Card
          '<div class="rounded-lg border border-border p-3 bg-card">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<i data-lucide="folder" class="w-4 h-4 text-muted-foreground"></i>' +
              '<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Storage</span>' +
            '</div>' +
            '<div class="text-xs font-mono text-muted-foreground truncate" title="' + escapeHtml(indexDir) + '">' + escapeHtml(indexDir) + '</div>' +
          '</div>' +
        '</div>' +

        // Workspace Index Status (only if installed)
        (isInstalled
          ? '<div class="rounded-lg border border-border p-4 mb-4 bg-card" id="workspaceIndexStatus">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<h4 class="text-sm font-medium flex items-center gap-2">' +
                  '<i data-lucide="hard-drive" class="w-4 h-4"></i> ' + (t('codexlens.workspaceStatus') || 'Workspace Index Status') +
                '</h4>' +
                '<button onclick="refreshWorkspaceIndexStatus()" class="text-xs text-primary hover:underline flex items-center gap-1" title="Refresh status">' +
                  '<i data-lucide="refresh-cw" class="w-3 h-3"></i> ' + (t('common.refresh') || 'Refresh') +
                '</button>' +
              '</div>' +
              '<div id="workspaceIndexStatusContent" class="space-y-3">' +
                '<div class="text-xs text-muted-foreground text-center py-2">' +
                  '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> Loading...' +
                '</div>' +
              '</div>' +
            '</div>'
          : '') +

        // Index Operations - 4 buttons grid
        '<div class="space-y-2">' +
          '<h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">' + (t('codexlens.indexOperations') || 'Index Operations') + '</h4>' +
          (isInstalled
            ? '<div class="grid grid-cols-2 gap-2">' +
                // FTS Full Index
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-blue-500/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 transition-colors" onclick="runFtsFullIndex()" title="' + (t('codexlens.ftsFullIndexDesc') || 'Rebuild full-text search index') + '">' +
                  '<i data-lucide="file-text" class="w-4 h-4"></i> FTS ' + (t('codexlens.fullIndex') || 'Full') +
                '</button>' +
                // FTS Incremental
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-blue-500/30 bg-background text-blue-600 hover:bg-blue-500/5 transition-colors" onclick="runFtsIncrementalUpdate()" title="' + (t('codexlens.ftsIncrementalDesc') || 'Update FTS index for changed files') + '">' +
                  '<i data-lucide="file-plus" class="w-4 h-4"></i> FTS ' + (t('codexlens.incremental') || 'Incremental') +
                '</button>' +
                // Vector Full Index
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-purple-500/30 bg-purple-500/5 text-purple-600 hover:bg-purple-500/10 transition-colors" onclick="runVectorFullIndex()" title="' + (t('codexlens.vectorFullIndexDesc') || 'Generate all embeddings') + '">' +
                  '<i data-lucide="brain" class="w-4 h-4"></i> Vector ' + (t('codexlens.fullIndex') || 'Full') +
                '</button>' +
                // Vector Incremental
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-purple-500/30 bg-background text-purple-600 hover:bg-purple-500/5 transition-colors" onclick="runVectorIncrementalUpdate()" title="' + (t('codexlens.vectorIncrementalDesc') || 'Generate embeddings for new files only') + '">' +
                  '<i data-lucide="brain" class="w-4 h-4"></i> Vector ' + (t('codexlens.incremental') || 'Incremental') +
                '</button>' +
              '</div>'
            : '<div class="grid grid-cols-2 gap-2">' +
                '<button class="col-span-2 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" onclick="installCodexLensFromManager()">' +
                  '<i data-lucide="download" class="w-4 h-4"></i> Install CodexLens' +
                '</button>' +
              '</div>') +
        '</div>' +

        // Quick Actions
        '<div class="space-y-2 mt-3">' +
          '<h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">' + (t('codexlens.quickActions') || 'Quick Actions') + '</h4>' +
          (isInstalled
            ? '<div class="grid grid-cols-2 gap-2">' +
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors" onclick="showWatcherControlModal()">' +
                  '<i data-lucide="eye" class="w-4 h-4"></i> File Watcher' +
                '</button>' +
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors" onclick="showRerankerConfigModal()">' +
                  '<i data-lucide="layers" class="w-4 h-4"></i> Reranker' +
                '</button>' +
                '<button class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors" onclick="cleanCurrentWorkspaceIndex()">' +
                  '<i data-lucide="eraser" class="w-4 h-4"></i> Clean Workspace' +
                '</button>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>' +

      // ========== SETTINGS TAB ==========
      '<div class="codexlens-tab-content hidden" data-tab="settings">' +
        // Index Storage Path
        '<div class="space-y-4">' +
          '<div class="space-y-2">' +
            '<label class="block text-sm font-medium">' + t('codexlens.indexStoragePath') + '</label>' +
            '<input type="text" id="indexDirInput" value="' + escapeHtml(indexDir) + '" ' +
                   'placeholder="' + t('codexlens.pathPlaceholder') + '" ' +
                   'class="tool-config-input w-full" />' +
            '<p class="text-xs text-muted-foreground">' + t('codexlens.pathInfo') + '</p>' +
          '</div>' +

          // API Settings (Concurrency)
          '<div class="rounded-lg border border-border p-4 space-y-3">' +
            '<h4 class="text-sm font-medium flex items-center gap-2">' +
              '<i data-lucide="zap" class="w-4 h-4"></i> API Settings' +
            '</h4>' +
            '<div class="grid grid-cols-2 gap-3">' +
              '<div>' +
                '<label class="block text-xs font-medium text-muted-foreground mb-1">Max Workers</label>' +
                '<input type="number" id="apiMaxWorkersInput" value="' + apiMaxWorkers + '" min="1" max="16" ' +
                       'class="tool-config-input w-full" />' +
              '</div>' +
              '<div>' +
                '<label class="block text-xs font-medium text-muted-foreground mb-1">Batch Size</label>' +
                '<input type="number" id="apiBatchSizeInput" value="' + apiBatchSize + '" min="1" max="32" ' +
                       'class="tool-config-input w-full" />' +
              '</div>' +
            '</div>' +
            '<p class="text-xs text-muted-foreground">Higher values speed up embedding generation but may hit rate limits.</p>' +
          '</div>' +

          // Environment Variables Section
          '<div class="rounded-lg border border-border p-4 space-y-3">' +
            '<div class="flex items-center justify-between">' +
              '<h4 class="text-sm font-medium flex items-center gap-2">' +
                '<i data-lucide="file-code" class="w-4 h-4"></i> Environment Variables' +
              '</h4>' +
              '<button class="text-xs text-primary hover:underline" onclick="loadEnvVariables()">Load</button>' +
            '</div>' +
            '<div id="envVarsContainer" class="space-y-2">' +
              '<div class="text-xs text-muted-foreground">Click Load to view/edit ~/.codexlens/.env</div>' +
            '</div>' +
          '</div>' +

          // Migration Warning
          '<div class="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg p-3">' +
            '<i data-lucide="alert-triangle" class="w-4 h-4 text-warning mt-0.5 flex-shrink-0"></i>' +
            '<div class="text-sm">' +
              '<p class="font-medium text-warning">' + t('codexlens.migrationRequired') + '</p>' +
              '<p class="text-muted-foreground mt-1 text-xs">' + t('codexlens.migrationWarning') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ========== SEARCH TAB (only if installed) ==========
      (isInstalled
        ? '<div class="codexlens-tab-content hidden" data-tab="search">' +
            '<div class="space-y-4">' +
              // Search Options Row
              '<div class="grid grid-cols-2 gap-3">' +
                '<div>' +
                  '<label class="block text-xs font-medium text-muted-foreground mb-1">Search Type</label>' +
                  '<select id="searchTypeSelect" class="tool-config-select w-full">' +
                    '<option value="search">Content Search</option>' +
                    '<option value="search_files">File Search</option>' +
                    '<option value="symbol">Symbol Search</option>' +
                  '</select>' +
                '</div>' +
                '<div>' +
                  '<label class="block text-xs font-medium text-muted-foreground mb-1">Mode</label>' +
                  '<select id="searchModeSelect" class="tool-config-select w-full">' +
                    '<option value="dense_rerank">Semantic (default)</option>' +
                    '<option value="fts">Exact (FTS)</option>' +
                    '<option value="fuzzy">Fuzzy</option>' +
                  '</select>' +
                '</div>' +
              '</div>' +
              // Query Input
              '<div>' +
                '<input type="text" id="searchQueryInput" class="tool-config-input w-full text-base py-2.5" ' +
                       'placeholder="Enter search query..." />' +
              '</div>' +
              // Search Button
              '<button class="btn btn-primary w-full py-2.5" id="runSearchBtn">' +
                '<i data-lucide="search" class="w-4 h-4 mr-2"></i> Search' +
              '</button>' +
              // Results
              '<div id="searchResults" class="hidden">' +
                '<div class="flex items-center justify-between mb-2">' +
                  '<span class="text-sm font-medium">Results</span>' +
                  '<span id="searchResultCount" class="text-xs text-muted-foreground"></span>' +
                '</div>' +
                '<pre id="searchResultContent" class="text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-64"></pre>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +

      // ========== ADVANCED TAB (only if installed) ==========
      (isInstalled
        ? '<div class="codexlens-tab-content hidden" data-tab="advanced">' +
            '<div class="space-y-4">' +
              // Dependencies Section
              '<div class="rounded-lg border border-border p-4">' +
                '<h4 class="text-sm font-medium mb-3 flex items-center gap-2">' +
                  '<i data-lucide="package" class="w-4 h-4"></i> Dependencies' +
                '</h4>' +
                '<div id="semanticDepsStatus" class="space-y-2">' +
                  '<div class="text-sm text-muted-foreground">' + t('codexlens.checkingDeps') + '</div>' +
                '</div>' +
                // SPLADE status hidden - not currently used
                // '<div id="spladeStatus" class="space-y-2 mt-3 pt-3 border-t border-border">' +
                //   '<div class="text-sm text-muted-foreground">' + t('common.loading') + '</div>' +
                // '</div>' +
              '</div>' +

              // Model Management - Simplified with Embedding and Reranker sections
              '<div class="rounded-lg border border-border p-4">' +
                '<h4 class="text-sm font-medium mb-3 flex items-center gap-2">' +
                  '<i data-lucide="brain" class="w-4 h-4"></i> ' + t('codexlens.models') +
                '</h4>' +
                // Embedding Models
                '<div class="mb-4">' +
                  '<div class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">' +
                    '<i data-lucide="layers" class="w-3 h-3"></i> Embedding Models' +
                  '</div>' +
                  '<div id="modelListContainer" class="space-y-2">' +
                    '<div class="text-sm text-muted-foreground">' + t('codexlens.loadingModels') + '</div>' +
                  '</div>' +
                '</div>' +
                // Reranker Models
                '<div class="pt-3 border-t border-border">' +
                  '<div class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">' +
                    '<i data-lucide="arrow-up-down" class="w-3 h-3"></i> Reranker Models' +
                  '</div>' +
                  '<div id="rerankerModelListContainer" class="space-y-2">' +
                    '<div class="text-sm text-muted-foreground">' + t('common.loading') + '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              // Danger Zone
              '<div class="rounded-lg border border-destructive/30 p-4">' +
                '<h4 class="text-sm font-medium text-destructive mb-3 flex items-center gap-2">' +
                  '<i data-lucide="alert-triangle" class="w-4 h-4"></i> Danger Zone' +
                '</h4>' +
                '<div class="flex flex-wrap gap-2">' +
                  '<button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted/50 transition-colors" onclick="cleanCodexLensIndexes()">' +
                    '<i data-lucide="trash" class="w-3.5 h-3.5"></i> Clean All Indexes' +
                  '</button>' +
                  '<button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition-colors" onclick="uninstallCodexLensFromManager()">' +
                    '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Uninstall' +
                  '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +

      '</div>' + // End Tab Content Container
    '</div>' + // End modal-body

    // Footer
    '<div class="tool-config-footer">' +
      '<button class="btn btn-outline" onclick="closeModal()">' + t('common.cancel') + '</button>' +
      '<button class="btn btn-primary" id="saveCodexLensConfigBtn">' +
        '<i data-lucide="save" class="w-3.5 h-3.5"></i> ' + t('codexlens.saveConfig') +
      '</button>' +
    '</div>' +
  '</div>';
}

/**
 * Initialize CodexLens config modal event handlers
 */
function initCodexLensConfigEvents(currentConfig) {
  // Tab switching
  document.querySelectorAll('.codexlens-tab').forEach(function(tab) {
    tab.onclick = function() {
      // Remove active from all tabs
      document.querySelectorAll('.codexlens-tab').forEach(function(t) {
        t.classList.remove('active', 'border-primary', 'text-primary');
        t.classList.add('border-transparent', 'text-muted-foreground');
      });
      // Hide all content
      document.querySelectorAll('.codexlens-tab-content').forEach(function(c) {
        c.classList.add('hidden');
        c.classList.remove('active');
      });
      // Activate clicked tab
      this.classList.add('active', 'border-primary', 'text-primary');
      this.classList.remove('border-transparent', 'text-muted-foreground');
      // Show corresponding content
      var tabName = this.dataset.tab;
      var content = document.querySelector('.codexlens-tab-content[data-tab="' + tabName + '"]');
      if (content) {
        content.classList.remove('hidden');
        content.classList.add('active');
      }
    };
  });

  // Save button
  var saveBtn = document.getElementById('saveCodexLensConfigBtn');
  if (saveBtn) {
    saveBtn.onclick = async function() {
      var indexDirInput = document.getElementById('indexDirInput');
      var apiMaxWorkersInput = document.getElementById('apiMaxWorkersInput');
      var apiBatchSizeInput = document.getElementById('apiBatchSizeInput');

      var newIndexDir = indexDirInput ? indexDirInput.value.trim() : '';
      var newMaxWorkers = apiMaxWorkersInput ? parseInt(apiMaxWorkersInput.value) || 4 : 4;
      var newBatchSize = apiBatchSizeInput ? parseInt(apiBatchSizeInput.value) || 8 : 8;

      if (!newIndexDir) {
        showRefreshToast(t('codexlens.pathEmpty'), 'error');
        return;
      }

      // Check if anything changed
      var hasChanges = newIndexDir !== currentConfig.index_dir ||
                       newMaxWorkers !== (currentConfig.api_max_workers || 4) ||
                       newBatchSize !== (currentConfig.api_batch_size || 8);

      if (!hasChanges) {
        closeModal();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="animate-pulse">' + t('common.saving') + '</span>';

      try {
        var response = await fetch('/api/codexlens/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            index_dir: newIndexDir,
            api_max_workers: newMaxWorkers,
            api_batch_size: newBatchSize
          })
        });

        var result = await response.json();

        if (result.success) {
          showRefreshToast(t('codexlens.configSaved'), 'success');
          closeModal();

          // Refresh CodexLens status
          if (typeof loadCodexLensStatus === 'function') {
            await loadCodexLensStatus();
            renderToolsSection();
            if (window.lucide) lucide.createIcons();
          }
        } else {
          showRefreshToast(t('common.saveFailed') + ': ' + result.error, 'error');
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i data-lucide="save" class="w-3.5 h-3.5"></i> ' + t('codexlens.saveConfig');
          if (window.lucide) lucide.createIcons();
        }
      } catch (err) {
        showRefreshToast(t('common.error') + ': ' + err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i data-lucide="save" class="w-3.5 h-3.5"></i> ' + t('codexlens.saveConfig');
        if (window.lucide) lucide.createIcons();
      }
    };
  }

  // Test Search Button
  var runSearchBtn = document.getElementById('runSearchBtn');
  if (runSearchBtn) {
    runSearchBtn.onclick = async function() {
      var searchType = document.getElementById('searchTypeSelect').value;
      var searchMode = document.getElementById('searchModeSelect').value;
      var query = document.getElementById('searchQueryInput').value.trim();
      var searchLimit = document.getElementById('searchLimitInput')?.value || '5';
      var contentLength = document.getElementById('contentLengthInput')?.value || '200';
      var extraFiles = document.getElementById('extraFilesInput')?.value || '10';
      var resultsDiv = document.getElementById('searchResults');
      var resultCount = document.getElementById('searchResultCount');
      var resultContent = document.getElementById('searchResultContent');

      if (!query) {
        showRefreshToast(t('codexlens.enterQuery'), 'warning');
        return;
      }

      runSearchBtn.disabled = true;
      runSearchBtn.innerHTML = '<span class="animate-pulse">' + t('codexlens.searching') + '</span>';
      resultsDiv.classList.add('hidden');

      try {
        var endpoint = '/api/codexlens/' + searchType;
        var params = new URLSearchParams({
          query: query,
          limit: searchLimit,
          max_content_length: contentLength,
          extra_files_count: extraFiles
        });
        // Add mode parameter for search and search_files (not for symbol search)
        if (searchType === 'search' || searchType === 'search_files') {
          params.append('mode', searchMode);
        }

        var response = await fetch(endpoint + '?' + params.toString());
        var result = await response.json();

        console.log('[CodexLens Test] Search result:', result);

        if (result.success) {
          var results = result.results || result.files || [];
          resultCount.textContent = results.length + ' ' + t('codexlens.resultsCount');
          resultContent.textContent = JSON.stringify(results, null, 2);
          resultsDiv.classList.remove('hidden');
          showRefreshToast(t('codexlens.searchCompleted') + ': ' + results.length + ' ' + t('codexlens.resultsCount'), 'success');
        } else {
          resultContent.textContent = t('common.error') + ': ' + (result.error || t('common.unknownError'));
          resultsDiv.classList.remove('hidden');
          showRefreshToast(t('codexlens.searchFailed') + ': ' + result.error, 'error');
        }

        runSearchBtn.disabled = false;
        runSearchBtn.innerHTML = '<i data-lucide="search" class="w-3 h-3"></i> ' + t('codexlens.runSearch');
        if (window.lucide) lucide.createIcons();
      } catch (err) {
        console.error('[CodexLens Test] Error:', err);
        resultContent.textContent = t('common.exception') + ': ' + err.message;
        resultsDiv.classList.remove('hidden');
        showRefreshToast(t('common.error') + ': ' + err.message, 'error');
        runSearchBtn.disabled = false;
        runSearchBtn.innerHTML = '<i data-lucide="search" class="w-3 h-3"></i> ' + t('codexlens.runSearch');
        if (window.lucide) lucide.createIcons();
      }
    };
  }

  // Load FastEmbed installation status (show/hide install card)
  loadFastEmbedInstallStatus();

  // Load semantic dependencies status
  loadSemanticDepsStatus();

  // SPLADE status hidden - not currently used
  // loadSpladeStatus();

  // Load model lists (embedding and reranker)
  loadModelList();
  loadRerankerModelList();

  // Load workspace index status
  refreshWorkspaceIndexStatus();
}

// ============================================================
// MODEL LOCK/UNLOCK MANAGEMENT
// ============================================================

var MODEL_LOCK_KEY = 'codexlens_model_lock';

/**
 * Get model lock state from localStorage
 * @returns {Object} { locked: boolean, backend: string, model: string }
 */
function getModelLockState() {
  try {
    var stored = localStorage.getItem(MODEL_LOCK_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[CodexLens] Failed to get model lock state:', e);
  }
  return { locked: false, backend: 'fastembed', model: 'code' };
}

/**
 * Set model lock state in localStorage
 * @param {boolean} locked - Whether model is locked
 * @param {string} backend - Selected backend
 * @param {string} model - Selected model
 */
function setModelLockState(locked, backend, model) {
  try {
    localStorage.setItem(MODEL_LOCK_KEY, JSON.stringify({
      locked: locked,
      backend: backend || 'fastembed',
      model: model || 'code'
    }));
  } catch (e) {
    console.warn('[CodexLens] Failed to save model lock state:', e);
  }
}

/**
 * Toggle model lock state
 */
function toggleModelLock() {
  var backendSelect = document.getElementById('pageBackendSelect');
  var modelSelect = document.getElementById('pageModelSelect');
  var lockBtn = document.getElementById('modelLockBtn');
  var lockIcon = document.getElementById('modelLockIcon');

  var currentState = getModelLockState();
  var newLocked = !currentState.locked;

  // Get current values if locking
  var backend = newLocked ? (backendSelect ? backendSelect.value : 'fastembed') : currentState.backend;
  var model = newLocked ? (modelSelect ? modelSelect.value : 'code') : currentState.model;

  // Save state
  setModelLockState(newLocked, backend, model);

  // Update UI
  applyModelLockUI(newLocked, backend, model);

  // Show feedback
  if (newLocked) {
    showRefreshToast('Model locked: ' + backend + ' / ' + model, 'success');
  } else {
    showRefreshToast('Model unlocked', 'info');
  }
}

/**
 * Apply model lock UI state
 */
function applyModelLockUI(locked, backend, model) {
  var backendSelect = document.getElementById('pageBackendSelect');
  var modelSelect = document.getElementById('pageModelSelect');
  var lockBtn = document.getElementById('modelLockBtn');
  var lockIcon = document.getElementById('modelLockIcon');
  var lockText = document.getElementById('modelLockText');

  if (backendSelect) {
    backendSelect.disabled = locked;
    if (locked && backend) {
      backendSelect.value = backend;
    }
  }

  if (modelSelect) {
    modelSelect.disabled = locked;
    if (locked && model) {
      modelSelect.value = model;
    }
  }

  if (lockBtn) {
    if (locked) {
      lockBtn.classList.remove('btn-outline');
      lockBtn.classList.add('btn-primary');
    } else {
      lockBtn.classList.remove('btn-primary');
      lockBtn.classList.add('btn-outline');
    }
  }

  if (lockIcon) {
    lockIcon.setAttribute('data-lucide', locked ? 'lock' : 'unlock');
    if (window.lucide) lucide.createIcons();
  }

  if (lockText) {
    lockText.textContent = locked ? 'Locked' : 'Lock Model';
  }
}

/**
 * Initialize model lock state on page load
 */
function initModelLockState() {
  var state = getModelLockState();
  if (state.locked) {
    applyModelLockUI(true, state.backend, state.model);
  }
}

// Make functions globally accessible
window.toggleModelLock = toggleModelLock;
window.initModelLockState = initModelLockState;
window.getModelLockState = getModelLockState;

// ============================================================
// ENVIRONMENT VARIABLES MANAGEMENT
// ============================================================

// Environment variable groups for organized display
// Maps to settings.json structure in ~/.codexlens/settings.json
// Embedding and Reranker are configured separately
var ENV_VAR_GROUPS = {
  embedding: {
    labelKey: 'codexlens.envGroup.embedding',
    icon: 'box',
    vars: {
      'CODEXLENS_EMBEDDING_BACKEND': { labelKey: 'codexlens.envField.backend', type: 'select', options: ['local', 'api'], default: 'local', settingsPath: 'embedding.backend' },
      'CODEXLENS_EMBEDDING_MODEL': {
        labelKey: 'codexlens.envField.model',
        type: 'model-select',
        placeholder: 'Select or enter model...',
        default: 'fast',
        settingsPath: 'embedding.model',
        localModels: [
          { group: 'FastEmbed Profiles', items: ['fast', 'code', 'base', 'minilm', 'multilingual', 'balanced'] }
        ],
        apiModels: [
          { group: 'OpenAI', items: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'] },
          { group: 'Cohere', items: ['embed-english-v3.0', 'embed-multilingual-v3.0', 'embed-english-light-v3.0'] },
          { group: 'Voyage', items: ['voyage-3', 'voyage-3-lite', 'voyage-code-3', 'voyage-multilingual-2'] },
          { group: 'SiliconFlow', items: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'BAAI/bge-large-en-v1.5'] },
          { group: 'Jina', items: ['jina-embeddings-v3', 'jina-embeddings-v2-base-en', 'jina-embeddings-v2-base-zh'] }
        ]
      },
      'CODEXLENS_USE_GPU': { labelKey: 'codexlens.envField.useGpu', type: 'select', options: ['true', 'false'], default: 'true', settingsPath: 'embedding.use_gpu', showWhen: function(env) { return env['CODEXLENS_EMBEDDING_BACKEND'] === 'local'; } },
      'CODEXLENS_EMBEDDING_POOL_ENABLED': { labelKey: 'codexlens.envField.highAvailability', type: 'select', options: ['true', 'false'], default: 'false', settingsPath: 'embedding.pool_enabled', showWhen: function(env) { return env['CODEXLENS_EMBEDDING_BACKEND'] === 'api'; } },
      'CODEXLENS_EMBEDDING_STRATEGY': { labelKey: 'codexlens.envField.loadBalanceStrategy', type: 'select', options: ['round_robin', 'latency_aware', 'weighted_random'], default: 'latency_aware', settingsPath: 'embedding.strategy', showWhen: function(env) { return env['CODEXLENS_EMBEDDING_BACKEND'] === 'api' && env['CODEXLENS_EMBEDDING_POOL_ENABLED'] === 'true'; } },
      'CODEXLENS_EMBEDDING_COOLDOWN': { labelKey: 'codexlens.envField.rateLimitCooldown', type: 'number', placeholder: '60', default: '60', settingsPath: 'embedding.cooldown', min: 0, max: 300, showWhen: function(env) { return env['CODEXLENS_EMBEDDING_BACKEND'] === 'api' && env['CODEXLENS_EMBEDDING_POOL_ENABLED'] === 'true'; } }
    }
  },
  reranker: {
    labelKey: 'codexlens.envGroup.reranker',
    icon: 'arrow-up-down',
    vars: {
      'CODEXLENS_RERANKER_ENABLED': { labelKey: 'codexlens.envField.enabled', type: 'select', options: ['true', 'false'], default: 'true', settingsPath: 'reranker.enabled' },
      'CODEXLENS_RERANKER_BACKEND': { labelKey: 'codexlens.envField.backend', type: 'select', options: ['local', 'api'], default: 'local', settingsPath: 'reranker.backend' },
      'CODEXLENS_RERANKER_MODEL': {
        labelKey: 'codexlens.envField.model',
        type: 'model-select',
        placeholder: 'Select or enter model...',
        default: 'Xenova/ms-marco-MiniLM-L-6-v2',
        settingsPath: 'reranker.model',
        localModels: [
          { group: 'FastEmbed/ONNX', items: ['Xenova/ms-marco-MiniLM-L-6-v2', 'cross-encoder/ms-marco-MiniLM-L-6-v2', 'BAAI/bge-reranker-base'] }
        ],
        apiModels: [
          { group: 'Cohere', items: ['rerank-english-v3.0', 'rerank-multilingual-v3.0', 'rerank-english-v2.0'] },
          { group: 'Voyage', items: ['rerank-2', 'rerank-2-lite', 'rerank-1'] },
          { group: 'SiliconFlow', items: ['BAAI/bge-reranker-v2-m3', 'BAAI/bge-reranker-large', 'BAAI/bge-reranker-base'] },
          { group: 'Jina', items: ['jina-reranker-v2-base-multilingual', 'jina-reranker-v1-base-en'] }
        ]
      },
      'CODEXLENS_RERANKER_TOP_K': { labelKey: 'codexlens.envField.topKResults', type: 'number', placeholder: '50', default: '50', settingsPath: 'reranker.top_k', min: 5, max: 200 },
      'CODEXLENS_RERANKER_POOL_ENABLED': { labelKey: 'codexlens.envField.highAvailability', type: 'select', options: ['true', 'false'], default: 'false', settingsPath: 'reranker.pool_enabled', showWhen: function(env) { return env['CODEXLENS_RERANKER_BACKEND'] === 'api'; } },
      'CODEXLENS_RERANKER_STRATEGY': { labelKey: 'codexlens.envField.loadBalanceStrategy', type: 'select', options: ['round_robin', 'latency_aware', 'weighted_random'], default: 'latency_aware', settingsPath: 'reranker.strategy', showWhen: function(env) { return env['CODEXLENS_RERANKER_BACKEND'] === 'api' && env['CODEXLENS_RERANKER_POOL_ENABLED'] === 'true'; } },
      'CODEXLENS_RERANKER_COOLDOWN': { labelKey: 'codexlens.envField.rateLimitCooldown', type: 'number', placeholder: '60', default: '60', settingsPath: 'reranker.cooldown', min: 0, max: 300, showWhen: function(env) { return env['CODEXLENS_RERANKER_BACKEND'] === 'api' && env['CODEXLENS_RERANKER_POOL_ENABLED'] === 'true'; } }
    }
  },
  concurrency: {
    labelKey: 'codexlens.envGroup.concurrency',
    icon: 'cpu',
    vars: {
      'CODEXLENS_API_MAX_WORKERS': { labelKey: 'codexlens.envField.maxWorkers', type: 'number', placeholder: '4', default: '4', settingsPath: 'api.max_workers', min: 1, max: 32 },
      'CODEXLENS_API_BATCH_SIZE': { labelKey: 'codexlens.envField.batchSize', type: 'number', placeholder: '8', default: '8', settingsPath: 'api.batch_size', min: 1, max: 64 }
    }
  },
  cascade: {
    labelKey: 'codexlens.envGroup.cascade',
    icon: 'git-branch',
    vars: {
      'CODEXLENS_CASCADE_STRATEGY': { labelKey: 'codexlens.envField.searchStrategy', type: 'select', options: ['binary', 'hybrid', 'binary_rerank', 'dense_rerank'], default: 'dense_rerank', settingsPath: 'cascade.strategy' },
      'CODEXLENS_CASCADE_COARSE_K': { labelKey: 'codexlens.envField.coarseK', type: 'number', placeholder: '100', default: '100', settingsPath: 'cascade.coarse_k', min: 10, max: 500 },
      'CODEXLENS_CASCADE_FINE_K': { labelKey: 'codexlens.envField.fineK', type: 'number', placeholder: '10', default: '10', settingsPath: 'cascade.fine_k', min: 1, max: 100 }
    }
  }
};

/**
 * Load environment variables from ~/.codexlens/.env
 */
async function loadEnvVariables() {
  var container = document.getElementById('envVarsContainer');
  if (!container) return;

  container.innerHTML = '<div class="text-xs text-muted-foreground animate-pulse">Loading...</div>';

  try {
    // Fetch env vars, configured models, and local models in parallel
    var [envResponse, embeddingPoolResponse, rerankerPoolResponse, localModelsResponse, localRerankerModelsResponse] = await Promise.all([
      fetch('/api/codexlens/env'),
      fetch('/api/litellm-api/embedding-pool').catch(function() { return null; }),
      fetch('/api/litellm-api/reranker-pool').catch(function() { return null; }),
      fetch('/api/codexlens/models').catch(function() { return null; }),
      fetch('/api/codexlens/reranker/models').catch(function() { return null; })
    ]);

    var result = await envResponse.json();

    if (!result.success) {
      container.innerHTML = '<div class="text-xs text-error">' + escapeHtml(result.error || 'Failed to load') + '</div>';
      return;
    }

    // Get configured embedding models from API settings
    var configuredEmbeddingModels = [];
    if (embeddingPoolResponse && embeddingPoolResponse.ok) {
      var poolData = await embeddingPoolResponse.json();
      configuredEmbeddingModels = poolData.availableModels || [];
    }

    // Get configured reranker models from API settings
    var configuredRerankerModels = [];
    if (rerankerPoolResponse && rerankerPoolResponse.ok) {
      var rerankerData = await rerankerPoolResponse.json();
      configuredRerankerModels = rerankerData.availableModels || [];
    }

    // Get local downloaded embedding models
    var localEmbeddingModels = [];
    if (localModelsResponse && localModelsResponse.ok) {
      var localData = await localModelsResponse.json();
      // CLI returns { success: true, result: { models: [...] } }
      if (localData.success) {
        var models = localData.models || (localData.result && localData.result.models) || [];
        // Filter to only installed models (CLI uses 'installed' not 'downloaded')
        localEmbeddingModels = models.filter(function(m) { return m.installed; });
      }
    }

    // Get local downloaded reranker models
    var localRerankerModels = [];
    if (localRerankerModelsResponse && localRerankerModelsResponse.ok) {
      var localRerankerData = await localRerankerModelsResponse.json();
      // CLI returns { success: true, result: { models: [...] } }
      if (localRerankerData.success) {
        var models = localRerankerData.models || (localRerankerData.result && localRerankerData.result.models) || [];
        // Filter to only installed models
        localRerankerModels = models.filter(function(m) { return m.installed; });
      }
    }

    // Cache model data for dynamic backend switching
    var embeddingVars = ENV_VAR_GROUPS.embedding.vars;
    var rerankerVars = ENV_VAR_GROUPS.reranker.vars;
    cachedEmbeddingModels = {
      local: localEmbeddingModels,
      api: configuredEmbeddingModels,
      apiModels: embeddingVars['CODEXLENS_EMBEDDING_MODEL'] ? embeddingVars['CODEXLENS_EMBEDDING_MODEL'].apiModels || [] : []
    };
    cachedRerankerModels = {
      local: localRerankerModels,
      api: configuredRerankerModels,
      apiModels: rerankerVars['CODEXLENS_RERANKER_MODEL'] ? rerankerVars['CODEXLENS_RERANKER_MODEL'].apiModels || [] : []
    };

    var env = result.env || {};
    var settings = result.settings || {};  // Current settings from settings.json
    var html = '<div class="space-y-4">';

    // Get available LiteLLM providers
    var litellmProviders = window.litellmApiConfig?.providers || [];

    // Render each group
    for (var groupKey in ENV_VAR_GROUPS) {
      var group = ENV_VAR_GROUPS[groupKey];

      // Check if this group should be shown
      if (group.showWhen && !group.showWhen(env)) {
        continue;
      }

      var groupLabel = group.labelKey ? t(group.labelKey) : group.label;
      html += '<div class="border border-border rounded-lg p-3">' +
        '<div class="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">' +
          '<i data-lucide="' + group.icon + '" class="w-3.5 h-3.5"></i>' +
          groupLabel +
        '</div>' +
        '<div class="space-y-2">';

      // Add provider selector for API group
      if (groupKey === 'api' && litellmProviders.length > 0) {
        html += '<div class="flex items-center gap-2 mb-2 pb-2 border-b border-border">' +
          '<label class="text-xs text-muted-foreground w-28 flex-shrink-0">Use Provider</label>' +
          '<select id="litellmProviderSelect" class="tool-config-input flex-1 text-xs py-1" onchange="applyLiteLLMProvider(this.value)">' +
            '<option value="">-- Select to auto-fill --</option>';
        litellmProviders.forEach(function(provider) {
          var providerName = provider.name || provider.id || 'Unknown';
          html += '<option value="' + escapeHtml(provider.id || providerName) + '">' + escapeHtml(providerName) + '</option>';
        });
        html += '</select></div>';
      }

      for (var key in group.vars) {
        var config = group.vars[key];

        // Check variable-level showWhen condition - render but hide if condition is false
        var shouldShow = !config.showWhen || config.showWhen(env);
        var hiddenStyle = shouldShow ? '' : ' style="display:none"';

        // Priority: env file > settings.json > hardcoded default
        var value = env[key] || settings[key] || config.default || '';

        if (config.type === 'select') {
          // Add onchange handler for backend selects to update model options dynamically
          var onchangeHandler = '';
          if (key === 'CODEXLENS_EMBEDDING_BACKEND' || key === 'CODEXLENS_RERANKER_BACKEND') {
            onchangeHandler = ' onchange="updateModelOptionsOnBackendChange(\'' + key + '\', this.value)"';
          }
          var fieldLabel = config.labelKey ? t(config.labelKey) : config.label;
          html += '<div class="flex items-center gap-2"' + hiddenStyle + '>' +
            '<label class="text-xs text-muted-foreground w-28 flex-shrink-0">' + escapeHtml(fieldLabel) + '</label>' +
            '<select class="tool-config-input flex-1 text-xs py-1" data-env-key="' + escapeHtml(key) + '"' + onchangeHandler + '>';
          config.options.forEach(function(opt) {
            html += '<option value="' + escapeHtml(opt) + '"' + (value === opt ? ' selected' : '') + '>' + escapeHtml(opt) + '</option>';
          });
          html += '</select></div>';
        } else if (config.type === 'model-select') {
          // Model selector with grouped options and custom input support
          // Supports localModels/apiModels based on backend type
          var datalistId = 'models-' + key.replace(/_/g, '-').toLowerCase();
          var isEmbedding = key.indexOf('EMBEDDING') !== -1;
          var isReranker = key.indexOf('RERANKER') !== -1;
          var backendKey = isEmbedding ? 'CODEXLENS_EMBEDDING_BACKEND' : 'CODEXLENS_RERANKER_BACKEND';
          var isApiBackend = env[backendKey] === 'litellm' || env[backendKey] === 'api';

          // Get actual downloaded local models
          var actualLocalModels = isEmbedding ? localEmbeddingModels : localRerankerModels;
          // Get configured API models
          var configuredModels = isEmbedding ? configuredEmbeddingModels : configuredRerankerModels;
          // Fallback preset list for API models
          var apiModelList = config.apiModels || [];

          var modelFieldLabel = config.labelKey ? t(config.labelKey) : config.label;
          html += '<div class="flex items-center gap-2"' + hiddenStyle + '>' +
            '<label class="text-xs text-muted-foreground w-28 flex-shrink-0" title="' + escapeHtml(key) + '">' + escapeHtml(modelFieldLabel) + '</label>' +
            '<div class="relative flex-1">' +
              '<input type="text" class="tool-config-input w-full text-xs py-1 pr-6" ' +
                     'data-env-key="' + escapeHtml(key) + '" value="' + escapeHtml(value) + '" ' +
                     'placeholder="' + escapeHtml(config.placeholder || '') + '" list="' + datalistId + '" />' +
              '<i data-lucide="chevron-down" class="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"></i>' +
            '</div>' +
            '<datalist id="' + datalistId + '">';

          if (isApiBackend) {
            // For API backend: show ONLY configured models from API settings
            // (don't show unconfigured preset models - they won't work without configuration)
            if (configuredModels.length > 0) {
              html += '<option value="" disabled>-- ' + (t('codexlens.configuredModels') || 'Configured in API Settings') + ' --</option>';
              configuredModels.forEach(function(model) {
                var providers = model.providers ? model.providers.join(', ') : '';
                html += '<option value="' + escapeHtml(model.modelId) + '">' +
                  escapeHtml(model.modelName || model.modelId) +
                  (providers ? ' (' + escapeHtml(providers) + ')' : '') +
                  '</option>';
              });
            } else {
              html += '<option value="" disabled>-- ' + (t('codexlens.noConfiguredModels') || 'No models configured in API Settings') + ' --</option>';
            }
          } else {
            // For local backend (fastembed): show actually downloaded models
            if (actualLocalModels.length > 0) {
              html += '<option value="" disabled>-- ' + (t('codexlens.downloadedModels') || 'Downloaded Models') + ' --</option>';
              actualLocalModels.forEach(function(model) {
                // Priority: profile (for fastembed) > model_id > id > name
                var modelId = model.profile || model.model_id || model.id || model.name;
                var displayName = model.display_name || model.name || model.profile || modelId;
                // Show both profile and model name for clarity
                var displayText = model.profile && model.name ?
                  model.profile + ' (' + model.name + ')' : displayName;
                html += '<option value="' + escapeHtml(modelId) + '">' + escapeHtml(displayText) + '</option>';
              });
            } else {
              html += '<option value="" disabled>-- ' + (t('codexlens.noLocalModels') || 'No models downloaded') + ' --</option>';
            }
          }

          html += '</datalist></div>';
        } else {
          var inputType = config.type || 'text';
          var extraAttrs = '';
          if (config.type === 'number') {
            if (config.min !== undefined) extraAttrs += ' min="' + config.min + '"';
            if (config.max !== undefined) extraAttrs += ' max="' + config.max + '"';
            extraAttrs += ' step="1"';
          }
          var inputFieldLabel = config.labelKey ? t(config.labelKey) : config.label;
          html += '<div class="flex items-center gap-2"' + hiddenStyle + '>' +
            '<label class="text-xs text-muted-foreground w-28 flex-shrink-0" title="' + escapeHtml(key) + '">' + escapeHtml(inputFieldLabel) + '</label>' +
            '<input type="' + inputType + '" class="tool-config-input flex-1 text-xs py-1" ' +
                   'data-env-key="' + escapeHtml(key) + '" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(config.placeholder || '') + '"' + extraAttrs + ' />' +
          '</div>';
        }
      }

      html += '</div></div>';
    }

    html += '</div>' +
      '<div class="flex gap-2 mt-3">' +
        '<button class="btn-sm btn-primary flex-1" onclick="saveEnvVariables()">' +
          '<i data-lucide="save" class="w-3 h-3"></i> Save & Apply' +
        '</button>' +
        '<button class="btn-sm btn-outline" onclick="loadEnvVariables()">' +
          '<i data-lucide="refresh-cw" class="w-3 h-3"></i>' +
        '</button>' +
      '</div>' +
      '<div class="text-xs text-muted-foreground mt-2">' +
        '<i data-lucide="info" class="w-3 h-3 inline"></i> ' +
        'Saved to: ' + escapeHtml(result.path) +
      '</div>';

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    // Add change handler for backend selects to dynamically update model options
    // Note: Does NOT auto-save - user must click Save button
    var backendSelects = container.querySelectorAll('select[data-env-key*="BACKEND"]');
    backendSelects.forEach(function(select) {
      select.addEventListener('change', function() {
        var backendKey = select.getAttribute('data-env-key');
        var newBackend = select.value;
        // 'api' is the API backend, 'local' is the local backend
        var isApiBackend = newBackend === 'api';

        // Determine which model input to update
        var isEmbedding = backendKey.indexOf('EMBEDDING') !== -1;
        var modelKey = isEmbedding ? 'CODEXLENS_EMBEDDING_MODEL' : 'CODEXLENS_RERANKER_MODEL';
        var modelInput = document.querySelector('[data-env-key="' + modelKey + '"]');

        if (modelInput) {
          var datalistId = modelInput.getAttribute('list');
          var datalist = document.getElementById(datalistId);

          if (datalist) {
            // Get model config from ENV_VAR_GROUPS
            var groupKey = isEmbedding ? 'embedding' : 'reranker';
            var modelConfig = ENV_VAR_GROUPS[groupKey]?.vars[modelKey];

            if (modelConfig) {
              // Use the loaded models from closure
              var apiModelList = modelConfig.apiModels || [];
              var apiConfiguredModels = isEmbedding ? configuredEmbeddingModels : configuredRerankerModels;
              var actualLocalModels = isEmbedding ? localEmbeddingModels : localRerankerModels;

              // Rebuild datalist
              var optionsHtml = '';

              if (isApiBackend) {
                // For API backend: show ONLY configured models from API settings
                // (don't show unconfigured preset models - they won't work without configuration)
                if (apiConfiguredModels.length > 0) {
                  optionsHtml += '<option value="" disabled>-- ' + (t('codexlens.configuredModels') || 'Configured in API Settings') + ' --</option>';
                  apiConfiguredModels.forEach(function(model) {
                    var providers = model.providers ? model.providers.join(', ') : '';
                    optionsHtml += '<option value="' + escapeHtml(model.modelId) + '">' +
                      escapeHtml(model.modelName || model.modelId) +
                      (providers ? ' (' + escapeHtml(providers) + ')' : '') +
                      '</option>';
                  });
                } else {
                  optionsHtml += '<option value="" disabled>-- ' + (t('codexlens.noConfiguredModels') || 'No models configured in API Settings') + ' --</option>';
                }
              } else {
                // For local backend: show actually downloaded models
                if (actualLocalModels.length > 0) {
                  optionsHtml += '<option value="" disabled>-- ' + (t('codexlens.downloadedModels') || 'Downloaded Models') + ' --</option>';
                  actualLocalModels.forEach(function(model) {
                    var modelId = model.profile || model.model_id || model.id || model.name;
                    var displayName = model.display_name || model.name || model.profile || modelId;
                    var displayText = model.profile && model.name ?
                      model.profile + ' (' + model.name + ')' : displayName;
                    optionsHtml += '<option value="' + escapeHtml(modelId) + '">' + escapeHtml(displayText) + '</option>';
                  });
                } else {
                  optionsHtml += '<option value="" disabled>-- ' + (t('codexlens.noLocalModels') || 'No models downloaded') + ' --</option>';
                }
              }

              datalist.innerHTML = optionsHtml;

              // Clear current model value when switching backend type
              modelInput.value = '';
              modelInput.placeholder = isApiBackend ?
                (t('codexlens.selectApiModel') || 'Select API model...') :
                (t('codexlens.selectLocalModel') || 'Select local model...');
            }
          }
        }

        // Update visibility of dependent fields based on new backend value
        var prefix = isEmbedding ? 'CODEXLENS_EMBEDDING_' : 'CODEXLENS_RERANKER_';
        var gpuField = document.querySelector('[data-env-key="' + prefix + 'USE_GPU"]');
        var poolField = document.querySelector('[data-env-key="' + prefix + 'POOL_ENABLED"]');
        var strategyField = document.querySelector('[data-env-key="' + prefix + 'STRATEGY"]');
        var cooldownField = document.querySelector('[data-env-key="' + prefix + 'COOLDOWN"]');

        // GPU only for local backend
        if (gpuField) {
          var gpuRow = gpuField.closest('.flex.items-center');
          if (gpuRow) gpuRow.style.display = isApiBackend ? 'none' : '';
        }

        // Pool, Strategy, Cooldown only for API backend
        if (poolField) {
          var poolRow = poolField.closest('.flex.items-center');
          if (poolRow) poolRow.style.display = isApiBackend ? '' : 'none';
          // Reset pool value when switching to local
          if (!isApiBackend) poolField.value = 'false';
        }

        // Strategy and Cooldown depend on pool being enabled
        var poolEnabled = poolField && poolField.value === 'true';
        if (strategyField) {
          var strategyRow = strategyField.closest('.flex.items-center');
          if (strategyRow) strategyRow.style.display = (isApiBackend && poolEnabled) ? '' : 'none';
        }
        if (cooldownField) {
          var cooldownRow = cooldownField.closest('.flex.items-center');
          if (cooldownRow) cooldownRow.style.display = (isApiBackend && poolEnabled) ? '' : 'none';
        }

        // Note: No auto-save here - user must click Save button
      });
    });

    // Add change handler for pool_enabled selects to show/hide strategy and cooldown
    var poolSelects = container.querySelectorAll('select[data-env-key*="POOL_ENABLED"]');
    poolSelects.forEach(function(select) {
      select.addEventListener('change', function() {
        var poolKey = select.getAttribute('data-env-key');
        var poolEnabled = select.value === 'true';
        var isEmbedding = poolKey.indexOf('EMBEDDING') !== -1;
        var prefix = isEmbedding ? 'CODEXLENS_EMBEDDING_' : 'CODEXLENS_RERANKER_';

        var strategyField = document.querySelector('[data-env-key="' + prefix + 'STRATEGY"]');
        var cooldownField = document.querySelector('[data-env-key="' + prefix + 'COOLDOWN"]');

        if (strategyField) {
          var strategyRow = strategyField.closest('.flex.items-center');
          if (strategyRow) strategyRow.style.display = poolEnabled ? '' : 'none';
        }
        if (cooldownField) {
          var cooldownRow = cooldownField.closest('.flex.items-center');
          if (cooldownRow) cooldownRow.style.display = poolEnabled ? '' : 'none';
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="text-xs text-error">' + escapeHtml(err.message) + '</div>';
  }
}

/**
 * Apply LiteLLM provider settings to environment variables
 * Note: API credentials are now managed via API Settings page
 */
function applyLiteLLMProvider(providerId) {
  if (!providerId) return;

  var providers = window.litellmApiConfig?.providers || [];
  var provider = providers.find(function(p) {
    return (p.id || p.name) === providerId;
  });

  if (!provider) {
    console.warn('[CodexLens] Provider not found:', providerId);
    return;
  }

  // Auto-fill model fields based on provider
  var embeddingModelInput = document.querySelector('[data-env-key="CODEXLENS_EMBEDDING_MODEL"]');
  var rerankerModelInput = document.querySelector('[data-env-key="CODEXLENS_RERANKER_MODEL"]');

  // Set default models based on provider type
  var providerName = (provider.name || provider.id || '').toLowerCase();
  if (embeddingModelInput) {
    if (providerName.includes('openai')) {
      embeddingModelInput.value = embeddingModelInput.value || 'text-embedding-3-small';
    } else if (providerName.includes('cohere')) {
      embeddingModelInput.value = embeddingModelInput.value || 'embed-english-v3.0';
    } else if (providerName.includes('voyage')) {
      embeddingModelInput.value = embeddingModelInput.value || 'voyage-2';
    } else if (provider.embedding_model) {
      embeddingModelInput.value = provider.embedding_model;
    }
  }

  if (rerankerModelInput) {
    if (providerName.includes('cohere')) {
      rerankerModelInput.value = rerankerModelInput.value || 'rerank-english-v3.0';
    } else if (providerName.includes('voyage')) {
      rerankerModelInput.value = rerankerModelInput.value || 'rerank-1';
    } else if (provider.reranker_model) {
      rerankerModelInput.value = provider.reranker_model;
    }
  }

  showRefreshToast('Applied settings from: ' + (provider.name || providerId), 'success');
}

// Make function globally accessible
window.applyLiteLLMProvider = applyLiteLLMProvider;

/**
 * Update model datalist options when backend changes
 * @param {string} backendKey - The backend key that changed (CODEXLENS_EMBEDDING_BACKEND or CODEXLENS_RERANKER_BACKEND)
 * @param {string} newBackend - The new backend value ('local' or 'api')
 */
function updateModelOptionsOnBackendChange(backendKey, newBackend) {
  var isEmbedding = backendKey === 'CODEXLENS_EMBEDDING_BACKEND';
  var modelKey = isEmbedding ? 'CODEXLENS_EMBEDDING_MODEL' : 'CODEXLENS_RERANKER_MODEL';
  var datalistId = 'models-' + modelKey.replace(/_/g, '-').toLowerCase();
  var datalist = document.getElementById(datalistId);
  
  if (!datalist) return;
  
  var isApiBackend = newBackend === 'api' || newBackend === 'litellm';
  var cachedModels = isEmbedding ? cachedEmbeddingModels : cachedRerankerModels;
  
  var html = '';
  
  if (isApiBackend) {
    // For API backend: show configured models from API settings first
    var configuredModels = cachedModels.api || [];
    if (configuredModels.length > 0) {
      html += '<option value="" disabled>-- ' + (t('codexlens.configuredModels') || 'Configured in API Settings') + ' --</option>';
      configuredModels.forEach(function(model) {
        var providers = model.providers ? model.providers.join(', ') : '';
        html += '<option value="' + escapeHtml(model.modelId) + '">' +
          escapeHtml(model.modelName || model.modelId) +
          (providers ? ' (' + escapeHtml(providers) + ')' : '') +
          '</option>';
      });
    }
    // Then show common API models as suggestions
    var apiModelList = cachedModels.apiModels || [];
    if (apiModelList.length > 0) {
      html += '<option value="" disabled>-- ' + (t('codexlens.commonModels') || 'Common Models') + ' --</option>';
      apiModelList.forEach(function(group) {
        group.items.forEach(function(model) {
          // Skip if already in configured list
          var exists = configuredModels.some(function(m) { return m.modelId === model; });
          if (!exists) {
            html += '<option value="' + escapeHtml(model) + '">' + escapeHtml(group.group) + ': ' + escapeHtml(model) + '</option>';
          }
        });
      });
    }
  } else {
    // For local backend: show actually downloaded models
    var localModels = cachedModels.local || [];
    if (localModels.length > 0) {
      html += '<option value="" disabled>-- ' + (t('codexlens.downloadedModels') || 'Downloaded Models') + ' --</option>';
      localModels.forEach(function(model) {
        var modelId = model.profile || model.model_id || model.id || model.name;
        var displayName = model.display_name || model.name || model.profile || modelId;
        var displayText = model.profile && model.name ?
          model.profile + ' (' + model.name + ')' : displayName;
        html += '<option value="' + escapeHtml(modelId) + '">' + escapeHtml(displayText) + '</option>';
      });
    } else {
      html += '<option value="" disabled>-- ' + (t('codexlens.noLocalModels') || 'No models downloaded') + ' --</option>';
    }
  }
  
  datalist.innerHTML = html;
}

// Make function globally accessible
window.updateModelOptionsOnBackendChange = updateModelOptionsOnBackendChange;

/**
 * Save environment variables to ~/.codexlens/.env
 */
async function saveEnvVariables() {
  var inputs = document.querySelectorAll('[data-env-key]');
  var env = {};

  inputs.forEach(function(input) {
    var key = input.dataset.envKey;
    var value = input.value.trim();
    if (value) {
      env[key] = value;
    }
  });

  try {
    var response = await fetch('/api/codexlens/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: env })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast('Environment configuration saved', 'success');
    } else {
      showRefreshToast('Failed to save: ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
  }
}

// ============================================================
// SEMANTIC DEPENDENCIES MANAGEMENT
// ============================================================

// Store detected GPU info
var detectedGpuInfo = null;
// Store available GPU devices
var availableGpuDevices = null;
// Store model data for dynamic backend switching
var cachedEmbeddingModels = { local: [], api: [], apiModels: [] };
var cachedRerankerModels = { local: [], api: [], apiModels: [] };

/**
 * Detect GPU support
 */
async function detectGpuSupport() {
  try {
    var response = await fetch('/api/codexlens/gpu/detect');
    var result = await response.json();
    if (result.success) {
      detectedGpuInfo = result;
      return result;
    }
  } catch (err) {
    console.error('GPU detection failed:', err);
  }
  return { mode: 'cpu', available: ['cpu'], info: 'CPU only' };
}

/**
 * Load semantic dependencies status
 */
async function loadSemanticDepsStatus() {
  var container = document.getElementById('semanticDepsStatus');
  if (!container) return;

  try {
    // Detect GPU support and load GPU devices in parallel
    var gpuPromise = detectGpuSupport();
    var gpuDevicesPromise = loadGpuDevices();
    var response = await fetch('/api/codexlens/semantic/status');
    var result = await response.json();
    var gpuInfo = await gpuPromise;
    var gpuDevices = await gpuDevicesPromise;

    if (result.available) {
      // Build accelerator badge
      var accelerator = result.accelerator || 'CPU';
      var acceleratorIcon = 'cpu';
      var acceleratorClass = 'bg-muted text-muted-foreground';

      if (accelerator === 'CUDA') {
        acceleratorIcon = 'zap';
        acceleratorClass = 'bg-green-500/20 text-green-600';
      } else if (accelerator === 'DirectML') {
        acceleratorIcon = 'cpu';
        acceleratorClass = 'bg-blue-500/20 text-blue-600';
      } else if (accelerator === 'ROCm') {
        acceleratorIcon = 'flame';
        acceleratorClass = 'bg-red-500/20 text-red-600';
      }

      // Build GPU device selector if multiple GPUs available
      var gpuDeviceSelector = buildGpuDeviceSelector(gpuDevices);

      container.innerHTML =
        '<div class="space-y-2">' +
          '<div class="flex items-center gap-2 text-sm">' +
            '<i data-lucide="check-circle" class="w-4 h-4 text-success"></i>' +
            '<span>' + t('codexlens.semanticInstalled') + '</span>' +
            '<span class="text-muted-foreground">(' + (result.backend || 'fastembed') + ')</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ' + acceleratorClass + '">' +
              '<i data-lucide="' + acceleratorIcon + '" class="w-3 h-3"></i>' +
              accelerator +
            '</span>' +
            (result.providers && result.providers.length > 0
              ? '<span class="text-xs text-muted-foreground">' + result.providers.join(', ') + '</span>'
              : '') +
          '</div>' +
          gpuDeviceSelector +
        '</div>';
    } else {
      // Build GPU mode options
      var gpuOptions = buildGpuModeSelector(gpuInfo);

      container.innerHTML =
        '<div class="space-y-3">' +
          '<div class="flex items-center gap-2 text-sm text-muted-foreground">' +
            '<i data-lucide="alert-circle" class="w-4 h-4"></i>' +
            '<span>' + t('codexlens.semanticNotInstalled') + '</span>' +
          '</div>' +
          gpuOptions +
          '<button class="btn-sm btn-primary w-full" onclick="installSemanticDepsWithGpu()">' +
            '<i data-lucide="download" class="w-3 h-3"></i> ' + t('codexlens.installDeps') +
          '</button>' +
        '</div>';
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML =
      '<div class="text-sm text-error">' + t('common.error') + ': ' + escapeHtml(err.message) + '</div>';
  }
}

/**
 * Build GPU mode selector HTML
 */
function buildGpuModeSelector(gpuInfo) {
  // Check if DirectML is unavailable due to Python environment
  var directmlUnavailableReason = null;
  if (!gpuInfo.available.includes('directml') && gpuInfo.pythonEnv && gpuInfo.pythonEnv.error) {
    directmlUnavailableReason = gpuInfo.pythonEnv.error;
  }

  var modes = [
    {
      id: 'cpu',
      label: 'CPU',
      desc: t('codexlens.cpuModeDesc') || 'Standard CPU processing',
      icon: 'cpu',
      available: true
    },
    {
      id: 'directml',
      label: 'DirectML',
      desc: directmlUnavailableReason
        ? directmlUnavailableReason
        : (t('codexlens.directmlModeDesc') || 'Windows GPU (NVIDIA/AMD/Intel)'),
      icon: 'cpu',
      available: gpuInfo.available.includes('directml'),
      recommended: gpuInfo.mode === 'directml',
      warning: directmlUnavailableReason
    },
    {
      id: 'cuda',
      label: 'CUDA',
      desc: t('codexlens.cudaModeDesc') || 'NVIDIA GPU (requires CUDA Toolkit)',
      icon: 'zap',
      available: gpuInfo.available.includes('cuda'),
      recommended: gpuInfo.mode === 'cuda'
    }
  ];

  var html =
    '<div class="space-y-2">' +
      '<div class="text-xs font-medium text-muted-foreground flex items-center gap-1">' +
        '<i data-lucide="settings" class="w-3 h-3"></i>' +
        (t('codexlens.selectGpuMode') || 'Select acceleration mode') +
      '</div>' +
      '<div class="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">' +
        '<i data-lucide="info" class="w-3 h-3 inline"></i> ' + gpuInfo.info +
      '</div>' +
      '<div class="space-y-1">';

  modes.forEach(function(mode) {
    var isDisabled = !mode.available;
    var isRecommended = mode.recommended;
    var isDefault = mode.id === gpuInfo.mode;
    var hasWarning = mode.warning;

    html +=
      '<label class="flex items-center gap-3 p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors ' +
        (isDisabled ? 'opacity-50 cursor-not-allowed' : '') + '">' +
        '<input type="radio" name="gpuMode" value="' + mode.id + '" ' +
          (isDefault ? 'checked' : '') +
          (isDisabled ? ' disabled' : '') +
          ' class="accent-primary">' +
        '<div class="flex-1">' +
          '<div class="flex items-center gap-2">' +
            '<i data-lucide="' + mode.icon + '" class="w-4 h-4"></i>' +
            '<span class="font-medium text-sm">' + mode.label + '</span>' +
            (isRecommended ? '<span class="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">' + (t('common.recommended') || 'Recommended') + '</span>' : '') +
            (isDisabled ? '<span class="text-xs text-muted-foreground">(' + (t('common.unavailable') || 'Unavailable') + ')</span>' : '') +
          '</div>' +
          '<div class="text-xs ' + (hasWarning ? 'text-warning' : 'text-muted-foreground') + '">' + mode.desc + '</div>' +
        '</div>' +
      '</label>';
  });

  html +=
      '</div>' +
    '</div>';

  return html;
}

/**
 * Get selected GPU mode
 */
function getSelectedGpuMode() {
  var selected = document.querySelector('input[name="gpuMode"]:checked');
  return selected ? selected.value : 'cpu';
}

/**
 * Load available GPU devices
 */
async function loadGpuDevices() {
  try {
    var response = await fetch('/api/codexlens/gpu/list');
    var result = await response.json();
    if (result.success && result.result) {
      availableGpuDevices = result.result;
      return result.result;
    }
  } catch (err) {
    console.error('GPU devices load failed:', err);
  }
  return { devices: [], selected_device_id: null };
}

/**
 * Build GPU device selector HTML
 */
function buildGpuDeviceSelector(gpuDevices) {
  if (!gpuDevices || !gpuDevices.devices || gpuDevices.devices.length === 0) {
    return '';
  }

  // Only show selector if there are multiple GPUs
  if (gpuDevices.devices.length < 2) {
    return '';
  }

  var html =
    '<div class="mt-3 p-3 bg-muted/30 rounded-lg border border-border">' +
      '<div class="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">' +
        '<i data-lucide="cpu" class="w-3 h-3"></i>' +
        (t('codexlens.selectGpuDevice') || 'Select GPU Device') +
      '</div>' +
      '<div class="space-y-1">';

  gpuDevices.devices.forEach(function(device) {
    var isSelected = device.is_selected;
    var vendorIcon = device.vendor === 'nvidia' ? 'zap' : (device.vendor === 'amd' ? 'flame' : 'cpu');
    var vendorColor = device.vendor === 'nvidia' ? 'text-green-500' : (device.vendor === 'amd' ? 'text-red-500' : 'text-blue-500');
    var typeLabel = device.is_discrete ? (t('codexlens.discrete') || 'Discrete') : (t('codexlens.integrated') || 'Integrated');

    html +=
      '<label class="flex items-center gap-3 p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors ' +
        (isSelected ? 'border-primary bg-primary/5' : 'border-transparent') + '">' +
        '<input type="radio" name="gpuDevice" value="' + device.device_id + '" ' +
          (isSelected ? 'checked' : '') +
          ' class="accent-primary" onchange="selectGpuDevice(' + device.device_id + ')">' +
        '<div class="flex-1">' +
          '<div class="flex items-center gap-2">' +
            '<i data-lucide="' + vendorIcon + '" class="w-4 h-4 ' + vendorColor + '"></i>' +
            '<span class="font-medium text-sm">' + device.name + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2 mt-0.5">' +
            '<span class="text-xs text-muted-foreground">' + device.vendor.toUpperCase() + '</span>' +
            '<span class="text-xs px-1.5 py-0.5 rounded ' +
              (device.is_discrete ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground') + '">' +
              typeLabel +
            '</span>' +
            (device.is_preferred ? '<span class="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">' + (t('common.auto') || 'Auto') + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</label>';
  });

  html +=
      '</div>' +
      '<button class="btn-xs text-muted-foreground hover:text-foreground mt-2" onclick="resetGpuDevice()">' +
        '<i data-lucide="rotate-ccw" class="w-3 h-3"></i> ' + (t('codexlens.resetToAuto') || 'Reset to Auto') +
      '</button>' +
    '</div>';

  return html;
}

/**
 * Select a GPU device
 */
async function selectGpuDevice(deviceId) {
  try {
    showRefreshToast(t('codexlens.selectingGpu') || 'Selecting GPU...', 'info');

    var response = await fetch('/api/codexlens/gpu/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId })
    });

    var result = await response.json();
    if (result.success) {
      showRefreshToast(t('codexlens.gpuSelected') || 'GPU selected', 'success');
      // Reload semantic status to reflect change
      loadSemanticDepsStatus();
    } else {
      showRefreshToast(result.error || 'Failed to select GPU', 'error');
    }
  } catch (err) {
    showRefreshToast(err.message, 'error');
  }
}

/**
 * Reset GPU device selection to auto
 */
async function resetGpuDevice() {
  try {
    showRefreshToast(t('codexlens.resettingGpu') || 'Resetting GPU selection...', 'info');

    var response = await fetch('/api/codexlens/gpu/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    var result = await response.json();
    if (result.success) {
      showRefreshToast(t('codexlens.gpuReset') || 'GPU selection reset to auto', 'success');
      // Reload semantic status to reflect change
      loadSemanticDepsStatus();
    } else {
      showRefreshToast(result.error || 'Failed to reset GPU', 'error');
    }
  } catch (err) {
    showRefreshToast(err.message, 'error');
  }
}

/**
 * Install semantic dependencies with GPU mode
 */
async function installSemanticDepsWithGpu() {
  var container = document.getElementById('semanticDepsStatus');
  if (!container) return;

  var gpuMode = getSelectedGpuMode();
  var modeLabels = {
    cpu: 'CPU',
    cuda: 'NVIDIA CUDA',
    directml: 'DirectML'
  };

  container.innerHTML =
    '<div class="space-y-2">' +
      '<div class="flex items-center gap-2 text-sm text-muted-foreground">' +
        '<div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>' +
        '<span>' + t('codexlens.installingDeps') + '</span>' +
      '</div>' +
      '<div class="text-xs text-muted-foreground">' +
        (t('codexlens.installingMode') || 'Installing with') + ': ' + modeLabels[gpuMode] +
      '</div>' +
    '</div>';

  try {
    var response = await fetch('/api/codexlens/semantic/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gpuMode: gpuMode })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.depsInstalled') + ' (' + modeLabels[gpuMode] + ')', 'success');
      await loadSemanticDepsStatus();
      await loadModelList();
    } else {
      showRefreshToast(t('codexlens.depsInstallFailed') + ': ' + result.error, 'error');
      await loadSemanticDepsStatus();
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    await loadSemanticDepsStatus();
  }
}

/**
 * Install semantic dependencies (legacy, defaults to CPU)
 */
async function installSemanticDeps() {
  await installSemanticDepsWithGpu();
}

// ============================================================
// SPLADE MANAGEMENT - Hidden (not currently used)
// ============================================================
// SPLADE functionality is hidden from the UI. The code is preserved
// for potential future use but is not exposed to users.

/*
async function loadSpladeStatus() {
  var container = document.getElementById('spladeStatus');
  if (!container) return;

  try {
    var response = await fetch('/api/codexlens/splade/status');
    var status = await response.json();

    if (status.available) {
      container.innerHTML =
        '<div class="flex items-center justify-between p-3 border border-success/30 rounded-lg bg-success/5">' +
          '<div class="flex items-center gap-3">' +
            '<i data-lucide="check-circle" class="w-5 h-5 text-success"></i>' +
            '<div>' +
              '<span class="font-medium">' + t('codexlens.spladeInstalled') + '</span>' +
              '<div class="text-xs text-muted-foreground">' + status.model + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    } else {
      container.innerHTML =
        '<div class="flex items-center justify-between p-3 border border-border rounded-lg">' +
          '<div class="flex items-center gap-3">' +
            '<i data-lucide="alert-circle" class="w-5 h-5 text-muted-foreground"></i>' +
            '<div>' +
              '<span class="font-medium">' + t('codexlens.spladeNotInstalled') + '</span>' +
              '<div class="text-xs text-muted-foreground">' + (status.error || t('codexlens.spladeInstallHint')) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="flex gap-2">' +
            '<button class="btn-sm btn-outline" onclick="installSplade(false)">' +
              '<i data-lucide="download" class="w-3.5 h-3.5 mr-1"></i>CPU' +
            '</button>' +
            '<button class="btn-sm btn-primary" onclick="installSplade(true)">' +
              '<i data-lucide="zap" class="w-3.5 h-3.5 mr-1"></i>GPU' +
            '</button>' +
          '</div>' +
        '</div>';
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML = '<div class="text-sm text-error">' + escapeHtml(err.message) + '</div>';
  }
}

async function installSplade(gpu) {
  var container = document.getElementById('spladeStatus');
  if (!container) return;

  container.innerHTML =
    '<div class="flex items-center gap-3 p-3 border border-primary/30 rounded-lg">' +
      '<div class="animate-spin"><i data-lucide="loader-2" class="w-5 h-5 text-primary"></i></div>' +
      '<span>' + t('codexlens.installingSpladePackage') + (gpu ? ' (GPU)' : ' (CPU)') + '...</span>' +
    '</div>';
  if (window.lucide) lucide.createIcons();

  try {
    var response = await fetch('/api/codexlens/splade/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gpu: gpu })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.spladeInstallSuccess'), 'success');
      loadSpladeStatus();
    } else {
      showRefreshToast(t('codexlens.spladeInstallFailed') + ': ' + result.error, 'error');
      loadSpladeStatus();
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    loadSpladeStatus();
  }
}
*/


// ============================================================
// MODEL MANAGEMENT
// ============================================================

/**
 * Build FastEmbed installation card UI with GPU mode options
 * @param {Array} gpuDevices - List of detected GPU devices
 */
function buildFastEmbedInstallCardUI(gpuDevices) {
  gpuDevices = gpuDevices || [];

  // Build GPU devices info section
  var gpuInfoHtml = '';
  if (gpuDevices.length > 0) {
    gpuInfoHtml =
      '<div class="mb-4 p-3 bg-muted/30 rounded-lg">' +
        '<div class="text-xs font-medium text-muted-foreground mb-2">' +
          '<i data-lucide="monitor" class="w-3.5 h-3.5 inline mr-1"></i>' +
          (t('codexlens.detectedGpus') || 'Detected GPUs') + ':' +
        '</div>' +
        '<div class="space-y-1">';

    gpuDevices.forEach(function(device) {
      var typeIcon = device.type === 'integrated' ? 'cpu' : 'zap';
      var typeClass = device.type === 'integrated' ? 'text-muted-foreground' : 'text-green-500';
      gpuInfoHtml +=
        '<div class="flex items-center gap-2 text-sm">' +
          '<i data-lucide="' + typeIcon + '" class="w-3.5 h-3.5 ' + typeClass + '"></i>' +
          '<span>' + escapeHtml(device.name) + '</span>' +
          '<span class="text-xs text-muted-foreground">(' + (device.type === 'integrated' ? 'Integrated' : 'Discrete') + ')</span>' +
        '</div>';
    });

    gpuInfoHtml += '</div></div>';
  }

  return '<div class="bg-card border border-warning/30 rounded-lg overflow-hidden">' +
    // Header
    '<div class="bg-warning/10 border-b border-warning/20 px-4 py-3">' +
      '<div class="flex items-center gap-2">' +
        '<i data-lucide="alert-circle" class="w-5 h-5 text-warning"></i>' +
        '<h4 class="font-semibold">' + (t('codexlens.fastembedNotInstalled') || 'FastEmbed Not Installed') + '</h4>' +
      '</div>' +
    '</div>' +
    // Content
    '<div class="p-4 space-y-4">' +
      '<p class="text-sm text-muted-foreground">' +
        (t('codexlens.fastembedDesc') || 'FastEmbed provides local embedding models for semantic search. Select your preferred acceleration mode below.') +
      '</p>' +
      // Show detected GPUs
      gpuInfoHtml +
      // GPU Mode Cards
      '<div class="space-y-2">' +
        '<div class="text-xs font-medium text-muted-foreground mb-2">' +
          (t('codexlens.selectMode') || 'Select Acceleration Mode') + ':' +
        '</div>' +
        '<div class="grid grid-cols-1 gap-2">' +
          // CPU Option Card
          '<label class="group flex items-center gap-3 p-3 border-2 border-border rounded-lg cursor-pointer transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">' +
            '<input type="radio" name="fastembedMode" value="cpu" class="sr-only" checked />' +
            '<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-muted group-has-[:checked]:bg-primary/20">' +
              '<i data-lucide="cpu" class="w-5 h-5 text-muted-foreground group-has-[:checked]:text-primary"></i>' +
            '</div>' +
            '<div class="flex-1">' +
              '<div class="font-medium">CPU</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.cpuModeDesc') || 'Standard CPU processing, works on all systems') + '</div>' +
            '</div>' +
            '<div class="w-5 h-5 rounded-full border-2 border-muted group-has-[:checked]:border-primary group-has-[:checked]:bg-primary flex items-center justify-center">' +
              '<div class="w-2 h-2 rounded-full bg-white opacity-0 group-has-[:checked]:opacity-100"></div>' +
            '</div>' +
          '</label>' +
          // DirectML Option Card
          '<label class="group flex items-center gap-3 p-3 border-2 border-border rounded-lg cursor-pointer transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">' +
            '<input type="radio" name="fastembedMode" value="directml" class="sr-only" />' +
            '<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-muted group-has-[:checked]:bg-primary/20">' +
              '<i data-lucide="monitor" class="w-5 h-5 text-muted-foreground group-has-[:checked]:text-primary"></i>' +
            '</div>' +
            '<div class="flex-1">' +
              '<div class="font-medium">DirectML</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.directmlModeDesc') || 'Windows GPU acceleration (NVIDIA/AMD/Intel)') + '</div>' +
            '</div>' +
            '<div class="w-5 h-5 rounded-full border-2 border-muted group-has-[:checked]:border-primary group-has-[:checked]:bg-primary flex items-center justify-center">' +
              '<div class="w-2 h-2 rounded-full bg-white opacity-0 group-has-[:checked]:opacity-100"></div>' +
            '</div>' +
          '</label>' +
          // CUDA Option Card
          '<label class="group flex items-center gap-3 p-3 border-2 border-border rounded-lg cursor-pointer transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">' +
            '<input type="radio" name="fastembedMode" value="cuda" class="sr-only" />' +
            '<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-muted group-has-[:checked]:bg-primary/20">' +
              '<i data-lucide="zap" class="w-5 h-5 text-muted-foreground group-has-[:checked]:text-primary"></i>' +
            '</div>' +
            '<div class="flex-1">' +
              '<div class="font-medium">CUDA</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.cudaModeDesc') || 'NVIDIA GPU acceleration (requires CUDA Toolkit)') + '</div>' +
            '</div>' +
            '<div class="w-5 h-5 rounded-full border-2 border-muted group-has-[:checked]:border-primary group-has-[:checked]:bg-primary flex items-center justify-center">' +
              '<div class="w-2 h-2 rounded-full bg-white opacity-0 group-has-[:checked]:opacity-100"></div>' +
            '</div>' +
          '</label>' +
        '</div>' +
      '</div>' +
      // Install Button
      '<button class="btn btn-primary w-full" onclick="installFastEmbed()">' +
        '<i data-lucide="download" class="w-4 h-4 mr-2"></i> ' +
        (t('codexlens.installFastembed') || 'Install FastEmbed') +
      '</button>' +
    '</div>' +
  '</div>';
}

/**
 * Build FastEmbed status card UI (when installed)
 * @param {Object} status - Semantic status object
 * @param {Array} gpuDevices - List of detected GPU devices
 * @param {Object} litellmStatus - LiteLLM installation status from API settings endpoint
 */
function buildFastEmbedStatusCardUI(status, gpuDevices, litellmStatus) {
  gpuDevices = gpuDevices || [];
  litellmStatus = litellmStatus || {};

  // Determine accelerator info
  var accelerator = status.accelerator || 'CPU';
  var acceleratorIcon = accelerator === 'CPU' ? 'cpu' :
                        accelerator.includes('CUDA') ? 'zap' : 'monitor';
  var acceleratorClass = accelerator === 'CPU' ? 'text-muted-foreground' : 'text-green-500';
  var acceleratorBgClass = accelerator === 'CPU' ? 'bg-muted/50' :
                           accelerator.includes('CUDA') ? 'bg-green-500/20' : 'bg-blue-500/20';

  // Check if LiteLLM (ccw-litellm) is installed - use the same check as API Settings
  var isLitellmInstalled = litellmStatus.installed === true;

  // Build GPU devices section with active indicator
  var gpuInfoHtml = '';
  if (gpuDevices.length > 0) {
    gpuInfoHtml =
      '<div class="mb-3">' +
        '<div class="text-xs font-medium text-muted-foreground mb-2">' +
          '<i data-lucide="monitor" class="w-3 h-3 inline mr-1"></i>' +
          (t('codexlens.detectedGpus') || 'Detected GPUs') +
        '</div>' +
        '<div class="space-y-1.5">';

    gpuDevices.forEach(function(device, index) {
      var isActive = false;
      // Determine if this GPU matches the active accelerator
      if (accelerator === 'CUDA' && device.type === 'discrete' && device.name.toLowerCase().includes('nvidia')) {
        isActive = true;
      } else if (accelerator === 'DirectML' && device.type === 'discrete') {
        isActive = true;
      } else if (accelerator === 'CPU' && device.type === 'integrated') {
        isActive = index === 0; // First integrated GPU is likely active
      }

      var typeIcon = device.type === 'integrated' ? 'cpu' : 'zap';
      var activeClass = isActive ? 'border-green-500 bg-green-500/10' : 'border-border bg-muted/30';
      var activeBadge = isActive ?
        '<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 font-medium">' +
          (t('codexlens.active') || 'Active') +
        '</span>' : '';

      gpuInfoHtml +=
        '<div class="flex items-center justify-between p-2 rounded border ' + activeClass + '">' +
          '<div class="flex items-center gap-2">' +
            '<i data-lucide="' + typeIcon + '" class="w-3.5 h-3.5 ' + (isActive ? 'text-green-500' : 'text-muted-foreground') + '"></i>' +
            '<div>' +
              '<div class="text-xs font-medium">' + escapeHtml(device.name) + '</div>' +
              '<div class="text-[10px] text-muted-foreground">' + (device.type === 'integrated' ? 'Integrated' : 'Discrete') + '</div>' +
            '</div>' +
          '</div>' +
          activeBadge +
        '</div>';
    });

    gpuInfoHtml += '</div></div>';
  }

  // Active accelerator section
  var activeAcceleratorHtml =
    '<div class="p-3 rounded-lg ' + acceleratorBgClass + ' mb-3">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-2">' +
          '<i data-lucide="' + acceleratorIcon + '" class="w-5 h-5 ' + acceleratorClass + '"></i>' +
          '<div>' +
            '<div class="text-xs text-muted-foreground">' + (t('codexlens.activeAccelerator') || 'Active Accelerator') + '</div>' +
            '<div class="font-semibold">' + accelerator + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="text-right text-xs">' +
          '<div class="text-muted-foreground">Backend</div>' +
          '<div class="font-medium">' + (status.backend || 'fastembed') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  return '<div class="bg-card border border-green-500/30 rounded-lg overflow-hidden">' +
    // Header
    '<div class="bg-green-500/10 border-b border-green-500/20 px-4 py-2">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-2">' +
          '<i data-lucide="check-circle" class="w-4 h-4 text-green-500"></i>' +
          '<h4 class="font-medium text-sm">' + (t('codexlens.fastembedInstalled') || 'FastEmbed Installed') + '</h4>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          // LiteLLM status badge
          (isLitellmInstalled ?
            '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-600" title="LiteLLM API Available">' +
              '<i data-lucide="cloud" class="w-2.5 h-2.5 inline"></i> LiteLLM' +
            '</span>' : '') +
          '<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-600">' +
            '<i data-lucide="' + acceleratorIcon + '" class="w-3 h-3 inline mr-1"></i>' +
            accelerator +
          '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    // Content
    '<div class="p-3 space-y-3">' +
      // Active accelerator section
      activeAcceleratorHtml +
      // GPU devices
      gpuInfoHtml +
      // Reinstall option (collapsed by default)
      '<details class="text-xs">' +
        '<summary class="cursor-pointer text-muted-foreground hover:text-foreground">' +
          '<i data-lucide="settings" class="w-3 h-3 inline mr-1"></i>' +
          (t('codexlens.reinstallOptions') || 'Reinstall Options') +
        '</summary>' +
        '<div class="mt-2 p-2 bg-muted/30 rounded space-y-2">' +
          '<p class="text-muted-foreground">' + (t('codexlens.reinstallDesc') || 'Reinstall with a different GPU mode:') + '</p>' +
          '<div class="flex gap-2">' +
            '<button class="btn-xs ' + (accelerator === 'CPU' ? 'btn-primary' : 'btn-outline') + '" onclick="reinstallFastEmbed(\'cpu\')" ' + (accelerator === 'CPU' ? 'disabled' : '') + '>' +
              '<i data-lucide="cpu" class="w-3 h-3 mr-1"></i>CPU' +
            '</button>' +
            '<button class="btn-xs ' + (accelerator === 'DirectML' ? 'btn-primary' : 'btn-outline') + '" onclick="reinstallFastEmbed(\'directml\')" ' + (accelerator === 'DirectML' ? 'disabled' : '') + '>' +
              '<i data-lucide="monitor" class="w-3 h-3 mr-1"></i>DirectML' +
            '</button>' +
            '<button class="btn-xs ' + (accelerator === 'CUDA' ? 'btn-primary' : 'btn-outline') + '" onclick="reinstallFastEmbed(\'cuda\')" ' + (accelerator === 'CUDA' ? 'disabled' : '') + '>' +
              '<i data-lucide="zap" class="w-3 h-3 mr-1"></i>CUDA' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</details>' +
    '</div>' +
  '</div>';
}

/**
 * Reinstall FastEmbed with specified GPU mode
 * @param {string} mode - GPU mode: cpu, directml, cuda
 */
async function reinstallFastEmbed(mode) {
  if (!confirm((t('codexlens.confirmReinstall') || 'This will reinstall FastEmbed with ' + mode + ' mode. Continue?'))) {
    return;
  }

  var card = document.getElementById('fastembedInstallCard');
  if (!card) return;

  var modeLabels = {
    cpu: 'CPU',
    cuda: 'NVIDIA CUDA',
    directml: 'DirectML'
  };

  // Show reinstalling state
  card.innerHTML =
    '<div class="bg-card border border-primary/30 rounded-lg overflow-hidden">' +
      '<div class="bg-primary/10 border-b border-primary/20 px-4 py-2">' +
        '<div class="flex items-center gap-2">' +
          '<div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>' +
          '<h4 class="font-medium text-sm">' + (t('codexlens.reinstallingFastembed') || 'Reinstalling FastEmbed...') + '</h4>' +
        '</div>' +
      '</div>' +
      '<div class="p-3 text-xs text-muted-foreground">' +
        (t('codexlens.installingMode') || 'Installing with') + ': ' + modeLabels[mode] +
      '</div>' +
    '</div>';

  try {
    var response = await fetch('/api/codexlens/semantic/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gpuMode: mode })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast((t('codexlens.fastembedReinstalled') || 'FastEmbed reinstalled') + ' (' + modeLabels[mode] + ')', 'success');
      // Reload status
      loadFastEmbedInstallStatus();
    } else {
      showRefreshToast((t('codexlens.fastembedInstallFailed') || 'FastEmbed reinstall failed') + ': ' + result.error, 'error');
      loadFastEmbedInstallStatus();
    }
  } catch (err) {
    showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
    loadFastEmbedInstallStatus();
  }
}

/**
 * Load FastEmbed installation status and show card
 * Card is always visible - shows install UI or status UI based on state
 */
async function loadFastEmbedInstallStatus() {
  console.log('[CodexLens] loadFastEmbedInstallStatus called');
  var card = document.getElementById('fastembedInstallCard');
  console.log('[CodexLens] fastembedInstallCard element:', card);
  if (!card) {
    console.warn('[CodexLens] fastembedInstallCard element not found!');
    return;
  }

  try {
    // Load semantic status, GPU list, and LiteLLM status in parallel
    console.log('[CodexLens] Fetching semantic status, GPU list, and LiteLLM status...');
    var [semanticResponse, gpuResponse, litellmResponse] = await Promise.all([
      fetch('/api/codexlens/semantic/status'),
      fetch('/api/codexlens/gpu/list'),
      fetch('/api/litellm-api/ccw-litellm/status').catch(function() { return { ok: false }; })
    ]);

    var result = await semanticResponse.json();
    var gpuResult = await gpuResponse.json();
    var gpuDevices = gpuResult.devices || [];

    // Get LiteLLM status (same endpoint as API Settings page)
    var litellmStatus = {};
    if (litellmResponse.ok) {
      try {
        litellmStatus = await litellmResponse.json();
      } catch (e) {
        console.warn('[CodexLens] Failed to parse LiteLLM status:', e);
      }
    }

    console.log('[CodexLens] Semantic status:', result);
    console.log('[CodexLens] GPU devices:', gpuDevices);
    console.log('[CodexLens] LiteLLM status:', litellmStatus);

    if (result.available) {
      // FastEmbed is installed - show status card
      console.log('[CodexLens] FastEmbed available, showing status card');
      card.innerHTML = buildFastEmbedStatusCardUI(result, gpuDevices, litellmStatus);
      card.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    } else {
      // FastEmbed not installed - show install card with GPU devices
      console.log('[CodexLens] FastEmbed NOT available, showing install card');
      card.innerHTML = buildFastEmbedInstallCardUI(gpuDevices);
      card.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    // On error, show install card without GPU info
    console.error('[CodexLens] Error loading FastEmbed status:', err);
    card.innerHTML = buildFastEmbedInstallCardUI([]);
    card.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Install FastEmbed with selected GPU mode
 */
async function installFastEmbed() {
  var card = document.getElementById('fastembedInstallCard');
  if (!card) return;

  // Get selected GPU mode
  var selectedMode = 'cpu';
  var radios = document.querySelectorAll('input[name="fastembedMode"]');
  radios.forEach(function(radio) {
    if (radio.checked) {
      selectedMode = radio.value;
    }
  });

  var modeLabels = {
    cpu: 'CPU',
    cuda: 'NVIDIA CUDA',
    directml: 'DirectML'
  };

  // Show installing state in card
  card.innerHTML =
    '<div class="bg-card border border-primary/30 rounded-lg overflow-hidden">' +
      '<div class="bg-primary/10 border-b border-primary/20 px-4 py-3">' +
        '<div class="flex items-center gap-2">' +
          '<div class="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>' +
          '<h4 class="font-semibold">' + (t('codexlens.installingFastembed') || 'Installing FastEmbed...') + '</h4>' +
        '</div>' +
      '</div>' +
      '<div class="p-4 space-y-2">' +
        '<div class="text-sm">' +
          (t('codexlens.installingMode') || 'Installing with') + ': <span class="font-medium">' + modeLabels[selectedMode] + '</span>' +
        '</div>' +
        '<div class="text-xs text-muted-foreground">' +
          (t('codexlens.installMayTakeTime') || 'This may take several minutes. Please do not close this page.') +
        '</div>' +
        '<div class="w-full bg-muted rounded-full h-1.5 mt-3">' +
          '<div class="bg-primary h-1.5 rounded-full animate-pulse" style="width: 30%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  try {
    var response = await fetch('/api/codexlens/semantic/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gpuMode: selectedMode })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast((t('codexlens.fastembedInstalled') || 'FastEmbed installed') + ' (' + modeLabels[selectedMode] + ')', 'success');
      // Hide card and reload status
      await loadFastEmbedInstallStatus();
      await loadSemanticDepsStatus();
      await loadModelList();
    } else {
      showRefreshToast((t('codexlens.fastembedInstallFailed') || 'FastEmbed installation failed') + ': ' + result.error, 'error');
      await loadFastEmbedInstallStatus();
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    await loadFastEmbedInstallStatus();
  }
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(function() {
    showRefreshToast(t('common.copied') || 'Copied to clipboard', 'success');
  }).catch(function(err) {
    console.error('Failed to copy:', err);
  });
}

/**
 * Load model list (simplified version)
 */
async function loadModelList() {
  var container = document.getElementById('modelListContainer');
  if (!container) return;

  try {
    // Get config for backend info
    var configResponse = await fetch('/api/codexlens/config');
    var config = await configResponse.json();
    var embeddingBackend = config.embedding_backend || 'fastembed';

    var response = await fetch('/api/codexlens/models');
    var result = await response.json();

    var html = '<div class="space-y-2">';

    // Show current backend status
    var backendLabel = embeddingBackend === 'litellm' ? 'API (LiteLLM)' : 'Local (FastEmbed)';
    var backendIcon = embeddingBackend === 'litellm' ? 'cloud' : 'hard-drive';
    html +=
      '<div class="flex items-center justify-between p-2 bg-primary/5 rounded border border-primary/20 mb-3">' +
        '<div class="flex items-center gap-2">' +
          '<i data-lucide="' + backendIcon + '" class="w-3.5 h-3.5 text-primary"></i>' +
          '<span class="text-xs font-medium">' + backendLabel + '</span>' +
        '</div>' +
        '<span class="text-xs text-muted-foreground">via Environment Variables</span>' +
      '</div>';

    if (!result.success) {
      var errorMsg = result.error || '';
      if (errorMsg.includes('fastembed not installed') || errorMsg.includes('Semantic')) {
        // Just show a simple message - installation UI is in the separate card above
        html += '<div class="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/30 rounded">' +
          '<i data-lucide="info" class="w-4 h-4"></i>' +
          '<span>' + (t('codexlens.installFastembedFirst') || 'Install FastEmbed above to manage local embedding models') + '</span>' +
        '</div>';
      } else {
        html += '<div class="text-sm text-error">' + escapeHtml(errorMsg || t('common.unknownError')) + '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (!result.result || !result.result.models) {
      html += '<div class="text-sm text-muted-foreground">' + t('codexlens.noModelsAvailable') + '</div>';
      html += '</div>';
      container.innerHTML = html;
      if (window.lucide) lucide.createIcons();
      return;
    }

    // Show models for local backend
    if (embeddingBackend !== 'litellm') {
      var models = result.result.models;
      models.forEach(function(model) {
        var statusIcon = model.installed
          ? '<i data-lucide="check-circle" class="w-3.5 h-3.5 text-success"></i>'
          : '<i data-lucide="circle" class="w-3.5 h-3.5 text-muted"></i>';

        var sizeText = model.installed
          ? model.actual_size_mb.toFixed(0) + ' MB'
          : '~' + model.estimated_size_mb + ' MB';

        var actionBtn = model.installed
          ? '<button class="text-xs text-destructive hover:underline" onclick="deleteModel(\'' + model.profile + '\')">Delete</button>'
          : '<button class="text-xs text-primary hover:underline" onclick="downloadModel(\'' + model.profile + '\')">Download</button>';

        html +=
          '<div class="flex items-center justify-between p-2 bg-muted/30 rounded" id="model-' + model.profile + '">' +
            '<div class="flex items-center gap-2">' +
              statusIcon +
              '<span class="text-sm font-medium">' + model.profile + '</span>' +
              '<button class="text-muted-foreground hover:text-foreground p-0.5" onclick="copyToClipboard(\'' + escapeHtml(model.model_name) + '\')" title="' + escapeHtml(model.model_name) + '">' +
                '<i data-lucide="copy" class="w-3 h-3"></i>' +
              '</button>' +
              '<span class="text-xs text-muted-foreground">' + model.dimensions + 'd</span>' +
            '</div>' +
            '<div class="flex items-center gap-3">' +
              '<span class="text-xs text-muted-foreground">' + sizeText + '</span>' +
              actionBtn +
            '</div>' +
          '</div>';
      });
    } else {
      // LiteLLM backend - show API info
      html +=
        '<div class="p-3 bg-muted/30 rounded text-center">' +
          '<i data-lucide="cloud" class="w-6 h-6 text-primary mx-auto mb-2"></i>' +
          '<div class="text-sm">Using API embeddings</div>' +
          '<div class="text-xs text-muted-foreground mt-1">Model configured via CODEXLENS_EMBEDDING_MODEL</div>' +
        '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML =
      '<div class="text-sm text-error">' + escapeHtml(err.message) + '</div>';
  }
}

/**
 * Download model (simplified version)
 */
async function downloadModel(profile) {
  var modelCard = document.getElementById('model-' + profile);
  if (!modelCard) return;

  var originalHTML = modelCard.innerHTML;

  // Show loading state
  modelCard.innerHTML =
    '<div class="flex items-center justify-between p-2 bg-muted/30 rounded">' +
      '<div class="flex items-center gap-2">' +
        '<div class="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full"></div>' +
        '<span class="text-sm">Downloading ' + profile + '...</span>' +
      '</div>' +
      '<button class="text-xs text-muted-foreground hover:underline" onclick="loadModelList()">Cancel</button>' +
    '</div>';

  try {
    var response = await fetch('/api/codexlens/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profile })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast('Model downloaded: ' + profile, 'success');
      loadModelList();
    } else {
      showRefreshToast('Download failed: ' + result.error, 'error');
      modelCard.innerHTML = originalHTML;
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
    modelCard.innerHTML = originalHTML;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Delete model (simplified)
 */
async function deleteModel(profile) {
  if (!confirm('Delete model ' + profile + '?')) {
    return;
  }

  var modelCard = document.getElementById('model-' + profile);
  if (!modelCard) return;

  var originalHTML = modelCard.innerHTML;
  modelCard.innerHTML =
    '<div class="flex items-center justify-between p-2 bg-muted/30 rounded">' +
      '<div class="flex items-center gap-2">' +
        '<div class="animate-spin w-3.5 h-3.5 border-2 border-destructive border-t-transparent rounded-full"></div>' +
        '<span class="text-sm">Deleting...</span>' +
      '</div>' +
    '</div>';

  try {
    var response = await fetch('/api/codexlens/models/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profile })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast('Model deleted: ' + profile, 'success');
      loadModelList();
    } else {
      showRefreshToast('Delete failed: ' + result.error, 'error');
      modelCard.innerHTML = originalHTML;
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
    modelCard.innerHTML = originalHTML;
    if (window.lucide) lucide.createIcons();
  }
}

// ============================================================
// RERANKER MODEL MANAGEMENT
// ============================================================

// Available reranker models (fastembed TextCrossEncoder) - fallback if API unavailable
var RERANKER_MODELS = [
  { id: 'ms-marco-mini', name: 'Xenova/ms-marco-MiniLM-L-6-v2', size: 90, desc: 'Fast, lightweight', recommended: true },
  { id: 'ms-marco-12', name: 'Xenova/ms-marco-MiniLM-L-12-v2', size: 130, desc: 'Better accuracy', recommended: true },
  { id: 'bge-base', name: 'BAAI/bge-reranker-base', size: 280, desc: 'High quality', recommended: true },
  { id: 'bge-large', name: 'BAAI/bge-reranker-large', size: 560, desc: 'Maximum quality', recommended: false },
  { id: 'jina-tiny', name: 'jinaai/jina-reranker-v1-tiny-en', size: 70, desc: 'Tiny, fast', recommended: true },
  { id: 'jina-turbo', name: 'jinaai/jina-reranker-v1-turbo-en', size: 150, desc: 'Balanced', recommended: true }
];

/**
 * Load reranker model list with download/delete support
 */
async function loadRerankerModelList() {
  // Update both containers (advanced tab and page model management)
  var containers = [
    document.getElementById('rerankerModelListContainer'),
    document.getElementById('pageRerankerModelListContainer')
  ].filter(Boolean);

  console.log('[CodexLens] loadRerankerModelList - containers found:', containers.length);

  if (containers.length === 0) {
    console.warn('[CodexLens] No reranker model list containers found');
    return;
  }

  try {
    // Fetch both config and models list in parallel
    var [configResponse, modelsResponse] = await Promise.all([
      fetch('/api/codexlens/reranker/config'),
      fetch('/api/codexlens/reranker/models')
    ]);

    if (!configResponse.ok) {
      throw new Error('Failed to load reranker config: ' + configResponse.status);
    }
    var config = await configResponse.json();
    console.log('[CodexLens] Reranker config loaded:', { backend: config.backend, model: config.model_name });

    // Handle API response format
    var currentModel = config.model_name || config.result?.reranker_model || 'Xenova/ms-marco-MiniLM-L-6-v2';
    var currentBackend = config.backend || config.result?.reranker_backend || 'fastembed';

    // Try to use API models, fall back to static list
    var models = RERANKER_MODELS;
    var modelsFromApi = false;
    if (modelsResponse.ok) {
      var modelsData = await modelsResponse.json();
      if (modelsData.success && modelsData.result && modelsData.result.models) {
        models = modelsData.result.models.map(function(m) {
          return {
            id: m.profile,
            name: m.model_name,
            size: m.installed && m.actual_size_mb ? m.actual_size_mb : m.estimated_size_mb,
            desc: m.description,
            installed: m.installed,
            recommended: m.recommended
          };
        });
        modelsFromApi = true;
        console.log('[CodexLens] Loaded ' + models.length + ' reranker models from API');
      }
    }

    var html = '<div class="space-y-2">';

    // Show current backend status
    var isApiBackend = currentBackend === 'litellm' || currentBackend === 'api';
    var backendLabel = isApiBackend ? 'API (' + (currentBackend === 'litellm' ? 'LiteLLM' : 'Remote') + ')' : 'Local (FastEmbed)';
    var backendIcon = isApiBackend ? 'cloud' : 'hard-drive';
    html +=
      '<div class="flex items-center justify-between p-2 bg-primary/5 rounded border border-primary/20 mb-3">' +
        '<div class="flex items-center gap-2">' +
          '<i data-lucide="' + backendIcon + '" class="w-3.5 h-3.5 text-primary"></i>' +
          '<span class="text-xs font-medium">' + backendLabel + '</span>' +
        '</div>' +
        '<span class="text-xs text-muted-foreground">via Environment Variables</span>' +
      '</div>';

    // Helper to match model names (handles different prefixes like Xenova/ vs cross-encoder/)
    function modelMatches(current, target) {
      if (!current || !target) return false;
      // Exact match
      if (current === target) return true;
      // Match by base name (after last /)
      var currentBase = current.split('/').pop();
      var targetBase = target.split('/').pop();
      return currentBase === targetBase;
    }

    // Show API info when using API backend
    if (isApiBackend) {
      html +=
        '<div class="p-3 bg-blue-500/10 rounded border border-blue-500/20 mb-3">' +
          '<div class="flex items-center gap-2 mb-2">' +
            '<i data-lucide="cloud" class="w-4 h-4 text-blue-500"></i>' +
            '<span class="text-sm font-medium">' + t('codexlens.usingApiReranker') + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs text-muted-foreground">' + t('codexlens.currentModel') + ':</span>' +
            '<span class="text-xs font-mono bg-background px-2 py-0.5 rounded border border-border">' +
              escapeHtml(currentModel) +
            '</span>' +
          '</div>' +
        '</div>';
    }

    // Local models section title
    html +=
      '<div class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">' +
        '<i data-lucide="hard-drive" class="w-3.5 h-3.5"></i>' +
        t('codexlens.localModels') +
      '</div>';

    models.forEach(function(model) {
      var isActive = !isApiBackend && modelMatches(currentModel, model.name);
      var isInstalled = model.installed;

      // Status icon
      var statusIcon;
      if (isActive) {
        statusIcon = '<i data-lucide="check-circle" class="w-3.5 h-3.5 text-success"></i>';
      } else if (isInstalled) {
        statusIcon = '<i data-lucide="check" class="w-3.5 h-3.5 text-primary"></i>';
      } else {
        statusIcon = '<i data-lucide="circle" class="w-3.5 h-3.5 text-muted"></i>';
      }

      // Action buttons
      var actionBtns = '';
      if (isActive) {
        actionBtns = '<span class="text-xs text-success">' + t('codexlens.active') + '</span>';
        if (isInstalled) {
          actionBtns += '<button class="text-xs text-destructive hover:underline ml-2" onclick="deleteRerankerModel(\'' + model.id + '\')">' + t('codexlens.deleteModel') + '</button>';
        }
      } else if (isInstalled) {
        // Installed but not active - can select or delete
        if (isApiBackend) {
          actionBtns = '<button class="text-xs text-primary hover:underline" onclick="switchToLocalReranker(\'' + model.name + '\')">' + t('codexlens.useLocal') + '</button>';
        } else {
          actionBtns = '<button class="text-xs text-primary hover:underline" onclick="selectRerankerModel(\'' + model.name + '\')">' + t('codexlens.select') + '</button>';
        }
        actionBtns += '<button class="text-xs text-destructive hover:underline ml-2" onclick="deleteRerankerModel(\'' + model.id + '\')">' + t('codexlens.deleteModel') + '</button>';
      } else {
        // Not installed - show download button
        actionBtns = '<button class="text-xs text-primary hover:underline" onclick="downloadRerankerModel(\'' + model.id + '\')">' + t('codexlens.downloadModel') + '</button>';
      }

      // Size display
      var sizeText = (isInstalled && model.size) ? model.size + ' MB' : '~' + model.size + ' MB';

      // Recommendation badge
      var recBadge = model.recommended ? ' <span class="text-xs text-yellow-500">★</span>' : '';

      html +=
        '<div class="flex items-center justify-between p-2 bg-muted/30 rounded" id="reranker-' + model.id + '">' +
          '<div class="flex items-center gap-2">' +
            statusIcon +
            '<span class="text-sm font-medium">' + model.id + recBadge + '</span>' +
            '<button class="text-muted-foreground hover:text-foreground p-0.5" onclick="copyToClipboard(\'' + escapeHtml(model.name) + '\')" title="' + escapeHtml(model.name) + '">' +
              '<i data-lucide="copy" class="w-3 h-3"></i>' +
            '</button>' +
            '<span class="text-xs text-muted-foreground">' + model.desc + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-3">' +
            '<span class="text-xs text-muted-foreground">' + sizeText + '</span>' +
            actionBtns +
          '</div>' +
        '</div>';
    });

    html += '</div>';
    // Update all containers
    containers.forEach(function(container) {
      container.innerHTML = html;
    });
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    var errorHtml = '<div class="text-sm text-error">' + escapeHtml(err.message) + '</div>';
    containers.forEach(function(container) {
      container.innerHTML = errorHtml;
    });
  }
}

/**
 * Download reranker model
 */
async function downloadRerankerModel(profile) {
  var container = document.getElementById('reranker-' + profile);
  if (container) {
    container.innerHTML =
      '<div class="flex items-center gap-2 p-2">' +
        '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>' +
        '<span class="text-sm">' + t('codexlens.downloading') + '</span>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    var response = await fetch('/api/codexlens/reranker/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profile })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.downloadComplete') + ': ' + profile, 'success');
      loadRerankerModelList();
    } else {
      showRefreshToast(t('codexlens.downloadFailed') + ': ' + (result.error || 'Unknown error'), 'error');
      loadRerankerModelList();
    }
  } catch (err) {
    showRefreshToast(t('codexlens.downloadFailed') + ': ' + err.message, 'error');
    loadRerankerModelList();
  }
}

/**
 * Delete reranker model
 */
async function deleteRerankerModel(profile) {
  if (!confirm(t('codexlens.deleteModelConfirm') + ' ' + profile + '?')) {
    return;
  }

  try {
    var response = await fetch('/api/codexlens/reranker/models/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profile })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.modelDeleted') + ': ' + profile, 'success');
      loadRerankerModelList();
    } else {
      showRefreshToast('Failed to delete: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
  }
}

/**
 * Update reranker backend
 */
async function updateRerankerBackend(backend) {
  try {
    var response = await fetch('/api/codexlens/reranker/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: backend })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast('Reranker backend updated: ' + backend, 'success');
      loadRerankerModelList();
    } else {
      showRefreshToast('Failed to update: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
  }
}

/**
 * Select reranker model
 */
async function selectRerankerModel(modelName) {
  try {
    var response = await fetch('/api/codexlens/reranker/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: modelName })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast('Reranker model selected: ' + modelName.split('/').pop(), 'success');
      loadRerankerModelList();
    } else {
      showRefreshToast('Failed to select: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
  }
}

/**
 * Switch from API to local reranker backend and select model
 */
async function switchToLocalReranker(modelName) {
  try {
    // First switch backend to fastembed
    var backendResponse = await fetch('/api/codexlens/reranker/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'fastembed' })
    });
    var backendResult = await backendResponse.json();

    if (!backendResult.success) {
      showRefreshToast('Failed to switch backend: ' + (backendResult.error || 'Unknown error'), 'error');
      return;
    }

    // Then select the model
    var modelResponse = await fetch('/api/codexlens/reranker/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: modelName })
    });
    var modelResult = await modelResponse.json();

    if (modelResult.success) {
      showRefreshToast(t('codexlens.switchedToLocal') + ': ' + modelName.split('/').pop(), 'success');
      loadRerankerModelList();
      // Also reload env variables to reflect the change
      if (typeof loadEnvVariables === 'function') {
        loadEnvVariables();
      }
    } else {
      showRefreshToast('Failed to select model: ' + (modelResult.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast('Error: ' + err.message, 'error');
  }
}

// ============================================================
// MODEL TAB & MODE MANAGEMENT
// ============================================================

/**
 * Switch between Embedding and Reranker tabs in CodexLens manager
 */
function switchCodexLensModelTab(tabName) {
  console.log('[CodexLens] Switching to tab:', tabName);

  // Update tab buttons using direct style manipulation for reliability
  var tabs = document.querySelectorAll('.model-tab');
  tabs.forEach(function(tab) {
    var isActive = tab.getAttribute('data-tab') === tabName;
    if (isActive) {
      tab.className = 'model-tab flex-1 px-4 py-2.5 text-sm font-medium border-b-2 border-primary text-primary';
      tab.style.backgroundColor = 'rgba(var(--primary), 0.05)';
    } else {
      tab.className = 'model-tab flex-1 px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground';
      tab.style.backgroundColor = '';
    }
  });

  // Update tab content
  var embeddingContent = document.getElementById('embeddingTabContent');
  var rerankerContent = document.getElementById('rerankerTabContent');

  if (embeddingContent && rerankerContent) {
    if (tabName === 'embedding') {
      embeddingContent.classList.remove('hidden');
      embeddingContent.style.display = 'block';
      rerankerContent.classList.add('hidden');
      rerankerContent.style.display = 'none';
      // Reload embedding models when switching to embedding tab
      loadModelList();
    } else {
      embeddingContent.classList.add('hidden');
      embeddingContent.style.display = 'none';
      rerankerContent.classList.remove('hidden');
      rerankerContent.style.display = 'block';
      // Load reranker models when switching to reranker tab
      loadRerankerModelList();
    }
  }
}

/**
 * Update model mode (Local vs API)
 */
function updateModelMode(mode) {
  var modeSelect = document.getElementById('modelModeSelect');

  // Store mode preference (will be saved when locked)
  if (modeSelect) {
    modeSelect.setAttribute('data-current-mode', mode);
  }
}

/**
 * Load GPU devices for mode selector
 */
async function loadGpuDevicesForModeSelector() {
  var gpuSelect = document.getElementById('gpuDeviceSelect');
  var gpuSection = document.getElementById('gpuConfigSection');
  if (!gpuSelect) return;

  try {
    var response = await fetch('/api/codexlens/gpu/list');
    if (!response.ok) {
      console.warn('[CodexLens] GPU list endpoint returned:', response.status);
      gpuSelect.innerHTML = '<option value="auto">Auto</option>';
      // Hide section if no GPU devices available
      if (gpuSection) gpuSection.classList.add('hidden');
      return;
    }
    var result = await response.json();

    var html = '<option value="auto">Auto</option>';
    if (result.devices && result.devices.length > 1) {
      // Only show section if multiple GPUs available
      result.devices.forEach(function(device, index) {
        html += '<option value="' + index + '">' + escapeHtml(device.name) + '</option>';
      });
      gpuSelect.innerHTML = html;
      if (gpuSection) gpuSection.classList.remove('hidden');
    } else {
      // Single or no GPU - hide section
      gpuSelect.innerHTML = html;
      if (gpuSection) gpuSection.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load GPU devices:', err);
    if (gpuSection) gpuSection.classList.add('hidden');
  }
}

/**
 * Toggle model mode lock (save configuration)
 */
async function toggleModelModeLock() {
  var lockBtn = document.getElementById('modelModeLockBtn');
  var modeSelect = document.getElementById('modelModeSelect');
  var gpuSelect = document.getElementById('gpuDeviceSelect');

  if (!lockBtn || !modeSelect) return;

  var isLocked = lockBtn.getAttribute('data-locked') === 'true';

  if (isLocked) {
    // Unlock - enable editing
    lockBtn.setAttribute('data-locked', 'false');
    lockBtn.innerHTML = '<i data-lucide="unlock" class="w-3.5 h-3.5"></i><span class="text-xs">Lock</span>';
    lockBtn.classList.remove('btn-primary');
    lockBtn.classList.add('btn-outline');
    modeSelect.disabled = false;
    if (gpuSelect) gpuSelect.disabled = false;
    if (window.lucide) lucide.createIcons();
  } else {
    // Lock - save configuration
    var mode = modeSelect.value;
    var gpuDevice = gpuSelect ? gpuSelect.value : 'auto';

    try {
      // Save embedding backend preference
      var embeddingBackend = mode === 'local' ? 'fastembed' : 'litellm';
      await fetch('/api/codexlens/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedding_backend: embeddingBackend,
          gpu_device: gpuDevice
        })
      });

      // Save reranker backend preference
      var rerankerBackend = mode === 'local' ? 'fastembed' : 'litellm';
      await fetch('/api/codexlens/reranker/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: rerankerBackend })
      });

      // Update UI to locked state
      lockBtn.setAttribute('data-locked', 'true');
      lockBtn.innerHTML = '<i data-lucide="lock" class="w-3.5 h-3.5"></i><span class="text-xs">Locked</span>';
      lockBtn.classList.remove('btn-outline');
      lockBtn.classList.add('btn-primary');
      modeSelect.disabled = true;
      if (gpuSelect) gpuSelect.disabled = true;
      if (window.lucide) lucide.createIcons();

      showRefreshToast('Configuration saved: ' + (mode === 'local' ? 'Local (FastEmbed)' : 'API (LiteLLM)'), 'success');

      // Refresh model lists to reflect new backend
      loadModelList();
      loadRerankerModelList();
    } catch (err) {
      showRefreshToast('Failed to save configuration: ' + err.message, 'error');
    }
  }
}

/**
 * Initialize model mode from saved config
 */
async function initModelModeFromConfig() {
  var modeSelect = document.getElementById('modelModeSelect');

  if (!modeSelect) return;

  try {
    var response = await fetch('/api/codexlens/config');
    var config = await response.json();

    var embeddingBackend = config.embedding_backend || 'fastembed';
    var mode = embeddingBackend === 'litellm' ? 'api' : 'local';

    modeSelect.value = mode;
    modeSelect.setAttribute('data-current-mode', mode);
  } catch (err) {
    console.error('Failed to load model mode config:', err);
  }
}

/**
 * Update compact semantic status badge in header
 */
async function updateSemanticStatusBadge() {
  var badge = document.getElementById('semanticStatusBadge');
  if (!badge) return;

  try {
    var response = await fetch('/api/codexlens/semantic/status');
    var result = await response.json();

    if (result.available) {
      var accelerator = result.accelerator || 'CPU';
      var badgeClass = 'bg-success/20 text-success';
      var icon = 'check-circle';

      if (accelerator === 'CUDA') {
        badgeClass = 'bg-green-500/20 text-green-600';
        icon = 'zap';
      } else if (accelerator === 'DirectML') {
        badgeClass = 'bg-blue-500/20 text-blue-600';
        icon = 'cpu';
      }

      badge.innerHTML =
        '<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ' + badgeClass + '">' +
          '<i data-lucide="' + icon + '" class="w-3 h-3"></i>' +
          accelerator +
        '</span>';
    } else {
      badge.innerHTML =
        '<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning">' +
          '<i data-lucide="alert-triangle" class="w-3 h-3"></i>' +
          'Not Ready' +
        '</span>';
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    badge.innerHTML =
      '<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Error</span>';
  }
}

// ============================================================
// CODEXLENS ACTIONS
// ============================================================

/**
 * Initialize CodexLens index with bottom floating progress bar
 * @param {string} indexType - 'vector' (with embeddings), 'normal' (FTS only), or 'full' (FTS + Vector)
 * @param {string} embeddingModel - Model profile: 'code', 'fast'
 * @param {string} embeddingBackend - Backend: 'fastembed' (local) or 'litellm' (API)
 * @param {number} maxWorkers - Max concurrent API calls for embedding generation (default: 1)
 * @param {boolean} incremental - Incremental mode: true=skip unchanged, false=full rebuild (default: false)
 */
async function initCodexLensIndex(indexType, embeddingModel, embeddingBackend, maxWorkers, incremental) {
  indexType = indexType || 'vector';
  embeddingModel = embeddingModel || 'code';
  embeddingBackend = embeddingBackend || 'fastembed';
  maxWorkers = maxWorkers || 1;
  incremental = incremental !== undefined ? incremental : false;  // Default: full rebuild

  // For vector/full index with local backend, check if semantic dependencies are available
  // LiteLLM backend uses remote embeddings and does not require fastembed/ONNX deps.
  if ((indexType === 'vector' || indexType === 'full') && embeddingBackend !== 'litellm') {
    try {
      var semanticResponse = await fetch('/api/codexlens/semantic/status');
      var semanticStatus = await semanticResponse.json();

      if (!semanticStatus.available) {
        // Semantic deps not installed - show confirmation dialog
        var installDeps = confirm(
          (t('codexlens.semanticNotInstalled') || 'Semantic search dependencies are not installed.') + '\n\n' +
          (t('codexlens.installDepsPrompt') || 'Would you like to install them now? (This may take a few minutes)\n\nClick "Cancel" to create FTS index only.')
        );

        if (installDeps) {
          // Install semantic dependencies first
          showRefreshToast(t('codexlens.installingDeps') || 'Installing semantic dependencies...', 'info');
          try {
            var installResponse = await fetch('/api/codexlens/semantic/install', { method: 'POST' });
            var installResult = await installResponse.json();

            if (!installResult.success) {
              showRefreshToast((t('codexlens.depsInstallFailed') || 'Failed to install dependencies') + ': ' + installResult.error, 'error');
              // Fall back to FTS only
              indexType = 'normal';
            } else {
              showRefreshToast(t('codexlens.depsInstalled') || 'Dependencies installed successfully', 'success');
            }
          } catch (err) {
            showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
            indexType = 'normal';
          }
        } else {
          // User chose to skip - create FTS only
          indexType = 'normal';
        }
      }
    } catch (err) {
      console.warn('[CodexLens] Could not check semantic status:', err);
      // Continue with requested type, backend will handle fallback
    }
  }

  // Remove existing progress bar if any
  closeCodexLensIndexModal();

  // Create bottom floating progress bar
  var progressBar = document.createElement('div');
  progressBar.id = 'codexlensIndexFloating';
  progressBar.className = 'fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-lg transform transition-transform duration-300';

  // Determine display label
  var indexTypeLabel;
  if (indexType === 'full') {
    indexTypeLabel = 'FTS + Vector';
  } else if (indexType === 'vector') {
    indexTypeLabel = 'Vector';
  } else {
    indexTypeLabel = 'FTS';
  }

  // Add model info for vector indexes
  var modelLabel = '';
  if (indexType !== 'normal') {
    var modelNames = { code: 'Code', fast: 'Fast' };
    var backendLabel = embeddingBackend === 'litellm' ? 'API: ' : '';
    modelLabel = ' [' + backendLabel + (modelNames[embeddingModel] || embeddingModel) + ']';
  }

  progressBar.innerHTML =
    '<div class="max-w-4xl mx-auto px-4 py-3">' +
      '<div class="flex items-center justify-between gap-4">' +
        '<div class="flex items-center gap-3 flex-1 min-w-0">' +
          '<div class="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full flex-shrink-0" id="codexlensIndexSpinner"></div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2">' +
              '<span class="font-medium text-sm">' + t('codexlens.indexing') + ' (' + indexTypeLabel + modelLabel + ')</span>' +
              '<span class="text-xs text-muted-foreground" id="codexlensIndexPercent">0%</span>' +
            '</div>' +
            '<div class="text-xs text-muted-foreground truncate" id="codexlensIndexStatus">' + t('codexlens.preparingIndex') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex-1 max-w-xs hidden sm:block">' +
          '<div class="h-2 bg-muted rounded-full overflow-hidden">' +
            '<div id="codexlensIndexProgressBar" class="h-full bg-primary transition-all duration-300 ease-out" style="width: 0%"></div>' +
          '</div>' +
        '</div>' +
        '<button id="codexlensIndexCancelBtn" class="px-2 py-1 text-xs bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md transition-colors flex-shrink-0" onclick="cancelCodexLensIndexing()" title="' + t('common.cancel') + '">' +
          t('common.cancel') +
        '</button>' +
        '<button class="p-1.5 hover:bg-muted rounded-md transition-colors flex-shrink-0" onclick="closeCodexLensIndexModal()" title="' + t('common.close') + '">' +
          '<i data-lucide="x" class="w-4 h-4"></i>' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(progressBar);
  if (window.lucide) lucide.createIcons();

  // For 'full' type, use 'vector' in the API (it creates FTS + embeddings)
  var apiIndexType = (indexType === 'full') ? 'vector' : indexType;

  // Start indexing with specified type and model
  startCodexLensIndexing(apiIndexType, embeddingModel, embeddingBackend, maxWorkers, incremental);
}

/**
 * Start the indexing process
 * @param {string} indexType - 'vector' or 'normal'
 * @param {string} embeddingModel - Model profile: 'code', 'fast'
 * @param {string} embeddingBackend - Backend: 'fastembed' (local) or 'litellm' (API)
 * @param {number} maxWorkers - Max concurrent API calls for embedding generation (default: 1)
 * @param {boolean} incremental - Incremental mode (default: false for full rebuild)
 */
async function startCodexLensIndexing(indexType, embeddingModel, embeddingBackend, maxWorkers, incremental) {
  indexType = indexType || 'vector';
  embeddingModel = embeddingModel || 'code';
  embeddingBackend = embeddingBackend || 'fastembed';
  maxWorkers = maxWorkers || 1;
  incremental = incremental !== undefined ? incremental : false;  // Default: full rebuild
  var statusText = document.getElementById('codexlensIndexStatus');
  var progressBar = document.getElementById('codexlensIndexProgressBar');
  var percentText = document.getElementById('codexlensIndexPercent');
  var spinner = document.getElementById('codexlensIndexSpinner');

  // Setup WebSocket listener for progress events
  window.codexlensIndexProgressHandler = function(data) {
    var payload = data.payload || data;
    console.log('[CodexLens] Progress event received:', payload);

    if (statusText) statusText.textContent = payload.message || t('codexlens.indexing');
    if (progressBar) progressBar.style.width = (payload.percent || 0) + '%';
    if (percentText) percentText.textContent = (payload.percent || 0) + '%';

    // Handle completion
    if (payload.stage === 'complete') {
      handleIndexComplete(true, payload.message);
    } else if (payload.stage === 'error') {
      handleIndexComplete(false, payload.message);
    }
  };

  // Register with notification system
  if (typeof registerWsEventHandler === 'function') {
    registerWsEventHandler('CODEXLENS_INDEX_PROGRESS', window.codexlensIndexProgressHandler);
    console.log('[CodexLens] Registered WebSocket progress handler');
  } else {
    console.warn('[CodexLens] registerWsEventHandler not available');
  }

  try {
    console.log('[CodexLens] Starting index for:', projectPath, 'type:', indexType, 'model:', embeddingModel, 'backend:', embeddingBackend, 'maxWorkers:', maxWorkers, 'incremental:', incremental);
    var response = await fetch('/api/codexlens/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath, indexType: indexType, embeddingModel: embeddingModel, embeddingBackend: embeddingBackend, maxWorkers: maxWorkers, incremental: incremental })
    });

    var result = await response.json();
    console.log('[CodexLens] Init result:', result);

    // Check if completed successfully (WebSocket might have already reported)
    if (result.success) {
      // For vector index, check if embeddings were actually generated
      var embeddingsResult = result.result && result.result.embeddings;
      if (indexType === 'vector' && embeddingsResult && !embeddingsResult.generated) {
        // FTS succeeded but embeddings failed - show partial success
        var errorMsg = embeddingsResult.error || t('codexlens.embeddingsFailed');
        handleIndexComplete(false, t('codexlens.ftsSuccessEmbeddingsFailed') || 'FTS index created, but embeddings failed: ' + errorMsg);
      } else {
        handleIndexComplete(true, t('codexlens.indexComplete'));
      }
    } else if (!result.success) {
      handleIndexComplete(false, result.error || t('common.unknownError'));
    }
  } catch (err) {
    console.error('[CodexLens] Init error:', err);
    handleIndexComplete(false, err.message);
  }
}

/**
 * Handle index completion
 */
function handleIndexComplete(success, message) {
  var statusText = document.getElementById('codexlensIndexStatus');
  var progressBar = document.getElementById('codexlensIndexProgressBar');
  var percentText = document.getElementById('codexlensIndexPercent');
  var spinner = document.getElementById('codexlensIndexSpinner');
  var floatingBar = document.getElementById('codexlensIndexFloating');

  // Unregister WebSocket handler
  if (typeof unregisterWsEventHandler === 'function' && window.codexlensIndexProgressHandler) {
    unregisterWsEventHandler('CODEXLENS_INDEX_PROGRESS', window.codexlensIndexProgressHandler);
  }

  if (success) {
    if (progressBar) progressBar.style.width = '100%';
    if (percentText) percentText.textContent = '100%';
    if (statusText) statusText.textContent = t('codexlens.indexComplete');
    if (spinner) {
      spinner.classList.remove('animate-spin', 'border-primary');
      spinner.classList.add('border-green-500');
      spinner.innerHTML = '<i data-lucide="check" class="w-5 h-5 text-green-500"></i>';
      if (window.lucide) lucide.createIcons();
    }
    if (floatingBar) {
      floatingBar.classList.add('bg-green-500/10');
    }

    showRefreshToast(t('codexlens.indexSuccess'), 'success');

    // Auto-close after 3 seconds
    setTimeout(function() {
      closeCodexLensIndexModal();
      // Refresh status
      if (typeof loadCodexLensStatus === 'function') {
        loadCodexLensStatus().then(function() {
          renderToolsSection();
          if (window.lucide) lucide.createIcons();
        });
      }
    }, 3000);
  } else {
    if (progressBar) {
      progressBar.classList.remove('bg-primary');
      progressBar.classList.add('bg-destructive');
    }
    if (statusText) statusText.textContent = message || t('codexlens.indexFailed');
    if (spinner) {
      spinner.classList.remove('animate-spin', 'border-primary');
      spinner.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-destructive"></i>';
      if (window.lucide) lucide.createIcons();
    }
    if (floatingBar) {
      floatingBar.classList.add('bg-destructive/10');
    }

    showRefreshToast(t('codexlens.indexFailed') + ': ' + message, 'error');
  }
}

/**
 * Close floating progress bar
 */
function closeCodexLensIndexModal() {
  var floatingBar = document.getElementById('codexlensIndexFloating');
  if (floatingBar) {
    floatingBar.classList.add('translate-y-full');
    setTimeout(function() {
      floatingBar.remove();
    }, 300);
  }

  // Unregister WebSocket handler
  if (typeof unregisterWsEventHandler === 'function' && window.codexlensIndexProgressHandler) {
    unregisterWsEventHandler('CODEXLENS_INDEX_PROGRESS', window.codexlensIndexProgressHandler);
  }
}

/**
 * Cancel the running indexing process
 */
async function cancelCodexLensIndexing() {
  var cancelBtn = document.getElementById('codexlensIndexCancelBtn');
  var statusText = document.getElementById('codexlensIndexStatus');

  // Disable button to prevent double-click
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('common.canceling') || 'Canceling...';
  }

  try {
    var response = await fetch('/api/codexlens/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    var result = await response.json();

    if (result.success) {
      if (statusText) statusText.textContent = t('codexlens.indexCanceled') || 'Indexing canceled';
      showRefreshToast(t('codexlens.indexCanceled') || 'Indexing canceled', 'info');

      // Close the modal after a short delay
      setTimeout(function() {
        closeCodexLensIndexModal();
        // Refresh status
        if (typeof loadCodexLensStatus === 'function') {
          loadCodexLensStatus().then(function() {
            renderToolsSection();
            if (window.lucide) lucide.createIcons();
          });
        }
      }, 1000);
    } else {
      showRefreshToast(t('codexlens.cancelFailed') + ': ' + result.error, 'error');
      // Re-enable button on failure
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = t('common.cancel');
      }
    }
  } catch (err) {
    console.error('[CodexLens] Cancel error:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    // Re-enable button on error
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = t('common.cancel');
    }
  }
}

/**
 * Install CodexLens
 * Note: Uses CodexLens-specific install wizard from cli-status.js
 * which calls /api/codexlens/bootstrap (Python venv), not the generic
 * CLI install that uses npm install -g (NPM packages)
 */
function installCodexLensFromManager() {
  // Use the CodexLens-specific install wizard from cli-status.js
  if (typeof openCodexLensInstallWizard === 'function') {
    openCodexLensInstallWizard();
  } else {
    // Fallback: inline install wizard if cli-status.js not loaded
    showCodexLensInstallDialog();
  }
}

/**
 * Fallback install dialog when cli-status.js is not loaded
 */
function showCodexLensInstallDialog() {
  var modal = document.createElement('div');
  modal.id = 'codexlensInstallModalFallback';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML =
    '<div class="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">' +
      '<div class="p-6">' +
        '<div class="flex items-center gap-3 mb-4">' +
          '<div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">' +
            '<i data-lucide="database" class="w-5 h-5 text-primary"></i>' +
          '</div>' +
          '<div>' +
            '<h3 class="text-lg font-semibold">' + t('codexlens.installCodexLens') + '</h3>' +
            '<p class="text-sm text-muted-foreground">' + t('codexlens.installDesc') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="space-y-4">' +
          '<div class="bg-muted/50 rounded-lg p-4">' +
            '<h4 class="font-medium mb-2">' + t('codexlens.whatWillBeInstalled') + '</h4>' +
            '<ul class="text-sm space-y-2 text-muted-foreground">' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="check" class="w-4 h-4 text-success mt-0.5"></i>' +
                '<span><strong>' + t('codexlens.pythonVenv') + '</strong> - ' + t('codexlens.pythonVenvDesc') + '</span>' +
              '</li>' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="check" class="w-4 h-4 text-success mt-0.5"></i>' +
                '<span><strong>' + t('codexlens.codexlensPackage') + '</strong> - ' + t('codexlens.codexlensPackageDesc') + '</span>' +
              '</li>' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="check" class="w-4 h-4 text-success mt-0.5"></i>' +
                '<span><strong>SQLite FTS5</strong> - ' + t('codexlens.sqliteFtsDesc') + '</span>' +
              '</li>' +
            '</ul>' +
          '</div>' +
          '<div class="bg-primary/5 border border-primary/20 rounded-lg p-3">' +
            '<div class="flex items-start gap-2">' +
              '<i data-lucide="info" class="w-4 h-4 text-primary mt-0.5"></i>' +
              '<div class="text-sm text-muted-foreground">' +
                '<p class="font-medium text-foreground">' + t('codexlens.installLocation') + '</p>' +
                '<p class="mt-1"><code class="bg-muted px-1 rounded">~/.codexlens/venv</code></p>' +
                '<p class="mt-1">' + t('codexlens.installTime') + '</p>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="codexlensInstallProgressFallback" class="hidden">' +
            '<div class="flex items-center gap-3">' +
              '<div class="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>' +
              '<span class="text-sm" id="codexlensInstallStatusFallback">' + t('codexlens.startingInstall') + '</span>' +
            '</div>' +
            '<div class="mt-2 h-2 bg-muted rounded-full overflow-hidden">' +
              '<div id="codexlensInstallProgressBarFallback" class="h-full bg-primary transition-all duration-300" style="width: 0%"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="border-t border-border p-4 flex justify-end gap-3 bg-muted/30">' +
        '<button class="btn-outline px-4 py-2" onclick="closeCodexLensInstallDialogFallback()">' + t('common.cancel') + '</button>' +
        '<button id="codexlensInstallBtnFallback" class="btn-primary px-4 py-2" onclick="startCodexLensInstallFallback()">' +
          '<i data-lucide="download" class="w-4 h-4 mr-2"></i>' +
          t('codexlens.installNow') +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

function closeCodexLensInstallDialogFallback() {
  var modal = document.getElementById('codexlensInstallModalFallback');
  if (modal) modal.remove();
}

async function startCodexLensInstallFallback() {
  var progressDiv = document.getElementById('codexlensInstallProgressFallback');
  var installBtn = document.getElementById('codexlensInstallBtnFallback');
  var statusText = document.getElementById('codexlensInstallStatusFallback');
  var progressBar = document.getElementById('codexlensInstallProgressBarFallback');

  progressDiv.classList.remove('hidden');
  installBtn.disabled = true;
  installBtn.innerHTML = '<span class="animate-pulse">' + t('codexlens.installing') + '</span>';

  var stages = [
    { progress: 10, text: t('codexlens.creatingVenv') },
    { progress: 30, text: t('codexlens.installingPip') },
    { progress: 50, text: t('codexlens.installingPackage') },
    { progress: 70, text: t('codexlens.settingUpDeps') },
    { progress: 90, text: t('codexlens.finalizing') }
  ];

  var currentStage = 0;
  var progressInterval = setInterval(function() {
    if (currentStage < stages.length) {
      statusText.textContent = stages[currentStage].text;
      progressBar.style.width = stages[currentStage].progress + '%';
      currentStage++;
    }
  }, 1500);

  try {
    var response = await fetch('/api/codexlens/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    clearInterval(progressInterval);
    var result = await response.json();

    if (result.success) {
      progressBar.style.width = '100%';
      statusText.textContent = t('codexlens.installComplete');

      setTimeout(function() {
        closeCodexLensInstallDialogFallback();
        showRefreshToast(t('codexlens.installSuccess'), 'success');
        // Refresh the page to update status
        if (typeof loadCodexLensStatus === 'function') {
          loadCodexLensStatus().then(function() {
            if (typeof renderCodexLensManager === 'function') renderCodexLensManager();
          });
        } else {
          location.reload();
        }
      }, 1000);
    } else {
      statusText.textContent = t('common.error') + ': ' + result.error;
      progressBar.classList.add('bg-destructive');
      installBtn.disabled = false;
      installBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 mr-2"></i> ' + t('common.retry');
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    clearInterval(progressInterval);
    statusText.textContent = t('common.error') + ': ' + err.message;
    progressBar.classList.add('bg-destructive');
    installBtn.disabled = false;
    installBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 mr-2"></i> ' + t('common.retry');
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Uninstall CodexLens
 * Note: Uses CodexLens-specific uninstall wizard from cli-status.js
 * which calls /api/codexlens/uninstall (Python venv), not the generic
 * CLI uninstall that uses /api/cli/uninstall (NPM packages)
 */
function uninstallCodexLensFromManager() {
  // Use the CodexLens-specific uninstall wizard from cli-status.js
  if (typeof openCodexLensUninstallWizard === 'function') {
    openCodexLensUninstallWizard();
  } else {
    // Fallback: inline uninstall wizard if cli-status.js not loaded
    showCodexLensUninstallDialog();
  }
}

/**
 * Fallback uninstall dialog when cli-status.js is not loaded
 */
function showCodexLensUninstallDialog() {
  var modal = document.createElement('div');
  modal.id = 'codexlensUninstallModalFallback';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML =
    '<div class="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">' +
      '<div class="p-6">' +
        '<div class="flex items-center gap-3 mb-4">' +
          '<div class="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">' +
            '<i data-lucide="trash-2" class="w-5 h-5 text-destructive"></i>' +
          '</div>' +
          '<div>' +
            '<h3 class="text-lg font-semibold">' + t('codexlens.uninstall') + '</h3>' +
            '<p class="text-sm text-muted-foreground">' + t('codexlens.uninstallDesc') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="space-y-4">' +
          '<div class="bg-destructive/5 border border-destructive/20 rounded-lg p-4">' +
            '<h4 class="font-medium text-destructive mb-2">' + t('codexlens.whatWillBeRemoved') + '</h4>' +
            '<ul class="text-sm space-y-2 text-muted-foreground">' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="x" class="w-4 h-4 text-destructive mt-0.5"></i>' +
                '<span>' + t('codexlens.removeVenv') + '</span>' +
              '</li>' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="x" class="w-4 h-4 text-destructive mt-0.5"></i>' +
                '<span>' + t('codexlens.removeData') + '</span>' +
              '</li>' +
              '<li class="flex items-start gap-2">' +
                '<i data-lucide="x" class="w-4 h-4 text-destructive mt-0.5"></i>' +
                '<span>' + t('codexlens.removeConfig') + '</span>' +
              '</li>' +
            '</ul>' +
          '</div>' +
          '<div id="codexlensUninstallProgressFallback" class="hidden">' +
            '<div class="flex items-center gap-3">' +
              '<div class="animate-spin w-5 h-5 border-2 border-destructive border-t-transparent rounded-full"></div>' +
              '<span class="text-sm" id="codexlensUninstallStatusFallback">' + t('codexlens.removing') + '</span>' +
            '</div>' +
            '<div class="mt-2 h-2 bg-muted rounded-full overflow-hidden">' +
              '<div id="codexlensUninstallProgressBarFallback" class="h-full bg-destructive transition-all duration-300" style="width: 0%"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="border-t border-border p-4 flex justify-end gap-3 bg-muted/30">' +
        '<button class="btn-outline px-4 py-2" onclick="closeCodexLensUninstallDialogFallback()">' + t('common.cancel') + '</button>' +
        '<button id="codexlensUninstallBtnFallback" class="btn-destructive px-4 py-2" onclick="startCodexLensUninstallFallback()">' +
          '<i data-lucide="trash-2" class="w-4 h-4 mr-2"></i>' +
          t('codexlens.uninstall') +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

function closeCodexLensUninstallDialogFallback() {
  var modal = document.getElementById('codexlensUninstallModalFallback');
  if (modal) modal.remove();
}

async function startCodexLensUninstallFallback() {
  var progressDiv = document.getElementById('codexlensUninstallProgressFallback');
  var uninstallBtn = document.getElementById('codexlensUninstallBtnFallback');
  var statusText = document.getElementById('codexlensUninstallStatusFallback');
  var progressBar = document.getElementById('codexlensUninstallProgressBarFallback');

  progressDiv.classList.remove('hidden');
  uninstallBtn.disabled = true;
  uninstallBtn.innerHTML = '<span class="animate-pulse">' + t('codexlens.uninstalling') + '</span>';

  var stages = [
    { progress: 25, text: t('codexlens.removingVenv') },
    { progress: 50, text: t('codexlens.removingData') },
    { progress: 75, text: t('codexlens.removingConfig') },
    { progress: 90, text: t('codexlens.finalizing') }
  ];

  var currentStage = 0;
  var progressInterval = setInterval(function() {
    if (currentStage < stages.length) {
      statusText.textContent = stages[currentStage].text;
      progressBar.style.width = stages[currentStage].progress + '%';
      currentStage++;
    }
  }, 500);

  try {
    var response = await fetch('/api/codexlens/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    clearInterval(progressInterval);
    var result = await response.json();

    if (result.success) {
      progressBar.style.width = '100%';
      statusText.textContent = t('codexlens.uninstallComplete');

      setTimeout(function() {
        closeCodexLensUninstallDialogFallback();
        showRefreshToast(t('codexlens.uninstallSuccess'), 'success');
        // Refresh the page to update status
        if (typeof loadCodexLensStatus === 'function') {
          loadCodexLensStatus().then(function() {
            if (typeof renderCodexLensManager === 'function') renderCodexLensManager();
          });
        } else {
          location.reload();
        }
      }, 1000);
    } else {
      statusText.textContent = t('common.error') + ': ' + result.error;
      progressBar.classList.add('bg-destructive');
      uninstallBtn.disabled = false;
      uninstallBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 mr-2"></i> ' + t('common.retry');
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    clearInterval(progressInterval);
    statusText.textContent = t('common.error') + ': ' + err.message;
    progressBar.classList.add('bg-destructive');
    uninstallBtn.disabled = false;
    uninstallBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 mr-2"></i> ' + t('common.retry');
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Clean current workspace index
 */
async function cleanCurrentWorkspaceIndex() {
  if (!confirm(t('codexlens.cleanCurrentWorkspaceConfirm'))) {
    return;
  }

  try {
    showRefreshToast(t('codexlens.cleaning'), 'info');

    // Get current workspace path (projectPath is a global variable from state.js)
    var workspacePath = projectPath;

    var response = await fetch('/api/codexlens/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspacePath })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.cleanCurrentWorkspaceSuccess'), 'success');

      // Refresh status
      if (typeof loadCodexLensStatus === 'function') {
        await loadCodexLensStatus();
        renderToolsSection();
        if (window.lucide) lucide.createIcons();
      }
    } else {
      showRefreshToast(t('codexlens.cleanFailed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Clean all CodexLens indexes
 */
async function cleanCodexLensIndexes() {
  if (!confirm(t('codexlens.cleanConfirm'))) {
    return;
  }

  try {
    showRefreshToast(t('codexlens.cleaning'), 'info');

    var response = await fetch('/api/codexlens/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.cleanSuccess'), 'success');

      // Refresh status
      if (typeof loadCodexLensStatus === 'function') {
        await loadCodexLensStatus();
        renderToolsSection();
        if (window.lucide) lucide.createIcons();
      }
    } else {
      showRefreshToast(t('codexlens.cleanFailed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

// ============================================================
// CODEXLENS MANAGER PAGE (Independent View)
// ============================================================

/**
 * Render CodexLens Manager as an independent page view
 */
async function renderCodexLensManager() {
  var container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search
  var statsGrid = document.getElementById('statsGrid');
  var searchContainer = document.querySelector('.search-container');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchContainer) searchContainer.style.display = 'none';

  container.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div><span class="ml-3">' + t('common.loading') + '</span></div>';

  try {
    // Use aggregated endpoint for faster page load (single API call)
    var dashboardData = null;
    var config = { index_dir: '~/.codexlens/indexes', index_count: 0 };

    if (typeof loadCodexLensDashboardInit === 'function') {
      console.log('[CodexLens] Using aggregated dashboard-init endpoint...');
      dashboardData = await loadCodexLensDashboardInit();
      if (dashboardData && dashboardData.config) {
        config = dashboardData.config;
        console.log('[CodexLens] Dashboard init loaded, config:', config);
      }
    } else if (typeof loadCodexLensStatus === 'function') {
      // Fallback to legacy individual calls
      console.log('[CodexLens] Fallback to legacy loadCodexLensStatus...');
      await loadCodexLensStatus();
      var response = await fetch('/api/codexlens/config');
      config = await response.json();
    }

    // Load LiteLLM API config for embedding backend options (parallel with page render)
    var litellmPromise = (async () => {
      try {
        console.log('[CodexLens] Loading LiteLLM config...');
        var litellmResponse = await fetch('/api/litellm-api/config');
        if (litellmResponse.ok) {
          window.litellmApiConfig = await litellmResponse.json();
          console.log('[CodexLens] LiteLLM config loaded, providers:', window.litellmApiConfig?.providers?.length || 0);
        }
      } catch (e) {
        console.warn('[CodexLens] Could not load LiteLLM config:', e);
      }
    })();

    container.innerHTML = buildCodexLensManagerPage(config);
    if (window.lucide) lucide.createIcons();
    initCodexLensManagerPageEvents(config);

    // Load additional data in parallel (non-blocking)
    var isInstalled = window.cliToolsStatus?.codexlens?.installed || dashboardData?.installed;

    // Wait for LiteLLM config before loading semantic deps (it may need provider info)
    await litellmPromise;

    // Load FastEmbed installation status (show/hide install card)
    loadFastEmbedInstallStatus();

    // Always load semantic deps status - it needs GPU detection and device list
    // which are not included in the aggregated endpoint
    loadSemanticDepsStatus();

    loadModelList();
    loadRerankerModelList();

    // Initialize model mode and semantic status badge
    updateSemanticStatusBadge();

    // Initialize file watcher status
    initWatcherStatus();

    // Load index stats for the Index Manager section
    if (isInstalled) {
      loadIndexStatsForPage();
      // Check index health based on git history
      checkIndexHealth();
      // Load workspace index status (FTS and Vector coverage)
      refreshWorkspaceIndexStatus();
    }
  } catch (err) {
    container.innerHTML = '<div class="text-center py-12 text-destructive"><i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i><p>' + t('common.error') + ': ' + escapeHtml(err.message) + '</p></div>';
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Build CodexLens Manager page content
 */
function buildCodexLensManagerPage(config) {
  var indexDir = config.index_dir || '~/.codexlens/indexes';
  var indexCount = config.index_count || 0;
  var isInstalled = window.cliToolsStatus?.codexlens?.installed || false;

  return '<div class="codexlens-manager-page space-y-6">' +
    // Header with status
    '<div class="bg-card border border-border rounded-lg p-6">' +
      '<div class="flex items-center justify-between flex-wrap gap-4">' +
        '<div class="flex items-center gap-4">' +
          '<div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">' +
            '<i data-lucide="database" class="w-6 h-6 text-primary"></i>' +
          '</div>' +
          '<div>' +
            '<h2 class="text-xl font-bold">' + t('codexlens.config') + '</h2>' +
            '<p class="text-sm text-muted-foreground">' + t('codexlens.configDesc') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-4">' +
          (isInstalled
            ? '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-success/10 text-success border border-success/20"><i data-lucide="check-circle" class="w-4 h-4"></i> ' + t('codexlens.installed') + '</span>'
            : '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground border border-border"><i data-lucide="circle" class="w-4 h-4"></i> ' + t('codexlens.notInstalled') + '</span>') +
          '<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20">' +
            '<span class="text-sm text-muted-foreground">' + t('codexlens.indexes') + ':</span>' +
            '<span class="text-lg font-bold text-primary">' + indexCount + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    (isInstalled
      ? // Installed: Show full management UI
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
          // Left Column
          '<div class="space-y-6">' +
            // Index Management Section - Combined Create Index + Maintenance
            '<div class="bg-card border border-border rounded-lg p-5">' +
              '<h4 class="text-lg font-semibold mb-4 flex items-center gap-2"><i data-lucide="layers" class="w-5 h-5 text-primary"></i> ' + t('codexlens.indexManagement') + '</h4>' +
              '<div class="space-y-4">' +
                // Index Actions - Primary buttons
                '<div class="grid grid-cols-2 gap-3">' +
                  '<button class="btn btn-primary flex items-center justify-center gap-2 py-3" onclick="initCodexLensIndexFromPage(\'full\')" title="' + t('codexlens.fullIndexDesc') + '">' +
                    '<i data-lucide="layers" class="w-4 h-4"></i>' +
                    '<span>' + t('codexlens.fullIndex') + '</span>' +
                  '</button>' +
                  '<button class="btn btn-outline flex items-center justify-center gap-2 py-3" onclick="initCodexLensIndexFromPage(\'normal\')" title="' + t('codexlens.ftsIndexDesc') + '">' +
                    '<i data-lucide="file-text" class="w-4 h-4"></i>' +
                    '<span>' + t('codexlens.ftsIndex') + '</span>' +
                  '</button>' +
                '</div>' +
                // Incremental Update button
                '<button class="btn btn-outline w-full flex items-center justify-center gap-2 py-2.5" onclick="runIncrementalUpdate()" title="Update index with changed files only">' +
                  '<i data-lucide="refresh-cw" class="w-4 h-4"></i>' +
                  '<span>' + t('codexlens.incrementalUpdate') + '</span>' +
                '</button>' +
                '<p class="text-xs text-muted-foreground">' + t('codexlens.indexTypeHint') + '</p>' +
                // Maintenance Actions
                '<div class="pt-3 border-t border-border">' +
                  '<div class="flex flex-wrap gap-2">' +
                    '<button class="btn-sm btn-outline" onclick="cleanCurrentWorkspaceIndex()"><i data-lucide="folder-x" class="w-3.5 h-3.5"></i> ' + t('codexlens.cleanCurrentWorkspace') + '</button>' +
                    '<button class="btn-sm btn-outline" onclick="cleanCodexLensIndexes()"><i data-lucide="trash" class="w-3.5 h-3.5"></i> ' + t('codexlens.cleanAllIndexes') + '</button>' +
                    '<button class="btn-sm btn-destructive" onclick="uninstallCodexLensFromManager()"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> ' + t('cli.uninstall') + '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            // Storage Path Section
            '<div class="bg-card border border-border rounded-lg p-5">' +
              '<h4 class="text-lg font-semibold mb-4 flex items-center gap-2"><i data-lucide="folder" class="w-5 h-5 text-primary"></i> ' + t('codexlens.indexStoragePath') + '</h4>' +
              '<div class="space-y-3">' +
                '<div>' +
                  '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.currentPath') + '</label>' +
                  '<div class="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 font-mono border border-border truncate" title="' + indexDir + '">' + indexDir + '</div>' +
                '</div>' +
                '<div>' +
                  '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.newStoragePath') + '</label>' +
                  '<div class="flex gap-2">' +
                    '<input type="text" id="indexDirInput" value="' + indexDir + '" class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm" />' +
                    '<button class="btn-sm btn-primary" id="saveIndexPathBtn"><i data-lucide="save" class="w-3.5 h-3.5"></i></button>' +
                  '</div>' +
                  '<p class="text-xs text-muted-foreground mt-1">' + t('codexlens.pathInfo') + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
            // Environment Variables Section
            '<div class="bg-card border border-border rounded-lg p-5">' +
              '<div class="flex items-center justify-between mb-4">' +
                '<h4 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="file-code" class="w-5 h-5 text-primary"></i> ' + t('codexlens.environmentVariables') + '</h4>' +
                '<button class="btn-sm btn-outline" onclick="loadEnvVariables()"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Load</button>' +
              '</div>' +
              '<div id="envVarsContainer" class="space-y-2">' +
                '<div class="text-sm text-muted-foreground">Click Load to view/edit ~/.codexlens/.env</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // Right Column
          '<div class="space-y-6">' +
            // FastEmbed Installation Card (shown when not installed)
            '<div id="fastembedInstallCard" class="hidden">' +
              // Content will be populated by loadFastEmbedInstallStatus()
            '</div>' +
            // Combined: Semantic Status + Model Management with Tabs
            '<div class="bg-card border border-border rounded-lg overflow-hidden">' +
              // Compact Header with Semantic Status
              '<div class="bg-muted/30 border-b border-border px-4 py-3">' +
                '<div class="flex items-center justify-between">' +
                  '<h4 class="font-semibold flex items-center gap-2"><i data-lucide="cpu" class="w-4 h-4 text-primary"></i> ' + t('codexlens.modelManagement') + '</h4>' +
                  '<div id="semanticStatusBadge" class="flex items-center gap-2">' +
                    '<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground animate-pulse">Checking...</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              // Tabs for Embedding / Reranker
              '<div class="border-b border-border">' +
                '<div class="flex">' +
                  '<button class="model-tab flex-1 px-4 py-2.5 text-sm font-medium border-b-2 border-primary text-primary bg-primary/5" data-tab="embedding" onclick="switchCodexLensModelTab(\'embedding\')">' +
                    '<i data-lucide="layers" class="w-3.5 h-3.5 inline mr-1"></i>Embedding' +
                  '</button>' +
                  '<button class="model-tab flex-1 px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground" data-tab="reranker" onclick="switchCodexLensModelTab(\'reranker\')">' +
                    '<i data-lucide="arrow-up-down" class="w-3.5 h-3.5 inline mr-1"></i>Reranker' +
                  '</button>' +
                '</div>' +
              '</div>' +
              // Tab Content
              '<div class="p-4">' +
                // Embedding Tab Content
                '<div id="embeddingTabContent" class="model-tab-content">' +
                  '<div id="modelListContainer" class="space-y-2">' +
                    '<div class="flex items-center gap-2 text-sm text-muted-foreground">' +
                      '<div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div> ' + t('codexlens.loadingModels') +
                    '</div>' +
                  '</div>' +
                '</div>' +
                // Reranker Tab Content
                '<div id="rerankerTabContent" class="model-tab-content hidden">' +
                  '<div id="pageRerankerModelListContainer" class="space-y-2">' +
                    '<div class="text-sm text-muted-foreground">' + t('common.loading') + '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            // File Watcher Card
            '<div class="bg-card border border-border rounded-lg overflow-hidden">' +
              '<div class="bg-muted/30 border-b border-border px-4 py-3">' +
                '<div class="flex items-center justify-between">' +
                  '<div class="flex items-center gap-2">' +
                    '<i data-lucide="eye" class="w-4 h-4 text-primary"></i>' +
                    '<h4 class="font-semibold">File Watcher</h4>' +
                  '</div>' +
                  '<div id="watcherStatusBadge" class="flex items-center gap-2">' +
                    '<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Stopped</span>' +
                    '<button class="btn-sm btn-outline" onclick="toggleWatcher()" id="watcherToggleBtn">' +
                      '<i data-lucide="play" class="w-3.5 h-3.5"></i>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="p-4">' +
                '<p class="text-xs text-muted-foreground mb-3">Monitor file changes and auto-update index</p>' +
                // Stats row
                '<div class="grid grid-cols-3 gap-2 mb-3">' +
                  '<div class="bg-muted/30 rounded p-2 text-center">' +
                    '<div id="watcherFilesCount" class="text-sm font-semibold">-</div>' +
                    '<div class="text-xs text-muted-foreground">Files</div>' +
                  '</div>' +
                  '<div class="bg-muted/30 rounded p-2 text-center">' +
                    '<div id="watcherChangesCount" class="text-sm font-semibold">0</div>' +
                    '<div class="text-xs text-muted-foreground">Changes</div>' +
                  '</div>' +
                  '<div class="bg-muted/30 rounded p-2 text-center">' +
                    '<div id="watcherUptimeDisplay" class="text-sm font-semibold">-</div>' +
                    '<div class="text-xs text-muted-foreground">Uptime</div>' +
                  '</div>' +
                '</div>' +
                // Recent activity log
                '<div class="border border-border rounded">' +
                  '<div class="bg-muted/30 px-3 py-1.5 border-b border-border text-xs font-medium text-muted-foreground flex items-center justify-between">' +
                    '<span>Recent Activity</span>' +
                    '<button class="text-xs hover:text-foreground" onclick="clearWatcherLog()" title="Clear log">' +
                      '<i data-lucide="trash-2" class="w-3 h-3"></i>' +
                    '</button>' +
                  '</div>' +
                  '<div id="watcherActivityLog" class="h-24 overflow-y-auto p-2 text-xs font-mono bg-background">' +
                    '<div class="text-muted-foreground">No activity yet. Start watcher to monitor files.</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Index Manager Section
        '<div class="bg-card border border-border rounded-lg overflow-hidden" id="indexManagerSection">' +
          '<div class="bg-muted/30 border-b border-border px-4 py-3 flex items-center justify-between">' +
            '<div class="flex items-center gap-2">' +
              '<i data-lucide="database" class="w-4 h-4 text-primary"></i>' +
              '<span class="font-medium text-foreground">' + t('index.manager') + '</span>' +
              '<span class="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground" id="indexTotalSize">-</span>' +
              '<span id="indexHealthBadge" class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground animate-pulse">...</span>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<button onclick="loadIndexStatsForPage()" class="text-xs px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="' + t('common.refresh') + '">' +
                '<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>' +
              '</button>' +
            '</div>' +
          '</div>' +
          // Index Health Details
          '<div id="indexHealthDetails" class="px-4 py-2 border-b border-border bg-muted/10 hidden">' +
            '<div class="flex items-center justify-between text-xs">' +
              '<div class="flex items-center gap-4">' +
                '<span class="text-muted-foreground">Last indexed: <span id="indexLastUpdate">-</span></span>' +
                '<span class="text-muted-foreground">Commits since: <span id="indexCommitsSince" class="font-medium">-</span></span>' +
              '</div>' +
              '<button class="text-primary hover:underline" onclick="runIncrementalUpdate()">Update Now</button>' +
            '</div>' +
          '</div>' +
          '<div class="p-4">' +
            '<div class="flex items-center gap-2 mb-3 text-xs text-muted-foreground">' +
              '<i data-lucide="folder" class="w-3.5 h-3.5"></i>' +
              '<span class="font-mono truncate" id="indexDirDisplay" title="' + indexDir + '">' + indexDir + '</span>' +
            '</div>' +
            '<div class="grid grid-cols-4 gap-3 mb-4">' +
              '<div class="bg-muted/30 rounded-lg p-3 text-center">' +
                '<div class="text-lg font-semibold text-foreground" id="indexProjectCount">-</div>' +
                '<div class="text-xs text-muted-foreground">' + t('index.projects') + '</div>' +
              '</div>' +
              '<div class="bg-muted/30 rounded-lg p-3 text-center">' +
                '<div class="text-lg font-semibold text-foreground" id="indexTotalSizeVal">-</div>' +
                '<div class="text-xs text-muted-foreground">' + t('index.totalSize') + '</div>' +
              '</div>' +
              '<div class="bg-muted/30 rounded-lg p-3 text-center">' +
                '<div class="text-lg font-semibold text-foreground" id="indexVectorCount">-</div>' +
                '<div class="text-xs text-muted-foreground">' + t('index.vectorIndexes') + '</div>' +
              '</div>' +
              '<div class="bg-muted/30 rounded-lg p-3 text-center">' +
                '<div class="text-lg font-semibold text-foreground" id="indexFtsCount">-</div>' +
                '<div class="text-xs text-muted-foreground">' + t('index.ftsIndexes') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="border border-border rounded-lg overflow-hidden">' +
              '<table class="w-full text-sm">' +
                '<thead class="bg-muted/50">' +
                  '<tr class="text-xs text-muted-foreground">' +
                    '<th class="py-2 px-2 text-left font-medium">' + t('index.projectId') + '</th>' +
                    '<th class="py-2 px-2 text-right font-medium">' + t('index.size') + '</th>' +
                    '<th class="py-2 px-2 text-center font-medium">' + t('index.type') + '</th>' +
                    '<th class="py-2 px-2 text-right font-medium">' + t('index.lastModified') + '</th>' +
                    '<th class="py-2 px-1 w-8"></th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody id="indexTableBody">' +
                  '<tr><td colspan="5" class="py-4 text-center text-muted-foreground text-sm">' + t('common.loading') + '</td></tr>' +
                '</tbody>' +
              '</table>' +
            '</div>' +
            '<div class="mt-4 flex justify-end">' +
              '<button onclick="cleanAllIndexesFromPage()" class="text-xs px-3 py-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded transition-colors flex items-center gap-1.5">' +
                '<i data-lucide="trash" class="w-3.5 h-3.5"></i>' +
                t('index.cleanAll') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Test Search Section
        '<div class="bg-card border border-border rounded-lg p-5">' +
          '<h4 class="text-lg font-semibold mb-4 flex items-center gap-2"><i data-lucide="search" class="w-5 h-5 text-primary"></i> ' + t('codexlens.testSearch') + '</h4>' +
          '<div class="space-y-4">' +
            '<div class="flex gap-3">' +
              '<select id="searchTypeSelect" class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
                '<option value="search">' + t('codexlens.textSearch') + '</option>' +
                '<option value="search_files">' + t('codexlens.fileSearch') + '</option>' +
                '<option value="symbol">' + t('codexlens.symbolSearch') + '</option>' +
              '</select>' +
              '<select id="searchModeSelect" class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
                '<option value="exact">' + t('codexlens.exactMode') + '</option>' +
                '<option value="fuzzy">' + t('codexlens.fuzzyMode') + '</option>' +
                '<option value="hybrid">' + t('codexlens.hybridMode') + '</option>' +
                '<option value="vector">' + t('codexlens.vectorMode') + '</option>' +
              '</select>' +
            '</div>' +
            '<div class="flex gap-3 items-center">' +
              '<div class="flex items-center gap-2">' +
                '<label class="text-xs text-muted-foreground whitespace-nowrap">' + t('codexlens.resultLimit') + '</label>' +
                '<input type="number" id="searchLimitInput" class="w-16 px-2 py-1.5 border border-border rounded-lg bg-background text-sm text-center" value="5" min="1" max="50" />' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
                '<label class="text-xs text-muted-foreground whitespace-nowrap">' + t('codexlens.contentLength') + '</label>' +
                '<input type="number" id="contentLengthInput" class="w-20 px-2 py-1.5 border border-border rounded-lg bg-background text-sm text-center" value="200" min="50" max="2000" />' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
                '<label class="text-xs text-muted-foreground whitespace-nowrap">' + t('codexlens.extraFiles') + '</label>' +
                '<input type="number" id="extraFilesInput" class="w-16 px-2 py-1.5 border border-border rounded-lg bg-background text-sm text-center" value="10" min="0" max="50" />' +
              '</div>' +
            '</div>' +
            '<div class="flex gap-3">' +
              '<input type="text" id="searchQueryInput" class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm" placeholder="' + t('codexlens.searchPlaceholder') + '" />' +
              '<button class="btn-sm btn-primary" id="runSearchBtn"><i data-lucide="search" class="w-3.5 h-3.5"></i> ' + t('codexlens.runSearch') + '</button>' +
            '</div>' +
            '<div id="searchResults" class="hidden">' +
              '<div class="flex items-center justify-between mb-2">' +
                '<span class="text-sm font-medium">' + t('codexlens.results') + ':</span>' +
                '<span id="searchResultCount" class="text-xs text-muted-foreground"></span>' +
              '</div>' +
              '<pre id="searchResultContent" class="bg-muted/50 border border-border p-3 rounded-lg text-xs overflow-auto max-h-64 font-mono"></pre>' +
            '</div>' +
          '</div>' +
        '</div>'

      : // Not installed: Show install prompt
        '<div class="bg-card border border-border rounded-lg p-8">' +
          '<div class="text-center max-w-md mx-auto">' +
            '<div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">' +
              '<i data-lucide="database" class="w-8 h-8 text-primary"></i>' +
            '</div>' +
            '<h3 class="text-lg font-semibold mb-2">' + t('codexlens.installCodexLens') + '</h3>' +
            '<p class="text-sm text-muted-foreground mb-6">' + t('codexlens.installFirst') + '</p>' +
            '<button class="btn btn-primary" onclick="installCodexLensFromManager()">' +
              '<i data-lucide="download" class="w-4 h-4"></i> ' + t('codexlens.installCodexLens') +
            '</button>' +
          '</div>' +
        '</div>'
    ) +
  '</div>';
}

/**
 * Build model select options for the page
 */
function buildModelSelectOptionsForPage() {
  var installedModels = window.cliToolsStatus?.codexlens?.installedModels || [];
  var allModels = window.cliToolsStatus?.codexlens?.allModels || [];

  if (allModels.length === 0) {
    // Fallback to default models if not loaded
    return '<option value="code">code (default)</option>' +
           '<option value="fast">fast</option>';
  }

  var options = '';
  allModels.forEach(function(model) {
    var isInstalled = model.installed || installedModels.includes(model.profile);
    var label = model.profile + (isInstalled ? ' ✓' : '');
    var selected = model.profile === 'code' ? ' selected' : '';
    options += '<option value="' + model.profile + '"' + selected + '>' + label + '</option>';
  });
  return options;
}

/**
 * Validate concurrency input value (min 1, no max limit)
 */
function validateConcurrencyInput(input) {
  var value = parseInt(input.value, 10);
  if (isNaN(value) || value < 1) {
    input.value = 1;
  }
}

/**
 * Handle embedding backend change
 */
function onEmbeddingBackendChange() {
  var backendSelect = document.getElementById('pageBackendSelect');
  var modelSelect = document.getElementById('pageModelSelect');
  var concurrencySelector = document.getElementById('concurrencySelector');
  var rotationSection = document.getElementById('rotationSection');
  if (!backendSelect || !modelSelect) {
    console.warn('[CodexLens] Backend or model select not found');
    return;
  }

  var backend = backendSelect.value;
  console.log('[CodexLens] Backend changed to:', backend);
  console.log('[CodexLens] Current litellmApiConfig:', window.litellmApiConfig);

  if (backend === 'litellm') {
    // Load LiteLLM embedding models
    console.log('[CodexLens] Building LiteLLM model options...');
    var options = buildLiteLLMModelOptions();
    console.log('[CodexLens] Built options HTML:', options);
    modelSelect.innerHTML = options;
    // Show concurrency selector for API backend
    if (concurrencySelector) {
      concurrencySelector.classList.remove('hidden');
    }
    // Show rotation section and load status
    if (rotationSection) {
      rotationSection.classList.remove('hidden');
      loadRotationStatus();
    }
  } else {
    // Load local fastembed models
    modelSelect.innerHTML = buildModelSelectOptionsForPage();
    // Hide concurrency selector for local backend
    if (concurrencySelector) {
      concurrencySelector.classList.add('hidden');
    }
    // Hide rotation section for local backend
    if (rotationSection) {
      rotationSection.classList.add('hidden');
    }
  }
}

/**
 * Build LiteLLM model options from config
 */
function buildLiteLLMModelOptions() {
  var litellmConfig = window.litellmApiConfig || {};
  console.log('[CodexLens] litellmApiConfig:', litellmConfig);

  var providers = litellmConfig.providers || [];
  console.log('[CodexLens] providers count:', providers.length);

  var options = '';

  providers.forEach(function(provider) {
    console.log('[CodexLens] Processing provider:', provider.id, 'enabled:', provider.enabled);
    if (!provider.enabled) return;

    // Check embeddingModels array (config structure)
    var models = provider.embeddingModels || provider.models || [];
    console.log('[CodexLens] Provider', provider.id, 'embeddingModels:', models.length, models);

    models.forEach(function(model) {
      console.log('[CodexLens] Processing model:', model.id, 'type:', model.type, 'enabled:', model.enabled);
      // Accept embedding type or models from embeddingModels array
      if (model.type && model.type !== 'embedding') return;
      if (!model.enabled) return;
      var label = model.name || model.id;
      var providerName = provider.name || provider.id;
      var selected = options === '' ? ' selected' : '';
      options += '<option value="' + model.id + '"' + selected + '>' + label + ' (' + providerName + ')</option>';
      console.log('[CodexLens] Added option:', label, 'from', providerName);
    });
  });

  if (options === '') {
    console.warn('[CodexLens] No embedding models found in LiteLLM config');
    options = '<option value="" disabled selected>' + (t('codexlens.noApiModels') || 'No API embedding models configured') + '</option>';
  }

  return options;
}

// Make functions globally accessible
window.onEmbeddingBackendChange = onEmbeddingBackendChange;

/**
 * Initialize index from page - uses env-based config
 * Model/backend configured in Environment Variables section
 */
function initCodexLensIndexFromPage(indexType) {
  // For FTS-only index, no embedding config needed
  if (indexType === 'normal') {
    initCodexLensIndex(indexType);
  } else {
    // Use litellm backend with env-configured model (default 4 workers)
    // The CLI will read EMBEDDING_MODEL/LITELLM_MODEL from env
    initCodexLensIndex(indexType, null, 'litellm', 4);
  }
}

// ============================================================
// INDEX OPERATIONS - 4 Button Functions
// ============================================================

/**
 * Run FTS full index (rebuild full-text search index)
 * Creates FTS index without embeddings
 */
window.runFtsFullIndex = async function runFtsFullIndex() {
  showRefreshToast(t('codexlens.startingFtsFullIndex') || 'Starting FTS full index...', 'info');
  // FTS only, no embeddings, full rebuild (incremental=false)
  initCodexLensIndex('normal', null, 'fastembed', 1, false);
}

/**
 * Run FTS incremental update
 * Updates FTS index for changed files only
 */
window.runFtsIncrementalUpdate = async function runFtsIncrementalUpdate() {
  var projectPath = window.CCW_PROJECT_ROOT || '.';
  showRefreshToast(t('codexlens.startingFtsIncremental') || 'Starting FTS incremental update...', 'info');

  try {
    // Use index update endpoint for FTS incremental
    var response = await fetch('/api/codexlens/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: projectPath,
        indexType: 'normal',  // FTS only
        incremental: true
      })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.ftsIncrementalComplete') || 'FTS incremental update completed', 'success');
      renderCodexLensManager();
    } else {
      showRefreshToast((t('codexlens.ftsIncrementalFailed') || 'FTS incremental failed') + ': ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
  }
}

/**
 * Run Vector full index (generate all embeddings)
 * Generates embeddings for all files
 */
window.runVectorFullIndex = async function runVectorFullIndex() {
  showRefreshToast(t('codexlens.startingVectorFullIndex') || 'Starting Vector full index...', 'info');
  
  try {
    // Fetch env settings to get the configured embedding model
    var envResponse = await fetch('/api/codexlens/env');
    var envData = await envResponse.json();
    var embeddingModel = envData.CODEXLENS_EMBEDDING_MODEL || envData.LITELLM_EMBEDDING_MODEL || 'code';
    
    // Use litellm backend with env-configured model, full rebuild (incremental=false)
    initCodexLensIndex('vector', embeddingModel, 'litellm', 4, false);
  } catch (err) {
    // Fallback to default model if env fetch fails
    initCodexLensIndex('vector', 'code', 'litellm', 4, false);
  }
}

/**
 * Run Vector incremental update
 * Generates embeddings for new/changed files only
 */
window.runVectorIncrementalUpdate = async function runVectorIncrementalUpdate() {
  var projectPath = window.CCW_PROJECT_ROOT || '.';
  showRefreshToast(t('codexlens.startingVectorIncremental') || 'Starting Vector incremental update...', 'info');

  try {
    // Fetch env settings to get the configured embedding model
    var envResponse = await fetch('/api/codexlens/env');
    var envData = await envResponse.json();
    var embeddingModel = envData.CODEXLENS_EMBEDDING_MODEL || envData.LITELLM_EMBEDDING_MODEL || null;

    // Use embeddings endpoint for vector incremental
    var requestBody = {
      path: projectPath,
      incremental: true,  // Only new/changed files
      backend: 'litellm',
      maxWorkers: 4
    };

    // Add model if configured in env
    if (embeddingModel) {
      requestBody.model = embeddingModel;
    }

    var response = await fetch('/api/codexlens/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    var result = await response.json();

    if (result.success) {
      var stats = result.result || {};
      var msg = (t('codexlens.vectorIncrementalComplete') || 'Vector incremental completed') +
        (stats.chunks_created ? ': ' + stats.chunks_created + ' chunks' : '');
      showRefreshToast(msg, 'success');
      renderCodexLensManager();
    } else {
      showRefreshToast((t('codexlens.vectorIncrementalFailed') || 'Vector incremental failed') + ': ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
  }
}

/**
 * Run incremental update on the current workspace index
 */
window.runIncrementalUpdate = async function runIncrementalUpdate() {
  var projectPath = window.CCW_PROJECT_ROOT || '.';

  showRefreshToast('Starting incremental update...', 'info');

  try {
    var response = await fetch('/api/codexlens/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath })
    });
    var result = await response.json();

    if (result.success) {
      showRefreshToast('Incremental update completed', 'success');
    } else {
      showRefreshToast('Update failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showRefreshToast('Update error: ' + err.message, 'error');
  }
}

/**
 * Toggle file watcher (watchdog) on/off
 */
window.toggleWatcher = async function toggleWatcher() {
  console.log('[CodexLens] toggleWatcher called');
  // Debug: uncomment to test if function is called
  // alert('toggleWatcher called!');
  var projectPath = window.CCW_PROJECT_ROOT || '.';
  console.log('[CodexLens] Project path:', projectPath);

  // Check current status first
  try {
    console.log('[CodexLens] Checking watcher status...');
    // Pass path parameter to get specific watcher status
    var statusResponse = await fetch('/api/codexlens/watch/status?path=' + encodeURIComponent(projectPath));
    var statusResult = await statusResponse.json();
    console.log('[CodexLens] Status result:', statusResult);

    // Handle both single watcher response and array response
    var isRunning = false;
    if (statusResult.success) {
      if (typeof statusResult.running === 'boolean') {
        isRunning = statusResult.running;
      } else if (statusResult.watchers && Array.isArray(statusResult.watchers)) {
        var normalizedPath = projectPath.toLowerCase().replace(/\\/g, '/');
        var matchingWatcher = statusResult.watchers.find(function(w) {
          var watcherPath = (w.root_path || '').toLowerCase().replace(/\\/g, '/');
          return watcherPath === normalizedPath || watcherPath.includes(normalizedPath) || normalizedPath.includes(watcherPath);
        });
        isRunning = matchingWatcher ? matchingWatcher.running : false;
      }
    }

    // Toggle: if running, stop; if stopped, start
    var action = isRunning ? 'stop' : 'start';
    console.log('[CodexLens] Action:', action);

    var response = await fetch('/api/codexlens/watch/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath })
    });
    var result = await response.json();
    console.log('[CodexLens] Action result:', result);

    if (result.success) {
      var newRunning = action === 'start';
      updateWatcherUI(newRunning);
      showRefreshToast('File watcher ' + (newRunning ? 'started' : 'stopped'), 'success');
    } else {
      showRefreshToast('Watcher ' + action + ' failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    console.error('[CodexLens] Watcher error:', err);
    showRefreshToast('Watcher error: ' + err.message, 'error');
  }
}

/**
 * Update watcher UI state
 */
function updateWatcherUI(running, stats) {
  var statusBadge = document.getElementById('watcherStatusBadge');
  if (statusBadge) {
    var badgeClass = running ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground';
    var badgeText = running ? 'Running' : 'Stopped';
    var iconName = running ? 'pause' : 'play';

    statusBadge.innerHTML =
      '<span class="text-xs px-2 py-0.5 rounded-full ' + badgeClass + '">' + badgeText + '</span>' +
      '<button class="btn-sm btn-outline" onclick="toggleWatcher()" id="watcherToggleBtn">' +
        '<i data-lucide="' + iconName + '" class="w-3.5 h-3.5"></i>' +
      '</button>';

    if (window.lucide) lucide.createIcons();
  }

  // Update stats if provided
  if (stats) {
    var filesCount = document.getElementById('watcherFilesCount');
    var changesCount = document.getElementById('watcherChangesCount');
    var uptimeDisplay = document.getElementById('watcherUptimeDisplay');

    if (filesCount) filesCount.textContent = stats.files_watched || '-';
    // Support both changes_detected and events_processed
    if (changesCount) changesCount.textContent = stats.events_processed || stats.changes_detected || '0';
    if (uptimeDisplay) uptimeDisplay.textContent = formatUptime(stats.uptime_seconds);
  }

  // Start or stop polling based on running state
  if (running) {
    startWatcherPolling();
  } else {
    stopWatcherPolling();
  }
}

// Watcher polling interval
var watcherPollInterval = null;
var watcherStartTime = null;
var watcherChangesCount = 0;

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '-';
  if (seconds < 60) return Math.floor(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  var hours = Math.floor(seconds / 3600);
  var mins = Math.floor((seconds % 3600) / 60);
  return hours + 'h ' + mins + 'm';
}

/**
 * Start polling watcher status
 */
function startWatcherPolling() {
  if (watcherPollInterval) return; // Already polling

  watcherStartTime = Date.now();
  var projectPath = window.CCW_PROJECT_ROOT || '.';

  watcherPollInterval = setInterval(async function() {
    try {
      // Must include path parameter to get specific watcher status
      var response = await fetch('/api/codexlens/watch/status?path=' + encodeURIComponent(projectPath));
      var result = await response.json();

      if (result.success && result.running) {
        // Update uptime from server response
        var uptimeDisplay = document.getElementById('watcherUptimeDisplay');
        if (uptimeDisplay && result.uptime_seconds !== undefined) {
          uptimeDisplay.textContent = formatUptime(result.uptime_seconds);
        }

        // Update changes count from events_processed
        if (result.events_processed !== undefined) {
          var changesCount = document.getElementById('watcherChangesCount');
          if (changesCount) changesCount.textContent = result.events_processed;
        }

        // Update files count if available
        if (result.files_watched !== undefined) {
          var filesCount = document.getElementById('watcherFilesCount');
          if (filesCount) filesCount.textContent = result.files_watched;
        }

        // Check for new events
        if (result.recent_events && result.recent_events.length > 0) {
          result.recent_events.forEach(function(event) {
            addWatcherLogEntry(event.type, event.path);
          });
        }
      } else if (result.success && result.running === false) {
        // Watcher stopped externally (only if running is explicitly false)
        updateWatcherUI(false);
        stopWatcherPolling();
      }
    } catch (err) {
      console.warn('[Watcher] Poll error:', err);
    }
  }, 3000); // Poll every 3 seconds
}

/**
 * Stop polling watcher status
 */
function stopWatcherPolling() {
  if (watcherPollInterval) {
    clearInterval(watcherPollInterval);
    watcherPollInterval = null;
  }
  watcherStartTime = null;
}

/**
 * Add entry to watcher activity log
 */
function addWatcherLogEntry(type, path) {
  var logContainer = document.getElementById('watcherActivityLog');
  if (!logContainer) return;

  // Clear "no activity" message if present
  var noActivity = logContainer.querySelector('.text-muted-foreground:only-child');
  if (noActivity && noActivity.textContent.includes('No activity')) {
    logContainer.innerHTML = '';
  }

  // Increment changes count
  watcherChangesCount++;
  var changesCount = document.getElementById('watcherChangesCount');
  if (changesCount) changesCount.textContent = watcherChangesCount;

  // Create log entry
  var timestamp = new Date().toLocaleTimeString();
  var typeColors = {
    'created': 'text-success',
    'modified': 'text-warning',
    'deleted': 'text-destructive',
    'renamed': 'text-primary',
    'indexed': 'text-success'
  };
  var typeIcons = {
    'created': '+',
    'modified': '~',
    'deleted': '-',
    'renamed': '→',
    'indexed': '✓'
  };

  var colorClass = typeColors[type] || 'text-muted-foreground';
  var icon = typeIcons[type] || '•';

  // Get just the filename
  var filename = path.split(/[/\\]/).pop();

  var entry = document.createElement('div');
  entry.className = 'flex items-center gap-2 py-0.5';
  entry.innerHTML =
    '<span class="text-muted-foreground">' + timestamp + '</span>' +
    '<span class="' + colorClass + ' font-bold">' + icon + '</span>' +
    '<span class="truncate" title="' + escapeHtml(path) + '">' + escapeHtml(filename) + '</span>';

  // Add to top of log
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

/**
 * Clear watcher activity log
 */
function clearWatcherLog() {
  var logContainer = document.getElementById('watcherActivityLog');
  if (logContainer) {
    logContainer.innerHTML = '<div class="text-muted-foreground">Log cleared. Waiting for file changes...</div>';
  }
  watcherChangesCount = 0;
  var changesCount = document.getElementById('watcherChangesCount');
  if (changesCount) changesCount.textContent = '0';
}

/**
 * Initialize watcher status on page load
 */
async function initWatcherStatus() {
  try {
    var projectPath = window.CCW_PROJECT_ROOT || '.';
    // Pass path parameter to get specific watcher status
    var response = await fetch('/api/codexlens/watch/status?path=' + encodeURIComponent(projectPath));
    var result = await response.json();
    if (result.success) {
      // Handle both single watcher response (with path param) and array response (without path param)
      var running = result.running;
      var uptime = result.uptime_seconds || 0;
      var filesWatched = result.files_watched;

      // If response has watchers array (no path param), find matching watcher
      if (result.watchers && Array.isArray(result.watchers)) {
        var normalizedPath = projectPath.toLowerCase().replace(/\\/g, '/');
        var matchingWatcher = result.watchers.find(function(w) {
          var watcherPath = (w.root_path || '').toLowerCase().replace(/\\/g, '/');
          return watcherPath === normalizedPath || watcherPath.includes(normalizedPath) || normalizedPath.includes(watcherPath);
        });
        if (matchingWatcher) {
          running = matchingWatcher.running;
          uptime = matchingWatcher.uptime_seconds || 0;
        } else {
          running = false;
        }
      }

      updateWatcherUI(running, {
        files_watched: filesWatched,
        changes_detected: 0,
        uptime_seconds: uptime
      });
    }
  } catch (err) {
    console.warn('[Watcher] Failed to get initial status:', err);
  }
}

// Make functions globally accessible
window.runIncrementalUpdate = runIncrementalUpdate;
window.toggleWatcher = toggleWatcher;
window.updateWatcherUI = updateWatcherUI;
window.addWatcherLogEntry = addWatcherLogEntry;
window.clearWatcherLog = clearWatcherLog;
window.initWatcherStatus = initWatcherStatus;

/**
 * Initialize CodexLens Manager page event handlers
 */
function initCodexLensManagerPageEvents(currentConfig) {
  var saveBtn = document.getElementById('saveIndexPathBtn');
  if (saveBtn) {
    saveBtn.onclick = async function() {
      var indexDirInput = document.getElementById('indexDirInput');
      var newIndexDir = indexDirInput ? indexDirInput.value.trim() : '';
      if (!newIndexDir) { showRefreshToast(t('codexlens.pathEmpty'), 'error'); return; }
      if (newIndexDir === currentConfig.index_dir) { showRefreshToast(t('codexlens.pathUnchanged'), 'info'); return; }
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="animate-pulse">' + t('common.saving') + '</span>';
      try {
        var response = await fetch('/api/codexlens/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index_dir: newIndexDir }) });
        var result = await response.json();
        if (result.success) { showRefreshToast(t('codexlens.configSaved'), 'success'); renderCodexLensManager(); }
        else { showRefreshToast(t('common.saveFailed') + ': ' + result.error, 'error'); }
      } catch (err) { showRefreshToast(t('common.error') + ': ' + err.message, 'error'); }
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="save" class="w-3.5 h-3.5"></i> ' + t('codexlens.saveConfig');
      if (window.lucide) lucide.createIcons();
    };
  }

  var runSearchBtn = document.getElementById('runSearchBtn');
  if (runSearchBtn) {
    runSearchBtn.onclick = async function() {
      var searchType = document.getElementById('searchTypeSelect').value;
      var searchMode = document.getElementById('searchModeSelect').value;
      var query = document.getElementById('searchQueryInput').value.trim();
      var resultsDiv = document.getElementById('searchResults');
      var resultCount = document.getElementById('searchResultCount');
      var resultContent = document.getElementById('searchResultContent');
      if (!query) { showRefreshToast(t('codexlens.enterQuery'), 'warning'); return; }
      runSearchBtn.disabled = true;
      runSearchBtn.innerHTML = '<span class="animate-pulse">' + t('codexlens.searching') + '</span>';
      resultsDiv.classList.add('hidden');
      try {
        var endpoint = '/api/codexlens/' + searchType;
        var params = new URLSearchParams({ query: query, limit: '20' });
        if (searchType === 'search' || searchType === 'search_files') { params.append('mode', searchMode); }
        var response = await fetch(endpoint + '?' + params.toString());
        var result = await response.json();
        if (result.success) {
          var results = result.results || result.files || [];
          resultCount.textContent = results.length + ' ' + t('codexlens.resultsCount');
          resultContent.textContent = JSON.stringify(results, null, 2);
          resultsDiv.classList.remove('hidden');
        } else {
          resultContent.textContent = t('common.error') + ': ' + (result.error || t('common.unknownError'));
          resultsDiv.classList.remove('hidden');
        }
      } catch (err) {
        resultContent.textContent = t('common.exception') + ': ' + err.message;
        resultsDiv.classList.remove('hidden');
      }
      runSearchBtn.disabled = false;
      runSearchBtn.innerHTML = '<i data-lucide="search" class="w-3.5 h-3.5"></i> ' + t('codexlens.runSearch');
      if (window.lucide) lucide.createIcons();
    };
  }

  var searchInput = document.getElementById('searchQueryInput');
  if (searchInput) { searchInput.onkeypress = function(e) { if (e.key === 'Enter' && runSearchBtn) { runSearchBtn.click(); } }; }
}

/**
 * Show index initialization modal
 */
function showIndexInitModal() {
  // Use initCodexLensIndex with default settings
  initCodexLensIndex('vector', 'code');
}

/**
 * Load index stats for the CodexLens Manager page
 */
async function loadIndexStatsForPage() {
  try {
    var response = await fetch('/api/codexlens/indexes');
    if (!response.ok) throw new Error('Failed to load index stats');
    var data = await response.json();
    renderIndexStatsForPage(data);
  } catch (err) {
    console.error('[CodexLens] Failed to load index stats:', err);
    var tbody = document.getElementById('indexTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-destructive text-sm">' + escapeHtml(err.message) + '</td></tr>';
    }
  }
}

/**
 * Render index stats in the CodexLens Manager page
 */
function renderIndexStatsForPage(data) {
  var summary = data.summary || {};
  var indexes = data.indexes || [];
  var indexDir = data.indexDir || '';

  // Update summary stats
  var totalSizeEl = document.getElementById('indexTotalSize');
  var projectCountEl = document.getElementById('indexProjectCount');
  var totalSizeValEl = document.getElementById('indexTotalSizeVal');
  var vectorCountEl = document.getElementById('indexVectorCount');
  var ftsCountEl = document.getElementById('indexFtsCount');
  var indexDirEl = document.getElementById('indexDirDisplay');

  if (totalSizeEl) totalSizeEl.textContent = summary.totalSizeFormatted || '0 B';
  if (projectCountEl) projectCountEl.textContent = summary.totalProjects || 0;
  if (totalSizeValEl) totalSizeValEl.textContent = summary.totalSizeFormatted || '0 B';
  if (vectorCountEl) vectorCountEl.textContent = summary.vectorIndexCount || 0;
  if (ftsCountEl) ftsCountEl.textContent = summary.normalIndexCount || 0;
  if (indexDirEl && indexDir) {
    indexDirEl.textContent = indexDir;
    indexDirEl.title = indexDir;
  }

  // Render table rows
  var tbody = document.getElementById('indexTableBody');
  if (!tbody) return;

  if (indexes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-muted-foreground text-sm">' + (t('index.noIndexes') || 'No indexes yet') + '</td></tr>';
    return;
  }

  var rows = '';
  indexes.forEach(function(idx) {
    var vectorBadge = idx.hasVectorIndex
      ? '<span class="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">' + (t('index.vector') || 'Vector') + '</span>'
      : '';
    var normalBadge = idx.hasNormalIndex
      ? '<span class="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded">' + (t('index.fts') || 'FTS') + '</span>'
      : '';

    rows += '<tr class="border-t border-border hover:bg-muted/30 transition-colors">' +
      '<td class="py-2 px-2 text-foreground">' +
        '<span class="font-mono text-xs truncate max-w-[250px] inline-block" title="' + escapeHtml(idx.id) + '">' + escapeHtml(idx.id) + '</span>' +
      '</td>' +
      '<td class="py-2 px-2 text-right text-muted-foreground">' + (idx.sizeFormatted || '-') + '</td>' +
      '<td class="py-2 px-2 text-center"><div class="flex items-center justify-center gap-1">' + vectorBadge + normalBadge + '</div></td>' +
      '<td class="py-2 px-2 text-right text-muted-foreground">' + formatTimeAgoSimple(idx.lastModified) + '</td>' +
      '<td class="py-2 px-1 text-center">' +
        '<button onclick="cleanIndexProjectFromPage(\'' + escapeHtml(idx.id) + '\')" ' +
          'class="text-destructive/70 hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors" ' +
          'title="' + (t('index.cleanProject') || 'Clean Index') + '">' +
          '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = rows;
  if (window.lucide) lucide.createIcons();
}

/**
 * Simple time ago formatter
 */
function formatTimeAgoSimple(isoString) {
  if (!isoString) return t('common.never') || 'Never';
  var date = new Date(isoString);
  var now = new Date();
  var diffMs = now - date;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMins / 60);
  var diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return t('common.justNow') || 'Just now';
  if (diffMins < 60) return diffMins + 'm ' + (t('common.ago') || 'ago');
  if (diffHours < 24) return diffHours + 'h ' + (t('common.ago') || 'ago');
  if (diffDays < 30) return diffDays + 'd ' + (t('common.ago') || 'ago');
  return date.toLocaleDateString();
}

/**
 * Check and display index health for current workspace
 */
async function checkIndexHealth() {
  var healthBadge = document.getElementById('indexHealthBadge');
  var healthDetails = document.getElementById('indexHealthDetails');
  var lastUpdateEl = document.getElementById('indexLastUpdate');
  var commitsSinceEl = document.getElementById('indexCommitsSince');

  if (!healthBadge) return;

  try {
    // Get current workspace index info
    var indexResponse = await fetch('/api/codexlens/indexes');
    var indexData = await indexResponse.json();
    var indexes = indexData.indexes || [];

    // Find current workspace index (newest one or matching current path)
    var currentIndex = indexes.length > 0 ? indexes[0] : null;

    if (!currentIndex) {
      healthBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground';
      healthBadge.textContent = 'No Index';
      if (healthDetails) healthDetails.classList.add('hidden');
      return;
    }

    var lastIndexTime = currentIndex.lastModified ? new Date(currentIndex.lastModified) : null;

    // Estimate staleness based on time (git API not available)
    var commitsSince = 0;
    if (lastIndexTime) {
      var hoursSince = (Date.now() - lastIndexTime.getTime()) / (1000 * 60 * 60);
      // Rough estimate: assume ~2 commits per hour on active projects
      commitsSince = Math.floor(hoursSince / 2);
    }

    // Determine health status
    var healthStatus = 'good';
    var healthText = 'Up to date';
    var healthClass = 'bg-success/20 text-success';

    if (commitsSince > 50 || (lastIndexTime && (Date.now() - lastIndexTime.getTime()) > 7 * 24 * 60 * 60 * 1000)) {
      // More than 50 commits or 7 days old
      healthStatus = 'outdated';
      healthText = 'Outdated';
      healthClass = 'bg-destructive/20 text-destructive';
    } else if (commitsSince > 10 || (lastIndexTime && (Date.now() - lastIndexTime.getTime()) > 24 * 60 * 60 * 1000)) {
      // More than 10 commits or 1 day old
      healthStatus = 'stale';
      healthText = 'Stale';
      healthClass = 'bg-warning/20 text-warning';
    }

    // Update badge
    healthBadge.className = 'text-xs px-2 py-0.5 rounded-full ' + healthClass;
    healthBadge.textContent = healthText;

    // Update details section
    if (healthDetails && healthStatus !== 'good') {
      healthDetails.classList.remove('hidden');
      if (lastUpdateEl) lastUpdateEl.textContent = lastIndexTime ? formatTimeAgoSimple(currentIndex.lastModified) : 'Unknown';
      if (commitsSinceEl) {
        commitsSinceEl.textContent = commitsSince;
        commitsSinceEl.className = 'font-medium ' + (commitsSince > 20 ? 'text-destructive' : commitsSince > 5 ? 'text-warning' : 'text-foreground');
      }
    } else if (healthDetails) {
      healthDetails.classList.add('hidden');
    }

  } catch (err) {
    console.error('[CodexLens] Failed to check index health:', err);
    healthBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground';
    healthBadge.textContent = 'Unknown';
  }
}

// Make function globally accessible
window.checkIndexHealth = checkIndexHealth;

/**
 * Clean a specific project's index from the page
 */
async function cleanIndexProjectFromPage(projectId) {
  if (!confirm((t('index.cleanProjectConfirm') || 'Clean index for') + ' ' + projectId + '?')) {
    return;
  }

  try {
    showRefreshToast(t('index.cleaning') || 'Cleaning index...', 'info');

    var response = await fetch('/api/codexlens/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projectId })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('index.cleanSuccess') || 'Index cleaned successfully', 'success');
      await loadIndexStatsForPage();
    } else {
      showRefreshToast((t('index.cleanFailed') || 'Clean failed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
  }
}

/**
 * Clean all indexes from the page
 */
async function cleanAllIndexesFromPage() {
  if (!confirm(t('index.cleanAllConfirm') || 'Are you sure you want to clean ALL indexes? This cannot be undone.')) {
    return;
  }

  try {
    showRefreshToast(t('index.cleaning') || 'Cleaning indexes...', 'info');

    var response = await fetch('/api/codexlens/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('index.cleanAllSuccess') || 'All indexes cleaned', 'success');
      await loadIndexStatsForPage();
    } else {
      showRefreshToast((t('index.cleanFailed') || 'Clean failed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast((t('common.error') || 'Error') + ': ' + err.message, 'error');
  }
}

// ============================================================
// MULTI-PROVIDER ROTATION CONFIGURATION
// ============================================================

/**
 * Load and display rotation status in the page
 */
async function loadRotationStatus() {
  try {
    // Load from unified embedding-pool API (handles both new and legacy config)
    var response = await fetch('/api/litellm-api/embedding-pool');
    if (!response.ok) {
      console.warn('[CodexLens] Failed to load embedding pool config:', response.status);
      return;
    }
    var data = await response.json();
    window.embeddingPoolConfig = data.poolConfig;
    window.embeddingPoolAvailableModels = data.availableModels || [];

    // Also get endpoint count
    var endpointsResponse = await fetch('/api/litellm-api/codexlens/rotation/endpoints');
    var endpointsData = endpointsResponse.ok ? await endpointsResponse.json() : { count: 0 };

    updateRotationStatusDisplay(data.poolConfig, endpointsData.count);
  } catch (err) {
    console.error('[CodexLens] Error loading rotation status:', err);
  }
}

/**
 * Update the rotation status display in the page
 * @param {Object} poolConfig - The embedding pool configuration
 * @param {number} endpointCount - Number of active endpoints
 */
function updateRotationStatusDisplay(poolConfig, endpointCount) {
  var badge = document.getElementById('rotationStatusBadge');
  var detailsEl = document.getElementById('rotationDetails');
  var modelNameEl = document.getElementById('rotationModelName');
  var countEl = document.getElementById('rotationEndpointCount');

  if (!badge) return;

  if (poolConfig && poolConfig.enabled) {
    badge.textContent = t('common.enabled');
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-success/10 text-success';

    // Show details
    if (detailsEl) {
      detailsEl.classList.remove('hidden');
      if (modelNameEl) modelNameEl.textContent = poolConfig.targetModel || '';
      if (countEl) countEl.textContent = (endpointCount || 0) + ' ' + t('codexlens.totalEndpoints').toLowerCase();
    }
  } else {
    badge.textContent = t('common.disabled');
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground';
    if (detailsEl) detailsEl.classList.add('hidden');
  }
}

/**
 * Navigate to API Settings Embedding Pool tab
 */
function navigateToApiSettingsEmbeddingPool() {
  // Navigate to API Settings page with embedding-pool tab
  if (typeof switchView === 'function') {
    switchView('api-settings');
    // Give time for page to render, then switch to embedding-pool tab
    setTimeout(function() {
      if (typeof switchSidebarTab === 'function') {
        switchSidebarTab('embedding-pool');
      }
    }, 100);
  }
}

/**
 * Show the rotation configuration modal
 */
async function showRotationConfigModal() {
  try {
    // Load current config if not already loaded
    if (!window.rotationConfig) {
      await loadRotationStatus();
    }

    var rotationConfig = window.rotationConfig || {
      enabled: false,
      strategy: 'round_robin',
      defaultCooldown: 60,
      targetModel: 'qwen3-embedding',
      providers: []
    };
    var availableProviders = window.availableRotationProviders || [];

    var modalHtml = buildRotationConfigModal(rotationConfig, availableProviders);

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = modalHtml;
    var modal = tempContainer.firstElementChild;
    document.body.appendChild(modal);

    if (window.lucide) lucide.createIcons();
    initRotationConfigEvents(rotationConfig, availableProviders);
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Build the rotation configuration modal HTML
 */
function buildRotationConfigModal(rotationConfig, availableProviders) {
  var isEnabled = rotationConfig.enabled || false;
  var strategy = rotationConfig.strategy || 'round_robin';
  var cooldown = rotationConfig.defaultCooldown || 60;
  var targetModel = rotationConfig.targetModel || 'qwen3-embedding';
  var configuredProviders = rotationConfig.providers || [];

  // Build provider list HTML
  var providerListHtml = '';
  if (availableProviders.length === 0) {
    providerListHtml = '<div class="text-sm text-muted-foreground py-4 text-center">' + t('codexlens.noRotationProviders') + '</div>';
  } else {
    availableProviders.forEach(function(provider, index) {
      // Find if this provider is already configured
      var configured = configuredProviders.find(function(p) { return p.providerId === provider.providerId; });
      var isProviderEnabled = configured ? configured.enabled : false;
      var weight = configured ? configured.weight : 1;
      var maxConcurrent = configured ? configured.maxConcurrentPerKey : 4;
      var useAllKeys = configured ? configured.useAllKeys : true;

      // Get model options
      var modelOptions = provider.embeddingModels.map(function(m) {
        var selected = configured && configured.modelId === m.modelId ? 'selected' : '';
        return '<option value="' + m.modelId + '" ' + selected + '>' + m.modelName + ' (' + m.dimensions + 'd)</option>';
      }).join('');

      // Get key count
      var keyCount = provider.apiKeys.filter(function(k) { return k.enabled; }).length;

      providerListHtml +=
        '<div class="border border-border rounded-lg p-3 ' + (isProviderEnabled ? 'bg-success/5 border-success/30' : 'bg-muted/30') + '" data-provider-id="' + provider.providerId + '">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<div class="flex items-center gap-2">' +
              '<input type="checkbox" id="rotationProvider_' + index + '" ' + (isProviderEnabled ? 'checked' : '') +
                ' class="rotation-provider-toggle" data-provider-id="' + provider.providerId + '" />' +
              '<label for="rotationProvider_' + index + '" class="font-medium text-sm">' + provider.providerName + '</label>' +
              '<span class="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">' + keyCount + ' keys</span>' +
            '</div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-2 text-xs">' +
            '<div>' +
              '<label class="text-muted-foreground">Model</label>' +
              '<select class="w-full px-2 py-1 border border-border rounded bg-background text-sm rotation-model-select" data-provider-id="' + provider.providerId + '">' +
                modelOptions +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="text-muted-foreground">' + t('codexlens.providerWeight') + '</label>' +
              '<input type="number" min="0.1" max="10" step="0.1" value="' + weight + '" ' +
                'class="w-full px-2 py-1 border border-border rounded bg-background text-sm rotation-weight-input" data-provider-id="' + provider.providerId + '" />' +
            '</div>' +
            '<div>' +
              '<label class="text-muted-foreground">' + t('codexlens.maxConcurrentPerKey') + '</label>' +
              '<input type="number" min="1" max="16" value="' + maxConcurrent + '" ' +
                'class="w-full px-2 py-1 border border-border rounded bg-background text-sm rotation-concurrent-input" data-provider-id="' + provider.providerId + '" />' +
            '</div>' +
            '<div class="flex items-center gap-1">' +
              '<input type="checkbox" id="useAllKeys_' + index + '" ' + (useAllKeys ? 'checked' : '') +
                ' class="rotation-use-all-keys" data-provider-id="' + provider.providerId + '" />' +
              '<label for="useAllKeys_' + index + '" class="text-muted-foreground">' + t('codexlens.useAllKeys') + '</label>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
  }

  return '<div class="modal-backdrop" id="rotationConfigModal">' +
    '<div class="modal-container max-w-2xl">' +
      '<div class="modal-header">' +
        '<div class="flex items-center gap-3">' +
          '<div class="modal-icon">' +
            '<i data-lucide="rotate-cw" class="w-5 h-5"></i>' +
          '</div>' +
          '<div>' +
            '<h2 class="text-lg font-bold">' + t('codexlens.rotation') + '</h2>' +
            '<p class="text-xs text-muted-foreground">' + t('codexlens.rotationDesc') + '</p>' +
          '</div>' +
        '</div>' +
        '<button onclick="closeRotationModal()" class="text-muted-foreground hover:text-foreground">' +
          '<i data-lucide="x" class="w-5 h-5"></i>' +
        '</button>' +
      '</div>' +
      '<div class="modal-body space-y-4">' +
        // Enable toggle
        '<div class="flex items-center justify-between p-3 bg-muted/30 rounded-lg">' +
          '<div class="flex items-center gap-2">' +
            '<i data-lucide="power" class="w-4 h-4 text-primary"></i>' +
            '<span class="font-medium">' + t('codexlens.rotationEnabled') + '</span>' +
          '</div>' +
          '<label class="relative inline-flex items-center cursor-pointer">' +
            '<input type="checkbox" id="rotationEnabledToggle" ' + (isEnabled ? 'checked' : '') + ' class="sr-only peer" />' +
            '<div class="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>' +
          '</label>' +
        '</div>' +
        // Strategy and settings
        '<div class="grid grid-cols-2 gap-4">' +
          '<div>' +
            '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.rotationStrategy') + '</label>' +
            '<select id="rotationStrategy" class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
              '<option value="round_robin" ' + (strategy === 'round_robin' ? 'selected' : '') + '>' + t('codexlens.strategyRoundRobin') + '</option>' +
              '<option value="latency_aware" ' + (strategy === 'latency_aware' ? 'selected' : '') + '>' + t('codexlens.strategyLatencyAware') + '</option>' +
              '<option value="weighted_random" ' + (strategy === 'weighted_random' ? 'selected' : '') + '>' + t('codexlens.strategyWeightedRandom') + '</option>' +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.cooldownSeconds') + '</label>' +
            '<input type="number" id="rotationCooldown" min="1" max="300" value="' + cooldown + '" ' +
              'class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />' +
            '<p class="text-xs text-muted-foreground mt-1">' + t('codexlens.cooldownHint') + '</p>' +
          '</div>' +
        '</div>' +
        // Target model
        '<div>' +
          '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.targetModel') + '</label>' +
          '<input type="text" id="rotationTargetModel" value="' + targetModel + '" ' +
            'class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" placeholder="qwen3-embedding" />' +
          '<p class="text-xs text-muted-foreground mt-1">' + t('codexlens.targetModelHint') + '</p>' +
        '</div>' +
        // Provider list
        '<div>' +
          '<label class="block text-sm font-medium mb-1.5">' + t('codexlens.rotationProviders') + '</label>' +
          '<div class="space-y-2 max-h-64 overflow-y-auto" id="rotationProviderList">' +
            providerListHtml +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button onclick="closeRotationModal()" class="btn btn-outline">' + t('common.cancel') + '</button>' +
        '<button onclick="saveRotationConfig()" class="btn btn-primary">' +
          '<i data-lucide="save" class="w-4 h-4"></i> ' + t('common.save') +
        '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/**
 * Initialize rotation config modal events
 */
function initRotationConfigEvents(rotationConfig, availableProviders) {
  // Store in window for save function
  window._rotationAvailableProviders = availableProviders;
}

/**
 * Close the rotation config modal
 */
function closeRotationModal() {
  var modal = document.getElementById('rotationConfigModal');
  if (modal) modal.remove();
}

/**
 * Save the rotation configuration
 */
async function saveRotationConfig() {
  try {
    var enabledToggle = document.getElementById('rotationEnabledToggle');
    var strategySelect = document.getElementById('rotationStrategy');
    var cooldownInput = document.getElementById('rotationCooldown');
    var targetModelInput = document.getElementById('rotationTargetModel');

    var enabled = enabledToggle ? enabledToggle.checked : false;
    var strategy = strategySelect ? strategySelect.value : 'round_robin';
    var cooldown = cooldownInput ? parseInt(cooldownInput.value, 10) : 60;
    var targetModel = targetModelInput ? targetModelInput.value.trim() : 'qwen3-embedding';

    // Collect provider configurations
    var providers = [];
    var providerToggles = document.querySelectorAll('.rotation-provider-toggle');
    providerToggles.forEach(function(toggle) {
      var providerId = toggle.getAttribute('data-provider-id');
      var isEnabled = toggle.checked;

      var modelSelect = document.querySelector('.rotation-model-select[data-provider-id="' + providerId + '"]');
      var weightInput = document.querySelector('.rotation-weight-input[data-provider-id="' + providerId + '"]');
      var concurrentInput = document.querySelector('.rotation-concurrent-input[data-provider-id="' + providerId + '"]');
      var useAllKeysToggle = document.querySelector('.rotation-use-all-keys[data-provider-id="' + providerId + '"]');

      providers.push({
        providerId: providerId,
        modelId: modelSelect ? modelSelect.value : '',
        weight: weightInput ? parseFloat(weightInput.value) || 1 : 1,
        maxConcurrentPerKey: concurrentInput ? parseInt(concurrentInput.value, 10) || 4 : 4,
        useAllKeys: useAllKeysToggle ? useAllKeysToggle.checked : true,
        enabled: isEnabled
      });
    });

    var rotationConfig = {
      enabled: enabled,
      strategy: strategy,
      defaultCooldown: cooldown,
      targetModel: targetModel,
      providers: providers
    };

    var response = await fetch('/api/litellm-api/codexlens/rotation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rotationConfig)
    });

    var result = await response.json();

    if (result.success) {
      // Show sync result in toast
      var syncMsg = '';
      if (result.syncResult) {
        if (result.syncResult.success) {
          syncMsg = ' (' + result.syncResult.endpointCount + ' ' + t('codexlens.endpointsSynced') + ')';
        } else {
          syncMsg = ' (' + t('codexlens.syncFailed') + ': ' + result.syncResult.message + ')';
        }
      }
      showRefreshToast(t('codexlens.rotationSaved') + syncMsg, 'success');
      window.rotationConfig = rotationConfig;
      updateRotationStatusDisplay(rotationConfig);
      closeRotationModal();
    } else {
      showRefreshToast(t('common.saveFailed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

// ============================================================
// RERANKER CONFIGURATION MODAL
// ============================================================

/**
 * Show Reranker configuration modal
 */
async function showRerankerConfigModal() {
  try {
    showRefreshToast(t('codexlens.loadingRerankerConfig') || 'Loading reranker configuration...', 'info');

    // Fetch current reranker config
    const response = await fetch('/api/codexlens/reranker/config');
    const config = await response.json();

    if (!config.success) {
      showRefreshToast(t('common.error') + ': ' + (config.error || 'Failed to load config'), 'error');
      return;
    }

    const modalHtml = buildRerankerConfigContent(config);

    // Create and show modal
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = modalHtml;
    const modal = tempContainer.firstElementChild;
    document.body.appendChild(modal);

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Initialize event handlers
    initRerankerConfigEvents(config);
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Build Reranker configuration modal content
 */
function buildRerankerConfigContent(config) {
  const backend = config.backend || 'onnx';
  const modelName = config.model_name || '';
  const apiProvider = config.api_provider || 'siliconflow';
  const apiKeySet = config.api_key_set || false;
  const availableBackends = config.available_backends || ['onnx', 'api', 'litellm', 'legacy'];
  const apiProviders = config.api_providers || ['siliconflow', 'cohere', 'jina'];
  const litellmEndpoints = config.litellm_endpoints || [];

  // ONNX models
  const onnxModels = [
    'cross-encoder/ms-marco-MiniLM-L-6-v2',
    'cross-encoder/ms-marco-TinyBERT-L-2-v2',
    'BAAI/bge-reranker-base',
    'BAAI/bge-reranker-large'
  ];

  // Build backend options
  const backendOptions = availableBackends.map(function(b) {
    const labels = {
      'onnx': 'ONNX (Local, Optimum)',
      'api': 'API (SiliconFlow/Cohere/Jina)',
      'litellm': 'LiteLLM (Custom Endpoint)',
      'legacy': 'Legacy (SentenceTransformers)'
    };
    return '<option value="' + b + '" ' + (backend === b ? 'selected' : '') + '>' + (labels[b] || b) + '</option>';
  }).join('');

  // Build API provider options
  const providerOptions = apiProviders.map(function(p) {
    return '<option value="' + p + '" ' + (apiProvider === p ? 'selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
  }).join('');

  // Build ONNX model options
  const onnxModelOptions = onnxModels.map(function(m) {
    return '<option value="' + m + '" ' + (modelName === m ? 'selected' : '') + '>' + m + '</option>';
  }).join('');

  // Build LiteLLM endpoint options
  const litellmOptions = litellmEndpoints.length > 0
    ? litellmEndpoints.map(function(ep) {
        return '<option value="' + ep + '">' + ep + '</option>';
      }).join('')
    : '<option value="" disabled>No endpoints configured</option>';

  return '<div class="modal-backdrop" id="rerankerConfigModal">' +
    '<div class="modal-container max-w-xl">' +
      '<div class="modal-header">' +
        '<div class="flex items-center gap-3">' +
          '<div class="modal-icon">' +
            '<i data-lucide="layers" class="w-5 h-5"></i>' +
          '</div>' +
          '<div>' +
            '<h2 class="text-lg font-bold">' + (t('codexlens.rerankerConfig') || 'Reranker Configuration') + '</h2>' +
            '<p class="text-xs text-muted-foreground">' + (t('codexlens.rerankerConfigDesc') || 'Configure cross-encoder reranking for semantic search') + '</p>' +
          '</div>' +
        '</div>' +
        '<button onclick="closeRerankerModal()" class="text-muted-foreground hover:text-foreground">' +
          '<i data-lucide="x" class="w-5 h-5"></i>' +
        '</button>' +
      '</div>' +

      '<div class="modal-body space-y-4">' +
        // Backend Selection
        '<div class="tool-config-section">' +
          '<h4>' + (t('codexlens.rerankerBackend') || 'Backend') + '</h4>' +
          '<select id="rerankerBackend" class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" onchange="toggleRerankerSections()">' +
            backendOptions +
          '</select>' +
          '<p class="text-xs text-muted-foreground mt-1">' + (t('codexlens.rerankerBackendHint') || 'Select reranking backend based on your needs') + '</p>' +
        '</div>' +

        // ONNX Section (visible when backend=onnx)
        '<div id="rerankerOnnxSection" class="tool-config-section" style="display:' + (backend === 'onnx' ? 'block' : 'none') + '">' +
          '<h4>' + (t('codexlens.onnxModel') || 'ONNX Model') + '</h4>' +
          '<select id="rerankerOnnxModel" class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
            onnxModelOptions +
            '<option value="custom">Custom model...</option>' +
          '</select>' +
          '<input type="text" id="rerankerCustomModel" value="' + (onnxModels.includes(modelName) ? '' : modelName) + '" ' +
            'placeholder="Enter custom model name" ' +
            'class="w-full mt-2 px-3 py-2 border border-border rounded-lg bg-background text-sm" style="display:' + (onnxModels.includes(modelName) ? 'none' : 'block') + '" />' +
        '</div>' +

        // API Section (visible when backend=api)
        '<div id="rerankerApiSection" class="tool-config-section" style="display:' + (backend === 'api' ? 'block' : 'none') + '">' +
          '<h4>' + (t('codexlens.apiConfig') || 'API Configuration') + '</h4>' +
          '<div class="space-y-3">' +
            '<div>' +
              '<label class="block text-sm font-medium mb-1.5">' + (t('codexlens.apiProvider') || 'Provider') + '</label>' +
              '<select id="rerankerApiProvider" class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
                providerOptions +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-sm font-medium mb-1.5">' + (t('codexlens.apiKey') || 'API Key') + '</label>' +
              '<div class="flex items-center gap-2">' +
                '<input type="password" id="rerankerApiKey" placeholder="' + (apiKeySet ? '••••••••' : 'Enter API key') + '" ' +
                  'class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm" />' +
                (apiKeySet ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-success/10 text-success border border-success/20"><i data-lucide="check" class="w-3 h-3"></i>Set</span>' : '') +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-sm font-medium mb-1.5">' + (t('codexlens.modelName') || 'Model Name') + '</label>' +
              '<input type="text" id="rerankerApiModel" value="' + modelName + '" ' +
                'placeholder="e.g., BAAI/bge-reranker-v2-m3" ' +
                'class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />' +
            '</div>' +
          '</div>' +
        '</div>' +

        // LiteLLM Section (visible when backend=litellm)
        '<div id="rerankerLitellmSection" class="tool-config-section" style="display:' + (backend === 'litellm' ? 'block' : 'none') + '">' +
          '<h4>' + (t('codexlens.litellmEndpoint') || 'LiteLLM Endpoint') + '</h4>' +
          '<select id="rerankerLitellmEndpoint" class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">' +
            litellmOptions +
          '</select>' +
          (litellmEndpoints.length === 0
            ? '<p class="text-xs text-warning mt-1">' + (t('codexlens.noEndpointsHint') || 'Configure LiteLLM endpoints in API Settings first') + '</p>'
            : '') +
        '</div>' +

        // Legacy Section (visible when backend=legacy)
        '<div id="rerankerLegacySection" class="tool-config-section" style="display:' + (backend === 'legacy' ? 'block' : 'none') + '">' +
          '<div class="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg p-3">' +
            '<i data-lucide="alert-triangle" class="w-4 h-4 text-warning mt-0.5"></i>' +
            '<div class="text-sm">' +
              '<p class="font-medium text-warning">' + (t('codexlens.legacyWarning') || 'Legacy Backend') + '</p>' +
              '<p class="text-muted-foreground mt-1">' + (t('codexlens.legacyWarningDesc') || 'Uses SentenceTransformers CrossEncoder. Consider using ONNX for better performance.') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button onclick="resetRerankerConfig()" class="btn btn-outline">' +
          '<i data-lucide="rotate-ccw" class="w-4 h-4"></i> ' + (t('common.reset') || 'Reset') +
        '</button>' +
        '<button onclick="closeRerankerModal()" class="btn btn-outline">' + t('common.cancel') + '</button>' +
        '<button onclick="saveRerankerConfig()" class="btn btn-primary">' +
          '<i data-lucide="save" class="w-4 h-4"></i> ' + t('common.save') +
        '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/**
 * Toggle reranker configuration sections based on selected backend
 */
function toggleRerankerSections() {
  var backend = document.getElementById('rerankerBackend').value;

  document.getElementById('rerankerOnnxSection').style.display = backend === 'onnx' ? 'block' : 'none';
  document.getElementById('rerankerApiSection').style.display = backend === 'api' ? 'block' : 'none';
  document.getElementById('rerankerLitellmSection').style.display = backend === 'litellm' ? 'block' : 'none';
  document.getElementById('rerankerLegacySection').style.display = backend === 'legacy' ? 'block' : 'none';
}

/**
 * Initialize reranker config modal events
 */
function initRerankerConfigEvents(config) {
  // Handle ONNX model custom input toggle
  var onnxModelSelect = document.getElementById('rerankerOnnxModel');
  var customModelInput = document.getElementById('rerankerCustomModel');

  if (onnxModelSelect && customModelInput) {
    onnxModelSelect.addEventListener('change', function() {
      customModelInput.style.display = this.value === 'custom' ? 'block' : 'none';
    });
  }

  // Store original config for reset
  window._rerankerOriginalConfig = config;
}

/**
 * Close the reranker config modal
 */
function closeRerankerModal() {
  var modal = document.getElementById('rerankerConfigModal');
  if (modal) modal.remove();
}

/**
 * Reset reranker config to original values
 */
function resetRerankerConfig() {
  var config = window._rerankerOriginalConfig;
  if (!config) return;

  document.getElementById('rerankerBackend').value = config.backend || 'onnx';
  toggleRerankerSections();

  // Reset ONNX section
  var onnxModels = [
    'cross-encoder/ms-marco-MiniLM-L-6-v2',
    'cross-encoder/ms-marco-TinyBERT-L-2-v2',
    'BAAI/bge-reranker-base',
    'BAAI/bge-reranker-large'
  ];
  if (onnxModels.includes(config.model_name)) {
    document.getElementById('rerankerOnnxModel').value = config.model_name;
    document.getElementById('rerankerCustomModel').style.display = 'none';
  } else {
    document.getElementById('rerankerOnnxModel').value = 'custom';
    document.getElementById('rerankerCustomModel').value = config.model_name || '';
    document.getElementById('rerankerCustomModel').style.display = 'block';
  }

  // Reset API section
  document.getElementById('rerankerApiProvider').value = config.api_provider || 'siliconflow';
  document.getElementById('rerankerApiKey').value = '';
  document.getElementById('rerankerApiModel').value = config.model_name || '';

  showRefreshToast(t('common.reset') || 'Reset to original values', 'info');
}

/**
 * Save reranker configuration
 */
async function saveRerankerConfig() {
  try {
    var backend = document.getElementById('rerankerBackend').value;
    var payload = { backend: backend };

    // Collect model name based on backend
    if (backend === 'onnx') {
      var onnxModel = document.getElementById('rerankerOnnxModel').value;
      if (onnxModel === 'custom') {
        payload.model_name = document.getElementById('rerankerCustomModel').value.trim();
      } else {
        payload.model_name = onnxModel;
      }
    } else if (backend === 'api') {
      payload.api_provider = document.getElementById('rerankerApiProvider').value;
      payload.model_name = document.getElementById('rerankerApiModel').value.trim();
      var apiKey = document.getElementById('rerankerApiKey').value.trim();
      if (apiKey) {
        payload.api_key = apiKey;
      }
    } else if (backend === 'litellm') {
      payload.litellm_endpoint = document.getElementById('rerankerLitellmEndpoint').value;
    }

    var response = await fetch('/api/codexlens/reranker/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast((t('codexlens.rerankerConfigSaved') || 'Reranker configuration saved') + ': ' + result.message, 'success');
      closeRerankerModal();
    } else {
      showRefreshToast(t('common.saveFailed') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

// ============================================================
// FILE WATCHER CONTROL
// ============================================================

/**
 * Show File Watcher control modal
 */
async function showWatcherControlModal() {
  try {
    showRefreshToast(t('codexlens.loadingWatcherStatus') || 'Loading watcher status...', 'info');

    // Fetch current watcher status and indexed projects in parallel
    const [statusResponse, indexesResponse] = await Promise.all([
      fetch('/api/codexlens/watch/status'),
      fetch('/api/codexlens/indexes')
    ]);
    const status = await statusResponse.json();
    const indexes = await indexesResponse.json();

    // Get first indexed project path as default
    let defaultPath = '';
    if (indexes.success && indexes.projects && indexes.projects.length > 0) {
      // Sort by last_indexed desc and pick the most recent
      const sorted = indexes.projects.sort((a, b) =>
        new Date(b.last_indexed || 0) - new Date(a.last_indexed || 0)
      );
      defaultPath = sorted[0].source_root || '';
    }

    const modalHtml = buildWatcherControlContent(status, defaultPath);

    // Create and show modal
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = modalHtml;
    const modal = tempContainer.firstElementChild;
    document.body.appendChild(modal);

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Start polling if watcher is running
    if (status.running) {
      startWatcherStatusPolling();
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Build File Watcher control modal content
 * @param {Object} status - Watcher status
 * @param {string} defaultPath - Default path from indexed projects
 */
function buildWatcherControlContent(status, defaultPath) {
  const running = status.running || false;
  defaultPath = defaultPath || '';
  const rootPath = status.root_path || '';
  const eventsProcessed = status.events_processed || 0;
  const uptimeSeconds = status.uptime_seconds || 0;

  // Format uptime
  const formatUptime = function(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  };

  return '<div class="modal-backdrop" id="watcherControlModal">' +
    '<div class="modal-container max-w-lg">' +
      '<div class="modal-header">' +
        '<div class="flex items-center gap-3">' +
          '<div class="modal-icon">' +
            '<i data-lucide="eye" class="w-5 h-5"></i>' +
          '</div>' +
          '<div>' +
            '<h2 class="text-lg font-bold">' + (t('codexlens.watcherControl') || 'File Watcher') + '</h2>' +
            '<p class="text-xs text-muted-foreground">' + (t('codexlens.watcherControlDesc') || 'Real-time incremental index updates') + '</p>' +
          '</div>' +
        '</div>' +
        '<button onclick="closeWatcherModal()" class="text-muted-foreground hover:text-foreground">' +
          '<i data-lucide="x" class="w-5 h-5"></i>' +
        '</button>' +
      '</div>' +

      '<div class="modal-body space-y-4">' +
        // Status and Toggle
        '<div class="flex items-center justify-between p-4 bg-muted/30 rounded-lg">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-3 h-3 rounded-full ' + (running ? 'bg-success animate-pulse' : 'bg-muted-foreground') + '"></div>' +
            '<div>' +
              '<span class="font-medium">' + (running ? (t('codexlens.watcherRunning') || 'Watcher Running') : (t('codexlens.watcherStopped') || 'Watcher Stopped')) + '</span>' +
              (running ? '<p class="text-xs text-muted-foreground">' + rootPath + '</p>' : '') +
            '</div>' +
          '</div>' +
          '<label class="relative inline-flex items-center cursor-pointer">' +
            '<input type="checkbox" id="watcherToggle" ' + (running ? 'checked' : '') + ' onchange="toggleWatcher()" class="sr-only peer" />' +
            '<div class="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>' +
          '</label>' +
        '</div>' +

        // Statistics (shown when running)
        '<div id="watcherStats" class="tool-config-section" style="display:' + (running ? 'block' : 'none') + '">' +
          '<h4>' + (t('codexlens.watcherStats') || 'Statistics') + '</h4>' +
          '<div class="grid grid-cols-2 gap-4">' +
            '<div class="p-3 bg-muted/20 rounded-lg">' +
              '<div class="text-2xl font-bold text-primary" id="watcherEventsCount">' + eventsProcessed + '</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.eventsProcessed') || 'Events Processed') + '</div>' +
            '</div>' +
            '<div class="p-3 bg-muted/20 rounded-lg">' +
              '<div class="text-2xl font-bold text-primary" id="watcherUptime">' + formatUptime(uptimeSeconds) + '</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.uptime') || 'Uptime') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Pending Queue Section (shown when running)
        '<div id="watcherPendingQueue" class="tool-config-section" style="display:' + (running ? 'block' : 'none') + '">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<h4 class="flex items-center gap-2 m-0">' +
              '<i data-lucide="clock" class="w-4 h-4"></i>' +
              (t('codexlens.pendingChanges') || 'Pending Changes') +
            '</h4>' +
            '<button onclick="flushWatcherNow()" class="btn btn-sm btn-primary" id="flushNowBtn" disabled>' +
              '<i data-lucide="zap" class="w-3 h-3 mr-1"></i>' +
              (t('codexlens.indexNow') || 'Index Now') +
            '</button>' +
          '</div>' +
          '<div class="flex items-center justify-between p-3 bg-muted/20 rounded-lg mb-2">' +
            '<div>' +
              '<span class="text-2xl font-bold text-warning" id="pendingFileCount">0</span>' +
              '<span class="text-sm text-muted-foreground ml-1">' + (t('codexlens.filesWaiting') || 'files waiting') + '</span>' +
            '</div>' +
            '<div class="text-right">' +
              '<div class="text-lg font-mono" id="countdownTimer">--:--</div>' +
              '<div class="text-xs text-muted-foreground">' + (t('codexlens.untilNextIndex') || 'until next index') + '</div>' +
            '</div>' +
          '</div>' +
          '<div id="pendingFilesList" class="max-h-24 overflow-y-auto space-y-1 text-sm"></div>' +
        '</div>' +

        // Last Index Result (shown when running)
        '<div id="watcherLastIndex" class="tool-config-section" style="display:none">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<h4 class="flex items-center gap-2 m-0">' +
              '<i data-lucide="check-circle" class="w-4 h-4"></i>' +
              (t('codexlens.lastIndexResult') || 'Last Index Result') +
            '</h4>' +
            '<button onclick="showIndexHistory()" class="text-xs text-muted-foreground hover:text-foreground">' +
              (t('codexlens.viewHistory') || 'View History') +
            '</button>' +
          '</div>' +
          '<div class="grid grid-cols-4 gap-2 text-center" id="lastIndexStats"></div>' +
        '</div>' +

        // Start Configuration (shown when not running)
        '<div id="watcherStartConfig" class="tool-config-section" style="display:' + (running ? 'none' : 'block') + '">' +
          '<h4>' + (t('codexlens.watcherConfig') || 'Configuration') + '</h4>' +
          '<div class="space-y-3">' +
            '<div>' +
              '<label class="block text-sm font-medium mb-1.5">' + (t('codexlens.watchPath') || 'Watch Path') + '</label>' +
              '<input type="text" id="watcherPath" value="' + defaultPath + '" placeholder="Enter an indexed project path" ' +
                'class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-sm font-medium mb-1.5">' + (t('codexlens.debounceMs') || 'Debounce (ms)') + '</label>' +
              '<input type="number" id="watcherDebounce" value="60000" min="1000" max="120000" step="1000" ' +
                'class="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />' +
              '<p class="text-xs text-muted-foreground mt-1">' + (t('codexlens.debounceHint') || 'Time to wait before processing file changes') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Info box
        '<div class="flex items-start gap-2 bg-primary/10 border border-primary/30 rounded-lg p-3">' +
          '<i data-lucide="info" class="w-4 h-4 text-primary mt-0.5"></i>' +
          '<div class="text-sm text-muted-foreground">' +
            (t('codexlens.watcherInfo') || 'The file watcher monitors your codebase for changes and automatically updates the search index in real-time.') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button onclick="closeWatcherModal()" class="btn btn-outline">' + t('common.close') + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/**
 * Toggle file watcher on/off
 */
async function toggleWatcher() {
  var toggle = document.getElementById('watcherToggle');
  var shouldRun = toggle.checked;

  try {
    if (shouldRun) {
      // Start watcher
      var watchPath = document.getElementById('watcherPath').value.trim();
      var debounceMs = parseInt(document.getElementById('watcherDebounce').value, 10) || 1000;

      var response = await fetch('/api/codexlens/watch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: watchPath || undefined, debounce_ms: debounceMs })
      });

      var result = await response.json();

      if (result.success) {
        showRefreshToast((t('codexlens.watcherStarted') || 'Watcher started') + ': ' + result.path, 'success');
        document.getElementById('watcherStats').style.display = 'block';
        document.getElementById('watcherStartConfig').style.display = 'none';
        startWatcherStatusPolling();
      } else {
        toggle.checked = false;
        showRefreshToast(t('common.error') + ': ' + result.error, 'error');
      }
    } else {
      // Stop watcher
      var response = await fetch('/api/codexlens/watch/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      var result = await response.json();

      if (result.success) {
        showRefreshToast((t('codexlens.watcherStopped') || 'Watcher stopped') + ': ' + result.events_processed + ' events processed', 'success');
        document.getElementById('watcherStats').style.display = 'none';
        document.getElementById('watcherStartConfig').style.display = 'block';
        stopWatcherStatusPolling();
      } else {
        toggle.checked = true;
        showRefreshToast(t('common.error') + ': ' + result.error, 'error');
      }
    }
  } catch (err) {
    toggle.checked = !shouldRun;
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

// Watcher status polling
var watcherPollingInterval = null;

function startWatcherStatusPolling() {
  if (watcherPollingInterval) return;

  watcherPollingInterval = setInterval(async function() {
    try {
      // Check if modal elements still exist (modal may be closed)
      var eventsCountEl = document.getElementById('watcherEventsCount');
      var uptimeEl = document.getElementById('watcherUptime');
      var toggleEl = document.getElementById('watcherToggle');
      var statsEl = document.getElementById('watcherStats');
      var configEl = document.getElementById('watcherStartConfig');

      // If modal elements don't exist, stop polling
      if (!eventsCountEl && !toggleEl) {
        stopWatcherStatusPolling();
        return;
      }

      var response = await fetch('/api/codexlens/watch/status');
      var status = await response.json();

      if (status.running) {
        if (eventsCountEl) eventsCountEl.textContent = status.events_processed || 0;

        // Format uptime
        var seconds = status.uptime_seconds || 0;
        var formatted = seconds < 60 ? seconds + 's' :
          seconds < 3600 ? Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's' :
          Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
        if (uptimeEl) uptimeEl.textContent = formatted;
      } else {
        // Watcher stopped externally
        stopWatcherStatusPolling();
        if (toggleEl) toggleEl.checked = false;
        if (statsEl) statsEl.style.display = 'none';
        if (configEl) configEl.style.display = 'block';
      }
    } catch (err) {
      console.error('Failed to poll watcher status:', err);
    }
  }, 2000);
}

function stopWatcherStatusPolling() {
  if (watcherPollingInterval) {
    clearInterval(watcherPollingInterval);
    watcherPollingInterval = null;
  }
  stopCountdownTimer();
}

// Countdown timer for pending queue
var countdownInterval = null;
var currentCountdownSeconds = 0;

function startCountdownTimer(seconds) {
  currentCountdownSeconds = seconds;
  if (countdownInterval) return;

  countdownInterval = setInterval(function() {
    var timerEl = document.getElementById('countdownTimer');
    if (!timerEl) {
      stopCountdownTimer();
      return;
    }

    if (currentCountdownSeconds <= 0) {
      timerEl.textContent = '--:--';
    } else {
      currentCountdownSeconds--;
      timerEl.textContent = formatCountdown(currentCountdownSeconds);
    }
  }, 1000);
}

function stopCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function formatCountdown(seconds) {
  if (seconds <= 0) return '--:--';
  var mins = Math.floor(seconds / 60);
  var secs = seconds % 60;
  return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
}

/**
 * Immediately flush pending queue and trigger indexing
 */
async function flushWatcherNow() {
  var btn = document.getElementById('flushNowBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 mr-1 animate-spin"></i> Indexing...';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  try {
    var watchPath = document.getElementById('watcherPath');
    var path = watchPath ? watchPath.value.trim() : '';

    var response = await fetch('/api/codexlens/watch/flush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path || undefined })
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast(t('codexlens.indexTriggered') || 'Indexing triggered', 'success');
    } else {
      showRefreshToast(t('common.error') + ': ' + result.error, 'error');
    }
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap" class="w-3 h-3 mr-1"></i>' + (t('codexlens.indexNow') || 'Index Now');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}
window.flushWatcherNow = flushWatcherNow;

/**
 * Show index history in a modal
 */
async function showIndexHistory() {
  try {
    var watchPath = document.getElementById('watcherPath');
    var path = watchPath ? watchPath.value.trim() : '';

    var response = await fetch('/api/codexlens/watch/history?limit=10&path=' + encodeURIComponent(path));
    var result = await response.json();

    if (!result.success || !result.history || result.history.length === 0) {
      showRefreshToast(t('codexlens.noHistory') || 'No index history available', 'info');
      return;
    }

    var historyHtml = result.history.slice().reverse().map(function(h, i) {
      var timestamp = h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : 'Unknown';
      return '<div class="p-3 border-b border-border last:border-0">' +
        '<div class="flex justify-between items-center mb-2">' +
          '<span class="text-sm font-medium">#' + (result.history.length - i) + '</span>' +
          '<span class="text-xs text-muted-foreground">' + timestamp + '</span>' +
        '</div>' +
        '<div class="grid grid-cols-4 gap-2 text-center text-sm">' +
          '<div><span class="text-success">' + (h.files_indexed || 0) + '</span> indexed</div>' +
          '<div><span class="text-warning">' + (h.files_removed || 0) + '</span> removed</div>' +
          '<div><span class="text-primary">+' + (h.symbols_added || 0) + '</span> symbols</div>' +
          '<div><span class="text-destructive">' + ((h.errors && h.errors.length) || 0) + '</span> errors</div>' +
        '</div>' +
        (h.errors && h.errors.length > 0 ? '<div class="mt-2 text-xs text-destructive">' +
          h.errors.slice(0, 2).map(function(e) { return '<div>• ' + e + '</div>'; }).join('') +
          (h.errors.length > 2 ? '<div>... and ' + (h.errors.length - 2) + ' more</div>' : '') +
        '</div>' : '') +
      '</div>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'indexHistoryModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = '<div class="modal-container max-w-md">' +
      '<div class="modal-header">' +
        '<h2 class="text-lg font-bold">' + (t('codexlens.indexHistory') || 'Index History') + '</h2>' +
        '<button onclick="document.getElementById(\'indexHistoryModal\').remove()" class="text-muted-foreground hover:text-foreground">' +
          '<i data-lucide="x" class="w-5 h-5"></i>' +
        '</button>' +
      '</div>' +
      '<div class="modal-body max-h-96 overflow-y-auto">' + historyHtml + '</div>' +
    '</div>';
    document.body.appendChild(modal);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}
window.showIndexHistory = showIndexHistory;

/**
 * Update pending queue UI elements
 */
function updatePendingQueueUI(queue) {
  var countEl = document.getElementById('pendingFileCount');
  var timerEl = document.getElementById('countdownTimer');
  var listEl = document.getElementById('pendingFilesList');
  var flushBtn = document.getElementById('flushNowBtn');

  if (countEl) countEl.textContent = queue.file_count || 0;

  if (queue.countdown_seconds > 0) {
    currentCountdownSeconds = queue.countdown_seconds;
    if (timerEl) timerEl.textContent = formatCountdown(queue.countdown_seconds);
    startCountdownTimer(queue.countdown_seconds);
  } else {
    if (timerEl) timerEl.textContent = '--:--';
  }

  if (flushBtn) flushBtn.disabled = (queue.file_count || 0) === 0;

  if (listEl && queue.files) {
    listEl.innerHTML = queue.files.map(function(f) {
      return '<div class="flex items-center gap-2 text-muted-foreground">' +
        '<i data-lucide="file" class="w-3 h-3"></i>' +
        '<span class="truncate">' + f + '</span>' +
      '</div>';
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

/**
 * Update last index result UI
 */
function updateLastIndexResult(result) {
  var statsEl = document.getElementById('lastIndexStats');
  var sectionEl = document.getElementById('watcherLastIndex');

  if (sectionEl) sectionEl.style.display = 'block';
  if (statsEl) {
    statsEl.innerHTML = '<div class="p-2 bg-success/10 rounded">' +
        '<div class="text-lg font-bold text-success">' + (result.files_indexed || 0) + '</div>' +
        '<div class="text-xs text-muted-foreground">Indexed</div>' +
      '</div>' +
      '<div class="p-2 bg-warning/10 rounded">' +
        '<div class="text-lg font-bold text-warning">' + (result.files_removed || 0) + '</div>' +
        '<div class="text-xs text-muted-foreground">Removed</div>' +
      '</div>' +
      '<div class="p-2 bg-primary/10 rounded">' +
        '<div class="text-lg font-bold text-primary">' + (result.symbols_added || 0) + '</div>' +
        '<div class="text-xs text-muted-foreground">+Symbols</div>' +
      '</div>' +
      '<div class="p-2 bg-destructive/10 rounded">' +
        '<div class="text-lg font-bold text-destructive">' + ((result.errors && result.errors.length) || 0) + '</div>' +
        '<div class="text-xs text-muted-foreground">Errors</div>' +
      '</div>';
  }

  // Clear pending queue after indexing
  updatePendingQueueUI({ file_count: 0, files: [], countdown_seconds: 0 });
}

/**
 * Close the watcher control modal
 */
function closeWatcherModal() {
  stopWatcherStatusPolling();
  var modal = document.getElementById('watcherControlModal');
  if (modal) modal.remove();
}

/**
 * Handle watcher status update from WebSocket
 * @param {Object} payload - { running: boolean, path?: string, error?: string, events_processed?: number, uptime_seconds?: number }
 */
function handleWatcherStatusUpdate(payload) {
  var toggle = document.getElementById('watcherToggle');
  var statsDiv = document.getElementById('watcherStats');
  var configDiv = document.getElementById('watcherStartConfig');
  var eventsCountEl = document.getElementById('watcherEventsCount');
  var uptimeEl = document.getElementById('watcherUptime');

  // Update events count if provided (real-time updates)
  if (payload.events_processed !== undefined && eventsCountEl) {
    eventsCountEl.textContent = payload.events_processed;
  }

  // Update uptime if provided
  if (payload.uptime_seconds !== undefined && uptimeEl) {
    var seconds = payload.uptime_seconds;
    var formatted = seconds < 60 ? seconds + 's' :
      seconds < 3600 ? Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's' :
      Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
    uptimeEl.textContent = formatted;
  }

  // Also update main page watcher status badge if it exists
  var statusBadge = document.getElementById('watcherStatusBadge');
  if (statusBadge && payload.running !== undefined) {
    updateWatcherUI(payload.running, {
      events_processed: payload.events_processed,
      uptime_seconds: payload.uptime_seconds
    });
  }

  if (payload.error) {
    // Watcher failed - update UI to show stopped state
    if (toggle) toggle.checked = false;
    if (statsDiv) statsDiv.style.display = 'none';
    if (configDiv) configDiv.style.display = 'block';
    stopWatcherStatusPolling();
  } else if (payload.running) {
    // Watcher started
    if (toggle) toggle.checked = true;
    if (statsDiv) statsDiv.style.display = 'block';
    if (configDiv) configDiv.style.display = 'none';
    startWatcherStatusPolling();
  } else if (payload.running === false) {
    // Watcher stopped normally (only if running is explicitly false)
    if (toggle) toggle.checked = false;
    if (statsDiv) statsDiv.style.display = 'none';
    if (configDiv) configDiv.style.display = 'block';
    stopWatcherStatusPolling();
  }
}
