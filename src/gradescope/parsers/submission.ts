/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Submission page parser for Gradescope.
 * Extracts download URLs, page mappings, and submission metadata.
 */

import * as cheerio from "cheerio";
import type { SubmissionContent, PageMapping } from "../types.js";
import { ParseError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Parse submission page HTML to extract download URLs and metadata.
 * Handles both PDF submissions and scanned exam images with graceful degradation.
 *
 * @param html - Raw HTML content from submission page
 * @returns Submission content metadata
 * @throws ParseError if no download URL found
 */
export function parseSubmissionPage(html: string): SubmissionContent {
  const $ = cheerio.load(html);

  // Extract download URL
  const downloadUrl = extractDownloadUrl($);
  if (!downloadUrl) {
    throw new ParseError(
      "No submission download URL found",
      "download link",
      "none"
    );
  }

  // Determine content type from URL
  const contentType = determineContentType(downloadUrl);

  // Extract optional metadata with graceful degradation
  const totalPages = extractTotalPages($);
  const pageMappings = extractPageMappings($);
  const pageImageUrls = extractPageImageUrls($);

  return {
    downloadUrl,
    contentType,
    totalPages,
    pageMappings,
    pageImageUrls,
  };
}

/**
 * Extract submission download URL from HTML.
 * Tries multiple strategies to locate the download link.
 */
function extractDownloadUrl($: cheerio.CheerioAPI): string | null {
  // Strategy 1: Look for download link with explicit download attribute
  let downloadLink = $('a[download], a[href*="download"]').attr("href");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 2: Look for links with .pdf extension
  downloadLink = $('a[href$=".pdf"]').attr("href");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 3: Look for submission-related links
  downloadLink = $('a[href*="/submissions/"]').filter((_, el) => {
    const href = $(el).attr("href") || "";
    return href.includes(".pdf") || href.includes("download");
  }).attr("href");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 4: Look for data attributes
  downloadLink = $('[data-download-url]').attr("data-download-url") ||
                 $('[data-submission-url]').attr("data-submission-url");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 5: Look for iframe or embed with PDF
  downloadLink = $('iframe[src*=".pdf"], embed[src*=".pdf"]').attr("src");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 6: Look for download button/link classes
  downloadLink = $('.download-link, .submission-download, .pdf-download')
    .attr("href");
  if (downloadLink) {
    return downloadLink;
  }

  // Strategy 7: Look for any link with text containing "download"
  downloadLink = $('a').filter((_, el) => {
    const text = $(el).text().toLowerCase();
    return text.includes("download");
  }).attr("href");
  if (downloadLink) {
    return downloadLink;
  }

  return null;
}

/**
 * Determine content type from URL pattern.
 */
function determineContentType(url: string): "pdf" | "image" {
  const lowerUrl = url.toLowerCase();

  // Check for PDF indicators
  if (lowerUrl.endsWith(".pdf") || lowerUrl.includes("application/pdf")) {
    return "pdf";
  }

  // Check for image indicators
  if (
    lowerUrl.endsWith(".jpg") ||
    lowerUrl.endsWith(".jpeg") ||
    lowerUrl.endsWith(".png") ||
    lowerUrl.includes("image/")
  ) {
    return "image";
  }

  // Default to PDF (most common on Gradescope)
  return "pdf";
}

/**
 * Extract total page count from HTML.
 * Returns undefined if not determinable.
 */
function extractTotalPages($: cheerio.CheerioAPI): number | undefined {
  // Strategy 1: Look for data attribute
  const dataPages = $('[data-num-pages]').attr("data-num-pages");
  if (dataPages) {
    const parsed = parseInt(dataPages, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Strategy 2: Look for page count element
  const pageCountText = $('.page-count, .total-pages').text();
  if (pageCountText) {
    const match = pageCountText.match(/(\d+)\s*pages?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Strategy 3: Look for "Page X of Y" pattern
  const pageNavText = $('.page-navigation, .page-selector').text();
  const pageOfMatch = pageNavText.match(/page\s*\d+\s*of\s*(\d+)/i);
  if (pageOfMatch) {
    return parseInt(pageOfMatch[1], 10);
  }

  // Strategy 4: Count page selector options
  const pageOptions = $('.page-selector option, select[name*="page"] option');
  if (pageOptions.length > 0) {
    return pageOptions.length;
  }

  // Strategy 5: Look for page navigation buttons
  const lastPageButton = $('.page-nav .last, .pagination .last').attr("data-page");
  if (lastPageButton) {
    const parsed = parseInt(lastPageButton, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  log("WARN", "Could not determine total page count from submission HTML");
  return undefined;
}

/**
 * Extract question-to-page mappings from Gradescope outline.
 * Returns null if no mappings found (not an error - some assignments don't have outlines).
 */
function extractPageMappings($: cheerio.CheerioAPI): PageMapping[] | null {
  const mappings: PageMapping[] = [];

  // Strategy 1: Look for data attributes on question outline
  $('[data-question][data-pages]').each((_, el) => {
    const questionName = $(el).attr("data-question");
    const pagesAttr = $(el).attr("data-pages");

    if (questionName && pagesAttr) {
      const pageNumbers = parsePageNumbers(pagesAttr);
      if (pageNumbers.length > 0) {
        mappings.push({ questionName, pageNumbers });
      }
    }
  });

  if (mappings.length > 0) {
    return mappings;
  }

  // Strategy 2: Look for question outline elements with page info
  $('.question-outline .question-item, .outline-item').each((_, el) => {
    const questionName = $(el).find('.question-name, .item-name').text().trim();
    const pageText = $(el).find('.page-range, .pages').text();

    if (questionName && pageText) {
      const pageNumbers = parsePageNumbers(pageText);
      if (pageNumbers.length > 0) {
        mappings.push({ questionName, pageNumbers });
      }
    }
  });

  if (mappings.length > 0) {
    return mappings;
  }

  // Strategy 3: Look for JSON data in script tags
  $('script[type="application/json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;

    try {
      const data = JSON.parse(content);
      if (data.questionMappings || data.outline) {
        const jsonMappings = extractMappingsFromJSON(data);
        if (jsonMappings.length > 0) {
          mappings.push(...jsonMappings);
        }
      }
    } catch {
      // Ignore invalid JSON
    }
  });

  if (mappings.length > 0) {
    return mappings;
  }

  log("WARN", "Could not extract question-to-page mappings from submission HTML");
  return null;
}

/**
 * Parse page numbers from various string formats.
 * Handles: "1,2,3", "1-3", "1, 3-5", etc.
 */
function parsePageNumbers(text: string): number[] {
  const pages: number[] = [];
  const parts = text.split(/[,;]/);

  for (const part of parts) {
    const trimmed = part.trim();

    // Range format: "1-3"
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      continue;
    }

    // Single page number
    const pageMatch = trimmed.match(/\d+/);
    if (pageMatch) {
      pages.push(parseInt(pageMatch[0], 10));
    }
  }

  return pages;
}

/**
 * Extract mappings from JSON data structure.
 */
function extractMappingsFromJSON(data: any): PageMapping[] {
  const mappings: PageMapping[] = [];

  // Try common JSON structures
  const source = data.questionMappings || data.outline || data.questions;
  if (!source) return mappings;

  if (Array.isArray(source)) {
    for (const item of source) {
      if (item.name && (item.pages || item.pageNumbers)) {
        const pageNumbers = Array.isArray(item.pages) ? item.pages :
                          Array.isArray(item.pageNumbers) ? item.pageNumbers : [];
        if (pageNumbers.length > 0) {
          mappings.push({
            questionName: item.name,
            pageNumbers: pageNumbers.filter((p: any) => typeof p === "number"),
          });
        }
      }
    }
  }

  return mappings;
}

/**
 * Extract individual page image URLs for scanned exams.
 * Returns undefined if not a scanned exam or URLs not found.
 */
function extractPageImageUrls($: cheerio.CheerioAPI): string[] | undefined {
  const imageUrls: string[] = [];

  // Strategy 1: Look for page images in submission viewer
  $('.submission-viewer img, .page-image img').each((_, el) => {
    const src = $(el).attr("src");
    if (src && (src.includes("/pages/") || src.includes("/submission"))) {
      imageUrls.push(src);
    }
  });

  if (imageUrls.length > 0) {
    return imageUrls;
  }

  // Strategy 2: Look for data attributes with page URLs
  $('[data-page-url]').each((_, el) => {
    const url = $(el).attr("data-page-url");
    if (url) {
      imageUrls.push(url);
    }
  });

  if (imageUrls.length > 0) {
    return imageUrls;
  }

  // Strategy 3: Look for background images in style attributes
  $('[style*="background-image"]').each((_, el) => {
    const style = $(el).attr("style") || "";
    const urlMatch = style.match(/url\(['"]?([^'"()]+)['"]?\)/);
    if (urlMatch && urlMatch[1].includes("/pages/")) {
      imageUrls.push(urlMatch[1]);
    }
  });

  if (imageUrls.length > 0) {
    return imageUrls;
  }

  // Not an error - most submissions are PDFs, not scanned images
  return undefined;
}
