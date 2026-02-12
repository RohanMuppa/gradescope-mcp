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
import { runStartupChecks } from "./security/runtime-checks.js";
import { auditTrail } from "./security/audit-trail.js";

// Enable stdout guard immediately to prevent stdout corruption
enableStdoutGuard();

// Run all startup integrity checks
runStartupChecks();

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
    const { server, cache } = createServer();

    // Rotate audit trail at startup
    await auditTrail.rotate();

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    log("INFO", "Gradescope MCP Server v1.0.0 (Rohan Muppa) running on stdio");

    // Setup signal handlers with cache cleanup
    process.on("SIGINT", () => {
      log("INFO", "Shutting down gracefully (SIGINT)");
      cache.clear();
      log("DEBUG", "Cache cleared on shutdown");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      log("INFO", "Shutting down gracefully (SIGTERM)");
      cache.clear();
      log("DEBUG", "Cache cleared on shutdown");
      process.exit(0);
    });

    // Uncaught exception handler with cache cleanup
    process.on("uncaughtException", (error) => {
      log("ERROR", "Uncaught exception:", error);
      cache.clear();
      log("DEBUG", "Cache cleared on crash");
      process.exit(1);
    });
  } catch (error) {
    log("ERROR", "Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server
main();
