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
import type { GradescopeAssignment, AssignmentType, LateStatus } from "../types.js";
import { GRADESCOPE_BASE_URL } from "../types.js";
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
    submission_date: z.string().nullable().optional(),
    submitted_at: z.string().nullable().optional(),
    type: z.string().optional(),
    assignment_type: z.string().optional(),
    late: z.union([z.boolean(), z.string()]).nullable().optional(),
    late_status: z.string().optional(),
    status: z.string().optional(),
    score: z.union([z.string(), z.number()]).nullable().optional(),
    max_score: z.union([z.string(), z.number()]).nullable().optional(),
    total_points: z.union([z.string(), z.number()]).nullable().optional(),
  })
);

/**
 * Normalize assignment type string to typed AssignmentType.
 */
function normalizeAssignmentType(raw?: string): AssignmentType {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().trim();

  if (lower.includes("homework") || lower.includes("hw")) return "homework";
  if (lower.includes("exam") || lower.includes("midterm") || lower.includes("final")) return "exam";
  if (lower.includes("lab") || lower.includes("laboratory")) return "lab";
  if (lower.includes("project")) return "project";

  return "unknown";
}

/**
 * Normalize late status from boolean or string to typed LateStatus.
 */
function normalizeLateStatus(raw?: string | boolean | null): LateStatus {
  if (raw === undefined || raw === null) return "unknown";

  if (typeof raw === "boolean") {
    return raw ? "late" : "on_time";
  }

  const lower = String(raw).toLowerCase().trim();
  if (lower === "late" || lower === "overdue") return "late";
  if (lower === "on_time" || lower === "on time" || lower === "submitted") return "on_time";
  if (lower === "missing" || lower === "not submitted") return "missing";

  return "unknown";
}

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
    submissionDate: a.submission_date ?? a.submitted_at ?? undefined,
    assignmentType: normalizeAssignmentType(a.assignment_type ?? a.type),
    lateStatus: normalizeLateStatus(a.late_status ?? a.late),
    status: a.status,
    score: a.score != null ? Number(a.score) : undefined,
    maxScore: a.max_score != null ? Number(a.max_score) : undefined,
    totalPoints: a.total_points != null ? Number(a.total_points) : undefined,
    url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${a.id}`,
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

    // Extract submission date
    let submissionDate: string | undefined;
    const submissionEl = $el.find(".submissionTimeChart--submissionDate, .submission-date, .submitted-at").text().trim();
    if (submissionEl) {
      submissionDate = submissionEl;
    }

    // Extract assignment type from category/type column or name patterns
    let assignmentType: AssignmentType = "unknown";
    const typeText = $el.find(".assignment-type, .category").text().trim();
    if (typeText) {
      assignmentType = normalizeAssignmentType(typeText);
    } else {
      // Try to infer from assignment name
      assignmentType = normalizeAssignmentType(name);
    }

    // Extract late status from badge/indicator
    let lateStatus: LateStatus = "unknown";
    const lateBadge = $el.find(".late-badge, .late-indicator, .status-late").text().trim();
    if (lateBadge) {
      lateStatus = normalizeLateStatus(lateBadge);
    } else if ($el.find(".late, .overdue").length > 0) {
      lateStatus = "late";
    } else if ($el.find(".on-time, .submitted").length > 0) {
      lateStatus = "on_time";
    } else if ($el.find(".missing, .not-submitted").length > 0) {
      lateStatus = "missing";
    }

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
      submissionDate,
      assignmentType,
      lateStatus,
      status,
      score,
      maxScore,
      url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${id}`,
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
        url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${id}`,
      });
    });
  }

  return assignments;
}
