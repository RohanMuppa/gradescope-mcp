/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Input validation for MCP tool parameters.
 * Provides format allowlists and path traversal protection.
 */

import { GradescopeError } from "../utils/errors.js";
import * as path from "path";

/**
 * Validate that an ID parameter matches the strict format allowlist.
 * Rejects path traversal attempts, special characters, and overly long inputs.
 *
 * @param value - The ID value to validate
 * @param paramName - The parameter name for error messages
 * @throws GradescopeError with code VALIDATION_ERROR if validation fails
 */
export function validateId(value: string, paramName: string): void {
  const trimmed = value.trim();

  // Check length
  if (trimmed.length === 0 || trimmed.length > 50) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: must be 1-50 characters`,
      { paramName, value: trimmed }
    );
  }

  // Check format: only alphanumeric, underscore, hyphen
  const allowedPattern = /^[a-zA-Z0-9_-]+$/;
  if (!allowedPattern.test(trimmed)) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: only alphanumeric, underscore, and hyphen allowed`,
      { paramName, value: trimmed }
    );
  }

  // Check for path traversal patterns
  if (containsPathTraversal(trimmed)) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: path traversal attempt detected`,
      { paramName, value: trimmed }
    );
  }

  // Check for dangerous characters
  const dangerousChars = ['.', '/', '\\', '<', '>', ':', '"', '|', '?', '*', '\0'];
  for (const char of dangerousChars) {
    if (trimmed.includes(char)) {
      throw new GradescopeError(
        "VALIDATION_ERROR",
        `[GSMCP-9010] Invalid ${paramName}: contains forbidden character '${char}'`,
        { paramName, value: trimmed }
      );
    }
  }
}

/**
 * Validate that a name parameter is safe for use.
 * Rejects path traversal, null bytes, script tags, and overly long inputs.
 *
 * @param value - The name value to validate
 * @param paramName - The parameter name for error messages
 * @throws GradescopeError with code VALIDATION_ERROR if validation fails
 */
export function validateName(value: string, paramName: string): void {
  const trimmed = value.trim();

  // Check length
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: must be 1-200 characters`,
      { paramName, value: trimmed }
    );
  }

  // Check for path traversal
  if (containsPathTraversal(trimmed)) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: path traversal attempt detected`,
      { paramName, value: trimmed }
    );
  }

  // Check for null bytes
  if (trimmed.includes('\0')) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: null byte detected`,
      { paramName, value: trimmed }
    );
  }

  // Check for script tags
  const scriptPattern = /<script[\s\S]*?>[\s\S]*?<\/script>/i;
  if (scriptPattern.test(trimmed)) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid ${paramName}: script tag detected`,
      { paramName, value: trimmed }
    );
  }
}

/**
 * Check if a value contains path traversal patterns.
 * Detects various encoding variants and platform-specific separators.
 *
 * @param value - The value to check
 * @returns true if path traversal pattern detected
 */
export function containsPathTraversal(value: string): boolean {
  // Dot-dot patterns
  if (value.includes('..')) {
    return true;
  }

  // Path separators in suspicious contexts
  const pathSeparators = ['/', '\\'];
  for (const sep of pathSeparators) {
    if (value.includes(sep)) {
      return true;
    }
  }

  // URL-encoded variants
  const encodedPatterns = [
    '%2e%2e',  // ..
    '%252e',   // double-encoded .
    '%2f',     // /
    '%5c',     // \
  ];

  const lowerValue = value.toLowerCase();
  for (const pattern of encodedPatterns) {
    if (lowerValue.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that a file path is within an allowed base directory.
 * Resolves the path and verifies it starts with the allowed base.
 *
 * @param value - The file path to validate
 * @param allowedBase - The allowed base directory (absolute path)
 * @throws GradescopeError with code VALIDATION_ERROR if validation fails
 */
export function validateFilePath(value: string, allowedBase: string): void {
  const resolvedPath = path.resolve(value);
  const resolvedBase = path.resolve(allowedBase);

  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new GradescopeError(
      "VALIDATION_ERROR",
      `[GSMCP-9010] Invalid file path: must be within ${allowedBase}`,
      { path: value, allowedBase }
    );
  }
}
