/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * get_rubric_and_feedback MCP tool implementation.
 * Fetches detailed rubric breakdown and grader feedback for a specific assignment.
 * Supports fuzzy course name matching and assignment name/ID lookup.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse, safeErrorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import type { GradescopeCourse, GradescopeAssignment } from "../../gradescope/types.js";
import { parseCourseJSON, parseCourseHTML } from "../../gradescope/parsers/courses.js";
import { parseAssignmentJSON, parseAssignmentHTML } from "../../gradescope/parsers/assignments.js";
import { parseRubricAndFeedback } from "../../gradescope/parsers/rubric.js";
import { fuzzyMatchCourse } from "../../gradescope/fuzzy-match.js";
import { validateName } from "../../security/input-validator.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Register the get_rubric_and_feedback tool with the MCP server.
 */
export function registerGetRubricAndFeedbackTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "get_rubric_and_feedback",
    {
      title: "Get Rubric and Feedback",
      description:
        "Fetch detailed rubric breakdown and grader feedback for a specific Gradescope assignment. " +
        "Returns per-question rubric items, score breakdowns, and grader comments. " +
        "Accepts course ID or course name (fuzzy match) and assignment ID or name.",
      inputSchema: z.object({
        course: z
          .string()
          .describe("Course ID or course name (fuzzy match, e.g., 'CS 250' or '12345')"),
        assignment: z
          .string()
          .describe("Assignment ID or assignment name (e.g., '54321' or 'Homework 3')"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ course, assignment, forceRefresh }) => {
      try {
        // Validate inputs
        validateName(course, 'course');
        validateName(assignment, 'assignment');

        // 1. Fetch all courses and resolve course via fuzzy match
        const courses = await fetchCourses(gsClient, cache, forceRefresh ?? false);
        const matchedCourse = fuzzyMatchCourse(courses, course);

        if (!matchedCourse) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1031] Could not find a course matching '${course}'`,
              { query: course },
              "Use get_courses to see available courses"
            )
          );
        }

        // 2. Fetch assignments for the matched course
        const assignments = await fetchAssignments(
          gsClient,
          cache,
          matchedCourse.id,
          forceRefresh ?? false
        );

        // 3. Find the assignment by ID or name
        const matchedAssignment = findAssignment(assignments, assignment);

        if (!matchedAssignment) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1032] Could not find assignment matching '${assignment}' in course '${matchedCourse.name}'`,
              { courseId: matchedCourse.id, assignmentQuery: assignment },
              "Use get_grades_and_assignments to see available assignments"
            )
          );
        }

        // 4. Check if assignment has been graded
        if (matchedAssignment.score === undefined) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1033] Assignment '${matchedAssignment.name}' has not been graded yet`,
              { courseId: matchedCourse.id, assignmentId: matchedAssignment.id },
              "Only graded assignments have rubric data available"
            )
          );
        }

        // 5. Fetch submission page HTML
        const submissionPath = `/courses/${matchedCourse.id}/assignments/${matchedAssignment.id}`;
        const html = await gsClient.getText(submissionPath, { forceRefresh: forceRefresh ?? false });

        // 6. Parse rubric and feedback
        const rubricData = parseRubricAndFeedback(html);

        // 7. Build response with assignment context
        const response = {
          course: {
            id: matchedCourse.id,
            name: matchedCourse.name,
            term: matchedCourse.term,
            url: matchedCourse.url,
          },
          assignment: {
            id: matchedAssignment.id,
            name: matchedAssignment.name,
            score: matchedAssignment.score,
            maxScore: matchedAssignment.maxScore,
            dueDate: matchedAssignment.dueDate,
            submissionDate: matchedAssignment.submissionDate,
            lateStatus: matchedAssignment.lateStatus,
            url: matchedAssignment.url,
          },
          rubric: {
            status: rubricData.status,
            assignmentType: rubricData.assignmentType,
            totalScore: rubricData.totalScore ?? matchedAssignment.score,
            totalMaxScore: rubricData.totalMaxScore ?? matchedAssignment.maxScore,
            questionBreakdown: rubricData.questionBreakdown,
            rubricItems: rubricData.rubricItems,
            overallComments: rubricData.overallComments,
            warnings: rubricData.warnings,
          },
          _hint:
            rubricData.status === "no_rubric"
              ? "This assignment has no detailed rubric. Only overall score and comments are available."
              : "Use this rubric data to identify specific point deductions and grader feedback for grade defense analysis.",
        };

        return toolResponse(response, {
          cached: false, // Rubric data not cached separately (always fetched fresh)
          ttl: CACHE_TTLS.grades,
        });
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return safeErrorResponse(error);
      }
    }
  );
}

/**
 * Fetch courses using JSON-first strategy with HTML fallback.
 */
async function fetchCourses(
  gsClient: GradescopeClient,
  cache: TTLCache,
  forceRefresh: boolean
): Promise<GradescopeCourse[]> {
  const cacheKey = "gs:courses";
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached as GradescopeCourse[];
  }

  // Try JSON first
  try {
    const json = await gsClient.getJSON("/courses.json", { forceRefresh: true });
    const courses = parseCourseJSON(json);
    cache.set(cacheKey, courses, CACHE_TTLS.courses);
    return courses;
  } catch (jsonError) {
    log("DEBUG", "JSON course fetch failed, falling back to HTML", jsonError);
  }

  // Fallback to HTML
  const html = await gsClient.getText("/", { forceRefresh: true });
  const courses = parseCourseHTML(html);
  cache.set(cacheKey, courses, CACHE_TTLS.courses);
  return courses;
}

/**
 * Fetch assignments using JSON-first strategy with HTML fallback.
 */
async function fetchAssignments(
  gsClient: GradescopeClient,
  cache: TTLCache,
  courseId: string,
  forceRefresh: boolean
): Promise<GradescopeAssignment[]> {
  const cacheKey = `gs:assignments:${courseId}`;
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached as GradescopeAssignment[];
  }

  const path = `/courses/${courseId}/assignments`;

  // Try JSON first
  try {
    const json = await gsClient.getJSON(`${path}.json`, { forceRefresh: true });
    const assignments = parseAssignmentJSON(json, courseId);
    cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
    return assignments;
  } catch (jsonError) {
    log("DEBUG", `JSON assignment fetch failed for course ${courseId}, falling back to HTML`, jsonError);
  }

  // Fallback to HTML
  const html = await gsClient.getText(path, { forceRefresh: true });
  const assignments = parseAssignmentHTML(html, courseId);
  cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
  return assignments;
}

/**
 * Find assignment by ID or name match.
 * Uses exact ID match first, then exact name match, then normalized name match.
 */
function findAssignment(
  assignments: GradescopeAssignment[],
  query: string
): GradescopeAssignment | undefined {
  // Try exact ID match first
  const byId = assignments.find((a) => a.id === query);
  if (byId) return byId;

  // Try exact name match
  const byExactName = assignments.find(
    (a) => a.name.toLowerCase() === query.toLowerCase()
  );
  if (byExactName) return byExactName;

  // Try normalized name match (remove special chars, collapse whitespace)
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNormalizedName = assignments.find(
    (a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedQuery
  );
  if (byNormalizedName) return byNormalizedName;

  // Try substring match (last resort)
  const bySubstring = assignments.find((a) =>
    a.name.toLowerCase().includes(query.toLowerCase())
  );
  return bySubstring;
}
