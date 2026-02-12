/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Tests for abuse detection with sliding window rate limiting.
 * Verifies hard halt behavior and cooldown enforcement.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AbuseDetector } from "../../src/security/abuse-detector.js";
import { GradescopeError } from "../../src/utils/errors.js";

describe("Abuse Detector", () => {
  let detector: AbuseDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new AbuseDetector(50, 60_000); // 50 requests/min, 1 min cooldown
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Normal traffic", () => {
    it("should allow normal traffic under threshold", () => {
      // 10 requests should all pass
      for (let i = 0; i < 10; i++) {
        expect(() => detector.checkAbuse()).not.toThrow();
      }
    });

    it("should allow traffic up to threshold", () => {
      // 50 requests (at threshold) should all pass
      for (let i = 0; i < 50; i++) {
        expect(() => detector.checkAbuse()).not.toThrow();
      }
    });
  });

  describe("Abuse detection", () => {
    it("should trigger on 51st rapid request", () => {
      // 50 requests pass
      for (let i = 0; i < 50; i++) {
        detector.checkAbuse();
      }

      // 51st request should throw RATE_LIMITED
      expect(() => detector.checkAbuse()).toThrow(GradescopeError);
      try {
        detector.checkAbuse();
      } catch (error) {
        expect(error).toBeInstanceOf(GradescopeError);
        expect((error as GradescopeError).code).toBe("RATE_LIMITED");
        expect((error as GradescopeError).message).toContain("GSMCP-9020");
        expect((error as GradescopeError).message).toContain("Traffic abuse detected");
      }
    });

    it("should include remaining cooldown seconds in error message", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected on 51st
        }
      }

      // Check error message
      try {
        detector.checkAbuse();
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as GradescopeError).message).toContain("60");
        expect((error as GradescopeError).message).toContain("seconds");
      }
    });
  });

  describe("Cooldown enforcement", () => {
    it("should block all requests during cooldown", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected
        }
      }

      // All subsequent requests should be blocked
      for (let i = 0; i < 10; i++) {
        expect(() => detector.checkAbuse()).toThrow(GradescopeError);
      }
    });

    it("should resume after cooldown expires", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected
        }
      }

      // Fast-forward past cooldown (60 seconds)
      vi.advanceTimersByTime(61_000);

      // First request after cooldown should succeed
      expect(() => detector.checkAbuse()).not.toThrow();
    });

    it("should clear timestamps after cooldown", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected
        }
      }

      // Fast-forward past cooldown
      vi.advanceTimersByTime(61_000);

      // Should allow full threshold again
      for (let i = 0; i < 50; i++) {
        expect(() => detector.checkAbuse()).not.toThrow();
      }
    });
  });

  describe("Sliding window", () => {
    it("should clean old timestamps outside window", () => {
      // Make 30 requests
      for (let i = 0; i < 30; i++) {
        detector.checkAbuse();
      }

      // Advance time 61 seconds (outside 60-second window)
      vi.advanceTimersByTime(61_000);

      // Old timestamps should be cleaned, allowing fresh 50 requests
      for (let i = 0; i < 50; i++) {
        expect(() => detector.checkAbuse()).not.toThrow();
      }
    });

    it("should keep recent timestamps within window", () => {
      // Make 40 requests
      for (let i = 0; i < 40; i++) {
        detector.checkAbuse();
      }

      // Advance time 30 seconds (within 60-second window)
      vi.advanceTimersByTime(30_000);

      // Only 10 more requests allowed (40 still in window)
      for (let i = 0; i < 10; i++) {
        expect(() => detector.checkAbuse()).not.toThrow();
      }

      // 11th should trigger abuse
      expect(() => detector.checkAbuse()).toThrow(GradescopeError);
    });
  });

  describe("State management", () => {
    it("should reset state correctly", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected
        }
      }

      // Reset should clear halted state
      detector.reset();

      // Should allow requests immediately
      expect(() => detector.checkAbuse()).not.toThrow();
    });

    it("should report correct state when not halted", () => {
      for (let i = 0; i < 10; i++) {
        detector.checkAbuse();
      }

      const state = detector.getState();
      expect(state.requestCount).toBe(10);
      expect(state.isHalted).toBe(false);
      expect(state.remainingCooldownMs).toBe(0);
    });

    it("should report correct state when halted", () => {
      // Trigger abuse
      for (let i = 0; i < 51; i++) {
        try {
          detector.checkAbuse();
        } catch {
          // Expected
        }
      }

      const state = detector.getState();
      expect(state.isHalted).toBe(true);
      expect(state.remainingCooldownMs).toBeGreaterThan(0);
      expect(state.remainingCooldownMs).toBeLessThanOrEqual(60_000);
    });
  });
});
