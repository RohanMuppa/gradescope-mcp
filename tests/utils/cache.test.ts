/**
 * Tests for TTLCache utility.
 * Tests cache storage, retrieval, expiration, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TTLCache } from "../../src/utils/cache.js";

describe("TTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "value", 60000);
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined for missing keys", () => {
    const cache = new TTLCache<string>();
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "value", 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.get("key")).toBeUndefined();
  });

  it("does not expire entries before TTL", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "value", 1000);
    vi.advanceTimersByTime(999);
    expect(cache.get("key")).toBe("value");
  });

  it("overwrites existing entries", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "v1", 60000);
    cache.set("key", "v2", 60000);
    expect(cache.get("key")).toBe("v2");
  });

  it("clears all entries and cancels all timers", () => {
    const cache = new TTLCache<number>();
    cache.set("a", 1, 60000);
    cache.set("b", 2, 60000);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("delete removes specific entry", () => {
    const cache = new TTLCache<number>();
    cache.set("a", 1, 60000);
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
  });

  it("returns undefined on get when forceRefresh is true", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "value", 60000);
    expect(cache.get("key", true)).toBeUndefined();
    // But the entry still exists
    expect(cache.has("key")).toBe(true);
  });

  it("getMeta returns age and cached status", () => {
    const cache = new TTLCache<string>();
    cache.set("key", "value", 60000);
    vi.advanceTimersByTime(5000);
    const meta = cache.getMeta("key");
    expect(meta).not.toBeNull();
    expect(meta?.cached).toBe(true);
    expect(meta?.age).toBeGreaterThanOrEqual(4999);
    expect(meta?.age).toBeLessThanOrEqual(5001);
  });

  it("getMeta returns null for missing keys", () => {
    const cache = new TTLCache<string>();
    expect(cache.getMeta("nonexistent")).toBeNull();
  });

  it("reports size correctly", () => {
    const cache = new TTLCache<number>();
    cache.set("a", 1, 60000);
    cache.set("b", 2, 60000);
    cache.set("c", 3, 60000);
    expect(cache.size).toBe(3);
    cache.delete("a");
    expect(cache.size).toBe(2);
  });

  it("respects maxSize by evicting oldest entry", () => {
    const cache = new TTLCache<number>({ maxSize: 2 });
    cache.set("a", 1, 60000);
    vi.advanceTimersByTime(10); // Ensure distinct timestamps
    cache.set("b", 2, 60000);
    vi.advanceTimersByTime(10);
    cache.set("c", 3, 60000); // This should evict "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.size).toBe(2);
  });
});
