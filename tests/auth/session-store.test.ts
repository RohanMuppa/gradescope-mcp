/**
 * TDD tests for SessionStore - encrypted session persistence.
 * Tests MUST fail until SessionStore is implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { SessionStore } from "../../src/auth/session-store.js";
import type { SessionData } from "../../src/auth/types.js";

describe("SessionStore", () => {
  let sessionDir: string;
  let store: SessionStore;

  beforeEach(() => {
    // Create unique temp directory for each test
    sessionDir = path.join(os.tmpdir(), `gradescope-test-${crypto.randomUUID()}`);
    store = new SessionStore(sessionDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("saves and loads session data roundtrip", async () => {
    const sessionData: SessionData = {
      cookie: "_gradescope_session=test_cookie_value_12345",
      capturedAt: Date.now(),
      extraCookies: {
        csrf_token: "csrf_abc123",
      },
    };

    await store.save(sessionData);
    const loaded = await store.load();

    expect(loaded).not.toBeNull();
    expect(loaded?.cookie).toBe(sessionData.cookie);
    expect(loaded?.capturedAt).toBe(sessionData.capturedAt);
    expect(loaded?.extraCookies?.csrf_token).toBe("csrf_abc123");
  });

  it("returns null when no session file exists", async () => {
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("returns null when session file is corrupted", async () => {
    // Create session directory and write garbage
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const sessionFilePath = path.join(sessionDir, "session.json");
    await fs.writeFile(sessionFilePath, "this is not valid JSON {{{", "utf-8");

    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("returns null when session file is tampered", async () => {
    // Save valid session first
    const sessionData: SessionData = {
      cookie: "_gradescope_session=original_value",
      capturedAt: Date.now(),
    };
    await store.save(sessionData);

    // Tamper with the encrypted data
    const sessionFilePath = path.join(sessionDir, "session.json");
    const fileContent = await fs.readFile(sessionFilePath, "utf-8");
    const sessionFile = JSON.parse(fileContent);

    // Flip one bit in the ciphertext
    const originalData = sessionFile.encrypted.data;
    const tamperedData = originalData.substring(0, 10) + "ff" + originalData.substring(12);
    sessionFile.encrypted.data = tamperedData;

    await fs.writeFile(sessionFilePath, JSON.stringify(sessionFile), "utf-8");

    // Load should return null (GCM auth tag verification fails)
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("clear deletes the session file", async () => {
    const sessionData: SessionData = {
      cookie: "_gradescope_session=to_be_cleared",
      capturedAt: Date.now(),
    };

    await store.save(sessionData);

    // Verify it exists first
    let loaded = await store.load();
    expect(loaded).not.toBeNull();

    // Clear it
    await store.clear();

    // Verify it's gone
    loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("clear is idempotent (no error on missing file)", async () => {
    // Clear on non-existent session should not throw
    await expect(store.clear()).resolves.toBeUndefined();

    // Do it again
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("exists returns true when session is saved", async () => {
    const sessionData: SessionData = {
      cookie: "_gradescope_session=exists_test",
      capturedAt: Date.now(),
    };

    await store.save(sessionData);
    const doesExist = await store.exists();

    expect(doesExist).toBe(true);
  });

  it("exists returns false when no session", async () => {
    const doesExist = await store.exists();
    expect(doesExist).toBe(false);
  });

  it("creates session directory with 0700 permissions", async () => {
    const sessionData: SessionData = {
      cookie: "_gradescope_session=perm_test",
      capturedAt: Date.now(),
    };

    await store.save(sessionData);

    // Check directory permissions
    const dirStats = await fs.stat(sessionDir);
    const dirMode = dirStats.mode & 0o777;

    expect(dirMode).toBe(0o700);
  });

  it("creates session file with 0600 permissions", async () => {
    const sessionData: SessionData = {
      cookie: "_gradescope_session=file_perm_test",
      capturedAt: Date.now(),
    };

    await store.save(sessionData);

    // Check file permissions
    const sessionFilePath = path.join(sessionDir, "session.json");
    const fileStats = await fs.stat(sessionFilePath);
    const fileMode = fileStats.mode & 0o777;

    expect(fileMode).toBe(0o600);
  });
});
