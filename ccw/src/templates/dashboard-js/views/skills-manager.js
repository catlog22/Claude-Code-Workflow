// Skills Manager View
// Manages Claude Code skills (.claude/skills/)

// ========== Skills State ==========
var skillsData = {
  projectSkills: [],
  userSkills: []
};
var selectedSkill = null;
var skillsLoading = false;

// ========== Main Render Function ==========
async function renderSkillsManager() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search
  const statsGrid = document.getElementById('statsGrid');
  const searchInput = document.getElementById('searchInput');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchInput) searchInput.parentElement.style.display = 'none';

  // Show loading state
  container.innerHTML = '<div class="skills-manager loading">' +
    '<div class="loading-spinner"><i data-lucide="loader-2" class="w-8 h-8 animate-spin"></i></div>' +
    '<p>' + t('common.loading') + '</p>' +
    '</div>';

  // Load skills data
  await loadSkillsData();

  // Render the main view
  renderSkillsView();
}

async function loadSkillsData() {
  skillsLoading = true;
  try {
    const response = await fetch('/api/skills?path=' + encodeURIComponent(projectPath));
    if (!response.ok) throw new Error('Failed to load skills');
    const data = await response.json();
    skillsData = {
      projectSkills: data.projectSkills || [],
      userSkills: data.userSkills || []
    };
    // Update badge
    updateSkillsBadge();
  } catch (err) {
    console.error('Failed to load skills:', err);
    skillsData = { projectSkills: [], userSkills: [] };
  } finally {
    skillsLoading = false;
  }
}

function updateSkillsBadge() {
  const badge = document.getElementById('badgeSkills');
  if (badge) {
    const total = skillsData.projectSkills.length + skillsData.userSkills.length;
    badge.textContent = total;
  }
}

