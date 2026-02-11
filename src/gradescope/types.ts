/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Gradescope domain types.
 * Course, assignment, and grade data models.
 */

/**
 * Role a user holds in a Gradescope course.
 */
export type CourseRole = "student" | "instructor" | "ta" | "reader" | "unknown";

/**
 * Represents a Gradescope course.
 */
export interface GradescopeCourse {
  id: string;
  name: string;
  shortName?: string;
  term: string;
  year?: string;
  role: CourseRole;
  url: string;
}

/**
 * Represents a Gradescope assignment.
 */
export interface GradescopeAssignment {
  id: string;
  courseId: string;
  name: string;
  dueDate?: string;
  status?: string;
  score?: number;
  maxScore?: number;
  url: string;
}

/**
 * Per-question grade breakdown.
 */
export interface GradeQuestion {
  name: string;
  score?: number;
  maxScore?: number;
}

/**
 * Represents a Gradescope grade for a specific assignment.
 */
export interface GradescopeGrade {
  assignmentId: string;
  courseId: string;
  assignmentName?: string;
  score?: number;
  maxScore?: number;
  status?: string;
  questions: GradeQuestion[];
}
