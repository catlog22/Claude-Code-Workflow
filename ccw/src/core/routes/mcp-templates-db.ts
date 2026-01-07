/**
 * MCP Templates Database Module
 * Stores MCP server configurations as reusable templates
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { StoragePaths, ensureStorageDir } from '../../config/storage-paths.js';

// Database path - uses centralized storage
const DB_DIR = StoragePaths.global.databases();
const DB_PATH = StoragePaths.global.mcpTemplates();

// Ensure database directory exists
ensureStorageDir(DB_DIR);

// Initialize database connection
let db: Database.Database | null = null;

/**
 * Get or create database connection
 */
function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    initDatabase();
  }
  return db;
}

/**
 * Initialize database schema
 */
function initDatabase() {
  const db = getDb();
  
  // Create templates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      server_config TEXT NOT NULL,
      tags TEXT,
      category TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  
  // Create index on name for fast lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mcp_templates_name 
    ON mcp_templates(name)
  `);
  
  // Create index on category for filtering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mcp_templates_category 
    ON mcp_templates(category)
  `);
}

export interface McpTemplate {
  id?: number;
  name: string;
  description?: string;
  serverConfig: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  tags?: string[];
  category?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Save MCP template to database
 */
export function saveTemplate(template: McpTemplate): { success: boolean; id?: number; error?: string } {
  try {
    const db = getDb();
    const now = Date.now();
    
    const stmt = db.prepare(`
      INSERT INTO mcp_templates (name, description, server_config, tags, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        server_config = excluded.server_config,
        tags = excluded.tags,
        category = excluded.category,
        updated_at = excluded.updated_at
    `);
    
    const result = stmt.run(
      template.name,
      template.description || null,
      JSON.stringify(template.serverConfig),
      template.tags ? JSON.stringify(template.tags) : null,
      template.category || null,
      template.createdAt || now,
      now
    );
    
    return {
      success: true,
      id: result.lastInsertRowid as number
    };
  } catch (error: unknown) {
    console.error('Error saving MCP template:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Get all MCP templates
 */
export function getAllTemplates(): McpTemplate[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM mcp_templates ORDER BY name').all();
    
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      serverConfig: JSON.parse(row.server_config),
      tags: row.tags ? JSON.parse(row.tags) : [],
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error: unknown) {
    console.error('Error getting MCP templates:', error);
    return [];
  }
}

/**
 * Get template by name
 */
export function getTemplateByName(name: string): McpTemplate | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM mcp_templates WHERE name = ?').get(name);
    
    if (!row) return null;
    
    return {
      id: (row as any).id,
      name: (row as any).name,
      description: (row as any).description,
      serverConfig: JSON.parse((row as any).server_config),
      tags: (row as any).tags ? JSON.parse((row as any).tags) : [],
      category: (row as any).category,
      createdAt: (row as any).created_at,
      updatedAt: (row as any).updated_at
    };
  } catch (error: unknown) {
    console.error('Error getting MCP template:', error);
    return null;
  }
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: string): McpTemplate[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM mcp_templates WHERE category = ? ORDER BY name').all(category);
    
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      serverConfig: JSON.parse(row.server_config),
      tags: row.tags ? JSON.parse(row.tags) : [],
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error: unknown) {
    console.error('Error getting MCP templates by category:', error);
    return [];
  }
}

/**
 * Delete template by name
 */
export function deleteTemplate(name: string): { success: boolean; error?: string } {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM mcp_templates WHERE name = ?').run(name);
    
    return {
      success: result.changes > 0
    };
  } catch (error: unknown) {
    console.error('Error deleting MCP template:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Search templates by keyword
 */
export function searchTemplates(keyword: string): McpTemplate[] {
  try {
    const db = getDb();
    const searchPattern = `%${keyword}%`;
    const rows = db.prepare(`
      SELECT * FROM mcp_templates 
      WHERE name LIKE ? OR description LIKE ? OR tags LIKE ?
      ORDER BY name
    `).all(searchPattern, searchPattern, searchPattern);
    
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      serverConfig: JSON.parse(row.server_config),
      tags: row.tags ? JSON.parse(row.tags) : [],
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error: unknown) {
    console.error('Error searching MCP templates:', error);
    return [];
  }
}

/**
 * Get all categories
 */
export function getAllCategories(): string[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT category FROM mcp_templates WHERE category IS NOT NULL ORDER BY category').all();
    return rows.map((row: any) => row.category);
  } catch (error: unknown) {
    console.error('Error getting categories:', error);
    return [];
  }
}

/**
 * Close database connection
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
