/**
 * Typed error system with machine-readable codes.
 * All Gradescope-related errors extend GradescopeError.
 */

export type GradescopeErrorCode =
  | "AUTH_EXPIRED"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "PARSE_FAILED"
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Base error class for all Gradescope-related errors.
 * Provides machine-readable error codes and structured error data.
 */
export class GradescopeError extends Error {
  public readonly code: GradescopeErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly suggestedAction?: string;

  constructor(
    code: GradescopeErrorCode,
    message: string,
    details?: Record<string, unknown>,
    suggestedAction?: string,
    cause?: Error
  ) {
    super(message);
    this.name = "GradescopeError";
    this.code = code;
    this.details = details;
    this.suggestedAction = suggestedAction;
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Convert error to JSON-serializable format for MCP responses.
   */
  toJSON(): {
    code: GradescopeErrorCode;
    message: string;
    details?: Record<string, unknown>;
    suggestedAction?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
      ...(this.suggestedAction && { suggestedAction: this.suggestedAction }),
    };
  }
}

/**
 * Error thrown when HTML/JSON parsing fails.
 * Typically indicates Gradescope UI changes.
 */
export class ParseError extends GradescopeError {
  constructor(message: string, expected: string, found: string, cause?: Error) {
    super(
      "PARSE_FAILED",
      message,
      { expected, found },
      "Gradescope may have changed their UI. Report this error.",
      cause
    );
    this.name = "ParseError";
  }
}

/**
 * Error thrown when rate limited by Gradescope.
 */
export class RateLimitedError extends GradescopeError {
  constructor(retryAfterMs?: number) {
    super(
      "RATE_LIMITED",
      "Rate limited by Gradescope",
      retryAfterMs ? { retryAfterMs } : undefined,
      "Wait and retry"
    );
    this.name = "RateLimitedError";
  }
}

/**
 * Error thrown when network request fails.
 */
export class NetworkError extends GradescopeError {
  constructor(message: string, cause?: Error) {
    super(
      "NETWORK_ERROR",
      message,
      undefined,
      "Check internet connection and retry",
      cause
    );
    this.name = "NetworkError";
  }
}

/**
 * Error thrown when authentication has expired.
 */
export class AuthExpiredError extends GradescopeError {
  constructor() {
    super(
      "AUTH_EXPIRED",
      "Authentication expired",
      undefined,
      "Run the login tool to re-authenticate"
    );
    this.name = "AuthExpiredError";
  }
}
