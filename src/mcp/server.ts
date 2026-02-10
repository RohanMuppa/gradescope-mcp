/**
 * MCP server creation and tool registration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClearCacheTool } from "./tools/clear-cache.js";
import { TTLCache } from "../utils/cache.js";

// Shared cache instance used across all server tools
const cache = new TTLCache();

/**
 * Create and configure the MCP server instance.
 * Registers all available tools.
 *
 * @returns Object containing configured MCP server and cache instance
 */
export function createServer(): { server: McpServer; cache: TTLCache } {
  const server = new McpServer({
    name: "gradescope-mcp",
    version: "1.0.0",
  });

  // Register tools
  registerClearCacheTool(server, cache);

  return { server, cache };
}
