/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * TTL-based cache with automatic expiration and size limits.
 * Supports per-entry TTLs, force refresh, and metadata queries.
 */

interface CacheEntry<T> {
  data: T;
  timerId: NodeJS.Timeout;
  cachedAt: number;
}

interface CacheOptions {
  maxSize?: number;
}

export interface CacheMeta {
  age: number;
  cached: boolean;
}

/**
 * In-memory cache with per-entry TTL and automatic cleanup.
 * Entries are evicted after their TTL expires.
 * Optional maxSize enforces LRU eviction.
 */
export class TTLCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize?: number;

  constructor(options?: CacheOptions) {
    this.maxSize = options?.maxSize;
  }

  /**
   * Store a value with a TTL in milliseconds.
   * If maxSize is configured, evicts oldest entry when limit is reached.
   */
  set(key: string, data: T, ttlMs: number): void {
    // Clear existing entry if present (cancel timer)
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      clearTimeout(existing.timerId);
    }

    // Evict oldest entry if at capacity
    if (this.maxSize && this.cache.size >= this.maxSize && !this.cache.has(key)) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, entry] of this.cache.entries()) {
        if (entry.cachedAt < oldestTime) {
          oldestTime = entry.cachedAt;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.delete(oldestKey);
      }
    }

    // Set up auto-expiration
    const timerId = setTimeout(() => {
      this.cache.delete(key);
    }, ttlMs);

    this.cache.set(key, {
      data,
      timerId,
      cachedAt: Date.now(),
    });
  }

  /**
   * Retrieve a cached value.
   * Returns undefined if key doesn't exist.
   * If forceRefresh is true, returns undefined even if cached (but doesn't delete entry).
   */
  get(key: string, forceRefresh = false): T | undefined {
    if (forceRefresh) {
      return undefined;
    }

    const entry = this.cache.get(key);
    return entry?.data;
  }

  /**
   * Get metadata about a cached entry (age, cached status).
   * Returns null if key doesn't exist.
   */
  getMeta(key: string): CacheMeta | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    return {
      age: Date.now() - entry.cachedAt,
      cached: true,
    };
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific cache entry.
   * Cancels the expiration timer.
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      clearTimeout(entry.timerId);
      return this.cache.delete(key);
    }
    return false;
  }

  /**
   * Clear all cache entries and cancel all timers.
   * Prevents timer leaks.
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      clearTimeout(entry.timerId);
    }
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}
