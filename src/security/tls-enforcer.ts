/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * TLS enforcement and domain allowlist for secure network operations.
 * Prevents TLS validation bypass and restricts outbound connections.
 */

import { GradescopeError } from '../utils/errors.js';
import { log } from '../utils/logger.js';

/**
 * Allowed domains for outbound HTTP requests.
 * All requests must target gradescope.com or purdue.edu domains.
 */
export const ALLOWED_DOMAINS = ['gradescope.com', 'purdue.edu'] as const;

/**
 * Enforce TLS validation at startup.
 * Throws error if NODE_TLS_REJECT_UNAUTHORIZED is set to '0'.
 * Logs warning if NODE_EXTRA_CA_CERTS is set (potential security risk).
 *
 * @throws {Error} If TLS validation is disabled
 */
export function enforceTLS(): void {
  // Check if TLS validation is disabled
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error(
      '[GSMCP-9001] TLS validation is disabled (NODE_TLS_REJECT_UNAUTHORIZED=0). ' +
      'This is a critical security vulnerability. Remove this environment variable.'
    );
  }

  // Warn if custom CA certificates are being used
  if (process.env.NODE_EXTRA_CA_CERTS) {
    log('WARN', `Custom CA certificates detected (NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}). Ensure this is intentional.`);
  }

  log('INFO', 'TLS validation enforced - NODE_TLS_REJECT_UNAUTHORIZED is not disabled');
}

/**
 * Validate that a URL is in the domain allowlist and uses HTTPS.
 *
 * @param url - URL to validate
 * @throws {GradescopeError} If domain is not allowed or protocol is not HTTPS
 */
export function validateDomain(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    throw new GradescopeError(
      'NETWORK_ERROR',
      `[GSMCP-9002] Request blocked: invalid URL format`,
      { url },
      'Ensure URL is properly formatted'
    );
  }

  // Check protocol is HTTPS
  if (parsed.protocol !== 'https:') {
    throw new GradescopeError(
      'NETWORK_ERROR',
      `[GSMCP-9002] Request blocked: only HTTPS connections allowed (got ${parsed.protocol})`,
      { url, protocol: parsed.protocol },
      'Use HTTPS instead of HTTP'
    );
  }

  // Check domain is in allowlist
  const hostname = parsed.hostname;
  const allowed = ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

  if (!allowed) {
    throw new GradescopeError(
      'NETWORK_ERROR',
      `[GSMCP-9002] Request blocked: domain not in security allowlist`,
      { url, hostname, allowedDomains: ALLOWED_DOMAINS },
      `Only requests to ${ALLOWED_DOMAINS.join(', ')} are permitted`
    );
  }

  log('DEBUG', `Domain validation passed: ${hostname}`);
}
