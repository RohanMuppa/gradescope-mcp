/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * get_grades_and_assignments MCP tool implementation.
 * Merged tool that fetches assignments with inline grade data.
 * Supports fuzzy course name matching, status grouping, and type filtering.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse, safeErrorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import type { GradescopeCourse, GradescopeAssignment, AssignmentType } from "../../gradescope/types.js";
import { parseCourseJSON, parseCourseHTML } from "../../gradescope/parsers/courses.js";
import { parseAssignmentHTML } from "../../gradescope/parsers/assignments.js";
import { parseGradeHTML } from "../../gradescope/parsers/grades.js";
import { fuzzyMatchCourse } from "../../gradescope/fuzzy-match.js";
import { validateName } from "../../security/input-validator.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Register the get_grades_and_assignments tool with the MCP server.
 */
export function registerGetGradesAndAssignmentsTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "get_grades_and_assignments",
    {
      title: "Get Grades and Assignments",
      description:
        "Fetch all assignments for a Gradescope course with grades and per-question breakdown inline. " +
        "Accepts course ID or course name (fuzzy match). Results grouped by status: graded, submitted, upcoming.",
      inputSchema: z.object({
        course: z
          .string()
          .describe("Course ID or course name (fuzzy match, e.g., 'CS 250' or '12345')"),
        type: z
          .enum(["homework", "exam", "lab", "project"])
          .optional()
          .describe("Filter by assignment type"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ course, type, forceRefresh }) => {
      try {
        // Validate inputs
        validateName(course, 'course');

        // 1. Fetch all courses and resolve course via fuzzy match
        const courses = await fetchCourses(gsClient, cache, forceRefresh ?? false);
        const matchedCourse = fuzzyMatchCourse(courses, course);

        if (!matchedCourse) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1023] Could not find a course matching '${course}'`,
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

        // 3. Apply type filter if provided
        let filteredAssignments = assignments;
        if (type) {
          filteredAssignments = assignments.filter((a) => a.assignmentType === type);
        }

        // 4. Fetch grade details for graded assignments (limit to 20 to avoid excessive API calls)
        const gradedAssignments = filteredAssignments.filter((a) => a.score !== undefined);
        const assignmentsToEnrich = gradedAssignments.slice(0, 20);
        const hasMoreGraded = gradedAssignments.length > 20;

        // Enrich assignments with grade details
        const enrichedAssignments = await Promise.all(
          filteredAssignments.map(async (assignment) => {
            // Only fetch grade details for graded assignments within limit
            if (
              assignment.score !== undefined &&
              assignmentsToEnrich.some((a) => a.id === assignment.id)
            ) {
              try {
                const grade = await fetchGrade(
                  gsClient,
                  cache,
                  matchedCourse.id,
                  assignment.id,
                  forceRefresh ?? false
                );
                return { ...assignment, questions: grade.questions };
              } catch (error) {
                // If grade fetch fails, log and continue with assignment data only
                log("DEBUG", `Failed to fetch grade for assignment ${assignment.id}`, error);
                return assignment;
              }
            }
            return assignment;
          })
        );

        // 5. Group assignments by status
        const graded = enrichedAssignments.filter((a) => a.score !== undefined);
        const submitted = enrichedAssignments.filter(
          (a) =>
            a.score === undefined &&
            a.submissionDate !== undefined &&
            (a.status?.toLowerCase().includes("submitted") ||
              a.lateStatus === "on_time" ||
              a.lateStatus === "late")
        );
        const upcoming = enrichedAssignments.filter(
          (a) =>
            a.score === undefined &&
            a.submissionDate === undefined &&
            (a.status?.toLowerCase().includes("not submitted") ||
              a.status?.toLowerCase().includes("upcoming") ||
              a.lateStatus === "missing")
        );

        // 6. Build response
        const response = {
          course: {
            id: matchedCourse.id,
            name: matchedCourse.name,
            term: matchedCourse.term,
            role: matchedCourse.role,
            url: matchedCourse.url,
          },
          graded,
          submitted,
          upcoming,
          summary: {
            total: enrichedAssignments.length,
            graded: graded.length,
            submitted: submitted.length,
            upcoming: upcoming.length,
          },
          _hint:
            "Use analyze_submission with course_id and assignment_id to get AI-powered grade analysis (available in a future update).",
        };

        // Add note if more graded assignments exist
        if (hasMoreGraded) {
          (response as any)._note = `Showing grade details for 20 of ${gradedAssignments.length} graded assignments. Use forceRefresh to fetch updated data.`;
        }

        // Cache metadata
        const assignmentCacheKey = `gs:assignments:${matchedCourse.id}`;
        const meta = cache.getMeta(assignmentCacheKey);

        return toolResponse(response, {
          cached: meta?.cached ?? false,
          cacheAge: meta?.age,
          ttl: CACHE_TTLS.assignments,
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
    if (courses.length > 0) {
      cache.set(cacheKey, courses, CACHE_TTLS.courses);
      return courses;
    }
    log("DEBUG", "JSON endpoint returned empty array, falling back to HTML");
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

  // Fetch course dashboard page — Gradescope renders assignments on /courses/{id}
  // Note: /courses/{id}/assignments.json returns 401 for students (no such API)
  // and /courses/{id}/assignments redirects to / (no such route)
  const html = await gsClient.getText(`/courses/${courseId}`, { forceRefresh: true });
  const assignments = parseAssignmentHTML(html, courseId);
  cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
  return assignments;
}

/**
 * Fetch grade details from assignment submission page.
 * Gradescope redirects /courses/{id}/assignments/{aid} → /courses/{id}/assignments/{aid}/submissions/{sid}
 * The doFetch client follows this redirect automatically.
 */
async function fetchGrade(
  gsClient: GradescopeClient,
  cache: TTLCache,
  courseId: string,
  assignmentId: string,
  forceRefresh: boolean
): Promise<any> {
  const cacheKey = `gs:grades:${courseId}:${assignmentId}`;
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached;
  }

  // Fetch assignment page — Gradescope will redirect to the submission page
  const html = await gsClient.getText(`/courses/${courseId}/assignments/${assignmentId}`, { forceRefresh: true });
  const grade = parseGradeHTML(html, courseId, assignmentId);
  cache.set(cacheKey, grade, CACHE_TTLS.grades);
  return grade;
}
