/**
 * Core Memory Store - Independent storage system for core memories
 * Provides persistent storage for high-level architectural and strategic context
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { StoragePaths, ensureStorageDir } from '../config/storage-paths.js';

// Types
export interface CoreMemory {
  id: string; // Format: CMEM-YYYYMMDD-HHMMSS
  content: string;
  summary: string;
  raw_output?: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  metadata?: string; // JSON string
}

export interface SessionCluster {
  id: string;  // Format: CLST-YYYYMMDD-HHMMSS
  name: string;
  description?: string;
  intent?: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'archived' | 'merged';
  metadata?: string;
}

export interface ClusterMember {
  cluster_id: string;
  session_id: string;
  session_type: 'core_memory' | 'workflow' | 'cli_history' | 'native';
  sequence_order: number;
  added_at: string;
  relevance_score: number;
}

export interface ClusterRelation {
  source_cluster_id: string;
  target_cluster_id: string;
  relation_type: 'depends_on' | 'extends' | 'conflicts_with' | 'related_to';
  created_at: string;
}

export interface SessionMetadataCache {
  session_id: string;
  session_type: string;
  title?: string;
  summary?: string;
  keywords?: string[];  // stored as JSON
  token_estimate?: number;
  file_patterns?: string[];  // stored as JSON
  created_at?: string;
  last_accessed?: string;
  access_count: number;
}

export interface MemoryChunk {
  id?: number;
  source_id: string;
  source_type: 'core_memory' | 'workflow' | 'cli_history';
  chunk_index: number;
  content: string;
  embedding?: Buffer;
  metadata?: string;
  created_at: string;
}

export interface ClaudeUpdateRecord {
  id?: number;
  file_path: string;
  file_level: 'user' | 'project' | 'module';
  module_path?: string;
  updated_at: string;
  update_source: 'manual' | 'cli_sync' | 'dashboard' | 'api';
  git_commit_hash?: string;
  files_changed_before_update: number;
  metadata?: string;
}

/**
 * Core Memory Store using SQLite
 */
export class CoreMemoryStore {
  private db: Database.Database;
  private dbPath: string;
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Use centralized storage path
    const paths = StoragePaths.project(projectPath);
    const coreMemoryDir = join(paths.root, 'core-memory');
    ensureStorageDir(coreMemoryDir);

    this.dbPath = join(coreMemoryDir, 'core_memory.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initDatabase();
  }

  /**
   * Initialize database schema
   */
  private initDatabase(): void {
    // Migrate old tables
    this.migrateDatabase();

    this.db.exec(`
      -- Core memories table
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        summary TEXT,
        raw_output TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER DEFAULT 0,
        metadata TEXT
      );

      -- Session clusters table
      CREATE TABLE IF NOT EXISTS session_clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        intent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        metadata TEXT
      );

      -- Cluster members table
      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_type TEXT NOT NULL,
        sequence_order INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        relevance_score REAL DEFAULT 1.0,
        PRIMARY KEY (cluster_id, session_id),
        FOREIGN KEY (cluster_id) REFERENCES session_clusters(id) ON DELETE CASCADE
      );

      -- Cluster relations table
      CREATE TABLE IF NOT EXISTS cluster_relations (
        source_cluster_id TEXT NOT NULL,
        target_cluster_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_cluster_id, target_cluster_id),
        FOREIGN KEY (source_cluster_id) REFERENCES session_clusters(id) ON DELETE CASCADE,
        FOREIGN KEY (target_cluster_id) REFERENCES session_clusters(id) ON DELETE CASCADE
      );

      -- Session metadata cache table
      CREATE TABLE IF NOT EXISTS session_metadata_cache (
        session_id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        keywords TEXT,
        token_estimate INTEGER,
        file_patterns TEXT,
        created_at TEXT,
        last_accessed TEXT,
        access_count INTEGER DEFAULT 0
      );

      -- Memory chunks table for embeddings
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, chunk_index)
      );

      -- CLAUDE.md update history table
      CREATE TABLE IF NOT EXISTS claude_update_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        file_level TEXT NOT NULL CHECK(file_level IN ('user', 'project', 'module')),
        module_path TEXT,
        updated_at TEXT NOT NULL,
        update_source TEXT NOT NULL CHECK(update_source IN ('manual', 'cli_sync', 'dashboard', 'api')),
        git_commit_hash TEXT,
        files_changed_before_update INTEGER DEFAULT 0,
        metadata TEXT,
        UNIQUE(file_path, updated_at)
      );

      -- Indexes for efficient queries
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
      CREATE INDEX IF NOT EXISTS idx_session_clusters_status ON session_clusters(status);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_session ON cluster_members(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_metadata_type ON session_metadata_cache(session_type);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_source ON memory_chunks(source_id, source_type);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedded ON memory_chunks(embedding IS NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_claude_history_path ON claude_update_history(file_path);
      CREATE INDEX IF NOT EXISTS idx_claude_history_updated ON claude_update_history(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_claude_history_module ON claude_update_history(module_path);
    `);
  }

