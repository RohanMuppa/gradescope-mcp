/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * HTTP client for Gradescope with cookie auth, caching, and rate limiting.
 * Handles session expiry detection and automatic retry.
 *
 * SEC-21: Request Scoping - All requests are scoped to the authenticated user's session cookie.
 * The session cookie identifies the user, and Gradescope returns ONLY that user's data.
 *
 * SEC-24: Response Data Verification - Response data is implicitly scoped to authenticated user
 * because Gradescope uses cookie-based authentication. No user ID mixing is possible.
 */

import type { AuthManager } from "../auth/index.js";
import type { TTLCache } from "../utils/cache.js";
import type { TokenBucket } from "../utils/rate-limiter.js";
import type { AbuseDetector } from "../security/abuse-detector.js";
import { GradescopeError, NetworkError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { validateDomain } from "../security/tls-enforcer.js";

const BASE_URL = "https://www.gradescope.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 GradescopeMCP/1.0";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BINARY_SIZE = 50 * 1024 * 1024; // 50MB

interface FetchOptions {
  ttl?: number;
  forceRefresh?: boolean;
}

/**
 * HTTP client that wraps authenticated Gradescope requests.
 * Provides getText and getJSON methods with caching, rate limiting,
 * abuse detection, and automatic session expiry detection with retry.
 */
export class GradescopeClient {
  constructor(
    private readonly authManager: AuthManager,
    private readonly cache: TTLCache,
    private readonly rateLimiter: TokenBucket,
    private readonly abuseDetector: AbuseDetector
  ) {}

  /**
   * Fetch a Gradescope page as raw HTML text.
   * Results are cached under `gs:text:{path}`.
   */
  async getText(path: string, options: FetchOptions = {}): Promise<string> {
    const cacheKey = `gs:text:${path}`;
    const cached = this.cache.get(cacheKey, options.forceRefresh);
    if (cached !== undefined) {
      return cached as string;
    }

    const text = await this.fetchWithRetry(path, "text");
    if (options.ttl) {
      this.cache.set(cacheKey, text, options.ttl);
    }
    return text;
  }

  /**
   * Fetch a Gradescope endpoint as parsed JSON.
   * Results are cached under `gs:json:{path}`.
   */
  async getJSON<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
    const cacheKey = `gs:json:${path}`;
    const cached = this.cache.get(cacheKey, options.forceRefresh);
    if (cached !== undefined) {
      return cached as T;
    }

    const text = await this.fetchWithRetry(path, "json");
    const data = JSON.parse(text) as T;
    if (options.ttl) {
      this.cache.set(cacheKey, data, options.ttl);
    }
    return data;
  }

  /**
   * Fetch binary content (PDFs, images) from Gradescope.
   * Returns raw Response object for caller to extract arrayBuffer.
   * Not cached due to large size.
   */
  async getRaw(path: string): Promise<Response> {
    this.abuseDetector.checkAbuse();
    await this.rateLimiter.consume();

    const session = await this.authManager.getSession();
    if (!session) {
      throw new GradescopeError(
        "AUTH_REQUIRED",
        "[GSMCP-1013] No active session. Please login first.",
        undefined,
        "Run the login tool to authenticate"
      );
    }

    const url = `${BASE_URL}${path}`;
    validateDomain(url);
    log("DEBUG", `Fetching binary content from ${url}`);

    try {
      const cookieHeader = this.buildCookieHeader(session);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Cookie: cookieHeader,
          "User-Agent": USER_AGENT,
          Accept: "*/*",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Detect redirect to login page (session expired)
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get("location") ?? "";
        if (location.includes("/login")) {
          throw new GradescopeError(
            "AUTH_EXPIRED",
            "[GSMCP-1013] Session expired during binary download. Please login again.",
            { path },
            "Run the login tool to re-authenticate"
          );
        }
      }

      if (!response.ok) {
        // SEC-25: Generic error messages prevent information disclosure
        const safeMessage = response.status === 403 || response.status === 401
          ? "Access denied"
          : response.status === 404
          ? "Resource not found"
          : "Network request failed";
        throw new GradescopeError(
          "NETWORK_ERROR",
          `[GSMCP-1015] ${safeMessage}`,
          { status: response.status },
          "Check if Gradescope is accessible and retry"
        );
      }

      // Check content size if available
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_BINARY_SIZE) {
        throw new GradescopeError(
          "NETWORK_ERROR",
          `[GSMCP-1015] Binary content too large (${contentLength} bytes, max ${MAX_BINARY_SIZE})`,
          { path, size: contentLength },
          "File exceeds maximum allowed size for download"
        );
      }

      return response;
    } catch (error) {
      if (error instanceof GradescopeError) {
        throw error;
      }
      // SEC-25: Generic error message prevents path/error details disclosure
      throw new NetworkError(
        "[GSMCP-1016] Network request failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Core fetch with session expiry detection and single retry.
   * On redirect to /login, refreshes session and retries once.
   */
  private async fetchWithRetry(path: string, mode: "text" | "json"): Promise<string> {
    const session = await this.authManager.getSession();
    if (!session) {
      throw new GradescopeError(
        "AUTH_REQUIRED",
        "[GSMCP-1013] No active session. Please login first.",
        undefined,
        "Run the login tool to authenticate"
      );
    }

    const result = await this.doFetch(path, session);

    // Redirect to login = session expired, retry once with fresh session
    if (result.redirectedToLogin) {
      log("INFO", `Session expired during fetch of ${path}, re-authenticating`);
      const freshSession = await this.authManager.ensureAuth();
      const retry = await this.doFetch(path, freshSession);
      if (retry.redirectedToLogin) {
        throw new GradescopeError(
          "AUTH_EXPIRED",
          "[GSMCP-1013] Session expired and re-authentication did not resolve. Please login again.",
          { path },
          "Run the login tool to re-authenticate"
        );
      }
      return retry.body;
    }

    return result.body;
  }

  /**
   * Build complete Cookie header from session data.
   * Includes _gradescope_session and all extraCookies (signed_token, remember_me, etc.).
   */
  private buildCookieHeader(session: { cookie: string; extraCookies?: Record<string, string> }): string {
    const cookies = [`_gradescope_session=${session.cookie}`];

    if (session.extraCookies) {
      for (const [name, value] of Object.entries(session.extraCookies)) {
        cookies.push(`${name}=${value}`);
      }
    }

    return cookies.join("; ");
  }

  /**
   * Execute a single HTTP request to Gradescope.
   */
  private async doFetch(
    path: string,
    session: { cookie: string; extraCookies?: Record<string, string> }
  ): Promise<{ body: string; redirectedToLogin: boolean }> {
    this.abuseDetector.checkAbuse();
    await this.rateLimiter.consume();

    const url = `${BASE_URL}${path}`;
    validateDomain(url);
    log("DEBUG", `Fetching ${url}`);

    try {
      const cookieHeader = this.buildCookieHeader(session);

      // Build headers - add X-Requested-With for .json endpoints
      const headers: Record<string, string> = {
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json",
      };

      // Rails/Gradescope .json endpoints require X-Requested-With to distinguish AJAX from direct navigation
      if (path.endsWith(".json")) {
        headers["X-Requested-With"] = "XMLHttpRequest";
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Detect redirect to login page
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get("location") ?? "";
        if (location.includes("/login")) {
          return { body: "", redirectedToLogin: true };
        }
      }

      if (!response.ok && response.status !== 301 && response.status !== 302) {
        // SEC-25: Generic error messages prevent information disclosure
        const safeMessage = response.status === 403 || response.status === 401
          ? "Access denied"
          : response.status === 404
          ? "Resource not found"
          : response.status >= 500
          ? "Server error"
          : "Network request failed";
        throw new GradescopeError(
          "NETWORK_ERROR",
          `[GSMCP-1015] ${safeMessage}`,
          { status: response.status },
          "Check if Gradescope is accessible and retry"
        );
      }

      const body = await response.text();
      return { body, redirectedToLogin: false };
    } catch (error) {
      if (error instanceof GradescopeError) {
        throw error;
      }
      // SEC-25: Generic error message prevents path/error details disclosure
      throw new NetworkError(
        "[GSMCP-1016] Network request failed",
        error instanceof Error ? error : undefined
      );
    }
  }
}
