/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Session timeout utilities for local session expiry management.
 * Enforces 24-hour local timeout independent of Gradescope server-side expiry.
 */

import type { SessionData } from '../auth/types.js';

/**
 * Session timeout duration: 24 hours in milliseconds.
 * Local timeout enforced independently of Gradescope server-side expiry.
 */
export const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * TOCTOU buffer: 5 minutes in milliseconds.
 * Expire sessions 5 minutes before actual timeout to prevent time-of-check-to-time-of-use races.
 */
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a session has expired based on local timeout.
 * Returns true if session.expiresAt is undefined OR current time exceeds expiry minus buffer.
 *
 * @param session - SessionData to check
 * @returns true if session is expired, false if still valid
 */
export function isSessionExpired(session: SessionData): boolean {
  // If no expiresAt field, consider expired (legacy sessions)
  if (session.expiresAt === undefined) {
    return true;
  }

  // Check if current time exceeds expiry time minus TOCTOU buffer
  return Date.now() > session.expiresAt - EXPIRY_BUFFER_MS;
}

/**
 * Set session expiry timestamp on a session object.
 * Returns a new SessionData object with expiresAt set to current time + SESSION_TIMEOUT_MS.
 *
 * @param session - SessionData to set expiry on
 * @returns New SessionData with expiresAt field set
 */
export function setSessionExpiry(session: SessionData): SessionData {
  return {
    ...session,
    expiresAt: Date.now() + SESSION_TIMEOUT_MS
  };
}
