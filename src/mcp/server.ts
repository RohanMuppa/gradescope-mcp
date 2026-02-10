/**
 * MCP server creation and tool registration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClearCacheTool } from "./tools/clear-cache.js";

/**
 * Create and configure the MCP server instance.
 * Registers all available tools.
 *
 * @returns Configured MCP server instance
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "gradescope-mcp",
    version: "1.0.0",
  });

  // Placeholder cache - will be replaced with real TTLCache in Plan 01-02
  const placeholderCache = {
    clear: () => {
      // No-op for scaffolding
    },
  };

  // Register tools
  registerClearCacheTool(server, placeholderCache);

  return server;
}
