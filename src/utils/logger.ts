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

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/**
 * Override console.log to redirect to stderr with warning.
 * Call at server startup to prevent accidental stdout pollution.
 */
export function enableStdoutGuard(): void {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    console.error("[STDOUT-GUARD] console.log intercepted:", ...args);
  };
}

/**
 * Log a message to stderr with timestamp and level prefix.
 * Format: [YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] message
 */
export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  console.error(prefix, message, ...args);
}
