/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * scan_regrades MCP tool implementation.
 * Batch scanning orchestrator with deadline-aware grouping.
 * Scans all assignments across courses to identify regrade opportunities.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import type {
  GradescopeCourse,
  GradescopeAssignment,
  ScanResult,
  CourseResults,
  BatchError,
} from "../../gradescope/types.js";
import {
  fetchCourses,
  fetchAssignments,
  analyzeSubmissionInternal,
} from "./analyze-submission.js";
import { detectRegradeDeadline, formatDeadline } from "../../gradescope/parsers/deadlines.js";
import { fuzzyMatchCourse } from "../../gradescope/fuzzy-match.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

/**
 * Register the scan_regrades tool with the MCP server.
 */
export function registerScanRegradesTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "scan_regrades",
    {
      title: "Scan Regrade Opportunities",
      description:
        "Batch scan all graded assignments across courses to identify regrade opportunities. " +
        "Skips ungraded assignments, perfect scores, and closed deadlines. " +
        "Returns deadline-sorted results grouped by course with recovery estimates. " +
        "Use analyze_submission for detailed analysis of specific assignments.",
      inputSchema: z.object({
        course: z
          .string()
          .optional()
          .describe(
            "Filter to specific course ID or name (fuzzy match). Omit to scan all courses."
          ),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ course, forceRefresh }) => {
      try {
        const refresh = forceRefresh ?? false;

        // 1. Fetch all courses
        const allCourses = await fetchCourses(gsClient, cache, refresh);

        // 2. Filter to specific course if requested
        let coursesToScan: GradescopeCourse[];
        if (course) {
          const matchedCourse = fuzzyMatchCourse(allCourses, course);
          if (!matchedCourse) {
            return errorResponse(
              new GradescopeError(
                "VALIDATION_ERROR",
                `[GSMCP-1070] Could not find a course matching '${course}'`,
                { query: course },
                "Use get_courses to see available courses"
              )
            );
          }
          coursesToScan = [matchedCourse];
        } else {
          coursesToScan = allCourses;
        }

        // 3. Initialize tracking structures
        const results: ScanResult[] = [];
        const warnings: BatchError[] = [];
        const pendingGrading: Array<{ courseId: string; courseName: string; assignmentId: string; assignmentName: string }> = [];

        let totalAssignments = 0;
        let processedAssignments = 0;

        // 4. Sequential course-by-course scan
        for (const currentCourse of coursesToScan) {
          log("INFO", `Scanning course: ${currentCourse.name} (${currentCourse.id})`);

          try {
            // Fetch assignments for this course
            const assignments = await fetchAssignments(
              gsClient,
              cache,
              currentCourse.id,
              refresh
            );

            totalAssignments += assignments.length;

            // Process each assignment
            for (const assignment of assignments) {
              processedAssignments++;

              // Send progress notification every 5 assignments
              if (processedAssignments % 5 === 0) {
                log("DEBUG", `Progress: ${processedAssignments}/${totalAssignments} assignments processed`);
              }

              // Skip ungraded assignments
              if (assignment.score === undefined) {
                pendingGrading.push({
                  courseId: currentCourse.id,
                  courseName: currentCourse.name,
                  assignmentId: assignment.id,
                  assignmentName: assignment.name,
                });
                continue;
              }

              // Skip perfect scores
              if (
                assignment.score !== undefined &&
                assignment.maxScore !== undefined &&
                assignment.score >= assignment.maxScore
              ) {
                log("DEBUG", `Skipping perfect score: ${assignment.name} (${assignment.score}/${assignment.maxScore})`);
                continue;
              }

              // Check analysis cache first
              const cacheKey = `gs:analysis:${currentCourse.id}:${assignment.id}`;
              const cachedAnalysis = cache.get(cacheKey, refresh);

              let analysisResult: CallToolResult;
              if (cachedAnalysis !== undefined) {
                log("DEBUG", `Using cached analysis for ${assignment.name}`);
                analysisResult = cachedAnalysis as CallToolResult;
              } else {
                // Perform analysis
                try {
                  analysisResult = await analyzeSubmissionInternal(
                    gsClient,
                    cache,
                    currentCourse,
                    assignment,
                    refresh
                  );

                  // Cache the analysis result
                  cache.set(cacheKey, analysisResult, 1_800_000); // 30 minutes
                } catch (analysisError) {
                  // Collect partial failure, continue scanning
                  warnings.push({
                    courseId: currentCourse.id,
                    courseName: currentCourse.name,
                    assignmentId: assignment.id,
                    assignmentName: assignment.name,
                    error: analysisError instanceof Error ? analysisError.message : String(analysisError),
                  });
                  continue;
                }
              }

              // Check if analysis returned no_findings (perfect score or error response)
              if (
                analysisResult.content &&
                Array.isArray(analysisResult.content) &&
                analysisResult.content.length > 0
              ) {
                const firstContent = analysisResult.content[0] as TextContent;
                if (
                  firstContent.type === "text" &&
                  typeof firstContent.text === "string" &&
                  firstContent.text.includes('"status":"no_findings"')
                ) {
                  log("DEBUG", `No findings for ${assignment.name}, skipping`);
                  continue;
                }
              }

              // Detect deadline
              const submissionPath = `/courses/${currentCourse.id}/assignments/${assignment.id}`;
              let deadlineInfo;
              try {
                const html = await gsClient.getText(submissionPath, { forceRefresh: refresh });
                deadlineInfo = detectRegradeDeadline(html);
              } catch (deadlineError) {
                log("WARN", `Could not detect deadline for ${assignment.name}`, deadlineError);
                deadlineInfo = {
                  status: "unknown" as const,
                  absolute: null,
                  relative: null,
                  deadlineDate: null,
                };
              }

              // Skip closed deadlines
              if (deadlineInfo.status === "closed") {
                log("DEBUG", `Skipping closed deadline: ${assignment.name}`);
                continue;
              }

              // Extract estimated recovery from analysis result
              // The analysis result is multimodal content - we need to parse the text content
              let estimatedRecovery = 0;
              let confidenceBreakdown = "0 LIKELY, 0 POSSIBLE";

              if (
                analysisResult.content &&
                Array.isArray(analysisResult.content)
              ) {
                for (const content of analysisResult.content) {
                  const textContent = content as TextContent;
                  if (textContent.type === "text" && typeof textContent.text === "string") {
                    // Try to parse JSON from text content
                    try {
                      const match = textContent.text.match(/\{[\s\S]*"estimatedRecovery"[\s\S]*\}/);
                      if (match) {
                        const parsed = JSON.parse(match[0]);
                        estimatedRecovery = parsed.estimatedRecovery || 0;

                        // Calculate confidence breakdown
                        if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
                          const likely = parsed.recommendations.filter((r: any) => r.confidence === "LIKELY").length;
                          const possible = parsed.recommendations.filter((r: any) => r.confidence === "POSSIBLE").length;
                          confidenceBreakdown = `${likely} LIKELY, ${possible} POSSIBLE`;
                        }
                      }
                    } catch {
                      // Parsing failed, use defaults
                    }
                  }
                }
              }

              // Add to results
              results.push({
                courseId: currentCourse.id,
                courseName: currentCourse.name,
                assignmentId: assignment.id,
                assignmentName: assignment.name,
                estimatedRecovery,
                confidenceBreakdown,
                deadline: formatDeadline(deadlineInfo),
                deadlineSortKey: deadlineInfo.deadlineDate
                  ? Math.floor(
                      (deadlineInfo.deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    )
                  : Infinity,
              });
            }

            // Send course completion progress notification
            log("INFO", `Completed scanning ${currentCourse.name}: ${results.filter(r => r.courseId === currentCourse.id).length} opportunities found`);
          } catch (courseError) {
            // Course-level error
            warnings.push({
              courseId: currentCourse.id,
              courseName: currentCourse.name,
              error: courseError instanceof Error ? courseError.message : String(courseError),
            });
          }
        }

        // 5. Group results by course and sort by deadline urgency
        const courseResultsMap = new Map<string, CourseResults>();

        for (const result of results) {
          if (!courseResultsMap.has(result.courseId)) {
            courseResultsMap.set(result.courseId, {
              courseId: result.courseId,
              courseName: result.courseName,
              assignments: [],
            });
          }
          courseResultsMap.get(result.courseId)!.assignments.push(result);
        }

        // Sort assignments within each course by deadline urgency (soonest first)
        const courseResults: CourseResults[] = Array.from(courseResultsMap.values()).map(
          (courseResult) => ({
            ...courseResult,
            assignments: courseResult.assignments.sort(
              (a, b) => a.deadlineSortKey - b.deadlineSortKey
            ),
          })
        );

        // 6. Calculate executive summary
        const totalOpportunities = results.length;
        const totalRecovery = results.reduce((sum, r) => sum + r.estimatedRecovery, 0);
        const urgentDeadlines = results.filter((r) => r.deadlineSortKey <= 7).length; // Within 7 days

        // 7. Build response
        const response = {
          summary: {
            totalCourses: coursesToScan.length,
            totalAssignmentsScanned: totalAssignments,
            totalOpportunities,
            urgentDeadlines,
            estimatedTotalRecovery: totalRecovery,
          },
          courseResults,
          pendingGrading,
          warnings,
          _hint:
            "Use analyze_submission with specific course and assignment names from above to see detailed analysis and evidence.",
        };

        return toolResponse(response);
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1071] Unexpected error during batch scan",
            { error: String(error), course }
          )
        );
      }
    }
  );
}
