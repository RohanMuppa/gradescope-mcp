/**
 * AuthManager coordinates session storage and browser authentication.
 * This is the main entry point for all authentication operations.
 */

import { SessionStore } from './session-store.js';
import { BrowserAuth } from './browser-auth.js';
import type { SessionData } from './types.js';
import { log } from '../utils/logger.js';

/**
 * AuthManager provides the public API for authentication.
 * Coordinates SessionStore (persistent session) and BrowserAuth (browser login).
 */
export class AuthManager {
  private readonly sessionStore: SessionStore;
  private readonly browserAuth: BrowserAuth;

  constructor(sessionDir?: string) {
    this.sessionStore = new SessionStore(sessionDir);
    this.browserAuth = new BrowserAuth();
  }

  /**
   * Login to Gradescope via browser authentication.
   * If a valid session already exists, skips browser launch and returns cached session.
   * Otherwise, launches browser for user to type credentials directly.
   *
   * @returns SessionData with captured cookie
   * @throws {GradescopeError} If login fails
   */
  async login(): Promise<SessionData> {
    // First check if we already have a valid session
    const authCheck = await this.checkAuth();
    if (authCheck.valid && authCheck.session) {
      log('INFO', 'Skipping login -- valid session exists');
      return authCheck.session;
    }

    // No valid session - launch browser for login
    log('INFO', 'No valid session found, launching browser for authentication');
    const sessionData = await this.browserAuth.login();

    // Save the captured session
    await this.sessionStore.save(sessionData);
    log('INFO', 'Session saved successfully');

    return sessionData;
  }

  /**
   * Check if current session is valid by making a health check request.
   * Returns { valid: true, session } if session exists and is active.
   * Returns { valid: false, session: null } if no session, expired, or network error.
   *
   * @returns Object with validation status and session data
   */
  async checkAuth(): Promise<{ valid: boolean; session: SessionData | null }> {
    // Load session from disk
    const session = await this.sessionStore.load();

    if (!session) {
      log('DEBUG', 'No session found in storage');
      return { valid: false, session: null };
    }

    // Perform health check by fetching Gradescope account page
    try {
      log('DEBUG', 'Validating session with health check');

      const response = await fetch('https://www.gradescope.com/account', {
        method: 'GET',
        headers: {
          'Cookie': `_gradescope_session=${session.cookie}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        },
        redirect: 'manual', // Don't follow redirects - we want to detect login redirects
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      // Check if session is valid based on response
      if (response.status === 200) {
        // Success - session is valid
        log('DEBUG', 'Session validation successful (200 OK)');
        return { valid: true, session };
      }

      if (response.status === 302 || response.status === 301) {
        // Redirect - check if it's redirecting to login
        const location = response.headers.get('location');
        if (location && location.includes('/login')) {
          log('DEBUG', 'Session expired (redirects to login)');
          return { valid: false, session: null };
        }
        // Other redirect - consider valid
        log('DEBUG', 'Session validation successful (redirect to non-login page)');
        return { valid: true, session };
      }

      if (response.status === 401 || response.status === 403) {
        // Unauthorized - session expired
        log('DEBUG', `Session expired (${response.status} ${response.statusText})`);
        return { valid: false, session: null };
      }

      // Other status codes - treat as invalid to be safe
      log('WARN', `Unexpected health check response: ${response.status}`);
      return { valid: false, session: null };

    } catch (error) {
      // Network error or timeout - treat as invalid (fail-safe)
      log('WARN', 'Health check failed due to network error', error);
      return { valid: false, session: null };
    }
  }

  /**
   * Logout by clearing the stored session.
   * Removes session file from disk.
   */
  async logout(): Promise<void> {
    await this.sessionStore.clear();
    log('INFO', 'Session cleared');
  }

  /**
   * Get current session without validation.
   * Returns null if no session exists in storage.
   * Does NOT perform health check - use checkAuth() for validation.
   *
   * @returns SessionData or null
   */
  async getSession(): Promise<SessionData | null> {
    return await this.sessionStore.load();
  }

  /**
   * Ensure authentication is valid, auto-login if needed.
   * This is a convenience method that data tools can call to guarantee a valid session.
   *
   * @returns SessionData with guaranteed valid session
   * @throws {GradescopeError} If login fails
   */
  async ensureAuth(): Promise<SessionData> {
    const authCheck = await this.checkAuth();

    if (authCheck.valid && authCheck.session) {
      log('DEBUG', 'Session is valid');
      return authCheck.session;
    }

    // Session invalid - trigger login
    log('INFO', 'Session invalid, triggering auto-login');
    return await this.login();
  }
}

// Re-export types and classes for convenience
export { SessionStore } from './session-store.js';
export { BrowserAuth } from './browser-auth.js';
export type { SessionData, EncryptedData, SessionFile } from './types.js';
