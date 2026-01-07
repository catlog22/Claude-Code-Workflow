import http from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join, isAbsolute, extname } from 'path';
import { homedir } from 'os';
import { getMemoryStore } from '../memory-store.js';
import { executeCliTool } from '../../tools/cli-executor.js';

/**
 * Route context interface
 */
interface RouteContext {
  pathname: string;
  url: URL;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  initialPath: string;
  handlePostRequest: (req: http.IncomingMessage, res: http.ServerResponse, handler: (body: any) => Promise<any>) => void;
  broadcastToClients: (data: any) => void;
}

/**
 * Derive prompt intent from text
 */
function derivePromptIntent(text: string): string {
  const lower = text.toLowerCase();

  // Implementation/coding patterns
  if (/实现|implement|create|add|build|write|develop|make/.test(lower)) return 'implement';
  if (/修复|fix|bug|error|issue|problem|解决/.test(lower)) return 'fix';
  if (/重构|refactor|optimize|improve|clean/.test(lower)) return 'refactor';
  if (/测试|test|spec|coverage/.test(lower)) return 'test';

  // Analysis patterns
  if (/分析|analyze|review|check|examine|audit/.test(lower)) return 'analyze';
  if (/解释|explain|what|how|why|understand/.test(lower)) return 'explain';
  if (/搜索|search|find|look|where|locate/.test(lower)) return 'search';

  // Documentation patterns
  if (/文档|document|readme|comment|注释/.test(lower)) return 'document';

  // Planning patterns
  if (/计划|plan|design|architect|strategy/.test(lower)) return 'plan';

  // Configuration patterns
  if (/配置|config|setup|install|设置/.test(lower)) return 'configure';

  // Default
  return 'general';
}

/**
 * Calculate prompt quality score (0-100)
 */
