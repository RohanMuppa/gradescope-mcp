/**
 * clear_cache MCP tool implementation.
 * Clears all cached Gradescope data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResponse } from "../tool-helpers.js";

/**
 * Register the clear_cache tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param cacheRef - Reference to cache object with clear() method
 */
export function registerClearCacheTool(
  server: McpServer,
  cacheRef: { clear: () => void }
): void {
  server.registerTool(
    "clear_cache",
    {
      title: "Clear Cache",
      description:
        "Clear all cached Gradescope data. Use when you suspect cached data is stale or want to force fresh fetches.",
      inputSchema: z.object({}),
    },
    async () => {
      cacheRef.clear();
      return toolResponse({
        message: "All cached data cleared",
        timestamp: new Date().toISOString(),
      });
    }
  );
}
