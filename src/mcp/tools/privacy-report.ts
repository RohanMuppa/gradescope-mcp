/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * privacy_report MCP tool implementation.
 * Shows user exactly what data is stored and how to delete it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse } from "../tool-helpers.js";
import { AuthManager } from "../../auth/index.js";
import type { TTLCache } from "../../utils/cache.js";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Register the privacy_report tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param authManager - AuthManager instance for session status
 * @param cache - Shared cache instance for cache status
 */
export function registerPrivacyReportTool(
  server: McpServer,
  authManager: AuthManager,
  cache: TTLCache
): void {
  server.registerTool(
    "privacy_report",
    {
      title: "Privacy Report",
      description:
        "Show what data is stored locally and how to delete it.",
      inputSchema: z.object({}),
    },
    async () => {
      // Check if session file exists
      const session = await authManager.getSession();
      const sessionExists = session !== null;

      // Get cache status
      const cacheSize = cache.size;

      // Session file location
      const sessionDir = path.join(os.homedir(), ".gradescope-session");
      const sessionFilePath = path.join(sessionDir, "session.json");

      return toolResponse({
        status: "privacy_report",
        data_inventory: {
          session_file: {
            location: sessionFilePath,
            exists: sessionExists,
            encryption: "AES-256-GCM with machine-derived key",
            contents: sessionExists
              ? "Gradescope session cookie with 24-hour expiry"
              : "No session file present",
          },
          in_memory_cache: {
            status: cacheSize > 0 ? "active" : "empty",
            entries: cacheSize,
            contents:
              "Course data, assignment lists, rubrics, and analysis results with 30-minute TTL",
          },
          telemetry: {
            collected: false,
            message: "This tool collects no telemetry or usage data.",
          },
        },
        instructions:
          "Run the logout tool to delete the session file and clear all cached data.",
      });
    }
  );
}
