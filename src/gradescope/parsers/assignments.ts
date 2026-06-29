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
 * Parse assignment data from Gradescope course dashboard HTML.
 * Extracts from `#assignments-student-table` on `/courses/{courseId}`.
 *
 * Table structure (as of 2026):
 *   <tr role="row">
 *     <th class="table--primaryLink">  — contains <a> (graded) or <button data-assignment-id> (unsubmitted)
 *     <td class="submissionStatus">    — score div or status text
 *     <td>                             — due date with <time> elements
 *     <td class="hidden-column">       — raw release date
 *     <td class="hidden-column">       — raw due date
 *
 * @param html - Raw HTML content from course dashboard
 * @param courseId - Course ID for enrichment
 * @returns Array of assignments (empty if none found)
 */
export function parseAssignmentHTML(html: string, courseId: string): GradescopeAssignment[] {
  const $ = cheerio.load(html);
  const assignments: GradescopeAssignment[] = [];

  // Each assignment is a <tr role="row"> inside the student table tbody
  $("#assignments-student-table tbody tr[role='row']").each((_i, el) => {
    const $el = $(el);

    // Extract assignment ID and name from <a> (graded/submitted) or <button> (unsubmitted)
    let id: string | undefined;
    let name: string | undefined;

    const link = $el.find("a[href*='/assignments/']").first();
    if (link.length) {
      const href = link.attr("href") ?? "";
      const idMatch = href.match(/\/assignments\/(\d+)/);
      id = idMatch?.[1];
      name = link.text().trim();
    } else {
      // Unsubmitted assignments use a <button> with data-assignment-id
      const btn = $el.find("button[data-assignment-id]").first();
      if (btn.length) {
        id = btn.attr("data-assignment-id");
        name = btn.attr("data-assignment-title") || btn.text().trim();
      }
    }

    if (!id || !name) return;

    // Extract score from submissionStatus--score div (e.g., "100.0 / 50.0")
    let score: number | undefined;
    let maxScore: number | undefined;
    const scoreText = $el.find(".submissionStatus--score").text().trim();
    const scoreMatch = scoreText.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    if (scoreMatch) {
      score = parseFloat(scoreMatch[1]);
      maxScore = parseFloat(scoreMatch[2]);
    }

    // Extract status text (e.g., "Submitted", "No Submission")
    const statusText = $el.find(".submissionStatus--text").text().trim() || undefined;

    // Extract due date from <time class="submissionTimeChart--dueDate"> datetime attribute
    const dueDateEl = $el.find("time.submissionTimeChart--dueDate").first();
    const dueDate = dueDateEl.attr("datetime") || dueDateEl.text().trim() || undefined;

    // Determine late status from status indicators
    let lateStatus: LateStatus = "unknown";
    if (statusText) {
      const lower = statusText.toLowerCase();
      if (lower.includes("no submission")) {
        lateStatus = "missing";
      } else if (lower.includes("submitted")) {
        lateStatus = "on_time";
      }
    }
    const lateStatusEl = $el.find(".submissionTimeChart--lateStatus").text().trim();
    if (lateStatusEl.toLowerCase().includes("late")) {
      lateStatus = "late";
    }
    // If has a score, consider it submitted
    if (score !== undefined && lateStatus === "unknown") {
      lateStatus = "on_time";
    }

    // Infer assignment type from name
    const assignmentType = normalizeAssignmentType(name);

    assignments.push({
      id,
      courseId,
      name,
      dueDate,
      assignmentType,
      lateStatus,
      status: statusText ?? (score !== undefined ? "Graded" : undefined),
      score,
      maxScore,
      url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${id}`,
    });
  });

  // Fallback: extract from any assignment links if table parsing found nothing
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
