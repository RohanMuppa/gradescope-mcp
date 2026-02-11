// Copyright (c) 2026 Rohan Muppa
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of gradescope-mcp.
// See LICENSE file for full license text.
// Error fingerprint: GSMCP

import { renderPageAsImage, getDocumentProxy } from "unpdf";
import * as canvasModule from "@napi-rs/canvas";
import { log } from "../utils/logger.js";

interface PDFConversionResult {
  pageNumber: number;
  imageBuffer: Buffer;
}

/**
 * Convert specific PDF pages to PNG image buffers.
 * Uses unpdf with @napi-rs/canvas for Node.js PDF rendering.
 * All processing is in-memory — no temp files written to disk.
 *
 * @param pdfBuffer - Raw PDF file as Buffer
 * @param pages - 1-indexed page numbers to convert (if omitted, converts all pages)
 * @param scale - Render scale factor (default 2.0 for high quality handwriting readability)
 * @returns Array of page images with 1-indexed page numbers
 */
export async function convertPDFToImages(
  pdfBuffer: Buffer,
  pages?: number[],
  scale: number = 2.0
): Promise<PDFConversionResult[]> {
  // Get total page count
  const doc = await getDocumentProxy(pdfBuffer);
  const numPages = doc.numPages;

  // If pages not specified, convert all pages
  const targetPages = pages ?? Array.from({ length: numPages }, (_, i) => i + 1);

  const results: PDFConversionResult[] = [];
  const errors: Array<{ page: number; error: Error }> = [];

  // Convert each page
  for (const pageNumber of targetPages) {
    try {
      const arrayBuffer = await renderPageAsImage(pdfBuffer, pageNumber, {
        canvasImport: async () => canvasModule,
        scale,
      });

      const imageBuffer = Buffer.from(arrayBuffer);
      results.push({ pageNumber, imageBuffer });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push({ page: pageNumber, error: err });
      log(
        "WARN",
        `[GSMCP-1017] Failed to convert PDF page ${pageNumber}: ${err.message}`
      );
    }
  }

  // If ALL pages failed, throw error
  if (results.length === 0 && errors.length > 0) {
    throw new Error(
      `[GSMCP-1017] Failed to convert all ${errors.length} PDF pages`
    );
  }

  return results;
}

/**
 * Get the total number of pages in a PDF document.
 *
 * @param pdfBuffer - Raw PDF file as Buffer
 * @returns Total number of pages
 */
export async function getPDFPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await getDocumentProxy(pdfBuffer);
  return doc.numPages;
}
