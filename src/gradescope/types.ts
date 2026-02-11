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
 * Base URL for Gradescope.
 */
export const GRADESCOPE_BASE_URL = "https://www.gradescope.com";

/**
 * Role a user holds in a Gradescope course.
 */
export type CourseRole = "student" | "instructor" | "ta" | "reader" | "unknown";

/**
 * Type of assignment.
 */
export type AssignmentType = "homework" | "exam" | "lab" | "project" | "unknown";

/**
 * Late submission status.
 */
export type LateStatus = "on_time" | "late" | "missing" | "unknown";

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
  instructorName?: string;
  enrollmentCount?: number;
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
  submissionDate?: string;
  assignmentType?: AssignmentType;
  lateStatus?: LateStatus;
  status?: string;
  score?: number;
  maxScore?: number;
  totalPoints?: number;
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
  url: string;
  questions: GradeQuestion[];
}
