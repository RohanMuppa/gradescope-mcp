# Roadmap: Gradescope MCP

## Overview

This roadmap delivers an MCP server that gives Purdue students AI-powered grade defense on Gradescope. The journey starts with project scaffolding and infrastructure utilities (cache, rate limiter), then establishes authenticated access to Gradescope via Purdue SSO, progressively builds out data access from courses down to individual rubric items and submission PDFs, and culminates in the killer feature: multimodal analysis that compares submissions against rubrics to identify regrade opportunities with copy-pasteable justifications. Each phase delivers a verifiable, user-facing capability that builds on the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Infrastructure** - Project scaffolding, caching layer, and rate limiter
- [ ] **Phase 2: Authentication & Session Management** - Purdue SSO login with persistent encrypted sessions
- [ ] **Phase 3: Course & Assignment Data** - List courses, assignments, and scores via MCP tools
- [x] **Phase 4: Rubric & Feedback Access** - Per-question rubric breakdowns and grader comments
- [x] **Phase 5: Submission Download & Content Pipeline** - PDF/image download with multimodal content preparation
- [x] **Phase 6: Single Assignment Analysis** - AI-powered grade defense analysis for individual assignments
- [x] **Phase 7: Batch Scanning & Deadline Tracking** - Scan all graded work and track regrade windows
- [ ] **Phase 8: Regrade Request Formatting** - Copy-pasteable regrade text matching Gradescope's form
- [ ] **Phase 9: Security Hardening & Privacy Protection** - Comprehensive security audit, credential protection, data scrubbing, and privacy controls
- [x] **Phase 10: Proprietary Protections** - AGPL-3.0 licensing, copyright headers, error code fingerprints, and runtime attribution

## Phase Details

### Phase 1: Foundation & Infrastructure
**Goal**: A buildable TypeScript MCP server project exists with production-grade caching and rate limiting utilities ready for use by all subsequent phases
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. Running `npm run build` produces a working TypeScript build with zero errors
  2. MCP server starts via stdio transport and responds to `initialize` handshake
  3. In-memory cache stores and retrieves values with configurable TTLs per data type (courses=1h, assignments=30m, grades=5m, rubrics=15m)
  4. Rate limiter enforces token bucket algorithm with configurable capacity and refill rate, adding jitter to request timing
  5. Project structure follows parser isolation pattern with clear separation between tools, client, parsers, and content layers
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Project scaffolding: package.json, tsconfig, MCP server entry point, directory structure, typed errors, logger, config, tool helpers, clear_cache tool
- [ ] 01-02-PLAN.md -- TTLCache and TokenBucket utilities with comprehensive TDD tests, wired into MCP server

### Phase 2: Authentication & Session Management
**Goal**: User can authenticate to Gradescope via email/password login and maintain persistent encrypted sessions without re-authenticating every time
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. User can trigger Gradescope email/password login via a `login` MCP tool (Playwright visible browser) and receive confirmation of successful authentication
  2. Gradescope session cookie is captured and stored encrypted on disk at `~/.gradescope-session/`, surviving server restarts
  3. User can call `check_auth` tool and see whether their session is currently valid
  4. When session expires, user receives a clear message explaining they need to re-authenticate (not a cryptic error or silent failure)
  5. CSRF tokens are extracted from Gradescope pages and managed automatically for all subsequent requests
**Plans**: 4 plans

Plans:
- [ ] 02-01-PLAN.md -- Encrypted session store (AES-256-GCM with machine-derived key, TDD)
- [ ] 02-02-PLAN.md -- Playwright browser automation (visible Chromium, cookie capture) + AuthManager facade
- [ ] 02-03-PLAN.md -- CSRF token manager (HTML extraction, caching, auto-refresh)
- [ ] 02-04-PLAN.md -- MCP tools: `login`, `check_auth`, `logout` with human verification

### Phase 3: Course & Assignment Data
**Goal**: User can browse their Gradescope courses and assignments with grades through MCP tools, validating the entire scraping pipeline end-to-end
**Depends on**: Phase 2
**Requirements**: DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. User can call `get_courses` and see all their enrolled Gradescope courses with names and roles
  2. User can call `get_assignments` for any course and see assignment names, due dates, status, and scores
  3. User can call `get_grades` for any graded assignment and see their score
  4. Responses are cached appropriately (courses 1h, assignments 30m, grades 5m) and rate-limited
  5. HTML parsing uses isolated parser modules with stable TypeScript interfaces (JSON-first with HTML fallback)
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- Enrich domain types and parsers with instructor name, enrollment count, submission date, assignment type, late status, full absolute URLs
- [ ] 03-02-PLAN.md -- Refactor MCP tools: get_courses with semester filter, merged get_grades_and_assignments with fuzzy matching, status grouping, type filter, next-action hints

