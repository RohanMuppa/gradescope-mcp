/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Type definitions for Gradescope session management.
 */

/**
 * The Gradescope session cookie data stored encrypted on disk.
 */
export interface SessionData {
  /** The _gradescope_session cookie value */
  cookie: string;
  /** When the cookie was captured (epoch ms) */
  capturedAt: number;
  /** Optional: any additional cookies captured during login (e.g., CSRF tokens) */
  extraCookies?: Record<string, string>;
  /** Optional: local session expiry timestamp (epoch ms). Sessions expire after 24 hours. */
  expiresAt?: number;
}

/**
 * AES-256-GCM encrypted payload stored in the session file.
 */
export interface EncryptedData {
  /** Hex-encoded initialization vector */
  iv: string;
  /** Hex-encoded GCM authentication tag */
  authTag: string;
  /** Hex-encoded ciphertext */
  data: string;
}

/**
 * On-disk session file format.
 */
export interface SessionFile {
  /** File format version */
  version: number;
  /** Encrypted session data */
  encrypted: EncryptedData;
  /** When this session file was created (epoch ms) */
  createdAt: number;
}
