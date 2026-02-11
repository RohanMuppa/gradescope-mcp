/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Course data parsers for Gradescope.
 * Supports both JSON (Rails .json suffix) and HTML (cheerio) extraction.
 */

import * as cheerio from "cheerio";
import { z } from "zod";
import type { GradescopeCourse, CourseRole } from "../types.js";
import { GRADESCOPE_BASE_URL } from "../types.js";
import { ParseError } from "../../utils/errors.js";

/**
 * Zod schema for JSON course data from Gradescope Rails API.
 */
const courseJsonSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    shortname: z.string().optional(),
    name: z.string(),
    term: z.string().optional().default(""),
    year: z.string().optional(),
    role: z.string().optional().default("unknown"),
    instructor: z.string().optional(),
    instructor_name: z.string().optional(),
    enrollment_count: z.number().optional(),
    students_count: z.number().optional(),
  })
);

/**
 * Normalize a role string from Gradescope to a typed CourseRole.
 */
function normalizeRole(raw: string): CourseRole {
  const lower = raw.toLowerCase().trim();
  if (lower === "student") return "student";
  if (lower === "instructor" || lower === "admin") return "instructor";
  if (lower === "ta" || lower === "teaching assistant") return "ta";
  if (lower === "reader" || lower === "grader") return "reader";
  return "unknown";
}

/**
 * Parse course data from Gradescope JSON response.
 * Validates with zod schema and normalizes roles.
 *
 * @returns Array of courses (empty array if input is empty)
 * @throws {ParseError} If JSON structure doesn't match expected schema
 */
export function parseCourseJSON(data: unknown): GradescopeCourse[] {
  const result = courseJsonSchema.safeParse(data);
  if (!result.success) {
    throw new ParseError(
      "[GSMCP-1017] Failed to parse course JSON",
      "array of course objects",
      String(result.error)
    );
  }

  return result.data.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortname,
    term: c.term,
    year: c.year,
    role: normalizeRole(c.role),
    instructorName: c.instructor_name ?? c.instructor,
    enrollmentCount: c.enrollment_count ?? c.students_count,
    url: `${GRADESCOPE_BASE_URL}/courses/${c.id}`,
  }));
}

/**
 * Parse course data from Gradescope HTML dashboard.
 * Uses cheerio to extract course cards from the courses page.
 *
 * @returns Array of courses (empty array if no courses found)
 * @throws {ParseError} If HTML structure is unrecognizable
 */
export function parseCourseHTML(html: string): GradescopeCourse[] {
  const $ = cheerio.load(html);
  const courses: GradescopeCourse[] = [];

  // Gradescope organizes courses in sections by role (Student, Instructor, etc.)
  $(".courseList--coursesForTerm .courseBox").each((_i, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='/courses/']").first();
    const href = link.attr("href") ?? "";
    const idMatch = href.match(/\/courses\/(\d+)/);
    if (!idMatch) return;

    const id = idMatch[1];
    const name = ($el.find(".courseBox--shortname").text().trim() ||
      $el.find(".courseBox--name").text().trim() ||
      link.text().trim());
    const shortName = $el.find(".courseBox--shortname").text().trim() || undefined;

    // Try to extract instructor name
    let instructorName: string | undefined;
    const instructorEl = $el.find(".courseBox--instructor, .instructor-name").text().trim();
    if (instructorEl) {
      instructorName = instructorEl;
    } else {
      // Try pattern matching "Instructor: Name"
      const courseText = $el.text();
      const instructorMatch = courseText.match(/Instructor:\s*([^\n]+)/i);
      if (instructorMatch) {
        instructorName = instructorMatch[1].trim();
      }
    }

    // Try to extract enrollment count
    let enrollmentCount: number | undefined;
    const enrollmentText = $el.find(".courseBox--enrollment, .student-count").text().trim();
    const enrollmentMatch = enrollmentText.match(/(\d+)\s*student/i);
    if (enrollmentMatch) {
      enrollmentCount = parseInt(enrollmentMatch[1], 10);
    }

    // Try to extract term from parent section
    const section = $el.closest(".courseList--coursesForTerm");
    const term = section.find(".courseList--term").text().trim() || "";

    // Extract role from section heading
    const roleSection = $el.closest(".courseList--courseContainer");
    const roleHeading = roleSection.prev("h1, h2, h3").text().trim().toLowerCase();
    let role: CourseRole = "unknown";
    if (roleHeading.includes("student")) role = "student";
    else if (roleHeading.includes("instructor")) role = "instructor";
    else if (roleHeading.includes("ta") || roleHeading.includes("teaching assistant")) role = "ta";
    else if (roleHeading.includes("reader") || roleHeading.includes("grader")) role = "reader";

    courses.push({
      id,
      name: name || `Course ${id}`,
      shortName,
      term,
      role,
      instructorName,
      enrollmentCount,
      url: `${GRADESCOPE_BASE_URL}/courses/${id}`,
    });
  });

  // Fallback: try generic anchor-based extraction if courseBox pattern fails
  if (courses.length === 0) {
    $("a[href*='/courses/']").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const idMatch = href.match(/\/courses\/(\d+)/);
      if (!idMatch) return;

      const id = idMatch[1];
      // Skip duplicates
      if (courses.some((c) => c.id === id)) return;

      const name = $(el).text().trim();
      if (!name) return;

      courses.push({
        id,
        name,
        term: "",
        role: "unknown",
        url: `${GRADESCOPE_BASE_URL}/courses/${id}`,
      });
    });
  }

  return courses;
}