function renderSkillsView() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  const projectSkills = skillsData.projectSkills || [];
  const userSkills = skillsData.userSkills || [];

  container.innerHTML = `
    <div class="skills-manager">
      <!-- Header -->
      <div class="skills-header mb-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <i data-lucide="sparkles" class="w-5 h-5 text-primary"></i>
            </div>
            <div>
              <h2 class="text-lg font-semibold text-foreground">${t('skills.title')}</h2>
              <p class="text-sm text-muted-foreground">${t('skills.description')}</p>
            </div>
          </div>
          <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                  onclick="openSkillCreateModal()">
            <i data-lucide="plus" class="w-4 h-4"></i>
            ${t('skills.create')}
          </button>
        </div>
      </div>

      <!-- Project Skills Section -->
      <div class="skills-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i data-lucide="folder" class="w-5 h-5 text-primary"></i>
            <h3 class="text-lg font-semibold text-foreground">${t('skills.projectSkills')}</h3>
            <span class="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">.claude/skills/</span>
          </div>
          <span class="text-sm text-muted-foreground">${projectSkills.length} ${t('skills.skillsCount')}</span>
        </div>

        ${projectSkills.length === 0 ? `
          <div class="skills-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <div class="text-muted-foreground mb-3"><i data-lucide="sparkles" class="w-10 h-10 mx-auto"></i></div>
            <p class="text-muted-foreground">${t('skills.noProjectSkills')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('skills.createHint')}</p>
          </div>
        ` : `
          <div class="skills-grid grid gap-3">
            ${projectSkills.map(skill => renderSkillCard(skill, 'project')).join('')}
          </div>
        `}
      </div>

      <!-- User Skills Section -->
      <div class="skills-section mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i data-lucide="user" class="w-5 h-5 text-indigo"></i>
            <h3 class="text-lg font-semibold text-foreground">${t('skills.userSkills')}</h3>
            <span class="text-xs px-2 py-0.5 bg-indigo/10 text-indigo rounded-full">~/.claude/skills/</span>
          </div>
          <span class="text-sm text-muted-foreground">${userSkills.length} ${t('skills.skillsCount')}</span>
        </div>

        ${userSkills.length === 0 ? `
          <div class="skills-empty-state bg-card border border-border rounded-lg p-6 text-center">
            <div class="text-muted-foreground mb-3"><i data-lucide="user" class="w-10 h-10 mx-auto"></i></div>
            <p class="text-muted-foreground">${t('skills.noUserSkills')}</p>
            <p class="text-sm text-muted-foreground mt-1">${t('skills.userSkillsHint')}</p>
          </div>
        ` : `
          <div class="skills-grid grid gap-3">
            ${userSkills.map(skill => renderSkillCard(skill, 'user')).join('')}
          </div>
        `}
      </div>

      <!-- Skill Detail Panel -->
      ${selectedSkill ? renderSkillDetailPanel(selectedSkill) : ''}
    </div>
  `;

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSkillCard(skill, location) {
  const hasAllowedTools = skill.allowedTools && skill.allowedTools.length > 0;
  const hasSupportingFiles = skill.supportingFiles && skill.supportingFiles.length > 0;
  const locationIcon = location === 'project' ? 'folder' : 'user';
  const locationClass = location === 'project' ? 'text-primary' : 'text-indigo';
  const locationBg = location === 'project' ? 'bg-primary/10' : 'bg-indigo/10';
  const folderName = skill.folderName || skill.name;

  return `
    <div class="skill-card bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all cursor-pointer"
         onclick="showSkillDetail('${escapeHtml(folderName)}', '${location}')">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 ${locationBg} rounded-lg flex items-center justify-center">
            <i data-lucide="sparkles" class="w-5 h-5 ${locationClass}"></i>
          </div>
          <div>
            <h4 class="font-semibold text-foreground">${escapeHtml(skill.name)}</h4>
            ${skill.version ? `<span class="text-xs text-muted-foreground">v${escapeHtml(skill.version)}</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${locationBg} ${locationClass}">
            <i data-lucide="${locationIcon}" class="w-3 h-3 mr-1"></i>
            ${location}
          </span>
        </div>
      </div>

      <p class="text-sm text-muted-foreground mb-3 line-clamp-2">${escapeHtml(skill.description || t('skills.noDescription'))}</p>

      <div class="flex items-center gap-3 text-xs text-muted-foreground">
        ${hasAllowedTools ? `
          <span class="flex items-center gap-1">
            <i data-lucide="lock" class="w-3 h-3"></i>
            ${skill.allowedTools.length} ${t('skills.tools')}
          </span>
        ` : ''}
        ${hasSupportingFiles ? `
          <span class="flex items-center gap-1">
            <i data-lucide="file-text" class="w-3 h-3"></i>
            ${skill.supportingFiles.length} ${t('skills.files')}
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

function renderSkillDetailPanel(skill) {
  const hasAllowedTools = skill.allowedTools && skill.allowedTools.length > 0;
  const hasSupportingFiles = skill.supportingFiles && skill.supportingFiles.length > 0;
  const folderName = skill.folderName || skill.name;

  return `
    <div class="skill-detail-panel fixed top-0 right-0 w-1/2 max-w-xl h-full bg-card border-l border-border shadow-lg z-50 flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-lg font-semibold text-foreground">${escapeHtml(skill.name)}</h3>
        <button class="w-8 h-8 flex items-center justify-center text-xl text-muted-foreground hover:text-foreground hover:bg-hover rounded"
                onclick="closeSkillDetail()">&times;</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5">
        <div class="space-y-6">
          <!-- Description -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('skills.descriptionLabel')}</h4>
            <p class="text-sm text-muted-foreground">${escapeHtml(skill.description || t('skills.noDescription'))}</p>
          </div>

          <!-- Metadata -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('skills.metadata')}</h4>
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-muted/50 rounded-lg p-3">
                <span class="text-xs text-muted-foreground">${t('skills.location')}</span>
                <p class="text-sm font-medium text-foreground">${escapeHtml(skill.location)}</p>
              </div>
              ${skill.version ? `
                <div class="bg-muted/50 rounded-lg p-3">
                  <span class="text-xs text-muted-foreground">${t('skills.version')}</span>
                  <p class="text-sm font-medium text-foreground">${escapeHtml(skill.version)}</p>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Allowed Tools -->
          ${hasAllowedTools ? `
            <div>
              <h4 class="text-sm font-semibold text-foreground mb-2">${t('skills.allowedTools')}</h4>
              <div class="flex flex-wrap gap-2">
                ${skill.allowedTools.map(tool => `
                  <span class="px-2 py-1 text-xs bg-muted rounded-lg font-mono">${escapeHtml(tool)}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Skill Files (SKILL.md + Supporting Files) -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('skills.files') || 'Files'}</h4>
            <div class="space-y-2">
              <!-- SKILL.md (main file) -->
              <div class="flex items-center justify-between p-2 bg-primary/5 border border-primary/20 rounded-lg cursor-pointer hover:bg-primary/10 transition-colors"
                   onclick="viewSkillFile('${escapeHtml(folderName)}', 'SKILL.md', '${skill.location}')">
                <div class="flex items-center gap-2">
                  <i data-lucide="file-text" class="w-4 h-4 text-primary"></i>
                  <span class="text-sm font-mono text-foreground font-medium">SKILL.md</span>
                </div>
                <div class="flex items-center gap-1">
                  <button class="p-1 text-primary hover:bg-primary/20 rounded transition-colors"
                          onclick="event.stopPropagation(); editSkillFile('${escapeHtml(folderName)}', 'SKILL.md', '${skill.location}')"
                          title="${t('common.edit')}">
                    <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
              ${hasSupportingFiles ? skill.supportingFiles.map(file => {
                const isDir = file.endsWith('/');
                const dirName = isDir ? file.slice(0, -1) : file;
                return `
              <!-- Supporting file: ${escapeHtml(file)} -->
              <div class="skill-file-item" data-path="${escapeHtml(dirName)}">
                <div class="flex items-center justify-between p-2 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors"
                     onclick="${isDir ? `toggleSkillFolder('${escapeHtml(folderName)}', '${escapeHtml(dirName)}', '${skill.location}', this)` : `viewSkillFile('${escapeHtml(folderName)}', '${escapeHtml(file)}', '${skill.location}')`}">
                  <div class="flex items-center gap-2">
                    <i data-lucide="${isDir ? 'folder' : 'file-text'}" class="w-4 h-4 text-muted-foreground ${isDir ? 'folder-icon' : ''}"></i>
                    <span class="text-sm font-mono text-foreground">${escapeHtml(isDir ? dirName : file)}</span>
                    ${isDir ? '<i data-lucide="chevron-right" class="w-3 h-3 text-muted-foreground folder-chevron transition-transform"></i>' : ''}
                  </div>
                  ${!isDir ? `
                  <div class="flex items-center gap-1">
                    <button class="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            onclick="event.stopPropagation(); editSkillFile('${escapeHtml(folderName)}', '${escapeHtml(file)}', '${skill.location}')"
                            title="${t('common.edit')}">
                      <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>
                  ` : ''}
                </div>
                <div class="folder-contents hidden ml-4 mt-1 space-y-1"></div>
              </div>
              `;
              }).join('') : ''}
            </div>
          </div>

          <!-- Path -->
          <div>
            <h4 class="text-sm font-semibold text-foreground mb-2">${t('skills.path')}</h4>
            <code class="block p-3 bg-muted rounded-lg text-xs font-mono text-muted-foreground break-all">${escapeHtml(skill.path)}</code>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="px-5 py-4 border-t border-border flex justify-between">
        <button class="px-4 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors flex items-center gap-2"
                onclick="deleteSkill('${escapeHtml(folderName)}', '${skill.location}')">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
          ${t('common.delete')}
        </button>
        <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                onclick="editSkill('${escapeHtml(folderName)}', '${skill.location}')">
          <i data-lucide="edit" class="w-4 h-4"></i>
          ${t('common.edit')}
        </button>
      </div>
    </div>
    <div class="skill-detail-overlay fixed inset-0 bg-black/50 z-40" onclick="closeSkillDetail()"></div>
  `;
}

async function showSkillDetail(skillName, location) {
  try {
    const response = await fetch('/api/skills/' + encodeURIComponent(skillName) + '?location=' + location + '&path=' + encodeURIComponent(projectPath));
    if (!response.ok) throw new Error('Failed to load skill detail');
    const data = await response.json();
    selectedSkill = data.skill;
    renderSkillsView();
  } catch (err) {
    console.error('Failed to load skill detail:', err);
    if (window.showToast) {
      showToast(t('skills.loadError'), 'error');
    }
  }
}

function closeSkillDetail() {
  selectedSkill = null;
  renderSkillsView();
}

async function deleteSkill(skillName, location) {
  if (!confirm(t('skills.deleteConfirm', { name: skillName }))) return;

  try {
    const response = await fetch('/api/skills/' + encodeURIComponent(skillName), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, projectPath })
    });
    if (!response.ok) throw new Error('Failed to delete skill');

    selectedSkill = null;
    await loadSkillsData();
    renderSkillsView();

    if (window.showToast) {
      showToast(t('skills.deleted'), 'success');
    }
  } catch (err) {
    console.error('Failed to delete skill:', err);
    if (window.showToast) {
      showToast(t('skills.deleteError'), 'error');
    }
  }
}

