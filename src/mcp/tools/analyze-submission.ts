/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * analyze_submission MCP tool implementation.
 * AI-powered grade defense analysis that composes rubric data + submission images
 * into a single multimodal analysis request for Claude to process.
 * This is the "killer feature" — the user-facing tool that makes grade defense analysis possible.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolResponse, errorResponse } from "../tool-helpers.js";
import type { GradescopeClient } from "../../gradescope/client.js";
import type { TTLCache } from "../../utils/cache.js";
import type { GradescopeCourse, GradescopeAssignment } from "../../gradescope/types.js";
import { parseCourseJSON, parseCourseHTML } from "../../gradescope/parsers/courses.js";
import { parseAssignmentJSON, parseAssignmentHTML } from "../../gradescope/parsers/assignments.js";
import { parseSubmissionPage } from "../../gradescope/parsers/submission.js";
import { parseRubricAndFeedback } from "../../gradescope/parsers/rubric.js";
import { fuzzyMatchCourse } from "../../gradescope/fuzzy-match.js";
import { CACHE_TTLS } from "../../utils/config.js";
import { GradescopeError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";
import { buildAnalysisPrompt } from "../../analysis/prompt-builder.js";
import {
  identifyLostPointQuestions,
  collectTargetPages,
  assembleAnalysisContent,
} from "../../analysis/content-assembler.js";
import { convertPDFToImages } from "../../content/pdf-converter.js";
import { optimizeForClaudeVision } from "../../content/image-optimizer.js";

const MAX_BINARY_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Register the analyze_submission tool with the MCP server.
 */
export function registerAnalyzeSubmissionTool(
  server: McpServer,
  gsClient: GradescopeClient,
  cache: TTLCache
): void {
  server.registerTool(
    "analyze_submission",
    {
      title: "Analyze Graded Submission",
      description:
        "AI-powered grade defense analysis for a specific graded assignment. " +
        "Compares submission content against rubric to identify where points may have been incorrectly deducted. " +
        "Returns submission images and a structured analysis prompt for Claude to process. " +
        "Results should be framed as potential opportunities to investigate, not definitive claims.",
      inputSchema: z.object({
        course: z
          .string()
          .describe("Course ID or course name (fuzzy match, e.g., 'CS 250' or '12345')"),
        assignment: z
          .string()
          .describe("Assignment ID or assignment name (e.g., '54321' or 'Homework 3')"),
        forceRefresh: z
          .boolean()
          .optional()
          .describe("Bypass cache and fetch fresh data"),
      }),
    },
    async ({ course, assignment, forceRefresh }) => {
      try {
        // 1. Fetch all courses and resolve course via fuzzy match
        const courses = await fetchCourses(gsClient, cache, forceRefresh ?? false);
        const matchedCourse = fuzzyMatchCourse(courses, course);

        if (!matchedCourse) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1031] Could not find a course matching '${course}'`,
              { query: course },
              "Use get_courses to see available courses"
            )
          );
        }

        // 2. Fetch assignments for the matched course
        const assignments = await fetchAssignments(
          gsClient,
          cache,
          matchedCourse.id,
          forceRefresh ?? false
        );

        // 3. Find the assignment by ID or name
        const matchedAssignment = findAssignment(assignments, assignment);

        if (!matchedAssignment) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1032] Could not find assignment matching '${assignment}' in course '${matchedCourse.name}'`,
              { courseId: matchedCourse.id, assignmentQuery: assignment },
              "Use get_grades_and_assignments to see available assignments"
            )
          );
        }

        // 4. Check if assignment has been graded
        if (matchedAssignment.score === undefined) {
          return errorResponse(
            new GradescopeError(
              "VALIDATION_ERROR",
              `[GSMCP-1035] Assignment '${matchedAssignment.name}' has not been graded yet`,
              { courseId: matchedCourse.id, assignmentId: matchedAssignment.id },
              "Only graded assignments have submission content available"
            )
          );
        }

        // 5. Fetch submission page HTML
        const submissionPath = `/courses/${matchedCourse.id}/assignments/${matchedAssignment.id}`;
        const html = await gsClient.getText(submissionPath, {
          forceRefresh: forceRefresh ?? false,
        });

        // 6. Parse rubric data
        const rubricData = parseRubricAndFeedback(html);

        // 7. Identify lost-point questions
        const lostPointQuestions = identifyLostPointQuestions(rubricData);

        if (lostPointQuestions.length === 0) {
          // No lost points — no analysis needed
          return toolResponse({
            status: "no_findings",
            message: `No points were lost on ${matchedAssignment.name}. Score: ${rubricData.totalScore ?? matchedAssignment.score}/${rubricData.totalMaxScore ?? matchedAssignment.maxScore}. No analysis needed.`,
            course: { id: matchedCourse.id, name: matchedCourse.name },
            assignment: { id: matchedAssignment.id, name: matchedAssignment.name },
          });
        }

        // 8. Parse submission page for download metadata
        const submissionContent = parseSubmissionPage(html);

        // 9. Collect target pages for lost-point questions
        const totalPages = submissionContent.totalPages ?? 1;
        const targetPages = collectTargetPages(
          lostPointQuestions,
          totalPages,
          submissionContent.pageMappings
        );

        // 10. Download and convert submission pages based on content type
        let submissionPages: Array<{
          pageNumber: number;
          imageBuffer: Buffer;
          mimeType: "image/png" | "image/jpeg";
        }> = [];

        if (submissionContent.contentType === "pdf") {
          // PDF submission: download and convert target pages
          log("DEBUG", `Downloading PDF from ${submissionContent.downloadUrl}`);
          const response = await gsClient.getRaw(submissionContent.downloadUrl);

          // Check size
          const contentLength = response.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > MAX_BINARY_SIZE) {
            return errorResponse(
              new GradescopeError(
                "NETWORK_ERROR",
                `[GSMCP-1018] PDF too large (${contentLength} bytes, max ${MAX_BINARY_SIZE})`,
                { size: contentLength },
                "PDF exceeds maximum allowed size"
              )
            );
          }

          const pdfBuffer = Buffer.from(await response.arrayBuffer());
          log("DEBUG", `Converting ${targetPages.length} PDF pages to images`);

          // Convert target pages to images
          const pdfPages = await convertPDFToImages(pdfBuffer, targetPages);

          // Optimize each page for Claude vision
          for (const page of pdfPages) {
            const optimized = await optimizeForClaudeVision(page.imageBuffer);
            submissionPages.push({
              pageNumber: page.pageNumber,
              imageBuffer: optimized.buffer,
              mimeType: optimized.mimeType,
            });
          }
        } else if (
          submissionContent.pageImageUrls &&
          submissionContent.pageImageUrls.length > 0
        ) {
          // Scanned exam with individual page image URLs
          log("DEBUG", `Downloading ${targetPages.length} scanned exam page images`);

          for (const pageNumber of targetPages) {
            const imageUrl = submissionContent.pageImageUrls[pageNumber - 1];
            if (!imageUrl) {
              log("WARN", `No image URL for page ${pageNumber}, skipping`);
              continue;
            }

            const response = await gsClient.getRaw(imageUrl);
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            const optimized = await optimizeForClaudeVision(imageBuffer);

            submissionPages.push({
              pageNumber,
              imageBuffer: optimized.buffer,
              mimeType: optimized.mimeType,
            });
          }
        } else {
          // Single image download URL
          log(
            "DEBUG",
            `Downloading single submission image from ${submissionContent.downloadUrl}`
          );
          const response = await gsClient.getRaw(submissionContent.downloadUrl);
          const imageBuffer = Buffer.from(await response.arrayBuffer());
          const optimized = await optimizeForClaudeVision(imageBuffer);

          submissionPages.push({
            pageNumber: 1,
            imageBuffer: optimized.buffer,
            mimeType: optimized.mimeType,
          });
        }

        // 11. Build analysis prompt
        const analysisPrompt = buildAnalysisPrompt(rubricData, lostPointQuestions, {
          courseName: matchedCourse.name,
          assignmentName: matchedAssignment.name,
          totalScore: rubricData.totalScore ?? matchedAssignment.score ?? 0,
          maxScore: rubricData.totalMaxScore ?? matchedAssignment.maxScore ?? 0,
        });

        // 12. Assemble multimodal content
        const contentBlocks = assembleAnalysisContent(submissionPages, analysisPrompt, {
          courseName: matchedCourse.name,
          assignmentName: matchedAssignment.name,
          totalPages,
          pagesIncluded: submissionPages.length,
          questionsAnalyzed: lostPointQuestions.length,
        });

        // 13. Return MCP response with multimodal content
        const result: CallToolResult = {
          content: contentBlocks,
        };
        return result;
      } catch (error) {
        if (error instanceof GradescopeError) {
          return errorResponse(error);
        }
        return errorResponse(
          new GradescopeError(
            "UNKNOWN_ERROR",
            "[GSMCP-1037] Unexpected error analyzing submission",
            { error: String(error), course, assignment }
          )
        );
      }
    }
  );
}

