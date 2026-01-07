/**
 * CLI Prompt Builder
 * Prompt concatenation + multi-turn formatting helpers
 */

import type { ConversationRecord, ConversationTurn } from './cli-executor-state.js';

// Prompt concatenation format types
export type PromptFormat = 'plain' | 'yaml' | 'json';

/**
 * Merge multiple conversations into a unified context
 * Returns merged turns sorted by timestamp with source tracking
 */
export interface MergedTurn extends ConversationTurn {
  source_id: string; // Original conversation ID
}

export interface MergeResult {
  mergedTurns: MergedTurn[];
  sourceConversations: ConversationRecord[];
  totalDuration: number;
}

export function mergeConversations(conversations: ConversationRecord[]): MergeResult {
  const mergedTurns: MergedTurn[] = [];

  // Collect all turns with source tracking
  for (const conv of conversations) {
    for (const turn of conv.turns) {
      mergedTurns.push({
        ...turn,
        source_id: conv.id
      });
    }
  }

  // Sort by timestamp
  mergedTurns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Re-number turns
  mergedTurns.forEach((turn, idx) => {
    turn.turn = idx + 1;
  });

  // Calculate total duration
  const totalDuration = mergedTurns.reduce((sum, t) => sum + t.duration_ms, 0);

  return {
    mergedTurns,
    sourceConversations: conversations,
    totalDuration
  };
}

/**
 * Build prompt from merged conversations
 */
export function buildMergedPrompt(
  mergeResult: MergeResult,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  const concatenator = createPromptConcatenator({ format });

  // Set metadata for merged conversations
  concatenator.setMetadata(
    'merged_sources',
    mergeResult.sourceConversations.map(c => c.id).join(', ')
  );

  // Add all merged turns with source tracking
  for (const turn of mergeResult.mergedTurns) {
    concatenator.addFromConversationTurn(turn, turn.source_id);
  }

  return concatenator.build(newPrompt);
}

/**
 * Turn data structure for concatenation
 */
interface TurnData {
  turn: number;
  timestamp?: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  duration_ms?: number;
  source_id?: string; // For merged conversations
}

/**
 * Prompt concatenation options
 */
export interface ConcatOptions {
  format: PromptFormat;
  includeMetadata?: boolean;
  includeTurnMarkers?: boolean;
  maxOutputLength?: number; // Truncate output for context efficiency
}

/**
 * PromptConcatenator - Dedicated class for building multi-turn prompts
 * Supports multiple output formats: plain text, YAML, JSON
 */
export class PromptConcatenator {
  private turns: TurnData[] = [];
  private options: ConcatOptions;
  private metadata: Record<string, unknown> = {};

  constructor(options: Partial<ConcatOptions> = {}) {
    this.options = {
      format: options.format || 'plain',
      includeMetadata: options.includeMetadata ?? true,
      includeTurnMarkers: options.includeTurnMarkers ?? true,
      maxOutputLength: options.maxOutputLength || 8192
    };
  }

  /**
   * Set metadata for the conversation
   */
  setMetadata(key: string, value: unknown): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Add a user turn
   */
  addUserTurn(content: string, options: Partial<Omit<TurnData, 'role' | 'content'>> = {}): this {
    this.turns.push({
      turn: this.turns.length + 1,
      role: 'user',
      content,
      ...options
    });
    return this;
  }

  /**
   * Add an assistant turn
   */
  addAssistantTurn(content: string, options: Partial<Omit<TurnData, 'role' | 'content'>> = {}): this {
    // Truncate output if needed
    const truncatedContent = content.length > this.options.maxOutputLength!
      ? content.substring(0, this.options.maxOutputLength!) + '\n... [truncated]'
      : content;

    this.turns.push({
      turn: this.turns.length + 1,
      role: 'assistant',
      content: truncatedContent,
      ...options
    });
    return this;
  }

  /**
   * Add a conversation turn from ConversationTurn
   */
  addFromConversationTurn(turn: ConversationTurn, sourceId?: string): this {
    this.addUserTurn(turn.prompt, {
      turn: turn.turn * 2 - 1,
      timestamp: turn.timestamp,
      source_id: sourceId
    });
    this.addAssistantTurn(turn.output.stdout || '[No output]', {
      turn: turn.turn * 2,
      timestamp: turn.timestamp,
      status: turn.status,
      duration_ms: turn.duration_ms,
      source_id: sourceId
    });
    return this;
  }

  /**
   * Load turns from an existing conversation
   */
  loadConversation(conversation: ConversationRecord): this {
    for (const turn of conversation.turns) {
      this.addFromConversationTurn(turn);
    }
    return this;
  }

  /**
   * Build the final prompt in plain text format
   */
  private buildPlainText(newPrompt: string): string {
    const parts: string[] = [];

    // Metadata section
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      parts.push('=== CONTEXT ===');
      for (const [key, value] of Object.entries(this.metadata)) {
        parts.push(`${key}: ${String(value)}`);
      }
      parts.push('');
    }

