/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * CsrfManager extracts and manages CSRF tokens for Gradescope requests.
 *
 * Gradescope (Ruby on Rails) requires authenticity tokens for all non-GET requests.
 * These tokens are embedded in HTML pages in two places:
 * 1. <meta name="csrf-token" content="..."> in the <head>
 * 2. <input type="hidden" name="authenticity_token" value="..."> in forms
 *
 * Without a valid CSRF token, POST/PATCH/DELETE requests will be rejected with 422.
 */

import { GradescopeError } from '../utils/errors.js';
import { log } from '../utils/logger.js';

/**
 * CsrfManager extracts CSRF tokens from Gradescope HTML pages.
 * Tokens are cached for 30 minutes (Rails CSRF tokens rotate).
 */
export class CsrfManager {
  private token: string | null = null;
  private extractedAt: number = 0;
  private readonly TOKEN_MAX_AGE = 1_800_000; // 30 minutes in milliseconds

  /**
   * Extract CSRF token from HTML content.
   * Tries meta tag first, falls back to hidden input.
   *
   * @param html - HTML content to parse
   * @returns Extracted token or null if not found
   */
  extractFromHtml(html: string): string | null {
    // Try meta tag first: <meta name="csrf-token" content="...">
    const metaRegex = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i;
    const metaMatch = html.match(metaRegex);

    if (metaMatch && metaMatch[1]) {
      const token = metaMatch[1];
      this.token = token;
      this.extractedAt = Date.now();
      log('DEBUG', 'CSRF token extracted from meta tag');
      return token;
    }

    // Fallback to hidden input: <input type="hidden" name="authenticity_token" value="...">
    const inputRegex = /<input\s+[^>]*name="authenticity_token"[^>]*value="([^"]+)"[^>]*>/i;
    const inputMatch = html.match(inputRegex);

    if (inputMatch && inputMatch[1]) {
      const token = inputMatch[1];
      this.token = token;
      this.extractedAt = Date.now();
      log('DEBUG', 'CSRF token extracted from hidden input');
      return token;
    }

    log('WARN', 'No CSRF token found in HTML');
    return null;
  }

  /**
   * Fetch a fresh CSRF token from Gradescope.
   * Makes a GET request to /account page and extracts the token from HTML.
   *
   * @param sessionCookie - The _gradescope_session cookie value
   * @returns Extracted CSRF token
   * @throws {GradescopeError} If extraction fails
   */
  async fetchToken(sessionCookie: string): Promise<string> {
    try {
      log('DEBUG', 'Fetching fresh CSRF token from Gradescope');

      const response = await fetch('https://www.gradescope.com/account', {
        method: 'GET',
        headers: {
          'Cookie': `_gradescope_session=${sessionCookie}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 GradescopeMCP/1.0'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        throw new GradescopeError(
          'NETWORK_ERROR',
          `[GSMCP-1009] Failed to fetch CSRF token page: ${response.status} ${response.statusText}`
        );
      }

      const html = await response.text();
      const token = this.extractFromHtml(html);

      if (!token) {
        throw new GradescopeError(
          'PARSE_FAILED',
          '[GSMCP-1010] Could not extract CSRF token from Gradescope. The site may have changed their page structure. Please report this issue on GitHub.'
        );
      }

      return token;

    } catch (error) {
      if (error instanceof GradescopeError) {
        throw error;
      }

      throw new GradescopeError(
        'NETWORK_ERROR',
        '[GSMCP-1011] Failed to fetch CSRF token from Gradescope',
        { originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Get CSRF token (cached or fresh).
   * Returns cached token if it exists and is less than TOKEN_MAX_AGE old.
   * Otherwise fetches a fresh token.
   *
   * @param sessionCookie - The _gradescope_session cookie value
   * @returns CSRF token
   * @throws {GradescopeError} If fetching fails
   */
  async getToken(sessionCookie: string): Promise<string> {
    const age = Date.now() - this.extractedAt;

    // Return cached token if still valid
    if (this.token && age < this.TOKEN_MAX_AGE) {
      log('DEBUG', `Using cached CSRF token (age: ${Math.round(age / 1000)}s)`);
      return this.token;
    }

    // Fetch fresh token
    log('DEBUG', 'CSRF token expired or missing, fetching fresh');
    return await this.fetchToken(sessionCookie);
  }

  /**
   * Invalidate cached CSRF token.
   * Call this when a 422 response suggests the token is stale.
   */
  invalidate(): void {
    log('DEBUG', 'Invalidating CSRF token cache');
    this.token = null;
    this.extractedAt = 0;
  }
}
