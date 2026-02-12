/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Browser-based authentication for Gradescope.
 * Launches visible Chromium for user to type email/password directly.
 * No credentials pass through MCP - user authenticates directly with Gradescope.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { SessionData } from './types.js';
import { log } from '../utils/logger.js';
import { GradescopeError } from '../utils/errors.js';

const GRADESCOPE_URL = 'https://www.gradescope.com';
const LOGIN_URL = 'https://www.gradescope.com/login';
const LOGIN_TIMEOUT = 300_000; // 5 minutes for user to complete login
const NAV_TIMEOUT = 30_000; // 30 seconds for page navigation

/**
 * BrowserAuth handles Gradescope login via visible browser window.
 * User types credentials directly - we never touch them.
 * After login, we capture the _gradescope_session cookie.
 */
export class BrowserAuth {
  /**
   * Launch browser, navigate to login, wait for user to authenticate,
   * capture session cookie, close browser.
   *
   * @throws {GradescopeError} NETWORK_ERROR if Gradescope unreachable
   * @throws {GradescopeError} AUTH_EXPIRED if login times out (5 min)
   * @throws {GradescopeError} PARSE_FAILED if session cookie not found
   * @throws {GradescopeError} UNKNOWN_ERROR for unexpected failures
   */
  async login(): Promise<SessionData> {
    let browser: Browser | null = null;

    try {
      log('INFO', 'Starting browser authentication for Gradescope');

      // Launch visible browser (headless: false)
      browser = await chromium.launch({
        headless: false,
        // Disable automation detection
        args: ['--disable-blink-features=AutomationControlled']
      });

      log('INFO', 'Browser launched successfully');

      // Create browser context with reasonable viewport and NO persistent storage
      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        storageState: undefined // Explicit: no persistent storage
      });

      // Apply domain allowlist BEFORE creating page to block third-party requests
      const ALLOWED_DOMAINS = ['gradescope.com', 'purdue.edu'];
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (ALLOWED_DOMAINS.some(domain => url.includes(domain))) {
          route.continue();
        } else {
          route.abort('blockedbyclient');
        }
      });

      const page: Page = await context.newPage();

      // Navigate to Gradescope login page
      log('INFO', `Navigating to ${LOGIN_URL}`);
      try {
        await page.goto(LOGIN_URL, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT
        });
      } catch (error) {
        // Check if it's a network error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('net::') || errorMessage.includes('Network') || errorMessage.includes('timeout')) {
          throw new GradescopeError(
            'NETWORK_ERROR',
            '[GSMCP-1005] Gradescope is unreachable. Check your internet connection.',
            { url: LOGIN_URL },
            'Verify your internet connection and try again',
            error instanceof Error ? error : undefined
          );
        }
        throw error;
      }

      log('INFO', 'Login page loaded. Waiting for user to complete authentication...');
      log('INFO', 'Please type your email and password into the browser window.');

      // Wait for user to complete login
      // Gradescope redirects to /courses, /account, or / after successful login
      try {
        await page.waitForURL(
          (url) => {
            const urlStr = url.toString();
            // Consider logged in if we're NOT on the login page anymore
            // and we're on a Gradescope page
            return (
              urlStr.includes(GRADESCOPE_URL) &&
              !urlStr.includes('/login') &&
              (urlStr.includes('/courses') ||
               urlStr.includes('/account') ||
               urlStr === GRADESCOPE_URL + '/' ||
               urlStr.includes('/dashboard'))
            );
          },
          { timeout: LOGIN_TIMEOUT }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
          throw new GradescopeError(
            'AUTH_EXPIRED',
            '[GSMCP-1006] Login timed out. The browser window was open for 5 minutes without completing login.',
            { timeoutMs: LOGIN_TIMEOUT },
            'Try again and complete login within 5 minutes'
          );
        }
        throw error;
      }

      log('INFO', 'Login successful! Capturing session cookie...');

      // Extract cookies from browser context
      const cookies = await context.cookies(GRADESCOPE_URL);

      // Find the _gradescope_session cookie
      const sessionCookie = cookies.find(c => c.name === '_gradescope_session');

      if (!sessionCookie) {
        log('ERROR', 'Session cookie not found after login', {
          availableCookies: cookies.map(c => c.name)
        });
        throw new GradescopeError(
          'PARSE_FAILED',
          '[GSMCP-1007] Could not capture session cookie after login. Gradescope may have changed their login flow. Please report this issue on GitHub.',
          {
            availableCookies: cookies.map(c => c.name),
            url: page.url()
          },
          'Report this error at https://github.com/yourusername/gradescope-mcp/issues'
        );
      }

      log('INFO', `Session cookie captured: ${sessionCookie.name}`);

      // Capture any other useful cookies
      const extraCookies: Record<string, string> = {};
      for (const cookie of cookies) {
        if (cookie.name !== '_gradescope_session') {
          extraCookies[cookie.name] = cookie.value;
        }
      }

      // Build SessionData
      const sessionData: SessionData = {
        cookie: sessionCookie.value,
        capturedAt: Date.now(),
        extraCookies: Object.keys(extraCookies).length > 0 ? extraCookies : undefined
      };

      log('INFO', 'Authentication complete');
      return sessionData;

    } catch (error) {
      // If it's already a GradescopeError, rethrow as-is
      if (error instanceof GradescopeError) {
        throw error;
      }

      // Otherwise wrap in UNKNOWN_ERROR
      log('ERROR', 'Browser authentication failed', error);
      throw new GradescopeError(
        'UNKNOWN_ERROR',
        `[GSMCP-1008] ${error instanceof Error ? error.message : 'Unknown error during browser authentication'}`,
        undefined,
        'Check the error details and try again',
        error instanceof Error ? error : undefined
      );
    } finally {
      // CRITICAL: Always close browser to prevent orphaned windows
      if (browser) {
        log('DEBUG', 'Closing browser');
        await browser.close();
      }
    }
  }
}
