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

/**
 * Represents a single rubric item or autograder test case.
 * Only applied items are included (deductions/credits that were actually applied).
 */
export interface RubricItem {
  /** Rubric item name or test case name */
  name: string;
  /** Points earned/deducted for this item */
  points: number;
  /** Maximum possible points for this item */
  maxPoints: number;
  /** Whether this deduction/credit was applied (always true - applied only) */
  applied: boolean;
  /** Full rubric item description or test result description */
  description: string;
  /** Grader comment on this specific item (anonymized) */
  comment?: string;
  /** Which question this item belongs to (for grouping into question subtotals) */
  questionName?: string;
}

/**
 * Per-question score subtotal.
 */
export interface QuestionScore {
  /** Question name (e.g., "Q1", "Question 1", "Test Suite: Arrays") */
  name: string;
  /** Points earned on this question */
  score: number;
  /** Maximum points for this question */
  maxScore: number;
  /** Whether this question has been graded */
  status: "graded" | "pending";
}

/**
 * Combined rubric items and feedback for an assignment submission.
 * Handles all assignment types with graceful degradation.
 */
export interface RubricAndFeedback {
  /** Data completeness indicator */
  status: "complete" | "partial" | "pending" | "no_rubric";
  /** Detected assignment type */
  assignmentType: AssignmentType;
  /** Flat list of applied rubric items with questionName field for grouping */
  rubricItems: RubricItem[];
  /** Per-question score subtotals */
  questionBreakdown: QuestionScore[];
  /** Submission-level grader comments (anonymized) */
  overallComments: string[];
  /** Total score for the submission */
  totalScore?: number;
  /** Total max score */
  totalMaxScore?: number;
  /** Issues encountered during parsing (for debugging/transparency) */
  warnings?: string[];
}

/**
 * A single page image from a submission (PDF page or scanned exam image).
 */
export interface SubmissionPage {
  /** 1-indexed page number */
  pageNumber: number;
  /** Raw image buffer (PNG or JPEG) */
  imageBuffer: Buffer;
  /** MIME type of the image */
  mimeType: "image/png" | "image/jpeg";
}

/**
 * Question-to-page mapping from Gradescope submission metadata.
 * Used for targeted page retrieval when analyzing specific questions.
 */
export interface PageMapping {
  /** Question name (e.g., "Q1", "Question 1") */
  questionName: string;
  /** 1-indexed page numbers assigned to this question */
  pageNumbers: number[];
}

/**
 * Parsed submission content metadata from submission page HTML.
 */
export interface SubmissionContent {
  /** URL path to download the submission file (PDF or image) */
  downloadUrl: string;
  /** Content type of the submission */
  contentType: "pdf" | "image";
  /** Total number of pages (if determinable from HTML) */
  totalPages?: number;
  /** Question-to-page mappings (if available from Gradescope outline) */
  pageMappings: PageMapping[] | null;
  /** Individual page image URLs (for scanned exams with per-page images) */
  pageImageUrls?: string[];
}
