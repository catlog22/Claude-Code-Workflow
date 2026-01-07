// Rules Manager View
// Manages Claude Code rules (.claude/rules/)

// ========== Rules State ==========
var rulesData = {
  projectRules: [],
  userRules: []
};
var selectedRule = null;
var rulesLoading = false;

// ========== Main Render Function ==========
async function renderRulesManager() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search
  const statsGrid = document.getElementById('statsGrid');
  const searchInput = document.getElementById('searchInput');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchInput) searchInput.parentElement.style.display = 'none';

  // Show loading state
  container.innerHTML = '<div class="rules-manager loading">' +
    '<div class="loading-spinner"><i data-lucide="loader-2" class="w-8 h-8 animate-spin"></i></div>' +
    '<p>' + t('common.loading') + '</p>' +
    '</div>';

  // Load rules data
  await loadRulesData();

  // Render the main view
  renderRulesView();
}

async function loadRulesData() {
  rulesLoading = true;
  try {
    const response = await fetch('/api/rules?path=' + encodeURIComponent(projectPath));
    if (!response.ok) throw new Error('Failed to load rules');
    const data = await response.json();
    rulesData = {
      projectRules: data.projectRules || [],
      userRules: data.userRules || []
    };
    // Update badge
    updateRulesBadge();
  } catch (err) {
    console.error('Failed to load rules:', err);
    rulesData = { projectRules: [], userRules: [] };
  } finally {
    rulesLoading = false;
  }
}

function updateRulesBadge() {
  const badge = document.getElementById('badgeRules');
  if (badge) {
    const total = rulesData.projectRules.length + rulesData.userRules.length;
    badge.textContent = total;
  }
}