  /**
   * Migrate database by removing old tables, views, and triggers
   */
  private migrateDatabase(): void {
    const oldTables = ['knowledge_graph', 'knowledge_graph_edges', 'evolution_history'];

    try {
      // Disable foreign key constraints during migration
      this.db.pragma('foreign_keys = OFF');

      // Drop any triggers that might reference old tables
      const triggers = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger'`
      ).all() as { name: string }[];

      for (const trigger of triggers) {
        try {
          this.db.exec(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
        } catch (e) {
          // Ignore trigger drop errors
        }
      }

      // Drop any views that might reference old tables
      const views = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='view'`
      ).all() as { name: string }[];

      for (const view of views) {
        try {
          this.db.exec(`DROP VIEW IF EXISTS "${view.name}"`);
        } catch (e) {
          // Ignore view drop errors
        }
      }

      // Now drop the old tables
      for (const table of oldTables) {
        try {
          this.db.exec(`DROP TABLE IF EXISTS "${table}"`);
        } catch (e) {
          // Ignore if table doesn't exist
        }
      }

      // Re-enable foreign key constraints
      this.db.pragma('foreign_keys = ON');
    } catch (e) {
      // If migration fails, continue - tables may not exist
      try {
        this.db.pragma('foreign_keys = ON');
      } catch (_) {
        // Ignore
      }
    }
  }

  /**
   * Generate timestamp-based ID for core memory
   */
  private generateId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `CMEM-${year}${month}${day}-${hours}${minutes}${seconds}`;
  }

  /**
   * Generate cluster ID
   */
  generateClusterId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    // Add random 4-digit suffix to ensure uniqueness (10000 combinations)
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `CLST-${year}${month}${day}-${hours}${minutes}${seconds}${ms}${random}`;
  }

  /**
   * Upsert a core memory
   */
  upsertMemory(memory: Partial<CoreMemory> & { content: string }): CoreMemory {
    const now = new Date().toISOString();
    const id = memory.id || this.generateId();

    // Check if memory exists
    const existingMemory = this.getMemory(id);

    if (existingMemory) {
      // Update existing memory
      const stmt = this.db.prepare(`
        UPDATE memories
        SET content = ?, summary = ?, raw_output = ?, updated_at = ?, archived = ?, metadata = ?
        WHERE id = ?
      `);

      stmt.run(
        memory.content,
        memory.summary || existingMemory.summary,
        memory.raw_output || existingMemory.raw_output,
        now,
        memory.archived !== undefined ? (memory.archived ? 1 : 0) : existingMemory.archived ? 1 : 0,
        memory.metadata || existingMemory.metadata,
        id
      );

      return this.getMemory(id)!;
    } else {
      // Insert new memory
      const stmt = this.db.prepare(`
        INSERT INTO memories (id, content, summary, raw_output, created_at, updated_at, archived, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        memory.content,
        memory.summary || '',
        memory.raw_output || null,
        now,
        now,
        memory.archived ? 1 : 0,
        memory.metadata || null
      );

      return this.getMemory(id)!;
    }
  }

