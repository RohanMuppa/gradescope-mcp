/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Fuzzy course name matching utility.
 * Resolves course IDs and names to course objects.
 */

import type { GradescopeCourse } from "./types.js";

/**
 * Normalize a string for fuzzy matching by removing spaces, dashes, dots,
 * and converting to lowercase.
 */
function normalize(str: string): string {
  return str.replace(/[\s\-\.]/g, "").toLowerCase();
}

/**
 * Fuzzy match a query string against a list of courses.
 *
 * Matching strategy (in order of precedence):
 * 1. Exact ID match
 * 2. Exact name match (case-insensitive)
 * 3. Normalized match (strip spaces/dashes/dots)
 * 4. Substring match (query contained in name or shortName)
 *
 * @param courses - List of courses to search
 * @param query - Query string (course ID, name, or shortName)
 * @returns Matched course or null if no match found
 */
export function fuzzyMatchCourse(
  courses: GradescopeCourse[],
  query: string
): GradescopeCourse | null {
  if (!query || courses.length === 0) {
    return null;
  }

  const queryLower = query.toLowerCase();
  const queryNormalized = normalize(query);

  // 1. Exact ID match
  for (const course of courses) {
    if (course.id === query) {
      return course;
    }
  }

  // 2. Exact name match (case-insensitive)
  for (const course of courses) {
    if (course.name.toLowerCase() === queryLower) {
      return course;
    }
    if (course.shortName && course.shortName.toLowerCase() === queryLower) {
      return course;
    }
  }

  // 3. Normalized match
  for (const course of courses) {
    const nameLowerNormalized = normalize(course.name);
    const shortNameNormalized = course.shortName ? normalize(course.shortName) : "";

    if (nameLowerNormalized === queryNormalized || shortNameNormalized === queryNormalized) {
      return course;
    }
  }

  // 4. Substring match
  for (const course of courses) {
    const nameLower = course.name.toLowerCase();
    const shortNameLower = course.shortName?.toLowerCase() ?? "";

    if (nameLower.includes(queryLower) || shortNameLower.includes(queryLower)) {
      return course;
    }
  }

  return null;
}