### Phase 4: Rubric & Feedback Access
**Goal**: User can see the detailed rubric breakdown and grader feedback for any graded assignment -- the granular data that Brightspace cannot access
**Depends on**: Phase 3
**Requirements**: DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. User can call `get_rubric` for any graded assignment and see all rubric items per question with point values and applied/unapplied status
  2. User can see grader comments and annotations attached to specific rubric items
  3. Rubric data includes both applied deductions (why points were lost) and unapplied items (what could have been deducted but was not)
  4. Data is structured and machine-readable so downstream analysis tools can reason about rubric items programmatically
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md -- Domain types (RubricItem, QuestionScore, RubricAndFeedback) and unified rubric parser with assignment type detection, autograder normalization, feedback anonymization, graceful degradation
- [ ] 04-02-PLAN.md -- MCP tool: `get_rubric_and_feedback` with fuzzy course/assignment matching, wired into server

### Phase 5: Submission Download & Content Pipeline
**Goal**: User can download their submission content (PDFs, scanned exams) and have it prepared as multimodal content for Claude to analyze visually
**Depends on**: Phase 4
**Requirements**: SUB-01, SUB-02
**Success Criteria** (what must be TRUE):
  1. User can call `get_submission` for any graded assignment and receive the submission PDF/images
  2. Downloaded PDFs are converted to page-level images suitable for Claude's multimodal analysis
  3. Content pipeline targets specific pages (not entire documents) to manage API costs
  4. Submission content is returned as MCP multimodal content blocks (text + base64 images) ready for Claude to reason about visually
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md -- Binary download (getRaw method) + submission page parser + domain types
- [x] 05-02-PLAN.md -- PDF-to-image conversion (unpdf), image optimization (Sharp), page targeting logic
- [x] 05-03-PLAN.md -- Multimodal content formatter + get_submission MCP tool wired into server

### Phase 6: Single Assignment Analysis
**Goal**: User can ask Claude to analyze a specific graded assignment against its rubric and receive structured regrade recommendations identifying where points may have been incorrectly deducted
**Depends on**: Phase 5
**Requirements**: DEF-01, DEF-03
**Success Criteria** (what must be TRUE):
  1. User can call `analyze_submission` for a specific assignment and receive an analysis comparing their work against the rubric
  2. Analysis identifies specific rubric items where points may have been incorrectly deducted, citing evidence from the submission
  3. Each regrade recommendation includes the rubric item reference, expected point recovery, evidence from the submission, and a confidence level
  4. Recommendations are framed as "potential opportunities to investigate" (not definitive claims) to protect student-instructor relationships
  5. Analysis works for both PDF homework uploads and scanned paper exams (handwritten content)
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md -- Analysis types, Zod output schemas, and prompt builder (rubric comparison instructions, evidence citing, confidence framing, tone guidance)
- [x] 06-02-PLAN.md -- Multimodal content assembler (images-first ordering, lost-point page targeting, buffer cleanup)
- [x] 06-03-PLAN.md -- MCP tool: `analyze_submission` composing rubric + submission into multimodal content blocks, registered in server

### Phase 7: Batch Scanning & Deadline Tracking
**Goal**: User can scan all graded assignments across all courses at once to find regrade opportunities, with awareness of which regrade windows are still open
**Depends on**: Phase 6
**Requirements**: DEF-02, DEF-05
**Success Criteria** (what must be TRUE):
  1. User can call `scan_regrades` and receive a summary of regrade opportunities across all courses and all graded assignments
  2. Each opportunity shows which assignment, which rubric items, estimated point recovery, and confidence level
  3. Regrade window deadlines are tracked and displayed for each assignment (e.g., "3 days remaining to dispute")
  4. Assignments with closed regrade windows are flagged but still shown for informational purposes
  5. Scan is efficient -- uses cached data where available and respects rate limits even when processing many assignments
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md -- Domain types (DeadlineInfo, ScanResult, BatchError, CourseResults), deadline detection parser with multi-selector fallback, analysis cache TTL
- [x] 07-02-PLAN.md -- Extract analyzeSubmissionInternal for internal composition, batch scanning orchestrator with deadline-aware grouping, progress notifications, partial failure handling
- [x] 07-03-PLAN.md -- Register scan_regrades tool in MCP server, verify full build

