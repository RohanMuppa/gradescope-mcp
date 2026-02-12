/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Helper functions for MCP tool responses.
 */

import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GradescopeError } from "../utils/errors.js";

/**
 * Create a successful tool response with optional cache metadata.
 */
export function toolResponse(
  data: unknown,
  meta?: {
    cached?: boolean;
    cacheAge?: number;
    ttl?: number;
  }
): CallToolResult {
  let response: unknown;

  if (meta && typeof data === "object" && data !== null) {
    response = {
      ...data,
      _cache: {
        cached: meta.cached ?? false,
        ...(meta.cacheAge !== undefined && { cacheAge: meta.cacheAge }),
        ...(meta.ttl !== undefined && { ttl: meta.ttl }),
      },
    };
  } else {
    response = data;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

/**
 * Create an error tool response from a GradescopeError.
 */
export function errorResponse(error: GradescopeError): CallToolResult {
  const errorJson = error.toJSON();

  // Filter out internal details that might leak information
  const filtered: {
    code: string;
    message: string;
    suggestedAction?: string;
    details?: Record<string, unknown>;
  } = {
    code: errorJson.code,
    message: errorJson.message,
    ...(errorJson.suggestedAction && { suggestedAction: errorJson.suggestedAction }),
  };

  // Only include details if they don't contain sensitive keys
  if (errorJson.details) {
    const sensitiveKeys = ['error', 'stack', 'path', 'cause', 'trace'];
    const safeDetails: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(errorJson.details)) {
      if (!sensitiveKeys.includes(key.toLowerCase())) {
        safeDetails[key] = value;
      }
    }

    if (Object.keys(safeDetails).length > 0) {
      filtered.details = safeDetails;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(filtered, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Create a safe error response that filters internal details.
 * For GradescopeError, uses errorResponse(). For other errors, returns generic message.
 *
 * @param error - The error to convert
 * @returns CallToolResult with safe error information
 */
export function safeErrorResponse(error: unknown): CallToolResult {
  // If it's a GradescopeError, use the structured error response
  if (error instanceof GradescopeError) {
    return errorResponse(error);
  }

  // For all other errors, return generic message without internals
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            code: "UNKNOWN_ERROR",
            message: "An unexpected error occurred. Please try again.",
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}
