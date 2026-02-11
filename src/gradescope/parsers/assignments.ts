/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Assignment data parsers for Gradescope.
 * Supports both JSON and HTML extraction.
 */

import * as cheerio from "cheerio";
import { z } from "zod";
import type { GradescopeAssignment } from "../types.js";
import { ParseError } from "../../utils/errors.js";

/**
 * Zod schema for JSON assignment data.
 */
const assignmentJsonSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().optional(),
    name: z.string().optional(),
    due_date: z.string().nullable().optional(),
    status: z.string().optional(),
    score: z.union([z.string(), z.number()]).nullable().optional(),
    max_score: z.union([z.string(), z.number()]).nullable().optional(),
    total_points: z.union([z.string(), z.number()]).nullable().optional(),
  })
);

/**
 * Parse assignment data from Gradescope JSON response.
 *
 * @param data - Raw JSON data
 * @param courseId - Course ID for enrichment
 * @returns Array of assignments
 * @throws {ParseError} If JSON doesn't match expected schema
 */
export function parseAssignmentJSON(data: unknown, courseId: string): GradescopeAssignment[] {
  const result = assignmentJsonSchema.safeParse(data);
  if (!result.success) {
    throw new ParseError(
      "[GSMCP-1018] Failed to parse assignment JSON",
      "array of assignment objects",
      String(result.error)
    );
  }

  return result.data.map((a) => ({
    id: a.id,
    courseId,
    name: a.title ?? a.name ?? `Assignment ${a.id}`,
    dueDate: a.due_date ?? undefined,
    status: a.status,
    score: a.score != null ? Number(a.score) : undefined,
    maxScore: a.max_score != null ? Number(a.max_score) : (a.total_points != null ? Number(a.total_points) : undefined),
    url: `/courses/${courseId}/assignments/${a.id}`,
  }));
}

/**
 * Parse assignment data from Gradescope HTML page.
 * Extracts from the assignments table on `/courses/{courseId}/assignments`.
 *
 * @param html - Raw HTML content
 * @param courseId - Course ID for enrichment
 * @returns Array of assignments (empty if none found)
 */
export function parseAssignmentHTML(html: string, courseId: string): GradescopeAssignment[] {
  const $ = cheerio.load(html);
  const assignments: GradescopeAssignment[] = [];

  // Gradescope uses a table or list for assignments
  $("tr.assignmentTable--row, tr[data-assignment-id], .assignment-row").each((_i, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='/assignments/']").first();
    const href = link.attr("href") ?? "";
    const idMatch = href.match(/\/assignments\/(\d+)/);

    // Also check data attribute
    const dataId = $el.attr("data-assignment-id");
    const id = idMatch?.[1] ?? dataId;
    if (!id) return;

    const name = link.text().trim() ||
      $el.find(".assignmentTable--name, .assignment-name, td:first-child").text().trim();
    if (!name) return;

    // Extract due date
    const dueDateText = $el.find(".assignmentTable--dueDate, .submissionTimeChart--dueDate, td:nth-child(2)").text().trim();

    // Extract status
    const status = $el.find(".submissionStatus, .assignmentTable--status, td:nth-child(3)").text().trim() || undefined;

    // Extract score
    const scoreText = $el.find(".assignmentTable--score, .submissionStatus--score, td:nth-child(4)").text().trim();
    let score: number | undefined;
    let maxScore: number | undefined;
    const scoreMatch = scoreText.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    if (scoreMatch) {
      score = parseFloat(scoreMatch[1]);
      maxScore = parseFloat(scoreMatch[2]);
    }

    assignments.push({
      id,
      courseId,
      name,
      dueDate: dueDateText || undefined,
      status,
      score,
      maxScore,
      url: `/courses/${courseId}/assignments/${id}`,
    });
  });

  // Fallback: extract from any assignment links
  if (assignments.length === 0) {
    $("a[href*='/assignments/']").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const idMatch = href.match(/\/courses\/\d+\/assignments\/(\d+)/);
      if (!idMatch) return;

      const id = idMatch[1];
      if (assignments.some((a) => a.id === id)) return;

      const name = $(el).text().trim();
      if (!name) return;

      assignments.push({
        id,
        courseId,
        name,
        url: `/courses/${courseId}/assignments/${id}`,
      });
    });
  }

  return assignments;
}
