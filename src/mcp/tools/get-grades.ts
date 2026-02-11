/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * get_grades MCP tool implementation.
 * Fetches grade details for a specific assignment submission.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import { parseGradeJSON, parseGradeHTML } from "../../gradescope/parsers/grades.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Register the get_grades tool with the MCP server.
 */
export function registerGetGradesTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "get_grades",
    {
      title: "Get Grades",
      description:
        "Fetch grade details for a specific assignment. Returns score, max score, status, and per-question breakdown.",
      inputSchema: z.object({
        courseId: z.string().describe("Gradescope course ID"),
        assignmentId: z.string().describe("Gradescope assignment ID"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ courseId, assignmentId, forceRefresh }) => {
      try {
        const grade = await fetchGrade(gsClient, cache, courseId, assignmentId, forceRefresh ?? false);
        const cacheKey = `gs:grades:${courseId}:${assignmentId}`;
        const meta = cache.getMeta(cacheKey);

        return toolResponse(
          { grade },
          {
            cached: meta?.cached ?? false,
            cacheAge: meta?.age,
            ttl: CACHE_TTLS.grades,
          }
        );
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1022] Unexpected error fetching grades",
            { error: String(error), courseId, assignmentId }
          )
        );
      }
    }
  );
}

/**
 * Fetch grade using JSON-first strategy with HTML fallback.
 */
async function fetchGrade(
  gsClient: GradescopeClient,
  cache: TTLCache,
  courseId: string,
  assignmentId: string,
  forceRefresh: boolean
): Promise<unknown> {
  const cacheKey = `gs:grades:${courseId}:${assignmentId}`;
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached;
  }

  const path = `/courses/${courseId}/assignments/${assignmentId}`;

  // Try JSON first
  try {
    const json = await gsClient.getJSON(`${path}.json`, { forceRefresh: true });
    const grade = parseGradeJSON(json, courseId, assignmentId);
    cache.set(cacheKey, grade, CACHE_TTLS.grades);
    return grade;
  } catch (jsonError) {
    log("DEBUG", `JSON grade fetch failed for assignment ${assignmentId}, falling back to HTML`, jsonError);
  }

  // Fallback to HTML
  const html = await gsClient.getText(path, { forceRefresh: true });
  const grade = parseGradeHTML(html, courseId, assignmentId);
  cache.set(cacheKey, grade, CACHE_TTLS.grades);
  return grade;
}