### Phase 8: Regrade Request Formatting
**Goal**: User receives regrade recommendations formatted as copy-pasteable text that matches Gradescope's regrade request form, ready to submit manually
**Depends on**: Phase 7
**Requirements**: DEF-04
**Success Criteria** (what must be TRUE):
  1. Regrade recommendations include a pre-written justification paragraph the student can paste directly into Gradescope's regrade request form
  2. Justification text references specific rubric items by name and cites specific evidence from the submission
  3. Tone is respectful and professional -- suitable for student-to-instructor communication
  4. User can request formatted regrade text for any identified opportunity from `scan_regrades` or `analyze_submission` results
**Plans**: TBD

Plans:
- [ ] 08-01: Regrade text templates (per-rubric-item justification generation, tone calibration)
- [ ] 08-02: Integration with analysis and scan tools (format output on demand)

### Phase 9: Security Hardening & Privacy Protection
**Goal**: Every line of code in the project is audited and hardened so that the user's personal information, credentials, academic data, and browsing patterns are protected at rest, in transit, and in memory — with zero data leakage to logs, error messages, disk, or third parties
**Depends on**: Phase 8 (all functional code exists to audit and harden)
**Requirements**: SEC-01 through SEC-30
**Success Criteria** (what must be TRUE):
  1. Zero credentials (username, password) persist anywhere after the authentication flow completes — verified by searching all disk writes and memory snapshots
  2. Session cookie file at `~/.gradescope-session/` is AES-256-GCM encrypted with integrity verification (HMAC), owner-only permissions (0600), and rejects tampered files by forcing re-auth
  3. No personal information (name, email, Purdue ID, phone, grades, course names, assignment titles) appears in any log output, console.error, debug trace, or MCP error response — verified by automated log scrubbing tests with PII injection, prompt injection, etc
  4. All HTTP connections enforce TLS 1.2+ with certificate validation — downgrade attacks and self-signed certs are rejected, connections fail closed
  5. All cached data (courses, assignments, grades, rubrics) and downloaded content (PDFs, images, base64) exists only in-memory and is purged on session invalidation, server shutdown, or crash via signal handlers
  6. Submission PDFs/images are never written to disk (no temp files) — content flows through memory only and is cleared after MCP response delivery
  7. CSRF tokens, session cookies, and auth headers never appear in any MCP tool response — only processed/derived data is returned to the client
  8. All MCP tool parameters (course IDs, assignment IDs, etc.) are validated against strict format/range allowlists — injection payloads are rejected before reaching any HTTP call or parser
  9. Rate limiter includes abuse detection that halts all requests if traffic exceeds 50 req/min, with user-visible warning
  10. Playwright SSO browser runs in an ephemeral sandboxed context with no persistent storage, no extensions, no access to default browser profile — context is destroyed immediately after cookie capture
  11. All scraped HTML/text from Gradescope is treated as untrusted — sanitized before inclusion in MCP responses, never eval'd or directly interpolated into templates
  12. File path operations are validated against a strict allowlist (`~/.gradescope-session/` only) — path traversal attempts are blocked and logged
  13. `npm audit` passes with zero critical/high vulnerabilities, lock file is committed, and a pre-build audit check is configured
  14. A `privacy_report` MCP tool exists that tells the user exactly what data is stored, where it lives on disk, and how to delete everything
  15. Graceful crash handling via SIGINT/SIGTERM/SIGKILL(best-effort) handlers clears sensitive in-memory data and optionally wipes the session file
  16. No third-party analytics, telemetry, or crash reporting — zero data leaves the machine except HTTPS requests to gradescope.com and Purdue SSO endpoints
  17. MCP tool descriptions reveal no internal implementation details (CSS selectors, URL patterns, parsing logic) that could be exploited
  18. Comprehensive security test suite exists covering: PII log injection, session tampering detection, TLS enforcement, input validation fuzzing, path traversal, and memory cleanup verification
  19. Authorization boundaries enforce single-user access — architecturally impossible to access another student's grades, submissions, or personal data; all requests scoped to authenticated user's session only
  20. Session isolation guarantees exactly one authenticated user per server instance — no multi-user mode, no shared state; second auth fully purges first session
  21. Anti-enumeration prevents discovery of other users' course/assignment/user IDs; response data is verified to contain ONLY the authenticated user's information before being returned
  22. Session cookie is bound to the originating machine via machine-derived encryption key — copying the session file to another machine causes rejection and forced re-auth (anti-replay)
  23. Outbound network requests are allowlisted to gradescope.com and Purdue SSO domains only — no credentials or tokens are ever sent anywhere else
  24. All Gradescope error responses (403, 404, 500, unexpected HTML) are caught and returned as generic safe messages — raw HTTP responses and headers are NEVER exposed to prevent information leakage
  25. Playwright browser context blocks all third-party scripts/iframes/requests except Purdue SSO and Gradescope, preventing credential theft via XSS on compromised pages
  26. Local PII-free audit log records security events (login attempts, session invalidations, access denials, abuse triggers) with automatic rotation
