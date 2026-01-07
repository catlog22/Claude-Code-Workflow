import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface ReviewDimensionInfo {
  count: number;
  [key: string]: unknown;
}

interface ReviewData {
  totalFindings: number;
  severityDistribution: Record<string, number>;
  dimensionSummary: Record<string, ReviewDimensionInfo>;
  [key: string]: unknown;
}

interface SessionTaskData {
  status?: string;
  title?: string;
  task_id?: string;
  [key: string]: unknown;
}

interface SessionData {
  session_id?: string;
  project?: string;
  created_at?: string;
  tasks: SessionTaskData[];
  taskCount: number;
  [key: string]: unknown;
}

interface DashboardStatistics {
  totalSessions: number;
  activeSessions: number;
  totalTasks: number;
  completedTasks: number;
  [key: string]: unknown;
}

interface DashboardData {
  generatedAt?: string;
  activeSessions: SessionData[];
  archivedSessions: SessionData[];
  statistics: DashboardStatistics;
  reviewData?: ReviewData;
  liteTasks?: {
    litePlan?: unknown[];
    liteFix?: unknown[];
    [key: string]: unknown;
  };
  projectPath?: string;
  recentPaths?: string[];
  [key: string]: unknown;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Bundled template paths (from dist/core/ -> src/templates/)
const UNIFIED_TEMPLATE = join(__dirname, '../../src/templates/dashboard.html');
const JS_FILE = join(__dirname, '../../src/templates/dashboard.js');
const MODULE_CSS_DIR = join(__dirname, '../../src/templates/dashboard-css');
const WORKFLOW_TEMPLATE = join(__dirname, '../../src/templates/workflow-dashboard.html');
const REVIEW_TEMPLATE = join(__dirname, '../../src/templates/review-cycle-dashboard.html');

// Modular CSS files in load order
const MODULE_CSS_FILES = [
  '01-base.css',
  '02-session.css',
  '03-tasks.css',
  '04-lite-tasks.css',
  '05-context.css',
  '06-cards.css',
  '07-managers.css',
  '08-review.css',
  '09-explorer.css',
  // CLI modules (split from 10-cli.css)
  '10-cli-status.css',
  '11-cli-history.css',
  '12-cli-legacy.css',
  '13-cli-ccw.css',
  '14-cli-modals.css',
  '15-cli-endpoints.css',
  '16-cli-session.css',
  '17-cli-conversation.css',
  '18-cli-settings.css',
  '19-cli-native-session.css',
  '20-cli-taskqueue.css',
  '21-cli-toolmgmt.css',
  '22-cli-semantic.css',
  // Other modules
  '23-memory.css',
  '24-prompt-history.css',
  '25-skills-rules.css',
  '26-claude-manager.css',
  '27-graph-explorer.css',
  '28-mcp-manager.css',
  '29-help.css',
  '30-core-memory.css',
  '31-api-settings.css',
  '34-discovery.css'
];

const MODULE_FILES = [
  'i18n.js',  // Must be loaded first for translations
  'utils.js',
  'state.js',
  'api.js',
  'components/theme.js',
  'components/modals.js',
  'components/navigation.js',
  'components/sidebar.js',
  'components/tabs-context.js',
  'components/tabs-other.js',
  'components/task-drawer-core.js',
  'components/task-drawer-renderers.js',
  'components/flowchart.js',
  'components/carousel.js',
  'components/notifications.js',
  'components/global-notifications.js',
  'components/task-queue-sidebar.js',
  'components/cli-status.js',
  'components/cli-history.js',
  'components/mcp-manager.js',
  'components/hook-manager.js',
  'components/version-check.js',
  'components/storage-manager.js',
  'components/index-manager.js',
  'views/home.js',
  'views/project-overview.js',
  'views/session-detail.js',
  'views/review-session.js',
  'views/lite-tasks.js',
  'views/fix-session.js',
  'views/cli-manager.js',
  'views/codexlens-manager.js',
  'views/explorer.js',
  'views/mcp-manager.js',
  'views/hook-manager.js',
  'views/history.js',
  'views/graph-explorer.js',
  'views/memory.js',
  'views/core-memory.js',
  'views/core-memory-graph.js',
  'views/core-memory-clusters.js',
  'views/prompt-history.js',
  'views/skills-manager.js',
  'views/rules-manager.js',
  'views/claude-manager.js',
  'views/api-settings.js',
  'views/issue-manager.js',
  'views/issue-discovery.js',
  'views/help.js',
  'main.js'
];

/**
 * Generate dashboard HTML from aggregated data
 * Uses bundled templates from ccw package
 * @param {Object} data - Aggregated dashboard data
 * @returns {Promise<string>} - Generated HTML
 */
export async function generateDashboard(data: unknown): Promise<string> {
  const dashboardData = (data ?? {}) as DashboardData;
  // Use new unified template (with sidebar layout)
  if (existsSync(UNIFIED_TEMPLATE)) {
    return generateFromUnifiedTemplate(dashboardData);
  }

  // Fallback to legacy workflow template
  if (existsSync(WORKFLOW_TEMPLATE)) {
    return generateFromBundledTemplate(dashboardData, WORKFLOW_TEMPLATE);
  }

  // Fallback to inline dashboard if templates missing
  return generateInlineDashboard(dashboardData);
}

/**
 * Generate dashboard using unified template (new sidebar layout)
 * @param {Object} data - Dashboard data
 * @returns {string} - Generated HTML
 */
function generateFromUnifiedTemplate(data: DashboardData): string {
  let html = readFileSync(UNIFIED_TEMPLATE, 'utf8');

  // Read and concatenate modular CSS files in load order
  let cssContent = MODULE_CSS_FILES.map(file => {
    const filePath = join(MODULE_CSS_DIR, file);
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  }).join('\n\n');

  // Read JS content
  let jsContent = '';
  const moduleBase = join(__dirname, '../../src/templates/dashboard-js');

  if (existsSync(moduleBase)) {
    jsContent = MODULE_FILES.map(file => {
      const filePath = join(moduleBase, file);
      return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
    }).join('\n\n');
  } else if (existsSync(JS_FILE)) {
    jsContent = readFileSync(JS_FILE, 'utf8');
  }

  // Prepare complete workflow data
  const workflowData = {
    generatedAt: data.generatedAt || new Date().toISOString(),
    activeSessions: data.activeSessions || [],
    archivedSessions: data.archivedSessions || [],
    liteTasks: data.liteTasks || { litePlan: [], liteFix: [] },
    reviewData: data.reviewData || { dimensions: {} },
    statistics: data.statistics || {
      totalSessions: 0,
      activeSessions: 0,
      totalTasks: 0,
      completedTasks: 0,
      litePlanCount: 0,
      liteFixCount: 0
    }
  };

  // Get project path and recent paths
  const projectPath = data.projectPath || process.cwd();
  const recentPaths = data.recentPaths || [projectPath];

  // Replace JS placeholders with actual data
  jsContent = jsContent.replace('{{WORKFLOW_DATA}}', JSON.stringify(workflowData, null, 2));
  jsContent = jsContent.replace(/\{\{PROJECT_PATH\}\}/g, projectPath.replace(/\\/g, '/'));
  jsContent = jsContent.replace('{{RECENT_PATHS}}', JSON.stringify(recentPaths));

  // Inject platform information for cross-platform MCP command generation
  // 'win32' for Windows, 'darwin' for macOS, 'linux' for Linux
  jsContent = jsContent.replace(/\{\{SERVER_PLATFORM\}\}/g, process.platform);

  // Inject JS and CSS into HTML template
  html = html.replace('{{JS_CONTENT}}', jsContent);
  html = html.replace('{{CSS_CONTENT}}', cssContent);

  // Also replace any remaining placeholders in HTML
  html = html.replace(/\{\{PROJECT_PATH\}\}/g, projectPath.replace(/\\/g, '/'));

  return html;
}

/**
 * Generate dashboard using bundled template
 * @param {Object} data - Dashboard data
 * @param {string} templatePath - Path to workflow-dashboard.html
 * @returns {string} - Generated HTML
 */
function generateFromBundledTemplate(data: DashboardData, templatePath: string): string {
  let html = readFileSync(templatePath, 'utf8');

  // Prepare workflow data for injection
  const workflowData = {
    activeSessions: data.activeSessions,
    archivedSessions: data.archivedSessions
  };

  // Inject workflow data
  html = html.replace('{{WORKFLOW_DATA}}', JSON.stringify(workflowData, null, 2));

  // If we have review data, add a review tab
  if (data.reviewData && data.reviewData.totalFindings > 0) {
    html = injectReviewTab(html, data.reviewData);
  }

  return html;
}

/**
 * Inject review tab into existing dashboard
 * @param {string} html - Base dashboard HTML
 * @param {Object} reviewData - Review data to display
 * @returns {string} - Modified HTML with review tab
 */
function injectReviewTab(html: string, reviewData: ReviewData): string {
  // Add review tab button in header controls
  const tabButtonHtml = `
    <button class="btn" data-tab="reviews" id="reviewTabBtn">Reviews (${reviewData.totalFindings})</button>
  `;

  // Insert after filter-group
  html = html.replace(
    '</div>\n            </div>\n        </header>',
    `</div>
                <div class="filter-group" style="margin-left: auto;">
                    ${tabButtonHtml}
                </div>
            </div>
        </header>`
  );

  // Add review section before closing container
  const reviewSectionHtml = generateReviewSection(reviewData);

  html = html.replace(
    '</div>\n\n    <button class="theme-toggle"',
    `</div>

        ${reviewSectionHtml}
    </div>

    <button class="theme-toggle"`
  );

  // Add review tab JavaScript
  const reviewScript = generateReviewScript(reviewData);
  html = html.replace('</script>', `\n${reviewScript}\n</script>`);

  return html;
}

/**
 * Generate review section HTML
 * @param {Object} reviewData - Review data
 * @returns {string} - HTML for review section
 */
function generateReviewSection(reviewData: ReviewData): string {
  const severityBars = Object.entries(reviewData.severityDistribution)
    .map(([severity, count]) => {
      const colors: Record<string, string> = {
        critical: '#c53030',
        high: '#f56565',
        medium: '#ed8936',
        low: '#48bb78'
      };
      const percent = reviewData.totalFindings > 0
        ? Math.round((count / reviewData.totalFindings) * 100)
        : 0;
      return `
        <div class="severity-bar-item">
          <span class="severity-label">${severity}</span>
          <div class="severity-bar">
            <div class="severity-fill" style="width: ${percent}%; background-color: ${colors[severity]}"></div>
          </div>
          <span class="severity-count">${count}</span>
        </div>
      `;
    }).join('');

  const dimensionCards = Object.entries(reviewData.dimensionSummary)
    .map(([name, info]) => `
      <div class="dimension-card">
        <div class="dimension-name">${name}</div>
        <div class="dimension-count">${info.count} findings</div>
      </div>
    `).join('');

  return `
    <div class="section" id="reviewSectionContainer" style="display: none;">
      <div class="section-header">
        <h2 class="section-title">Code Review Findings</h2>
      </div>

      <div class="review-stats">
        <div class="stat-card">
          <div class="stat-value" style="color: #c53030;">${reviewData.severityDistribution.critical}</div>
          <div class="stat-label">Critical</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #f56565;">${reviewData.severityDistribution.high}</div>
          <div class="stat-label">High</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #ed8936;">${reviewData.severityDistribution.medium}</div>
          <div class="stat-label">Medium</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #48bb78;">${reviewData.severityDistribution.low}</div>
          <div class="stat-label">Low</div>
        </div>
      </div>

      <div class="severity-distribution">
        <h3 style="margin-bottom: 15px; color: var(--text-secondary);">Severity Distribution</h3>
        ${severityBars}
      </div>

      <div class="dimensions-grid" style="margin-top: 30px;">
        <h3 style="margin-bottom: 15px; color: var(--text-secondary);">By Dimension</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px;">
          ${dimensionCards}
        </div>
      </div>

      <style>
        .review-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 30px;
        }
        .severity-distribution {
          background: var(--bg-card);
          padding: 20px;
          border-radius: 8px;
          box-shadow: var(--shadow);
        }
        .severity-bar-item {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .severity-label {
          width: 80px;
          text-transform: capitalize;
          font-size: 0.9rem;
        }
        .severity-bar {
          flex: 1;
          height: 20px;
          background: var(--bg-primary);
          border-radius: 4px;
          overflow: hidden;
        }
        .severity-fill {
          height: 100%;
          transition: width 0.3s;
        }
        .severity-count {
          width: 40px;
          text-align: right;
          font-weight: bold;
        }
        .dimension-card {
          background: var(--bg-card);
          padding: 15px;
          border-radius: 8px;
          box-shadow: var(--shadow);
        }
        .dimension-name {
          font-weight: 600;
          text-transform: capitalize;
          margin-bottom: 5px;
        }
        .dimension-count {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
        @media (max-width: 768px) {
          .review-stats {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      </style>
    </div>
  `;
}

/**
 * Generate JavaScript for review tab functionality
 * @param {Object} reviewData - Review data
 * @returns {string} - JavaScript code
 */
function generateReviewScript(reviewData: ReviewData): string {
  return `
        // Review tab functionality
        const reviewTabBtn = document.getElementById('reviewTabBtn');
        const reviewSection = document.getElementById('reviewSectionContainer');
        const activeSectionContainer = document.getElementById('activeSectionContainer');
        const archivedSectionContainer = document.getElementById('archivedSectionContainer');

        if (reviewTabBtn) {
            reviewTabBtn.addEventListener('click', () => {
                const isActive = reviewTabBtn.classList.contains('active');

                // Toggle review section
                if (isActive) {
                    // Hide reviews, show workflow
                    reviewTabBtn.classList.remove('active');
                    reviewSection.style.display = 'none';
                    activeSectionContainer.style.display = 'block';
                    archivedSectionContainer.style.display = 'block';
                } else {
                    // Show reviews, hide workflow
                    reviewTabBtn.classList.add('active');
                    reviewSection.style.display = 'block';
                    activeSectionContainer.style.display = 'none';
                    archivedSectionContainer.style.display = 'none';

                    // Reset filter buttons
                    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-filter="all"]').classList.add('active');
                }
            });
        }
  `;
}

/**
 * Generate inline dashboard HTML (fallback if bundled templates missing)
 * @param {Object} data - Dashboard data
 * @returns {string}
 */
function generateInlineDashboard(data: DashboardData): string {
  const stats = data.statistics;
  const hasReviews = data.reviewData && data.reviewData.totalFindings > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CCW Dashboard</title>
    <style>
        :root {
            --bg-primary: #f5f7fa;
            --bg-secondary: #ffffff;
            --bg-card: #ffffff;
            --text-primary: #1a202c;
            --text-secondary: #718096;
            --border-color: #e2e8f0;
            --accent-color: #4299e1;
            --success-color: #48bb78;
            --warning-color: #ed8936;
            --danger-color: #f56565;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }
        [data-theme="dark"] {
            --bg-primary: #1a202c;
            --bg-secondary: #2d3748;
            --bg-card: #2d3748;
            --text-primary: #f7fafc;
            --text-secondary: #a0aec0;
            --border-color: #4a5568;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        header {
            background: var(--bg-secondary);
            padding: 20px;
            border-radius: 8px;
            box-shadow: var(--shadow);
            margin-bottom: 30px;
        }
        h1 { font-size: 2rem; color: var(--accent-color); margin-bottom: 10px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: var(--bg-card);
            padding: 20px;
            border-radius: 8px;
            box-shadow: var(--shadow);
        }
        .stat-value { font-size: 2rem; font-weight: bold; color: var(--accent-color); }
        .stat-label { color: var(--text-secondary); font-size: 0.9rem; }
        .section { margin-bottom: 40px; }
        .section-title { font-size: 1.5rem; margin-bottom: 20px; }
        .sessions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        .session-card {
            background: var(--bg-card);
            padding: 20px;
            border-radius: 8px;
            box-shadow: var(--shadow);
        }
        .session-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 10px; }
        .session-meta { color: var(--text-secondary); font-size: 0.9rem; }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--bg-primary);
            border-radius: 4px;
            margin: 15px 0;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--accent-color), var(--success-color));
        }
        .task-item {
            display: flex;
            align-items: center;
            padding: 10px;
            margin-bottom: 8px;
            background: var(--bg-primary);
            border-radius: 6px;
            border-left: 3px solid var(--border-color);
        }
        .task-item.completed { border-left-color: var(--success-color); opacity: 0.8; }
        .task-item.in_progress { border-left-color: var(--warning-color); }
        .task-title { flex: 1; font-size: 0.9rem; }
        .task-id { font-size: 0.75rem; color: var(--text-secondary); font-family: monospace; }
        .empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
        .tabs { display: flex; gap: 10px; margin-top: 15px; }
        .tab-btn {
            padding: 10px 20px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-card);
            color: var(--text-primary);
            cursor: pointer;
        }
        .tab-btn.active { background: var(--accent-color); color: white; border-color: var(--accent-color); }
        .theme-toggle {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: var(--accent-color);
            color: white;
            border: none;
            cursor: pointer;
            font-size: 1.5rem;
            box-shadow: var(--shadow);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>CCW Dashboard</h1>
            <p style="color: var(--text-secondary);">Workflow Sessions and Reviews</p>
            <div class="tabs">
                <button class="tab-btn active" data-tab="workflow">Workflow</button>
                ${hasReviews ? '<button class="tab-btn" data-tab="reviews">Reviews</button>' : ''}
            </div>
        </header>

        <div id="workflowTab">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalSessions}</div>
                    <div class="stat-label">Total Sessions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.activeSessions}</div>
                    <div class="stat-label">Active Sessions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalTasks}</div>
                    <div class="stat-label">Total Tasks</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.completedTasks}</div>
                    <div class="stat-label">Completed Tasks</div>
                </div>
            </div>

            <div class="section">
                <h2 class="section-title">Active Sessions</h2>
                <div class="sessions-grid" id="activeSessions">
                    ${data.activeSessions.length === 0
                      ? '<div class="empty-state">No active sessions</div>'
                      : data.activeSessions.map(s => renderSessionCard(s, true)).join('')}
                </div>
            </div>

            <div class="section">
                <h2 class="section-title">Archived Sessions</h2>
                <div class="sessions-grid" id="archivedSessions">
                    ${data.archivedSessions.length === 0
                      ? '<div class="empty-state">No archived sessions</div>'
                      : data.archivedSessions.map(s => renderSessionCard(s, false)).join('')}
                </div>
            </div>
        </div>

        ${hasReviews ? renderReviewTab(data.reviewData as ReviewData) : ''}
    </div>

    <button class="theme-toggle" onclick="toggleTheme()">🌙</button>

    <script>
        function toggleTheme() {
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            document.querySelector('.theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
        }

        // Initialize theme
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        document.querySelector('.theme-toggle').textContent = savedTheme === 'dark' ? '☀️' : '🌙';

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const tab = btn.dataset.tab;
                document.getElementById('workflowTab').style.display = tab === 'workflow' ? 'block' : 'none';
                const reviewTab = document.getElementById('reviewsTab');
                if (reviewTab) reviewTab.style.display = tab === 'reviews' ? 'block' : 'none';
            });
        });
    </script>
