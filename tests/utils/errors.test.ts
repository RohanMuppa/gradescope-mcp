/**
 * Tests for error classes.
 * Validates error codes, details, JSON serialization, and suggested actions.
 */

import { describe, it, expect } from "vitest";
import {
  GradescopeError,
  ParseError,
  RateLimitedError,
  NetworkError,
  AuthExpiredError,
} from "../../src/utils/errors.js";

describe("GradescopeError", () => {
  it("sets correct error code and message", () => {
    const err = new GradescopeError("AUTH_REQUIRED", "Authentication required");
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.message).toBe("Authentication required");
    expect(err.name).toBe("GradescopeError");
  });

  it("includes details when provided", () => {
    const err = new GradescopeError("VALIDATION_ERROR", "Invalid input", {
      field: "email",
    });
    expect(err.details).toEqual({ field: "email" });
  });

  it("includes suggested action when provided", () => {
    const err = new GradescopeError(
      "AUTH_EXPIRED",
      "Session expired",
      undefined,
      "Please login again"
    );
    expect(err.suggestedAction).toBe("Please login again");
  });

  it("wraps cause error when provided", () => {
    const cause = new Error("Original error");
    const err = new GradescopeError(
      "UNKNOWN_ERROR",
      "Something went wrong",
      undefined,
      undefined,
      cause
    );
    expect(err.cause).toBe(cause);
  });

  it("serializes to JSON correctly", () => {
    const err = new GradescopeError("RATE_LIMITED", "Too many requests", {
      retryAfter: 60,
    });
    const json = err.toJSON();
    expect(json).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
      details: { retryAfter: 60 },
    });
  });
});

describe("ParseError", () => {
  it("sets correct code and details", () => {
    const err = new ParseError("Failed to parse HTML", "div.grade", "nothing");
    expect(err.code).toBe("PARSE_FAILED");
    expect(err.name).toBe("ParseError");
    expect(err.details).toEqual({ expected: "div.grade", found: "nothing" });
    expect(err.suggestedAction).toBe(
      "Gradescope may have changed their UI. Report this error."
    );
  });
});

describe("RateLimitedError", () => {
  it("sets correct code and suggested action", () => {
    const err = new RateLimitedError();
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.name).toBe("RateLimitedError");
    expect(err.suggestedAction).toBe("Wait and retry");
  });

  it("includes retryAfterMs in details when provided", () => {
    const err = new RateLimitedError(5000);
    expect(err.details).toEqual({ retryAfterMs: 5000 });
  });
});

describe("NetworkError", () => {
  it("sets correct code and suggested action", () => {
    const err = new NetworkError("Connection refused");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.name).toBe("NetworkError");
    expect(err.suggestedAction).toBe("Check internet connection and retry");
  });
});

describe("AuthExpiredError", () => {
  it("sets correct code and suggested action", () => {
    const err = new AuthExpiredError();
    expect(err.code).toBe("AUTH_EXPIRED");
    expect(err.name).toBe("AuthExpiredError");
    expect(err.message).toBe("Authentication expired");
    expect(err.suggestedAction).toBe("Run the login tool to re-authenticate");
  });
});
