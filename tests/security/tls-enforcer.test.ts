/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Tests for TLS enforcement and domain allowlist.
 * Verifies HTTPS requirement and domain restrictions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enforceTLS, validateDomain } from "../../src/security/tls-enforcer.js";
import { GradescopeError } from "../../src/utils/errors.js";

describe("TLS Enforcer", () => {
  // Store original env var
  const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  });

  describe("enforceTLS", () => {
    it("should throw when TLS validation is disabled", () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      expect(() => enforceTLS()).toThrow(/GSMCP-9001/);
      expect(() => enforceTLS()).toThrow(/TLS validation is disabled/);
    });

    it("should pass when TLS validation is enabled", () => {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      expect(() => enforceTLS()).not.toThrow();
    });

    it("should pass when env var is explicitly set to 1", () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
      expect(() => enforceTLS()).not.toThrow();
    });
  });

  describe("validateDomain - HTTPS requirement", () => {
    it("should accept HTTPS URLs", () => {
      expect(() => validateDomain("https://www.gradescope.com")).not.toThrow();
    });

    it("should reject HTTP URLs", () => {
      expect(() => validateDomain("http://www.gradescope.com")).toThrow(
        GradescopeError
      );
    });

    it("should include protocol in error message", () => {
      try {
        validateDomain("http://www.gradescope.com");
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as GradescopeError).message).toContain("GSMCP-9002");
        expect((error as GradescopeError).message).toContain("http:");
        expect((error as GradescopeError).message).toContain("HTTPS");
      }
    });
  });

  describe("validateDomain - Domain allowlist", () => {
    it("should accept gradescope.com domain", () => {
      expect(() =>
        validateDomain("https://www.gradescope.com/courses/123")
      ).not.toThrow();
    });

    it("should accept gradescope.com subdomain", () => {
      expect(() =>
        validateDomain("https://api.gradescope.com/v1/courses")
      ).not.toThrow();
    });

    it("should accept purdue.edu domain", () => {
      expect(() =>
        validateDomain("https://www.purdue.edu")
      ).not.toThrow();
    });

    it("should accept purdue.edu subdomain", () => {
      expect(() =>
        validateDomain("https://brightspace.purdue.edu")
      ).not.toThrow();
    });

    it("should reject non-allowlisted domain", () => {
      expect(() => validateDomain("https://evil.com")).toThrow(
        GradescopeError
      );
    });

    it("should reject domain that contains allowlisted string", () => {
      // Should not accept gradescope.com.evil.com
      expect(() => validateDomain("https://gradescope.com.evil.com")).toThrow(
        GradescopeError
      );
    });

    it("should include allowed domains in error message", () => {
      try {
        validateDomain("https://evil.com");
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as GradescopeError).message).toContain("GSMCP-9002");
        expect((error as GradescopeError).message).toContain("allowlist");
      }
    });
  });

  describe("validateDomain - Invalid URLs", () => {
    it("should reject malformed URLs", () => {
      expect(() => validateDomain("not-a-url")).toThrow(GradescopeError);
    });

    it("should reject empty URLs", () => {
      expect(() => validateDomain("")).toThrow(GradescopeError);
    });

    it("should include invalid URL in error", () => {
      try {
        validateDomain("not-a-url");
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as GradescopeError).message).toContain("invalid URL");
      }
    });
  });
});
