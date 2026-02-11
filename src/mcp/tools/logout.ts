/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * logout MCP tool implementation.
 * Clears stored Gradescope session.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse } from "../tool-helpers.js";
import { AuthManager } from "../../auth/index.js";

/**
 * Register the logout tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param authManager - AuthManager instance for authentication
 */
export function registerLogoutTool(
  server: McpServer,
  authManager: AuthManager
): void {
  server.registerTool(
    "logout",
    {
      title: "Logout from Gradescope",
      description:
        "Clear your stored Gradescope session. You will need to login again to access Gradescope data.",
      inputSchema: z.object({}),
    },
    async () => {
      await authManager.logout();
      return toolResponse({
        status: "logged_out",
        message: "Gradescope session cleared. You will need to login again.",
      });
    }
  );
}
