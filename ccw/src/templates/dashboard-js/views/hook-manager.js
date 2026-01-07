// Hook Manager View
// Renders the Claude Code hooks management interface

async function renderHookManager() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search for Hook view
  const statsGrid = document.getElementById('statsGrid');
  const searchInput = document.getElementById('searchInput');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchInput) searchInput.parentElement.style.display = 'none';

  // Always reload hook config and available skills to get latest data
  await Promise.all([
    loadHookConfig(),
    loadAvailableSkills()
  ]);

  const globalHooks = hookConfig.global?.hooks || {};
  const projectHooks = hookConfig.project?.hooks || {};

  // Count hooks
  const globalHookCount = countHooks(globalHooks);
  const projectHookCount = countHooks(projectHooks);

  container.innerHTML = `
    <div class="hook-manager">
      <!-- Project Hooks -->
      <div class="hook-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-foreground">${t('hook.projectHooks')}</h3>
            <span class="badge px-2 py-0.5 text-xs font-semibold rounded-full bg-primary-light text-primary">${t('hook.projectFile')}</span>
            <button class="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1"
                    onclick="openHookCreateModal()">
              <span>+</span> ${t('hook.newHook')}
            </button>
          </div>
          <span class="text-sm text-muted-foreground">${projectHookCount} ${t('hook.hooksConfigured')}</span>
        </div>

        ${projectHookCount === 0 ? `
          <div class="hook-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <div class="text-muted-foreground mb-3"><i data-lucide="webhook" class="w-10 h-10 mx-auto"></i></div>
            <p class="text-muted-foreground">${t('empty.noHooks')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('empty.createHookHint')}</p>
          </div>
        ` : `
          <div class="hook-grid grid gap-3">
            ${renderHooksByEvent(projectHooks, 'project')}
          </div>
        `}
      </div>

      <!-- Global Hooks -->
      <div class="hook-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-foreground">${t('hook.globalHooks')}</h3>
            <span class="badge px-2 py-0.5 text-xs font-semibold rounded-full bg-muted text-muted-foreground">${t('hook.globalFile')}</span>
          </div>
          <span class="text-sm text-muted-foreground">${globalHookCount} ${t('hook.hooksConfigured')}</span>
        </div>

        ${globalHookCount === 0 ? `
          <div class="hook-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <p class="text-muted-foreground">${t('empty.noGlobalHooks')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('empty.globalHooksHint')}</p>
          </div>
        ` : `
          <div class="hook-grid grid gap-3">
            ${renderHooksByEvent(globalHooks, 'global')}
          </div>
        `}
      </div>

      <!-- Hook Wizards -->
      <div class="hook-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-foreground">${t('hook.wizards')}</h3>
            <span class="badge px-2 py-0.5 text-xs font-semibold rounded-full bg-success/20 text-success">${t('hook.guidedSetup')}</span>
          </div>
          <span class="text-sm text-muted-foreground">${t('hook.wizardsDesc')}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${renderWizardCard('memory-update')}
          ${renderWizardCard('danger-protection')}
          ${renderWizardCard('skill-context')}
        </div>
      </div>

      <!-- Quick Install Templates -->
      <div class="hook-section">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-foreground">${t('hook.quickInstall')}</h3>
          <span class="text-sm text-muted-foreground">${t('hook.oneClick')}</span>
        </div>

        <div class="hook-templates-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          ${renderQuickInstallCard('session-context', t('hook.tpl.sessionContext'), t('hook.tpl.sessionContextDesc'), 'UserPromptSubmit', '')}
          ${renderQuickInstallCard('codexlens-update', t('hook.tpl.codexlensSync'), t('hook.tpl.codexlensSyncDesc'), 'PostToolUse', 'Write|Edit')}
          ${renderQuickInstallCard('ccw-notify', t('hook.tpl.ccwDashboardNotify'), t('hook.tpl.ccwDashboardNotifyDesc'), 'PostToolUse', 'Write')}
          ${renderQuickInstallCard('log-tool', t('hook.tpl.toolLogger'), t('hook.tpl.toolLoggerDesc'), 'PostToolUse', 'All')}
          ${renderQuickInstallCard('lint-check', t('hook.tpl.autoLint'), t('hook.tpl.autoLintDesc'), 'PostToolUse', 'Write')}
          ${renderQuickInstallCard('git-add', t('hook.tpl.autoGitStage'), t('hook.tpl.autoGitStageDesc'), 'PostToolUse', 'Write')}
        </div>
      </div>

      <!-- Hook Environment Variables Reference -->
      <div class="hook-section mt-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-foreground">${t('hook.envVarsRef')}</h3>
        </div>

        <div class="bg-card border border-border rounded-lg p-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div class="space-y-2">
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_FILE_PATHS</code>
                <span class="text-muted-foreground">${t('hook.filePaths')}</span>
              </div>
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_TOOL_NAME</code>
                <span class="text-muted-foreground">${t('hook.toolName')}</span>
              </div>
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_TOOL_INPUT</code>
                <span class="text-muted-foreground">${t('hook.toolInput')}</span>
              </div>
            </div>
            <div class="space-y-2">
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_SESSION_ID</code>
                <span class="text-muted-foreground">${t('hook.sessionId')}</span>
              </div>
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_PROJECT_DIR</code>
                <span class="text-muted-foreground">${t('hook.projectDir')}</span>
              </div>
              <div class="flex items-start gap-2">
                <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">$CLAUDE_WORKING_DIR</code>
                <span class="text-muted-foreground">${t('hook.workingDir')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  attachHookEventListeners();

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Load available SKILLs for skill-context wizard
  loadAvailableSkills();
}

// Load available SKILLs for skill-context wizard
async function loadAvailableSkills() {
  try {
    const response = await fetch(`/api/skills?path=${encodeURIComponent(projectPath)}`);
    if (!response.ok) throw new Error('Failed to load skills');
    const data = await response.json();

    // Combine project and user skills (API returns { projectSkills: [], userSkills: [] })
    const allSkills = [
      ...(data.projectSkills || []).map(s => ({ ...s, scope: 'project' })),
      ...(data.userSkills || []).map(s => ({ ...s, scope: 'user' }))
    ];

    const container = document.getElementById('skill-discovery-skill-context');
    if (container) {
      if (allSkills.length === 0) {
        container.innerHTML = `
          <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.availableSkills')}</span>
          <span class="text-muted-foreground ml-2">${t('hook.wizard.noSkillsFound').split('.')[0]}</span>
        `;
      } else {
        const skillBadges = allSkills.map(skill => `
          <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded" title="${escapeHtml(skill.description || '')}">${escapeHtml(skill.name)}</span>
        `).join('');
        container.innerHTML = `
          <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.availableSkills')}</span>
          <div class="flex flex-wrap gap-1 mt-1">${skillBadges}</div>
        `;
      }
    }

    // Store skills for wizard use
    window.availableSkills = allSkills;
  } catch (err) {
    console.error('Failed to load skills:', err);
    const container = document.getElementById('skill-discovery-skill-context');
    if (container) {
      container.innerHTML = `
        <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.availableSkills')}</span>
        <span class="text-destructive ml-2">${t('toast.loadFailed', { error: err.message })}</span>
      `;
    }
  }
}

// Call loadAvailableSkills after rendering hook manager
const originalRenderHookManager = typeof renderHookManager === 'function' ? renderHookManager : null;

function renderWizardCard(wizardId) {
  const wizard = WIZARD_TEMPLATES[wizardId];
  if (!wizard) return '';

  // Get translated wizard name and description
  const wizardName = wizardId === 'memory-update' ? t('hook.wizard.memoryUpdate') :
                     wizardId === 'memory-setup' ? t('hook.wizard.memorySetup') :
                     wizardId === 'skill-context' ? t('hook.wizard.skillContext') :
                     wizardId === 'danger-protection' ? t('hook.wizard.dangerProtection') : wizard.name;
  const wizardDesc = wizardId === 'memory-update' ? t('hook.wizard.memoryUpdateDesc') :
                     wizardId === 'memory-setup' ? t('hook.wizard.memorySetupDesc') :
                     wizardId === 'skill-context' ? t('hook.wizard.skillContextDesc') :
                     wizardId === 'danger-protection' ? t('hook.wizard.dangerProtectionDesc') : wizard.description;

  // Translate options
  const getOptionName = (wizardId, optId) => {
    if (wizardId === 'memory-update') {
      if (optId === 'on-stop') return t('hook.wizard.onSessionEnd');
      if (optId === 'periodic') return t('hook.wizard.periodicUpdate');
      if (optId === 'count-based') return t('hook.wizard.countBasedUpdate');
    }
    if (wizardId === 'memory-setup') {
      if (optId === 'file-read') return t('hook.wizard.fileReadTracker');
      if (optId === 'file-write') return t('hook.wizard.fileWriteTracker');
      if (optId === 'prompts') return t('hook.wizard.promptTracker');
    }
    if (wizardId === 'skill-context') {
      if (optId === 'keyword') return t('hook.wizard.keywordMatching');
      if (optId === 'auto') return t('hook.wizard.autoDetection');
    }
    if (wizardId === 'danger-protection') {
      if (optId === 'bash-confirm') return t('hook.wizard.dangerBashConfirm');
      if (optId === 'file-protection') return t('hook.wizard.dangerFileProtection');
      if (optId === 'git-destructive') return t('hook.wizard.dangerGitDestructive');
      if (optId === 'network-confirm') return t('hook.wizard.dangerNetworkConfirm');
    }
    return wizard.options.find(o => o.id === optId)?.name || '';
  };

  const getOptionDesc = (wizardId, optId) => {
    if (wizardId === 'memory-update') {
      if (optId === 'on-stop') return t('hook.wizard.onSessionEndDesc');
      if (optId === 'periodic') return t('hook.wizard.periodicUpdateDesc');
      if (optId === 'count-based') return t('hook.wizard.countBasedUpdateDesc');
    }
    if (wizardId === 'memory-setup') {
      if (optId === 'file-read') return t('hook.wizard.fileReadTrackerDesc');
      if (optId === 'file-write') return t('hook.wizard.fileWriteTrackerDesc');
      if (optId === 'prompts') return t('hook.wizard.promptTrackerDesc');
    }
    if (wizardId === 'skill-context') {
      if (optId === 'keyword') return t('hook.wizard.keywordMatchingDesc');
      if (optId === 'auto') return t('hook.wizard.autoDetectionDesc');
    }
    if (wizardId === 'danger-protection') {
      if (optId === 'bash-confirm') return t('hook.wizard.dangerBashConfirmDesc');
      if (optId === 'file-protection') return t('hook.wizard.dangerFileProtectionDesc');
      if (optId === 'git-destructive') return t('hook.wizard.dangerGitDestructiveDesc');
      if (optId === 'network-confirm') return t('hook.wizard.dangerNetworkConfirmDesc');
    }
    return wizard.options.find(o => o.id === optId)?.description || '';
  };

  // Determine what to show in the tools/skills section
  let toolsSection = '';
  if (wizard.requiresSkillDiscovery) {
    toolsSection = `
      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.event')}</span>
        <span class="px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded">UserPromptSubmit</span>
      </div>
      <div id="skill-discovery-${wizardId}" class="text-xs text-muted-foreground mb-4">
        <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.availableSkills')}</span>
        <span class="text-muted-foreground ml-2">${t('hook.wizard.loading')}</span>
      </div>
    `;
  } else if (wizard.multiSelect) {
    // memory-setup: lightweight tracking, no CLI tools
    toolsSection = '';
  } else {
    toolsSection = `
      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <span class="font-mono bg-muted px-1.5 py-0.5 rounded">${t('hook.wizard.cliTools')}</span>
        <span class="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded">gemini</span>
        <span class="px-2 py-0.5 bg-purple-500/10 text-purple-500 rounded">qwen</span>
        <span class="px-2 py-0.5 bg-green-500/10 text-green-500 rounded">codex</span>
      </div>
    `;
  }

  return `
    <div class="hook-wizard-card bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-lg p-5 hover:shadow-lg transition-all">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="p-2.5 bg-primary/10 rounded-lg">
            <i data-lucide="${wizard.icon}" class="w-6 h-6 text-primary"></i>
          </div>
          <div>
            <h4 class="font-semibold text-foreground">${escapeHtml(wizardName)}</h4>
            <p class="text-sm text-muted-foreground">${escapeHtml(wizardDesc)}</p>
          </div>
        </div>
      </div>

      <div class="space-y-2 mb-4">
        ${wizard.options.map(opt => `
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <i data-lucide="check" class="w-4 h-4 text-success"></i>
            <span>${escapeHtml(getOptionName(wizardId, opt.id))}: ${escapeHtml(getOptionDesc(wizardId, opt.id))}</span>
          </div>
        `).join('')}
      </div>

      ${toolsSection}

      <button class="w-full px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              onclick="openHookWizardModal('${wizardId}')">
        <i data-lucide="wand-2" class="w-4 h-4"></i>
        ${t('hook.openWizard')}
      </button>
    </div>
  `;
}

function countHooks(hooks) {
  let count = 0;
  for (const event of Object.keys(hooks)) {
    const hookList = hooks[event];
    count += Array.isArray(hookList) ? hookList.length : 1;
  }
  return count;
}

function renderHooksByEvent(hooks, scope) {
  const events = Object.keys(hooks);
  if (events.length === 0) return '';

  return events.map(event => {
    const hookList = Array.isArray(hooks[event]) ? hooks[event] : [hooks[event]];

    return hookList.map((hook, index) => {
      const matcher = hook.matcher || 'All tools';
      // Support both old format (hook.command) and new Claude Code format (hook.hooks[0].command)
      const command = hook.hooks?.[0]?.command || hook.command || 'N/A';
      const args = hook.args || [];
      const timeout = hook.hooks?.[0]?.timeout || hook.timeout;

      return `
        <div class="hook-card bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-2">
              ${getHookEventIconLucide(event)}
              <div>
                <h4 class="font-semibold text-foreground">${event}</h4>
                <p class="text-xs text-muted-foreground">${getHookEventDescription(event)}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-hover rounded transition-colors"
                      data-scope="${scope}"
                      data-event="${event}"
                      data-index="${index}"
                      data-action="edit"
                      title="Edit hook">
                <i data-lucide="pencil" class="w-4 h-4"></i>
              </button>
              <button class="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                      data-scope="${scope}"
                      data-event="${event}"
                      data-index="${index}"
                      data-action="delete"
                      title="Delete hook">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div class="hook-details text-sm space-y-2">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">matcher</span>
              <span class="text-muted-foreground">${escapeHtml(matcher)}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">command</span>
              <span class="font-mono text-xs text-foreground break-all line-clamp-3 overflow-hidden" title="${escapeHtml(command)}">${escapeHtml(command)}</span>
            </div>
            ${args.length > 0 ? `
              <div class="flex items-start gap-2">
                <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">args</span>
                <span class="font-mono text-xs text-muted-foreground truncate" title="${escapeHtml(args.join(' '))}">${escapeHtml(args.slice(0, 3).join(' '))}${args.length > 3 ? '...' : ''}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }).join('');
}

function renderQuickInstallCard(templateId, title, description, event, matcher) {
  const isInstalled = isHookTemplateInstalled(templateId);
  const template = HOOK_TEMPLATES[templateId];
  const category = template?.category || 'general';
  const categoryTranslated = t(`hook.category.${category}`) || category;

  return `
    <div class="hook-template-card bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all ${isInstalled ? 'border-success bg-success-light/30' : ''}">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-2">
          ${isInstalled ? '<i data-lucide="check-circle" class="w-5 h-5 text-success"></i>' : '<i data-lucide="webhook" class="w-5 h-5"></i>'}
          <div>
            <h4 class="font-semibold text-foreground">${escapeHtml(title)}</h4>
            <p class="text-xs text-muted-foreground">${escapeHtml(description)}</p>
          </div>
        </div>
        <button class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-hover rounded transition-colors"
                onclick="viewTemplateDetails('${templateId}')"
                title="${t('hook.viewDetails')}">
          <i data-lucide="eye" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="hook-template-meta text-xs text-muted-foreground mb-3 flex items-center gap-3">
        <span class="flex items-center gap-1">
          <span class="font-mono bg-muted px-1 py-0.5 rounded">${event}</span>
        </span>
        <span class="flex items-center gap-1">
          ${t('hook.wizard.matches')} <span class="font-medium">${matcher}</span>
        </span>
        <span class="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs">${categoryTranslated}</span>
      </div>

      <div class="flex items-center gap-2">
        ${isInstalled ? `
          <button class="flex-1 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors"
                  data-template="${templateId}"
                  data-action="uninstall">
            ${t('hook.uninstall')}
          </button>
        ` : `
          <button class="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                  data-template="${templateId}"
                  data-action="install-project">
            ${t('hook.installProject')}
          </button>
          <button class="px-3 py-1.5 text-sm bg-muted text-foreground rounded hover:bg-hover transition-colors"
                  data-template="${templateId}"
                  data-action="install-global">
            ${t('hook.installGlobal')}
          </button>
        `}
      </div>
    </div>
  `;
}

function isHookTemplateInstalled(templateId) {
  const template = HOOK_TEMPLATES[templateId];
  if (!template) return false;

  // Define unique patterns for each template type (more specific than just command)
  const uniquePatterns = {
    'session-context': 'hook session-context',
    'codexlens-update': 'codexlens update',
    'ccw-notify': 'api/hook',
    'log-tool': 'tool-usage.log',
    'lint-check': 'eslint',
    'git-add': 'git add',
    'memory-file-read': 'memory track --type file --action read',
    'memory-file-write': 'memory track --type file --action write',
    'memory-prompt-track': 'memory track --type topic',
    'skill-context-auto': 'skill-context-auto'
  };

  // Use unique pattern if defined, otherwise fall back to command + args
  const searchPattern = uniquePatterns[templateId] ||
    (template.command + (template.args ? ' ' + template.args.join(' ') : ''));

  // Check project hooks
  const projectHooks = hookConfig.project?.hooks?.[template.event];
  if (projectHooks) {
    const hookList = Array.isArray(projectHooks) ? projectHooks : [projectHooks];
    if (hookList.some(h => {
      // Check both old format (h.command) and new format (h.hooks[0].command)
      const cmd = h.hooks?.[0]?.command || h.command || '';
      return cmd.includes(searchPattern);
    })) return true;
  }

  // Check global hooks
  const globalHooks = hookConfig.global?.hooks?.[template.event];
  if (globalHooks) {
    const hookList = Array.isArray(globalHooks) ? globalHooks : [globalHooks];
    if (hookList.some(h => {
      const cmd = h.hooks?.[0]?.command || h.command || '';
      return cmd.includes(searchPattern);
    })) return true;
  }

  return false;
}

async function installHookTemplate(templateId, scope) {
  const template = HOOK_TEMPLATES[templateId];
  if (!template) {
    showRefreshToast('Template not found', 'error');
    return;
  }

  // Check if already installed
  if (isHookTemplateInstalled(templateId)) {
    showRefreshToast('Hook already installed', 'info');
    return;
  }

  const hookData = {
    command: template.command,
    args: template.args
  };

  if (template.matcher) {
    hookData.matcher = template.matcher;
  }

  await saveHook(scope, template.event, hookData);
}

async function uninstallHookTemplate(templateId) {
  const template = HOOK_TEMPLATES[templateId];
  if (!template) return;

  // Extract unique identifier from template args for matching
  // Template args format: ['-c', 'actual command...']
  const templateArgs = template.args || [];
  const templateFullCmd = templateArgs.length > 0 ? templateArgs.join(' ') : '';

  // Define unique patterns for each template type
  const uniquePatterns = {
    'session-context': 'hook session-context',
    'codexlens-update': 'codexlens update',
    'ccw-notify': 'api/hook',
    'log-tool': 'tool-usage.log',
    'lint-check': 'eslint',
    'git-add': 'git add',
    'memory-file-read': 'memory track',
    'memory-file-write': 'memory track',
    'memory-prompt-track': 'memory track'
  };

  const uniquePattern = uniquePatterns[templateId] || template.command;

  // Helper to check if a hook matches the template
  const matchesTemplate = (h) => {
    const hookCmd = h.hooks?.[0]?.command || h.command || '';
    return hookCmd.includes(uniquePattern);
  };

  // Find and remove from project hooks
  const projectHooks = hookConfig.project?.hooks?.[template.event];
  if (projectHooks) {
    const hookList = Array.isArray(projectHooks) ? projectHooks : [projectHooks];
    const index = hookList.findIndex(matchesTemplate);
    if (index !== -1) {
      await removeHook('project', template.event, index);
      return;
    }
  }

  // Find and remove from global hooks
  const globalHooks = hookConfig.global?.hooks?.[template.event];
  if (globalHooks) {
    const hookList = Array.isArray(globalHooks) ? globalHooks : [globalHooks];
    const index = hookList.findIndex(matchesTemplate);
    if (index !== -1) {
      await removeHook('global', template.event, index);
      return;
    }
  }

  showRefreshToast('Hook not found', 'error');
}

function attachHookEventListeners() {
  // Edit buttons
  document.querySelectorAll('.hook-card button[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;
      const scope = button.dataset.scope;
      const event = button.dataset.event;
      const index = parseInt(button.dataset.index);

      const hooks = scope === 'global' ? hookConfig.global.hooks : hookConfig.project.hooks;
      const hookList = Array.isArray(hooks[event]) ? hooks[event] : [hooks[event]];
      const hook = hookList[index];

      if (hook) {
        // Support both Claude Code format (hooks[0].command) and legacy format (command + args)
        let command = '';
        let args = [];

        if (hook.hooks && hook.hooks[0]) {
          // Claude Code format: { hooks: [{ type: "command", command: "bash -c '...'" }] }
          const fullCommand = hook.hooks[0].command || '';
          // Try to split command and args for bash -c commands
          const bashMatch = fullCommand.match(/^(bash|sh|cmd)\s+(-c)\s+(.+)$/s);
          if (bashMatch) {
            command = bashMatch[1];
            args = [bashMatch[2], bashMatch[3]];
          } else {
            // For other commands, put the whole thing as command
            command = fullCommand;
            args = [];
          }
        } else {
          // Legacy format: { command: "bash", args: ["-c", "..."] }
          command = hook.command || '';
          args = hook.args || [];
        }

        openHookCreateModal({
          scope: scope,
          event: event,
          index: index,
          matcher: hook.matcher || '',
          command: command,
          args: args
        });
      }
    });
  });

  // Delete buttons
  document.querySelectorAll('.hook-card button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const scope = button.dataset.scope;
      const event = button.dataset.event;
      const index = parseInt(button.dataset.index);

      if (confirm(t('hook.deleteConfirm', { event: event }))) {
        await removeHook(scope, event, index);
      }
    });
  });

  // Install project buttons
  document.querySelectorAll('button[data-action="install-project"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const templateId = e.currentTarget.dataset.template;
      await installHookTemplate(templateId, 'project');
    });
  });

  // Install global buttons
  document.querySelectorAll('button[data-action="install-global"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const templateId = e.currentTarget.dataset.template;
      await installHookTemplate(templateId, 'global');
    });
  });

  // Uninstall buttons
  document.querySelectorAll('button[data-action="uninstall"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const templateId = e.currentTarget.dataset.template;
      await uninstallHookTemplate(templateId);
    });
  });
}
