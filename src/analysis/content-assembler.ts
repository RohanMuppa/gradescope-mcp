// Copyright (c) 2026 Rohan Muppa
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of gradescope-mcp.
// See LICENSE file for full license text.
// Error fingerprint: GSMCP

/**
 * Multimodal content assembler for analysis.
 * Combines submission page images with analysis prompt text into properly ordered MCP content blocks.
 * Images appear BEFORE text instructions per Claude vision best practices.
 */

import type { TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import type {
  SubmissionPage,
  QuestionScore,
  RubricAndFeedback,
  PageMapping,
} from "../gradescope/types.js";
import { determineTargetPages } from "../content/page-targeter.js";
import { log } from "../utils/logger.js";

/**
 * Identify questions where points were lost.
 * Per locked decision: only analyze questions where points were lost.
 * Skip full-mark questions entirely for cost efficiency.
 *
 * @param rubricData - Rubric and feedback data for the submission
 * @returns Array of questions with lost points (score < maxScore)
 */
export function identifyLostPointQuestions(
  rubricData: RubricAndFeedback
): QuestionScore[] {
  return rubricData.questionBreakdown.filter(
    (q) => q.score < q.maxScore && q.status === "graded"
  );
}

/**
 * Collect target pages for all lost-point questions.
 * Merges page numbers from all lost-point questions into a deduplicated, sorted array.
 * Falls back to all pages (up to cap) if no page mappings exist.
 *
 * @param lostPointQuestions - Questions where points were lost
 * @param totalPages - Total number of pages in submission
 * @param pageMappings - Optional question-to-page mappings from submission parser
 * @returns Sorted array of unique page numbers to include
 */
export function collectTargetPages(
  lostPointQuestions: QuestionScore[],
  totalPages: number,
  pageMappings: PageMapping[] | null
): number[] {
  // If no page mappings, fall back to all pages (with default cap)
  if (!pageMappings || pageMappings.length === 0) {
    log("DEBUG", "No page mappings available, using all pages up to default cap");
    return determineTargetPages(totalPages, undefined, null);
  }

  // Collect pages for each lost-point question
  const pageSet = new Set<number>();
  for (const question of lostPointQuestions) {
    // Pass Infinity for pageCap since we don't want per-question capping here
    // We want all relevant pages for analysis
    const pages = determineTargetPages(totalPages, question.name, pageMappings, Infinity);
    pages.forEach((p) => pageSet.add(p));
  }

  // Convert to sorted array
  const targetPages = Array.from(pageSet).sort((a, b) => a - b);

  log(
    "DEBUG",
    `Collected ${targetPages.length} target pages for ${lostPointQuestions.length} lost-point questions`
  );

  return targetPages;
}

/**
 * Assemble multimodal content blocks for analysis.
 * Orders content as: brief context text → page images with labels → analysis prompt.
 * Images appear FIRST (before analysis prompt) per Claude vision best practices.
 *
 * @param submissionPages - Already-fetched submission page images
 * @param analysisPrompt - Full analysis prompt text with rubric data
 * @param metadata - Context metadata for the analysis
 * @returns Array of MCP content blocks (text + images) in optimal order
 */
export function assembleAnalysisContent(
  submissionPages: SubmissionPage[],
  analysisPrompt: string,
  metadata: {
    courseName: string;
    assignmentName: string;
    totalPages: number;
    pagesIncluded: number;
    questionsAnalyzed: number;
  }
): Array<TextContent | ImageContent> {
  const contentBlocks: Array<TextContent | ImageContent> = [];

  // 1. Brief context text block (first)
  const contextText = `Grade defense analysis for ${metadata.assignmentName} (${metadata.courseName}). Analyzing ${metadata.questionsAnalyzed} questions across ${metadata.pagesIncluded} of ${metadata.totalPages} pages.`;

  contentBlocks.push({
    type: "text" as const,
    text: contextText,
  });

  // 2. Page images with labels (images FIRST per Claude vision best practices)
  for (const page of submissionPages) {
    // Page label before image
    contentBlocks.push({
      type: "text" as const,
      text: `--- Page ${page.pageNumber} ---`,
    });

    // Image block
    contentBlocks.push({
      type: "image" as const,
      data: page.imageBuffer.toString("base64"),
      mimeType: page.mimeType,
    });

    // CRITICAL: Release buffer for GC after encoding to base64
    // Same pattern as multimodal-formatter.ts
    (page as any).imageBuffer = null;
  }

  // 3. Analysis prompt text block (LAST)
  contentBlocks.push({
    type: "text" as const,
    text: analysisPrompt,
  });

  log(
    "DEBUG",
    `Assembled ${contentBlocks.length} content blocks (${submissionPages.length} pages included)`
  );

  return contentBlocks;
}
