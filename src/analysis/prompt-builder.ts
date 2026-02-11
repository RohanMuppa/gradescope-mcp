/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Analysis prompt builder and Zod validation schemas.
 * Constructs structured prompts for Claude to analyze grade deductions.
 */

import { z } from "zod";
import type {
  RubricAndFeedback,
  QuestionScore,
  RubricItem,
} from "../gradescope/types.js";
import { GradescopeError } from "../utils/errors.js";

export const AnalysisRecommendationSchema = z.object({
  question: z.string(),
  rubricItem: z.string(),
  issue: z.string(),
  evidence: z.string(),
  confidence: z.enum(["LIKELY", "POSSIBLE"]),
  potentialRecovery: z.number(),
});

export const AnalysisResultSchema = z.object({
  summary: z.object({
    currentScore: z.number(),
    maxScore: z.number(),
    totalFindings: z.number(),
    estimatedRecovery: z.number(),
  }),
  recommendations: z.array(AnalysisRecommendationSchema),
  noFindings: z.array(z.string()),
  illegibleQuestions: z.array(z.string()),
});

export type AnalysisResultValidated = z.infer<typeof AnalysisResultSchema>;

/**
 * Builds the analysis prompt text that instructs Claude how to compare
 * submission content against rubric items and identify potential grading errors.
 *
 * @param rubricData - Rubric items and feedback for the assignment
 * @param lostPointQuestions - Questions where points were lost (only these are analyzed)
 * @param assignmentContext - Assignment metadata for context
 * @returns Prompt text to be included after submission images
 */
export function buildAnalysisPrompt(
  rubricData: RubricAndFeedback,
  lostPointQuestions: QuestionScore[],
  assignmentContext: {
    courseName: string;
    assignmentName: string;
    totalScore: number;
    maxScore: number;
  }
): string {
  const { courseName, assignmentName, totalScore, maxScore } =
    assignmentContext;

  // Build per-question rubric sections
  const questionSections = lostPointQuestions
    .map((question) => {
      // Get all rubric items for this question
      const questionRubricItems = rubricData.rubricItems.filter(
        (item) => item.questionName === question.name
      );

      if (questionRubricItems.length === 0) {
        return null;
      }

      const rubricItemsList = questionRubricItems
        .map((item) => {
          const commentSection = item.comment
            ? `\n   - Grader comment: "${item.comment}"`
            : "";
          return `   - **${item.name}** (${item.points} / ${item.maxPoints} points): ${item.description}${commentSection}`;
        })
        .join("\n");

      return `### ${question.name} (${question.score} / ${question.maxScore} points)

${rubricItemsList}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const prompt = `# Grade Analysis Request

## Assignment Context

- **Course:** ${courseName}
- **Assignment:** ${assignmentName}
- **Current Score:** ${totalScore} / ${maxScore} points
- **Questions to Analyze:** ${lostPointQuestions.length} (only questions where points were lost)

## Rubric Data

${questionSections}

## Your Task

You are helping a student identify potential grading errors to discuss respectfully with their instructor. The student has provided images of their submission work above.

**Compare the student's work (shown in the images above) against each rubric item that was applied.** Look for evidence that:
- A rubric item was applied incorrectly (deduction shouldn't have been made)
- The grader may have missed content that addresses the rubric criteria
- The student's work contradicts the basis for the deduction

## Critical Constraints

1. **Scope:** ONLY analyze rubric application correctness. NEVER comment on whether the rubric itself is fair or whether the question design is reasonable. Your job is to check if the rubric was applied correctly, not to evaluate the rubric.

2. **Evidence:**
   - Use direct quotes when handwriting is clear and legible
   - Use descriptions when handwriting is unclear but interpretable
   - If handwriting is completely illegible, note the question as illegible and skip it — do NOT guess or speculate

3. **Framing:** Frame ALL findings as "potential opportunities to investigate" — never make definitive claims about errors. The student will verify your findings before discussing with their instructor.

4. **Confidence Levels:** Assign exactly ONE confidence level per finding:
   - **LIKELY:** Strong evidence suggests the rubric item was applied incorrectly
   - **POSSIBLE:** Worth checking, but less certain — could go either way
   - When in doubt, mark as POSSIBLE rather than LIKELY

5. **Respect:** Protect the student-instructor relationship. Your analysis should help the student have an informed, respectful conversation with their instructor.

## Output Format

Respond with **valid JSON** matching this exact structure:

\`\`\`json
{
  "summary": {
    "currentScore": ${totalScore},
    "maxScore": ${maxScore},
    "totalFindings": 0,
    "estimatedRecovery": 0
  },
  "recommendations": [
    {
      "question": "Q1",
      "rubricItem": "Incorrect algorithm",
      "issue": "Description of the potential grading error",
      "evidence": "Direct quote or description from student work",
      "confidence": "LIKELY",
      "potentialRecovery": 5
    }
  ],
  "noFindings": ["Q2"],
  "illegibleQuestions": []
}
\`\`\`

**Field Definitions:**
- \`recommendations\`: Array of potential grading errors found, one per rubric item
- \`noFindings\`: Array of question names that were analyzed but no issues were found
- \`illegibleQuestions\`: Array of question names skipped because content was unreadable
- \`summary.totalFindings\`: Count of recommendations array length
- \`summary.estimatedRecovery\`: Sum of potentialRecovery across all recommendations

Return **only** the JSON object. Do not include any other text before or after the JSON.`;

  return prompt;
}

/**
 * Parses and validates Claude's analysis response against the Zod schema.
 *
 * @param rawJson - Raw JSON string from Claude's response
 * @returns Validated AnalysisResult object
 * @throws GradescopeError with VALIDATION_ERROR if parsing fails
 */
export function parseAnalysisResponse(rawJson: string): AnalysisResultValidated {
  try {
    const parsed = JSON.parse(rawJson);
    const result = AnalysisResultSchema.safeParse(parsed);

    if (!result.success) {
      throw new GradescopeError(
        "VALIDATION_ERROR",
        "[GSMCP-1038] Analysis response does not match expected schema",
        {
          fingerprint: "GSMCP-1038",
          zodErrors: result.error.issues,
        },
        "Ensure Claude's response follows the AnalysisResult schema"
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof GradescopeError) {
      throw error;
    }

    throw new GradescopeError(
      "VALIDATION_ERROR",
      "[GSMCP-1038] Failed to parse analysis response JSON",
      {
        fingerprint: "GSMCP-1038",
        parseError: error instanceof Error ? error.message : String(error),
      },
      "Ensure Claude's response is valid JSON"
    );
  }
}
