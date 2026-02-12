/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Tests for PII scrubbing functionality.
 * Verifies FERPA-relevant data redaction in logs and error messages.
 */

import { describe, it, expect } from "vitest";
import { scrubPII, scrubObject } from "../../src/security/pii-scrubber.js";

describe("PII Scrubber", () => {
  describe("Email redaction", () => {
    it("should redact email addresses", () => {
      const input = "User email is john@purdue.edu";
      const result = scrubPII(input);
      expect(result).toBe("User email is [EMAIL]");
    });

    it("should redact multiple emails", () => {
      const input = "Contact alice@example.com or bob@test.org";
      const result = scrubPII(input);
      expect(result).toBe("Contact [EMAIL] or [EMAIL]");
    });
  });

  describe("File path redaction", () => {
    it("should redact Unix file paths with usernames", () => {
      const input = "File at /Users/rohanmuppa/Documents/file.txt";
      const result = scrubPII(input);
      expect(result).toBe("File at /Users/[USER]/Documents/file.txt");
    });

    it("should redact Windows file paths with usernames", () => {
      const input = "Path C:\\Users\\rohanmuppa\\Documents\\file.txt";
      const result = scrubPII(input);
      expect(result).toBe("Path C:\\Users\\[USER]\\Documents\\file.txt");
    });
  });

  describe("Phone number redaction", () => {
    it("should redact phone numbers with hyphens", () => {
      const input = "Call 765-555-1234 for support";
      const result = scrubPII(input);
      expect(result).toBe("Call [PHONE] for support");
    });

    it("should redact phone numbers with dots", () => {
      const input = "Phone: 765.555.1234";
      const result = scrubPII(input);
      expect(result).toBe("Phone: [PHONE]");
    });

    it("should redact phone numbers with spaces", () => {
      const input = "Contact: 765 555 1234";
      const result = scrubPII(input);
      expect(result).toBe("Contact: [PHONE]");
    });
  });

  describe("SSN redaction", () => {
    it("should redact Social Security Numbers", () => {
      const input = "SSN: 123-45-6789";
      const result = scrubPII(input);
      expect(result).toBe("SSN: [SSN]");
    });
  });

  describe("Session cookie redaction", () => {
    it("should redact Gradescope session cookies", () => {
      const input = "Cookie: _gradescope_session=abc123def456";
      const result = scrubPII(input);
      expect(result).toBe("Cookie: _gradescope_session=[REDACTED]");
    });
  });

  describe("Token redaction", () => {
    it("should redact Bearer tokens", () => {
      const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const result = scrubPII(input);
      expect(result).toBe("Authorization: Bearer [REDACTED]");
    });

    it("should redact CSRF tokens", () => {
      const input = "Form data: authenticity_token=abc123def456";
      const result = scrubPII(input);
      expect(result).toBe("Form data: authenticity_token=[REDACTED]");
    });
  });

  describe("Error object scrubbing", () => {
    it("should scrub PII from Error message", () => {
      const error = new Error("Login failed for john@purdue.edu");
      const result = scrubPII(error);
      expect(result).toContain("Login failed for [EMAIL]");
    });

    it("should scrub PII from Error stack", () => {
      const error = new Error("Failed at /Users/testuser/app.js");
      error.stack = "Error: Failed at /Users/testuser/app.js\n    at main";
      const result = scrubPII(error);
      expect(result).toContain("/Users/[USER]/app.js");
    });
  });

  describe("Null/undefined handling", () => {
    it("should handle null input", () => {
      const result = scrubPII(null);
      expect(result).toBe("");
    });

    it("should handle undefined input", () => {
      const result = scrubPII(undefined);
      expect(result).toBe("");
    });
  });

  describe("Mixed PII content", () => {
    it("should scrub all PII types from mixed content", () => {
      const input = "User john@purdue.edu (SSN: 123-45-6789) called from 765-555-1234";
      const result = scrubPII(input);
      expect(result).toBe("User [EMAIL] (SSN: [SSN]) called from [PHONE]");
    });

    it("should scrub PII from JSON objects", () => {
      const obj = { email: "test@example.com", phone: "765-555-1234" };
      const result = scrubPII(obj);
      expect(result).toContain("[EMAIL]");
      expect(result).toContain("[PHONE]");
    });
  });

  describe("False positive prevention", () => {
    it("should not redact normal text", () => {
      const input = "This is a normal message with no PII";
      const result = scrubPII(input);
      expect(result).toBe(input);
    });

    it("should not redact domain names without @ symbol", () => {
      const input = "Visit example.com for more info";
      const result = scrubPII(input);
      expect(result).toBe(input);
    });

    it("should not redact version numbers that look like phones", () => {
      const input = "Version 1.2.3 released";
      const result = scrubPII(input);
      expect(result).toBe(input);
    });
  });

  describe("scrubObject deep scrubbing", () => {
    it("should scrub strings in nested objects", () => {
      const obj = {
        user: {
          email: "alice@purdue.edu",
          contact: { phone: "765-555-1234" },
        },
      };
      const result = scrubObject(obj);
      expect(result.user.email).toBe("[EMAIL]");
      expect(result.user.contact.phone).toBe("[PHONE]");
    });

    it("should scrub strings in arrays", () => {
      const obj = {
        emails: ["alice@purdue.edu", "bob@example.com"],
      };
      const result = scrubObject(obj);
      expect(result.emails[0]).toBe("[EMAIL]");
      expect(result.emails[1]).toBe("[EMAIL]");
    });

    it("should preserve non-string values", () => {
      const obj = {
        count: 42,
        active: true,
        data: null,
      };
      const result = scrubObject(obj);
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.data).toBe(null);
    });
  });
});
