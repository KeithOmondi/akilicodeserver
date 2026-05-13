// src/services/CodePlaygroundService.ts

import { query } from '../config/db';
import { 
  ICodeSnippet, 
  ICodeExecution, 
  ICodePlaygroundSession,
  CreateCodeSnippetDTO,
  UpdateCodeSnippetDTO,
  CodeExecutionResult 
} from '../interfaces/ICodePlayground';
import { v4 as uuidv4 } from 'uuid';

export class CodePlaygroundService {
  
  // ==================== Snippet CRUD Operations ====================
  
  async createSnippet(userId: string | null, data: CreateCodeSnippetDTO): Promise<ICodeSnippet> {
    const id = uuidv4();
    const result = await query(
      `INSERT INTO code_snippets (id, user_id, name, code, language, description, tags, shared)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, userId, data.name, data.code, data.language, data.description, data.tags || [], data.shared || false]
    );
    return result.rows[0];
  }

  async getSnippetById(id: string, userId?: string): Promise<ICodeSnippet | null> {
    let sql = `SELECT * FROM code_snippets WHERE id = $1`;
    const params: any[] = [id];
    
    if (userId) {
      sql += ` AND (user_id = $2 OR shared = true)`;
      params.push(userId);
    } else {
      sql += ` AND shared = true`;
    }
    
    const result = await query(sql, params);
    return result.rows[0] || null;
  }

  async getUserSnippets(userId: string, options?: { language?: string; favorite?: boolean; limit?: number; offset?: number }): Promise<ICodeSnippet[]> {
    let sql = `SELECT * FROM code_snippets WHERE user_id = $1`;
    const params: any[] = [userId];
    let paramIndex = 2;
    
    if (options?.language) {
      sql += ` AND language = $${paramIndex++}`;
      params.push(options.language);
    }
    
    if (options?.favorite !== undefined) {
      sql += ` AND is_favorite = $${paramIndex++}`;
      params.push(options.favorite);
    }
    
    sql += ` ORDER BY updated_at DESC`;
    
    if (options?.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }
    
    if (options?.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }
    
    const result = await query(sql, params);
    return result.rows;
  }

  async updateSnippet(id: string, userId: string, data: UpdateCodeSnippetDTO): Promise<ICodeSnippet | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.code !== undefined) {
      updates.push(`code = $${paramIndex++}`);
      values.push(data.code);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.is_favorite !== undefined) {
      updates.push(`is_favorite = $${paramIndex++}`);
      values.push(data.is_favorite);
    }
    if (data.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(data.tags);
    }
    if (data.shared !== undefined) {
      updates.push(`shared = $${paramIndex++}`);
      values.push(data.shared);
    }
    
    if (updates.length === 0) return null;
    
    values.push(id, userId);
    const result = await query(
      `UPDATE code_snippets 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
       RETURNING *`,
      [...values, id, userId]
    );
    
    return result.rows[0] || null;
  }

  async deleteSnippet(id: string, userId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM code_snippets WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async toggleFavorite(id: string, userId: string): Promise<ICodeSnippet | null> {
    const result = await query(
      `UPDATE code_snippets 
       SET is_favorite = NOT is_favorite, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );
    return result.rows[0] || null;
  }

  // ==================== Code Execution Operations ====================
  