function editSkill(skillName, location) {
  // Open edit modal (to be implemented with modal)
  if (window.showToast) {
    showToast(t('skills.editNotImplemented'), 'info');
  }
}

// ========== Create Skill Modal ==========
var skillCreateState = {
  mode: 'import', // 'import' or 'cli-generate'
  location: 'project',
  sourcePath: '',
  customName: '',
  validationResult: null,
  // CLI Generate mode fields
  generationType: 'description', // 'description' or 'template'
  description: '',
  skillName: ''
};

function openSkillCreateModal() {
  // Reset state
  skillCreateState = {
    mode: 'import',
    location: 'project',
    sourcePath: '',
    customName: '',
    validationResult: null,
    generationType: 'description',
    description: '',
    skillName: ''
  };

  // Create modal HTML
  const modalHtml = `
    <div class="modal-overlay fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onclick="closeSkillCreateModal(event)">
      <div class="modal-dialog bg-card rounded-lg shadow-lg w-full max-w-2xl mx-4" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 class="text-lg font-semibold text-foreground">${t('skills.createSkill')}</h3>
          <button class="w-8 h-8 flex items-center justify-center text-xl text-muted-foreground hover:text-foreground hover:bg-hover rounded"
                  onclick="closeSkillCreateModal()">&times;</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-5">
          <!-- Location Selection -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('skills.location')}</label>
            <div class="grid grid-cols-2 gap-3">
              <button class="location-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${skillCreateState.location === 'project' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="selectSkillLocation('project')">
                <div class="flex items-center gap-2">
                  <i data-lucide="folder" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('skills.projectSkills')}</div>
                    <div class="text-xs text-muted-foreground">.claude/skills/</div>
                  </div>
                </div>
              </button>
              <button class="location-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${skillCreateState.location === 'user' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="selectSkillLocation('user')">
                <div class="flex items-center gap-2">
                  <i data-lucide="user" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('skills.userSkills')}</div>
                    <div class="text-xs text-muted-foreground">~/.claude/skills/</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <!-- Mode Selection -->
          <div>
            <label class="block text-sm font-medium text-foreground mb-2">${t('skills.createMode')}</label>
            <div class="grid grid-cols-2 gap-3">
              <button class="mode-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${skillCreateState.mode === 'import' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="switchSkillCreateMode('import')">
                <div class="flex items-center gap-2">
                  <i data-lucide="folder-input" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('skills.importFolder')}</div>
                    <div class="text-xs text-muted-foreground">${t('skills.importFolderHint')}</div>
                  </div>
                </div>
              </button>
              <button class="mode-btn px-4 py-3 text-left border-2 rounded-lg transition-all ${skillCreateState.mode === 'cli-generate' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}"
                      onclick="switchSkillCreateMode('cli-generate')">
                <div class="flex items-center gap-2">
                  <i data-lucide="sparkles" class="w-5 h-5"></i>
                  <div>
                    <div class="font-medium">${t('skills.cliGenerate')}</div>
                    <div class="text-xs text-muted-foreground">${t('skills.cliGenerateHint')}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <!-- Import Mode Content -->
          <div id="skillImportMode" style="display: ${skillCreateState.mode === 'import' ? 'block' : 'none'}">
            <!-- Source Folder Path -->
            <div>
              <label class="block text-sm font-medium text-foreground mb-2">${t('skills.sourceFolder')}</label>
              <div class="flex gap-2">
                <input type="text" id="skillSourcePath"
                       class="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                       placeholder="${t('skills.sourceFolderPlaceholder')}"
                       value="${skillCreateState.sourcePath}">
                <button class="px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors text-sm"
                        onclick="browseSkillFolder()">
                  <i data-lucide="folder-open" class="w-4 h-4"></i>
                </button>
              </div>
              <p class="text-xs text-muted-foreground mt-1">${t('skills.sourceFolderHint')}</p>
            </div>

            <!-- Custom Name -->
            <div>
              <label class="block text-sm font-medium text-foreground mb-2">${t('skills.customName')} <span class="text-muted-foreground">${t('common.optional')}</span></label>
              <input type="text" id="skillCustomName"
                     class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                     placeholder="${t('skills.customNamePlaceholder')}"
                     value="${skillCreateState.customName}">
              <p class="text-xs text-muted-foreground mt-1">${t('skills.customNameHint')}</p>
            </div>

            <!-- Validation Result -->
            <div id="skillValidationResult"></div>
          </div>

          <!-- CLI Generate Mode Content -->
          <div id="skillCliGenerateMode" style="display: ${skillCreateState.mode === 'cli-generate' ? 'block' : 'none'}">
            <!-- Skill Name (Required for CLI Generate) -->
            <div>
              <label class="block text-sm font-medium text-foreground mb-2">${t('skills.skillName')} <span class="text-destructive">*</span></label>
              <input type="text" id="skillGenerateName"
                     class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                     placeholder="${t('skills.skillNamePlaceholder')}"
                     value="${skillCreateState.skillName}">
              <p class="text-xs text-muted-foreground mt-1">${t('skills.skillNameHint')}</p>
            </div>

            <!-- Description Text Area -->
            <div id="skillDescriptionArea">
              <label class="block text-sm font-medium text-foreground mb-2">${t('skills.descriptionLabel')} <span class="text-destructive">*</span></label>
              <textarea id="skillDescription"
                        class="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="${t('skills.descriptionPlaceholder')}"
                        rows="6">${skillCreateState.description}</textarea>
              <p class="text-xs text-muted-foreground mt-1">${t('skills.descriptionGenerateHint')}</p>
            </div>

            <!-- CLI Generate Info -->
            <div class="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div class="flex items-start gap-2">
                <i data-lucide="info" class="w-4 h-4 text-blue-600 mt-0.5"></i>
                <div class="text-sm text-blue-600">
                  <p class="font-medium">${t('skills.cliGenerateInfo')}</p>
                  <p class="text-xs mt-1">${t('skills.cliGenerateTimeHint')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div id="skillModalFooter" class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onclick="closeSkillCreateModal()">
            ${t('common.cancel')}
          </button>
          ${skillCreateState.mode === 'import' ? `
            <button class="px-4 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                    onclick="validateSkillImport()">
              ${t('skills.validate')}
            </button>
            <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
                    onclick="createSkill()">
              ${t('skills.import')}
            </button>
          ` : `
            <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                    onclick="createSkill()">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
              ${t('skills.generate')}
            </button>
          `}
        </div>
      </div>
    </div>
  `;

  // Add to DOM
  const modalContainer = document.createElement('div');
  modalContainer.id = 'skillCreateModal';
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeSkillCreateModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('skillCreateModal');
  if (modal) modal.remove();
}