    // Conversation history
    if (this.turns.length > 0) {
      parts.push('=== CONVERSATION HISTORY ===');
      parts.push('');

      let currentTurn = 0;
      for (let i = 0; i < this.turns.length; i += 2) {
        currentTurn++;
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        if (this.options.includeTurnMarkers) {
          const sourceMarker = userTurn.source_id ? ` [${userTurn.source_id}]` : '';
          parts.push(`--- Turn ${currentTurn}${sourceMarker} ---`);
        }

        parts.push('USER:');
        parts.push(userTurn.content);
        parts.push('');

        if (assistantTurn) {
          parts.push('ASSISTANT:');
          parts.push(assistantTurn.content);
          parts.push('');
        }
      }
    }

    // New request
    parts.push('=== NEW REQUEST ===');
    parts.push('');
    parts.push(newPrompt);

    return parts.join('\n');
  }

  /**
   * Build the final prompt in YAML format
   */
  private buildYaml(newPrompt: string): string {
    const yamlLines: string[] = [];

    // Metadata
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      yamlLines.push('context:');
      for (const [key, value] of Object.entries(this.metadata)) {
        yamlLines.push(`  ${key}: ${this.yamlValue(value)}`);
      }
      yamlLines.push('');
    }

    // Conversation history
    if (this.turns.length > 0) {
      yamlLines.push('conversation:');

      let currentTurn = 0;
      for (let i = 0; i < this.turns.length; i += 2) {
        currentTurn++;
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        yamlLines.push(`  - turn: ${currentTurn}`);
        if (userTurn.source_id) {
          yamlLines.push(`    source: ${userTurn.source_id}`);
        }
        if (userTurn.timestamp) {
          yamlLines.push(`    timestamp: ${userTurn.timestamp}`);
        }

        // User message
        yamlLines.push('    user: |');
        const userLines = userTurn.content.split('\n');
        for (const line of userLines) {
          yamlLines.push(`      ${line}`);
        }

        // Assistant message
        if (assistantTurn) {
          if (assistantTurn.status) {
            yamlLines.push(`    status: ${assistantTurn.status}`);
          }
          if (assistantTurn.duration_ms) {
            yamlLines.push(`    duration_ms: ${assistantTurn.duration_ms}`);
          }
          yamlLines.push('    assistant: |');
          const assistantLines = assistantTurn.content.split('\n');
          for (const line of assistantLines) {
            yamlLines.push(`      ${line}`);
          }
        }
        yamlLines.push('');
      }
    }

    // New request
    yamlLines.push('new_request: |');
    const requestLines = newPrompt.split('\n');
    for (const line of requestLines) {
      yamlLines.push(`  ${line}`);
    }

    return yamlLines.join('\n');
  }

  /**
   * Build the final prompt in JSON format
   */
  private buildJson(newPrompt: string): string {
    const data: Record<string, unknown> = {};

    // Metadata
    if (this.options.includeMetadata && Object.keys(this.metadata).length > 0) {
      data.context = this.metadata;
    }

    // Conversation history
    if (this.turns.length > 0) {
      const conversation: Array<{
        turn: number;
        source?: string;
        timestamp?: string;
        user: string;
        assistant?: string;
        status?: string;
        duration_ms?: number;
      }> = [];

      for (let i = 0; i < this.turns.length; i += 2) {
        const userTurn = this.turns[i];
        const assistantTurn = this.turns[i + 1];

        const turnData: typeof conversation[0] = {
          turn: Math.ceil((i + 1) / 2),
          user: userTurn.content
        };

        if (userTurn.source_id) turnData.source = userTurn.source_id;
        if (userTurn.timestamp) turnData.timestamp = userTurn.timestamp;
        if (assistantTurn) {
          turnData.assistant = assistantTurn.content;
          if (assistantTurn.status) turnData.status = assistantTurn.status;
          if (assistantTurn.duration_ms) turnData.duration_ms = assistantTurn.duration_ms;
        }

        conversation.push(turnData);
      }

      data.conversation = conversation;
    }

    data.new_request = newPrompt;

    return JSON.stringify(data, null, 2);
  }

  /**
   * Helper to format YAML values
   */
  private yamlValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings that might be interpreted as other types
      if (/[:\[\]{}#&*!|>'"@`]/.test(value) || value === '') {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  /**
   * Build the final prompt string
   */
  build(newPrompt: string): string {
    switch (this.options.format) {
      case 'yaml':
        return this.buildYaml(newPrompt);
      case 'json':
        return this.buildJson(newPrompt);
      case 'plain':
      default:
        return this.buildPlainText(newPrompt);
    }
  }

  /**
   * Reset the concatenator for reuse
   */
  reset(): this {
    this.turns = [];
    this.metadata = {};
    return this;
  }
}

/**
 * Create a prompt concatenator with specified options
 */
export function createPromptConcatenator(options?: Partial<ConcatOptions>): PromptConcatenator {
  return new PromptConcatenator(options);
}

/**
 * Quick helper to build a multi-turn prompt in any format
 */
export function buildPrompt(
  conversation: ConversationRecord,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  return createPromptConcatenator({ format })
    .loadConversation(conversation)
    .build(newPrompt);
}

/**
 * Build multi-turn prompt with full conversation history
 * Uses the PromptConcatenator with plain text format by default
 */
export function buildMultiTurnPrompt(
  conversation: ConversationRecord,
  newPrompt: string,
  format: PromptFormat = 'plain'
): string {
  return buildPrompt(conversation, newPrompt, format);
}