  /**
   * Get memory by ID
   */
  getMemory(id: string): CoreMemory | null {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      raw_output: row.raw_output,
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived: Boolean(row.archived),
      metadata: row.metadata
    };
  }

  /**
   * Get all memories
   */
  getMemories(options: { archived?: boolean; limit?: number; offset?: number } = {}): CoreMemory[] {
    const { archived = false, limit = 50, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE archived = ?
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(archived ? 1 : 0, limit, offset) as any[];
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      summary: row.summary,
      raw_output: row.raw_output,
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived: Boolean(row.archived),
      metadata: row.metadata
    }));
  }

  /**
   * Archive a memory
   */
  archiveMemory(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET archived = 1, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  /**
   * Delete a memory
   */
  deleteMemory(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    stmt.run(id);
  }

  /**
   * Generate summary for a memory using CLI tool
   */
  async generateSummary(memoryId: string, tool: 'gemini' | 'qwen' = 'gemini'): Promise<string> {
    const memory = this.getMemory(memoryId);
    if (!memory) throw new Error('Memory not found');

    // Import CLI executor
    const { executeCliTool } = await import('../tools/cli-executor.js');

    const prompt = `
PURPOSE: Generate a concise summary (2-3 sentences) of the following core memory content
TASK: Extract key architectural decisions, strategic insights, and important context
MODE: analysis
EXPECTED: Plain text summary without markdown or formatting
RULES: Be concise. Focus on high-level understanding. No technical jargon unless essential.

CONTENT:
${memory.content}
`;

    const result = await executeCliTool({
      tool,
      prompt,
      mode: 'analysis',
      timeout: 60000,
      cd: this.projectPath,
      category: 'internal'
    });

    // Use parsedOutput (extracted text from stream JSON) instead of raw stdout
    const summary = result.parsedOutput?.trim() || result.stdout?.trim() || 'Failed to generate summary';

    // Update memory with summary
    const stmt = this.db.prepare(`
      UPDATE memories
      SET summary = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(summary, new Date().toISOString(), memoryId);

    return summary;
  }

  /**
   * Create a new session cluster
   */
  createCluster(cluster: Partial<SessionCluster> & { name: string }): SessionCluster {
    const now = new Date().toISOString();
    const id = cluster.id || this.generateClusterId();

    const stmt = this.db.prepare(`
      INSERT INTO session_clusters (id, name, description, intent, created_at, updated_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      cluster.name,
      cluster.description || null,
      cluster.intent || null,
      now,
      now,
      cluster.status || 'active',
      cluster.metadata || null
    );

    return this.getCluster(id)!;
  }

  /**
   * Get cluster by ID
   */
  getCluster(id: string): SessionCluster | null {
    const stmt = this.db.prepare(`SELECT * FROM session_clusters WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      intent: row.intent,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status,
      metadata: row.metadata
    };
  }

  /**
   * List all clusters
   */
  listClusters(status?: string): SessionCluster[] {
    let query = 'SELECT * FROM session_clusters';
    const params: any[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      intent: row.intent,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status,
      metadata: row.metadata
    }));
  }

  /**
   * Update cluster
   */
  updateCluster(id: string, updates: Partial<SessionCluster>): SessionCluster | null {
    const existing = this.getCluster(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE session_clusters
      SET name = ?, description = ?, intent = ?, updated_at = ?, status = ?, metadata = ?
      WHERE id = ?
    `);

    stmt.run(
      updates.name || existing.name,
      updates.description !== undefined ? updates.description : existing.description,
      updates.intent !== undefined ? updates.intent : existing.intent,
      now,
      updates.status || existing.status,
      updates.metadata !== undefined ? updates.metadata : existing.metadata,
      id
    );

    return this.getCluster(id);
  }

  /**
   * Delete cluster
   */
  deleteCluster(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM session_clusters WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Merge multiple clusters into one
   * Keeps the first cluster and moves all members from others into it
   * @param targetClusterId The cluster to keep
   * @param sourceClusterIds The clusters to merge into target (will be deleted)
   * @returns Number of members moved
   */
  mergeClusters(targetClusterId: string, sourceClusterIds: string[]): number {
    const targetCluster = this.getCluster(targetClusterId);
    if (!targetCluster) {
      throw new Error(`Target cluster not found: ${targetClusterId}`);
    }

    let membersMoved = 0;
    const existingMembers = new Set(
      this.getClusterMembers(targetClusterId).map(m => m.session_id)
    );

    for (const sourceId of sourceClusterIds) {
      if (sourceId === targetClusterId) continue;

      const sourceMembers = this.getClusterMembers(sourceId);
      const maxOrder = this.getClusterMembers(targetClusterId).length;

      for (const member of sourceMembers) {
        // Skip if already exists in target
        if (existingMembers.has(member.session_id)) continue;

        // Move member to target cluster
        this.addClusterMember({
          cluster_id: targetClusterId,
          session_id: member.session_id,
          session_type: member.session_type,
          sequence_order: maxOrder + membersMoved + 1,
          relevance_score: member.relevance_score
        });

        existingMembers.add(member.session_id);
        membersMoved++;
      }

      // Delete source cluster
      this.deleteCluster(sourceId);
    }

    // Update target cluster description
    const finalMembers = this.getClusterMembers(targetClusterId);
    this.updateCluster(targetClusterId, {
      description: `Merged cluster with ${finalMembers.length} sessions`
    });

    return membersMoved;
  }

  /**
   * Add member to cluster
   */
  addClusterMember(member: Omit<ClusterMember, 'added_at'>): ClusterMember {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO cluster_members (cluster_id, session_id, session_type, sequence_order, added_at, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      member.cluster_id,
      member.session_id,
      member.session_type,
      member.sequence_order,
      now,
      member.relevance_score
    );

    return {
      ...member,
      added_at: now
    };
  }

  /**
   * Remove member from cluster
   */
  removeClusterMember(clusterId: string, sessionId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM cluster_members
      WHERE cluster_id = ? AND session_id = ?
    `);
    const result = stmt.run(clusterId, sessionId);
    return result.changes > 0;
  }

  /**
   * Get all members of a cluster
   */
  getClusterMembers(clusterId: string): ClusterMember[] {
    const stmt = this.db.prepare(`
      SELECT * FROM cluster_members
      WHERE cluster_id = ?
      ORDER BY sequence_order ASC
    `);

    const rows = stmt.all(clusterId) as any[];
    return rows.map(row => ({
      cluster_id: row.cluster_id,
      session_id: row.session_id,
      session_type: row.session_type,
      sequence_order: row.sequence_order,
      added_at: row.added_at,
      relevance_score: row.relevance_score
    }));
  }

  /**
   * Get all clusters that contain a session
   */
  getSessionClusters(sessionId: string): SessionCluster[] {
    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM session_clusters sc
      INNER JOIN cluster_members cm ON sc.id = cm.cluster_id
      WHERE cm.session_id = ?
      ORDER BY sc.updated_at DESC
    `);

    const rows = stmt.all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      intent: row.intent,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status,
      metadata: row.metadata
    }));
  }

  /**
   * Add relation between clusters
   */
  addClusterRelation(relation: Omit<ClusterRelation, 'created_at'>): ClusterRelation {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO cluster_relations (source_cluster_id, target_cluster_id, relation_type, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      relation.source_cluster_id,
      relation.target_cluster_id,
      relation.relation_type,
      now
    );

    return {
      ...relation,
      created_at: now
    };
  }

  /**
   * Remove relation between clusters
   */
  removeClusterRelation(sourceId: string, targetId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM cluster_relations
      WHERE source_cluster_id = ? AND target_cluster_id = ?
    `);
    const result = stmt.run(sourceId, targetId);
    return result.changes > 0;
  }

  /**
   * Get all relations for a cluster
   */
  getClusterRelations(clusterId: string): ClusterRelation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM cluster_relations
      WHERE source_cluster_id = ? OR target_cluster_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(clusterId, clusterId) as any[];
    return rows.map(row => ({
      source_cluster_id: row.source_cluster_id,
      target_cluster_id: row.target_cluster_id,
      relation_type: row.relation_type,
      created_at: row.created_at
    }));
  }

  /**
   * Upsert session metadata
   */
  upsertSessionMetadata(metadata: SessionMetadataCache): SessionMetadataCache {
    const now = new Date().toISOString();

    const existing = this.getSessionMetadata(metadata.session_id);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE session_metadata_cache
        SET session_type = ?, title = ?, summary = ?, keywords = ?, token_estimate = ?,
            file_patterns = ?, last_accessed = ?, access_count = ?
        WHERE session_id = ?
      `);

      stmt.run(
        metadata.session_type,
        metadata.title || null,
        metadata.summary || null,
        metadata.keywords ? JSON.stringify(metadata.keywords) : null,
        metadata.token_estimate || null,
        metadata.file_patterns ? JSON.stringify(metadata.file_patterns) : null,
        now,
        existing.access_count + 1,
        metadata.session_id
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO session_metadata_cache
        (session_id, session_type, title, summary, keywords, token_estimate, file_patterns, created_at, last_accessed, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        metadata.session_id,
        metadata.session_type,
        metadata.title || null,
        metadata.summary || null,
        metadata.keywords ? JSON.stringify(metadata.keywords) : null,
        metadata.token_estimate || null,
        metadata.file_patterns ? JSON.stringify(metadata.file_patterns) : null,
        metadata.created_at || now,
        now,
        metadata.access_count || 1
      );
    }

    return this.getSessionMetadata(metadata.session_id)!;
  }

  /**
   * Get session metadata
   */
  getSessionMetadata(sessionId: string): SessionMetadataCache | null {
    const stmt = this.db.prepare(`SELECT * FROM session_metadata_cache WHERE session_id = ?`);
    const row = stmt.get(sessionId) as any;
    if (!row) return null;

    return {
      session_id: row.session_id,
      session_type: row.session_type,
      title: row.title,
      summary: row.summary,
      keywords: row.keywords ? JSON.parse(row.keywords) : undefined,
      token_estimate: row.token_estimate,
      file_patterns: row.file_patterns ? JSON.parse(row.file_patterns) : undefined,
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      access_count: row.access_count
    };
  }

  /**
   * Search sessions by keyword
   */
  searchSessionsByKeyword(keyword: string): SessionMetadataCache[] {
    const stmt = this.db.prepare(`
      SELECT * FROM session_metadata_cache
      WHERE title LIKE ? OR summary LIKE ? OR keywords LIKE ?
      ORDER BY access_count DESC, last_accessed DESC
    `);

    const pattern = `%${keyword}%`;
    const rows = stmt.all(pattern, pattern, pattern) as any[];

    return rows.map(row => ({
      session_id: row.session_id,
      session_type: row.session_type,
      title: row.title,
      summary: row.summary,
      keywords: row.keywords ? JSON.parse(row.keywords) : undefined,
      token_estimate: row.token_estimate,
      file_patterns: row.file_patterns ? JSON.parse(row.file_patterns) : undefined,
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      access_count: row.access_count
    }));
  }

  // ============================================================================
  // Memory Chunks CRUD Operations
  // ============================================================================

  /**
   * Chunk content into smaller pieces for embedding
   * @param content Content to chunk
   * @param sourceId Source identifier (e.g., memory ID)
   * @param sourceType Type of source
   * @returns Array of chunk content strings
   */
  chunkContent(content: string, sourceId: string, sourceType: string): string[] {
    const CHUNK_SIZE = 1500;
    const OVERLAP = 200;
    const chunks: string[] = [];

    // Split by paragraph boundaries first
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // If adding this paragraph would exceed chunk size
      if (currentChunk.length + paragraph.length > CHUNK_SIZE && currentChunk.length > 0) {
        // Save current chunk
        chunks.push(currentChunk.trim());

        // Start new chunk with overlap
        const overlapText = currentChunk.slice(-OVERLAP);
        currentChunk = overlapText + '\n\n' + paragraph;
      } else {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // If no paragraphs or chunks are still too large, split by sentences
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= CHUNK_SIZE) {
        finalChunks.push(chunk);
      } else {
        // Split by sentence boundaries
        const sentences = chunk.split(/\. +/);
        let sentenceChunk = '';

        for (const sentence of sentences) {
          const sentenceWithPeriod = sentence + '. ';
          if (sentenceChunk.length + sentenceWithPeriod.length > CHUNK_SIZE && sentenceChunk.length > 0) {
            finalChunks.push(sentenceChunk.trim());
            const overlapText = sentenceChunk.slice(-OVERLAP);
            sentenceChunk = overlapText + sentenceWithPeriod;
          } else {
            sentenceChunk += sentenceWithPeriod;
          }
        }

        if (sentenceChunk.trim()) {
          finalChunks.push(sentenceChunk.trim());
        }
      }
    }

    return finalChunks.length > 0 ? finalChunks : [content];
  }

  /**
   * Insert a single chunk
   */
  insertChunk(chunk: Omit<MemoryChunk, 'id'>): number {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO memory_chunks (source_id, source_type, chunk_index, content, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      chunk.source_id,
      chunk.source_type,
      chunk.chunk_index,
      chunk.content,
      chunk.embedding || null,
      chunk.metadata || null,
      chunk.created_at || now
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Insert multiple chunks in a batch
   */
  insertChunksBatch(chunks: Omit<MemoryChunk, 'id'>[]): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO memory_chunks (source_id, source_type, chunk_index, content, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((chunks: Omit<MemoryChunk, 'id'>[]) => {
      for (const chunk of chunks) {
        insert.run(
          chunk.source_id,
          chunk.source_type,
          chunk.chunk_index,
          chunk.content,
          chunk.embedding || null,
          chunk.metadata || null,
          chunk.created_at || now
        );
      }
    });

    transaction(chunks);
  }

  /**
   * Get all chunks for a source
   */
  getChunks(sourceId: string): MemoryChunk[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_chunks
      WHERE source_id = ?
      ORDER BY chunk_index ASC
    `);

    const rows = stmt.all(sourceId) as any[];
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      source_type: row.source_type,
      chunk_index: row.chunk_index,
      content: row.content,
      embedding: row.embedding,
      metadata: row.metadata,
      created_at: row.created_at
    }));
  }

  /**
   * Get chunks by source type
   */
  getChunksByType(sourceType: string): MemoryChunk[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_chunks
      WHERE source_type = ?
      ORDER BY source_id, chunk_index ASC
    `);

    const rows = stmt.all(sourceType) as any[];
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      source_type: row.source_type,
      chunk_index: row.chunk_index,
      content: row.content,
      embedding: row.embedding,
      metadata: row.metadata,
      created_at: row.created_at
    }));
  }

  /**
   * Get chunks without embeddings
   */
  getUnembeddedChunks(limit?: number): MemoryChunk[] {
    const query = `
      SELECT * FROM memory_chunks
      WHERE embedding IS NULL
      ORDER BY created_at ASC
      ${limit ? 'LIMIT ?' : ''}
    `;

    const stmt = this.db.prepare(query);
    const rows = (limit ? stmt.all(limit) : stmt.all()) as any[];

    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      source_type: row.source_type,
      chunk_index: row.chunk_index,
      content: row.content,
      embedding: row.embedding,
      metadata: row.metadata,
      created_at: row.created_at
    }));
  }

  /**
   * Update embedding for a chunk
   */
  updateChunkEmbedding(chunkId: number, embedding: Buffer): void {
    const stmt = this.db.prepare(`
      UPDATE memory_chunks
      SET embedding = ?
      WHERE id = ?
    `);

    stmt.run(embedding, chunkId);
  }

  /**
   * Update embeddings for multiple chunks in a batch
   */
  updateChunkEmbeddingsBatch(updates: { id: number; embedding: Buffer }[]): void {
    const update = this.db.prepare(`
      UPDATE memory_chunks
      SET embedding = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((updates: { id: number; embedding: Buffer }[]) => {
      for (const { id, embedding } of updates) {
        update.run(embedding, id);
      }
    });

    transaction(updates);
  }

  /**
   * Delete all chunks for a source
   */
  deleteChunks(sourceId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM memory_chunks
      WHERE source_id = ?
    `);

    stmt.run(sourceId);
  }

  // ============================================================================
  // CLAUDE.md Update History CRUD Operations
  // ============================================================================

  /**
   * Insert a CLAUDE.md update record
   */
  insertClaudeUpdateRecord(record: Omit<ClaudeUpdateRecord, 'id'>): ClaudeUpdateRecord {
    const stmt = this.db.prepare(`
      INSERT INTO claude_update_history
      (file_path, file_level, module_path, updated_at, update_source, git_commit_hash, files_changed_before_update, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      record.file_path,
      record.file_level,
      record.module_path || null,
      record.updated_at,
      record.update_source,
      record.git_commit_hash || null,
      record.files_changed_before_update,
      record.metadata || null
    );

    return {
      id: result.lastInsertRowid as number,
      ...record
    };
  }

  /**
   * Get the last update record for a file
   */
  getLastClaudeUpdate(filePath: string): ClaudeUpdateRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM claude_update_history
      WHERE file_path = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    const row = stmt.get(filePath) as any;
    if (!row) return null;

    return {
      id: row.id,
      file_path: row.file_path,
      file_level: row.file_level,
      module_path: row.module_path,
      updated_at: row.updated_at,
      update_source: row.update_source,
      git_commit_hash: row.git_commit_hash,
      files_changed_before_update: row.files_changed_before_update,
      metadata: row.metadata
    };
  }

  /**
   * Get update history for a file
   */
  getClaudeUpdateHistory(filePath: string, limit: number = 50): ClaudeUpdateRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM claude_update_history
      WHERE file_path = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(filePath, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      file_path: row.file_path,
      file_level: row.file_level,
      module_path: row.module_path,
      updated_at: row.updated_at,
      update_source: row.update_source,
      git_commit_hash: row.git_commit_hash,
      files_changed_before_update: row.files_changed_before_update,
      metadata: row.metadata
    }));
  }

  /**
   * Get all CLAUDE.md update records for freshness calculation
   */
  getAllClaudeUpdateRecords(): ClaudeUpdateRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM claude_update_history
      WHERE id IN (
        SELECT MAX(id) FROM claude_update_history
        GROUP BY file_path
      )
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      file_path: row.file_path,
      file_level: row.file_level,
      module_path: row.module_path,
      updated_at: row.updated_at,
      update_source: row.update_source,
      git_commit_hash: row.git_commit_hash,
      files_changed_before_update: row.files_changed_before_update,
      metadata: row.metadata
    }));
  }

  /**
   * Delete update records for a file
   */
  deleteClaudeUpdateRecords(filePath: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM claude_update_history
      WHERE file_path = ?
    `);
    const result = stmt.run(filePath);
    return result.changes;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance cache
const storeCache = new Map<string, CoreMemoryStore>();

/**
 * Get or create a store instance for a project
 */
export function getCoreMemoryStore(projectPath: string): CoreMemoryStore {
  const normalizedPath = projectPath.toLowerCase().replace(/\\/g, '/');

  if (!storeCache.has(normalizedPath)) {
    storeCache.set(normalizedPath, new CoreMemoryStore(projectPath));
  }
  return storeCache.get(normalizedPath)!;
}

// ============================================================================
// Cross-workspace management functions
// ============================================================================

import { readdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';

export interface ProjectInfo {
  id: string;
  path: string;
  memoriesCount: number;
  clustersCount: number;
  lastUpdated?: string;
}

export interface ExportedMemory {
  version: string;
  exportedAt: string;
  sourceProject: string;
  memories: CoreMemory[];
}

/**
 * Get CCW home directory
 */
function getCCWHome(): string {
  return process.env.CCW_DATA_DIR || join(homedir(), '.ccw');
}

/**
 * List all projects with their memory counts
 */
export function listAllProjects(): ProjectInfo[] {
  const projectsDir = join(getCCWHome(), 'projects');

  if (!existsSync(projectsDir)) {
    return [];
  }

  const projects: ProjectInfo[] = [];
  const entries = readdirSync(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectId = entry.name;
    const coreMemoryDb = join(projectsDir, projectId, 'core-memory', 'core_memory.db');

    let memoriesCount = 0;
    let clustersCount = 0;
    let lastUpdated: string | undefined;

    if (existsSync(coreMemoryDb)) {
      try {
        const db = new Database(coreMemoryDb, { readonly: true });

        // Count memories
        const memResult = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
        memoriesCount = memResult?.count || 0;

        // Count clusters
        try {
          const clusterResult = db.prepare('SELECT COUNT(*) as count FROM session_clusters').get() as { count: number };
          clustersCount = clusterResult?.count || 0;
        } catch {
          // Table might not exist
        }

        // Get last update time
        const lastMemory = db.prepare('SELECT MAX(updated_at) as last FROM memories').get() as { last: string };
        lastUpdated = lastMemory?.last;

        db.close();
      } catch {
        // Database might be locked or corrupted
      }
    }

    // Convert project ID back to approximate path
    const approximatePath = projectId
      .replace(/^([a-z])--/, '$1:/')  // d-- -> d:/
      .replace(/--/g, '/')
      .replace(/-/g, ' ');

    projects.push({
      id: projectId,
      path: approximatePath,
      memoriesCount,
      clustersCount,
      lastUpdated
    });
  }

  // Sort by last updated (most recent first)
  return projects.sort((a, b) => {
    if (!a.lastUpdated) return 1;
    if (!b.lastUpdated) return -1;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

/**
 * Get memories from another project by ID
 */
export function getMemoriesFromProject(projectId: string): CoreMemory[] {
  const projectsDir = join(getCCWHome(), 'projects');
  const coreMemoryDb = join(projectsDir, projectId, 'core-memory', 'core_memory.db');

  if (!existsSync(coreMemoryDb)) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const db = new Database(coreMemoryDb, { readonly: true });

  const stmt = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC');
  const rows = stmt.all() as any[];

  db.close();

  return rows.map(row => ({
    id: row.id,
    content: row.content,
    summary: row.summary || '',
    raw_output: row.raw_output,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived: Boolean(row.archived),
    metadata: row.metadata
  }));
}

/**
 * Find a memory by ID across all projects
 * Searches through all project databases to locate a specific memory
 */
export function findMemoryAcrossProjects(memoryId: string): { memory: CoreMemory; projectId: string } | null {
  const projectsDir = join(getCCWHome(), 'projects');

  if (!existsSync(projectsDir)) {
    return null;
  }

  const entries = readdirSync(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectId = entry.name;
    const coreMemoryDb = join(projectsDir, projectId, 'core-memory', 'core_memory.db');

    if (!existsSync(coreMemoryDb)) continue;

    try {
      const db = new Database(coreMemoryDb, { readonly: true });
      const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any;
      db.close();

      if (row) {
        return {
          memory: {
            id: row.id,
            content: row.content,
            summary: row.summary || '',
            raw_output: row.raw_output,
            created_at: row.created_at,
            updated_at: row.updated_at,
            archived: Boolean(row.archived),
            metadata: row.metadata
          },
          projectId
        };
      }
    } catch {
      // Database might be locked or corrupted, skip
    }
  }

  return null;
}

/**
 * Export memories to a JSON file
 */
export function exportMemories(
  projectPath: string,
  outputPath: string,
  options?: { ids?: string[]; includeArchived?: boolean }
): number {
  const store = getCoreMemoryStore(projectPath);
  let memories = store.getMemories({ archived: options?.includeArchived || false, limit: 10000 });

  // Filter by IDs if specified
  if (options?.ids && options.ids.length > 0) {
    const idSet = new Set(options.ids);
    memories = memories.filter(m => idSet.has(m.id));
  }

  const exportData: ExportedMemory = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    sourceProject: projectPath,
    memories
  };

  writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
  return memories.length;
}

/**
 * Import memories from a JSON file or another project
 */
export function importMemories(
  targetProjectPath: string,
  source: string,  // File path or project ID
  options?: { overwrite?: boolean; prefix?: string }
): { imported: number; skipped: number } {
  const store = getCoreMemoryStore(targetProjectPath);
  let memories: CoreMemory[];

  // Check if source is a file or project ID
  if (existsSync(source) && source.endsWith('.json')) {
    // Import from file
    const content = readFileSync(source, 'utf-8');
    const data = JSON.parse(content) as ExportedMemory;
    memories = data.memories;
  } else {
    // Import from project ID
    memories = getMemoriesFromProject(source);
  }

  let imported = 0;
  let skipped = 0;

  for (const memory of memories) {
    // Generate new ID with optional prefix
    let newId = memory.id;
    if (options?.prefix) {
      newId = `${options.prefix}-${memory.id}`;
    }

    // Check if already exists
    const existing = store.getMemory(newId);
    if (existing && !options?.overwrite) {
      skipped++;
      continue;
    }

    // Import memory
    store.upsertMemory({
      id: newId,
      content: memory.content,
      summary: memory.summary,
      raw_output: memory.raw_output,
      metadata: memory.metadata
    });

    imported++;
  }

  return { imported, skipped };
}

/**
 * Close all store instances
 */
export function closeAllStores(): void {
  const stores = Array.from(storeCache.values());
  for (const store of stores) {
    store.close();
  }
  storeCache.clear();
}

export default CoreMemoryStore;
