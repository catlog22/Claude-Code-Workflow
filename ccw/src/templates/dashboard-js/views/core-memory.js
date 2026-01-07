// Core Memory View
// Manages strategic context entries with knowledge graph and evolution tracking

/**
 * Parse JSON streaming content and extract readable text
 * Handles Gemini/Qwen format: {"type":"message","content":"...","delta":true}
 */
function parseJsonStreamContent(content) {
  if (!content || typeof content !== 'string') return content;

  // Check if content looks like JSON streaming (multiple JSON objects)
  if (!content.includes('{"type":')) return content;

  const lines = content.split('\n');
  const extractedParts = [];
  let hasJsonLines = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to parse as JSON
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        // Extract content from message type
        if (obj.type === 'message' && obj.content) {
          extractedParts.push(obj.content);
          hasJsonLines = true;
        }
        // Skip init/result/error types (metadata)
        else if (obj.type === 'init' || obj.type === 'result' || obj.type === 'error') {
          hasJsonLines = true;
          continue;
        }
      } catch (e) {
        // Not valid JSON, keep as plain text
        extractedParts.push(trimmed);
      }
    } else {
      // Plain text line
      extractedParts.push(trimmed);
    }
  }

  // If we found JSON lines, return extracted content
  if (hasJsonLines && extractedParts.length > 0) {
    return extractedParts.join('');
  }

  return content;
}

// Notification function
function showNotification(message, type = 'info') {
  // Create notification container if it doesn't exist
  let container = document.getElementById('notificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
    document.body.appendChild(container);
  }

  // Create notification element
  const notification = document.createElement('div');
  const bgColors = {
    success: 'hsl(var(--success))',
    error: 'hsl(var(--destructive))',
    warning: 'hsl(var(--warning))',
    info: 'hsl(var(--info))'
  };

  notification.style.cssText = `
    background: ${bgColors[type] || bgColors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    max-width: 350px;
    animation: slideInRight 0.3s ease-out;
    font-size: 14px;
    line-height: 1.5;
  `;
  notification.textContent = message;

  // Add to container
  container.appendChild(notification);

  // Auto remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => {
      container.removeChild(notification);
      if (container.children.length === 0) {
        document.body.removeChild(container);
      }
    }, 300);
  }, 3000);
}