**Plans**: TBD

Plans:
- [ ] 09-01: Credential lifecycle hardening (zero-persistence credentials, secure memory handling, Playwright sandbox isolation)
- [ ] 09-02: Session encryption & integrity (AES-256-GCM encryption, HMAC tamper detection, file permissions, machine-derived keys)
- [ ] 09-03: PII scrubbing & log sanitization (redaction filters on all output paths, automated PII injection tests)
- [ ] 09-04: Network security (TLS enforcement, certificate validation, connection fail-closed, no telemetry verification)
- [ ] 09-05: Input validation & injection defense (parameter allowlists, HTML sanitization, path traversal protection, prompt injection defense)
- [ ] 09-06: Memory & data lifecycle management (in-memory-only cache enforcement, submission content cleanup, comprehensive session invalidation, crash signal handlers)
- [ ] 09-07: Abuse detection & rate limit hardening (traffic spike detection, automatic request blocking, user-visible warnings)
- [ ] 09-08: Dependency audit & supply chain security (npm audit integration, lock file enforcement, pre-build security checks)
- [ ] 09-09: Privacy transparency tooling (`privacy_report` MCP tool, data inventory, deletion instructions)
- [ ] 09-10: Security test suite (PII leak tests, session tampering tests, TLS tests, input fuzzing, path traversal tests, memory cleanup verification)
- [ ] 09-11: Authorization boundary & session isolation (single-user enforcement, anti-enumeration, response data scoping, cookie identity validation)
- [ ] 09-12: Anti-hacking hardening (credential forwarding allowlist, anti-replay session binding, secure error handling, Playwright CSP lockdown)
- [ ] 09-13: Local audit trail (PII-free security event logging, log rotation, access denial tracking)
- [ ] 09-14: Runtime integrity monitoring & anomaly detection (startup self-checks, session file tamper detection, unexpected process/network anomaly alerts, environment integrity validation)
- [ ] 09-15: Repository sanitization audit (scan git history and working tree for leaked credentials, PII, API keys, hardcoded URLs, absolute user paths, and .env files; scrub or rewrite history as needed; add pre-commit hooks and .gitignore rules to prevent future leaks)

### Phase 10: Proprietary Protections
**Goal**: Every source file has AGPL-3.0 copyright headers, error messages contain unique searchable fingerprint codes, and the author's name appears in runtime metadata — making unauthorized use detectable and attributable
**Depends on**: Phase 9
**Requirements**: N/A (owner-initiated)
**Success Criteria** (what must be TRUE):
  1. AGPL-3.0 license file exists at project root and package.json declares `AGPL-3.0-only`
  2. Every `.ts` file in `src/` has the copyright header block as its first comment
  3. All error/exception classes prefix their messages with unique `[GSMCP-NNNN]` codes
  4. Author name appears in MCP server description, startup log, and HTTP User-Agent
  5. Local FINGERPRINTS.md documents all codes and placements (gitignored)
**Plans**: 1 plan (completed inline)

Plans:
- [x] 10-01-PLAN.md -- AGPL license, copyright headers, error fingerprints, runtime attribution, FINGERPRINTS.md

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10

| Phase                                      | Plans Complete | Status      | Completed  |
| ------------------------------------------ | -------------- | ----------- | ---------- |
| 1. Foundation & Infrastructure             | 0/2            | Not started | -          |
| 2. Authentication & Session Management     | 0/4            | Not started | -          |
| 3. Course & Assignment Data                | 0/4            | Not started | -          |
| 4. Rubric & Feedback Access                | 2/2            | Complete    | 2026-02-11 |
| 5. Submission Download & Content Pipeline  | 3/3            | Complete    | 2026-02-11 |
| 6. Single Assignment Analysis              | 3/3            | Complete    | 2026-02-11 |
| 7. Batch Scanning & Deadline Tracking      | 0/3            | Not started | -          |
| 8. Regrade Request Formatting              | 0/2            | Not started | -          |
| 9. Security Hardening & Privacy Protection | 0/15           | Not started | -          |
| 10. Proprietary Protections                | 1/1            | Complete    | 2026-02-11 |