/**
 * Fetch courses using JSON-first strategy with HTML fallback.
 */
async function fetchCourses(
  gsClient: GradescopeClient,
  cache: TTLCache,
  forceRefresh: boolean
): Promise<GradescopeCourse[]> {
  const cacheKey = "gs:courses";
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached as GradescopeCourse[];
  }

  // Try JSON first
  try {
    const json = await gsClient.getJSON("/courses.json", { forceRefresh: true });
    const courses = parseCourseJSON(json);
    cache.set(cacheKey, courses, CACHE_TTLS.courses);
    return courses;
  } catch (jsonError) {
    log("DEBUG", "JSON course fetch failed, falling back to HTML", jsonError);
  }

  // Fallback to HTML
  const html = await gsClient.getText("/", { forceRefresh: true });
  const courses = parseCourseHTML(html);
  cache.set(cacheKey, courses, CACHE_TTLS.courses);
  return courses;
}

/**
 * Fetch assignments using JSON-first strategy with HTML fallback.
 */
async function fetchAssignments(
  gsClient: GradescopeClient,
  cache: TTLCache,
  courseId: string,
  forceRefresh: boolean
): Promise<GradescopeAssignment[]> {
  const cacheKey = `gs:assignments:${courseId}`;
  const cached = cache.get(cacheKey, forceRefresh);
  if (cached !== undefined) {
    return cached as GradescopeAssignment[];
  }

  const path = `/courses/${courseId}/assignments`;

  // Try JSON first
  try {
    const json = await gsClient.getJSON(`${path}.json`, { forceRefresh: true });
    const assignments = parseAssignmentJSON(json, courseId);
    cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
    return assignments;
  } catch (jsonError) {
    log(
      "DEBUG",
      `JSON assignment fetch failed for course ${courseId}, falling back to HTML`,
      jsonError
    );
  }

  // Fallback to HTML
  const html = await gsClient.getText(path, { forceRefresh: true });
  const assignments = parseAssignmentHTML(html, courseId);
  cache.set(cacheKey, assignments, CACHE_TTLS.assignments);
  return assignments;
}

/**
 * Find assignment by ID or name match.
 * Uses exact ID match first, then exact name match, then normalized name match, then substring.
 */
function findAssignment(
  assignments: GradescopeAssignment[],
  query: string
): GradescopeAssignment | undefined {
  // Try exact ID match first
  const byId = assignments.find((a) => a.id === query);
  if (byId) return byId;

  // Try exact name match
  const byExactName = assignments.find((a) => a.name.toLowerCase() === query.toLowerCase());
  if (byExactName) return byExactName;

  // Try normalized name match (remove special chars, collapse whitespace)
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNormalizedName = assignments.find(
    (a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedQuery
  );
  if (byNormalizedName) return byNormalizedName;

  // Try substring match (last resort)
  const bySubstring = assignments.find((a) => a.name.toLowerCase().includes(query.toLowerCase()));
  return bySubstring;
}