async function renderCoreMemoryView() {
  const content = document.getElementById('mainContent');
  hideStatsAndCarousel();

  // Fetch core memories
  const archived = false;
  const memories = await fetchCoreMemories(archived);

  content.innerHTML = `
    <div class="core-memory-container">
      <!-- Tab Navigation -->
      <div class="core-memory-tabs">
        <div class="tab-nav">
          <button class="tab-btn active" id="memoriesViewBtn" onclick="showMemoriesView()">
            <i data-lucide="brain"></i>
            ${t('coreMemory.memories')}
          </button>
          <button class="tab-btn" id="favoritesViewBtn" onclick="showFavoritesView()">
            <i data-lucide="star"></i>
            ${t('coreMemory.favorites') || 'Favorites'}
          </button>
          <button class="tab-btn" id="clustersViewBtn" onclick="showClustersView()">
            <i data-lucide="folder-tree"></i>
            ${t('coreMemory.clusters')}
          </button>
        </div>
        <div class="tab-actions">
          <button class="btn btn-primary" onclick="showCreateMemoryModal()">
            <i data-lucide="plus"></i>
            ${t('coreMemory.createNew')}
          </button>
          <button class="btn btn-secondary" onclick="toggleArchivedMemories()">
            <i data-lucide="archive"></i>
            <span id="archiveToggleText">${t('coreMemory.showArchived')}</span>
          </button>
          <button class="btn btn-secondary" onclick="refreshCoreMemories()">
            <i data-lucide="refresh-cw"></i>
            ${t('common.refresh')}
          </button>
        </div>
      </div>

      <!-- Memories Tab Content (default view) -->
      <div class="cm-tab-panel" id="memoriesGrid">
        <div class="memory-stats">
          <div class="stat-item">
            <span class="stat-label">${t('coreMemory.totalMemories')}</span>
            <span class="stat-value" id="totalMemoriesCount">${memories.length}</span>
          </div>
        </div>
        <div class="memories-grid">
          ${memories.length === 0
            ? `<div class="empty-state">
                 <i data-lucide="brain"></i>
                 <p>${t('coreMemory.noMemories')}</p>
               </div>`
            : memories.map(memory => renderMemoryCard(memory)).join('')
          }
        </div>
      </div>

      <!-- Favorites Tab Content (hidden by default) -->
      <div class="cm-tab-panel" id="favoritesGrid" style="display: none;">
        <div class="memory-stats">
          <div class="stat-item">
            <span class="stat-label">${t('coreMemory.totalFavorites') || 'Total Favorites'}</span>
            <span class="stat-value" id="totalFavoritesCount">0</span>
          </div>
        </div>
        <div class="memories-grid" id="favoritesGridContent">
          <div class="empty-state">
            <i data-lucide="star"></i>
            <p>${t('coreMemory.noFavorites') || 'No favorites yet'}</p>
          </div>
        </div>
      </div>

      <!-- Clusters Tab Content (hidden by default) -->
      <div class="cm-tab-panel clusters-container" id="clustersContainer" style="display: none;">
        <div class="clusters-layout">
          <div class="clusters-sidebar">
            <div class="clusters-sidebar-header">
              <h4>${t('coreMemory.clustersList')}</h4>
              <button class="btn btn-sm btn-primary" onclick="triggerAutoClustering()">
                <i data-lucide="sparkles"></i>
                ${t('coreMemory.autoCluster')}
              </button>
            </div>
            <div id="clusterListContainer" class="cluster-list">
              <!-- Clusters will be loaded here -->
            </div>
          </div>
          <div class="clusters-detail">
            <div id="clusterDetailContainer" class="cluster-detail-content">
              <div class="empty-state">
                <i data-lucide="folder-tree"></i>
                <p>${t('coreMemory.selectCluster')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create/Edit Memory Modal -->
    <div id="memoryModal" class="modal-overlay" style="display: none;">
      <div class="modal-content memory-modal">
        <div class="modal-header">
          <h2 id="memoryModalTitle">${t('coreMemory.createNew')}</h2>
          <button class="modal-close" onclick="closeMemoryModal()">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>${t('coreMemory.content')}</label>
            <textarea
              id="memoryContent"
              rows="10"
              placeholder="${t('coreMemory.contentPlaceholder')}"
            ></textarea>
          </div>
          <div class="form-group">
            <label>${t('coreMemory.summary')} (${t('common.optional')})</label>
            <textarea
              id="memorySummary"
              rows="3"
              placeholder="${t('coreMemory.summaryPlaceholder')}"
            ></textarea>
          </div>
          <div class="form-group">
            <label>${t('coreMemory.metadata')} (${t('common.optional')})</label>
            <input
              type="text"
              id="memoryMetadata"
              placeholder='{"tags": ["strategy", "architecture"], "priority": "high"}'
            />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeMemoryModal()">
            ${t('common.cancel')}
          </button>
          <button class="btn btn-primary" onclick="saveMemory()">
            ${t('common.save')}
          </button>
        </div>
      </div>
    </div>

    <!-- Memory Detail Modal -->
    <div id="memoryDetailModal" class="modal-overlay" style="display: none;">
      <div class="modal-content memory-detail-modal">
        <div class="modal-header">
          <h2 id="memoryDetailTitle"></h2>
          <button class="modal-close" onclick="closeMemoryDetailModal()">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="modal-body" id="memoryDetailBody">
          <!-- Content loaded dynamically -->
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeMemoryDetailModal()">
            ${t('common.close')}
          </button>
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderMemoryCard(memory) {
  const createdDate = new Date(memory.created_at).toLocaleString();
  const updatedDate = memory.updated_at ? new Date(memory.updated_at).toLocaleString() : createdDate;
  const isArchived = memory.archived || false;

  // Parse metadata - it may be double-encoded JSON string from the backend
  let metadata = {};
  if (memory.metadata) {
    try {
      let parsed = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata;
      // Handle double-encoded JSON (string within string)
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      metadata = parsed;
      console.log('[DEBUG] Memory', memory.id, 'metadata parsed:', metadata, 'favorite:', metadata.favorite);
    } catch (e) {
      console.warn('Failed to parse memory metadata:', e);
    }
  }
  const tags = metadata.tags || [];
  const priority = metadata.priority || 'medium';
  const isFavorite = metadata.favorite === true;
  console.log('[DEBUG] Memory', memory.id, 'isFavorite:', isFavorite);

  return `
    <div class="memory-card ${isArchived ? 'archived' : ''}" data-memory-id="${memory.id}" onclick="viewMemoryDetail('${memory.id}')">
      <div class="memory-card-header">
        <div class="memory-id">
          ${isFavorite ? '<i data-lucide="star" class="favorite-star"></i>' : ''}
          <span>${memory.id}</span>
          ${isArchived ? `<span class="badge badge-archived">${t('common.archived')}</span>` : ''}
          ${priority !== 'medium' ? `<span class="badge badge-priority-${priority}">${priority}</span>` : ''}
        </div>
        <div class="memory-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" onclick="editMemory('${memory.id}')" title="${t('common.edit')}">
            <i data-lucide="edit"></i>
          </button>
          <button class="icon-btn ${isFavorite ? 'favorite-active' : ''}" onclick="toggleFavorite('${memory.id}')" title="${t('coreMemory.toggleFavorite') || 'Toggle Favorite'}">
            <i data-lucide="star"></i>
          </button>
          ${!isArchived
            ? `<button class="icon-btn" onclick="archiveMemory('${memory.id}')" title="${t('common.archive')}">
                 <i data-lucide="archive"></i>
               </button>`
            : `<button class="icon-btn" onclick="unarchiveMemory('${memory.id}')" title="${t('coreMemory.unarchive')}">
                 <i data-lucide="archive-restore"></i>
               </button>`
          }
          <button class="icon-btn danger" onclick="deleteMemory('${memory.id}')" title="${t('common.delete')}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>

      <div class="memory-content">
        ${memory.summary
          ? `<div class="memory-summary">${escapeHtml(memory.summary)}</div>`
          : `<div class="memory-preview">${escapeHtml(memory.content.substring(0, 200))}${memory.content.length > 200 ? '...' : ''}</div>`
        }
      </div>

      ${tags.length > 0
        ? `<div class="memory-tags">
             ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
           </div>`
        : ''
      }

      <div class="memory-footer">
        <div class="memory-meta">
          <span title="${t('coreMemory.created')}">
            <i data-lucide="calendar"></i>
            ${createdDate}
          </span>
          ${memory.updated_at
            ? `<span title="${t('coreMemory.updated')}">
                 <i data-lucide="clock"></i>
                 ${updatedDate}
               </span>`
            : ''
          }
        </div>
        <div class="memory-features" onclick="event.stopPropagation()">
          <button class="feature-btn" onclick="generateMemorySummary('${memory.id}')" title="${t('coreMemory.generateSummary')}">
            <i data-lucide="sparkles"></i>
            ${t('coreMemory.summary')}
          </button>
          <button class="feature-btn" onclick="copyMemoryId('${memory.id}')" title="${t('common.copyId') || 'Copy ID'}">
            <i data-lucide="copy"></i>
            ${t('common.copyId') || 'Copy ID'}
          </button>
          <button class="feature-btn" onclick="showMemoryRelations('${memory.id}')" title="${t('coreMemory.showRelations') || 'Show Relations'}">
            <i data-lucide="git-branch"></i>
            ${t('coreMemory.relations') || 'Relations'}
          </button>
        </div>
      </div>
    </div>
  `;
}

// API Functions
async function fetchCoreMemories(archived = false) {
  try {
    // Add timestamp to prevent browser caching
    const response = await fetch(`/api/core-memory/memories?path=${encodeURIComponent(projectPath)}&archived=${archived}&_t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.memories || [];
  } catch (error) {
    console.error('Failed to fetch core memories:', error);
    showNotification(t('coreMemory.fetchError'), 'error');
    return [];
  }
}

