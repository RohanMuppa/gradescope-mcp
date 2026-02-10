/**
 * Gradescope domain types.
 * These are placeholder types that will be expanded in Phase 3.
 */

/**
 * Represents a Gradescope course.
 */
export interface GradescopeCourse {
  id: string;
  name: string;
  term: string;
  role: string;
}

/**
 * Represents a Gradescope assignment.
 */
export interface GradescopeAssignment {
  id: string;
  name: string;
  dueDate?: string;
  status?: string;
  score?: number;
  maxScore?: number;
}

/**
 * Represents a Gradescope grade.
 */
export interface GradescopeGrade {
  assignmentId: string;
  score?: number;
  maxScore?: number;
  status?: string;
}
