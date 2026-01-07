// API Settings View
// Manages LiteLLM API providers, custom endpoints, and cache settings

// ========== State Management ==========
let apiSettingsData = null;
const providerModels = {};
let currentModal = null;

// New state for split layout
let selectedProviderId = null;
let providerSearchQuery = '';
let activeModelTab = 'llm';
let expandedModelGroups = new Set();
let activeSidebarTab = 'providers'; // 'providers' | 'endpoints' | 'cache' | 'embedding-pool'

// Embedding Pool state
let embeddingPoolConfig = null;
let embeddingPoolAvailableModels = [];
let embeddingPoolDiscoveredProviders = [];

// Cache for ccw-litellm status (frontend cache with TTL)
let ccwLitellmStatusCache = null;
let ccwLitellmStatusCacheTime = 0;
const CCW_LITELLM_STATUS_CACHE_TTL = 60000; // 60 seconds

// Track if this is the first render (force refresh on first load)
let isFirstApiSettingsRender = true;

// ========== Data Loading ==========

/**
 * Load API configuration
 * @param {boolean} forceRefresh - Force refresh from server, bypass cache
 */
async function loadApiSettings(forceRefresh = false) {
  // If not forcing refresh and data already exists, return cached data
  if (!forceRefresh && apiSettingsData && apiSettingsData.providers) {
    console.log('[API Settings] Using cached API settings data');
    return apiSettingsData;
  }

  try {
    console.log('[API Settings] Fetching API settings from server...');
    const response = await fetch('/api/litellm-api/config');
    if (!response.ok) throw new Error('Failed to load API settings');
    apiSettingsData = await response.json();
    return apiSettingsData;
  } catch (err) {
    console.error('Failed to load API settings:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    return null;
  }
}

/**
 * Load available models for a provider type
 */
async function loadProviderModels(providerType) {
  try {
    const response = await fetch('/api/litellm-api/models/' + providerType);
    if (!response.ok) throw new Error('Failed to load models');
    const data = await response.json();
    providerModels[providerType] = data.models || [];
    return data.models;
  } catch (err) {
    console.error('Failed to load provider models:', err);
    return [];
  }
}

/**
 * Load cache statistics
 */
async function loadCacheStats() {
  try {
    const response = await fetch('/api/litellm-api/cache/stats');
    if (!response.ok) throw new Error('Failed to load cache stats');
    return await response.json();
  } catch (err) {
    console.error('Failed to load cache stats:', err);
    return { enabled: false, totalSize: 0, maxSize: 104857600, entries: 0 };
  }
}

/**
 * Load embedding pool configuration and available models
 */
async function loadEmbeddingPoolConfig() {
  try {
    const response = await fetch('/api/litellm-api/embedding-pool');
    if (!response.ok) throw new Error('Failed to load embedding pool config');
    const data = await response.json();
    embeddingPoolConfig = data.poolConfig;
    embeddingPoolAvailableModels = data.availableModels || [];

    // If pool is enabled and has a target model, discover providers
    if (embeddingPoolConfig && embeddingPoolConfig.enabled && embeddingPoolConfig.targetModel) {
      await discoverProvidersForTargetModel(embeddingPoolConfig.targetModel);
    }

    return data;
  } catch (err) {
    console.error('Failed to load embedding pool config:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    return null;
  }
}

/**
 * Discover providers for a specific target model
 */
async function discoverProvidersForTargetModel(targetModel) {
  try {
    const response = await fetch('/api/litellm-api/embedding-pool/discover/' + encodeURIComponent(targetModel));
    if (!response.ok) throw new Error('Failed to discover providers');
    const data = await response.json();
    embeddingPoolDiscoveredProviders = data.discovered || [];
    return data;
  } catch (err) {
    console.error('Failed to discover providers:', err);
    embeddingPoolDiscoveredProviders = [];
    return null;
  }
}

/**
 * Save embedding pool configuration
 */
async function saveEmbeddingPoolConfig() {
  try {
    const enabled = document.getElementById('embedding-pool-enabled')?.checked || false;
    const targetModel = document.getElementById('embedding-pool-target-model')?.value || '';
    const strategy = document.getElementById('embedding-pool-strategy')?.value || 'round_robin';
    const defaultCooldown = parseInt(document.getElementById('embedding-pool-cooldown')?.value || '60');
    const defaultMaxConcurrentPerKey = parseInt(document.getElementById('embedding-pool-concurrent')?.value || '4');

    const poolConfig = enabled ? {
      enabled: true,
      targetModel: targetModel,
      strategy: strategy,
      autoDiscover: true,
      excludedProviderIds: embeddingPoolConfig?.excludedProviderIds || [],
      defaultCooldown: defaultCooldown,
      defaultMaxConcurrentPerKey: defaultMaxConcurrentPerKey
    } : null;

    const response = await fetch('/api/litellm-api/embedding-pool', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(poolConfig)
    });

    if (!response.ok) throw new Error('Failed to save embedding pool config');

    const result = await response.json();
    embeddingPoolConfig = result.poolConfig;

    const syncCount = result.syncResult?.syncedEndpoints?.length || 0;
    showRefreshToast(t('apiSettings.poolSaved') + (syncCount > 0 ? ' (' + syncCount + ' endpoints synced)' : ''), 'success');

    // Invalidate API settings cache since endpoints may have been synced
    apiSettingsData = null;

    // Reload the embedding pool section
    await renderEmbeddingPoolMainPanel();
    
    // Update sidebar summary
    const sidebarContainer = document.querySelector('.api-settings-sidebar');
    if (sidebarContainer) {
      const contentArea = sidebarContainer.querySelector('.provider-list, .endpoints-list, .embedding-pool-sidebar-info, .embedding-pool-sidebar-summary, .cache-sidebar-info');
      if (contentArea && contentArea.parentElement) {
        contentArea.parentElement.innerHTML = renderEmbeddingPoolSidebar();
        if (window.lucide) lucide.createIcons();
      }
    }

  } catch (err) {
    console.error('Failed to save embedding pool config:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Toggle provider exclusion in embedding pool
 */
async function toggleProviderExclusion(providerId) {
  if (!embeddingPoolConfig) return;

  const excludedIds = embeddingPoolConfig.excludedProviderIds || [];
  const index = excludedIds.indexOf(providerId);

  if (index > -1) {
    excludedIds.splice(index, 1);
  } else {
    excludedIds.push(providerId);
  }

  embeddingPoolConfig.excludedProviderIds = excludedIds;

  // Re-render the discovered providers section
  renderDiscoveredProviders();
  
  // Update sidebar summary
  const sidebarContainer = document.querySelector('.api-settings-sidebar .embedding-pool-sidebar-summary');
  if (sidebarContainer && sidebarContainer.parentElement) {
    sidebarContainer.parentElement.innerHTML = renderEmbeddingPoolSidebar();
    if (window.lucide) lucide.createIcons();
  }
}

// ========== Provider Management ==========

/**
 * Show add provider modal
 */
async function showAddProviderModal() {
  const modalHtml = '<div class="generic-modal-overlay active" id="providerModal">' +
    '<div class="generic-modal">' +
    '<div class="generic-modal-header">' +
    '<h3 class="generic-modal-title">' + t('apiSettings.addProvider') + '</h3>' +
    '<button class="generic-modal-close" onclick="closeProviderModal()">&times;</button>' +
    '</div>' +
    '<div class="generic-modal-body">' +
    '<form id="providerForm" class="api-settings-form">' +
    '<div class="form-group">' +
    '<label for="provider-type">' + t('apiSettings.apiFormat') + '</label>' +
    '<select id="provider-type" class="cli-input" onchange="updateProviderSpecificFields()" required>' +
    '<option value="openai">OpenAI ' + t('apiSettings.compatible') + '</option>' +
    '<option value="anthropic">Anthropic</option>' +
    '<option value="custom">' + t('apiSettings.customFormat') + '</option>' +
    '</select>' +
    '<small class="form-hint">' + t('apiSettings.apiFormatHint') + '</small>' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="provider-name">' + t('apiSettings.displayName') + '</label>' +
    '<input type="text" id="provider-name" class="cli-input" placeholder="My OpenAI" required />' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="provider-apikey">' + t('apiSettings.apiKey') + '</label>' +
    '<div class="api-key-input-group">' +
    '<input type="password" id="provider-apikey" class="cli-input" placeholder="sk-..." required />' +
    '<button type="button" class="btn-icon" onclick="toggleApiKeyVisibility(\'provider-apikey\')" title="' + t('apiSettings.toggleVisibility') + '">' +
    '<i data-lucide="eye"></i>' +
    '</button>' +
    '</div>' +
    '<label class="checkbox-label">' +
    '<input type="checkbox" id="use-env-var" onchange="toggleEnvVarInput()" /> ' +
    t('apiSettings.useEnvVar') +
    '</label>' +
    '<input type="text" id="env-var-name" class="cli-input" placeholder="OPENAI_API_KEY" style="display:none; margin-top: 0.5rem;" />' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="provider-apibase">' + t('apiSettings.apiBaseUrl') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="text" id="provider-apibase" class="cli-input" placeholder="https://api.openai.com/v1" />' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="checkbox-label">' +
    '<input type="checkbox" id="provider-enabled" checked /> ' +
    t('apiSettings.enableProvider') +
    '</label>' +
    '</div>' +
    // Advanced Settings Collapsible Panel
    '<fieldset class="advanced-settings-fieldset">' +
    '<legend class="advanced-settings-legend" onclick="toggleAdvancedSettings()">' +
    '<i data-lucide="chevron-right" class="advanced-toggle-icon"></i> ' +
    t('apiSettings.advancedSettings') +
    '</legend>' +
    '<div id="advanced-settings-content" class="advanced-settings-content collapsed">' +
    // Timeout
    '<div class="form-group">' +
    '<label for="provider-timeout">' + t('apiSettings.timeout') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="number" id="provider-timeout" class="cli-input" placeholder="300" min="1" max="3600" />' +
    '<small class="form-hint">' + t('apiSettings.timeoutHint') + '</small>' +
    '</div>' +
    // Max Retries
    '<div class="form-group">' +
    '<label for="provider-max-retries">' + t('apiSettings.maxRetries') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="number" id="provider-max-retries" class="cli-input" placeholder="3" min="0" max="10" />' +
    '</div>' +
    // Organization (OpenAI only)
    '<div class="form-group provider-specific openai-only" style="display:none;">' +
    '<label for="provider-organization">' + t('apiSettings.organization') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="text" id="provider-organization" class="cli-input" placeholder="org-..." />' +
    '<small class="form-hint">' + t('apiSettings.organizationHint') + '</small>' +
    '</div>' +
    // API Version (Azure only)
    '<div class="form-group provider-specific azure-only" style="display:none;">' +
    '<label for="provider-api-version">' + t('apiSettings.apiVersion') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="text" id="provider-api-version" class="cli-input" placeholder="2024-02-01" />' +
    '<small class="form-hint">' + t('apiSettings.apiVersionHint') + '</small>' +
    '</div>' +
    // Rate Limiting (side by side)
    '<div class="form-row">' +
    '<div class="form-group form-group-half">' +
    '<label for="provider-rpm">' + t('apiSettings.rpm') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="number" id="provider-rpm" class="cli-input" placeholder="' + t('apiSettings.unlimited') + '" min="0" />' +
    '</div>' +
    '<div class="form-group form-group-half">' +
    '<label for="provider-tpm">' + t('apiSettings.tpm') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="number" id="provider-tpm" class="cli-input" placeholder="' + t('apiSettings.unlimited') + '" min="0" />' +
    '</div>' +
    '</div>' +
    // Proxy
    '<div class="form-group">' +
    '<label for="provider-proxy">' + t('apiSettings.proxy') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="text" id="provider-proxy" class="cli-input" placeholder="http://proxy.example.com:8080" />' +
    '</div>' +
    // Custom Headers
    '<div class="form-group">' +
    '<label for="provider-custom-headers">' + t('apiSettings.customHeaders') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<textarea id="provider-custom-headers" class="cli-input cli-textarea" rows="3" placeholder=\'{"X-Custom-Header": "value"}\'></textarea>' +
    '<small class="form-hint">' + t('apiSettings.customHeadersHint') + '</small>' +
    '</div>' +
    '</div>' +
    '</fieldset>' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-secondary" onclick="testProviderConnection()">' +
    '<i data-lucide="wifi"></i> ' + t('apiSettings.testConnection') +
    '</button>' +
    '<button type="button" class="btn btn-secondary" onclick="closeProviderModal()">' + t('common.cancel') + '</button>' +
    '<button type="submit" class="btn btn-primary">' +
    '<i data-lucide="save"></i> ' + t('common.save') +
    '</button>' +
    '</div>' +
    '</form>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('providerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    await saveProvider();
  });

  if (window.lucide) lucide.createIcons();
}

/**
 * Show edit provider modal
 */
async function showEditProviderModal(providerId) {
  if (!apiSettingsData) return;

  const provider = apiSettingsData.providers?.find(function(p) { return p.id === providerId; });
  if (!provider) return;

  await showAddProviderModal();

  // Update modal title
  document.querySelector('#providerModal .generic-modal-title').textContent = t('apiSettings.editProvider');

  // Populate form
  document.getElementById('provider-type').value = provider.type;
  document.getElementById('provider-name').value = provider.name;
  document.getElementById('provider-apikey').value = provider.apiKey;
  if (provider.apiBase) {
    document.getElementById('provider-apibase').value = provider.apiBase;
  }
  document.getElementById('provider-enabled').checked = provider.enabled !== false;

  // Populate advanced settings if they exist
  if (provider.advancedSettings) {
    var settings = provider.advancedSettings;

    if (settings.timeout) {
      document.getElementById('provider-timeout').value = settings.timeout;
    }
    if (settings.maxRetries !== undefined) {
      document.getElementById('provider-max-retries').value = settings.maxRetries;
    }
    if (settings.organization) {
      document.getElementById('provider-organization').value = settings.organization;
    }
    if (settings.apiVersion) {
      document.getElementById('provider-api-version').value = settings.apiVersion;
    }
    if (settings.rpm) {
      document.getElementById('provider-rpm').value = settings.rpm;
    }
    if (settings.tpm) {
      document.getElementById('provider-tpm').value = settings.tpm;
    }
    if (settings.proxy) {
      document.getElementById('provider-proxy').value = settings.proxy;
    }
    if (settings.customHeaders) {
      document.getElementById('provider-custom-headers').value =
        JSON.stringify(settings.customHeaders, null, 2);
    }

    // Expand advanced settings if any values exist
    if (Object.keys(settings).length > 0) {
      toggleAdvancedSettings();
    }
  }

  // Update provider-specific field visibility
  updateProviderSpecificFields();

  // Store provider ID for update
  document.getElementById('providerForm').dataset.providerId = providerId;
}

/**
 * Save provider (create or update)
 */
async function saveProvider() {
  const form = document.getElementById('providerForm');
  const providerId = form.dataset.providerId;

  const useEnvVar = document.getElementById('use-env-var').checked;
  const apiKey = useEnvVar
    ? '${' + document.getElementById('env-var-name').value + '}'
    : document.getElementById('provider-apikey').value;

  // Collect advanced settings
  var advancedSettings = {};

  var timeout = document.getElementById('provider-timeout').value;
  if (timeout) advancedSettings.timeout = parseInt(timeout);

  var maxRetries = document.getElementById('provider-max-retries').value;
  if (maxRetries) advancedSettings.maxRetries = parseInt(maxRetries);

  var organization = document.getElementById('provider-organization').value;
  if (organization) advancedSettings.organization = organization;

  var apiVersion = document.getElementById('provider-api-version').value;
  if (apiVersion) advancedSettings.apiVersion = apiVersion;

  var rpm = document.getElementById('provider-rpm').value;
  if (rpm) advancedSettings.rpm = parseInt(rpm);

  var tpm = document.getElementById('provider-tpm').value;
  if (tpm) advancedSettings.tpm = parseInt(tpm);

  var proxy = document.getElementById('provider-proxy').value;
  if (proxy) advancedSettings.proxy = proxy;

  var customHeadersJson = document.getElementById('provider-custom-headers').value;
  if (customHeadersJson) {
    try {
      advancedSettings.customHeaders = JSON.parse(customHeadersJson);
    } catch (e) {
      showRefreshToast(t('apiSettings.invalidJsonHeaders'), 'error');
      return;
    }
  }

  const providerData = {
    type: document.getElementById('provider-type').value,
    name: document.getElementById('provider-name').value,
    apiKey: apiKey,
    apiBase: document.getElementById('provider-apibase').value || undefined,
    enabled: document.getElementById('provider-enabled').checked,
    advancedSettings: Object.keys(advancedSettings).length > 0 ? advancedSettings : undefined
  };

  try {
    const url = providerId
      ? '/api/litellm-api/providers/' + providerId
      : '/api/litellm-api/providers';
    const method = providerId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerData)
    });

    if (!response.ok) throw new Error('Failed to save provider');

    const result = await response.json();
    showRefreshToast(t('apiSettings.providerSaved'), 'success');

    closeProviderModal();
    // Force refresh data after saving
    apiSettingsData = null;
    await renderApiSettings();
  } catch (err) {
    console.error('Failed to save provider:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Delete provider
 */
async function deleteProvider(providerId) {
  if (!confirm(t('apiSettings.confirmDeleteProvider'))) return;

  try {
    const response = await fetch('/api/litellm-api/providers/' + providerId, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Failed to delete provider');

    showRefreshToast(t('apiSettings.providerDeleted'), 'success');
    // Force refresh data after deleting
    apiSettingsData = null;
    await renderApiSettings();
  } catch (err) {
    console.error('Failed to delete provider:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Test provider connection
 * @param {string} [providerIdParam] - Optional provider ID. If not provided, uses form context or selectedProviderId
 */
async function testProviderConnection(providerIdParam) {
  var providerId = providerIdParam;

  // Try to get providerId from different sources
  if (!providerId) {
    var form = document.getElementById('providerForm');
    if (form && form.dataset.providerId) {
      providerId = form.dataset.providerId;
    } else if (selectedProviderId) {
      providerId = selectedProviderId;
    }
  }

  if (!providerId) {
    showRefreshToast(t('apiSettings.saveProviderFirst'), 'warning');
    return;
  }

  try {
    const response = await fetch('/api/litellm-api/providers/' + providerId + '/test', {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to test provider');

    const result = await response.json();

    if (result.success) {
      showRefreshToast(t('apiSettings.connectionSuccess'), 'success');
    } else {
      showRefreshToast(t('apiSettings.connectionFailed') + ': ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    console.error('Failed to test provider:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Close provider modal
 */
function closeProviderModal() {
  const modal = document.getElementById('providerModal');
  if (modal) modal.remove();
}

/**
 * Toggle API key visibility
 */
function toggleApiKeyVisibility(inputId) {
  const input = document.getElementById(inputId);
  const icon = event.target.closest('button').querySelector('i');

  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Toggle environment variable input
 */
function toggleEnvVarInput() {
  const useEnvVar = document.getElementById('use-env-var').checked;
  const apiKeyInput = document.getElementById('provider-apikey');
  const envVarInput = document.getElementById('env-var-name');

  if (useEnvVar) {
    apiKeyInput.style.display = 'none';
    apiKeyInput.required = false;
    envVarInput.style.display = 'block';
    envVarInput.required = true;
  } else {
    apiKeyInput.style.display = 'block';
    apiKeyInput.required = true;
    envVarInput.style.display = 'none';
    envVarInput.required = false;
  }
}

/**
 * Toggle advanced settings visibility
 */
function toggleAdvancedSettings() {
  var content = document.getElementById('advanced-settings-content');
  var legend = document.querySelector('.advanced-settings-legend');
  var isCollapsed = content.classList.contains('collapsed');

  content.classList.toggle('collapsed');
  legend.classList.toggle('expanded');

  // Update icon
  var icon = legend.querySelector('.advanced-toggle-icon');
  if (icon) {
    icon.setAttribute('data-lucide', isCollapsed ? 'chevron-down' : 'chevron-right');
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Update provider-specific fields visibility based on provider type
 */
function updateProviderSpecificFields() {
  var providerType = document.getElementById('provider-type').value;

  // Hide all provider-specific fields first
  var specificFields = document.querySelectorAll('.provider-specific');
  specificFields.forEach(function(el) {
    el.style.display = 'none';
  });

  // Show OpenAI-specific fields
  if (providerType === 'openai') {
    var openaiFields = document.querySelectorAll('.openai-only');
    openaiFields.forEach(function(el) {
      el.style.display = 'block';
    });
  }

  // Show Azure-specific fields
  if (providerType === 'azure') {
    var azureFields = document.querySelectorAll('.azure-only');
    azureFields.forEach(function(el) {
      el.style.display = 'block';
    });
  }
}

// ========== Endpoint Management ==========

/**
 * Show add endpoint modal
 */
async function showAddEndpointModal() {
  if (!apiSettingsData || !apiSettingsData.providers || apiSettingsData.providers.length === 0) {
    showRefreshToast(t('apiSettings.addProviderFirst'), 'warning');
    return;
  }

  const providerOptions = apiSettingsData.providers
    .filter(function(p) { return p.enabled !== false; })
    .map(function(p) {
      return '<option value="' + p.id + '">' + p.name + ' (' + p.type + ')</option>';
    })
    .join('');

  const modalHtml = '<div class="generic-modal-overlay active" id="endpointModal">' +
    '<div class="generic-modal">' +
    '<div class="generic-modal-header">' +
    '<h3 class="generic-modal-title">' + t('apiSettings.addEndpoint') + '</h3>' +
    '<button class="generic-modal-close" onclick="closeEndpointModal()">&times;</button>' +
    '</div>' +
    '<div class="generic-modal-body">' +
    '<form id="endpointForm" class="api-settings-form">' +
    '<div class="form-group">' +
    '<label for="endpoint-id">' + t('apiSettings.endpointId') + '</label>' +
    '<input type="text" id="endpoint-id" class="cli-input" placeholder="my-gpt4o" required />' +
    '<small class="form-hint">' + t('apiSettings.endpointIdHint') + '</small>' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="endpoint-name">' + t('apiSettings.displayName') + '</label>' +
    '<input type="text" id="endpoint-name" class="cli-input" placeholder="GPT-4o for Code Review" required />' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="endpoint-provider">' + t('apiSettings.provider') + '</label>' +
    '<select id="endpoint-provider" class="cli-input" onchange="loadModelsForProvider()" required>' +
    providerOptions +
    '</select>' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="endpoint-model">' + t('apiSettings.model') + '</label>' +
    '<select id="endpoint-model" class="cli-input" required>' +
    '<option value="">' + t('apiSettings.selectModel') + '</option>' +
    '</select>' +
    '</div>' +
    '<fieldset class="form-fieldset">' +
    '<legend>' + t('apiSettings.cacheStrategy') + '</legend>' +
    '<label class="checkbox-label">' +
    '<input type="checkbox" id="cache-enabled" onchange="toggleCacheSettings()" /> ' +
    t('apiSettings.enableContextCaching') +
    '</label>' +
    '<div id="cache-settings" style="display:none;">' +
    '<div class="form-group">' +
    '<label for="cache-ttl">' + t('apiSettings.cacheTTL') + '</label>' +
    '<input type="number" id="cache-ttl" class="cli-input" value="60" min="1" />' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="cache-maxsize">' + t('apiSettings.cacheMaxSize') + '</label>' +
    '<input type="number" id="cache-maxsize" class="cli-input" value="512" min="1" />' +
    '</div>' +
    '<div class="form-group">' +
    '<label for="cache-patterns">' + t('apiSettings.autoCachePatterns') + '</label>' +
    '<input type="text" id="cache-patterns" class="cli-input" placeholder="*.ts, *.md, CLAUDE.md" />' +
    '</div>' +
    '</div>' +
    '</fieldset>' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-secondary" onclick="closeEndpointModal()"><i data-lucide="x"></i> ' + t('common.cancel') + '</button>' +
    '<button type="submit" class="btn btn-primary">' +
    '<i data-lucide="check"></i> ' + t('common.save') +
    '</button>' +
    '</div>' +
    '</form>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('endpointForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    await saveEndpoint();
  });

  // Load models for first provider
  await loadModelsForProvider();

  if (window.lucide) lucide.createIcons();
}

/**
 * Show edit endpoint modal
 */
async function showEditEndpointModal(endpointId) {
  if (!apiSettingsData) return;

  const endpoint = apiSettingsData.endpoints?.find(function(e) { return e.id === endpointId; });
  if (!endpoint) return;

  await showAddEndpointModal();

  // Update modal title
  document.querySelector('#endpointModal .generic-modal-title').textContent = t('apiSettings.editEndpoint');

  // Populate form
  document.getElementById('endpoint-id').value = endpoint.id;
  document.getElementById('endpoint-id').disabled = true;
  document.getElementById('endpoint-name').value = endpoint.name;
  document.getElementById('endpoint-provider').value = endpoint.providerId;

  await loadModelsForProvider();
  document.getElementById('endpoint-model').value = endpoint.model;

  if (endpoint.cacheStrategy) {
    document.getElementById('cache-enabled').checked = endpoint.cacheStrategy.enabled;
    if (endpoint.cacheStrategy.enabled) {
      toggleCacheSettings();
      document.getElementById('cache-ttl').value = endpoint.cacheStrategy.ttlMinutes || 60;
      document.getElementById('cache-maxsize').value = endpoint.cacheStrategy.maxSizeKB || 512;
      document.getElementById('cache-patterns').value = endpoint.cacheStrategy.autoCachePatterns?.join(', ') || '';
    }
  }

  // Store endpoint ID for update
  document.getElementById('endpointForm').dataset.endpointId = endpointId;
}

/**
 * Save endpoint (create or update)
 */
async function saveEndpoint() {
  const form = document.getElementById('endpointForm');
  const endpointId = form.dataset.endpointId || document.getElementById('endpoint-id').value;

  const cacheEnabled = document.getElementById('cache-enabled').checked;
  const cacheStrategy = cacheEnabled ? {
    enabled: true,
    ttlMinutes: parseInt(document.getElementById('cache-ttl').value) || 60,
    maxSizeKB: parseInt(document.getElementById('cache-maxsize').value) || 512,
    autoCachePatterns: document.getElementById('cache-patterns').value
      .split(',')
      .map(function(p) { return p.trim(); })
      .filter(function(p) { return p; })
  } : { enabled: false };

  const endpointData = {
    id: endpointId,
    name: document.getElementById('endpoint-name').value,
    providerId: document.getElementById('endpoint-provider').value,
    model: document.getElementById('endpoint-model').value,
    cacheStrategy: cacheStrategy
  };

  try {
    const url = form.dataset.endpointId
      ? '/api/litellm-api/endpoints/' + form.dataset.endpointId
      : '/api/litellm-api/endpoints';
    const method = form.dataset.endpointId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpointData)
    });

    if (!response.ok) throw new Error('Failed to save endpoint');

    const result = await response.json();
    showRefreshToast(t('apiSettings.endpointSaved'), 'success');

    closeEndpointModal();
    // Force refresh data after saving
    apiSettingsData = null;
    await renderApiSettings();
  } catch (err) {
    console.error('Failed to save endpoint:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Delete endpoint
 */
async function deleteEndpoint(endpointId) {
  if (!confirm(t('apiSettings.confirmDeleteEndpoint'))) return;

  try {
    const response = await fetch('/api/litellm-api/endpoints/' + endpointId, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Failed to delete endpoint');

    showRefreshToast(t('apiSettings.endpointDeleted'), 'success');
    // Force refresh data after deleting
    apiSettingsData = null;
    await renderApiSettings();
  } catch (err) {
    console.error('Failed to delete endpoint:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Close endpoint modal
 */
function closeEndpointModal() {
  const modal = document.getElementById('endpointModal');
  if (modal) modal.remove();
}

/**
 * Load models for selected provider
 */
async function loadModelsForProvider() {
  const providerSelect = document.getElementById('endpoint-provider');
  const modelSelect = document.getElementById('endpoint-model');

  if (!providerSelect || !modelSelect) return;

  const providerId = providerSelect.value;
  const provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });

  if (!provider) return;

  // Use LLM models configured for this provider (not static presets)
  const models = provider.llmModels || [];

  if (models.length === 0) {
    modelSelect.innerHTML = '<option value="">' + t('apiSettings.noModelsConfigured') + '</option>';
    return;
  }

  modelSelect.innerHTML = '<option value="">' + t('apiSettings.selectModel') + '</option>' +
    models.filter(function(m) { return m.enabled; }).map(function(m) {
      const contextInfo = m.capabilities && m.capabilities.contextWindow 
        ? ' (' + Math.round(m.capabilities.contextWindow / 1000) + 'K)' 
        : '';
      return '<option value="' + m.id + '">' + m.name + contextInfo + '</option>';
    }).join('');
}

/**
 * Toggle cache settings visibility
 */
function toggleCacheSettings() {
  const enabled = document.getElementById('cache-enabled').checked;
  const settings = document.getElementById('cache-settings');
  settings.style.display = enabled ? 'block' : 'none';
}

// ========== Cache Management ==========

/**
 * Clear cache
 */
async function clearCache() {
  if (!confirm(t('apiSettings.confirmClearCache'))) return;

  try {
    const response = await fetch('/api/litellm-api/cache/clear', {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to clear cache');

    const result = await response.json();
    showRefreshToast(t('apiSettings.cacheCleared') + ' (' + result.removed + ' entries)', 'success');

    // Cache stats might have changed, but apiSettingsData doesn't need refresh
    await renderApiSettings();
  } catch (err) {
    console.error('Failed to clear cache:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Toggle global cache
 */
async function toggleGlobalCache() {
  const enabled = document.getElementById('global-cache-enabled').checked;

  try {
    const response = await fetch('/api/litellm-api/config/cache', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled })
    });

    if (!response.ok) throw new Error('Failed to update cache settings');

    showRefreshToast(t('apiSettings.cacheSettingsUpdated'), 'success');
  } catch (err) {
    console.error('Failed to update cache settings:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
    // Revert checkbox
    document.getElementById('global-cache-enabled').checked = !enabled;
  }
}

// ========== Rendering ==========

/**
 * Render API Settings page - Split Layout
 */
async function renderApiSettings() {
  var container = document.getElementById('mainContent');
  if (!container) return;

  // Hide stats grid and search
  var statsGrid = document.getElementById('statsGrid');
  var searchInput = document.getElementById('searchInput');
  if (statsGrid) statsGrid.style.display = 'none';
  if (searchInput) searchInput.parentElement.style.display = 'none';

  // Load data (use cache by default, forceRefresh=false)
  await loadApiSettings(false);

  if (!apiSettingsData) {
    container.innerHTML = '<div class="api-settings-container">' +
      '<div class="error-message">' + t('apiSettings.failedToLoad') + '</div>' +
      '</div>';
    return;
  }

  // Build sidebar tabs HTML
  var sidebarTabsHtml = '<div class="sidebar-tabs">' +
    '<button class="sidebar-tab' + (activeSidebarTab === 'providers' ? ' active' : '') + '" onclick="switchSidebarTab(\'providers\')">' +
    '<i data-lucide="server"></i> ' + t('apiSettings.providers') +
    '</button>' +
    '<button class="sidebar-tab' + (activeSidebarTab === 'endpoints' ? ' active' : '') + '" onclick="switchSidebarTab(\'endpoints\')">' +
    '<i data-lucide="link"></i> ' + t('apiSettings.endpoints') +
    '</button>' +
    '<button class="sidebar-tab' + (activeSidebarTab === 'embedding-pool' ? ' active' : '') + '" onclick="switchSidebarTab(\'embedding-pool\')">' +
    '<i data-lucide="repeat"></i> ' + t('apiSettings.embeddingPool') +
    '</button>' +
    '<button class="sidebar-tab' + (activeSidebarTab === 'cache' ? ' active' : '') + '" onclick="switchSidebarTab(\'cache\')">' +
    '<i data-lucide="database"></i> ' + t('apiSettings.cache') +
    '</button>' +
    '</div>';

  // Build sidebar content based on active tab
  var sidebarContentHtml = '';
  var addButtonHtml = '';

  if (activeSidebarTab === 'providers') {
    sidebarContentHtml = '<div class="provider-search">' +
      '<i data-lucide="search" class="search-icon"></i>' +
      '<input type="text" class="cli-input" id="provider-search-input" placeholder="' + t('apiSettings.searchProviders') + '" oninput="filterProviders(this.value)" />' +
      '</div>' +
      '<div class="provider-list" id="provider-list"></div>';
    addButtonHtml = '<button class="btn btn-primary btn-full" onclick="showAddProviderModal()">' +
      '<i data-lucide="plus"></i> ' + t('apiSettings.addProvider') +
      '</button>';
  } else if (activeSidebarTab === 'endpoints') {
    sidebarContentHtml = '<div class="endpoints-list" id="endpoints-list"></div>';
    addButtonHtml = '<button class="btn btn-primary btn-full" onclick="showAddEndpointModal()">' +
      '<i data-lucide="plus"></i> ' + t('apiSettings.addEndpoint') +
      '</button>';
  } else if (activeSidebarTab === 'embedding-pool') {
    // Load embedding pool config first if not already loaded
    if (!embeddingPoolConfig) {
      await loadEmbeddingPoolConfig();
    }
    sidebarContentHtml = renderEmbeddingPoolSidebar();
  } else if (activeSidebarTab === 'cache') {
    sidebarContentHtml = '<div class="cache-sidebar-info" style="padding: 1rem; color: var(--text-secondary); font-size: 0.875rem;">' +
      '<p>' + t('apiSettings.cacheTabHint') + '</p>' +
      '</div>';
  }

  // Build split layout
  container.innerHTML =
    // CCW-LiteLLM Status Container
    '<div id="ccwLitellmStatusContainer" class="mb-4"></div>' +
    '<div class="api-settings-container api-settings-split">' +
    // Left Sidebar
    '<aside class="api-settings-sidebar">' +
    sidebarTabsHtml +
    sidebarContentHtml +
    '<div class="provider-list-footer">' +
    addButtonHtml +
    '</div>' +
    '</aside>' +
    // Right Main Panel
    '<main class="api-settings-main" id="provider-detail-panel"></main>' +
    '</div>' +
    // Cache Panel Overlay
    '<div class="cache-panel-overlay" id="cache-panel-overlay" onclick="closeCachePanelOverlay(event)"></div>';

  // Render content based on active tab
  if (activeSidebarTab === 'providers') {
    renderProviderList();
    // Auto-select first provider if exists
    if (!selectedProviderId && apiSettingsData.providers && apiSettingsData.providers.length > 0) {
      selectProvider(apiSettingsData.providers[0].id);
    } else if (selectedProviderId) {
      renderProviderDetail(selectedProviderId);
    } else {
      renderProviderEmptyState();
    }
  } else if (activeSidebarTab === 'endpoints') {
    renderEndpointsList();
    renderEndpointsMainPanel();
  } else if (activeSidebarTab === 'embedding-pool') {
    renderEmbeddingPoolMainPanel();
  } else if (activeSidebarTab === 'cache') {
    renderCacheMainPanel();
  }

  // Check and render ccw-litellm status
  // Force refresh on first load, use cache on subsequent renders
  const forceStatusRefresh = isFirstApiSettingsRender;
  if (isFirstApiSettingsRender) {
    isFirstApiSettingsRender = false;
  }
  checkCcwLitellmStatus(forceStatusRefresh).then(renderCcwLitellmStatusCard);

  if (window.lucide) lucide.createIcons();
}

/**
 * Render provider list in sidebar
 */
function renderProviderList() {
  var container = document.getElementById('provider-list');
  if (!container) return;

  // Guard against null apiSettingsData
  var providers = (apiSettingsData && apiSettingsData.providers) ? apiSettingsData.providers : [];
  var query = providerSearchQuery.toLowerCase();

  // Filter providers
  if (query) {
    providers = providers.filter(function(p) {
      return p.name.toLowerCase().includes(query) || p.type.toLowerCase().includes(query);
    });
  }

  if (providers.length === 0) {
    container.innerHTML = '<div class="provider-list-empty">' +
      '<p>' + (query ? t('apiSettings.noProvidersFound') : t('apiSettings.noProviders')) + '</p>' +
      '</div>';
    return;
  }

  var html = '';
  providers.forEach(function(provider) {
    var isSelected = provider.id === selectedProviderId;
    var iconClass = getProviderIconClass(provider.type);
    var iconLetter = provider.type.charAt(0).toUpperCase();

    html += '<div class="provider-list-item' + (isSelected ? ' selected' : '') + '" ' +
      'data-provider-id="' + provider.id + '" onclick="selectProvider(\'' + provider.id + '\')">' +
      '<div class="provider-item-icon ' + iconClass + '">' + iconLetter + '</div>' +
      '<div class="provider-item-info">' +
      '<span class="provider-item-name">' + escapeHtml(provider.name) + '</span>' +
      '<span class="provider-item-type">' + provider.type + '</span>' +
      '</div>' +
      '<span class="status-badge ' + (provider.enabled ? 'status-enabled' : 'status-disabled') + '">' +
      (provider.enabled ? 'ON' : 'OFF') +
      '</span>' +
      '</div>';
  });

  container.innerHTML = html;
}

/**
 * Filter providers by search query
 */
function filterProviders(query) {
  providerSearchQuery = query;
  renderProviderList();
}

/**
 * Switch sidebar tab
 */
function switchSidebarTab(tab) {
  activeSidebarTab = tab;
  renderApiSettings();
}

/**
 * Select a provider
 */
function selectProvider(providerId) {
  selectedProviderId = providerId;
  renderProviderList();
  renderProviderDetail(providerId);
}

/**
 * Render provider detail panel
 */
function renderProviderDetail(providerId) {
  var container = document.getElementById('provider-detail-panel');
  if (!container) return;

  // Guard against null apiSettingsData
  if (!apiSettingsData || !apiSettingsData.providers) {
    renderProviderEmptyState();
    return;
  }

  var provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (!provider) {
    renderProviderEmptyState();
    return;
  }

  var maskedKey = provider.apiKey ? '••••••••••••••••' + provider.apiKey.slice(-4) : '••••••••';
  var currentApiBase = provider.apiBase || getDefaultApiBase(provider.type);
  // Show full endpoint URL preview based on active model tab
  var endpointPath = activeModelTab === 'embedding' ? '/embeddings' : activeModelTab === 'reranker' ? '/rerank' : '/chat/completions';
  var apiBasePreview = currentApiBase + endpointPath;

  var html = '<div class="provider-detail-header">' +
    '<div class="provider-detail-title">' +
    '<div class="provider-item-icon ' + getProviderIconClass(provider.type) + '">' +
    provider.type.charAt(0).toUpperCase() +
    '</div>' +
    '<h2>' + escapeHtml(provider.name) + '</h2>' +
    '<button class="btn-icon-sm" onclick="showEditProviderModal(\'' + providerId + '\')" title="' + t('common.settings') + '">' +
    '<i data-lucide="settings"></i>' +
    '</button>' +
    '<button class="btn-icon-sm text-destructive" onclick="deleteProviderWithConfirm(\'' + providerId + '\')" title="' + t('apiSettings.deleteProvider') + '">' +
    '<i data-lucide="trash-2"></i>' +
    '</button>' +
    '</div>' +
    '<div class="provider-detail-actions">' +
    '<label class="toggle-switch">' +
    '<input type="checkbox" ' + (provider.enabled ? 'checked' : '') + ' onchange="toggleProviderEnabled(\'' + providerId + '\', this.checked)" />' +
    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
    '</label>' +
    '</div>' +
    '</div>' +
    '<div class="provider-detail-content">' +
    // API Key field
    '<div class="field-group">' +
    '<div class="field-label">' +
    '<span>' + t('apiSettings.apiKey') + '</span>' +
    '<div class="field-label-actions">' +
    '<button class="btn-icon-sm" onclick="copyProviderApiKey(\'' + providerId + '\')" title="' + t('common.copy') + '">' +
    '<i data-lucide="copy"></i>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="field-input-group">' +
    '<input type="password" class="cli-input" id="provider-detail-apikey" value="' + escapeHtml(provider.apiKey) + '" readonly />' +
    '<button class="btn-icon" onclick="toggleApiKeyVisibility(\'provider-detail-apikey\')">' +
    '<i data-lucide="eye"></i>' +
    '</button>' +
    '<button class="btn btn-secondary" onclick="testProviderConnection()">' + t('apiSettings.testConnection') + '</button>' +
    '</div>' +
    '</div>' +
    // API Base URL field - editable
    '<div class="field-group">' +
    '<div class="field-label">' +
    '<span>' + t('apiSettings.apiBaseUrl') + '</span>' +
    '</div>' +
    '<div class="field-input-group">' +
    '<input type="text" class="cli-input" id="provider-detail-apibase" value="' + escapeHtml(currentApiBase) + '" placeholder="https://api.openai.com/v1" oninput="updateApiBasePreview(this.value)" />' +
    '<button class="btn btn-secondary" onclick="saveProviderApiBase(\'' + providerId + '\')">' +
    '<i data-lucide="save"></i> ' + t('common.save') +
    '</button>' +
    '</div>' +
    '<span class="field-hint" id="api-base-preview">' + t('apiSettings.preview') + ': ' + escapeHtml(apiBasePreview) + '</span>' +
    '</div>' +
    // Model Section
    '<div class="model-section">' +
    '<div class="model-section-header">' +
    '<div class="model-tabs">' +
    '<button class="model-tab' + (activeModelTab === 'llm' ? ' active' : '') + '" onclick="switchModelTab(\'llm\')">' +
    t('apiSettings.llmModels') +
    '</button>' +
    '<button class="model-tab' + (activeModelTab === 'embedding' ? ' active' : '') + '" onclick="switchModelTab(\'embedding\')">' +
    t('apiSettings.embeddingModels') +
    '</button>' +
    '<button class="model-tab' + (activeModelTab === 'reranker' ? ' active' : '') + '" onclick="switchModelTab(\'reranker\')">' +
    t('apiSettings.rerankerModels') +
    '</button>' +
    '</div>' +
    '<div class="model-section-actions">' +
    '<button class="btn btn-secondary" onclick="showManageModelsModal(\'' + providerId + '\')">' +
    '<i data-lucide="list"></i> ' + t('apiSettings.manageModels') +
    '</button>' +
    '<button class="btn btn-primary" onclick="showAddModelModal(\'' + providerId + '\')">' +
    '<i data-lucide="plus"></i> ' + t('apiSettings.addModel') +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="model-tree" id="model-tree"></div>' +
    '</div>' +
    // Multi-key and sync buttons
    '<div class="multi-key-trigger">' +
    '<button class="btn btn-secondary multi-key-btn" onclick="showMultiKeyModal(\'' + providerId + '\')">' +
    '<i data-lucide="key-round"></i> ' + t('apiSettings.multiKeySettings') +
    '</button>' +
    '<button class="btn btn-secondary" onclick="syncConfigToCodexLens()">' +
    '<i data-lucide="refresh-cw"></i> ' + t('apiSettings.syncToCodexLens') +
    '</button>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
  renderModelTree(provider);

  if (window.lucide) lucide.createIcons();
}

/**
 * Render provider empty state
 */
function renderProviderEmptyState() {
  var container = document.getElementById('provider-detail-panel');
  if (!container) return;

  container.innerHTML = '<div class="provider-empty-state">' +
    '<i data-lucide="database" class="provider-empty-state-icon"></i>' +
    '<h3>' + t('apiSettings.selectProvider') + '</h3>' +
    '<p>' + t('apiSettings.selectProviderHint') + '</p>' +
    '</div>';

  if (window.lucide) lucide.createIcons();
}

/**
 * Render model tree
 */
function renderModelTree(provider) {
  var container = document.getElementById('model-tree');
  if (!container) return;

  var models = activeModelTab === 'llm'
    ? (provider.llmModels || [])
    : activeModelTab === 'reranker'
    ? (provider.rerankerModels || [])
    : (provider.embeddingModels || []);

  if (models.length === 0) {
    container.innerHTML = '<div class="model-tree-empty">' +
      '<i data-lucide="package" class="model-tree-empty-icon"></i>' +
      '<p>' + t('apiSettings.noModels') + '</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Group models by series
  var groups = groupModelsBySeries(models);

  var html = '';
  groups.forEach(function(group) {
    var isExpanded = expandedModelGroups.has(group.series);

    html += '<div class="model-group' + (isExpanded ? ' expanded' : '') + '" data-series="' + escapeHtml(group.series) + '">' +
      '<div class="model-group-header" onclick="toggleModelGroup(\'' + escapeHtml(group.series) + '\')">' +
      '<i data-lucide="chevron-right" class="model-group-toggle"></i>' +
      '<span class="model-group-name">' + escapeHtml(group.series) + '</span>' +
      '<span class="model-group-count">' + group.models.length + '</span>' +
      '</div>' +
      '<div class="model-group-children">';

    group.models.forEach(function(model) {
      var badge = model.capabilities && model.capabilities.contextWindow
        ? formatContextWindow(model.capabilities.contextWindow)
        : '';

      // Badge for embedding models shows dimension instead of context window
      var embeddingBadge = model.capabilities && model.capabilities.embeddingDimension
        ? model.capabilities.embeddingDimension + 'd'
        : '';

      // Badge for reranker models shows max tokens
      var rerankerBadge = model.capabilities && model.capabilities.maxInputTokens
        ? formatContextWindow(model.capabilities.maxInputTokens)
        : '';

      var displayBadge = activeModelTab === 'llm' ? badge : activeModelTab === 'reranker' ? rerankerBadge : embeddingBadge;
      var iconName = activeModelTab === 'llm' ? 'sparkles' : activeModelTab === 'reranker' ? 'arrow-up-down' : 'box';

      html += '<div class="model-item" data-model-id="' + model.id + '">' +
        '<i data-lucide="' + iconName + '" class="model-item-icon"></i>' +
        '<span class="model-item-name">' + escapeHtml(model.name) + '</span>' +
        (displayBadge ? '<span class="model-item-badge">' + displayBadge + '</span>' : '') +
        '<div class="model-item-actions">' +
        '<button class="btn-icon-sm" onclick="showModelSettingsModal(\'' + selectedProviderId + '\', \'' + model.id + '\', \'' + activeModelTab + '\')" title="' + t('apiSettings.modelSettings') + '">' +
        '<i data-lucide="settings"></i>' +
        '</button>' +
        '<button class="btn-icon-sm text-destructive" onclick="deleteModel(\'' + selectedProviderId + '\', \'' + model.id + '\', \'' + activeModelTab + '\')" title="' + t('apiSettings.deleteModel') + '">' +
        '<i data-lucide="trash-2"></i>' +
        '</button>' +
        '</div>' +
        '</div>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

/**
 * Group models by series
 */
function groupModelsBySeries(models) {
  var seriesMap = {};

  models.forEach(function(model) {
    var series = model.series || 'Other';
    if (!seriesMap[series]) {
      seriesMap[series] = [];
    }
    seriesMap[series].push(model);
  });

  return Object.keys(seriesMap).map(function(series) {
    return { series: series, models: seriesMap[series] };
  }).sort(function(a, b) {
    return a.series.localeCompare(b.series);
  });
}

/**
 * Toggle model group expand/collapse
 */
function toggleModelGroup(series) {
  if (expandedModelGroups.has(series)) {
    expandedModelGroups.delete(series);
  } else {
    expandedModelGroups.add(series);
  }

  // Guard against null apiSettingsData
  if (!apiSettingsData || !apiSettingsData.providers) return;

  var provider = apiSettingsData.providers.find(function(p) { return p.id === selectedProviderId; });
  if (provider) {
    renderModelTree(provider);
  }
}

/**
 * Switch model tab (LLM / Embedding)
 */
async function switchModelTab(tab) {
  activeModelTab = tab;
  expandedModelGroups.clear();

  // Guard against null apiSettingsData or providers - try to load if not available
  if (!apiSettingsData || !apiSettingsData.providers) {
    console.warn('[API Settings] switchModelTab: loading data first...');
    await loadApiSettings(true);
    if (!apiSettingsData || !apiSettingsData.providers) {
      console.error('[API Settings] Failed to load API settings data');
      return;
    }
  }

  var provider = apiSettingsData.providers.find(function(p) { return p.id === selectedProviderId; });
  if (provider) {
    renderProviderDetail(selectedProviderId);
  }
}

/**
 * Format context window for display
 */
function formatContextWindow(tokens) {
  if (tokens >= 1000000) return Math.round(tokens / 1000000) + 'M';
  if (tokens >= 1000) return Math.round(tokens / 1000) + 'K';
  return tokens.toString();
}

/**
 * Get default API base URL for provider type
 */
function getDefaultApiBase(type) {
  var defaults = {
    'openai': 'https://api.openai.com/v1',
    'anthropic': 'https://api.anthropic.com/v1'
  };
  return defaults[type] || 'https://api.example.com/v1';
}

/**
 * Toggle provider enabled status
 */
async function toggleProviderEnabled(providerId, enabled) {
  try {
    var response = await fetch('/api/litellm-api/providers/' + providerId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled })
    });
    if (!response.ok) throw new Error('Failed to update provider');

    // Update local data (for instant UI feedback)
    var provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
    if (provider) provider.enabled = enabled;

    renderProviderList();
    showRefreshToast(t('apiSettings.providerUpdated'), 'success');

    // Invalidate cache for next render
    setTimeout(function() {
      apiSettingsData = null;
    }, 100);
  } catch (err) {
    console.error('Failed to toggle provider:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Show cache panel
 */
async function showCachePanel() {
  var overlay = document.getElementById('cache-panel-overlay');
  if (!overlay) return;

  var cacheStats = await loadCacheStats();
  var usedMB = (cacheStats.totalSize / 1048576).toFixed(1);
  var maxMB = (cacheStats.maxSize / 1048576).toFixed(0);
  var usagePercent = cacheStats.maxSize > 0 ? Math.round((cacheStats.totalSize / cacheStats.maxSize) * 100) : 0;

  overlay.innerHTML = '<div class="cache-panel-content" onclick="event.stopPropagation()">' +
    '<div class="cache-header">' +
    '<div class="section-title-group">' +
    '<h3>' + t('apiSettings.cacheSettings') + '</h3>' +
    '</div>' +
    '<button class="btn-icon-sm" onclick="closeCachePanel()">' +
    '<i data-lucide="x"></i>' +
    '</button>' +
    '</div>' +
    '<div class="cache-content">' +
    '<label class="toggle-switch">' +
    '<input type="checkbox" id="global-cache-enabled" ' + (cacheStats.enabled ? 'checked' : '') + ' onchange="toggleGlobalCache(this.checked)" />' +
    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
    '<span class="toggle-label">' + t('apiSettings.enableGlobalCaching') + '</span>' +
    '</label>' +
    '<div class="cache-visual">' +
    '<div class="cache-bars">' +
    '<div class="cache-bar-fill" style="width: ' + usagePercent + '%"></div>' +
    '</div>' +
    '<div class="cache-legend">' +
    '<span>' + usedMB + ' MB ' + t('apiSettings.used') + '</span>' +
    '<span>' + maxMB + ' MB ' + t('apiSettings.total') + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="stat-grid">' +
    '<div class="stat-card">' +
    '<span class="stat-value">' + usagePercent + '%</span>' +
    '<span class="stat-desc">' + t('apiSettings.cacheUsage') + '</span>' +
    '</div>' +
    '<div class="stat-card">' +
    '<span class="stat-value">' + cacheStats.entries + '</span>' +
    '<span class="stat-desc">' + t('apiSettings.cacheEntries') + '</span>' +
    '</div>' +
    '</div>' +
    '<button class="btn btn-secondary btn-full" onclick="clearCache()">' +
    '<i data-lucide="trash-2"></i> ' + t('apiSettings.clearCache') +
    '</button>' +
    '</div>' +
    '</div>';

  overlay.classList.add('active');
  if (window.lucide) lucide.createIcons();
}

/**
 * Close cache panel
 */
function closeCachePanel() {
  var overlay = document.getElementById('cache-panel-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

/**
 * Close cache panel when clicking overlay
 */
function closeCachePanelOverlay(event) {
  if (event.target.id === 'cache-panel-overlay') {
    closeCachePanel();
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========== Model Management ==========

/**
 * Show add model modal
 */
function showAddModelModal(providerId, modelType) {
  // Default to active tab if no modelType provided
  if (!modelType) {
    modelType = activeModelTab;
  }

  // Get provider to know which presets to show
  const provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (!provider) return;

  const isLlm = modelType === 'llm';
  const isReranker = modelType === 'reranker';
  const title = isLlm ? t('apiSettings.addLlmModel') : isReranker ? t('apiSettings.addRerankerModel') : t('apiSettings.addEmbeddingModel');

  // Get model presets based on provider type
  const presets = isLlm ? getLlmPresetsForType(provider.type) : isReranker ? getRerankerPresetsForType(provider.type) : getEmbeddingPresetsForType(provider.type);

  // Group presets by series
  const groupedPresets = groupPresetsBySeries(presets);

  const modalHtml = '<div class="generic-modal-overlay active" id="add-model-modal">' +
    '<div class="generic-modal" style="max-width: 600px;">' +
    '<div class="generic-modal-header">' +
    '<h3 class="generic-modal-title">' + title + '</h3>' +
    '<button class="generic-modal-close" onclick="closeAddModelModal()">&times;</button>' +
    '</div>' +
    '<div class="generic-modal-body">' +
    '<form id="add-model-form" class="api-settings-form" onsubmit="saveNewModel(event, \'' + providerId + '\', \'' + modelType + '\')">' +

    // Preset Selection
    '<div class="form-group">' +
    '<label>' + t('apiSettings.selectFromPresets') + '</label>' +
    '<select id="model-preset" class="cli-input" onchange="fillModelFromPreset(this.value, \'' + modelType + '\')">' +
    '<option value="">' + t('apiSettings.customModel') + '</option>' +
    Object.keys(groupedPresets).map(function(series) {
      return '<optgroup label="' + series + '">' +
        groupedPresets[series].map(function(m) {
          var info = isLlm ? '(' + (m.contextWindow/1000) + 'K)' : isReranker ? '' : '(' + m.dimensions + 'D)';
          return '<option value="' + m.id + '">' + m.name + ' ' + info + '</option>';
        }).join('') +
        '</optgroup>';
    }).join('') +
    '</select>' +
    '</div>' +

    // Model ID
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelId') + ' *</label>' +
    '<input type="text" id="model-id" class="cli-input" required placeholder="e.g., gpt-4o" />' +
    '</div>' +

    // Display Name
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelName') + ' *</label>' +
    '<input type="text" id="model-name" class="cli-input" required placeholder="e.g., GPT-4o" />' +
    '</div>' +

    // Series
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelSeries') + ' *</label>' +
    '<input type="text" id="model-series" class="cli-input" required placeholder="e.g., GPT-4" />' +
    '</div>' +

    // Capabilities based on model type
    (isLlm ?
      '<div class="form-group">' +
      '<label>' + t('apiSettings.contextWindow') + '</label>' +
      '<input type="number" id="model-context-window" class="cli-input" value="128000" min="1000" />' +
      '</div>' +
      '<div class="form-group capabilities-checkboxes">' +
      '<label style="display: block; margin-bottom: 0.5rem;">' + t('apiSettings.capabilities') + '</label>' +
      '<label class="checkbox-label">' +
      '<input type="checkbox" id="cap-streaming" checked /> ' + t('apiSettings.streaming') +
      '</label>' +
      '<label class="checkbox-label">' +
      '<input type="checkbox" id="cap-function-calling" /> ' + t('apiSettings.functionCalling') +
      '</label>' +
      '<label class="checkbox-label">' +
      '<input type="checkbox" id="cap-vision" /> ' + t('apiSettings.vision') +
      '</label>' +
      '</div>'
    : isReranker ?
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingMaxTokens') + '</label>' +
      '<input type="number" id="model-max-tokens" class="cli-input" value="8192" min="128" />' +
      '</div>' +
      '<div class="form-group">' +
      '<label>' + t('apiSettings.rerankerTopK') + '</label>' +
      '<input type="number" id="model-top-k" class="cli-input" value="10" min="1" max="100" />' +
      '<span class="field-hint">' + t('apiSettings.rerankerTopKHint') + '</span>' +
      '</div>'
    :
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingDimensions') + ' *</label>' +
      '<input type="number" id="model-dimensions" class="cli-input" value="1536" min="64" required />' +
      '</div>' +
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingMaxTokens') + '</label>' +
      '<input type="number" id="model-max-tokens" class="cli-input" value="8192" min="128" />' +
      '</div>'
    ) +

    // Description
    '<div class="form-group">' +
    '<label>' + t('apiSettings.description') + '</label>' +
    '<textarea id="model-description" class="cli-input" rows="2" placeholder="' + t('apiSettings.optional') + '"></textarea>' +
    '</div>' +

    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-secondary" onclick="closeAddModelModal()"><i data-lucide="x"></i> ' + t('common.cancel') + '</button>' +
    '<button type="submit" class="btn btn-primary"><i data-lucide="check"></i> ' + t('common.save') + '</button>' +
    '</div>' +
    '</form>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (window.lucide) lucide.createIcons();
}

/**
 * Close add model modal
 */
function closeAddModelModal() {
  const modal = document.getElementById('add-model-modal');
  if (modal) modal.remove();
}

/**
 * Get LLM presets for provider type
 */
function getLlmPresetsForType(providerType) {
  const presets = {
    openai: [
      { id: 'gpt-4o', name: 'GPT-4o', series: 'GPT-4', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', series: 'GPT-4', contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', series: 'GPT-4', contextWindow: 128000 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', series: 'GPT-3.5', contextWindow: 16385 },
      { id: 'o1', name: 'O1', series: 'O1', contextWindow: 200000 },
      { id: 'o1-mini', name: 'O1 Mini', series: 'O1', contextWindow: 128000 },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', series: 'DeepSeek', contextWindow: 64000 },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', series: 'DeepSeek', contextWindow: 64000 }
    ],
    anthropic: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', series: 'Claude 4', contextWindow: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', series: 'Claude 3.5', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', series: 'Claude 3.5', contextWindow: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', series: 'Claude 3', contextWindow: 200000 }
    ],
    custom: [
      { id: 'custom-model', name: 'Custom Model', series: 'Custom', contextWindow: 128000 }
    ]
  };
  return presets[providerType] || presets.custom;
}

/**
 * Get Embedding presets for provider type
 */
function getEmbeddingPresetsForType(providerType) {
  const presets = {
    openai: [
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', series: 'Embedding V3', dimensions: 1536, maxTokens: 8191 },
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', series: 'Embedding V3', dimensions: 3072, maxTokens: 8191 },
      { id: 'text-embedding-ada-002', name: 'Ada 002', series: 'Embedding V2', dimensions: 1536, maxTokens: 8191 }
    ],
    anthropic: [],  // Anthropic doesn't have embedding models
    custom: [
      { id: 'custom-embedding', name: 'Custom Embedding', series: 'Custom', dimensions: 1536, maxTokens: 8192 }
    ]
  };
  return presets[providerType] || presets.custom;
}

/**
 * Get reranker model presets based on provider type
 */
function getRerankerPresetsForType(providerType) {
  const presets = {
    openai: [
      { id: 'BAAI/bge-reranker-v2-m3', name: 'BGE Reranker v2 M3', series: 'BGE Reranker', topK: 10 },
      { id: 'BAAI/bge-reranker-large', name: 'BGE Reranker Large', series: 'BGE Reranker', topK: 10 },
      { id: 'BAAI/bge-reranker-base', name: 'BGE Reranker Base', series: 'BGE Reranker', topK: 10 }
    ],
    cohere: [
      { id: 'rerank-english-v3.0', name: 'Rerank English v3.0', series: 'Cohere Rerank', topK: 10 },
      { id: 'rerank-multilingual-v3.0', name: 'Rerank Multilingual v3.0', series: 'Cohere Rerank', topK: 10 },
      { id: 'rerank-english-v2.0', name: 'Rerank English v2.0', series: 'Cohere Rerank', topK: 10 }
    ],
    voyage: [
      { id: 'rerank-2', name: 'Rerank 2', series: 'Voyage Rerank', topK: 10 },
      { id: 'rerank-2-lite', name: 'Rerank 2 Lite', series: 'Voyage Rerank', topK: 10 },
      { id: 'rerank-1', name: 'Rerank 1', series: 'Voyage Rerank', topK: 10 }
    ],
    jina: [
      { id: 'jina-reranker-v2-base-multilingual', name: 'Jina Reranker v2 Multilingual', series: 'Jina Reranker', topK: 10 },
      { id: 'jina-reranker-v1-base-en', name: 'Jina Reranker v1 English', series: 'Jina Reranker', topK: 10 }
    ],
    custom: [
      { id: 'custom-reranker', name: 'Custom Reranker', series: 'Custom', topK: 10 }
    ]
  };
  return presets[providerType] || presets.custom;
}

/**
 * Group presets by series
 */
function groupPresetsBySeries(presets) {
  const grouped = {};
  presets.forEach(function(preset) {
    if (!grouped[preset.series]) {
      grouped[preset.series] = [];
    }
    grouped[preset.series].push(preset);
  });
  return grouped;
}

/**
 * Fill model form from preset
 */
function fillModelFromPreset(presetId, modelType) {
  if (!presetId) {
    // Clear fields for custom model
    document.getElementById('model-id').value = '';
    document.getElementById('model-name').value = '';
    document.getElementById('model-series').value = '';
    return;
  }

  const provider = apiSettingsData.providers.find(function(p) { return p.id === selectedProviderId; });
  if (!provider) return;

  const isLlm = modelType === 'llm';
  const isReranker = modelType === 'reranker';
  const presets = isLlm ? getLlmPresetsForType(provider.type) : isReranker ? getRerankerPresetsForType(provider.type) : getEmbeddingPresetsForType(provider.type);
  const preset = presets.find(function(p) { return p.id === presetId; });

  if (preset) {
    document.getElementById('model-id').value = preset.id;
    document.getElementById('model-name').value = preset.name;
    document.getElementById('model-series').value = preset.series;

    if (isLlm && preset.contextWindow) {
      document.getElementById('model-context-window').value = preset.contextWindow;
    }
    if (isReranker && preset.topK) {
      var topKEl = document.getElementById('model-top-k');
      if (topKEl) topKEl.value = preset.topK;
    }
    if (!isLlm && !isReranker && preset.dimensions) {
      document.getElementById('model-dimensions').value = preset.dimensions;
      if (preset.maxTokens) {
        document.getElementById('model-max-tokens').value = preset.maxTokens;
      }
    }
  }
}

/**
 * Save new model
 */
function saveNewModel(event, providerId, modelType) {
  event.preventDefault();

  const isLlm = modelType === 'llm';
  const isReranker = modelType === 'reranker';
  const now = new Date().toISOString();

  const newModel = {
    id: document.getElementById('model-id').value.trim(),
    name: document.getElementById('model-name').value.trim(),
    type: modelType,
    series: document.getElementById('model-series').value.trim(),
    enabled: true,
    description: document.getElementById('model-description').value.trim() || undefined,
    createdAt: now,
    updatedAt: now
  };

  // Add capabilities based on model type
  if (isLlm) {
    newModel.capabilities = {
      contextWindow: parseInt(document.getElementById('model-context-window').value) || 128000,
      streaming: document.getElementById('cap-streaming').checked,
      functionCalling: document.getElementById('cap-function-calling').checked,
      vision: document.getElementById('cap-vision').checked
    };
  } else if (isReranker) {
    var topKEl = document.getElementById('model-top-k');
    var maxTokensEl = document.getElementById('model-max-tokens');
    newModel.capabilities = {
      maxInputTokens: maxTokensEl ? parseInt(maxTokensEl.value) || 8192 : 8192,
      topK: topKEl ? parseInt(topKEl.value) || 10 : 10
    };
  } else {
    newModel.capabilities = {
      embeddingDimension: parseInt(document.getElementById('model-dimensions').value) || 1536,
      maxInputTokens: parseInt(document.getElementById('model-max-tokens').value) || 8192
    };
  }

  // Save to provider
  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const modelsKey = isLlm ? 'llmModels' : isReranker ? 'rerankerModels' : 'embeddingModels';
      const models = provider[modelsKey] || [];

      // Check for duplicate ID
      if (models.some(function(m) { return m.id === newModel.id; })) {
        showRefreshToast(t('apiSettings.modelIdExists'), 'error');
        return Promise.reject('Duplicate ID');
      }

      models.push(newModel);
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [modelsKey]: models })
      });
    })
    .then(function() {
      closeAddModelModal();
      // Force refresh to get latest data including newly created model
      return loadApiSettings(true);
    })
    .then(function() {
      if (selectedProviderId === providerId) {
        selectProvider(providerId);
      }
      showRefreshToast(t('common.saveSuccess'), 'success');
    })
    .catch(function(err) {
      if (err !== 'Duplicate ID') {
        console.error('Failed to save model:', err);
        showRefreshToast(t('common.saveFailed'), 'error');
      }
    });
}

function showManageModelsModal(providerId) {
  // For now, show a helpful message
  showRefreshToast(t('apiSettings.useModelTreeToManage'), 'info');
}

function showModelSettingsModal(providerId, modelId, modelType) {
  var provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (!provider) return;

  var isLlm = modelType === 'llm';
  var isReranker = modelType === 'reranker';
  var models = isLlm ? (provider.llmModels || []) : isReranker ? (provider.rerankerModels || []) : (provider.embeddingModels || []);
  var model = models.find(function(m) { return m.id === modelId; });
  if (!model) return;

  var capabilities = model.capabilities || {};
  var endpointSettings = model.endpointSettings || {};

  // Calculate endpoint preview URL
  var providerBase = provider.apiBase || getDefaultApiBase(provider.type);
  var modelBaseUrl = endpointSettings.baseUrl || providerBase;
  var endpointPath = isLlm ? '/chat/completions' : isReranker ? '/rerank' : '/embeddings';
  var endpointPreview = modelBaseUrl + endpointPath;

  var modalHtml = '<div class="modal-overlay" id="model-settings-modal">' +
    '<div class="modal-content" style="max-width: 600px;">' +
    '<div class="modal-header">' +
    '<h3>' + t('apiSettings.modelSettings') + ': ' + escapeHtml(model.name) + '</h3>' +
    '<button class="modal-close" onclick="closeModelSettingsModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<form id="model-settings-form" onsubmit="saveModelSettings(event, \'' + providerId + '\', \'' + modelId + '\', \'' + modelType + '\')">' +

    // Endpoint Preview Section (combined view + settings)
    '<div class="form-section endpoint-preview-section">' +
    '<h4><i data-lucide="' + (isLlm ? 'message-square' : isReranker ? 'sort-asc' : 'box') + '"></i> ' + t('apiSettings.endpointPreview') + '</h4>' +
    '<div class="endpoint-preview-box">' +
    '<code id="model-endpoint-preview">' + escapeHtml(endpointPreview) + '</code>' +
    '<button type="button" class="btn-icon-sm" onclick="copyModelEndpoint()" title="' + t('common.copy') + '">' +
    '<i data-lucide="copy"></i>' +
    '</button>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelBaseUrlOverride') + ' <span class="text-muted">(' + t('common.optional') + ')</span></label>' +
    '<input type="text" id="model-settings-baseurl" class="cli-input" value="' + escapeHtml(endpointSettings.baseUrl || '') + '" placeholder="' + escapeHtml(providerBase) + '" oninput="updateModelEndpointPreview(\'' + (isLlm ? 'chat/completions' : isReranker ? 'rerank' : 'embeddings') + '\', \'' + escapeHtml(providerBase) + '\')">' +
    '<small class="form-hint">' + t('apiSettings.modelBaseUrlHint') + '</small>' +
    '</div>' +
    '</div>' +

    // Basic Info
    '<div class="form-section">' +
    '<h4>' + t('apiSettings.basicInfo') + '</h4>' +
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelName') + '</label>' +
    '<input type="text" id="model-settings-name" class="cli-input" value="' + escapeHtml(model.name || '') + '" required>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>' + t('apiSettings.modelSeries') + '</label>' +
    '<input type="text" id="model-settings-series" class="cli-input" value="' + escapeHtml(model.series || '') + '" required>' +
    '</div>' +
    '<div class="form-group">' +
    '<label>' + t('apiSettings.description') + '</label>' +
    '<textarea id="model-settings-description" class="cli-input" rows="2">' + escapeHtml(model.description || '') + '</textarea>' +
    '</div>' +
    '</div>' +

    // Capabilities
    '<div class="form-section">' +
    '<h4>' + t('apiSettings.capabilities') + '</h4>' +
    (isLlm ? (
      '<div class="form-group">' +
      '<label>' + t('apiSettings.contextWindow') + '</label>' +
      '<input type="number" id="model-settings-context" class="cli-input" value="' + (capabilities.contextWindow || 128000) + '" min="1000">' +
      '</div>' +
      '<div class="form-group capabilities-checkboxes">' +
      '<label class="checkbox-label"><input type="checkbox" id="model-settings-streaming"' + (capabilities.streaming ? ' checked' : '') + '> ' + t('apiSettings.streaming') + '</label>' +
      '<label class="checkbox-label"><input type="checkbox" id="model-settings-function-calling"' + (capabilities.functionCalling ? ' checked' : '') + '> ' + t('apiSettings.functionCalling') + '</label>' +
      '<label class="checkbox-label"><input type="checkbox" id="model-settings-vision"' + (capabilities.vision ? ' checked' : '') + '> ' + t('apiSettings.vision') + '</label>' +
      '</div>'
    ) : isReranker ? (
      // Reranker capabilities - only maxInputTokens and topK
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingMaxTokens') + '</label>' +
      '<input type="number" id="model-settings-max-tokens" class="cli-input" value="' + (capabilities.maxInputTokens || 8192) + '" min="128">' +
      '</div>' +
      '<div class="form-group">' +
      '<label>' + t('apiSettings.rerankerTopK') + '</label>' +
      '<input type="number" id="model-settings-top-k" class="cli-input" value="' + (capabilities.topK || 50) + '" min="1" max="1000">' +
      '</div>'
    ) : (
      // Embedding capabilities - embeddingDimension and maxInputTokens
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingDimensions') + '</label>' +
      '<input type="number" id="model-settings-dimensions" class="cli-input" value="' + (capabilities.embeddingDimension || 1536) + '" min="64">' +
      '</div>' +
      '<div class="form-group">' +
      '<label>' + t('apiSettings.embeddingMaxTokens') + '</label>' +
      '<input type="number" id="model-settings-max-tokens" class="cli-input" value="' + (capabilities.maxInputTokens || 8192) + '" min="128">' +
      '</div>'
    )) +
    '</div>' +

    // Endpoint Settings
    '<div class="form-section">' +
    '<h4>' + t('apiSettings.endpointSettings') + '</h4>' +
    '<div class="form-row">' +
    '<div class="form-group form-group-half">' +
    '<label>' + t('apiSettings.timeout') + ' (' + t('apiSettings.seconds') + ')</label>' +
    '<input type="number" id="model-settings-timeout" class="cli-input" value="' + (endpointSettings.timeout || 300) + '" min="10" max="3600">' +
    '</div>' +
    '<div class="form-group form-group-half">' +
    '<label>' + t('apiSettings.maxRetries') + '</label>' +
    '<input type="number" id="model-settings-retries" class="cli-input" value="' + (endpointSettings.maxRetries || 3) + '" min="0" max="10">' +
    '</div>' +
    '</div>' +
    '</div>' +

    '<div class="modal-actions">' +
    '<button type="button" class="btn-secondary" onclick="closeModelSettingsModal()"><i data-lucide="x"></i> ' + t('common.cancel') + '</button>' +
    '<button type="submit" class="btn-primary"><i data-lucide="check"></i> ' + t('common.save') + '</button>' +
    '</div>' +
    '</form>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (window.lucide) lucide.createIcons();
}

/**
 * Update model endpoint preview when base URL changes
 */
function updateModelEndpointPreview(endpointPath, defaultBase) {
  var baseUrlInput = document.getElementById('model-settings-baseurl');
  var previewElement = document.getElementById('model-endpoint-preview');
  if (!baseUrlInput || !previewElement) return;

  var baseUrl = baseUrlInput.value.trim() || defaultBase;
  // Remove trailing slash if present
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  previewElement.textContent = baseUrl + '/' + endpointPath;
}

/**
 * Copy model endpoint URL to clipboard
 */
function copyModelEndpoint() {
  var previewElement = document.getElementById('model-endpoint-preview');
  if (previewElement) {
    navigator.clipboard.writeText(previewElement.textContent);
    showRefreshToast(t('common.copied'), 'success');
  }
}

function closeModelSettingsModal() {
  var modal = document.getElementById('model-settings-modal');
  if (modal) modal.remove();
}

function saveModelSettings(event, providerId, modelId, modelType) {
  event.preventDefault();

  var isLlm = modelType === 'llm';
  var isReranker = modelType === 'reranker';
  var modelsKey = isLlm ? 'llmModels' : isReranker ? 'rerankerModels' : 'embeddingModels';

  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      var models = provider[modelsKey] || [];
      var modelIndex = models.findIndex(function(m) { return m.id === modelId; });

      if (modelIndex === -1) {
        throw new Error('Model not found');
      }

      // Update model fields
      models[modelIndex].name = document.getElementById('model-settings-name').value.trim();
      models[modelIndex].series = document.getElementById('model-settings-series').value.trim();
      models[modelIndex].description = document.getElementById('model-settings-description').value.trim() || undefined;
      models[modelIndex].updatedAt = new Date().toISOString();

      // Update capabilities
      if (isLlm) {
        models[modelIndex].capabilities = {
          contextWindow: parseInt(document.getElementById('model-settings-context').value) || 128000,
          streaming: document.getElementById('model-settings-streaming').checked,
          functionCalling: document.getElementById('model-settings-function-calling').checked,
          vision: document.getElementById('model-settings-vision').checked
        };
      } else if (isReranker) {
        models[modelIndex].capabilities = {
          maxInputTokens: parseInt(document.getElementById('model-settings-max-tokens').value) || 8192,
          topK: parseInt(document.getElementById('model-settings-top-k').value) || 50
        };
      } else {
        models[modelIndex].capabilities = {
          embeddingDimension: parseInt(document.getElementById('model-settings-dimensions').value) || 1536,
          maxInputTokens: parseInt(document.getElementById('model-settings-max-tokens').value) || 8192
        };
      }

      // Update endpoint settings
      var baseUrlOverride = document.getElementById('model-settings-baseurl').value.trim();
      // Remove trailing slash if present
      if (baseUrlOverride && baseUrlOverride.endsWith('/')) {
        baseUrlOverride = baseUrlOverride.slice(0, -1);
      }
      models[modelIndex].endpointSettings = {
        baseUrl: baseUrlOverride || undefined,
        timeout: parseInt(document.getElementById('model-settings-timeout').value) || 300,
        maxRetries: parseInt(document.getElementById('model-settings-retries').value) || 3
      };

      var updateData = {};
      updateData[modelsKey] = models;

      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
    })
    .then(function() {
      closeModelSettingsModal();
      return loadApiSettings();
    })
    .then(function() {
      if (selectedProviderId === providerId) {
        selectProvider(providerId);
      }
      showRefreshToast(t('common.saveSuccess'), 'success');
    })
    .catch(function(err) {
      console.error('Failed to save model settings:', err);
      showRefreshToast(t('common.saveFailed'), 'error');
    });
}

function deleteModel(providerId, modelId, modelType) {
  if (!confirm(t('common.confirmDelete'))) return;

  var isLlm = modelType === 'llm';
  var isReranker = modelType === 'reranker';
  var modelsKey = isLlm ? 'llmModels' : isReranker ? 'rerankerModels' : 'embeddingModels';

  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      var models = provider[modelsKey] || [];
      var updatedModels = models.filter(function(m) { return m.id !== modelId; });

      var updateData = {};
      updateData[modelsKey] = updatedModels;

      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
    })
    .then(function() {
      return loadApiSettings();
    })
    .then(function() {
      if (selectedProviderId === providerId) {
        selectProvider(providerId);
      }
      showRefreshToast(t('common.deleteSuccess'), 'success');
    })
    .catch(function(err) {
      console.error('Failed to delete model:', err);
      showRefreshToast(t('common.deleteFailed'), 'error');
    });
}

function copyProviderApiKey(providerId) {
  var provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (provider && provider.apiKey) {
    navigator.clipboard.writeText(provider.apiKey);
    showRefreshToast(t('common.copied'), 'success');
  }
}

/**
 * Save provider API base URL
 */
async function saveProviderApiBase(providerId) {
  var input = document.getElementById('provider-detail-apibase');
  if (!input) return;

  var newApiBase = input.value.trim();
  // Remove trailing slash if present
  if (newApiBase.endsWith('/')) {
    newApiBase = newApiBase.slice(0, -1);
  }

  try {
    var response = await fetch('/api/litellm-api/providers/' + providerId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiBase: newApiBase || undefined })
    });

    if (!response.ok) throw new Error('Failed to update API base');

    // Update local data (for instant UI feedback)
    var provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
    if (provider) {
      provider.apiBase = newApiBase || undefined;
    }

    // Update preview
    updateApiBasePreview(newApiBase);
    showRefreshToast(t('apiSettings.apiBaseUpdated'), 'success');

    // Invalidate cache for next render (but keep current data for immediate UI)
    // This ensures next tab switch or page refresh gets fresh data
    setTimeout(function() {
      apiSettingsData = null;
    }, 100);
  } catch (err) {
    console.error('Failed to save API base:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Update API base preview text showing full endpoint URL
 */
function updateApiBasePreview(apiBase) {
  var preview = document.getElementById('api-base-preview');
  if (!preview) return;

  var base = apiBase || getDefaultApiBase('openai');
  // Remove trailing slash if present
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  var endpointPath = activeModelTab === 'embedding' ? '/embeddings' : activeModelTab === 'reranker' ? '/rerank' : '/chat/completions';
  preview.textContent = t('apiSettings.preview') + ': ' + base + endpointPath;
}

/**
 * Delete provider with confirmation
 */
async function deleteProviderWithConfirm(providerId) {
  if (!confirm(t('apiSettings.confirmDeleteProvider'))) return;

  try {
    var response = await fetch('/api/litellm-api/providers/' + providerId, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Failed to delete provider');

    // Remove from local data
    apiSettingsData.providers = apiSettingsData.providers.filter(function(p) {
      return p.id !== providerId;
    });

    // Clear selection if deleted provider was selected
    if (selectedProviderId === providerId) {
      selectedProviderId = null;
      if (apiSettingsData.providers.length > 0) {
        selectProvider(apiSettingsData.providers[0].id);
      } else {
        renderProviderEmptyState();
      }
    }

    renderProviderList();
    showRefreshToast(t('apiSettings.providerDeleted'), 'success');
  } catch (err) {
    console.error('Failed to delete provider:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Sync config to CodexLens (generate YAML config for ccw_litellm)
 */
async function syncConfigToCodexLens() {
  try {
    var response = await fetch('/api/litellm-api/config/sync', {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to sync config');

    var result = await response.json();
    showRefreshToast(t('apiSettings.configSynced') + ' (' + result.yamlPath + ')', 'success');
  } catch (err) {
    console.error('Failed to sync config:', err);
    showRefreshToast(t('common.error') + ': ' + err.message, 'error');
  }
}

/**
 * Get provider icon class based on type
 */
function getProviderIconClass(type) {
  var iconMap = {
    'openai': 'provider-icon-openai',
    'anthropic': 'provider-icon-anthropic'
  };
  return iconMap[type] || 'provider-icon-custom';
}

/**
 * Get provider icon name based on type
 */
function getProviderIcon(type) {
  const iconMap = {
    'openai': 'sparkles',
    'anthropic': 'brain',
    'google': 'cloud',
    'azure': 'cloud-cog',
    'ollama': 'server',
    'mistral': 'wind',
    'deepseek': 'search'
  };
  return iconMap[type] || 'settings';
}

/**
 * Render providers list
 */
function renderProvidersList() {
  const container = document.getElementById('providers-list');
  if (!container) return;

  const providers = apiSettingsData.providers || [];

  if (providers.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<div class="empty-icon-wrapper">' +
      '<i data-lucide="cloud-off"></i>' +
      '</div>' +
      '<h4>' + t('apiSettings.noProviders') + '</h4>' +
      '<p>' + t('apiSettings.noProvidersHint') + '</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = providers.map(function(provider) {
    const statusClass = provider.enabled === false ? 'disabled' : 'enabled';
    const statusText = provider.enabled === false ? t('apiSettings.disabled') : t('apiSettings.enabled');
    const iconClass = getProviderIconClass(provider.type);
    const iconName = getProviderIcon(provider.type);

    return '<div class="api-card' + (provider.enabled === false ? ' disabled' : '') + '">' +
      '<div class="card-header">' +
      '<div class="card-title-group">' +
      '<div class="card-icon ' + iconClass + '">' +
      '<i data-lucide="' + iconName + '"></i>' +
      '</div>' +
      '<div class="card-info">' +
      '<h4 class="card-title">' + provider.name + '</h4>' +
      '<span class="card-subtitle"><span class="provider-type-badge">' + provider.type + '</span></span>' +
      '</div>' +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="btn-icon-sm" onclick="showEditProviderModal(\'' + provider.id + '\')" title="' + t('common.edit') + '">' +
      '<i data-lucide="pencil"></i>' +
      '</button>' +
      '<button class="btn-icon-sm text-destructive" onclick="deleteProvider(\'' + provider.id + '\')" title="' + t('common.delete') + '">' +
      '<i data-lucide="trash-2"></i>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="card-body">' +
      '<div class="card-meta-grid">' +
      '<div class="meta-item">' +
      '<span class="meta-label">' + t('apiSettings.apiKey') + '</span>' +
      '<span class="meta-value">' + maskApiKey(provider.apiKey) + '</span>' +
      '</div>' +
      '<div class="meta-item">' +
      '<span class="meta-label">' + t('common.status') + '</span>' +
      '<span class="status-badge status-' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
      (provider.apiBase ?
        '<div class="meta-item" style="grid-column: span 2;">' +
        '<span class="meta-label">' + t('apiSettings.apiBaseUrl') + '</span>' +
        '<span class="meta-value">' + provider.apiBase + '</span>' +
        '</div>' : '') +
      '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  if (window.lucide) lucide.createIcons();
}

/**
 * Render endpoints list
 */
function renderEndpointsList() {
  const container = document.getElementById('endpoints-list');
  if (!container) return;

  const endpoints = apiSettingsData.endpoints || [];

  if (endpoints.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<div class="empty-icon-wrapper">' +
      '<i data-lucide="layers"></i>' +
      '</div>' +
      '<h4>' + t('apiSettings.noEndpoints') + '</h4>' +
      '<p>' + t('apiSettings.noEndpointsHint') + '</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = endpoints.map(function(endpoint) {
    const provider = apiSettingsData.providers.find(function(p) { return p.id === endpoint.providerId; });
    const providerName = provider ? provider.name : endpoint.providerId;
    const providerType = provider ? provider.type : 'custom';
    const iconClass = getProviderIconClass(providerType);
    const iconName = getProviderIcon(providerType);

    const cacheEnabled = endpoint.cacheStrategy?.enabled;
    const cacheStatus = cacheEnabled
      ? endpoint.cacheStrategy.ttlMinutes + ' min'
      : t('apiSettings.off');

    return '<div class="api-card">' +
      '<div class="card-header">' +
      '<div class="card-title-group">' +
      '<div class="card-icon ' + iconClass + '">' +
      '<i data-lucide="' + iconName + '"></i>' +
      '</div>' +
      '<div class="card-info">' +
      '<h4 class="card-title">' + endpoint.name + '</h4>' +
      '<code class="endpoint-id">' + endpoint.id + '</code>' +
      '</div>' +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="btn-icon-sm" onclick="showEditEndpointModal(\'' + endpoint.id + '\')" title="' + t('common.edit') + '">' +
      '<i data-lucide="pencil"></i>' +
      '</button>' +
      '<button class="btn-icon-sm text-destructive" onclick="deleteEndpoint(\'' + endpoint.id + '\')" title="' + t('common.delete') + '">' +
      '<i data-lucide="trash-2"></i>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="card-body">' +
      '<div class="card-meta-grid">' +
      '<div class="meta-item">' +
      '<span class="meta-label">' + t('apiSettings.provider') + '</span>' +
      '<span class="meta-value">' + providerName + '</span>' +
      '</div>' +
      '<div class="meta-item">' +
      '<span class="meta-label">' + t('apiSettings.model') + '</span>' +
      '<span class="meta-value">' + endpoint.model + '</span>' +
      '</div>' +
      '<div class="meta-item">' +
      '<span class="meta-label">' + t('apiSettings.cache') + '</span>' +
      '<span class="badge ' + (cacheEnabled ? 'badge-success' : 'badge-outline') + '">' +
      (cacheEnabled ? '<i data-lucide="database" style="width:12px;height:12px;margin-right:4px;"></i>' : '') +
      cacheStatus + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="usage-hint">' +
      '<i data-lucide="terminal"></i>' +
      '<code>ccw cli -p "..." --model ' + endpoint.id + '</code>' +
      '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  if (window.lucide) lucide.createIcons();
}

/**
 * Render endpoints main panel
 */
function renderEndpointsMainPanel() {
  var container = document.getElementById('provider-detail-panel');
  if (!container) return;

  var endpoints = apiSettingsData.endpoints || [];
  
  var html = '<div class="endpoints-main-panel">' +
    '<div class="panel-header">' +
    '<h2>' + t('apiSettings.endpoints') + '</h2>' +
    '<p class="panel-subtitle">' + t('apiSettings.endpointsDescription') + '</p>' +
    '</div>' +
    '<div class="endpoints-stats">' +
    '<div class="stat-card">' +
    '<div class="stat-value">' + endpoints.length + '</div>' +
    '<div class="stat-label">' + t('apiSettings.totalEndpoints') + '</div>' +
    '</div>' +
    '<div class="stat-card">' +
    '<div class="stat-value">' + endpoints.filter(function(e) { return e.cacheStrategy?.enabled; }).length + '</div>' +
    '<div class="stat-label">' + t('apiSettings.cachedEndpoints') + '</div>' +
    '</div>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

/**
 * Render cache main panel
 */
async function renderCacheMainPanel() {
  var container = document.getElementById('provider-detail-panel');
  if (!container) return;

  // Load cache stats
  var stats = await loadCacheStats();
  if (!stats) {
    stats = { totalSize: 0, maxSize: 104857600, entries: 0 };
  }

  var globalSettings = apiSettingsData.globalCache || { enabled: false };
  var totalSize = stats.totalSize || 0;
  var maxSize = stats.maxSize || 104857600; // Default 100MB
  var usedMB = (totalSize / 1024 / 1024).toFixed(2);
  var maxMB = (maxSize / 1024 / 1024).toFixed(0);
  var usagePercent = maxSize > 0 ? ((totalSize / maxSize) * 100).toFixed(1) : 0;

  var html = '<div class="cache-main-panel">' +
    '<div class="panel-header">' +
    '<h2>' + t('apiSettings.cacheSettings') + '</h2>' +
    '<p class="panel-subtitle">' + t('apiSettings.cacheDescription') + '</p>' +
    '</div>' +
    // Global Cache Settings
    '<div class="settings-section">' +
    '<div class="section-header">' +
    '<h3>' + t('apiSettings.globalCache') + '</h3>' +
    '<label class="toggle-switch">' +
    '<input type="checkbox" id="global-cache-enabled" ' + (globalSettings.enabled ? 'checked' : '') + ' onchange="updateGlobalCacheEnabled(this.checked)" />' +
    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
    '</label>' +
    '</div>' +
    '</div>' +
    // Cache Statistics
    '<div class="settings-section">' +
    '<h3>' + t('apiSettings.cacheStatistics') + '</h3>' +
    '<div class="cache-stats-grid">' +
    '<div class="stat-card">' +
    '<div class="stat-icon"><i data-lucide="database"></i></div>' +
    '<div class="stat-info">' +
    '<div class="stat-value">' + (stats.entries || 0) + '</div>' +
    '<div class="stat-label">' + t('apiSettings.cachedEntries') + '</div>' +
    '</div>' +
    '</div>' +
    '<div class="stat-card">' +
    '<div class="stat-icon"><i data-lucide="hard-drive"></i></div>' +
    '<div class="stat-info">' +
    '<div class="stat-value">' + usedMB + ' MB</div>' +
    '<div class="stat-label">' + t('apiSettings.storageUsed') + '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="storage-bar-container">' +
    '<div class="storage-bar">' +
    '<div class="storage-bar-fill" style="width: ' + usagePercent + '%"></div>' +
    '</div>' +
    '<div class="storage-label">' + usedMB + ' MB / ' + maxMB + ' MB (' + usagePercent + '%)</div>' +
    '</div>' +
    '</div>' +
    // Cache Actions
    '<div class="settings-section">' +
    '<h3>' + t('apiSettings.cacheActions') + '</h3>' +
    '<button class="btn btn-destructive" onclick="clearCache()">' +
    '<i data-lucide="trash-2"></i> ' + t('apiSettings.clearCache') +
    '</button>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

/**
 * Render cache settings panel
 */
function renderCacheSettings(stats) {
  const container = document.getElementById('cache-settings-panel');
  if (!container) return;

  const globalSettings = apiSettingsData.globalCache || { enabled: false };
  const totalSize = stats.totalSize || 0;
  const maxSize = stats.maxSize || 104857600; // Default 100MB
  const usedMB = (totalSize / 1024 / 1024).toFixed(2);
  const maxMB = (maxSize / 1024 / 1024).toFixed(0);
  const usagePercent = maxSize > 0 ? ((totalSize / maxSize) * 100).toFixed(1) : 0;

  container.innerHTML = '<div class="cache-panel">' +
    // Cache Header
    '<div class="cache-header">' +
    '<div class="section-title-group">' +
    '<h3>' + t('apiSettings.cacheSettings') + '</h3>' +
    '</div>' +
    '<label class="toggle-switch">' +
    '<input type="checkbox" id="global-cache-enabled" ' + (globalSettings.enabled ? 'checked' : '') + ' onchange="toggleGlobalCache()" />' +
    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
    '<span class="toggle-label">' + t('apiSettings.enableGlobalCaching') + '</span>' +
    '</label>' +
    '</div>' +
    // Cache Content
    '<div class="cache-content">' +
    // Visual Bar
    '<div class="cache-visual">' +
    '<div class="cache-bars">' +
    '<div class="cache-bar-fill" style="width: ' + usagePercent + '%"></div>' +
    '</div>' +
    '<div class="cache-legend">' +
    '<span>' + usedMB + ' MB ' + t('apiSettings.used') + '</span>' +
    '<span>' + maxMB + ' MB ' + t('apiSettings.total') + '</span>' +
    '</div>' +
    '</div>' +
    // Stats Grid
    '<div class="stat-grid">' +
    '<div class="stat-card">' +
    '<span class="stat-value">' + usagePercent + '%</span>' +
    '<span class="stat-desc">' + t('apiSettings.cacheUsage') + '</span>' +
    '</div>' +
    '<div class="stat-card">' +
    '<span class="stat-value">' + (stats.entries || 0) + '</span>' +
    '<span class="stat-desc">' + t('apiSettings.cacheEntries') + '</span>' +
    '</div>' +
    '<div class="stat-card">' +
    '<span class="stat-value">' + usedMB + ' MB</span>' +
    '<span class="stat-desc">' + t('apiSettings.cacheSize') + '</span>' +
    '</div>' +
    '</div>' +
    // Clear Button
    '<button class="btn btn-secondary" onclick="clearCache()" style="align-self: flex-start;">' +
    '<i data-lucide="trash-2"></i> ' + t('apiSettings.clearCache') +
    '</button>' +
    '</div>' +
    '</div>';

  if (window.lucide) lucide.createIcons();
}

// ========== Multi-Key Management ==========

/**
 * Generate unique ID for API keys
 */
function generateKeyId() {
  return 'key-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// ========== Embedding Pool Management ==========

/**
 * Render embedding pool sidebar summary
 */
function renderEmbeddingPoolSidebar() {
  if (!embeddingPoolConfig) {
    return '<div class="embedding-pool-sidebar-info" style="padding: 1rem;">' +
      '<div style="text-align: center; color: hsl(var(--muted-foreground)); font-size: 0.875rem;">' +
      '<p>' + t('apiSettings.embeddingPoolDesc') + '</p>' +
      '</div>' +
      '</div>';
  }

  const enabled = embeddingPoolConfig.enabled || false;
  const targetModel = embeddingPoolConfig.targetModel || '';
  const strategy = embeddingPoolConfig.strategy || 'round_robin';
  const excludedIds = embeddingPoolConfig.excludedProviderIds || [];

  // Count total providers/keys
  let totalProviders = embeddingPoolDiscoveredProviders.length;
  let totalKeys = 0;
  let activeProviders = 0;

  embeddingPoolDiscoveredProviders.forEach(function(p) {
    totalKeys += p.apiKeys?.length || 1;
    if (excludedIds.indexOf(p.providerId) === -1) {
      activeProviders++;
    }
  });

  const strategyLabels = {
    'round_robin': t('codexlens.strategyRoundRobin') || 'Round Robin',
    'latency_aware': t('codexlens.strategyLatency') || 'Latency-Aware',
    'weighted_random': t('codexlens.strategyWeighted') || 'Weighted Random'
  };

  return '<div class="embedding-pool-sidebar-summary" style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem;">' +
    '<div style="padding: 1rem; background: hsl(var(--muted) / 0.3); border-radius: 0.5rem;">' +
      '<h4 style="margin: 0 0 0.75rem 0; font-size: 0.875rem; font-weight: 600; color: hsl(var(--foreground));">' +
        t('apiSettings.embeddingPool') +
      '</h4>' +
      '<div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.75rem; color: hsl(var(--muted-foreground));">' +
        '<div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0; border-bottom: 1px solid hsl(var(--border));">' +
          '<i data-lucide="' + (enabled ? 'check-circle' : 'x-circle') + '" style="width: 14px; height: 14px; color: ' + (enabled ? 'hsl(var(--success))' : 'hsl(var(--muted-foreground))') + ';"></i>' +
          '<span>' + (enabled ? (t('common.enabled') || 'Enabled') : (t('common.disabled') || 'Disabled')) + '</span>' +
        '</div>' +
        (enabled && targetModel ?
          '<div style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.375rem 0; border-bottom: 1px solid hsl(var(--border));">' +
            '<span style="font-weight: 500; color: hsl(var(--foreground));">' + t('apiSettings.targetModel') + '</span>' +
            '<code style="font-size: 0.6875rem; color: hsl(var(--primary)); word-break: break-all;">' + targetModel + '</code>' +
          '</div>' : '') +
        (enabled ?
          '<div style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.375rem 0; border-bottom: 1px solid hsl(var(--border));">' +
            '<span style="font-weight: 500; color: hsl(var(--foreground));">' + t('apiSettings.strategy') + '</span>' +
            '<span>' + (strategyLabels[strategy] || strategy) + '</span>' +
          '</div>' : '') +
        (enabled && totalProviders > 0 ?
          '<div style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.375rem 0;">' +
            '<span style="font-weight: 500; color: hsl(var(--foreground));">' + t('apiSettings.discoveredProviders') + '</span>' +
            '<span>' + activeProviders + ' / ' + totalProviders + ' providers (' + totalKeys + ' keys)</span>' +
          '</div>' : '') +
      '</div>' +
    '</div>' +
    '</div>';
}


/**
 * Render embedding pool main panel
 */
async function renderEmbeddingPoolMainPanel() {
  var container = document.getElementById('provider-detail-panel');
  if (!container) return;

  // Load embedding pool config if not already loaded
  if (!embeddingPoolConfig) {
    await loadEmbeddingPoolConfig();
  }

  const enabled = embeddingPoolConfig?.enabled || false;
  const targetModel = embeddingPoolConfig?.targetModel || '';
  const strategy = embeddingPoolConfig?.strategy || 'round_robin';
  const defaultCooldown = embeddingPoolConfig?.defaultCooldown || 60;
  const defaultMaxConcurrentPerKey = embeddingPoolConfig?.defaultMaxConcurrentPerKey || 4;

  // Build model dropdown options
  let modelOptionsHtml = '<option value="">' + t('apiSettings.selectTargetModel') + '</option>';
  embeddingPoolAvailableModels.forEach(function(model) {
    const providerCount = model.providers.length;
    const selected = model.modelId === targetModel ? ' selected' : '';
    modelOptionsHtml += '<option value="' + model.modelId + '"' + selected + '>' +
      model.modelName + ' (' + providerCount + ' providers)' +
      '</option>';
  });

  var html = '<div class="embedding-pool-main-panel">' +
    '<div class="panel-header">' +
    '<h2><i data-lucide="repeat"></i> ' + t('apiSettings.embeddingPool') + '</h2>' +
    '<p class="panel-subtitle">' + t('apiSettings.embeddingPoolDesc') + '</p>' +
    '</div>' +

    // Enable/Disable Toggle Card
    '<div class="settings-section" style="padding: 1.25rem; background: hsl(var(--muted) / 0.3); border-radius: 0.75rem;">' +
    '<div class="section-header" style="border: none; padding: 0;">' +
    '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
      '<i data-lucide="power" style="width: 1rem; height: 1rem; color: hsl(var(--primary));"></i>' +
      '<h3 style="margin: 0;">' + t('apiSettings.poolEnabled') + '</h3>' +
    '</div>' +
    '<label class="toggle-switch">' +
    '<input type="checkbox" id="embedding-pool-enabled" ' + (enabled ? 'checked' : '') + ' onchange="onEmbeddingPoolEnabledChange(this.checked)" />' +
    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
    '</label>' +
    '</div>' +
    '</div>' +

    // Configuration Form Card
    '<div class="settings-section" id="embedding-pool-config" style="' + (enabled ? '' : 'display: none;') + '">' +

    // Model and Strategy in Grid
    '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">' +
      '<div class="form-group" style="margin: 0;">' +
      '<label for="embedding-pool-target-model">' + t('apiSettings.targetModel') + '</label>' +
      '<select id="embedding-pool-target-model" class="cli-input" onchange="onTargetModelChange(this.value)">' +
      modelOptionsHtml +
      '</select>' +
      '</div>' +
      '<div class="form-group" style="margin: 0;">' +
      '<label for="embedding-pool-strategy">' + t('apiSettings.strategy') + '</label>' +
      '<select id="embedding-pool-strategy" class="cli-input">' +
      '<option value="round_robin"' + (strategy === 'round_robin' ? ' selected' : '') + '>Round Robin</option>' +
      '<option value="latency_aware"' + (strategy === 'latency_aware' ? ' selected' : '') + '>Latency Aware</option>' +
      '<option value="weighted_random"' + (strategy === 'weighted_random' ? ' selected' : '') + '>Weighted Random</option>' +
      '</select>' +
      '</div>' +
    '</div>' +

    // Cooldown and Concurrent in Grid
    '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">' +
      '<div class="form-group" style="margin: 0;">' +
      '<label for="embedding-pool-cooldown">' + t('apiSettings.defaultCooldown') + ' (s)</label>' +
      '<input type="number" id="embedding-pool-cooldown" class="cli-input" value="' + defaultCooldown + '" min="1" />' +
      '</div>' +
      '<div class="form-group" style="margin: 0;">' +
      '<label for="embedding-pool-concurrent">' + t('apiSettings.defaultConcurrent') + '</label>' +
      '<input type="number" id="embedding-pool-concurrent" class="cli-input" value="' + defaultMaxConcurrentPerKey + '" min="1" />' +
      '</div>' +
    '</div>' +

    // Discovered Providers Section
    '<div id="discovered-providers-section" style="margin-top: 1.5rem;"></div>' +

    '<div class="form-actions">' +
    '<button class="btn btn-primary" onclick="saveEmbeddingPoolConfig()">' +
    '<i data-lucide="save"></i> ' + t('common.save') +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();

  // Render discovered providers if we have a target model
  if (enabled && targetModel) {
    renderDiscoveredProviders();
  }
}

/**
 * Handle embedding pool enabled/disabled toggle
 */
function onEmbeddingPoolEnabledChange(enabled) {
  const configSection = document.getElementById('embedding-pool-config');
  if (configSection) {
    configSection.style.display = enabled ? '' : 'none';
  }
}

/**
 * Handle target model selection change
 */
async function onTargetModelChange(modelId) {
  if (!modelId) {
    embeddingPoolDiscoveredProviders = [];
    renderDiscoveredProviders();
    return;
  }

  // Discover providers for this model
  await discoverProvidersForTargetModel(modelId);
  renderDiscoveredProviders();
  
  // Update sidebar summary
  const sidebarContainer = document.querySelector('.api-settings-sidebar');
  if (sidebarContainer) {
    const contentArea = sidebarContainer.querySelector('.provider-list, .endpoints-list, .embedding-pool-sidebar-info, .embedding-pool-sidebar-summary, .cache-sidebar-info');
    if (contentArea && contentArea.parentElement) {
      contentArea.parentElement.innerHTML = renderEmbeddingPoolSidebar();
      if (window.lucide) lucide.createIcons();
    }
  }
}

/**
 * Render discovered providers list
 */
function renderDiscoveredProviders() {
  const container = document.getElementById('discovered-providers-section');
  if (!container) return;

  if (embeddingPoolDiscoveredProviders.length === 0) {
    container.innerHTML = '<div class="info-message">' +
      '<i data-lucide="info"></i> ' + t('apiSettings.noProvidersFound') +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const excludedIds = embeddingPoolConfig?.excludedProviderIds || [];
  let totalProviders = 0;
  let totalKeys = 0;

  embeddingPoolDiscoveredProviders.forEach(function(p) {
    totalProviders++;
    totalKeys += p.apiKeys?.length || 1;
  });

  let providersHtml = '<div>' +
    '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">' +
    '<h4 style="margin: 0; font-size: 0.9375rem; font-weight: 600;">' + t('apiSettings.discoveredProviders') + '</h4>' +
    '<span style="font-size: 0.75rem; color: hsl(var(--muted-foreground)); padding: 0.25rem 0.625rem; background: hsl(var(--muted) / 0.5); border-radius: 9999px;">' + 
      totalProviders + ' providers, ' + totalKeys + ' keys' +
    '</span>' +
    '</div>' +
    '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';

  embeddingPoolDiscoveredProviders.forEach(function(provider, index) {
    const isExcluded = excludedIds.indexOf(provider.providerId) > -1;
    const keyCount = provider.apiKeys?.length || 1;
    
    // Get provider icon
    let providerIcon = 'server';
    if (provider.providerName.toLowerCase().includes('openai')) providerIcon = 'brain';
    else if (provider.providerName.toLowerCase().includes('modelscope')) providerIcon = 'cpu';
    else if (provider.providerName.toLowerCase().includes('azure')) providerIcon = 'cloud';
    
    providersHtml += '<div style="border: 1px solid hsl(var(--border)); border-radius: 0.5rem; padding: 1rem; ' + 
      (isExcluded ? 'opacity: 0.5; background: hsl(var(--muted) / 0.3);' : 'background: hsl(var(--card));') + '">' +
      '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">' +
        '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
          '<div style="width: 2rem; height: 2rem; border-radius: 0.375rem; background: ' + (isExcluded ? 'hsl(var(--muted))' : 'hsl(var(--success) / 0.1)') + '; color: ' + (isExcluded ? 'hsl(var(--muted-foreground))' : 'hsl(var(--success))') + '; display: flex; align-items: center; justify-content: center;">' +
            '<i data-lucide="' + providerIcon + '" style="width: 1.125rem; height: 1.125rem;"></i>' +
          '</div>' +
          '<div>' +
            '<div style="font-weight: 500; font-size: 0.875rem; color: hsl(var(--foreground));">' + escapeHtml(provider.providerName) + '</div>' +
            '<div style="font-size: 0.75rem; color: hsl(var(--muted-foreground));">' + provider.modelName + ' · ' + keyCount + ' key' + (keyCount > 1 ? 's' : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-sm ' + (isExcluded ? 'btn-primary' : 'btn-outline') + '" onclick="toggleProviderExclusion(\'' + provider.providerId + '\')" style="flex-shrink: 0;">' +
        '<i data-lucide="' + (isExcluded ? 'plus' : 'x') + '" style="width: 0.875rem; height: 0.875rem;"></i> ' +
        (isExcluded ? t('common.include') : t('apiSettings.excludeProvider')) +
        '</button>' +
      '</div>' +
    '</div>';
  });

  providersHtml += '</div>';
  container.innerHTML = providersHtml;
  if (window.lucide) lucide.createIcons();
}

/**
 * Render API keys section
 */
function renderApiKeysSection(provider) {
  const keys = provider.apiKeys || [];
  const hasMultipleKeys = keys.length > 0;

  let keysHtml = '';
  if (hasMultipleKeys) {
    keysHtml = keys.map(function(key, index) {
      return '<div class="api-key-item" data-key-id="' + key.id + '">' +
        '<input type="text" class="cli-input key-label" ' +
        'value="' + (key.label || '') + '" ' +
        'placeholder="' + t('apiSettings.keyLabel') + '" ' +
        'onchange="updateApiKeyField(\'' + provider.id + '\', \'' + key.id + '\', \'label\', this.value)">' +
        '<div class="key-value-wrapper" style="display: flex; gap: 0.5rem;">' +
        '<input type="password" class="cli-input key-value" ' +
        'value="' + key.key + '" ' +
        'placeholder="' + t('apiSettings.keyValue') + '" ' +
        'onchange="updateApiKeyField(\'' + provider.id + '\', \'' + key.id + '\', \'key\', this.value)">' +
        '<button type="button" class="btn-icon" onclick="toggleKeyVisibility(this)">👁️</button>' +
        '</div>' +
        '<input type="number" class="cli-input key-weight" ' +
        'value="' + (key.weight || 1) + '" min="1" max="100" ' +
        'placeholder="' + t('apiSettings.keyWeight') + '" ' +
        'onchange="updateApiKeyField(\'' + provider.id + '\', \'' + key.id + '\', \'weight\', parseInt(this.value))">' +
        '<div class="key-status">' +
        '<span class="key-status-indicator ' + (key.healthStatus || 'unknown') + '"></span>' +
        '<span class="key-status-text">' + t('apiSettings.' + (key.healthStatus || 'unknown')) + '</span>' +
        '</div>' +
        '<div class="api-key-actions">' +
        '<button type="button" class="test-key-btn" onclick="testApiKey(\'' + provider.id + '\', \'' + key.id + '\')">' +
        t('apiSettings.testKey') +
        '</button>' +
        '<button type="button" class="btn-danger btn-sm" onclick="removeApiKey(\'' + provider.id + '\', \'' + key.id + '\')">' +
        t('apiSettings.removeKey') +
        '</button>' +
        '</div>' +
        '</div>';
    }).join('');
  } else {
    keysHtml = '<div class="no-keys-message">' + t('apiSettings.noKeys') + '</div>';
  }

  return '<div class="api-keys-section">' +
    '<div class="api-keys-header">' +
    '<h4>' + t('apiSettings.apiKeys') + '</h4>' +
    '<button type="button" class="add-key-btn btn-secondary" onclick="addApiKey(\'' + provider.id + '\')">' +
    '+ ' + t('apiSettings.addKey') +
    '</button>' +
    '</div>' +
    '<div class="api-key-list" id="api-key-list-' + provider.id + '">' +
    keysHtml +
    '</div>' +
    '</div>';
}

/**
 * Render routing strategy section
 */
function renderRoutingSection(provider) {
  const strategy = provider.routingStrategy || 'simple-shuffle';

  return '<div class="routing-section">' +
    '<label>' + t('apiSettings.routingStrategy') + '</label>' +
    '<select class="cli-input" onchange="updateProviderRouting(\'' + provider.id + '\', this.value)">' +
    '<option value="simple-shuffle"' + (strategy === 'simple-shuffle' ? ' selected' : '') + '>' + t('apiSettings.simpleShuffleRouting') + '</option>' +
    '<option value="weighted"' + (strategy === 'weighted' ? ' selected' : '') + '>' + t('apiSettings.weightedRouting') + '</option>' +
    '<option value="latency-based"' + (strategy === 'latency-based' ? ' selected' : '') + '>' + t('apiSettings.latencyRouting') + '</option>' +
    '<option value="cost-based"' + (strategy === 'cost-based' ? ' selected' : '') + '>' + t('apiSettings.costRouting') + '</option>' +
    '<option value="least-busy"' + (strategy === 'least-busy' ? ' selected' : '') + '>' + t('apiSettings.leastBusyRouting') + '</option>' +
    '</select>' +
    '<div class="routing-hint">' + t('apiSettings.routingHint') + '</div>' +
    '</div>';
}

/**
 * Render health check section
 */
function renderHealthCheckSection(provider) {
  const health = provider.healthCheck || { enabled: false, intervalSeconds: 300, cooldownSeconds: 5, failureThreshold: 3 };

  return '<div class="health-check-section">' +
    '<div class="health-check-header">' +
    '<h5>' + t('apiSettings.healthCheck') + '</h5>' +
    '<label class="toggle-switch">' +
    '<input type="checkbox"' + (health.enabled ? ' checked' : '') + ' ' +
    'onchange="updateHealthCheckEnabled(\'' + provider.id + '\', this.checked)">' +
    '<span class="toggle-slider"></span>' +
    '</label>' +
    '</div>' +
    '<div class="health-check-grid" style="' + (health.enabled ? '' : 'opacity: 0.5; pointer-events: none;') + '">' +
    '<div class="health-check-field">' +
    '<label>' + t('apiSettings.healthInterval') + '</label>' +
    '<input type="number" class="cli-input" value="' + health.intervalSeconds + '" min="60" max="3600" ' +
    'onchange="updateHealthCheckField(\'' + provider.id + '\', \'intervalSeconds\', parseInt(this.value))">' +
    '</div>' +
    '<div class="health-check-field">' +
    '<label>' + t('apiSettings.healthCooldown') + '</label>' +
    '<input type="number" class="cli-input" value="' + health.cooldownSeconds + '" min="1" max="60" ' +
    'onchange="updateHealthCheckField(\'' + provider.id + '\', \'cooldownSeconds\', parseInt(this.value))">' +
    '</div>' +
    '<div class="health-check-field">' +
    '<label>' + t('apiSettings.failureThreshold') + '</label>' +
    '<input type="number" class="cli-input" value="' + health.failureThreshold + '" min="1" max="10" ' +
    'onchange="updateHealthCheckField(\'' + provider.id + '\', \'failureThreshold\', parseInt(this.value))">' +
    '</div>' +
    '</div>' +
    '</div>';
}

/**
 * Show multi-key settings modal
 */
function showMultiKeyModal(providerId) {
  const provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (!provider) return;

  const modalHtml = '<div class="modal-overlay" id="multi-key-modal">' +
    '<div class="modal-content" style="max-width: 700px; max-height: 85vh; overflow-y: auto;">' +
    '<div class="modal-header">' +
    '<h3>' + t('apiSettings.multiKeySettings') + '</h3>' +
    '<button class="modal-close" onclick="closeMultiKeyModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
    renderApiKeysSection(provider) +
    renderRoutingSection(provider) +
    renderHealthCheckSection(provider) +
    '</div>' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn-primary" onclick="closeMultiKeyModal()"><i data-lucide="check"></i> ' + t('common.close') + '</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  if (window.lucide) lucide.createIcons();
}

/**
 * Close multi-key settings modal
 */
function closeMultiKeyModal() {
  const modal = document.getElementById('multi-key-modal');
  if (modal) modal.remove();
}

/**
 * Refresh multi-key modal content
 */
function refreshMultiKeyModal(providerId) {
  const modal = document.getElementById('multi-key-modal');
  if (!modal) return;
  
  const provider = apiSettingsData.providers.find(function(p) { return p.id === providerId; });
  if (!provider) return;
  
  const modalBody = modal.querySelector('.modal-body');
  if (modalBody) {
    modalBody.innerHTML = 
      renderApiKeysSection(provider) +
      renderRoutingSection(provider) +
      renderHealthCheckSection(provider);
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Add API key to provider
 */
function addApiKey(providerId) {
  const newKey = {
    id: generateKeyId(),
    key: '',
    label: '',
    weight: 1,
    enabled: true,
    healthStatus: 'unknown'
  };

  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const apiKeys = provider.apiKeys || [];
      apiKeys.push(newKey);
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: apiKeys })
      });
    })
    .then(function() {
      loadApiSettings().then(function() {
        refreshMultiKeyModal(providerId);
      });
    })
    .catch(function(err) {
      console.error('Failed to add API key:', err);
    });
}

/**
 * Remove API key from provider
 */
function removeApiKey(providerId, keyId) {
  if (!confirm(t('common.confirmDelete'))) return;

  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const apiKeys = (provider.apiKeys || []).filter(function(k) { return k.id !== keyId; });
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: apiKeys })
      });
    })
    .then(function() {
      loadApiSettings().then(function() {
        refreshMultiKeyModal(providerId);
      });
    })
    .catch(function(err) {
      console.error('Failed to remove API key:', err);
    });
}

/**
 * Update API key field
 */
function updateApiKeyField(providerId, keyId, field, value) {
  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const apiKeys = provider.apiKeys || [];
      const keyIndex = apiKeys.findIndex(function(k) { return k.id === keyId; });
      if (keyIndex >= 0) {
        apiKeys[keyIndex][field] = value;
      }
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: apiKeys })
      });
    })
    .catch(function(err) {
      console.error('Failed to update API key:', err);
    });
}

/**
 * Update provider routing strategy
 */
function updateProviderRouting(providerId, strategy) {
  fetch('/api/litellm-api/providers/' + providerId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routingStrategy: strategy })
  }).catch(function(err) {
    console.error('Failed to update routing:', err);
  });
}

/**
 * Update health check enabled status
 */
function updateHealthCheckEnabled(providerId, enabled) {
  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const healthCheck = provider.healthCheck || { intervalSeconds: 300, cooldownSeconds: 5, failureThreshold: 3 };
      healthCheck.enabled = enabled;
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheck: healthCheck })
      });
    })
    .then(function() {
      loadApiSettings().then(function() {
        refreshMultiKeyModal(providerId);
      });
    })
    .catch(function(err) {
      console.error('Failed to update health check:', err);
    });
}

/**
 * Update health check field
 */
function updateHealthCheckField(providerId, field, value) {
  fetch('/api/litellm-api/providers/' + providerId)
    .then(function(res) { return res.json(); })
    .then(function(provider) {
      const healthCheck = provider.healthCheck || { enabled: false, intervalSeconds: 300, cooldownSeconds: 5, failureThreshold: 3 };
      healthCheck[field] = value;
      return fetch('/api/litellm-api/providers/' + providerId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthCheck: healthCheck })
      });
    })
    .catch(function(err) {
      console.error('Failed to update health check:', err);
    });
}

/**
 * Test API key
 */
function testApiKey(providerId, keyId) {
  const btn = event.target;
  btn.disabled = true;
  btn.classList.add('testing');
  btn.textContent = t('apiSettings.testingKey');

  fetch('/api/litellm-api/providers/' + providerId + '/test-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: keyId })
  })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      btn.disabled = false;
      btn.classList.remove('testing');
      btn.textContent = t('apiSettings.testKey');

      const keyItem = btn.closest('.api-key-item');
      const statusIndicator = keyItem.querySelector('.key-status-indicator');
      const statusText = keyItem.querySelector('.key-status-text');

      if (result.valid) {
        statusIndicator.className = 'key-status-indicator healthy';
        statusText.textContent = t('apiSettings.healthy');
        showToast(t('apiSettings.keyValid'), 'success');
      } else {
        statusIndicator.className = 'key-status-indicator unhealthy';
        statusText.textContent = t('apiSettings.unhealthy');
        showToast(t('apiSettings.keyInvalid') + ': ' + (result.error || ''), 'error');
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.classList.remove('testing');
      btn.textContent = t('apiSettings.testKey');
      showToast('Test failed: ' + err.message, 'error');
    });
}