async function fetchMemoryById(memoryId) {
  try {
    // Add timestamp to prevent browser caching
    const response = await fetch(`/api/core-memory/memories/${memoryId}?path=${encodeURIComponent(projectPath)}&_t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.memory || null;
  } catch (error) {
    console.error('Failed to fetch memory:', error);
    showNotification(t('coreMemory.fetchError'), 'error');
    return null;
  }
}

// Modal Functions
function showCreateMemoryModal() {
  const modal = document.getElementById('memoryModal');
  document.getElementById('memoryModalTitle').textContent = t('coreMemory.createNew');
  document.getElementById('memoryContent').value = '';
  document.getElementById('memorySummary').value = '';
  document.getElementById('memoryMetadata').value = '';
  modal.dataset.editId = '';
  modal.style.display = 'flex';
  lucide.createIcons();
}

async function editMemory(memoryId) {
  const memory = await fetchMemoryById(memoryId);
  if (!memory) return;

  const modal = document.getElementById('memoryModal');
  document.getElementById('memoryModalTitle').textContent = t('coreMemory.edit');
  document.getElementById('memoryContent').value = memory.content || '';
  document.getElementById('memorySummary').value = memory.summary || '';
  document.getElementById('memoryMetadata').value = memory.metadata 
    ? (typeof memory.metadata === 'string' ? memory.metadata : JSON.stringify(memory.metadata, null, 2)) 
    : '';
  modal.dataset.editId = memoryId;
  modal.style.display = 'flex';
  lucide.createIcons();
}

function closeMemoryModal() {
  document.getElementById('memoryModal').style.display = 'none';
}

async function saveMemory() {
  const modal = document.getElementById('memoryModal');
  const content = document.getElementById('memoryContent').value.trim();
  const summary = document.getElementById('memorySummary').value.trim();
  const metadataStr = document.getElementById('memoryMetadata').value.trim();

  if (!content) {
    showNotification(t('coreMemory.contentRequired'), 'error');
    return;
  }

  let metadata = {};
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
    } catch (e) {
      showNotification(t('coreMemory.invalidMetadata'), 'error');
      return;
    }
  }

  const payload = {
    content,
    summary: summary || undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    path: projectPath
  };

  const editId = modal.dataset.editId;
  if (editId) {
    payload.id = editId;
  }

  try {
    const response = await fetch('/api/core-memory/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    showNotification(editId ? t('coreMemory.updated') : t('coreMemory.created'), 'success');
    closeMemoryModal();
    await refreshCoreMemories();
  } catch (error) {
    console.error('Failed to save memory:', error);
    showNotification(t('coreMemory.saveError'), 'error');
  }
}

async function archiveMemory(memoryId) {
  if (!confirm(t('coreMemory.confirmArchive'))) return;

  try {
    const response = await fetch(`/api/core-memory/memories/${memoryId}/archive?path=${encodeURIComponent(projectPath)}`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    showNotification(t('coreMemory.archived'), 'success');
    await refreshCoreMemories();
  } catch (error) {
    console.error('Failed to archive memory:', error);
    showNotification(t('coreMemory.archiveError'), 'error');
  }
}

async function unarchiveMemory(memoryId) {
  try {
    const memory = await fetchMemoryById(memoryId);
    if (!memory) return;

    memory.archived = false;

    const response = await fetch('/api/core-memory/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...memory, path: projectPath })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    showNotification(t('coreMemory.unarchived'), 'success');
    await refreshCoreMemories();
  } catch (error) {
    console.error('Failed to unarchive memory:', error);
    showNotification(t('coreMemory.unarchiveError'), 'error');
  }
}

async function deleteMemory(memoryId) {
  if (!confirm(t('coreMemory.confirmDelete'))) return;

  try {
    const response = await fetch(`/api/core-memory/memories/${memoryId}?path=${encodeURIComponent(projectPath)}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    showNotification(t('coreMemory.deleted'), 'success');
    await refreshCoreMemories();
  } catch (error) {
    console.error('Failed to delete memory:', error);
    showNotification(t('coreMemory.deleteError'), 'error');
  }
}

// Feature Functions
async function generateMemorySummary(memoryId) {
  try {
    showNotification(t('coreMemory.generatingSummary'), 'info');

    const response = await fetch(`/api/core-memory/memories/${memoryId}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'gemini', path: projectPath })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    showNotification(t('coreMemory.summaryGenerated'), 'success');

    // Show summary in detail modal
    await viewMemoryDetail(memoryId);
  } catch (error) {
    console.error('Failed to generate summary:', error);
    showNotification(t('coreMemory.summaryError'), 'error');
  }
}

async function viewMemoryDetail(memoryId) {
  const memory = await fetchMemoryById(memoryId);
  if (!memory) return;

  const modal = document.getElementById('memoryDetailModal');
  document.getElementById('memoryDetailTitle').textContent = memory.id;

  // Parse content and summary in case they contain JSON streaming format
  const parsedContent = parseJsonStreamContent(memory.content);
  const parsedSummary = parseJsonStreamContent(memory.summary);

  const body = document.getElementById('memoryDetailBody');
  body.innerHTML = `
    <div class="memory-detail-content">
      ${parsedSummary
        ? `<div class="detail-section">
             <h3>${t('coreMemory.summary')}</h3>
             <div class="detail-text">${escapeHtml(parsedSummary)}</div>
           </div>`
        : ''
      }

      <div class="detail-section">
        <h3>${t('coreMemory.content')}</h3>
        <pre class="detail-code">${escapeHtml(parsedContent)}</pre>
      </div>

      ${(() => {
        if (!memory.metadata) return '';
        try {
          let metadataObj = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata;
          // Handle double-encoded JSON
          if (typeof metadataObj === 'string') {
            metadataObj = JSON.parse(metadataObj);
          }
          if (Object.keys(metadataObj).length === 0) return '';
          return `<div class="detail-section">
             <h3>${t('coreMemory.metadata')}</h3>
             <pre class="detail-code">${escapeHtml(JSON.stringify(metadataObj, null, 2))}</pre>
           </div>`;
        } catch (e) {
          return '';
        }
      })()}

      ${memory.raw_output
        ? `<div class="detail-section">
             <h3>${t('coreMemory.rawOutput')}</h3>
             <pre class="detail-code">${escapeHtml(parseJsonStreamContent(memory.raw_output))}</pre>
           </div>`
        : ''
      }
    </div>
  `;

  modal.style.display = 'flex';
  lucide.createIcons();
}

function closeMemoryDetailModal() {
  document.getElementById('memoryDetailModal').style.display = 'none';
}

let showingArchivedMemories = false;

async function toggleArchivedMemories() {
  showingArchivedMemories = !showingArchivedMemories;
  const toggleText = document.getElementById('archiveToggleText');
  toggleText.textContent = showingArchivedMemories
    ? t('coreMemory.showActive')
    : t('coreMemory.showArchived');

  await refreshCoreMemories();
}

async function refreshCoreMemories() {
  const memories = await fetchCoreMemories(showingArchivedMemories);

  const container = document.getElementById('memoriesGrid');
  const grid = container.querySelector('.memories-grid');
  const countEl = document.getElementById('totalMemoriesCount');

  if (countEl) countEl.textContent = memories.length;

  if (grid) {
    if (memories.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="brain"></i>
          <p>${showingArchivedMemories ? t('coreMemory.noArchivedMemories') : t('coreMemory.noMemories')}</p>
        </div>
      `;
    } else {
      grid.innerHTML = memories.map(memory => renderMemoryCard(memory)).join('');
    }
  }

  lucide.createIcons();
}

// Utility Functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function copyMemoryId(memoryId) {
  try {
    await navigator.clipboard.writeText(memoryId);
    showNotification(t('common.copied') || 'Copied!', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification(t('common.copyError') || 'Failed to copy', 'error');
  }
}

// View Toggle Functions
function showMemoriesView() {
  document.getElementById('memoriesGrid').style.display = '';
  document.getElementById('favoritesGrid').style.display = 'none';
  document.getElementById('clustersContainer').style.display = 'none';
  document.getElementById('memoriesViewBtn').classList.add('active');
  document.getElementById('favoritesViewBtn').classList.remove('active');
  document.getElementById('clustersViewBtn').classList.remove('active');
}

async function showFavoritesView() {
  document.getElementById('memoriesGrid').style.display = 'none';
  document.getElementById('favoritesGrid').style.display = '';
  document.getElementById('clustersContainer').style.display = 'none';
  document.getElementById('memoriesViewBtn').classList.remove('active');
  document.getElementById('favoritesViewBtn').classList.add('active');
  document.getElementById('clustersViewBtn').classList.remove('active');

  // Load favorites
  await refreshFavorites();
}

function showClustersView() {
  document.getElementById('memoriesGrid').style.display = 'none';
  document.getElementById('favoritesGrid').style.display = 'none';
  document.getElementById('clustersContainer').style.display = '';
  document.getElementById('memoriesViewBtn').classList.remove('active');
  document.getElementById('favoritesViewBtn').classList.remove('active');
  document.getElementById('clustersViewBtn').classList.add('active');

  // Load clusters from core-memory-clusters.js
  if (typeof loadClusters === 'function') {
    loadClusters();
  } else {
    console.error('loadClusters is not available. Make sure core-memory-clusters.js is loaded.');
  }
}

// Favorites Functions
async function refreshFavorites() {
  const allMemories = await fetchCoreMemories(false);
  const favorites = allMemories.filter(m => {
    if (!m.metadata) return false;
    try {
      let parsed = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
      // Handle double-encoded JSON
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      return parsed.favorite === true;
    } catch (e) {
      return false;
    }
  });

  const countEl = document.getElementById('totalFavoritesCount');
  const gridEl = document.getElementById('favoritesGridContent');

  if (countEl) countEl.textContent = favorites.length;

  if (gridEl) {
    if (favorites.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <i data-lucide="star"></i>
          <p>${t('coreMemory.noFavorites') || 'No favorites yet'}</p>
        </div>
      `;
    } else {
      gridEl.innerHTML = favorites.map(memory => renderMemoryCard(memory)).join('');
    }
  }

  lucide.createIcons();
}

async function showMemoryRelations(memoryId) {
  try {
    // Fetch all clusters
    const response = await fetch(`/api/core-memory/clusters?path=${encodeURIComponent(projectPath)}&_t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    const clusters = result.clusters || [];

    // Find clusters containing this memory
    const relatedClusters = [];
    for (const cluster of clusters) {
      const detailRes = await fetch(`/api/core-memory/clusters/${cluster.id}?path=${encodeURIComponent(projectPath)}&_t=${Date.now()}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const members = detail.members || [];
        if (members.some(m => m.session_id === memoryId || m.id === memoryId)) {
          relatedClusters.push({
            ...cluster,
            relations: detail.relations || []
          });
        }
      }
    }

    // Show in modal
    const modal = document.getElementById('memoryDetailModal');
    document.getElementById('memoryDetailTitle').textContent = t('coreMemory.relationsFor') || `Relations: ${memoryId}`;

    const body = document.getElementById('memoryDetailBody');
    if (relatedClusters.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <i data-lucide="git-branch"></i>
          <p>${t('coreMemory.noRelations') || 'No cluster relations found'}</p>
          <p class="text-muted">${t('coreMemory.noRelationsHint') || 'Use Auto Cluster in the Clusters tab to create relations'}</p>
        </div>
      `;
    } else {
      body.innerHTML = `
        <div class="relations-detail">
          <h4>${t('coreMemory.belongsToClusters') || 'Belongs to Clusters'}</h4>
          <div class="clusters-list">
            ${relatedClusters.map(cluster => `
              <div class="relation-cluster-item">
                <div class="relation-cluster-header">
                  <i data-lucide="folder"></i>
                  <span class="cluster-name">${escapeHtml(cluster.name)}</span>
                  <span class="badge badge-${cluster.status}">${cluster.status}</span>
                </div>
                ${cluster.relations && cluster.relations.length > 0 ? `
                  <div class="cluster-relations-list">
                    <span class="relations-label">${t('coreMemory.relatedClusters')}:</span>
                    ${cluster.relations.map(rel => `
                      <span class="relation-tag">
                        <i data-lucide="link"></i>
                        ${escapeHtml(rel.target_name || rel.target_id)}
                        <span class="relation-type">${rel.relation_type}</span>
                      </span>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    modal.style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    console.error('Failed to load relations:', error);
    showNotification(t('coreMemory.relationsError') || 'Failed to load relations', 'error');
  }
}

async function toggleFavorite(memoryId) {
  try {
    const memory = await fetchMemoryById(memoryId);
    if (!memory) return;

    // Parse metadata - it may be double-encoded JSON string from the backend
    let metadata = {};
    if (memory.metadata) {
      try {
        let parsed = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata;
        // Handle double-encoded JSON
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        metadata = parsed;
      } catch (e) {
        console.warn('Failed to parse memory metadata:', e);
      }
    }
    metadata.favorite = !metadata.favorite;

    const response = await fetch('/api/core-memory/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...memory, metadata, path: projectPath })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    showNotification(
      metadata.favorite
        ? (t('coreMemory.addedToFavorites') || 'Added to favorites')
        : (t('coreMemory.removedFromFavorites') || 'Removed from favorites'),
      'success'
    );

    // Refresh current view
    await refreshCoreMemories();

    // Also refresh favorites if visible
    const favoritesGrid = document.getElementById('favoritesGrid');
    if (favoritesGrid && favoritesGrid.style.display !== 'none') {
      await refreshFavorites();
    }
  } catch (error) {
    console.error('Failed to toggle favorite:', error);
    showNotification(t('coreMemory.favoriteError') || 'Failed to update favorite', 'error');
  }
}
