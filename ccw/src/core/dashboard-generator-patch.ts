// Add after line 13 (after REVIEW_TEMPLATE constant)

// Modular dashboard JS files (in dependency order)
const MODULE_FILES = [
  // i18n (must be first for translations)
  'dashboard-js/i18n.js',
  // Base (no dependencies)
  'dashboard-js/state.js',
  'dashboard-js/utils.js',
  'dashboard-js/api.js',
  // Components (independent)
  'dashboard-js/components/theme.js',
  'dashboard-js/components/sidebar.js',
  'dashboard-js/components/modals.js',
  'dashboard-js/components/flowchart.js',
  // Components (dependent)
  'dashboard-js/components/task-drawer-renderers.js',
  'dashboard-js/components/task-drawer-core.js',
  'dashboard-js/components/tabs-context.js',
  'dashboard-js/components/tabs-other.js',
  'dashboard-js/components/carousel.js',
  'dashboard-js/components/notifications.js',
  'dashboard-js/components/cli-stream-viewer.js',
  'dashboard-js/components/global-notifications.js',
  'dashboard-js/components/cli-status.js',
  'dashboard-js/components/cli-history.js',
  'dashboard-js/components/mcp-manager.js',
  'dashboard-js/components/hook-manager.js',
  'dashboard-js/components/version-check.js',
  'dashboard-js/components/task-queue-sidebar.js',
  // Views
  'dashboard-js/views/home.js',
  'dashboard-js/views/project-overview.js',
  'dashboard-js/views/review-session.js',
  'dashboard-js/views/fix-session.js',
  'dashboard-js/views/lite-tasks.js',
  'dashboard-js/views/session-detail.js',
  'dashboard-js/views/cli-manager.js',
  'dashboard-js/views/explorer.js',
  'dashboard-js/views/mcp-manager.js',
  'dashboard-js/views/hook-manager.js',
  'dashboard-js/views/history.js',
  'dashboard-js/views/graph-explorer.js',
  // Navigation & Main
  'dashboard-js/components/navigation.js',
  'dashboard-js/main.js'
];
