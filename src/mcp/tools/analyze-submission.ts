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
import type { GradescopeCourse, GradescopeAssignment, AnalysisResult, SubmissionPage } from "../../gradescope/types.js";
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
 * Internal analysis result containing structured data and metadata.
 * Returned by analyzeSubmissionInternal for composition with batch scanner.
 */
export interface AnalysisInternalResult {
  /** Estimated analysis result based on rubric data (pre-Claude processing) */
  analysis: AnalysisResult;
  /** Submission page images */
  submissionPages: SubmissionPage[];
  /** Analysis prompt text */
  analysisPrompt: string;
  /** Additional metadata */
  metadata: {
    courseName: string;
    assignmentName: string;
    totalPages: number;
    pagesIncluded: number;
    questionsAnalyzed: number;
  };
}

/**
 * Type guard to check if result is AnalysisInternalResult (success) vs CallToolResult (error).
 */
export function isAnalysisInternalResult(
  result: AnalysisInternalResult | CallToolResult
): result is AnalysisInternalResult {
  return (result as AnalysisInternalResult).analysis !== undefined;
}

/**
 * Assemble multimodal MCP response from AnalysisInternalResult.
 * Composes submission pages and analysis prompt into CallToolResult.
 */
export function assembleMultimodalResponse(
  internalResult: AnalysisInternalResult
): CallToolResult {
  const contentBlocks = assembleAnalysisContent(
    internalResult.submissionPages,
    internalResult.analysisPrompt,
    internalResult.metadata
  );

  return {
    content: contentBlocks,
  };
}

/**
 * Internal analysis function for composing with batch scanner.
 * Accepts already-resolved course and assignment objects (no fuzzy matching).
 * Fetches submission, parses rubric, identifies lost-point questions,
 * downloads content, builds analysis prompt, returns structured AnalysisInternalResult.
 *
 * @param gsClient - Gradescope API client
 * @param cache - TTL cache for analysis results
 * @param course - Resolved course object
 * @param assignment - Resolved assignment object
 * @param forceRefresh - Bypass cache and fetch fresh data
 * @returns AnalysisInternalResult with structured data or CallToolResult with error
 */
export async function analyzeSubmissionInternal(
  gsClient: GradescopeClient,
  cache: TTLCache,
  course: GradescopeCourse,
  assignment: GradescopeAssignment,
  forceRefresh: boolean
): Promise<AnalysisInternalResult | CallToolResult> {
  try {
    // 1. Check if assignment has been graded
    if (assignment.score === undefined) {
      return errorResponse(
        new GradescopeError(
          "VALIDATION_ERROR",
          `[GSMCP-1035] Assignment '${assignment.name}' has not been graded yet`,
          { courseId: course.id, assignmentId: assignment.id },
          "Only graded assignments have submission content available"
        )
      );
    }

    // 2. Fetch submission page HTML
    const submissionPath = `/courses/${course.id}/assignments/${assignment.id}`;
    const html = await gsClient.getText(submissionPath, {
      forceRefresh: forceRefresh,
    });

    // 3. Parse rubric data
    const rubricData = parseRubricAndFeedback(html);

    // 4. Identify lost-point questions
    const lostPointQuestions = identifyLostPointQuestions(rubricData);

    if (lostPointQuestions.length === 0) {
      // No lost points — no analysis needed
      return toolResponse({
        status: "no_findings",
        message: `No points were lost on ${assignment.name}. Score: ${rubricData.totalScore ?? assignment.score}/${rubricData.totalMaxScore ?? assignment.maxScore}. No analysis needed.`,
        course: { id: course.id, name: course.name },
        assignment: { id: assignment.id, name: assignment.name },
      });
    }

    // 5. Parse submission page for download metadata
    const submissionContent = parseSubmissionPage(html);

    // 6. Collect target pages for lost-point questions
    const totalPages = submissionContent.totalPages ?? 1;
    const targetPages = collectTargetPages(
      lostPointQuestions,
      totalPages,
      submissionContent.pageMappings
    );

    // 7. Download and convert submission pages based on content type
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

    // 8. Build analysis prompt
    const analysisPrompt = buildAnalysisPrompt(rubricData, lostPointQuestions, {
      courseName: course.name,
      assignmentName: assignment.name,
      totalScore: rubricData.totalScore ?? assignment.score ?? 0,
      maxScore: rubricData.totalMaxScore ?? assignment.maxScore ?? 0,
    });

    // 9. Build estimated AnalysisResult based on rubric data
    // This provides structured data for batch scanner without waiting for Claude's response
    const currentScore = rubricData.totalScore ?? assignment.score ?? 0;
    const maxScore = rubricData.totalMaxScore ?? assignment.maxScore ?? 0;
    const estimatedRecovery = maxScore - currentScore; // All lost points are potential recovery

    // Create recommendations for each lost-point question (mark all as POSSIBLE)
    const recommendations: Array<{
      question: string;
      rubricItem: string;
      issue: string;
      evidence: string;
      confidence: "LIKELY" | "POSSIBLE";
      potentialRecovery: number;
    }> = lostPointQuestions.map((q) => ({
      question: q.name,
      rubricItem: "Pending analysis",
      issue: "Points were lost on this question",
      evidence: "See submission content",
      confidence: "POSSIBLE" as const,
      potentialRecovery: q.maxScore - q.score,
    }));

    const estimatedAnalysis: AnalysisResult = {
      summary: {
        currentScore,
        maxScore,
        totalFindings: lostPointQuestions.length,
        estimatedRecovery,
      },
      recommendations,
      noFindings: [],
      illegibleQuestions: [],
    };

    // 10. Return structured AnalysisInternalResult
    const result: AnalysisInternalResult = {
      analysis: estimatedAnalysis,
      submissionPages,
      analysisPrompt,
      metadata: {
        courseName: course.name,
        assignmentName: assignment.name,
        totalPages,
        pagesIncluded: submissionPages.length,
        questionsAnalyzed: lostPointQuestions.length,
      },
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
        { error: String(error), courseId: course.id, assignmentId: assignment.id }
      )
    );
  }
}

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

        // 4. Call internal analysis function with resolved course and assignment
        const analysisResult = await analyzeSubmissionInternal(
          gsClient,
          cache,
          matchedCourse,
          matchedAssignment,
          forceRefresh ?? false
        );

        // 5. Check if success (AnalysisInternalResult) or error (CallToolResult)
        if (isAnalysisInternalResult(analysisResult)) {
          // Success path: assemble multimodal response
          return assembleMultimodalResponse(analysisResult);
        } else {
          // Error path: return error response directly
          return analysisResult;
        }
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
export async function fetchCourses(
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
export async function fetchAssignments(
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
export function findAssignment(
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
