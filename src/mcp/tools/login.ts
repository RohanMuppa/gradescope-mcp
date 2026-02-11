/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * login MCP tool implementation.
 * Authenticates to Gradescope via browser.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import { AuthManager } from "../../auth/index.js";
import { GradescopeError } from "../../utils/errors.js";

/**
 * Register the login tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param authManager - AuthManager instance for authentication
 */
export function registerLoginTool(
  server: McpServer,
  authManager: AuthManager
): void {
  server.registerTool(
    "login",
    {
      title: "Login to Gradescope",
      description:
        "Authenticate to Gradescope. Opens a browser window where you type your email and password directly. Your credentials never pass through this tool. If you already have a valid session, the browser won't open.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        await authManager.login();
        return toolResponse({
          status: "authenticated",
          message: "Successfully logged in to Gradescope.",
        });
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        // Unexpected error
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1000] Unexpected error during login",
            { error: String(error) }
          )
        );
      }
    }
  );
}