</body>
</html>`;
}

/**
 * Render a session card
 * @param {Object} session - Session data
 * @param {boolean} isActive - Whether session is active
 * @returns {string} - HTML string
 */
function renderSessionCard(session: SessionData, isActive: boolean): string {
  const completedTasks = isActive
    ? session.tasks.filter(t => t.status === 'completed').length
    : session.taskCount;
  const totalTasks = isActive ? session.tasks.length : session.taskCount;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const tasksHtml = isActive && session.tasks.length > 0
    ? session.tasks.map(t => `
        <div class="task-item ${t.status}">
          <div class="task-title">${t.title}</div>
          <span class="task-id">${t.task_id}</span>
        </div>
      `).join('')
    : '';

  return `
    <div class="session-card">
      <div class="session-title">${session.session_id}</div>
      <div class="session-meta">
        ${session.project ? `<div>${session.project}</div>` : ''}
        <div>${session.created_at} | ${completedTasks}/${totalTasks} tasks</div>
      </div>
      ${totalTasks > 0 ? `
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
      ` : ''}
      ${tasksHtml}
    </div>
  `;
}

/**
 * Render review tab HTML
 * @param {Object} reviewData - Review data
 * @returns {string} - HTML string
 */
function renderReviewTab(reviewData: ReviewData): string {
  const { severityDistribution, dimensionSummary } = reviewData;

  return `
    <div id="reviewsTab" style="display: none;">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color: #c53030;">${severityDistribution.critical}</div>
          <div class="stat-label">Critical</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #f56565;">${severityDistribution.high}</div>
          <div class="stat-label">High</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #ed8936;">${severityDistribution.medium}</div>
          <div class="stat-label">Medium</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: #48bb78;">${severityDistribution.low}</div>
          <div class="stat-label">Low</div>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Findings by Dimension</h2>
        <div class="sessions-grid">
          ${Object.entries(dimensionSummary).map(([name, info]) => `
            <div class="session-card">
              <div class="session-title" style="text-transform: capitalize;">${name}</div>
              <div class="session-meta">${info.count} findings</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}
