/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Tests for input validation functionality.
 * Verifies ID/name format allowlists and path traversal protection.
 */

import { describe, it, expect } from "vitest";
import {
  validateId,
  validateName,
  containsPathTraversal,
} from "../../src/security/input-validator.js";
import { GradescopeError } from "../../src/utils/errors.js";

describe("Input Validator", () => {
  describe("validateId", () => {
    it("should accept valid alphanumeric ID", () => {
      expect(() => validateId("12345", "courseId")).not.toThrow();
    });

    it("should accept ID with underscores and hyphens", () => {
      expect(() => validateId("course_123-abc", "courseId")).not.toThrow();
    });

    it("should reject path traversal attempts", () => {
      expect(() => validateId("../../../etc/passwd", "courseId")).toThrow(
        GradescopeError
      );
    });

    it("should reject script injection", () => {
      expect(() => validateId("<script>alert(1)</script>", "courseId")).toThrow(
        GradescopeError
      );
    });

    it("should reject null byte", () => {
      expect(() => validateId("test\0null", "courseId")).toThrow(
        GradescopeError
      );
    });

    it("should reject overly long input (>50 chars)", () => {
      const longId = "a".repeat(51);
      expect(() => validateId(longId, "courseId")).toThrow(GradescopeError);
    });

    it("should reject empty string", () => {
      expect(() => validateId("", "courseId")).toThrow(GradescopeError);
    });

    it("should reject IDs with dots", () => {
      expect(() => validateId("course.123", "courseId")).toThrow(
        GradescopeError
      );
    });

    it("should reject IDs with slashes", () => {
      expect(() => validateId("course/123", "courseId")).toThrow(
        GradescopeError
      );
    });
  });

  describe("validateName", () => {
    it("should accept normal assignment name", () => {
      expect(() => validateName("Homework 1", "assignmentName")).not.toThrow();
    });

    it("should accept names with special characters", () => {
      expect(() =>
        validateName("CS 180 - Lab #3 (Part A)", "assignmentName")
      ).not.toThrow();
    });

    it("should reject path traversal", () => {
      expect(() =>
        validateName("../../../etc/passwd", "assignmentName")
      ).toThrow(GradescopeError);
    });

    it("should reject null byte", () => {
      expect(() => validateName("test\0null", "assignmentName")).toThrow(
        GradescopeError
      );
    });

    it("should reject script tags", () => {
      expect(() =>
        validateName("<script>alert('xss')</script>", "assignmentName")
      ).toThrow(GradescopeError);
    });

    it("should reject overly long input (>200 chars)", () => {
      const longName = "a".repeat(201);
      expect(() => validateName(longName, "assignmentName")).toThrow(
        GradescopeError
      );
    });

    it("should reject empty string", () => {
      expect(() => validateName("", "assignmentName")).toThrow(
        GradescopeError
      );
    });

    it("should trim whitespace before validation", () => {
      expect(() => validateName("  Valid Name  ", "assignmentName")).not.toThrow();
    });
  });

  describe("containsPathTraversal", () => {
    it("should detect dot-dot pattern", () => {
      expect(containsPathTraversal("..")).toBe(true);
      expect(containsPathTraversal("../config")).toBe(true);
    });

    it("should detect forward slash", () => {
      expect(containsPathTraversal("test/path")).toBe(true);
    });

    it("should detect backslash", () => {
      expect(containsPathTraversal("test\\path")).toBe(true);
    });

    it("should detect URL-encoded dot-dot", () => {
      expect(containsPathTraversal("%2e%2e")).toBe(true);
      expect(containsPathTraversal("%2E%2E")).toBe(true);
    });

    it("should detect double-encoded dot", () => {
      expect(containsPathTraversal("%252e")).toBe(true);
    });

    it("should detect URL-encoded slashes", () => {
      expect(containsPathTraversal("%2f")).toBe(true);
      expect(containsPathTraversal("%5c")).toBe(true);
    });

    it("should return false for safe input", () => {
      expect(containsPathTraversal("homework123")).toBe(false);
      expect(containsPathTraversal("CS-180-Lab-3")).toBe(false);
    });
  });
});