/**
 * Toggle key visibility
 */
function toggleKeyVisibility(btn) {
  const input = btn.previousElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}


// ========== CCW-LiteLLM Management ==========

/**
 * Check ccw-litellm installation status
 * @param {boolean} forceRefresh - Force refresh from server, bypass cache
 */
async function checkCcwLitellmStatus(forceRefresh = false) {
  // Check if cache is valid and not forcing refresh
  if (!forceRefresh && ccwLitellmStatusCache &&
      (Date.now() - ccwLitellmStatusCacheTime < CCW_LITELLM_STATUS_CACHE_TTL)) {
    console.log('[API Settings] Using cached ccw-litellm status');
    window.ccwLitellmStatus = ccwLitellmStatusCache;
    return ccwLitellmStatusCache;
  }

  try {
    console.log('[API Settings] Checking ccw-litellm status from server...');
    // Add refresh=true to bypass backend cache when forceRefresh is true
    var statusUrl = '/api/litellm-api/ccw-litellm/status' + (forceRefresh ? '?refresh=true' : '');
    var response = await fetch(statusUrl);
    console.log('[API Settings] Status response:', response.status);
    var status = await response.json();
    console.log('[API Settings] ccw-litellm status:', status);

    // Update cache
    ccwLitellmStatusCache = status;
    ccwLitellmStatusCacheTime = Date.now();
    window.ccwLitellmStatus = status;

    return status;
  } catch (e) {
    console.warn('[API Settings] Could not check ccw-litellm status:', e);
    var fallbackStatus = { installed: false };

    // Cache the fallback result too
    ccwLitellmStatusCache = fallbackStatus;
    ccwLitellmStatusCacheTime = Date.now();

    return fallbackStatus;
  }
}

