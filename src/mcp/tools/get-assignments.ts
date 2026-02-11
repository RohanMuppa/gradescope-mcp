/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * get_assignments MCP tool implementation.
 * Fetches assignments for a specific Gradescope course.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import { parseAssignmentJSON, parseAssignmentHTML } from "../../gradescope/parsers/assignments.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Register the get_assignments tool with the MCP server.
 */
export function registerGetAssignmentsTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "get_assignments",
    {
      title: "Get Assignments",
      description:
        "Fetch all assignments for a Gradescope course. Returns assignment ID, name, due date, status, score, and URL.",
      inputSchema: z.object({
        courseId: z.string().describe("Gradescope course ID"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ courseId, forceRefresh }) => {
      try {
        const assignments = await fetchAssignments(gsClient, cache, courseId, forceRefresh ?? false);
        const cacheKey = `gs:assignments:${courseId}`;
        const meta = cache.getMeta(cacheKey);

        return toolResponse(
          { courseId, assignments, count: assignments.length },
          {
            cached: meta?.cached ?? false,
            cacheAge: meta?.age,
            ttl: CACHE_TTLS.assignments,
          }
        );
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1021] Unexpected error fetching assignments",
            { error: String(error), courseId }
          )
        );
      }
    }
  );
}

/**
 * Fetch assignments using JSON-first strategy with HTML fallback.
 */
async function fetchAssignments(
  gsClient: GradescopeClient,
  cache: TTLCache,
  courseId: string,
  forceRefresh: boolean
): Promise<unknown[]> {
  const cacheKey = `gs:assignments:${courseId}`;
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached as unknown[];
  }

  const path = `/courses/${courseId}/assignments`;

  // Try JSON first
  try {
    const json = await gsClient.getJSON(`${path}.json`, { forceRefresh: true });
    const assignments = parseAssignmentJSON(json, courseId);
    cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
    return assignments;
  } catch (jsonError) {
    log("DEBUG", `JSON assignment fetch failed for course ${courseId}, falling back to HTML`, jsonError);
  }

  // Fallback to HTML
  const html = await gsClient.getText(path, { forceRefresh: true });
  const assignments = parseAssignmentHTML(html, courseId);
  cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
  return assignments;
}
