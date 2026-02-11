/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Regrade request formatter.
 * Transforms structured AnalysisRecommendation data into professional,
 * copy-pasteable justification paragraphs grouped by question.
 */

import type { AnalysisRecommendation } from "../gradescope/types.js";

/**
 * A formatted regrade request for one question, ready for Gradescope's regrade form.
 */
export interface RegradeRequest {
  question: string;
  justification: string;
  estimatedRecovery: number;
  findingsCount: number;
  confidenceBreakdown: string; // e.g. "1 LIKELY, 2 POSSIBLE"
}

/** Maximum length for evidence strings before truncation. */
const MAX_EVIDENCE_LENGTH = 200;

/** Accusatory patterns that should never appear in regrade text. */
const ACCUSATORY_PATTERNS = [
  "you made a mistake",
  "this is wrong",
  "you missed",
  "incorrect grading",
  "this should be",
  "you forgot",
  "grading error",
];

/**
 * Format structured analysis recommendations into professional regrade requests.
 * Groups recommendations by question and generates one RegradeRequest per question.
 *
 * @param recommendations - Array of analysis recommendations from the analysis engine
 * @param _assignmentName - Assignment name (reserved for future template use)
 * @returns Array of RegradeRequest objects, one per question, sorted by question name
 */
export function formatRegradeRequests(
  recommendations: AnalysisRecommendation[],
  _assignmentName: string,
): RegradeRequest[] {
  if (recommendations.length === 0) {
    return [];
  }

  // Group recommendations by question
  const grouped = new Map<string, AnalysisRecommendation[]>();
  for (const rec of recommendations) {
    const existing = grouped.get(rec.question);
    if (existing) {
      existing.push(rec);
    } else {
      grouped.set(rec.question, [rec]);
    }
  }

  // Build one RegradeRequest per question
  const requests: RegradeRequest[] = [];
  for (const [question, recs] of grouped) {
    const justification = generateJustificationText(question, recs);
    const estimatedRecovery = recs.reduce(
      (sum, r) => sum + r.potentialRecovery,
      0,
    );
    const confidenceBreakdown = buildConfidenceBreakdown(recs);

    requests.push({
      question,
      justification,
      estimatedRecovery,
      findingsCount: recs.length,
      confidenceBreakdown,
    });
  }

  return requests;
}

/**
 * Generate professional justification text for a single question's findings.
 * Sorts LIKELY findings before POSSIBLE, uses plain text formatting with
 * ALL CAPS labels for structure. Tone is respectful inquiry framing.
 *
 * @param questionName - The question identifier (e.g. "Q1", "Question 3")
 * @param recommendations - All recommendations for this question
 * @returns Plain text justification suitable for Gradescope's regrade form
 */
function generateJustificationText(
  questionName: string,
  recommendations: AnalysisRecommendation[],
): string {
  // Sort: LIKELY first, then POSSIBLE
  const sorted = [...recommendations].sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === "LIKELY" ? -1 : 1;
  });

  const lines: string[] = [];

  // Opening line
  lines.push(
    `I would like to respectfully request a regrade review for ${questionName}.`,
  );
  lines.push("");

  // Findings section
  if (sorted.length === 1) {
    // Single finding: no numbering
    const rec = sorted[0];
    lines.push(`RUBRIC ITEM: ${rec.rubricItem}`);
    lines.push(`CONCERN: ${rec.issue}`);
    lines.push(`EVIDENCE: ${truncateEvidence(rec.evidence)}`);
  } else {
    // Multiple findings: numbered list
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      if (i > 0) {
        lines.push("");
      }
      lines.push(`${i + 1}. RUBRIC ITEM: ${rec.rubricItem}`);
      lines.push(`   CONCERN: ${rec.issue}`);
      lines.push(`   EVIDENCE: ${truncateEvidence(rec.evidence)}`);
    }
  }

  lines.push("");

  // Closing paragraph with singular/plural language
  const singular = sorted.length === 1;
  lines.push(
    `I believe ${singular ? "this area" : "these areas"} may warrant a second look, as my work appears to address the rubric criteria. I would appreciate clarification on how ${singular ? "this rubric item was" : "these rubric items were"} applied in this case.`,
  );
  lines.push("");
  lines.push("Thank you for your time and consideration.");

  return lines.join("\n");
}

/**
 * Truncate evidence text to MAX_EVIDENCE_LENGTH characters.
 * Appends "..." if truncated.
 */
function truncateEvidence(evidence: string): string {
  if (evidence.length <= MAX_EVIDENCE_LENGTH) {
    return evidence;
  }
  return evidence.slice(0, MAX_EVIDENCE_LENGTH) + "...";
}

/**
 * Build a human-readable confidence breakdown string.
 * e.g. "1 LIKELY, 2 POSSIBLE" or "3 LIKELY"
 */
function buildConfidenceBreakdown(
  recommendations: AnalysisRecommendation[],
): string {
  let likely = 0;
  let possible = 0;
  for (const rec of recommendations) {
    if (rec.confidence === "LIKELY") {
      likely++;
    } else {
      possible++;
    }
  }

  const parts: string[] = [];
  if (likely > 0) parts.push(`${likely} LIKELY`);
  if (possible > 0) parts.push(`${possible} POSSIBLE`);
  return parts.join(", ");
}

/**
 * Validate that text does not contain accusatory or unprofessional language.
 * This is a safety net for template-generated text -- since we control the
 * templates, tone should always pass. The MCP tool can call this as a sanity check.
 *
 * @param text - The justification text to validate
 * @returns Validation result with any matched accusatory patterns
 */
export function validateTone(text: string): {
  valid: boolean;
  issues: string[];
} {
  const lowerText = text.toLowerCase();
  const issues: string[] = [];

  for (const pattern of ACCUSATORY_PATTERNS) {
    if (lowerText.includes(pattern)) {
      issues.push(pattern);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