function selectSkillLocation(location) {
  skillCreateState.location = location;

  // Update button styles without re-rendering modal
  const buttons = document.querySelectorAll('.location-btn');
  buttons.forEach(btn => {
    const isProject = btn.querySelector('.font-medium')?.textContent?.includes(t('skills.projectSkills'));
    const isUser = btn.querySelector('.font-medium')?.textContent?.includes(t('skills.userSkills'));

    if ((isProject && location === 'project') || (isUser && location === 'user')) {
      btn.classList.remove('border-border', 'hover:border-primary/50');
      btn.classList.add('border-primary', 'bg-primary/10');
    } else {
      btn.classList.remove('border-primary', 'bg-primary/10');
      btn.classList.add('border-border', 'hover:border-primary/50');
    }
  });
}

function switchSkillCreateMode(mode) {
  skillCreateState.mode = mode;

  // Toggle visibility of mode sections
  const importSection = document.getElementById('skillImportMode');
  const cliGenerateSection = document.getElementById('skillCliGenerateMode');
  const footerContainer = document.getElementById('skillModalFooter');

  if (importSection) importSection.style.display = mode === 'import' ? 'block' : 'none';
  if (cliGenerateSection) cliGenerateSection.style.display = mode === 'cli-generate' ? 'block' : 'none';

  // Update mode button styles
  const modeButtons = document.querySelectorAll('#skillCreateModal .mode-btn');
  modeButtons.forEach(btn => {
    const btnText = btn.querySelector('.font-medium')?.textContent || '';
    const isImport = btnText.includes(t('skills.importFolder'));
    const isCliGenerate = btnText.includes(t('skills.cliGenerate'));

    if ((isImport && mode === 'import') || (isCliGenerate && mode === 'cli-generate')) {
      btn.classList.remove('border-border', 'hover:border-primary/50');
      btn.classList.add('border-primary', 'bg-primary/10');
    } else {
      btn.classList.remove('border-primary', 'bg-primary/10');
      btn.classList.add('border-border', 'hover:border-primary/50');
    }
  });

  // Update footer buttons
  if (footerContainer) {
    if (mode === 'import') {
      footerContainer.innerHTML = `
        <button class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onclick="closeSkillCreateModal()">
          ${t('common.cancel')}
        </button>
        <button class="px-4 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                onclick="validateSkillImport()">
          ${t('skills.validate')}
        </button>
        <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
                onclick="createSkill()">
          ${t('skills.import')}
        </button>
      `;
    } else {
      footerContainer.innerHTML = `
        <button class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onclick="closeSkillCreateModal()">
          ${t('common.cancel')}
        </button>
        <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                onclick="createSkill()">
          <i data-lucide="sparkles" class="w-4 h-4"></i>
          ${t('skills.generate')}
        </button>
      `;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function browseSkillFolder() {
  // Use browser prompt for now (Phase 3 will implement file browser)
  const path = prompt(t('skills.enterFolderPath'), skillCreateState.sourcePath);
  if (path !== null) {
    skillCreateState.sourcePath = path;
    document.getElementById('skillSourcePath').value = path;
  }
}

async function validateSkillImport() {
  const sourcePathInput = document.getElementById('skillSourcePath');
  const sourcePath = sourcePathInput ? sourcePathInput.value.trim() : skillCreateState.sourcePath;

  if (!sourcePath) {
    showValidationResult({ valid: false, errors: [t('skills.sourceFolderRequired')], skillInfo: null });
    return;
  }

  skillCreateState.sourcePath = sourcePath;

  // Show loading state
  showValidationResult({ loading: true });

  try {
    const response = await fetch('/api/skills/validate-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath })
    });

    if (!response.ok) throw new Error('Validation request failed');

    const result = await response.json();
    skillCreateState.validationResult = result;
    showValidationResult(result);
  } catch (err) {
    console.error('Failed to validate skill:', err);
    showValidationResult({ valid: false, errors: [t('skills.validationError')], skillInfo: null });
  }
}

function showValidationResult(result) {
  const container = document.getElementById('skillValidationResult');
  if (!container) return;

  if (result.loading) {
    container.innerHTML = `
      <div class="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
        <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
        <span class="text-sm text-muted-foreground">${t('skills.validating')}</span>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  if (result.valid) {
    container.innerHTML = `
      <div class="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
        <div class="flex items-center gap-2 text-green-600 mb-2">
          <i data-lucide="check-circle" class="w-5 h-5"></i>
          <span class="font-medium">${t('skills.validSkill')}</span>
        </div>
        <div class="space-y-1 text-sm">
          <div><span class="text-muted-foreground">${t('skills.name')}:</span> <span class="font-medium">${escapeHtml(result.skillInfo.name)}</span></div>
          <div><span class="text-muted-foreground">${t('skills.description')}:</span> <span>${escapeHtml(result.skillInfo.description)}</span></div>
          ${result.skillInfo.version ? `<div><span class="text-muted-foreground">${t('skills.version')}:</span> <span>${escapeHtml(result.skillInfo.version)}</span></div>` : ''}
          ${result.skillInfo.supportingFiles && result.skillInfo.supportingFiles.length > 0 ? `<div><span class="text-muted-foreground">${t('skills.supportingFiles')}:</span> <span>${result.skillInfo.supportingFiles.length} ${t('skills.files')}</span></div>` : ''}
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <div class="flex items-center gap-2 text-destructive mb-2">
          <i data-lucide="x-circle" class="w-5 h-5"></i>
          <span class="font-medium">${t('skills.invalidSkill')}</span>
        </div>
        <ul class="space-y-1 text-sm">
          ${result.errors.map(error => `<li class="text-destructive">• ${escapeHtml(error)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function createSkill() {
  if (skillCreateState.mode === 'import') {
    // Import Mode Logic
    const sourcePathInput = document.getElementById('skillSourcePath');
    const customNameInput = document.getElementById('skillCustomName');

    const sourcePath = sourcePathInput ? sourcePathInput.value.trim() : skillCreateState.sourcePath;
    const customName = customNameInput ? customNameInput.value.trim() : skillCreateState.customName;

    if (!sourcePath) {
      if (window.showToast) {
        showToast(t('skills.sourceFolderRequired'), 'error');
      }
      return;
    }

    // Validate first if not already validated
    if (!skillCreateState.validationResult || !skillCreateState.validationResult.valid) {
      if (window.showToast) {
        showToast(t('skills.validateFirst'), 'error');
      }
      return;
    }

    try {
      const response = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'import',
          location: skillCreateState.location,
          sourcePath,
          skillName: customName || undefined,
          projectPath
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create skill');
      }

      const result = await response.json();

      // Close modal
      closeSkillCreateModal();

      // Reload skills data
      await loadSkillsData();
      renderSkillsView();

      // Show success message
      if (window.showToast) {
        showToast(t('skills.created', { name: result.skillName }), 'success');
      }
    } catch (err) {
      console.error('Failed to create skill:', err);
      if (window.showToast) {
        showToast(err.message || t('skills.createError'), 'error');
      }
    }
  } else if (skillCreateState.mode === 'cli-generate') {
    // CLI Generate Mode Logic
    const skillNameInput = document.getElementById('skillGenerateName');
    const descriptionInput = document.getElementById('skillDescription');

    const skillName = skillNameInput ? skillNameInput.value.trim() : skillCreateState.skillName;
    const description = descriptionInput ? descriptionInput.value.trim() : skillCreateState.description;

    // Validation
    if (!skillName) {
      if (window.showToast) {
        showToast(t('skills.skillNameRequired'), 'error');
      }
      return;
    }

    if (skillCreateState.generationType === 'description' && !description) {
      if (window.showToast) {
        showToast(t('skills.descriptionRequired'), 'error');
      }
      return;
    }

    try {
      // Show generating progress toast
      if (window.showToast) {
        showToast(t('skills.generating'), 'info');
      }

      const response = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'cli-generate',
          location: skillCreateState.location,
          generationType: skillCreateState.generationType,
          skillName,
          description: skillCreateState.generationType === 'description' ? description : undefined,
          projectPath
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate skill');
      }

      const result = await response.json();

      // Close modal
      closeSkillCreateModal();

      // Reload skills data
      await loadSkillsData();
      renderSkillsView();

      // Show success message
      if (window.showToast) {
        showToast(t('skills.generated', { name: result.skillName }), 'success');
      }
    } catch (err) {
      console.error('Failed to generate skill:', err);
      if (window.showToast) {
        showToast(err.message || t('skills.generateError'), 'error');
      }
    }
  }
}


// ========== Skill File View/Edit Functions ==========

var skillFileEditorState = {
  skillName: '',
  fileName: '',
  location: '',
  content: '',
  isEditing: false
};

async function viewSkillFile(skillName, fileName, location) {
  try {
    const response = await fetch(
      '/api/skills/' + encodeURIComponent(skillName) + '/file?filename=' + encodeURIComponent(fileName) +
      '&location=' + location + '&path=' + encodeURIComponent(projectPath)
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to load file');
    }

    const data = await response.json();

    skillFileEditorState = {
      skillName,
      fileName,
      location,
      content: data.content,
      isEditing: false
    };

    renderSkillFileModal();
  } catch (err) {
    console.error('Failed to load skill file:', err);
    if (window.showToast) {
      showToast(err.message || t('skills.fileLoadError') || 'Failed to load file', 'error');
    }
  }
}

function editSkillFile(skillName, fileName, location) {
  viewSkillFile(skillName, fileName, location).then(() => {
    skillFileEditorState.isEditing = true;
    renderSkillFileModal();
  });
}

function renderSkillFileModal() {
  // Remove existing modal if any
  const existingModal = document.getElementById('skillFileModal');
  if (existingModal) existingModal.remove();

  const { skillName, fileName, content, isEditing, location } = skillFileEditorState;

  const modalHtml = `
    <div class="modal-overlay fixed inset-0 bg-black/50 z-[60] flex items-center justify-center" onclick="closeSkillFileModal(event)">
      <div class="modal-dialog bg-card rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] mx-4 flex flex-col" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div class="flex items-center gap-3">
            <i data-lucide="file-text" class="w-5 h-5 text-primary"></i>
            <div>
              <h3 class="text-lg font-semibold text-foreground font-mono">${escapeHtml(fileName)}</h3>
              <p class="text-xs text-muted-foreground">${escapeHtml(skillName)} / ${location}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            ${!isEditing ? `
              <button class="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1"
                      onclick="toggleSkillFileEdit()">
                <i data-lucide="edit-2" class="w-4 h-4"></i>
                ${t('common.edit')}
              </button>
            ` : ''}
            <button class="w-8 h-8 flex items-center justify-center text-xl text-muted-foreground hover:text-foreground hover:bg-hover rounded"
                    onclick="closeSkillFileModal()">&times;</button>
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-hidden p-4">
          ${isEditing ? `
            <textarea id="skillFileContent"
                      class="w-full h-full min-h-[400px] px-4 py-3 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      spellcheck="false">${escapeHtml(content)}</textarea>
          ` : `
            <div class="w-full h-full min-h-[400px] overflow-auto">
              <pre class="px-4 py-3 bg-muted/30 rounded-lg text-sm font-mono whitespace-pre-wrap break-words">${escapeHtml(content)}</pre>
            </div>
          `}
        </div>

        <!-- Footer -->
        ${isEditing ? `
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <button class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    onclick="cancelSkillFileEdit()">
              ${t('common.cancel')}
            </button>
            <button class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                    onclick="saveSkillFile()">
              <i data-lucide="save" class="w-4 h-4"></i>
              ${t('common.save')}
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  const modalContainer = document.createElement('div');
  modalContainer.id = 'skillFileModal';
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeSkillFileModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('skillFileModal');
  if (modal) modal.remove();
  skillFileEditorState = { skillName: '', fileName: '', location: '', content: '', isEditing: false };
}

function toggleSkillFileEdit() {
  skillFileEditorState.isEditing = true;
  renderSkillFileModal();
}

function cancelSkillFileEdit() {
  skillFileEditorState.isEditing = false;
  renderSkillFileModal();
}

async function saveSkillFile() {
  const contentTextarea = document.getElementById('skillFileContent');
  if (!contentTextarea) return;

  const newContent = contentTextarea.value;
  const { skillName, fileName, location } = skillFileEditorState;

  try {
    const response = await fetch('/api/skills/' + encodeURIComponent(skillName) + '/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        content: newContent,
        location,
        projectPath
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save file');
    }

    // Update state and close edit mode
    skillFileEditorState.content = newContent;
    skillFileEditorState.isEditing = false;
    renderSkillFileModal();

    // Refresh skill detail if SKILL.md was edited
    if (fileName === 'SKILL.md') {
      await loadSkillsData();
      // Reload current skill detail
      if (selectedSkill) {
        await showSkillDetail(skillName, location);
      }
    }

    if (window.showToast) {
      showToast(t('skills.fileSaved') || 'File saved successfully', 'success');
    }
  } catch (err) {
    console.error('Failed to save skill file:', err);
    if (window.showToast) {
      showToast(err.message || t('skills.fileSaveError') || 'Failed to save file', 'error');
    }
  }
}



// ========== Skill Folder Expansion Functions ==========

var expandedFolders = new Set();

async function toggleSkillFolder(skillName, subPath, location, element) {
  const fileItem = element.closest('.skill-file-item');
  if (!fileItem) return;

  const contentsDiv = fileItem.querySelector('.folder-contents');
  const chevron = element.querySelector('.folder-chevron');
  const folderIcon = element.querySelector('.folder-icon');
  const folderKey = `${skillName}:${subPath}:${location}`;

  if (expandedFolders.has(folderKey)) {
    // Collapse folder
    expandedFolders.delete(folderKey);
    contentsDiv.classList.add('hidden');
    contentsDiv.innerHTML = '';
    if (chevron) chevron.style.transform = '';
    if (folderIcon) folderIcon.setAttribute('data-lucide', 'folder');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    // Expand folder
    try {
      const response = await fetch(
        '/api/skills/' + encodeURIComponent(skillName) + '/dir?subpath=' + encodeURIComponent(subPath) +
        '&location=' + location + '&path=' + encodeURIComponent(projectPath)
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to load folder');
      }

      const data = await response.json();

      expandedFolders.add(folderKey);
      if (chevron) chevron.style.transform = 'rotate(90deg)';
      if (folderIcon) folderIcon.setAttribute('data-lucide', 'folder-open');

      // Render folder contents
      contentsDiv.innerHTML = data.files.map(file => {
        const filePath = file.path;
        const isDir = file.isDirectory;
        return `
          <div class="skill-file-item" data-path="${escapeHtml(filePath)}">
            <div class="flex items-center justify-between p-2 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                 onclick="${isDir ? `toggleSkillFolder('${escapeHtml(skillName)}', '${escapeHtml(filePath)}', '${location}', this)` : `viewSkillFile('${escapeHtml(skillName)}', '${escapeHtml(filePath)}', '${location}')`}">
              <div class="flex items-center gap-2">
                <i data-lucide="${isDir ? 'folder' : 'file-text'}" class="w-4 h-4 text-muted-foreground ${isDir ? 'folder-icon' : ''}"></i>
                <span class="text-sm font-mono text-foreground">${escapeHtml(file.name)}</span>
                ${isDir ? '<i data-lucide="chevron-right" class="w-3 h-3 text-muted-foreground folder-chevron transition-transform"></i>' : ''}
              </div>
              ${!isDir ? `
              <div class="flex items-center gap-1">
                <button class="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                        onclick="event.stopPropagation(); editSkillFile('${escapeHtml(skillName)}', '${escapeHtml(filePath)}', '${location}')"
                        title="${t('common.edit')}">
                  <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
              ` : ''}
            </div>
            <div class="folder-contents hidden ml-4 mt-1 space-y-1"></div>
          </div>
        `;
      }).join('');

      contentsDiv.classList.remove('hidden');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      console.error('Failed to load folder contents:', err);
      if (window.showToast) {
        showToast(err.message || 'Failed to load folder', 'error');
      }
    }
  }
}

