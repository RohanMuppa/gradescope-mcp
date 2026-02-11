/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * HTTP client for Gradescope with cookie auth, caching, and rate limiting.
 * Handles session expiry detection and automatic retry.
 */

import type { AuthManager } from "../auth/index.js";
import type { TTLCache } from "../utils/cache.js";
import type { TokenBucket } from "../utils/rate-limiter.js";
import { GradescopeError, NetworkError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

const BASE_URL = "https://www.gradescope.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 GradescopeMCP/1.0";
const REQUEST_TIMEOUT_MS = 30_000;

interface FetchOptions {
  ttl?: number;
  forceRefresh?: boolean;
}

/**
 * HTTP client that wraps authenticated Gradescope requests.
 * Provides getText and getJSON methods with caching, rate limiting,
 * and automatic session expiry detection with retry.
 */
export class GradescopeClient {
  constructor(
    private readonly authManager: AuthManager,
    private readonly cache: TTLCache,
    private readonly rateLimiter: TokenBucket
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

    const result = await this.doFetch(path, session.cookie);

    // Redirect to login = session expired, retry once with fresh session
    if (result.redirectedToLogin) {
      log("INFO", `Session expired during fetch of ${path}, re-authenticating`);
      const freshSession = await this.authManager.ensureAuth();
      const retry = await this.doFetch(path, freshSession.cookie);
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
   * Execute a single HTTP request to Gradescope.
   */
  private async doFetch(
    path: string,
    cookie: string
  ): Promise<{ body: string; redirectedToLogin: boolean }> {
    await this.rateLimiter.consume();

    const url = `${BASE_URL}${path}`;
    log("DEBUG", `Fetching ${url}`);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Cookie: `_gradescope_session=${cookie}`,
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/json",
        },
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
        throw new GradescopeError(
          "NETWORK_ERROR",
          `[GSMCP-1015] HTTP ${response.status} ${response.statusText}`,
          { path, status: response.status },
          "Check if Gradescope is accessible and retry"
        );
      }

      const body = await response.text();
      return { body, redirectedToLogin: false };
    } catch (error) {
      if (error instanceof GradescopeError) {
        throw error;
      }
      throw new NetworkError(
        `[GSMCP-1016] Network error fetching ${path}: ${String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}
