// src/controllers/interfaces/ICodePlayground.ts

export interface ICodeSnippet {
  id: string;
  user_id?: string | null;
  name: string;
  code: string;
  language: 'javascript' | 'python' | 'html' | 'css';
  description?: string;
  is_favorite: boolean;
  tags?: string[];
  created_at: Date;
  updated_at: Date;
  last_executed_at?: Date | null;
  execution_count: number;
  shared: boolean;
  share_token?: string | null;
}

export interface ICodeExecution {
  id: string;
  snippet_id?: string | null;
  code: string;
  language: string;
  output?: string | null;
  error?: string | null;
  execution_time_ms?: number | null;
  executed_at: Date;
  success: boolean;
}

export interface ICodePlaygroundSession {
  id: string;
  user_id?: string | null;
  current_code: string;
  current_language: string;
  cursor_position?: number;
  selected_lines?: number[];
  fontSize?: number;
  is_dark_mode: boolean;
  last_updated: Date;
  session_token: string;
}

export interface CreateCodeSnippetDTO {
  name: string;
  code: string;
  language: 'javascript' | 'python' | 'html' | 'css';
  description?: string;
  tags?: string[];
  shared?: boolean;
}

export interface UpdateCodeSnippetDTO {
  name?: string;
  code?: string;
  description?: string;
  is_favorite?: boolean;
  tags?: string[];
  shared?: boolean;
}

export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTimeMs?: number;
}