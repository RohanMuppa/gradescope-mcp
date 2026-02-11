// Copyright (c) 2026 Rohan Muppa
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of gradescope-mcp.
// See LICENSE file for full license text.
// Error fingerprint: GSMCP

/**
 * Multimodal content formatter for MCP.
 * Converts submission page images to MCP content blocks (text + base64 images).
 */

interface FormatterInput {
  pages: Array<{
    pageNumber: number;
    imageBuffer: Buffer;
    mimeType: "image/png" | "image/jpeg";
  }>;
  metadata: {
    courseName: string;
    assignmentName: string;
    totalPages: number;
    targetedQuestion?: string;
  };
}

interface ContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string; // base64-encoded image
  mimeType?: string; // "image/png" or "image/jpeg"
}

/**
 * Format submission pages as MCP multimodal content blocks.
 * Returns array of interleaved text and image content blocks.
 * Clears image buffers after base64 encoding to help GC reclaim memory.
 *
 * @param input - Pages and metadata for the submission
 * @returns Array of MCP content blocks (text summary + images)
 */
export function formatAsMultimodalContent(
  input: FormatterInput
): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];

  // Build summary text
  const summaryLines: string[] = [
    `Submission for ${input.metadata.assignmentName} (${input.metadata.courseName})`,
    `Showing ${input.pages.length} of ${input.metadata.totalPages} pages.`,
  ];

  if (input.metadata.targetedQuestion) {
    summaryLines.push(`Targeted: ${input.metadata.targetedQuestion}`);
  }

  // Add page numbers list
  const pageNumbers = input.pages.map((p) => p.pageNumber).join(", ");
  summaryLines.push(`Pages: ${pageNumbers}`);

  // Add summary text block
  contentBlocks.push({
    type: "text",
    text: summaryLines.join("\n"),
  });

  // Add image blocks with page labels
  for (const page of input.pages) {
    // Add image block
    contentBlocks.push({
      type: "image",
      data: page.imageBuffer.toString("base64"),
      mimeType: page.mimeType,
    });

    // Add page label
    contentBlocks.push({
      type: "text",
      text: `[Page ${page.pageNumber}]`,
    });

    // CRITICAL: Release buffer for GC after encoding to base64
    (page as any).imageBuffer = null;
  }

  return contentBlocks;
}
