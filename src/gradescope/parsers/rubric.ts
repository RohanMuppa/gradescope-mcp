/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Rubric and feedback parser for Gradescope.
 * Unified parser that handles all assignment types (homework, exam, programming)
 * with automatic type detection and graceful degradation.
 */

import * as cheerio from "cheerio";
import { z } from "zod";
import type {
  RubricAndFeedback,
  RubricItem,
  QuestionScore,
  AssignmentType,
} from "../types.js";
import { ParseError } from "../../utils/errors.js";

/**
 * Parse rubric items and feedback from Gradescope submission HTML.
 * Automatically detects assignment type and routes to appropriate parser.
 * Handles graceful degradation for assignments without rubrics.
 *
 * @param html - Raw HTML content from submission page
 * @returns Unified rubric and feedback data
 */
export function parseRubricAndFeedback(html: string): RubricAndFeedback {
  const $ = cheerio.load(html);

  // Detect assignment type
  const assignmentType = detectAssignmentType(html);

  // Route to appropriate parser based on type
  let result: { items: RubricItem[]; comments: string[] };
  try {
    switch (assignmentType) {
      case "homework":
        result = parseHomeworkRubric($);
        break;
      case "exam":
        result = parseExamRubric($);
        break;
      case "lab":
      case "project":
        result = parseProgrammingRubric($);
        break;
      case "unknown":
      default:
        result = parseGenericRubric($);
    }
  } catch (error) {
    // If parsing fails entirely, return minimal data with warning
    return {
      status: "no_rubric",
      assignmentType,
      rubricItems: [],
      questionBreakdown: [],
      overallComments: [],
      warnings: [
        `Failed to parse rubric: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  // Anonymize all comments
  result.items = result.items.map((item) => ({
    ...item,
    comment: item.comment ? anonymizeComment(item.comment) : undefined,
  }));
  const anonymizedComments = result.comments.map(anonymizeComment);

  // Compute question-level breakdown
  const questionBreakdown = computeQuestionBreakdown(result.items);

  // Compute totals
  const totalScore = result.items.reduce((sum, item) => sum + item.points, 0);
  const totalMaxScore = result.items.reduce((sum, item) => sum + item.maxPoints, 0);

  // Determine status
  let status: RubricAndFeedback["status"];
  if (result.items.length === 0) {
    status = "no_rubric";
  } else if (questionBreakdown.some((q) => q.status === "pending")) {
    status = "partial";
  } else if (questionBreakdown.every((q) => q.status === "pending")) {
    status = "pending";
  } else {
    status = "complete";
  }

  return {
    status,
    assignmentType,
    rubricItems: result.items,
    questionBreakdown,
    overallComments: anonymizedComments,
    totalScore,
    totalMaxScore,
  };
}

/**
 * Detect assignment type from HTML content.
 * Uses multiple signals: class names, page structure, and content patterns.
 */
function detectAssignmentType(html: string): AssignmentType {
  const $ = cheerio.load(html);

  // Check for programming/autograder indicators
  if (
    html.includes("autograder") ||
    html.includes("test-case") ||
    html.includes("test_case") ||
    $(".autograder-result, .test-results, .test-case").length > 0
  ) {
    return "project";
  }

  // Check for lab indicators
  if (html.includes("lab") || $(".lab-submission").length > 0) {
    return "lab";
  }

  // Check for exam indicators
  if (
    html.includes("exam") ||
    html.includes("midterm") ||
    html.includes("final") ||
    $(".exam-submission, .timed-assessment").length > 0
  ) {
    return "exam";
  }

  // Check for homework indicators
  if (
    html.includes("homework") ||
    html.includes("assignment") ||
    $(".homework-submission, .problem-set").length > 0
  ) {
    return "homework";
  }

  return "unknown";
}

/**
 * Parse homework rubric from HTML.
 * Homework typically has question-based rubrics with manual grading items.
 */
function parseHomeworkRubric(
  $: cheerio.CheerioAPI
): { items: RubricItem[]; comments: string[] } {
  const items: RubricItem[] = [];
  const comments: string[] = [];

  // Try multiple selector patterns for rubric items
  const rubricSelectors = [
    ".rubricItem--row",
    ".rubric-item",
    ".rubricItem",
    "tr.rubric-row",
  ];

  for (const selector of rubricSelectors) {
    $(selector).each((_i, el) => {
      const $el = $(el);

      // Extract rubric item name
      const name =
        $el
          .find(
            ".rubricItem--title, .rubric-item-title, .item-title, td:first-child"
          )
          .first()
          .text()
          .trim() || "Unnamed Item";

      // Extract description
      const description =
        $el
          .find(
            ".rubricItem--description, .rubric-description, .item-description"
          )
          .first()
          .text()
          .trim() || "";

      // Extract points (look for patterns like "-2.5 pts", "+5 pts", "2.5 / 5")
      const pointsText = $el
        .find(".rubricItem--points, .rubric-points, .points, td:last-child")
        .first()
        .text()
        .trim();

      let points = 0;
      let maxPoints = 0;
      let applied = false;

      // Try to parse points in various formats
      const pointsMatch =
        pointsText.match(/([+-]?[\d.]+)\s*pts?/) ||
        pointsText.match(/([+-]?[\d.]+)\s*\/\s*([\d.]+)/) ||
        pointsText.match(/([+-]?[\d.]+)/);

      if (pointsMatch) {
        points = parseFloat(pointsMatch[1]);
        maxPoints = pointsMatch[2] ? parseFloat(pointsMatch[2]) : Math.abs(points);
        applied = $el.hasClass("applied") || $el.hasClass("selected") || true; // Assume applied if present
      }

      // Extract item-level comment
      const comment = $el
        .find(".rubricItem--comment, .item-comment, .grader-comment")
        .first()
        .text()
        .trim();

      // Extract question name from parent context
      const questionName = $el
        .closest(".question-outline, .question")
        .find(".question-title, .questionOutline--title")
        .first()
        .text()
        .trim();

      // Only include if we found valid data
      if (name && !isNaN(points)) {
        items.push({
          name,
          points,
          maxPoints,
          applied,
          description: description || name,
          comment: comment || undefined,
          questionName: questionName || undefined,
        });
      }
    });

    // If we found items, stop trying other selectors
    if (items.length > 0) break;
  }

  // Extract overall comments
  const commentSelectors = [
    ".submissionOutline--comment",
    ".submission-comment",
    ".overall-comment",
    ".grader-overall-comment",
  ];

  for (const selector of commentSelectors) {
    $(selector).each((_i, el) => {
      const text = $(el).text().trim();
      if (text) comments.push(text);
    });
  }

  return { items, comments };
}

/**
 * Parse exam rubric from HTML.
 * Exams may have timed constraints and different rubric structure.
 */
function parseExamRubric(
  $: cheerio.CheerioAPI
): { items: RubricItem[]; comments: string[] } {
  // Exams typically use similar structure to homework but may have additional metadata
  return parseHomeworkRubric($);
}

/**
 * Parse programming assignment rubric from HTML.
 * Programming assignments use autograder test results as rubric items.
 */
function parseProgrammingRubric(
  $: cheerio.CheerioAPI
): { items: RubricItem[]; comments: string[] } {
  const items: RubricItem[] = [];
  const comments: string[] = [];

  // Try to find autograder test results
  const testSelectors = [
    ".autograder-test-case",
    ".test-case",
    ".test-result",
    "tr.test-row",
  ];

  for (const selector of testSelectors) {
    $(selector).each((_i, el) => {
      const $el = $(el);

      // Extract test name
      const name =
        $el
          .find(
            ".test-name, .test-case-name, .test-title, td:first-child"
          )
          .first()
          .text()
          .trim() || "Unnamed Test";

      // Extract test result (pass/fail)
      const resultText = $el
        .find(".test-result, .test-status, .status")
        .first()
        .text()
        .trim()
        .toLowerCase();
      const passed = resultText.includes("pass") || $el.hasClass("passed");

      // Extract points
      const pointsText = $el
        .find(".test-points, .points, td:last-child")
        .first()
        .text()
        .trim();
      const pointsMatch =
        pointsText.match(/([\d.]+)\s*\/\s*([\d.]+)/) ||
        pointsText.match(/([\d.]+)/);

      let points = 0;
      let maxPoints = 0;

      if (pointsMatch) {
        points = passed ? parseFloat(pointsMatch[1]) : 0;
        maxPoints = pointsMatch[2]
          ? parseFloat(pointsMatch[2])
          : parseFloat(pointsMatch[1]);
      }

      // Extract test output/description
      const description =
        $el
          .find(".test-output, .test-description, .output")
          .first()
          .text()
          .trim() || (passed ? "Test passed" : "Test failed");

      if (name && !isNaN(maxPoints)) {
        items.push({
          name,
          points,
          maxPoints,
          applied: true,
          description,
          comment: undefined,
          questionName: undefined,
        });
      }
    });

    if (items.length > 0) break;
  }

  // If no test cases found, fall back to generic parser
  if (items.length === 0) {
    return parseGenericRubric($);
  }

  // Extract overall autograder output
  const outputSelectors = [
    ".autograder-output",
    ".test-output-summary",
    ".overall-output",
  ];

  for (const selector of outputSelectors) {
    $(selector).each((_i, el) => {
      const text = $(el).text().trim();
      if (text) comments.push(text);
    });
  }

  return { items, comments };
}

/**
 * Generic rubric parser for unknown assignment types.
 * Uses best-effort heuristics to extract any rubric-like data.
 */
function parseGenericRubric(
  $: cheerio.CheerioAPI
): { items: RubricItem[]; comments: string[] } {
  const items: RubricItem[] = [];
  const comments: string[] = [];

  // Try to find any table rows that look like rubric items
  $("tr").each((_i, el) => {
    const $el = $(el);
    const cells = $el.find("td");

    if (cells.length >= 2) {
      const name = cells.first().text().trim();
      const pointsText = cells.last().text().trim();

      const pointsMatch =
        pointsText.match(/([+-]?[\d.]+)\s*\/\s*([\d.]+)/) ||
        pointsText.match(/([+-]?[\d.]+)/);

      if (name && pointsMatch) {
        const points = parseFloat(pointsMatch[1]);
        const maxPoints = pointsMatch[2]
          ? parseFloat(pointsMatch[2])
          : Math.abs(points);

        items.push({
          name,
          points,
          maxPoints,
          applied: true,
          description: name,
          comment: undefined,
          questionName: undefined,
        });
      }
    }
  });

  // Extract any comments
  $(".comment, [class*='comment']").each((_i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10) {
      // Filter out very short text
      comments.push(text);
    }
  });

  return { items, comments };
}

/**
 * Remove grader identity from comment text.
 * Strips names, initials, and common grader signatures.
 */
function anonymizeComment(comment: string): string {
  let result = comment;

  // Remove common grader signature patterns
  result = result.replace(/^-+\s*[A-Z]{2,4}\s*$/gim, ""); // "-- AB", "- JD"
  result = result.replace(/\b(?:graded|reviewed)\s+by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/gi, "");
  result = result.replace(/\bTA:\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/gi, "TA");
  result = result.replace(/\bInstructor:\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/gi, "Instructor");

  // Remove initials at start or end of line
  result = result.replace(/^[A-Z]{2,4}:\s*/gm, "");
  result = result.replace(/\s*-+\s*[A-Z]{2,4}\s*$/gm, "");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

/**
 * Compute per-question score subtotals from rubric items.
 * Groups items by questionName and sums points.
 */
function computeQuestionBreakdown(items: RubricItem[]): QuestionScore[] {
  const questionMap = new Map<string, { score: number; maxScore: number }>();

  for (const item of items) {
    const qName = item.questionName || "Overall";
    const existing = questionMap.get(qName) || { score: 0, maxScore: 0 };
    questionMap.set(qName, {
      score: existing.score + item.points,
      maxScore: existing.maxScore + item.maxPoints,
    });
  }

  return Array.from(questionMap.entries()).map(([name, data]) => ({
    name,
    score: data.score,
    maxScore: data.maxScore,
    status: "graded" as const, // Assume graded if we have items
  }));
}
