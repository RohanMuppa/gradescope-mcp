/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * HTML and text sanitization for scraped content.
 * Prevents HTML injection and prompt injection in MCP responses.
 */

/**
 * Sanitize scraped HTML/text content for safe inclusion in MCP responses.
 * Strips HTML tags, decodes entities, removes control characters, and collapses whitespace.
 *
 * @param text - The text to sanitize
 * @returns Sanitized plain text
 */
export function sanitizeScrapedText(text: string): string {
  let sanitized = text;

  // Strip HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  for (const [entity, char] of Object.entries(entities)) {
    sanitized = sanitized.replace(new RegExp(entity, 'g'), char);
  }

  // Decode numeric entities (&#123; and &#xAB; formats)
  sanitized = sanitized.replace(/&#(\d+);/g, (_, code) => {
    return String.fromCharCode(parseInt(code, 10));
  });
  sanitized = sanitized.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
    return String.fromCharCode(parseInt(code, 16));
  });

  // Remove control characters (except newline, tab, carriage return)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Collapse multiple whitespace into single space
  sanitized = sanitized.replace(/[ \t]+/g, ' ');

  // Collapse multiple newlines into maximum two
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Neutralize potential prompt injection attempts in scraped content.
 * Strips instruction-like patterns that could manipulate LLM behavior.
 *
 * @param text - The text to neutralize
 * @returns Text with prompt injection attempts removed
 */
export function neutralizePromptInjection(text: string): string {
  let neutralized = text;

  // Remove lines that look like LLM role instructions
  const rolePatterns = [
    /^System:/im,
    /^Assistant:/im,
    /^Human:/im,
    /^User:/im,
    /^AI:/im,
  ];

  for (const pattern of rolePatterns) {
    neutralized = neutralized.replace(pattern, '[Redacted]:');
  }

  // Remove XML-like instruction tags
  const xmlPatterns = [
    /<system>[\s\S]*?<\/system>/gi,
    /<instructions>[\s\S]*?<\/instructions>/gi,
    /<prompt>[\s\S]*?<\/prompt>/gi,
    /<context>[\s\S]*?<\/context>/gi,
  ];

  for (const pattern of xmlPatterns) {
    neutralized = neutralized.replace(pattern, '[Redacted XML]');
  }

  // Remove standalone XML-like tags
  neutralized = neutralized.replace(/<\/?(?:system|instructions|prompt|context)>/gi, '');

  return neutralized;
}
