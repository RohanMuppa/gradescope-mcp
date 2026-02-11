/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

// GSMCP error fingerprint: All ParseErrors include [GSMCP-1001] prefix

/**
 * Regrade deadline detection parser for Gradescope assignment pages.
 * Uses multi-selector fallback strategy to handle Gradescope HTML variations.
 */

import * as cheerio from "cheerio";
import type { DeadlineInfo } from "../types.js";
import { log } from "../../utils/logger.js";

/**
 * Parse assignment detail page HTML to extract regrade deadline status.
 * Uses multi-selector fallback strategy since exact Gradescope selectors are unknown.
 * Gracefully degrades to "unknown" when deadline cannot be detected.
 *
 * @param html - Raw HTML content from assignment page
 * @returns DeadlineInfo with status, dates, and countdown
 */
export function detectRegradeDeadline(html: string): DeadlineInfo {
  const $ = cheerio.load(html);

  // Try multiple selectors in order (first non-empty text wins)
  const selectors = [
    ".regrade-deadline",
    ".regrade-window",
    ".regrade-info",
    ".submissionRegradePanel",
    ".regradePanel",
  ];

  let deadlineText = "";

  // Try CSS selectors first
  for (const selector of selectors) {
    const element = $(selector);
    if (element.length > 0) {
      const text = element.text().trim();
      if (text) {
        deadlineText = text;
        break;
      }
    }
  }

  // Try data attribute
  if (!deadlineText) {
    const dataElement = $("[data-regrade-deadline]");
    if (dataElement.length > 0) {
      const dataValue = dataElement.attr("data-regrade-deadline");
      if (dataValue) {
        deadlineText = dataValue.trim();
      }
    }
  }

  // Fallback: search for any element containing "regrade" in common containers
  if (!deadlineText) {
    const containers = [".sidebar", ".assignment-details", ".submission-sidebar"];
    for (const container of containers) {
      $(container)
        .find("*")
        .each((_, element) => {
          const text = $(element).text().trim();
          if (text.toLowerCase().includes("regrade") && text.length < 200) {
            deadlineText = text;
            return false; // Break out of .each()
          }
        });
      if (deadlineText) break;
    }
  }

  // No text found - return unknown
  if (!deadlineText) {
    log("DEBUG", "No regrade deadline text found in HTML");
    return {
      status: "unknown",
      absolute: null,
      relative: null,
      deadlineDate: null,
    };
  }

  // Check if deadline is closed
  if (deadlineText.toLowerCase().includes("closed")) {
    return {
      status: "closed",
      absolute: null,
      relative: null,
      deadlineDate: null,
    };
  }

  // Try parsing a date from the text
  const datePatterns = [
    /until\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, // "until Feb 15, 2026"
    /by\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, // "by Feb 15, 2026"
    /deadline:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, // "deadline: Feb 15, 2026"
    /(\d{4}-\d{2}-\d{2})/, // ISO date "2026-02-15"
    /(\d{1,2}\/\d{1,2}\/\d{4})/, // US date "2/15/2026"
  ];

  let parsedDate: Date | null = null;
  let dateString = "";

  for (const pattern of datePatterns) {
    const match = deadlineText.match(pattern);
    if (match) {
      dateString = match[1] || match[0];
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        parsedDate = date;
        break;
      }
    }
  }

  // No date parsed - return unknown
  if (!parsedDate) {
    log(
      "DEBUG",
      `Could not parse date from deadline text: "${deadlineText.substring(0, 100)}"`
    );
    return {
      status: "unknown",
      absolute: null,
      relative: null,
      deadlineDate: null,
    };
  }

  // Calculate days remaining
  const now = new Date();
  const daysRemaining = Math.floor(
    (parsedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If expired, mark as closed
  if (daysRemaining < 0) {
    return {
      status: "closed",
      absolute: null,
      relative: null,
      deadlineDate: null,
    };
  }

  // Format relative countdown
  let relative: string;
  if (daysRemaining === 0) {
    relative = "expires today";
  } else if (daysRemaining === 1) {
    relative = "1 day left";
  } else {
    relative = `${daysRemaining} days left`;
  }

  // Format absolute date
  const absolute = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);

  return {
    status: "open",
    absolute,
    relative,
    deadlineDate: parsedDate,
  };
}

/**
 * Format deadline for user-facing display.
 *
 * @param deadline - DeadlineInfo object from detectRegradeDeadline
 * @returns Formatted deadline string
 */
export function formatDeadline(deadline: DeadlineInfo): string {
  switch (deadline.status) {
    case "open":
      return `${deadline.absolute} (${deadline.relative})`;
    case "closed":
      return "Closed";
    case "unknown":
      return "Unknown -- check with instructor";
  }
}
