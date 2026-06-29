/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * get_courses MCP tool implementation.
 * Fetches all courses from Gradescope for the authenticated user.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse, safeErrorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import type { GradescopeCourse } from "../../gradescope/types.js";
import { parseCourseJSON, parseCourseHTML } from "../../gradescope/parsers/courses.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Determine if a term string represents the current semester.
 * Matches if term contains current semester name (Spring/Summer/Fall) and current year.
 * Returns true for empty terms (can't determine, include by default).
 */
function isCurrentSemester(term: string): boolean {
  if (!term || term.trim() === "") {
    return true; // Can't determine, include by default
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Determine current semester based on month
  let currentSemester: string;
  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "spring";
  } else if (currentMonth >= 6 && currentMonth <= 7) {
    currentSemester = "summer";
  } else {
    currentSemester = "fall";
  }

  const termLower = term.toLowerCase();

  // Check if term contains current semester name AND current year
  return termLower.includes(currentSemester) && termLower.includes(String(currentYear));
}

/**
 * Register the get_courses tool with the MCP server.
 */
export function registerGetCoursesTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "get_courses",
    {
      title: "Get Courses",
      description:
        "Fetch all Gradescope courses for the authenticated user. Returns course ID, name, term, role, and URL.",
      inputSchema: z.object({
        includePastSemesters: z
          .boolean()
          .optional()
          .describe("Include courses from past semesters (default: current semester only)"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ includePastSemesters, forceRefresh }) => {
      try {
        let courses = await fetchCourses(gsClient, cache, forceRefresh ?? false);

        // Filter to current semester unless includePastSemesters is true
        if (!includePastSemesters) {
          courses = courses.filter((course) => isCurrentSemester(course.term));
        }

        const meta = cache.getMeta("gs:courses");

        return toolResponse(
          {
            courses,
            count: courses.length,
            _hint: "Use get_grades_and_assignments with a course_id from above to see assignments and grades for that course.",
          },
          {
            cached: meta?.cached ?? false,
            cacheAge: meta?.age,
            ttl: CACHE_TTLS.courses,
          }
        );
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

  // Try JSON first — fall through to HTML if empty or failed
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
