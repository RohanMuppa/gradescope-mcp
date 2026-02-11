/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * check_auth MCP tool implementation.
 * Validates current Gradescope session.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse } from "../tool-helpers.js";
import { AuthManager } from "../../auth/index.js";

/**
 * Register the check_auth tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param authManager - AuthManager instance for authentication
 */
export function registerCheckAuthTool(
  server: McpServer,
  authManager: AuthManager
): void {
  server.registerTool(
    "check_auth",
    {
      title: "Check Gradescope Auth Status",
      description:
        "Check if your Gradescope session is currently valid. Returns simple valid/invalid status.",
      inputSchema: z.object({}),
    },
    async () => {
      const authCheck = await authManager.checkAuth();

      if (authCheck.valid) {
        return toolResponse({
          status: "valid",
          message: "Your Gradescope session is active.",
        });
      } else {
        return toolResponse({
          status: "invalid",
          message: "Your Gradescope session has expired or is missing. Please run the login tool.",
        });
      }
    }
  );
}
