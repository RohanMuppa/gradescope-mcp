/**
 * Tests for TokenBucket rate limiter.
 * Tests token consumption, refilling, waiting, and jitter.
 */

import { describe, it, expect } from "vitest";
import { TokenBucket } from "../../src/utils/rate-limiter.js";

describe("TokenBucket", () => {
  it("allows burst up to capacity", async () => {
    const bucket = new TokenBucket(3, 1, 0, 0);
    await bucket.consume();
    await bucket.consume();
    await bucket.consume();
    expect(bucket.availableTokens).toBeLessThanOrEqual(0);
  });

  it("refills tokens over time", async () => {
    const bucket = new TokenBucket(1, 10, 0, 0); // 10 tokens per second
    await bucket.consume();
    expect(bucket.availableTokens).toBeLessThanOrEqual(0);
    await new Promise((resolve) => setTimeout(resolve, 200)); // Wait 200ms
    expect(bucket.availableTokens).toBeGreaterThan(0);
  });

  it("makes caller wait when tokens exhausted", async () => {
    const bucket = new TokenBucket(1, 1, 0, 0); // 1 token per second
    await bucket.consume();
    const start = Date.now();
    await bucket.consume();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900); // At least 900ms wait
  });

  it("adds jitter to wait times", async () => {
    const bucket = new TokenBucket(1, 100, 50, 100); // Jitter 50-100ms
    await bucket.consume();
    const start = Date.now();
    await bucket.consume();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50); // At least minimum jitter
  });

  it("starts with full capacity", () => {
    const bucket = new TokenBucket(5, 1, 0, 0);
    expect(bucket.availableTokens).toBe(5);
  });

  it("does not exceed capacity on refill", async () => {
    const bucket = new TokenBucket(3, 100, 0, 0); // Fast refill
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait long enough to refill many times over
    expect(bucket.availableTokens).toBeLessThanOrEqual(3);
  });
});
