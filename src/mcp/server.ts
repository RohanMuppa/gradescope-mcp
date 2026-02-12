/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * MCP server creation and tool registration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClearCacheTool } from "./tools/clear-cache.js";
import { registerLoginTool } from "./tools/login.js";
import { registerCheckAuthTool } from "./tools/check-auth.js";
import { registerLogoutTool } from "./tools/logout.js";
import { registerGetCoursesTool } from "./tools/get-courses.js";
import { registerGetGradesAndAssignmentsTool } from "./tools/get-grades-and-assignments.js";
import { registerGetRubricAndFeedbackTool } from "./tools/get-rubric-and-feedback.js";
import { registerGetSubmissionTool } from "./tools/get-submission.js";
import { registerAnalyzeSubmissionTool } from "./tools/analyze-submission.js";
import { registerScanRegradesTool } from "./tools/scan-regrades.js";
import { registerFormatRegradeRequestTool } from "./tools/format-regrade-request.js";
import { registerPrivacyReportTool } from "./tools/privacy-report.js";
import { TTLCache } from "../utils/cache.js";
import { TokenBucket } from "../utils/rate-limiter.js";
import { AuthManager } from "../auth/index.js";
import { GradescopeClient } from "../gradescope/client.js";
import { AbuseDetector } from "../security/abuse-detector.js";

// Shared cache instance used across all server tools
const cache = new TTLCache();

// Shared auth manager instance used across all server tools (with cache for cleanup)
const authManager = new AuthManager(undefined, cache);

// Rate limiter: 5 burst capacity, 1 token/sec refill
const rateLimiter = new TokenBucket(5, 1);

// Abuse detector: 50 requests/min with 1 min cooldown
const abuseDetector = new AbuseDetector();

// HTTP client for Gradescope data access
const gsClient = new GradescopeClient(authManager, cache, rateLimiter, abuseDetector);

/**
 * Create and configure the MCP server instance.
 * Registers all available tools.
 *
 * @returns Object containing configured MCP server, cache instance, auth manager, and client
 */
export function createServer(): {
  server: McpServer;
  cache: TTLCache;
  authManager: AuthManager;
  gsClient: GradescopeClient;
} {
  const server = new McpServer({
    name: "gradescope-mcp",
    version: "1.0.0",
    description: "Gradescope data access and grade analysis — by Rohan Muppa",
  });

  // Register auth tools
  registerClearCacheTool(server, cache);
  registerLoginTool(server, authManager);
  registerCheckAuthTool(server, authManager);
  registerLogoutTool(server, authManager, cache);
  registerPrivacyReportTool(server, authManager, cache);

  // Register data tools
  registerGetCoursesTool(server, gsClient, cache);
  registerGetGradesAndAssignmentsTool(server, gsClient, cache);
  registerGetRubricAndFeedbackTool(server, gsClient, cache);
  registerGetSubmissionTool(server, gsClient, cache);

  // Register analysis tools
  registerAnalyzeSubmissionTool(server, gsClient, cache);
  registerScanRegradesTool(server, gsClient, cache);
  registerFormatRegradeRequestTool(server, gsClient, cache);

  return { server, cache, authManager, gsClient };
}
