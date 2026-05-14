// src/services/auditService.ts
import { query } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogEntry {
  id: string;
  action: string;
  user_id: string;
  details: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

/**
 * Log an audit trail entry for compliance and security monitoring
 * Required for COPPA compliance to track parent/child account actions
 */
export async function auditLog(
  action: string,
  userId: string,
  details?: Record<string, any>,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    const queryText = `
      INSERT INTO audit_logs (id, action, user_id, details, ip_address, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    await query(queryText, [
      uuidv4(),
      action,
      userId,
      details ? JSON.stringify(details) : null,
      ipAddress || null,
      userAgent || null,
      new Date()
    ]);
  } catch (error) {
    // Log to console but don't throw - audit logging should not break the main flow
    console.error('[AuditService] Failed to write audit log:', error);
  }
}

/**
 * Retrieve audit logs for a specific user (admin only typically)
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<AuditLogEntry[]> {
  const queryText = `
    SELECT * FROM audit_logs 
    WHERE user_id = $1 
    ORDER BY created_at DESC 
    LIMIT $2 OFFSET $3
  `;
  
  const result = await query(queryText, [userId, limit, offset]);
  return result.rows;
}

/**
 * Retrieve audit logs by action type
 */
export async function getAuditLogsByAction(
  action: string,
  limit: number = 100,
  offset: number = 0
): Promise<AuditLogEntry[]> {
  const queryText = `
    SELECT * FROM audit_logs 
    WHERE action = $1 
    ORDER BY created_at DESC 
    LIMIT $2 OFFSET $3
  `;
  
  const result = await query(queryText, [action, limit, offset]);
  return result.rows;
}

/**
 * Get all audit logs (admin only)
 */
export async function getAllAuditLogs(
  limit: number = 100,
  offset: number = 0
): Promise<AuditLogEntry[]> {
  const queryText = `
    SELECT * FROM audit_logs 
    ORDER BY created_at DESC 
    LIMIT $1 OFFSET $2
  `;
  
  const result = await query(queryText, [limit, offset]);
  return result.rows;
}

/**
 * Get audit logs within a date range
 */
export async function getAuditLogsByDateRange(
  startDate: Date,
  endDate: Date,
  limit: number = 1000
): Promise<AuditLogEntry[]> {
  const queryText = `
    SELECT * FROM audit_logs 
    WHERE created_at BETWEEN $1 AND $2 
    ORDER BY created_at DESC 
    LIMIT $3
  `;
  
  const result = await query(queryText, [startDate, endDate, limit]);
  return result.rows;
}

/**
 * Clean up old audit logs (e.g., keep last 90 days for compliance)
 */
export async function cleanupOldAuditLogs(daysToKeep: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const queryText = 'DELETE FROM audit_logs WHERE created_at < $1 RETURNING id';
  const result = await query(queryText, [cutoffDate]);
  return result.rowCount || 0;
}