function calculateQualityScore(text: string): number {
  let score = 50; // Base score

  // Length factors
  const length = text.length;
  if (length > 50 && length < 500) score += 15;
  else if (length >= 500 && length < 1000) score += 10;
  else if (length < 20) score -= 20;

  // Specificity indicators
  if (/file|path|function|class|method|variable/i.test(text)) score += 10;
  if (/src\/|\.ts|\.js|\.py|\.go/i.test(text)) score += 10;

  // Context indicators
  if (/when|after|before|because|since/i.test(text)) score += 5;

  // Action clarity
  if (/please|要|请|帮|help/i.test(text)) score += 5;

  // Structure indicators
  if (/\d+\.|•|-\s/.test(text)) score += 10; // Lists

  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

/**
 * Handle Memory API routes
 * @returns true if route was handled, false otherwise
 */
export async function handleMemoryRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, url, req, res, initialPath, handlePostRequest, broadcastToClients } = ctx;

  // API: Memory Module - Track entity access
  if (pathname === '/api/memory/track' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { type, action, value, sessionId, metadata, path: projectPath } = body;

      if (!type || !action || !value) {
        return { error: 'type, action, and value are required', status: 400 };
      }

      const basePath = projectPath || initialPath;

      try {
        const memoryStore = getMemoryStore(basePath);
        const now = new Date().toISOString();

        // Normalize the value
        const normalizedValue = value.toLowerCase().trim();

        // Upsert entity
        const entityId = memoryStore.upsertEntity({
          type,
          value,
          normalized_value: normalizedValue,
          first_seen_at: now,
          last_seen_at: now,
          metadata: metadata ? JSON.stringify(metadata) : undefined
        });

        // Log access
        memoryStore.logAccess({
          entity_id: entityId,
          action,
          session_id: sessionId,
          timestamp: now,
          context_summary: metadata?.context
        });

        // Update stats
        memoryStore.updateStats(entityId, action);

        // Calculate new heat score
        const heatScore = memoryStore.calculateHeatScore(entityId);
        const stats = memoryStore.getStats(entityId);

        // Broadcast MEMORY_UPDATED event via WebSocket
        broadcastToClients({
          type: 'MEMORY_UPDATED',
          payload: {
            entity: { id: entityId, type, value },
            stats: {
              read_count: stats?.read_count || 0,
              write_count: stats?.write_count || 0,
              mention_count: stats?.mention_count || 0,
              heat_score: heatScore
            },
            timestamp: now
          }
        });

        return {
          success: true,
          entity_id: entityId,
          heat_score: heatScore
        };
      } catch (error: unknown) {
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Memory Module - Get native Claude history from ~/.claude/history.jsonl
  if (pathname === '/api/memory/native-history') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const historyFile = join(homedir(), '.claude', 'history.jsonl');

    try {
      if (!existsSync(historyFile)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompts: [], total: 0, message: 'No history file found' }));
        return true;
      }

      const content = readFileSync(historyFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      const allPrompts = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Filter by project if specified
          if (projectPath && entry.project) {
            const normalizedProject = entry.project.replace(/\\/g, '/').toLowerCase();
            const normalizedPath = projectPath.replace(/\\/g, '/').toLowerCase();
            if (!normalizedProject.includes(normalizedPath) && !normalizedPath.includes(normalizedProject)) {
              continue;
            }
          }

          allPrompts.push({
            id: `${entry.sessionId}-${entry.timestamp}`,
            text: entry.display || '',
            timestamp: new Date(entry.timestamp).toISOString(),
            project: entry.project || '',
            session_id: entry.sessionId || '',
            pasted_contents: entry.pastedContents || {},
            // Derive intent from content keywords
            intent: derivePromptIntent(entry.display || ''),
            quality_score: calculateQualityScore(entry.display || '')
          });
        } catch (parseError) {
          // Skip malformed lines
        }
      }

      // Sort by timestamp descending
      allPrompts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      const prompts = allPrompts.slice(0, limit);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompts, total: allPrompts.length }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Get prompt history
  if (pathname === '/api/memory/prompts') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const search = url.searchParams.get('search') || null;
    const recursive = url.searchParams.get('recursive') !== 'false';

    try {
      let prompts;

      // Recursive mode: aggregate prompts from parent and child projects
      if (recursive && !search) {
        const { getAggregatedPrompts } = await import('../memory-store.js');
        prompts = await getAggregatedPrompts(projectPath, limit);
      } else {
        // Non-recursive mode or search mode: query only current project
        const memoryStore = getMemoryStore(projectPath);

        if (search) {
          prompts = memoryStore.searchPrompts(search, limit);
        } else {
          // Get all recent prompts (we'll need to add this method to MemoryStore)
          const stmt = memoryStore['db'].prepare(`
            SELECT * FROM prompt_history
            ORDER BY timestamp DESC
            LIMIT ?
          `);
          prompts = stmt.all(limit);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompts }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Get insights (from prompt_patterns)
  if (pathname === '/api/memory/insights' && req.method === 'GET') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limitParam = url.searchParams.get('limit');
    const tool = url.searchParams.get('tool') || undefined;

    // Check if this is a request for insights history (has limit or tool param)
    if (limitParam || tool) {
      const limit = parseInt(limitParam || '20', 10);
      try {
        const storeModule = await import('../../tools/cli-history-store.js');
        const store = storeModule.getHistoryStore(projectPath);
        const insights = store.getInsights({ limit, tool });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, insights }));
      } catch (error: unknown) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
      return true;
    }

    // Default: Get prompt pattern insights
    try {
      const memoryStore = getMemoryStore(projectPath);

      // Get total prompt count
      const countStmt = memoryStore['db'].prepare(`SELECT COUNT(*) as count FROM prompt_history`);
      const { count: totalPrompts } = countStmt.get() as { count: number };

      // Get top intent
      const topIntentStmt = memoryStore['db'].prepare(`
        SELECT intent_label, COUNT(*) as count
        FROM prompt_history
        WHERE intent_label IS NOT NULL
        GROUP BY intent_label
        ORDER BY count DESC
        LIMIT 1
      `);
      const topIntentRow = topIntentStmt.get() as { intent_label: string; count: number } | undefined;

      // Get average prompt length
      const avgLengthStmt = memoryStore['db'].prepare(`
        SELECT AVG(LENGTH(prompt_text)) as avg_length
        FROM prompt_history
        WHERE prompt_text IS NOT NULL
      `);
      const { avg_length: avgLength } = avgLengthStmt.get() as { avg_length: number };

      // Get prompt patterns
      const patternsStmt = memoryStore['db'].prepare(`
        SELECT * FROM prompt_patterns
        ORDER BY frequency DESC
        LIMIT 10
      `);
      const patterns = patternsStmt.all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        stats: {
          totalPrompts,
          topIntent: topIntentRow?.intent_label || 'unknown',
          avgLength: Math.round(avgLength || 0)
        },
        patterns: patterns.map((p: any) => ({
          type: p.pattern_type,
          description: `Pattern detected in prompts`,
          occurrences: p.frequency,
          suggestion: `Consider using more specific prompts for ${p.pattern_type}`
        }))
      }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Trigger async CLI-based insights analysis
  if (pathname === '/api/memory/insights/analyze' && req.method === 'POST') {
    handlePostRequest(req, res, async (body: any) => {
      const projectPath = body.path || initialPath;
      const tool = body.tool || 'gemini'; // gemini, qwen, codex, claude
      const prompts = body.prompts || [];
      const lang = body.lang || 'en'; // Language preference

      if (prompts.length === 0) {
        return { error: 'No prompts provided for analysis', status: 400 };
      }

      // Prepare prompt summary for CLI analysis
      const promptSummary = prompts.slice(0, 20).map((p: any, i: number) => {
        return `${i + 1}. [${p.intent || 'unknown'}] ${(p.text || '').substring(0, 100)}...`;
      }).join('\n');

      const langInstruction = lang === 'zh'
        ? '请用中文回复。所有 description、suggestion、title 字段必须使用中文。'
        : 'Respond in English. All description, suggestion, title fields must be in English.';

      const analysisPrompt = `
PURPOSE: Analyze prompt patterns and provide optimization suggestions
TASK:
• Review the following prompt history summary
• Identify common patterns (vague requests, repetitive queries, incomplete context)
• Suggest specific improvements for prompt quality
• Detect areas where prompts could be more effective
MODE: analysis
CONTEXT: ${prompts.length} prompts from project: ${projectPath}
EXPECTED: JSON with patterns array and suggestions array
LANGUAGE: ${langInstruction}

PROMPT HISTORY:
${promptSummary}

Return ONLY valid JSON in this exact format (no markdown, no code blocks, just pure JSON):
{
  "patterns": [
    {"type": "pattern_type", "description": "description", "occurrences": count, "severity": "low|medium|high", "suggestion": "how to improve"}
  ],
  "suggestions": [
    {"title": "title", "description": "description", "example": "example prompt"}
  ]
}`;

      try {
        // Queue CLI execution
        const result = await executeCliTool({
          tool,
          prompt: analysisPrompt,
          mode: 'analysis',
          timeout: 120000,
          cd: projectPath,
          category: 'insight'
        });

        // Try to parse JSON from response - use parsedOutput (extracted text) instead of raw stdout
        let insights: { patterns: any[]; suggestions: any[] } = { patterns: [], suggestions: [] };
        const cliOutput = result.parsedOutput || result.stdout || '';
        if (cliOutput) {
          let outputText = cliOutput;

          // Strip markdown code blocks if present
          const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            outputText = codeBlockMatch[1].trim();
          }

          // Find JSON object in the response
          const jsonMatch = outputText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              insights = JSON.parse(jsonMatch[0]);
              // Ensure arrays exist
              if (!Array.isArray(insights.patterns)) insights.patterns = [];
              if (!Array.isArray(insights.suggestions)) insights.suggestions = [];
            } catch (e) {
              console.error('[insights/analyze] JSON parse error:', e);
              // Return raw output if JSON parse fails
              insights = {
                patterns: [{ type: 'raw_analysis', description: cliOutput.substring(0, 500), occurrences: 1, severity: 'low', suggestion: '' }],
                suggestions: []
              };
            }
          } else {
            // No JSON found, wrap raw output
            insights = {
              patterns: [{ type: 'raw_analysis', description: cliOutput.substring(0, 500), occurrences: 1, severity: 'low', suggestion: '' }],
              suggestions: []
            };
          }
        }

        // Save insight to database
        try {
          const storeModule = await import('../../tools/cli-history-store.js');
          const store = storeModule.getHistoryStore(projectPath);
          const insightId = `insight-${Date.now()}`;
          store.saveInsight({
            id: insightId,
            tool,
            promptCount: prompts.length,
            patterns: insights.patterns,
            suggestions: insights.suggestions,
            rawOutput: cliOutput,
            executionId: result.execution?.id,
            lang
          });
          console.log('[Insights] Saved insight:', insightId);
        } catch (saveErr) {
          console.warn('[Insights] Failed to save insight:', (saveErr as Error).message);
        }

        return {
          success: true,
          insights,
          tool,
          executionId: result.execution.id
        };
      } catch (error: unknown) {
        return { error: (error as Error).message, status: 500 };
      }
    });
    return true;
  }

  // API: Get single insight detail
  if (pathname.startsWith('/api/memory/insights/') && req.method === 'GET') {
    const insightId = pathname.replace('/api/memory/insights/', '');
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!insightId || insightId === 'analyze') {
      // Skip - handled by other routes
      return false;
    }

    try {
      const storeModule = await import('../../tools/cli-history-store.js');
      const store = storeModule.getHistoryStore(projectPath);
      const insight = store.getInsight(insightId);

      if (insight) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, insight }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Insight not found' }));
      }
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Delete insight
  if (pathname.startsWith('/api/memory/insights/') && req.method === 'DELETE') {
    const insightId = pathname.replace('/api/memory/insights/', '');
    const projectPath = url.searchParams.get('path') || initialPath;

    try {
      const storeModule = await import('../../tools/cli-history-store.js');
      const store = storeModule.getHistoryStore(projectPath);
      const deleted = store.deleteInsight(insightId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: deleted }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Get hotspot statistics
  if (pathname === '/api/memory/stats') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const filter = url.searchParams.get('filter') || 'all'; // today, week, all
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const recursive = url.searchParams.get('recursive') !== 'false';

    try {
      // If requesting aggregated stats, use the aggregated function
      if (url.searchParams.has('aggregated') || recursive) {
        const { getAggregatedStats } = await import('../memory-store.js');
        const aggregatedStats = await getAggregatedStats(projectPath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          stats: aggregatedStats,
          aggregated: true
        }));
        return true;
      }

      // Original hotspot statistics (non-recursive)
      const memoryStore = getMemoryStore(projectPath);
      const hotEntities = memoryStore.getHotEntities(limit * 4);

      // Filter by time if needed
      let filtered = hotEntities;
      if (filter === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        filtered = hotEntities.filter((e: any) => new Date(e.last_seen_at) >= today);
      } else if (filter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = hotEntities.filter((e: any) => new Date(e.last_seen_at) >= weekAgo);
      }

      // Separate into mostRead, mostEdited, and mostMentioned
      const fileEntities = filtered.filter((e: any) => e.type === 'file');
      const topicEntities = filtered.filter((e: any) => e.type === 'topic');

      const mostRead = fileEntities
        .filter((e: any) => e.stats.read_count > 0)
        .sort((a: any, b: any) => b.stats.read_count - a.stats.read_count)
        .slice(0, limit)
        .map((e: any) => ({
          path: e.value,
          file: e.value.split(/[/\\]/).pop(),
          heat: e.stats.read_count,
          count: e.stats.read_count,
          lastSeen: e.last_seen_at
        }));

      const mostEdited = fileEntities
        .filter((e: any) => e.stats.write_count > 0)
        .sort((a: any, b: any) => b.stats.write_count - a.stats.write_count)
        .slice(0, limit)
        .map((e: any) => ({
          path: e.value,
          file: e.value.split(/[/\\]/).pop(),
          heat: e.stats.write_count,
          count: e.stats.write_count,
          lastSeen: e.last_seen_at
        }));

      const mostMentioned = topicEntities
        .filter((e: any) => e.stats.mention_count > 0)
        .sort((a: any, b: any) => b.stats.mention_count - a.stats.mention_count)
        .slice(0, limit)
        .map((e: any) => ({
          topic: e.value,
          preview: e.value.substring(0, 100) + (e.value.length > 100 ? '...' : ''),
          heat: e.stats.mention_count,
          count: e.stats.mention_count,
          lastSeen: e.last_seen_at
        }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stats: { mostRead, mostEdited, mostMentioned } }));
    } catch (error: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stats: { mostRead: [], mostEdited: [], mostMentioned: [] } }));
    }
    return true;
  }

  // API: Memory Module - Get memory graph (file associations with modules and components)
  if (pathname === '/api/memory/graph') {
    const projectPath = url.searchParams.get('path') || initialPath;

    try {
      const memoryStore = getMemoryStore(projectPath);
      const hotEntities = memoryStore.getHotEntities(100);

      // Build file nodes from entities
      const fileEntities = hotEntities.filter((e: any) => e.type === 'file');
      const fileNodes = fileEntities.map((e: any) => {
        const fileName = e.value.split(/[/\\]/).pop() || '';
        // Detect component type based on file name patterns
        const isComponent = /\.(tsx|jsx|vue|svelte)$/.test(fileName) ||
          /^[A-Z][a-zA-Z]+\.(ts|js)$/.test(fileName) ||
          fileName.includes('.component.') ||
          fileName.includes('.controller.');

        return {
          id: e.value,
          name: fileName,
          path: e.value,
          type: isComponent ? 'component' : 'file',
          heat: Math.min(25, 8 + e.stats.heat_score / 10)
        };
      });

      // Extract unique modules (directories) from file paths
      const moduleMap = new Map<string, { heat: number; files: string[] }>();
      for (const file of fileEntities) {
        const parts = file.value.split(/[/\\]/);
        // Get parent directory as module (skip if root level)
        if (parts.length > 1) {
          const modulePath = parts.slice(0, -1).join('/');
          const moduleName = parts[parts.length - 2] || modulePath;
          // Skip common non-module directories
          if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'].includes(moduleName)) continue;

          if (!moduleMap.has(modulePath)) {
            moduleMap.set(modulePath, { heat: 0, files: [] });
          }
          const mod = moduleMap.get(modulePath)!;
          mod.heat += file.stats.heat_score / 20;
          mod.files.push(file.value);
        }
      }

      // Create module nodes (limit to top modules by heat)
      const moduleNodes = Array.from(moduleMap.entries())
        .sort((a, b) => b[1].heat - a[1].heat)
        .slice(0, 15)
        .map(([modulePath, data]) => ({
          id: modulePath,
          name: modulePath.split(/[/\\]/).pop() || modulePath,
          path: modulePath,
          type: 'module',
          heat: Math.min(20, 12 + data.heat / 5),
          fileCount: data.files.length
        }));

      // Combine all nodes
      const nodes = [...fileNodes, ...moduleNodes];
      const nodeIds = new Set(nodes.map(n => n.id));

      // Build edges from associations
      const edges: any[] = [];
      const edgeSet = new Set<string>(); // Prevent duplicate edges

      // Add file-to-file associations
      for (const entity of hotEntities) {
        if (!entity.id || entity.type !== 'file') continue;
        const associations = memoryStore.getAssociations(entity.id, 10);
        for (const assoc of associations) {
          if (assoc.target && nodeIds.has(assoc.target.value)) {
            const edgeKey = [entity.value, assoc.target.value].sort().join('|');
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              edges.push({
                source: entity.value,
                target: assoc.target.value,
                weight: assoc.weight
              });
            }
          }
        }
      }

      // Add file-to-module edges (files belong to their parent modules)
      for (const [modulePath, data] of moduleMap.entries()) {
        if (!nodeIds.has(modulePath)) continue;
        for (const filePath of data.files) {
          if (nodeIds.has(filePath)) {
            const edgeKey = [modulePath, filePath].sort().join('|');
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              edges.push({
                source: modulePath,
                target: filePath,
                weight: 2 // Lower weight for structural relationships
              });
            }
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ graph: { nodes, edges } }));
    } catch (error: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ graph: { nodes: [], edges: [] } }));
    }
    return true;
  }

  // API: Memory Module - Get recent context activities
  if (pathname === '/api/memory/recent') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    try {
      const memoryStore = getMemoryStore(projectPath);

      // Get recent access logs with entity info - filter to file type only
      const db = (memoryStore as any).db;
      const recentLogs = db.prepare(`
        SELECT a.*, e.type, e.value
        FROM access_logs a
        JOIN entities e ON a.entity_id = e.id
        WHERE e.type = 'file'
        ORDER BY a.timestamp DESC
        LIMIT ?
      `).all(limit * 2) as any[]; // Fetch more to account for filtering

      // Filter out invalid entries (JSON strings, error messages, etc.)
      const validLogs = recentLogs.filter((log: any) => {
        const value = log.value || '';
        // Skip if value looks like JSON or contains error-like patterns
        if (value.includes('"status"') || value.includes('"content"') ||
            value.includes('"activeForm"') || value.startsWith('{') ||
            value.startsWith('[') || value.includes('graph 400')) {
          return false;
        }
        // Must have a file extension or look like a valid path
        const hasExtension = /\.[a-zA-Z0-9]{1,10}$/.test(value);
        const looksLikePath = value.includes('/') || value.includes('\\');
        return hasExtension || looksLikePath;
      }).slice(0, limit);

      const recent = validLogs.map((log: any) => ({
        type: log.action, // read, write, mention
        timestamp: log.timestamp,
        prompt: log.context_summary || '',
        files: [log.value],
        description: `${log.action}: ${log.value.split(/[/\\]/).pop()}`
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ recent }));
    } catch (error: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ recent: [] }));
    }
    return true;
  }

  // API: Active Memory - Get status
  if (pathname === '/api/memory/active/status') {
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!projectPath) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: false, status: null, config: { interval: 'manual', tool: 'gemini' } }));
      return true;
    }

    try {
      const rulesDir = join(projectPath, '.claude', 'rules');
      const configPath = join(rulesDir, 'active_memory.md');
      const configJsonPath = join(projectPath, '.claude', 'active_memory_config.json');
      const enabled = existsSync(configPath);
      let lastSync: string | null = null;
      let fileCount = 0;
      let config = { interval: 'manual', tool: 'gemini' };

      if (enabled) {
        const stats = statSync(configPath);
        lastSync = stats.mtime.toISOString();
        const content = readFileSync(configPath, 'utf-8');
        // Count file sections
        fileCount = (content.match(/^## /gm) || []).length;
      }

      // Load config if exists
      if (existsSync(configJsonPath)) {
        try {
          config = JSON.parse(readFileSync(configJsonPath, 'utf-8'));
        } catch (e) { /* ignore parse errors */ }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled,
        status: enabled ? { lastSync, fileCount } : null,
        config
      }));
    } catch (error: unknown) {
      console.error('Active Memory status error:', error);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: false, status: null, config: { interval: 'manual', tool: 'gemini' } }));
    }
    return true;
  }

  // API: Active Memory - Toggle
  if (pathname === '/api/memory/active/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { enabled, config } = JSON.parse(body || '{}');
        const projectPath = initialPath;

        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No project path configured' }));
          return;
        }

        const claudeDir = join(projectPath, '.claude');
        const rulesDir = join(claudeDir, 'rules');
        const configPath = join(rulesDir, 'active_memory.md');
        const configJsonPath = join(claudeDir, 'active_memory_config.json');

        if (enabled) {
          // Enable: Create directories and initial file
          if (!existsSync(claudeDir)) {
            mkdirSync(claudeDir, { recursive: true });
          }
          if (!existsSync(rulesDir)) {
            mkdirSync(rulesDir, { recursive: true });
          }

          // Save config
          if (config) {
            writeFileSync(configJsonPath, JSON.stringify(config, null, 2), 'utf-8');
          }

          // Create initial active_memory.md with header
          const initialContent = `# Active Memory - Project Context

> Auto-generated understanding of frequently accessed files.
> Last updated: ${new Date().toISOString()}

---

*No files analyzed yet. Click "Sync Now" to analyze hot files.*
`;
          writeFileSync(configPath, initialContent, 'utf-8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: true, message: 'Active Memory enabled' }));
        } else {
          // Disable: Remove the files
          if (existsSync(configPath)) {
            unlinkSync(configPath);
          }
          if (existsSync(configJsonPath)) {
            unlinkSync(configJsonPath);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: false, message: 'Active Memory disabled' }));
        }
      } catch (error: unknown) {
        console.error('Active Memory toggle error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      }
    });
    return true;
  }

  // API: Active Memory - Update Config
  if (pathname === '/api/memory/active/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { config } = JSON.parse(body || '{}');
        const projectPath = initialPath;
        const claudeDir = join(projectPath, '.claude');
        const configJsonPath = join(claudeDir, 'active_memory_config.json');

        if (!existsSync(claudeDir)) {
          mkdirSync(claudeDir, { recursive: true });
        }

        writeFileSync(configJsonPath, JSON.stringify(config, null, 2), 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config }));
      } catch (error: unknown) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
    });
    return true;
  }

  // API: Active Memory - Sync (analyze hot files using CLI and update active_memory.md)
  if (pathname === '/api/memory/active/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { tool = 'gemini' } = JSON.parse(body || '{}');
        const projectPath = initialPath;

        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No project path configured' }));
          return;
        }

        const claudeDir = join(projectPath, '.claude');
        const rulesDir = join(claudeDir, 'rules');
        const configPath = join(rulesDir, 'active_memory.md');

        // Get hot files from memory store - with fallback
        let hotFiles: any[] = [];
        try {
          const memoryStore = getMemoryStore(projectPath);
          const hotEntities = memoryStore.getHotEntities(20);
          hotFiles = hotEntities
            .filter((e: any) => e.type === 'file')
            .slice(0, 10);
        } catch (memErr) {
          console.warn('[Active Memory] Memory store error, using empty list:', (memErr as Error).message);
        }

        // Build file list for CLI analysis
        const filePaths = hotFiles.map((f: any) => {
          const filePath = f.value;
          return isAbsolute(filePath) ? filePath : join(projectPath, filePath);
        }).filter((p: string) => existsSync(p));

        // Build the active_memory.md content header
        let content = `# Active Memory - Project Context

> Auto-generated understanding of frequently accessed files using ${tool.toUpperCase()}.
> Last updated: ${new Date().toISOString()}
> Files analyzed: ${hotFiles.length}
> CLI Tool: ${tool}

---

`;

        // Use CCW CLI tool to analyze files
        let cliOutput = '';

        // Build CLI prompt
        const cliPrompt = `PURPOSE: Analyze the following hot files and provide a concise understanding of each.
TASK: For each file, describe its purpose, key exports, dependencies, and how it relates to other files.
MODE: analysis
CONTEXT: ${filePaths.map((p: string) => '@' + p).join(' ')}
EXPECTED: Markdown format with ## headings for each file, bullet points for key information.
RULES: Be concise. Focus on practical understanding. Include function signatures for key exports.`;

        // Try to execute CLI using CCW's built-in executor
        try {
          const syncId = `active-memory-${Date.now()}`;
          const result = await executeCliTool({
            tool: tool === 'qwen' ? 'qwen' : 'gemini',
            prompt: cliPrompt,
            mode: 'analysis',
            format: 'plain',
            cd: projectPath,
            timeout: 120000,
            stream: false,
            category: 'internal',
            id: syncId
          });

          if (result.success) {
            // Prefer parsedOutput (extracted text from stream JSON) over raw execution output
            if (result.parsedOutput) {
              cliOutput = result.parsedOutput;
            } else if (result.execution?.output) {
              // Fallback to execution.output
              const output = result.execution.output;
              if (typeof output === 'string') {
                cliOutput = output;
              } else if (output && typeof output === 'object') {
                // Handle object output - extract stdout or serialize the object
                if (output.stdout && typeof output.stdout === 'string') {
                  cliOutput = output.stdout;
                } else if (output.stderr && typeof output.stderr === 'string') {
                  cliOutput = output.stderr;
                } else {
                  // Last resort: serialize the entire object as JSON
                  cliOutput = JSON.stringify(output, null, 2);
                }
              }
            }
          }

          // Add CLI output to content (only if not empty)
          if (cliOutput && cliOutput.trim()) {
            content += cliOutput + '\n\n---\n\n';
          }

        } catch (cliErr) {
          // Fallback to basic analysis if CLI fails
          console.warn('[Active Memory] CLI analysis failed, using basic analysis:', (cliErr as Error).message);

          // Basic analysis fallback
          for (const file of hotFiles) {
            const fileName = file.value.split(/[/\\]/).pop() || file.value;
            const filePath = file.value;
            const heat = file.stats?.heat_score || 0;
            const readCount = file.stats?.read_count || 0;
            const writeCount = file.stats?.write_count || 0;

            content += `## ${fileName}

- **Path**: \`${filePath}\`
- **Heat Score**: ${heat}
- **Access**: ${readCount} reads, ${writeCount} writes
- **Last Seen**: ${file.last_seen_at || 'Unknown'}

`;

            // Try to read file and generate summary
            try {
              const fullPath = isAbsolute(filePath) ? filePath : join(projectPath, filePath);

              if (existsSync(fullPath)) {
                const stat = statSync(fullPath);
                const ext = extname(fullPath).toLowerCase();

                content += `- **Size**: ${(stat.size / 1024).toFixed(1)} KB\n`;
                content += `- **Type**: ${ext || 'unknown'}\n`;

                const textExts = ['.ts', '.js', '.tsx', '.jsx', '.md', '.json', '.css', '.html', '.vue', '.svelte', '.py', '.go', '.rs'];
                if (textExts.includes(ext) && stat.size < 100000) {
                  const fileContent = readFileSync(fullPath, 'utf-8');
                  const lines = fileContent.split('\n').slice(0, 30);

                  const exports = lines.filter(l =>
                    l.includes('export ') || l.includes('function ') ||
                    l.includes('class ') || l.includes('interface ')
                  ).slice(0, 8);

                  if (exports.length > 0) {
                    content += `\n**Key Exports**:\n\`\`\`\n${exports.join('\n')}\n\`\`\`\n`;
                  }
                }
              }
            } catch (fileErr) {
              // Skip file analysis errors
            }

            content += '\n---\n\n';
          }
        }

        // Ensure directories exist
        if (!existsSync(claudeDir)) {
          mkdirSync(claudeDir, { recursive: true });
        }
        if (!existsSync(rulesDir)) {
          mkdirSync(rulesDir, { recursive: true });
        }

        // Write the file
        writeFileSync(configPath, content, 'utf-8');

        // Broadcast Active Memory sync completion event
        broadcastToClients({
          type: 'ACTIVE_MEMORY_SYNCED',
          payload: {
            filesAnalyzed: hotFiles.length,
            path: configPath,
            tool,
            usedCli: cliOutput.length > 0,
            timestamp: new Date().toISOString()
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          filesAnalyzed: hotFiles.length,
          path: configPath,
          usedCli: cliOutput.length > 0
        }));
      } catch (error: unknown) {
        console.error('[Active Memory] Sync error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      }
    });
    return true;
  }

  // API: Memory Module - Get conversations index
  if (pathname === '/api/memory/conversations') {
    const projectPath = url.searchParams.get('path') || initialPath;
    const project = url.searchParams.get('project') || null;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    try {
      const memoryStore = getMemoryStore(projectPath);

      let conversations;
      if (project) {
        const stmt = memoryStore['db'].prepare(`
          SELECT * FROM conversations
          WHERE project_name = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `);
        conversations = stmt.all(project, limit);
      } else {
        conversations = memoryStore.getConversations(limit);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversations }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Replay conversation
  if (pathname.startsWith('/api/memory/replay/')) {
    const conversationId = pathname.replace('/api/memory/replay/', '');
    const projectPath = url.searchParams.get('path') || initialPath;

    if (!conversationId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Conversation ID is required' }));
      return true;
    }

    try {
      const memoryStore = getMemoryStore(projectPath);
      const conversation = memoryStore.getConversation(conversationId);

      if (!conversation) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Conversation not found' }));
        return true;
      }

      const messages = memoryStore.getMessages(conversationId);

      // Enhance messages with tool calls
      const messagesWithTools = [];
      for (const message of messages) {
        const toolCalls = message.id ? memoryStore.getToolCalls(message.id) : [];
        messagesWithTools.push({
          ...message,
          tool_calls: toolCalls
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        conversation,
        messages: messagesWithTools
      }));
    } catch (error: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return true;
  }

  // API: Memory Module - Import history (async task)
  if (pathname === '/api/memory/import' && req.method === 'POST') {
    handlePostRequest(req, res, async (body) => {
      const { source = 'all', project, path: projectPath } = body;
      const basePath = projectPath || initialPath;

      // Generate task ID for async operation
      const taskId = `import-${Date.now()}`;

      // TODO: Implement actual history import using HistoryImporter
      // For now, return a placeholder response
      console.log(`[Memory] Import task ${taskId} started: source=${source}, project=${project}`);

      return {
        success: true,
        taskId,
        message: 'Import task started (not yet implemented)',
        source,
        project
      };
    });
    return true;
  }

  return false;
}
