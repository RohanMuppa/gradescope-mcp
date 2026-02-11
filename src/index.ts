#!/usr/bin/env node
/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Gradescope MCP Server entry point.
 * Runs on stdio transport for Claude Desktop integration.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server.js";
import { enableStdoutGuard, log } from "./utils/logger.js";

// Enable stdout guard immediately to prevent stdout corruption
enableStdoutGuard();

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  log("ERROR", "Unhandled Promise Rejection:", reason);
});

/**
 * Main server initialization and startup.
 */
async function main(): Promise<void> {
  try {
    // Create MCP server instance
    const { server, authManager } = createServer();

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    log("INFO", "Gradescope MCP Server v1.0.0 (Rohan Muppa) running on stdio");
  } catch (error) {
    log("ERROR", "Failed to start server:", error);
    process.exit(1);
  }
}

// Signal handlers for graceful shutdown
process.on("SIGINT", () => {
  log("INFO", "Shutting down gracefully (SIGINT)");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("INFO", "Shutting down gracefully (SIGTERM)");
  process.exit(0);
});

// Start the server
main();
