/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * Tests for session integrity with HMAC verification.
 * Verifies encryption, tamper detection, and file permissions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../../src/auth/session-store.js";
import type { SessionData } from "../../src/auth/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("Session Integrity", () => {
  let sessionStore: SessionStore;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = path.join(os.tmpdir(), `test-session-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tempDir, { recursive: true });
    sessionStore = new SessionStore(tempDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Round trip (save + load)", () => {
    it("should successfully save and load session", async () => {
      const sessionData: SessionData = {
        cookies: [
          {
            name: "_gradescope_session",
            value: "test-session-value",
            domain: ".gradescope.com",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };

      await sessionStore.save(sessionData);
      const loaded = await sessionStore.load();

      expect(loaded).not.toBeNull();
      expect(loaded?.cookies[0].name).toBe("_gradescope_session");
      expect(loaded?.cookies[0].value).toBe("test-session-value");
      expect(loaded?.expiresAt).toBe(sessionData.expiresAt);
    });

    it("should handle multiple save/load cycles", async () => {
      const session1: SessionData = {
        cookies: [{ name: "cookie1", value: "value1", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(session1);
      const loaded1 = await sessionStore.load();
      expect(loaded1?.cookies[0].value).toBe("value1");

      // Save new session
      const session2: SessionData = {
        cookies: [{ name: "cookie2", value: "value2", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 2000,
      };

      await sessionStore.save(session2);
      const loaded2 = await sessionStore.load();
      expect(loaded2?.cookies[0].value).toBe("value2");
    });
  });

  describe("Tamper detection", () => {
    it("should detect tampered ciphertext", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      // Read and tamper with file
      const filePath = path.join(tempDir, "session.json");
      const fileContent = await fs.readFile(filePath, "utf-8");
      const sessionFile = JSON.parse(fileContent);

      // Tamper with encrypted data (flip one character)
      sessionFile.encrypted.data =
        sessionFile.encrypted.data.substring(0, 10) +
        (sessionFile.encrypted.data[10] === "a" ? "b" : "a") +
        sessionFile.encrypted.data.substring(11);

      await fs.writeFile(filePath, JSON.stringify(sessionFile), "utf-8");

      // Load should return null (tamper detected)
      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });

    it("should detect tampered HMAC", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      // Read and tamper with HMAC
      const filePath = path.join(tempDir, "session.json");
      const fileContent = await fs.readFile(filePath, "utf-8");
      const sessionFile = JSON.parse(fileContent);

      // Tamper with HMAC
      sessionFile.hmac = "0".repeat(64); // Invalid HMAC

      await fs.writeFile(filePath, JSON.stringify(sessionFile), "utf-8");

      // Load should return null (HMAC mismatch)
      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });

    it("should detect tampered IV", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      // Read and tamper with IV
      const filePath = path.join(tempDir, "session.json");
      const fileContent = await fs.readFile(filePath, "utf-8");
      const sessionFile = JSON.parse(fileContent);

      // Tamper with IV
      sessionFile.encrypted.iv = "0".repeat(24); // Different IV

      await fs.writeFile(filePath, JSON.stringify(sessionFile), "utf-8");

      // Load should return null (decryption will fail)
      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });
  });

  describe("Legacy session handling", () => {
    it("should load legacy session without HMAC", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      // Read and remove HMAC (simulate legacy session)
      const filePath = path.join(tempDir, "session.json");
      const fileContent = await fs.readFile(filePath, "utf-8");
      const sessionFile = JSON.parse(fileContent);

      delete sessionFile.hmac;

      await fs.writeFile(filePath, JSON.stringify(sessionFile), "utf-8");

      // Should still load (backward compatibility)
      const loaded = await sessionStore.load();
      expect(loaded).not.toBeNull();
      expect(loaded?.cookies[0].value).toBe("value");
    });
  });

  describe("File permissions", () => {
    it("should create directory with 0700 permissions", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      const stats = await fs.stat(tempDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });

    it("should create file with 0600 permissions", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      const filePath = path.join(tempDir, "session.json");
      const stats = await fs.stat(filePath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("should fix incorrect file permissions on load", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);

      // Change permissions to wrong value
      const filePath = path.join(tempDir, "session.json");
      await fs.chmod(filePath, 0o644);

      // Load should fix permissions
      await sessionStore.load();

      const stats = await fs.stat(filePath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("Error handling", () => {
    it("should return null when file does not exist", async () => {
      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });

    it("should return null for corrupted JSON", async () => {
      const filePath = path.join(tempDir, "session.json");
      await fs.writeFile(filePath, "invalid json{{{", "utf-8");

      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });

    it("should return null for invalid encrypted data", async () => {
      const filePath = path.join(tempDir, "session.json");
      const invalidSession = {
        version: 1,
        encrypted: {
          iv: "invalid",
          authTag: "invalid",
          data: "invalid",
        },
        createdAt: Date.now(),
        hmac: "0".repeat(64),
      };
      await fs.writeFile(filePath, JSON.stringify(invalidSession), "utf-8");

      const loaded = await sessionStore.load();
      expect(loaded).toBeNull();
    });
  });

  describe("Session management", () => {
    it("should clear session file", async () => {
      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);
      expect(await sessionStore.exists()).toBe(true);

      await sessionStore.clear();
      expect(await sessionStore.exists()).toBe(false);
    });

    it("should not throw when clearing non-existent session", async () => {
      await expect(sessionStore.clear()).resolves.not.toThrow();
    });

    it("should correctly report session existence", async () => {
      expect(await sessionStore.exists()).toBe(false);

      const sessionData: SessionData = {
        cookies: [{ name: "test", value: "value", domain: ".gradescope.com", path: "/" }],
        expiresAt: Date.now() + 1000,
      };

      await sessionStore.save(sessionData);
      expect(await sessionStore.exists()).toBe(true);
    });
  });
});
