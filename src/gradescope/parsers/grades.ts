/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Grade data parsers for Gradescope.
 * Supports both JSON and HTML extraction with per-question breakdown.
 */

import * as cheerio from "cheerio";
import { z } from "zod";
import type { GradescopeGrade, GradeQuestion } from "../types.js";
import { GRADESCOPE_BASE_URL } from "../types.js";
import { ParseError } from "../../utils/errors.js";

/**
 * Zod schema for JSON grade/submission data.
 */
const gradeJsonSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  assignment_id: z.union([z.string(), z.number()]).transform(String).optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  score: z.union([z.string(), z.number()]).nullable().optional(),
  max_score: z.union([z.string(), z.number()]).nullable().optional(),
  total_points: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.string().optional(),
  questions: z
    .array(
      z.object({
        title: z.string().optional(),
        name: z.string().optional(),
        score: z.union([z.string(), z.number()]).nullable().optional(),
        max_score: z.union([z.string(), z.number()]).nullable().optional(),
        weight: z.union([z.string(), z.number()]).nullable().optional(),
      })
    )
    .optional(),
});

/**
 * Parse grade data from Gradescope JSON response.
 *
 * @param data - Raw JSON data
 * @param courseId - Course ID for enrichment
 * @param assignmentId - Assignment ID
 * @returns Grade object
 * @throws {ParseError} If JSON doesn't match expected schema
 */
export function parseGradeJSON(
  data: unknown,
  courseId: string,
  assignmentId: string
): GradescopeGrade {
  const result = gradeJsonSchema.safeParse(data);
  if (!result.success) {
    throw new ParseError(
      "[GSMCP-1019] Failed to parse grade JSON",
      "grade/submission object",
      String(result.error)
    );
  }

  const g = result.data;
  const questions: GradeQuestion[] = (g.questions ?? []).map((q) => ({
    name: q.title ?? q.name ?? "Unknown",
    score: q.score != null ? Number(q.score) : undefined,
    maxScore: q.max_score != null ? Number(q.max_score) : (q.weight != null ? Number(q.weight) : undefined),
  }));

  return {
    assignmentId,
    courseId,
    assignmentName: g.title ?? g.name,
    score: g.score != null ? Number(g.score) : undefined,
    maxScore: g.max_score != null ? Number(g.max_score) : (g.total_points != null ? Number(g.total_points) : undefined),
    status: g.status,
    url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${assignmentId}/submissions`,
    questions,
  };
}

/**
 * Parse grade data from Gradescope HTML submission page.
 * Extracts overall score and per-question breakdown.
 *
 * @param html - Raw HTML content
 * @param courseId - Course ID for enrichment
 * @param assignmentId - Assignment ID
 * @returns Grade object
 */
export function parseGradeHTML(
  html: string,
  courseId: string,
  assignmentId: string
): GradescopeGrade {
  const $ = cheerio.load(html);

  // Extract assignment name
  const assignmentName =
    $(".submissionOutline--header h2, .assignment-title, h1").first().text().trim() || undefined;

  // Extract overall score
  let score: number | undefined;
  let maxScore: number | undefined;
  let status: string | undefined;

  const scoreText =
    $(".submissionOutline--submissionScore, .score, .total-score").first().text().trim();
  const scoreMatch = scoreText.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (scoreMatch) {
    score = parseFloat(scoreMatch[1]);
    maxScore = parseFloat(scoreMatch[2]);
  }

  // Extract status
  status = $(".submissionStatus, .submission-status").first().text().trim() || undefined;

  // Extract per-question breakdown
  const questions: GradeQuestion[] = [];
  $(".questionOutline, .rubricItem--row, tr.question-row").each((_i, el) => {
    const $el = $(el);
    const qName =
      $el.find(".questionOutline--title, .question-title, td:first-child").first().text().trim();
    const qScoreText =
      $el.find(".questionOutline--score, .question-score, td:last-child").first().text().trim();

    if (!qName) return;

    let qScore: number | undefined;
    let qMax: number | undefined;
    const qMatch = qScoreText.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    if (qMatch) {
      qScore = parseFloat(qMatch[1]);
      qMax = parseFloat(qMatch[2]);
    }

    questions.push({ name: qName, score: qScore, maxScore: qMax });
  });

  return {
    assignmentId,
    courseId,
    assignmentName,
    score,
    maxScore,
    status,
    url: `${GRADESCOPE_BASE_URL}/courses/${courseId}/assignments/${assignmentId}/submissions`,
    questions,
  };
}
