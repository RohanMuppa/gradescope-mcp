/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * PII scrubber utility for protecting FERPA-relevant data in logs.
 * Redacts personal information including emails, IDs, paths, credentials.
 */

/**
 * PII pattern definitions with replacement strings.
 */
export const PII_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    name: "Email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  {
    name: "Unix file path with username",
    pattern: /\/Users\/[^\/\s]+/g,
    replacement: "/Users/[USER]",
  },
  {
    name: "Windows file path with username",
    pattern: /C:\\Users\\[^\\\s]+/g,
    replacement: "C:\\Users\\[USER]",
  },
  {
    name: "Phone number",
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE]",
  },
  {
    name: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN]",
  },
  {
    name: "Purdue Student ID",
    pattern: /\b0{2,3}\d{7,8}\b/g,
    replacement: "[STUDENT_ID]",
  },
  {
    name: "Gradescope session cookie",
    pattern: /_gradescope_session=[^\s;]+/g,
    replacement: "_gradescope_session=[REDACTED]",
  },
  {
    name: "Bearer token",
    pattern: /Bearer\s+[^\s]+/g,
    replacement: "Bearer [REDACTED]",
  },
  {
    name: "CSRF token",
    pattern: /authenticity_token=[^\s&]+/g,
    replacement: "authenticity_token=[REDACTED]",
  },
];

/**
 * Scrub PII from any input value.
 * Handles strings, errors, objects, and primitives.
 *
 * @param input - Value to scrub (string, Error, object, etc.)
 * @returns Scrubbed string representation
 */
export function scrubPII(input: unknown): string {
  // Handle null/undefined
  if (input == null) {
    return "";
  }

  // Handle Error objects
  if (input instanceof Error) {
    const message = scrubString(input.message);
    const stack = input.stack ? scrubString(input.stack) : "";
    return stack || message;
  }

  // Handle strings
  if (typeof input === "string") {
    return scrubString(input);
  }

  // Handle objects - stringify then scrub
  if (typeof input === "object") {
    try {
      const json = JSON.stringify(input);
      return scrubString(json);
    } catch {
      // Fallback for circular references or non-serializable objects
      return scrubString(String(input));
    }
  }

  // Handle primitives (number, boolean, etc.)
  return scrubString(String(input));
}

/**
 * Apply all PII patterns to a string sequentially.
 */
function scrubString(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep scrub all string values in an object.
 * Returns a new object with scrubbed values.
 *
 * @param obj - Object to scrub
 * @returns Deep clone with all strings scrubbed
 */
export function scrubObject<T>(obj: T): T {
  // Handle null/undefined
  if (obj == null) {
    return obj;
  }

  // Handle primitives
  if (typeof obj !== "object") {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => {
      if (typeof item === "string") {
        return scrubPII(item);
      }
      return scrubObject(item);
    }) as T;
  }

  // Handle objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = scrubPII(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = scrubObject(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
