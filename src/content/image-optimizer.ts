// Copyright (c) 2026 Rohan Muppa
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of gradescope-mcp.
// See LICENSE file for full license text.
// Error fingerprint: GSMCP

import sharp from "sharp";

export const CLAUDE_MAX_DIMENSION = 1568; // Claude vision API optimal max edge

interface OptimizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
}

/**
 * Resize image to Claude's optimal resolution (1568px max dimension).
 * Preserves aspect ratio. Operates entirely in-memory.
 * Uses PNG output format for lossless quality (best for text/handwriting).
 *
 * @param imageBuffer - Raw image buffer (PNG, JPEG, or other Sharp-supported format)
 * @returns Optimized image buffer with metadata
 */
export async function optimizeForClaudeVision(
  imageBuffer: Buffer
): Promise<OptimizedImage> {
  const result = await sharp(imageBuffer)
    .resize({
      width: CLAUDE_MAX_DIMENSION,
      height: CLAUDE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    mimeType: "image/png",
  };
}