/**
 * Render ccw-litellm status card
 */
function renderCcwLitellmStatusCard() {
  var container = document.getElementById('ccwLitellmStatusContainer');
  if (!container) return;

  var status = window.ccwLitellmStatus || { installed: false };

  if (status.installed) {
    container.innerHTML =
      '<div class="flex items-center gap-2 text-sm">' +
        '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20">' +
          '<i data-lucide="check-circle" class="w-3.5 h-3.5"></i>' +
          'ccw-litellm ' + (status.version || '') +
        '</span>' +
        '<button class="btn-sm btn-outline-danger" onclick="uninstallCcwLitellm()" title="Uninstall ccw-litellm">' +
          '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>' +
        '</button>' +
      '</div>';
  } else {
    container.innerHTML =
      '<div class="flex items-center gap-2">' +
        '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border text-sm">' +
          '<i data-lucide="circle" class="w-3.5 h-3.5"></i>' +
          'ccw-litellm not installed' +
        '</span>' +
        '<button class="btn-sm btn-primary" onclick="installCcwLitellm()">' +
          '<i data-lucide="download" class="w-3.5 h-3.5"></i> Install' +
        '</button>' +
      '</div>';
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Install ccw-litellm package
 */
async function installCcwLitellm() {
  var container = document.getElementById('ccwLitellmStatusContainer');
  if (container) {
    container.innerHTML =
      '<div class="flex items-center gap-2 text-sm text-muted-foreground">' +
        '<div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>' +
        'Installing ccw-litellm...' +
      '</div>';
  }

  try {
    var response = await fetch('/api/litellm-api/ccw-litellm/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast('ccw-litellm installed successfully!', 'success');
      // Refresh status (force refresh after installation)
      await checkCcwLitellmStatus(true);
      renderCcwLitellmStatusCard();
    } else {
      showRefreshToast('Failed to install ccw-litellm: ' + result.error, 'error');
      renderCcwLitellmStatusCard();
    }
  } catch (e) {
    showRefreshToast('Installation error: ' + e.message, 'error');
    renderCcwLitellmStatusCard();
  }
}

/**
 * Uninstall ccw-litellm package
 */
async function uninstallCcwLitellm() {
  if (!confirm('Are you sure you want to uninstall ccw-litellm? This will disable LiteLLM features.')) {
    return;
  }

  var container = document.getElementById('ccwLitellmStatusContainer');
  if (container) {
    container.innerHTML =
      '<div class="flex items-center gap-2 text-sm text-muted-foreground">' +
        '<div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>' +
        'Uninstalling ccw-litellm...' +
      '</div>';
  }

  try {
    var response = await fetch('/api/litellm-api/ccw-litellm/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    var result = await response.json();

    if (result.success) {
      showRefreshToast('ccw-litellm uninstalled successfully!', 'success');
      await checkCcwLitellmStatus(true);
      renderCcwLitellmStatusCard();
    } else {
      showRefreshToast('Failed to uninstall ccw-litellm: ' + result.error, 'error');
      renderCcwLitellmStatusCard();
    }
  } catch (e) {
    showRefreshToast('Uninstall error: ' + e.message, 'error');
    renderCcwLitellmStatusCard();
  }
}

// Make functions globally accessible
window.checkCcwLitellmStatus = checkCcwLitellmStatus;
window.renderCcwLitellmStatusCard = renderCcwLitellmStatusCard;
window.installCcwLitellm = installCcwLitellm;
window.uninstallCcwLitellm = uninstallCcwLitellm;


// ========== Utility Functions ==========

/**
 * Mask API key for display
 */
function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.startsWith('${')) return apiKey; // Environment variable
  if (apiKey.length <= 8) return '***';
  return apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
}