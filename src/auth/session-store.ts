/**
 * Gradescope MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

/**
 * SessionStore manages encrypted session persistence to disk.
 * Uses AES-256-GCM encryption with machine-derived keys.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { SessionData, EncryptedData, SessionFile } from "./types.js";
import { log } from "../utils/logger.js";

// Constants
const DEFAULT_SESSION_DIR = path.join(os.homedir(), ".gradescope-session");
const SESSION_FILE_NAME = "session.json";
const SESSION_VERSION = 1;

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const SALT = "gradescope-mcp-session-salt"; // Application-specific salt

/**
 * SessionStore manages encrypted Gradescope session cookie persistence.
 * Uses AES-256-GCM with a key derived from username + hostname.
 * This ensures session files cannot be copied to a different machine.
 */
export class SessionStore {
  private readonly sessionDir: string;
  private readonly sessionFilePath: string;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? DEFAULT_SESSION_DIR;
    this.sessionFilePath = path.join(this.sessionDir, SESSION_FILE_NAME);
  }

  /**
   * Derive AES-256 key from username and hostname using scrypt.
   * This provides per-machine, per-user encryption without requiring a password.
   */
  private deriveKey(): Buffer {
    const username = os.userInfo().username;
    const hostname = os.hostname();
    const keyMaterial = username + hostname;

    // Use scrypt to derive a 32-byte key (256 bits for AES-256)
    return crypto.scryptSync(keyMaterial, SALT, 32);
  }

  /**
   * Compute HMAC-SHA256 of encrypted data for integrity verification.
   * Uses the same machine-derived key as encryption.
   */
  private computeHmac(encrypted: EncryptedData): string {
    const key = this.deriveKey();
    const hmac = crypto.createHmac("sha256", key);

    // Hash IV + authTag + data in order
    hmac.update(encrypted.iv);
    hmac.update(encrypted.authTag);
    hmac.update(encrypted.data);

    return hmac.digest("hex");
  }

  /**
   * Encrypt plaintext using AES-256-GCM.
   * Returns IV, auth tag, and ciphertext as hex strings.
   */
  private encrypt(plaintext: string): EncryptedData {
    const key = this.deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      data: encrypted,
    };
  }

  /**
   * Decrypt ciphertext using AES-256-GCM.
   * Returns plaintext string, or throws if auth tag verification fails.
   */
  private decrypt(encrypted: EncryptedData): string {
    const key = this.deriveKey();
    const iv = Buffer.from(encrypted.iv, "hex");
    const authTag = Buffer.from(encrypted.authTag, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Verify and enforce file permissions on session directory and file.
   * Ensures directory is 0700 (owner-only) and file is 0600 (owner read/write only).
   */
  private async verifyPermissions(): Promise<void> {
    try {
      // Check session directory permissions
      const dirStat = await fs.stat(this.sessionDir);
      const dirMode = dirStat.mode & 0o777;
      if (dirMode !== 0o700) {
        log("WARN", `Session directory permissions incorrect (${dirMode.toString(8)}), fixing to 0700`);
        await fs.chmod(this.sessionDir, 0o700);
      }

      // Check session file permissions
      const fileStat = await fs.stat(this.sessionFilePath);
      const fileMode = fileStat.mode & 0o777;
      if (fileMode !== 0o600) {
        log("WARN", `Session file permissions incorrect (${fileMode.toString(8)}), fixing to 0600`);
        await fs.chmod(this.sessionFilePath, 0o600);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log("WARN", `Failed to verify permissions: ${err.message}`);
      // Don't throw - graceful degradation
    }
  }

  /**
   * Save session data to disk with encryption.
   * Creates session directory with 0700 permissions if it doesn't exist.
   * Writes session file with 0600 permissions.
   */
  async save(session: SessionData): Promise<void> {
    try {
      // Ensure session directory exists with restricted permissions (owner-only)
      await fs.mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
      // Explicitly set permissions (recursive: true may not apply mode correctly)
      await fs.chmod(this.sessionDir, 0o700);

      const plaintext = JSON.stringify(session);
      const encrypted = this.encrypt(plaintext);

      // Compute HMAC for integrity verification
      const hmac = this.computeHmac(encrypted);

      const sessionFile: SessionFile = {
        version: SESSION_VERSION,
        encrypted,
        createdAt: Date.now(),
        hmac,
      };

      await fs.writeFile(
        this.sessionFilePath,
        JSON.stringify(sessionFile, null, 2),
        { encoding: "utf-8", mode: 0o600 }
      );

      log("DEBUG", "Session saved with HMAC integrity protection");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log("ERROR", `Failed to save session: ${err.message}`);
      throw err;
    }
  }

  /**
   * Load session data from disk with decryption.
   * Returns null if file doesn't exist, is corrupted, or tampered with.
   * Graceful degradation - never throws, always returns null on any error.
   */
  async load(): Promise<SessionData | null> {
    try {
      // Check if file exists
      try {
        await fs.access(this.sessionFilePath);
      } catch {
        log("DEBUG", "No session file found");
        return null;
      }

      // Verify and enforce permissions
      await this.verifyPermissions();

      // Read and parse session file
      const fileContent = await fs.readFile(this.sessionFilePath, "utf-8");
      const sessionFile: SessionFile = JSON.parse(fileContent);

      // Verify HMAC integrity (if present)
      if (sessionFile.hmac) {
        const expectedHmac = this.computeHmac(sessionFile.encrypted);
        if (sessionFile.hmac !== expectedHmac) {
          log("WARN", "Session file HMAC mismatch - possible tampering detected, triggering re-auth");
          return null;
        }
      } else {
        // Legacy session file without HMAC - still allow for backward compatibility
        log("DEBUG", "Session file has no HMAC (legacy format)");
      }

      // Decrypt session data
      const plaintext = this.decrypt(sessionFile.encrypted);
      const session: SessionData = JSON.parse(plaintext);

      log("DEBUG", "Session loaded and verified");
      return session;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log("WARN", `Failed to load session: ${err.message}`);
      // Return null instead of throwing - graceful degradation
      // This triggers re-login flow in the caller
      return null;
    }
  }

  /**
   * Clear session by deleting the session file.
   * Idempotent - does not throw if file doesn't exist.
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.sessionFilePath);
      log("DEBUG", `Session cleared: ${this.sessionFilePath}`);
    } catch (error: any) {
      // Ignore ENOENT errors - file already doesn't exist
      if (error.code !== "ENOENT") {
        const err = error instanceof Error ? error : new Error(String(error));
        log("WARN", `Failed to clear session: ${err.message}`);
      }
    }
  }

  /**
   * Check if a session file exists.
   * Returns true if the session file exists, false otherwise.
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.sessionFilePath);
      return true;
    } catch {
      return false;
    }
  }
}
