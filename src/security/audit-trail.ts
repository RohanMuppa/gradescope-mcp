/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * PII-free security event audit trail with auto-rotation.
 * Records security events (login, logout, session expiry, abuse triggers) with zero PII.
 * Audit trail contains only event type, timestamp, and error code.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { log } from '../utils/logger.js';

/**
 * Security event types.
 * All events recorded are security-relevant actions with zero PII.
 */
export type SecurityEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'SESSION_EXPIRED'
  | 'SESSION_TAMPERED'
  | 'ABUSE_DETECTED'
  | 'ABUSE_COOLDOWN_EXPIRED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'TLS_VIOLATION';

/**
 * Audit trail entry.
 * ZERO PII - only event type, timestamp, and optional error code.
 */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Security event type */
  event: SecurityEvent;
  /** Optional error code for failure events */
  code?: string;
}

/**
 * Audit trail retention period: 7 days in milliseconds.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * AuditTrail class provides PII-free security event logging.
 * Events are appended to JSONL file with 0600 permissions.
 * Auto-rotates at 7-day retention.
 */
export class AuditTrail {
  private readonly auditFilePath: string;
  private readonly sessionDir: string;

  constructor(sessionDir?: string) {
    // Default to ~/.gradescope-session
    this.sessionDir = sessionDir || path.join(os.homedir(), '.gradescope-session');
    this.auditFilePath = path.join(this.sessionDir, 'security-audit.jsonl');
  }

  /**
   * Record a security event to audit trail.
   * Appends JSONL entry with timestamp, event type, and optional error code.
   * File permissions set to 0600 (owner read/write only).
   *
   * @param event - Security event type
   * @param code - Optional error code (e.g., GSMCP-9020)
   */
  async record(event: SecurityEvent, code?: string): Promise<void> {
    try {
      // Ensure session directory exists with secure permissions
      await fs.mkdir(this.sessionDir, { recursive: true, mode: 0o700 });

      // Create audit entry
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        event,
        ...(code && { code })
      };

      // Append JSONL entry
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.auditFilePath, line, { mode: 0o600 });

      log('DEBUG', `Audit: ${event}${code ? ` (${code})` : ''}`);
    } catch (error) {
      // Log error but don't throw - audit failures shouldn't break application flow
      log('WARN', 'Failed to record audit event', error);
    }
  }

  /**
   * Rotate audit trail by removing entries older than retention period.
   * Reads all entries, filters out expired ones, and rewrites file.
   * Called at server startup.
   */
  async rotate(): Promise<void> {
    try {
      // Check if audit file exists
      try {
        await fs.access(this.auditFilePath);
      } catch {
        // File doesn't exist yet, nothing to rotate
        log('DEBUG', 'No audit file to rotate');
        return;
      }

      // Read all entries
      const entries = await this.getEvents();

      // Filter events within retention period
      const retentionCutoff = Date.now() - RETENTION_MS;
      const retained = entries.filter(entry => {
        const timestamp = new Date(entry.timestamp).getTime();
        return timestamp > retentionCutoff;
      });

      // If no changes, skip rewrite
      if (retained.length === entries.length) {
        log('DEBUG', `Audit rotation: all ${entries.length} entries within retention period`);
        return;
      }

      // Rewrite file with retained entries
      const lines = retained.map(entry => JSON.stringify(entry)).join('\n');
      await fs.writeFile(this.auditFilePath, lines ? lines + '\n' : '', { mode: 0o600 });

      const removed = entries.length - retained.length;
      log('INFO', `Audit rotation: removed ${removed} entries, retained ${retained.length}`);
    } catch (error) {
      // Log error but don't throw - rotation failures shouldn't break startup
      log('WARN', 'Failed to rotate audit trail', error);
    }
  }

  /**
   * Get all audit events from file.
   * Returns array of parsed entries.
   * Used for rotation and debugging.
   *
   * @returns Array of audit entries
   */
  async getEvents(): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(this.auditFilePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      return lines.map(line => JSON.parse(line) as AuditEntry);
    } catch (error) {
      // File doesn't exist or is empty
      return [];
    }
  }
}

/**
 * Singleton audit trail instance.
 * Used throughout application for security event logging.
 */
export const auditTrail = new AuditTrail();
