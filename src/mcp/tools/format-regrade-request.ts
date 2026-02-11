/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * format_regrade_request MCP tool implementation.
 * Composes analysis results with the regrade formatter to produce
 * copy-pasteable justification text for Gradescope's regrade request form.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import {
  fetchCourses,
  fetchAssignments,
  findAssignment,
  analyzeSubmissionInternal,
  isAnalysisInternalResult,
  type AnalysisInternalResult,
} from "./analyze-submission.js";
import { fuzzyMatchCourse } from "../../gradescope/fuzzy-match.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";
import { formatRegradeRequests } from "../../analysis/regrade-formatter.js";

/**
 * Register the format_regrade_request tool with the MCP server.
 */
export function registerFormatRegradeRequestTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "format_regrade_request",
    {
      title: "Format Regrade Request Text",
      description:
        "Generate copy-pasteable regrade request justification text for Gradescope's regrade form. " +
        "Formats analysis recommendations into professional, respectful text grouped by question. " +
        "Requires prior analyze_submission or scan_regrades results (will auto-analyze if not cached). " +
        "Use format_regrade_request after identifying opportunities with scan_regrades or analyze_submission.",
      inputSchema: z.object({
        course: z
          .string()
          .describe("Course ID or course name (fuzzy match)"),
        assignment: z
          .string()
          .describe("Assignment ID or assignment name"),
        question: z
          .string()
          .optional()
          .describe(
            "Specific question name (e.g., 'Q1'). Omit to format all questions with findings."
          ),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and re-analyze before formatting"),
      }),
    },
    async ({ course, assignment, question, forceRefresh }) => {
      try {
        const refresh = forceRefresh ?? false;

        // 1. Resolve course via fuzzy match
        const courses = await fetchCourses(gsClient, cache, refresh);
        const matchedCourse = fuzzyMatchCourse(courses, course);

        if (!matchedCourse) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1080] Could not find a course matching '${course}'`,
              { query: course },
              "Use get_courses to see available courses"
            )
          );
        }

        // 2. Resolve assignment
        const assignments = await fetchAssignments(
          gsClient,
          cache,
          matchedCourse.id,
          refresh
        );
        const matchedAssignment = findAssignment(assignments, assignment);

        if (!matchedAssignment) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1080] Could not find assignment matching '${assignment}' in course '${matchedCourse.name}'`,
              { courseId: matchedCourse.id, assignmentQuery: assignment },
              "Use get_grades_and_assignments to see available assignments"
            )
          );
        }

        // 3. Get analysis data (cache-first)
        const cacheKey = `gs:analysis:${matchedCourse.id}:${matchedAssignment.id}`;
        const cached = cache.get(cacheKey, refresh);

        let analysisResult: AnalysisInternalResult;

        if (cached !== undefined && isAnalysisInternalResult(cached as AnalysisInternalResult | CallToolResult)) {
          log("DEBUG", `Using cached analysis for ${matchedAssignment.name}`);
          analysisResult = cached as AnalysisInternalResult;
        } else {
          // Cache miss or forceRefresh: run analysis
          log("DEBUG", `Running analysis for ${matchedAssignment.name}`);
          const result = await analyzeSubmissionInternal(
            gsClient,
            cache,
            matchedCourse,
            matchedAssignment,
            refresh
          );

          if (!isAnalysisInternalResult(result)) {
            // Error from analyzeSubmissionInternal — return as-is
            return result;
          }

          analysisResult = result;

          // Cache the result
          cache.set(cacheKey, analysisResult, CACHE_TTLS.analysis);
        }

        // 4. Check for findings
        if (analysisResult.analysis.recommendations.length === 0) {
          return toolResponse({
            message: "No regrade opportunities found for this assignment.",
            course: { id: matchedCourse.id, name: matchedCourse.name },
            assignment: { id: matchedAssignment.id, name: matchedAssignment.name },
          });
        }

        // 5. Filter to specific question if requested
        const allRecommendations = analysisResult.analysis.recommendations;
        let targetRecommendations = allRecommendations;

        if (question) {
          // Compute unique questions before filtering (for hint)
          const uniqueQuestions = [
            ...new Set(allRecommendations.map((r) => r.question)),
          ];

          targetRecommendations = allRecommendations.filter(
            (r) => r.question === question
          );

          if (targetRecommendations.length === 0) {
            return errorResponse(
              new GradescopeError(
                "VALIDATION_ERROR",
                `[GSMCP-1080] No findings for question '${question}' in '${matchedAssignment.name}'`,
                { question, assignmentId: matchedAssignment.id },
                `Available questions with findings: ${uniqueQuestions.join(", ")}`
              )
            );
          }
        }

        // 6. Format regrade requests
        const regradeRequests = formatRegradeRequests(
          targetRecommendations,
          matchedAssignment.name
        );

        const totalEstimatedRecovery = regradeRequests.reduce(
          (sum, r) => sum + r.estimatedRecovery,
          0
        );

        // 7. Build response
        return toolResponse({
          course: { id: matchedCourse.id, name: matchedCourse.name },
          assignment: { id: matchedAssignment.id, name: matchedAssignment.name },
          regradeRequests,
          totalEstimatedRecovery,
          instructions:
            "Copy the justification text for each question into Gradescope's regrade request form. Submit one request per question.",
          _hint:
            "Use scan_regrades to find all opportunities across courses, or analyze_submission for detailed evidence.",
        });
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1081] Unexpected error formatting regrade request",
            { error: String(error), course, assignment }
          )
        );
      }
    }
  );
}
