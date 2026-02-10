/**
 * Configuration and constants for the Gradescope MCP server.
 */

// Load environment variables
import "dotenv/config";

/**
 * Cache TTL values in milliseconds.
 * These are locked constants for consistent cache behavior.
 */
export const CACHE_TTLS = {
  courses: 3_600_000,      // 1 hour
  assignments: 1_800_000,  // 30 minutes
  grades: 300_000,         // 5 minutes
  rubrics: 900_000,        // 15 minutes
} as const;

/**
 * Type representing cache data types.
 */
export type CacheDataType = keyof typeof CACHE_TTLS;
