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
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(error.toJSON(), null, 2),
      },
    ],
    isError: true,
  };
}
