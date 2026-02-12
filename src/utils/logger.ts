/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Logger utility for MCP server.
 * All output goes to stderr to prevent stdout corruption.
 * Stdout is reserved exclusively for MCP JSON-RPC protocol.
 */

import { scrubPII } from "../security/pii-scrubber.js";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/**
 * Override console.log to redirect to stderr with warning.
 * Call at server startup to prevent accidental stdout pollution.
 */
export function enableStdoutGuard(): void {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const scrubbedArgs = args.map((arg) => scrubPII(arg));
    console.error("[STDOUT-GUARD] console.log intercepted:", ...scrubbedArgs);
  };
}

/**
 * Log a message to stderr with timestamp and level prefix.
 * Format: [YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] message
 * All arguments are scrubbed for PII before output.
 */
export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  const scrubbedMessage = scrubPII(message);
  const scrubbedArgs = args.map((arg) => scrubPII(arg));
  console.error(prefix, scrubbedMessage, ...scrubbedArgs);
}
