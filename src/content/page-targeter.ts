// Copyright (c) 2026 Rohan Muppa
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of gradescope-mcp.
// See LICENSE file for full license text.
// Error fingerprint: GSMCP

import type { PageMapping } from "../gradescope/types.js";
import { log } from "../utils/logger.js";

export const DEFAULT_PAGE_CAP = 10; // Claude's discretion: 10-page hard cap for cost management

/**
 * Determine which pages to fetch/convert based on optional question targeting.
 * Supports two modes:
 *   1. Question-targeted: when `question` param provided AND page mappings exist,
 *      returns only the pages mapped to that question
 *   2. Full submission: when no question specified or no mappings available,
 *      returns all pages up to hard cap
 *
 * @param totalPages - Total number of pages in the submission
 * @param question - Optional question name to target (e.g., "Q3", "Question 1")
 * @param pageMappings - Optional question-to-page mappings from submission parser
 * @param pageCap - Maximum pages to return (default 10)
 * @returns Array of 1-indexed page numbers to process
 */
export function determineTargetPages(
  totalPages: number,
  question?: string,
  pageMappings?: PageMapping[] | null,
  pageCap: number = DEFAULT_PAGE_CAP
): number[] {
  // Edge case: invalid totalPages
  if (totalPages <= 0) {
    log("WARN", "Invalid totalPages <= 0, defaulting to page 1");
    return [1];
  }

  // Edge case: no page cap
  if (pageCap <= 0) {
    // Return all pages without cap
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // Mode 1: Question-targeted
  if (question && pageMappings && pageMappings.length > 0) {
    // Try to find exact match (case-insensitive)
    let mapping = pageMappings.find(
      (m) => m.questionName.toLowerCase() === question.toLowerCase()
    );

    // If not found, try normalized match (strip non-alphanumeric)
    if (!mapping) {
      const normalizedQuestion = question.replace(/[^a-z0-9]/gi, "").toLowerCase();
      mapping = pageMappings.find(
        (m) => m.questionName.replace(/[^a-z0-9]/gi, "").toLowerCase() === normalizedQuestion
      );
    }

    if (mapping) {
      // Found mapping - return those pages (capped)
      return mapping.pageNumbers.slice(0, pageCap);
    }

    // Question specified but not found in mappings
    log(
      "WARN",
      `Question "${question}" not found in page mappings, falling back to all pages`
    );
  }

  // Mode 2: Full submission (fallback)
  const maxPage = Math.min(totalPages, pageCap);
  return Array.from({ length: maxPage }, (_, i) => i + 1);
}
