/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Abuse detection with hard halt on excessive traffic.
 * Tracks request rate using sliding window and blocks all requests during cooldown.
 */

import { GradescopeError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { auditTrail } from "./audit-trail.js";

const WINDOW_MS = 60_000; // 1 minute sliding window
const THRESHOLD = 50; // Max requests per window
const COOLDOWN_MS = 60_000; // 1 minute cooldown after halt

/**
 * Sliding window abuse detector with hard halt.
 * Blocks ALL requests when traffic exceeds threshold until cooldown expires.
 */
export class AbuseDetector {
  private requestTimestamps: number[] = [];
  private haltedUntil: number | null = null;

  constructor(
    private readonly threshold = THRESHOLD,
    private readonly cooldownMs = COOLDOWN_MS
  ) {}

  /**
   * Check if current request should be allowed.
   * Throws RATE_LIMITED error if halted or if threshold would be exceeded.
   * Must be called BEFORE processing request.
   */
  checkAbuse(): void {
    const now = Date.now();

    // Check if currently in halted state
    if (this.haltedUntil !== null) {
      if (now < this.haltedUntil) {
        const remainingSeconds = Math.ceil((this.haltedUntil - now) / 1000);
        throw new GradescopeError(
          "RATE_LIMITED",
          `[GSMCP-9020] Traffic abuse detected. All requests blocked for ${remainingSeconds} more seconds.`,
          {
            threshold: this.threshold,
            windowMs: WINDOW_MS,
            cooldownMs: this.cooldownMs,
            remainingSeconds,
          },
          `Wait ${remainingSeconds} seconds before retrying`
        );
      }
      // Cooldown expired, reset halt state
      log("INFO", "Abuse detector cooldown expired, resuming normal operation");
      auditTrail.record("ABUSE_COOLDOWN_EXPIRED");
      this.haltedUntil = null;
      this.requestTimestamps = [];
    }

    // Remove timestamps outside the sliding window
    const windowStart = now - WINDOW_MS;
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > windowStart
    );

    // Check if adding this request would exceed threshold
    if (this.requestTimestamps.length >= this.threshold) {
      log("WARN", `Abuse threshold exceeded: ${this.requestTimestamps.length} requests in last ${WINDOW_MS}ms`);
      this.haltedUntil = now + this.cooldownMs;
      const cooldownSeconds = Math.ceil(this.cooldownMs / 1000);

      // Record abuse detection event
      auditTrail.record("ABUSE_DETECTED", "GSMCP-9020");

      throw new GradescopeError(
        "RATE_LIMITED",
        `[GSMCP-9020] Traffic abuse detected. Exceeded ${this.threshold} requests per minute. All requests blocked for ${cooldownSeconds} seconds.`,
        {
          threshold: this.threshold,
          windowMs: WINDOW_MS,
          cooldownMs: this.cooldownMs,
          requestCount: this.requestTimestamps.length,
        },
        `Wait ${cooldownSeconds} seconds before retrying`
      );
    }

    // Request allowed, record timestamp
    this.requestTimestamps.push(now);
  }

  /**
   * Reset detector state (for testing or manual override).
   * Clears all timestamps and halted state.
   */
  reset(): void {
    this.requestTimestamps = [];
    this.haltedUntil = null;
    log("INFO", "Abuse detector state reset");
  }

  /**
   * Get current state for debugging.
   */
  getState(): {
    requestCount: number;
    isHalted: boolean;
    remainingCooldownMs: number;
  } {
    const now = Date.now();
    const isHalted = this.haltedUntil !== null && now < this.haltedUntil;
    const remainingCooldownMs = isHalted && this.haltedUntil
      ? this.haltedUntil - now
      : 0;

    return {
      requestCount: this.requestTimestamps.length,
      isHalted,
      remainingCooldownMs,
    };
  }
}