function renderRulesView() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  const projectRules = rulesData.projectRules || [];
  const userRules = rulesData.userRules || [];

  container.innerHTML = `
    <div class="rules-manager">
      <!-- Header -->
      <div class="rules-header mb-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
              <i data-lucide="book-open" class="w-5 h-5 text-success"></i>
            </div>
            <div>
              <h2 class="text-lg font-semibold text-foreground">${t('rules.title')}</h2>
              <p class="text-sm text-muted-foreground">${t('rules.description')}</p>
            </div>
          </div>
          <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                  onclick="openRuleCreateModal()">
            <i data-lucide="plus" class="w-4 h-4"></i>
            ${t('rules.create')}
          </button>
        </div>
      </div>

      <!-- Project Rules Section -->
      <div class="rules-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i data-lucide="folder" class="w-5 h-5 text-success"></i>
            <h3 class="text-lg font-semibold text-foreground">${t('rules.projectRules')}</h3>
            <span class="text-xs px-2 py-0.5 bg-success/10 text-success rounded-full">.claude/rules/</span>
          </div>
          <span class="text-sm text-muted-foreground">${projectRules.length} ${t('rules.rulesCount')}</span>
        </div>

        ${projectRules.length === 0 ? `
          <div class="rules-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <div class="text-muted-foreground mb-3"><i data-lucide="book-open" class="w-10 h-10 mx-auto"></i></div>
            <p class="text-muted-foreground">${t('rules.noProjectRules')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('rules.createHint')}</p>
          </div>
        ` : `
          <div class="rules-grid grid gap-3">
            ${projectRules.map(rule => renderRuleCard(rule, 'project')).join('')}
          </div>
        `}
      </div>

      <!-- User Rules Section -->
      <div class="rules-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i data-lucide="user" class="w-5 h-5 text-orange"></i>
            <h3 class="text-lg font-semibold text-foreground">${t('rules.userRules')}</h3>
            <span class="text-xs px-2 py-0.5 bg-orange/10 text-orange rounded-full">~/.claude/rules/</span>
          </div>
          <span class="text-sm text-muted-foreground">${userRules.length} ${t('rules.rulesCount')}</span>
        </div>

        ${userRules.length === 0 ? `
          <div class="rules-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <div class="text-muted-foreground mb-3"><i data-lucide="user" class="w-10 h-10 mx-auto"></i></div>
            <p class="text-muted-foreground">${t('rules.noUserRules')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('rules.userRulesHint')}</p>
          </div>
        ` : `
          <div class="rules-grid grid gap-3">
            ${userRules.map(rule => renderRuleCard(rule, 'user')).join('')}
          </div>
        `}
      </div>

      <!-- Rule Detail Panel -->
      ${selectedRule ? renderRuleDetailPanel(selectedRule) : ''}
    </div>
  `;

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderRuleCard(rule, location) {
  const hasPathCondition = rule.paths && rule.paths.length > 0;
  const isGlobal = !hasPathCondition;
  const locationIcon = location === 'project' ? 'folder' : 'user';
  const locationClass = location === 'project' ? 'text-success' : 'text-orange';
  const locationBg = location === 'project' ? 'bg-success/10' : 'bg-orange/10';

  // Get preview of content (first 100 chars)
  const contentPreview = rule.content ? rule.content.substring(0, 100).replace(/\n/g, ' ') + (rule.content.length > 100 ? '...' : '') : '';

  return `
    <div class="rule-card bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all cursor-pointer"
         onclick="showRuleDetail('${escapeHtml(rule.name)}', '${location}')">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 ${locationBg} rounded-lg flex items-center justify-center">
            <i data-lucide="file-text" class="w-5 h-5 ${locationClass}"></i>
          </div>
          <div>
            <h4 class="font-semibold text-foreground">${escapeHtml(rule.name)}</h4>
            ${rule.subdirectory ? `<span class="text-xs text-muted-foreground">${escapeHtml(rule.subdirectory)}/</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${isGlobal ? `
            <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary">
              <i data-lucide="globe" class="w-3 h-3 mr-1"></i>
              global
            </span>
          ` : `
            <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-warning/10 text-warning">
              <i data-lucide="filter" class="w-3 h-3 mr-1"></i>
              conditional
            </span>
          `}
          <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${locationBg} ${locationClass}">
            <i data-lucide="${locationIcon}" class="w-3 h-3 mr-1"></i>
            ${location}
          </span>
        </div>
      </div>

      ${contentPreview ? `
        <p class="text-sm text-muted-foreground mb-3 line-clamp-2 font-mono">${escapeHtml(contentPreview)}</p>
      ` : ''}

      ${hasPathCondition ? `
        <div class="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <i data-lucide="filter" class="w-3 h-3"></i>
          <span class="font-mono">${escapeHtml(rule.paths.join(', '))}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderRuleDetailPanel(rule) {
  const hasPathCondition = rule.paths && rule.paths.length > 0;

  return `
    <div class="rule-detail-panel fixed top-0 right-0 w-1/2 max-w-xl h-full bg-card border-l border-border shadow-lg z-50 flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-lg font-semibold text-foreground">${escapeHtml(rule.name)}</h3>
        <button class="w-8 h-8 flex items-center justify-center text-xl text-muted-foreground hover:text-foreground hover:bg-hover rounded"
                onclick="closeRuleDetail()">&times;</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5">
        <div class="space-y-6">
          <!-- Type -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('rules.typeLabel')}</h4>
            <div class="flex items-center gap-2">
              ${hasPathCondition ? `
                <span class="inline-flex items-center px-3 py-1 text-sm font-medium rounded-lg bg-warning/10 text-warning">
                  <i data-lucide="filter" class="w-4 h-4 mr-2"></i>
                  ${t('rules.conditional')}
                </span>
              ` : `
                <span class="inline-flex items-center px-3 py-1 text-sm font-medium rounded-lg bg-primary/10 text-primary">
                  <i data-lucide="globe" class="w-4 h-4 mr-2"></i>
                  ${t('rules.global')}
                </span>
              `}
            </div>
          </div>

          <!-- Path Conditions -->
          ${hasPathCondition ? `
            <div>
              <h4 class="text-sm font-semibold text-foreground mb-2">${t('rules.pathConditions')}</h4>
              <div class="space-y-2">
                ${rule.paths.map(path => `
                  <div class="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                    <i data-lucide="file-code" class="w-4 h-4 text-muted-foreground"></i>
                    <code class="text-sm font-mono text-foreground">${escapeHtml(path)}</code>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Content -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('rules.content')}</h4>
            <div class="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
              <pre class="text-sm font-mono text-foreground whitespace-pre-wrap">${escapeHtml(rule.content || '')}</pre>
            </div>
          </div>

          <!-- Path -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('rules.filePath')}</h4>
            <code class="block p-3 bg-muted rounded-lg text-xs font-mono text-muted-foreground break-all">${escapeHtml(rule.path)}</code>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="px-5 py-4 border-t border-border flex justify-between">
        <button class="px-4 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors flex items-center gap-2"
                onclick="deleteRule('${escapeHtml(rule.name)}', '${rule.location}')">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
          ${t('common.delete')}
        </button>
        <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                onclick="editRule('${escapeHtml(rule.name)}', '${rule.location}')">
          <i data-lucide="edit" class="w-4 h-4"></i>
          ${t('common.edit')}
        </button>
      </div>
    </div>
    <div class="rule-detail-overlay fixed inset-0 bg-black/50 z-40" onclick="closeRuleDetail()"></div>
  `;
}

async function showRuleDetail(ruleName, location) {
  try {
    const response = await fetch('/api/rules/' + encodeURIComponent(ruleName) + '?location=' + location + '&path=' + encodeURIComponent(projectPath));
    if (!response.ok) throw new Error('Failed to load rule detail');
    const data = await response.json();
    selectedRule = data.rule;
    renderRulesView();
  } catch (err) {
    console.error('Failed to load rule detail:', err);
    if (window.showToast) {
      showToast(t('rules.loadError'), 'error');
    }
  }
}

function closeRuleDetail() {
  selectedRule = null;
  renderRulesView();
}

async function deleteRule(ruleName, location) {
  if (!confirm(t('rules.deleteConfirm', { name: ruleName }))) return;

  try {
    const response = await fetch('/api/rules/' + encodeURIComponent(ruleName), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, projectPath })
    });
    if (!response.ok) throw new Error('Failed to delete rule');

    selectedRule = null;
    await loadRulesData();
    renderRulesView();

    if (window.showToast) {
      showToast(t('rules.deleted'), 'success');
    }
  } catch (err) {
    console.error('Failed to delete rule:', err);
    if (window.showToast) {
      showToast(t('rules.deleteError'), 'error');
    }
  }
}

function editRule(ruleName, location) {
  // Open edit modal (to be implemented with modal)
  if (window.showToast) {
    showToast(t('rules.editNotImplemented'), 'info');
  }
}

// ========== Create Rule Modal ==========
var ruleCreateState = {
  location: 'project',
  fileName: '',
  subdirectory: '',
  isConditional: false,
  paths: [''],
  content: '',
  mode: 'input',
  generationType: 'description',
  description: '',
  extractScope: '',
  extractFocus: '',
  enableReview: false
};

function openRuleCreateModal() {
  // Reset state
  ruleCreateState = {
    location: 'project',
    fileName: '',
    subdirectory: '',
    isConditional: false,
    paths: [''],
    content: '',
    mode: 'input',
    generationType: 'description',
    description: '',
    extractScope: '',
    extractFocus: '',
    enableReview: false
  };

  // Create modal HTML
  const modalHtml = `
    <div class="modal-overlay fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onclick="closeRuleCreateModal(event)">
      <div class="modal-dialog bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 class="text-lg font-semibold text-foreground">${t('rules.createRule')}</h3>
          <button class="w-8 h-8 flex items-center justify-center text-xl text-muted-foreground hover:text-foreground hover:bg-hover rounded"
                  onclick="closeRuleCreateModal()">&times;</button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-5">
          <!-- Location Selection -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.location')}</label>
            <div class="grid grid-cols-2 gap-3">
              <button class="location-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${ruleCreateState.location === 'project' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="selectRuleLocation('project')">
                <div class="flex items-center gap-2">
                  <i data-lucide="folder" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('rules.projectRules')}</div>
                    <div class="text-xs text-muted-foreground">.claude/rules/</div>
                  </div>
                </div>
              </button>
              <button class="location-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${ruleCreateState.location === 'user' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="selectRuleLocation('user')">
                <div class="flex items-center gap-2">
                  <i data-lucide="user" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('rules.userRules')}</div>
                    <div class="text-xs text-muted-foreground">~/.claude/rules/</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <!-- Mode Selection -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.createMode')}</label>
            <div class="grid grid-cols-2 gap-3">
              <button class="mode-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${ruleCreateState.mode === 'input' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="switchRuleCreateMode('input')">
                <div class="flex items-center gap-2">
                  <i data-lucide="edit" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('rules.manualInput')}</div>
                    <div class="text-xs text-muted-foreground">${t('rules.manualInputHint')}</div>
                  </div>
                </div>
              </button>
              <button class="mode-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${ruleCreateState.mode === 'cli-generate' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="switchRuleCreateMode('cli-generate')">
                <div class="flex items-center gap-2">
                  <i data-lucide="sparkles" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('rules.cliGenerate')}</div>
                    <div class="text-xs text-muted-foreground">${t('rules.cliGenerateHint')}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <!-- File Name -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.fileName')}</label>
            <input type="text" id="ruleFileName"
                   class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                   placeholder="my-rule.md"
                   value="${ruleCreateState.fileName}">
            <p class="text-xs text-muted-foreground mt-1">${t('rules.fileNameHint')}</p>
          </div>

          <!-- Subdirectory -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.subdirectory')} <span class="text-muted-foreground">${t('common.optional')}</span></label>
            <input type="text" id="ruleSubdirectory"
                   class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                   placeholder="category/subcategory"
                   value="${ruleCreateState.subdirectory}">
            <p class="text-xs text-muted-foreground mt-1">${t('rules.subdirectoryHint')}</p>
          </div>

          <!-- CLI Generation Type (CLI mode only) -->
          <div id="ruleGenerationTypeSection" style="display: ${ruleCreateState.mode === 'cli-generate' ? 'block' : 'none'}">
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.generationType')}</label>
            <div class="flex gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="ruleGenType" value="description"
                       class="w-4 h-4 text-primary bg-background border-border focus:ring-2 focus:ring-primary"
                       ${ruleCreateState.generationType === 'description' ? 'checked' : ''}
                       onchange="switchRuleGenerationType('description')">
                <span class="text-sm">${t('rules.fromDescription')}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="ruleGenType" value="extract"
                       class="w-4 h-4 text-primary bg-background border-border focus:ring-2 focus:ring-primary"
                       ${ruleCreateState.generationType === 'extract' ? 'checked' : ''}
                       onchange="switchRuleGenerationType('extract')">
                <span class="text-sm">${t('rules.fromCodeExtract')}</span>
              </label>
            </div>
          </div>

          <!-- Description Input (CLI mode, description type) -->
          <div id="ruleDescriptionSection" style="display: ${ruleCreateState.mode === 'cli-generate' && ruleCreateState.generationType === 'description' ? 'block' : 'none'}">
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.description')}</label>
            <textarea id="ruleDescription"
                      class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      rows="4"
                      placeholder="${t('rules.descriptionPlaceholder')}">${ruleCreateState.description}</textarea>
            <p class="text-xs text-muted-foreground mt-1">${t('rules.descriptionHint')}</p>
          </div>

          <!-- Code Extract Options (CLI mode, extract type) -->
          <div id="ruleExtractSection" style="display: ${ruleCreateState.mode === 'cli-generate' && ruleCreateState.generationType === 'extract' ? 'block' : 'none'}">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-foreground mb-2">${t('rules.extractScope')}</label>
                <input type="text" id="ruleExtractScope"
                       class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                       placeholder="src/**/*.ts"
                       value="${ruleCreateState.extractScope}">
                <p class="text-xs text-muted-foreground mt-1">${t('rules.extractScopeHint')}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-foreground mb-2">${t('rules.extractFocus')}</label>
                <input type="text" id="ruleExtractFocus"
                       class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                       placeholder="naming, error-handling, state-management"
                       value="${ruleCreateState.extractFocus}">
                <p class="text-xs text-muted-foreground mt-1">${t('rules.extractFocusHint')}</p>
              </div>
            </div>
          </div>

          <!-- Review Option (CLI mode only) -->
          <div id="ruleReviewSection" style="display: ${ruleCreateState.mode === 'cli-generate' ? 'block' : 'none'}">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="ruleEnableReview"
                     class="w-4 h-4 text-primary bg-background border-border rounded focus:ring-2 focus:ring-primary"
                     ${ruleCreateState.enableReview ? 'checked' : ''}
                     onchange="toggleRuleReview()">
              <span class="text-sm font-medium text-foreground">${t('rules.enableReview')}</span>
            </label>
            <p class="text-xs text-muted-foreground mt-1 ml-6">${t('rules.enableReviewHint')}</p>
          </div>

          <!-- Conditional Rule Toggle (Manual mode only) -->
          <div id="ruleConditionalSection" style="display: ${ruleCreateState.mode === 'input' ? 'block' : 'none'}">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="ruleConditional"
                     class="w-4 h-4 text-primary bg-background border-border rounded focus:ring-2 focus:ring-primary"
                     ${ruleCreateState.isConditional ? 'checked' : ''}
                     onchange="toggleRuleConditional()">
              <span class="text-sm font-medium text-foreground">${t('rules.conditionalRule')}</span>
            </label>
            <p class="text-xs text-muted-foreground mt-1 ml-6">${t('rules.conditionalHint')}</p>
          </div>

          <!-- Path Conditions -->
          <div id="rulePathsContainer" style="display: ${ruleCreateState.isConditional ? 'block' : 'none'}">
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.pathConditions')}</label>
            <div id="rulePathsList" class="space-y-2">
              ${ruleCreateState.paths.map((path, index) => `
                <div class="flex gap-2">
                  <input type="text" class="rule-path-input flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                         placeholder="src/**/*.ts"
                         value="${path}"
                         data-index="${index}">
                  ${index > 0 ? `
                    <button class="px-3 py-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            onclick="removeRulePath(${index})">
                      <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
            <button class="mt-2 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-1"
                    onclick="addRulePath()">
              <i data-lucide="plus" class="w-4 h-4"></i>
              ${t('rules.addPath')}
            </button>
          </div>

          <!-- Content (Manual mode only) -->
          <div id="ruleContentSection" style="display: ${ruleCreateState.mode === 'input' ? 'block' : 'none'}">
            <label class="block text-sm font-medium text-foreground mb-2">${t('rules.content')}</label>
            <textarea id="ruleContent"
                      class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                      rows="10"
                      placeholder="${t('rules.contentPlaceholder')}">${ruleCreateState.content}</textarea>
            <p class="text-xs text-muted-foreground mt-1">${t('rules.contentHint')}</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onclick="closeRuleCreateModal()">
            ${t('common.cancel')}
          </button>
          <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
                  onclick="createRule()">
            ${t('rules.create')}
          </button>
        </div>
      </div>
    </div>
  `;

  // Add to DOM
  const modalContainer = document.createElement('div');
  modalContainer.id = 'ruleCreateModal';
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeRuleCreateModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('ruleCreateModal');
  if (modal) modal.remove();
}

function selectRuleLocation(location) {
  ruleCreateState.location = location;

  // Update button styles without re-rendering modal
  const buttons = document.querySelectorAll('.location-btn');
  buttons.forEach(btn => {
    const isProject = btn.querySelector('.font-medium')?.textContent?.includes(t('rules.projectRules'));
    const isUser = btn.querySelector('.font-medium')?.textContent?.includes(t('rules.userRules'));

    if ((isProject && location === 'project') || (isUser && location === 'user')) {
      btn.classList.remove('border-border', 'hover:border-primary/50');
      btn.classList.add('border-primary', 'bg-primary/10');
    } else {
      btn.classList.remove('border-primary', 'bg-primary/10');
      btn.classList.add('border-border', 'hover:border-primary/50');
    }
  });
}

function toggleRuleConditional() {
  ruleCreateState.isConditional = !ruleCreateState.isConditional;
  const pathsContainer = document.getElementById('rulePathsContainer');
  if (pathsContainer) {
    pathsContainer.style.display = ruleCreateState.isConditional ? 'block' : 'none';
  }
}

function addRulePath() {
  ruleCreateState.paths.push('');
  // Re-render paths list
  const pathsList = document.getElementById('rulePathsList');
  if (pathsList) {
    const index = ruleCreateState.paths.length - 1;
    const pathHtml = `
      <div class="flex gap-2">
        <input type="text" class="rule-path-input flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
               placeholder="src/**/*.ts"
               value=""
               data-index="${index}">
        <button class="px-3 py-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                onclick="removeRulePath(${index})">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    `;
    pathsList.insertAdjacentHTML('beforeend', pathHtml);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function removeRulePath(index) {
  ruleCreateState.paths.splice(index, 1);

  // Re-render paths list without closing modal
  const pathsList = document.getElementById('rulePathsList');
  if (pathsList) {
    pathsList.innerHTML = ruleCreateState.paths.map((path, idx) => `
      <div class="flex gap-2">
        <input type="text" class="rule-path-input flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
               placeholder="src/**/*.ts"
               value="${path}"
               data-index="${idx}">
        ${idx > 0 ? `
          <button class="px-3 py-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  onclick="removeRulePath(${idx})">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        ` : ''}
      </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function switchRuleCreateMode(mode) {
  ruleCreateState.mode = mode;

  // Toggle visibility of sections
  const generationTypeSection = document.getElementById('ruleGenerationTypeSection');
  const descriptionSection = document.getElementById('ruleDescriptionSection');
  const extractSection = document.getElementById('ruleExtractSection');
  const reviewSection = document.getElementById('ruleReviewSection');
  const conditionalSection = document.getElementById('ruleConditionalSection');
  const contentSection = document.getElementById('ruleContentSection');

  if (mode === 'cli-generate') {
    if (generationTypeSection) generationTypeSection.style.display = 'block';
    if (reviewSection) reviewSection.style.display = 'block';
    if (conditionalSection) conditionalSection.style.display = 'none';
    if (contentSection) contentSection.style.display = 'none';

    // Show appropriate generation section
    if (ruleCreateState.generationType === 'description') {
      if (descriptionSection) descriptionSection.style.display = 'block';
      if (extractSection) extractSection.style.display = 'none';
    } else {
      if (descriptionSection) descriptionSection.style.display = 'none';
      if (extractSection) extractSection.style.display = 'block';
    }
  } else {
    if (generationTypeSection) generationTypeSection.style.display = 'none';
    if (descriptionSection) descriptionSection.style.display = 'none';
    if (extractSection) extractSection.style.display = 'none';
    if (reviewSection) reviewSection.style.display = 'none';
    if (conditionalSection) conditionalSection.style.display = 'block';
    if (contentSection) contentSection.style.display = 'block';
  }

  // Update mode button styles without re-rendering
  const modeButtons = document.querySelectorAll('#ruleCreateModal .mode-btn');
  modeButtons.forEach(btn => {
    const btnText = btn.querySelector('.font-medium')?.textContent || '';
    const isInput = btnText.includes(t('rules.manualInput'));
    const isCliGenerate = btnText.includes(t('rules.cliGenerate'));

    if ((isInput && mode === 'input') || (isCliGenerate && mode === 'cli-generate')) {
      btn.classList.remove('border-border', 'hover:border-primary/50');
      btn.classList.add('border-primary', 'bg-primary/10');
    } else {
      btn.classList.remove('border-primary', 'bg-primary/10');
      btn.classList.add('border-border', 'hover:border-primary/50');
    }
  });
}

function switchRuleGenerationType(type) {
  ruleCreateState.generationType = type;

  // Toggle visibility of generation sections
  const descriptionSection = document.getElementById('ruleDescriptionSection');
  const extractSection = document.getElementById('ruleExtractSection');

  if (type === 'description') {
    if (descriptionSection) descriptionSection.style.display = 'block';
    if (extractSection) extractSection.style.display = 'none';
  } else if (type === 'extract') {
    if (descriptionSection) descriptionSection.style.display = 'none';
    if (extractSection) extractSection.style.display = 'block';
  }
}

function toggleRuleReview() {
  const checkbox = document.getElementById('ruleEnableReview');
  ruleCreateState.enableReview = checkbox ? checkbox.checked : false;
}

async function createRule() {
  const fileNameInput = document.getElementById('ruleFileName');
  const subdirectoryInput = document.getElementById('ruleSubdirectory');
  const contentInput = document.getElementById('ruleContent');
  const pathInputs = document.querySelectorAll('.rule-path-input');
  const descriptionInput = document.getElementById('ruleDescription');
  const extractScopeInput = document.getElementById('ruleExtractScope');
  const extractFocusInput = document.getElementById('ruleExtractFocus');

  const fileName = fileNameInput ? fileNameInput.value.trim() : ruleCreateState.fileName;
  const subdirectory = subdirectoryInput ? subdirectoryInput.value.trim() : ruleCreateState.subdirectory;

  // Validate file name
  if (!fileName) {
    if (window.showToast) {
      showToast(t('rules.fileNameRequired'), 'error');
    }
    return;
  }

  if (!fileName.endsWith('.md')) {
    if (window.showToast) {
      showToast(t('rules.fileNameMustEndMd'), 'error');
    }
    return;
  }

  // Prepare request based on mode
  let requestBody;

  if (ruleCreateState.mode === 'cli-generate') {
    // CLI generation mode
    const description = descriptionInput ? descriptionInput.value.trim() : ruleCreateState.description;
    const extractScope = extractScopeInput ? extractScopeInput.value.trim() : ruleCreateState.extractScope;
    const extractFocus = extractFocusInput ? extractFocusInput.value.trim() : ruleCreateState.extractFocus;

    // Validate based on generation type
    if (ruleCreateState.generationType === 'description' && !description) {
      if (window.showToast) {
        showToast(t('rules.descriptionRequired'), 'error');
      }
      return;
    }

    if (ruleCreateState.generationType === 'extract' && !extractScope) {
      if (window.showToast) {
        showToast(t('rules.extractScopeRequired'), 'error');
      }
      return;
    }

    requestBody = {
      mode: 'cli-generate',
      fileName,
      location: ruleCreateState.location,
      subdirectory: subdirectory || undefined,
      projectPath,
      generationType: ruleCreateState.generationType,
      description: ruleCreateState.generationType === 'description' ? description : undefined,
      extractScope: ruleCreateState.generationType === 'extract' ? extractScope : undefined,
      extractFocus: ruleCreateState.generationType === 'extract' ? extractFocus : undefined,
      enableReview: ruleCreateState.enableReview || undefined
    };

    // Show progress message
    if (window.showToast) {
      showToast(t('rules.cliGenerating'), 'info');
    }
  } else {
    // Manual input mode
    const content = contentInput ? contentInput.value.trim() : ruleCreateState.content;

    // Collect paths from inputs
    const paths = [];
    if (ruleCreateState.isConditional && pathInputs) {
      pathInputs.forEach(input => {
        const path = input.value.trim();
        if (path) paths.push(path);
      });
    }

    // Validate content
    if (!content) {
      if (window.showToast) {
        showToast(t('rules.contentRequired'), 'error');
      }
      return;
    }

    requestBody = {
      mode: 'input',
      fileName,
      content,
      paths: paths.length > 0 ? paths : undefined,
      location: ruleCreateState.location,
      subdirectory: subdirectory || undefined,
      projectPath
    };
  }

  try {
    const response = await fetch('/api/rules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create rule');
    }

    const result = await response.json();

    // Close modal
    closeRuleCreateModal();

    // Reload rules data
    await loadRulesData();
    renderRulesView();

    // Show success message
    if (window.showToast) {
      showToast(t('rules.created', { name: result.fileName }), 'success');
    }
  } catch (err) {
    console.error('Failed to create rule:', err);
    if (window.showToast) {
      showToast(err.message || t('rules.createError'), 'error');
    }
  }
}
