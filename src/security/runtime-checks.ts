/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Runtime integrity checks performed at server startup.
 * Consolidates all security and environment validation in one place.
 * Fail-closed: any check failure prevents server start.
 */

import { enforceTLS } from './tls-enforcer.js';
import { log } from '../utils/logger.js';
import { scryptSync } from 'crypto';

/**
 * Required minimum Node.js version (major version number).
 */
const REQUIRED_NODE_VERSION = 22;

/**
 * Unsafe environment variables that should not be set.
 */
const UNSAFE_ENV_VARS = [
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_DEBUG',
] as const;

/**
 * Run all startup integrity checks.
 * Validates environment, runtime configuration, and security posture.
 *
 * @throws {Error} If any check fails - server should not start
 */
export function runStartupChecks(): void {
  log('INFO', 'Running startup integrity checks...');

  // Check 1: TLS enforcement (from 09-04)
  enforceTLS();

  // Check 2: Node.js version
  checkNodeVersion();

  // Check 3: Unsafe environment variables
  checkUnsafeEnvVars();

  // Check 4: Crypto module availability
  checkCryptoAvailability();

  log('INFO', 'All startup integrity checks passed');
}

/**
 * Verify Node.js version meets minimum requirement.
 *
 * @throws {Error} If Node.js version is too old
 */
function checkNodeVersion(): void {
  const currentVersion = parseInt(process.version.slice(1).split('.')[0], 10);

  if (currentVersion < REQUIRED_NODE_VERSION) {
    throw new Error(
      `[GSMCP-9030] Node.js version ${REQUIRED_NODE_VERSION}.x or higher required ` +
      `(current: ${process.version}). Please upgrade Node.js.`
    );
  }

  log('INFO', `Node.js version check passed: ${process.version}`);
}

/**
 * Check for unsafe environment variables that compromise security.
 * Logs warnings for detection without blocking startup (TLS check already blocks).
 */
function checkUnsafeEnvVars(): void {
  for (const envVar of UNSAFE_ENV_VARS) {
    if (process.env[envVar] !== undefined && envVar !== 'NODE_TLS_REJECT_UNAUTHORIZED') {
      log('WARN', `Unsafe environment variable detected: ${envVar}=${process.env[envVar]}. This may compromise security.`);
    }
  }
}

/**
 * Verify crypto module is available and functional.
 * Tests scryptSync as it's used for session encryption key derivation.
 *
 * @throws {Error} If crypto operations fail
 */
function checkCryptoAvailability(): void {
  try {
    // Test scryptSync with minimal parameters
    scryptSync('test', 'salt', 32);
    log('INFO', 'Crypto module check passed: scryptSync available');
  } catch (error) {
    throw new Error(
      `[GSMCP-9031] Crypto module unavailable or non-functional: ${error}. ` +
      'This is required for session encryption.'
    );
  }
}