  async saveExecution(
    snippetId: string | null, 
    code: string, 
    language: string, 
    result: CodeExecutionResult
  ): Promise<ICodeExecution> {
    const id = uuidv4();
    const executionResult = await query(
      `INSERT INTO code_executions (id, snippet_id, code, language, output, error, execution_time_ms, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, snippetId, code, language, result.output, result.error, result.executionTimeMs, result.success]
    );
    return executionResult.rows[0];
  }

  async getExecutionHistory(snippetId: string, limit: number = 10): Promise<ICodeExecution[]> {
    const result = await query(
      `SELECT * FROM code_executions 
       WHERE snippet_id = $1 
       ORDER BY executed_at DESC 
       LIMIT $2`,
      [snippetId, limit]
    );
    return result.rows;
  }

  // ==================== Session Management ====================
  
  async createOrUpdateSession(
    userId: string | null,
    sessionToken: string,
    data: {
      current_code: string;
      current_language: string;
      cursor_position?: number;
      selected_lines?: number[];
      font_size?: number;
      is_dark_mode?: boolean;
    }
  ): Promise<ICodePlaygroundSession> {
    const existing = await this.getSessionByToken(sessionToken);
    
    if (existing) {
      const result = await query(
        `UPDATE code_sessions 
         SET current_code = $1, 
             current_language = $2,
             cursor_position = $3,
             selected_lines = $4,
             font_size = $5,
             is_dark_mode = $6,
             user_id = $7,
             last_updated = CURRENT_TIMESTAMP
         WHERE session_token = $8
         RETURNING *`,
        [
          data.current_code,
          data.current_language,
          data.cursor_position,
          data.selected_lines,
          data.font_size || 14,
          data.is_dark_mode !== undefined ? data.is_dark_mode : true,
          userId,
          sessionToken
        ]
      );
      return result.rows[0];
    } else {
      const id = uuidv4();
      const result = await query(
        `INSERT INTO code_sessions (id, user_id, session_token, current_code, current_language, cursor_position, selected_lines, font_size, is_dark_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          userId,
          sessionToken,
          data.current_code,
          data.current_language,
          data.cursor_position,
          data.selected_lines || [],
          data.font_size || 14,
          data.is_dark_mode !== undefined ? data.is_dark_mode : true
        ]
      );
      return result.rows[0];
    }
  }

  async getSessionByToken(sessionToken: string): Promise<ICodePlaygroundSession | null> {
    const result = await query(
      `SELECT * FROM code_sessions WHERE session_token = $1`,
      [sessionToken]
    );
    return result.rows[0] || null;
  }

  async deleteSession(sessionToken: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM code_sessions WHERE session_token = $1`,
      [sessionToken]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ==================== Search & Analytics ====================
  
  async searchSnippets(userId: string, searchTerm: string): Promise<ICodeSnippet[]> {
    const result = await query(
      `SELECT * FROM code_snippets 
       WHERE user_id = $1 
         AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)
       ORDER BY updated_at DESC`,
      [userId, `%${searchTerm}%`]
    );
    return result.rows;
  }

  async getSnippetStats(userId: string): Promise<{
    total: number;
    byLanguage: Record<string, number>;
    favorites: number;
    totalExecutions: number;
  }> {
    const totalResult = await query(
      `SELECT COUNT(*) as total FROM code_snippets WHERE user_id = $1`,
      [userId]
    );
    
    const byLanguageResult = await query(
      `SELECT language, COUNT(*) as count 
       FROM code_snippets 
       WHERE user_id = $1 
       GROUP BY language`,
      [userId]
    );
    
    const favoritesResult = await query(
      `SELECT COUNT(*) as favorites FROM code_snippets WHERE user_id = $1 AND is_favorite = true`,
      [userId]
    );
    
    const executionsResult = await query(
      `SELECT SUM(execution_count) as total_executions 
       FROM code_snippets 
       WHERE user_id = $1`,
      [userId]
    );
    
    const byLanguage: Record<string, number> = {};
    byLanguageResult.rows.forEach(row => {
      byLanguage[row.language] = parseInt(row.count);
    });
    
    return {
      total: parseInt(totalResult.rows[0].total),
      byLanguage,
      favorites: parseInt(favoritesResult.rows[0].favorites),
      totalExecutions: parseInt(executionsResult.rows[0].total_executions || 0)
    };
  }

  // ==================== Share Functionality ====================
  
  async generateShareToken(snippetId: string, userId: string): Promise<string | null> {
    const shareToken = uuidv4();
    const result = await query(
      `UPDATE code_snippets 
       SET share_token = $1, shared = true
       WHERE id = $2 AND user_id = $3
       RETURNING share_token`,
      [shareToken, snippetId, userId]
    );
    return result.rows[0]?.share_token || null;
  }

  async getSharedSnippetByToken(shareToken: string): Promise<ICodeSnippet | null> {
    const result = await query(
      `SELECT * FROM code_snippets WHERE share_token = $1 AND shared = true`,
      [shareToken]
    );
    return result.rows[0] || null;
  }
}

export default new CodePlaygroundService();