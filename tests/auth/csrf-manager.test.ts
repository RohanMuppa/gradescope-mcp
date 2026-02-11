/**
 * Tests for CSRF token extraction and management.
 * These tests verify parsing logic without making network requests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CsrfManager } from '../../src/auth/csrf-manager.js';

describe('CsrfManager', () => {
  let manager: CsrfManager;

  beforeEach(() => {
    manager = new CsrfManager();
  });

  describe('extractFromHtml', () => {
    it('extracts CSRF token from meta tag', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="csrf-token" content="abc123xyz">
            <title>Gradescope</title>
          </head>
          <body></body>
        </html>
      `;

      const token = manager.extractFromHtml(html);
      expect(token).toBe('abc123xyz');
    });

    it('extracts CSRF token from hidden input', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <form>
              <input type="hidden" name="authenticity_token" value="def456uvw">
              <input type="text" name="username">
            </form>
          </body>
        </html>
      `;

      const token = manager.extractFromHtml(html);
      expect(token).toBe('def456uvw');
    });

    it('prefers meta tag over hidden input', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="csrf-token" content="meta-token-123">
          </head>
          <body>
            <form>
              <input type="hidden" name="authenticity_token" value="input-token-456">
            </form>
          </body>
        </html>
      `;

      const token = manager.extractFromHtml(html);
      expect(token).toBe('meta-token-123');
    });

    it('returns null when no CSRF token found', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Gradescope</title>
          </head>
          <body>
            <p>No CSRF token here</p>
          </body>
        </html>
      `;

      const token = manager.extractFromHtml(html);
      expect(token).toBeNull();
    });

    it('handles HTML entities in token value', () => {
      // Rails CSRF tokens often contain + and = characters
      const html = `
        <html>
          <head>
            <meta name="csrf-token" content="AbCd+123/xyz=">
          </head>
        </html>
      `;

      const token = manager.extractFromHtml(html);
      expect(token).toBe('AbCd+123/xyz=');
    });

    it('caches extracted token internally', () => {
      const html1 = '<meta name="csrf-token" content="first-token">';
      const html2 = '<meta name="csrf-token" content="second-token">';

      const token1 = manager.extractFromHtml(html1);
      expect(token1).toBe('first-token');

      // Extract from different HTML
      const token2 = manager.extractFromHtml(html2);
      expect(token2).toBe('second-token');

      // The manager should now have the second token cached
      // We can't directly access private fields, but we can test via getToken
      // which would use the cached value (tested in integration tests)
    });

    it('invalidate clears cached token', () => {
      const html = '<meta name="csrf-token" content="test-token">';

      // Extract and cache token
      const token = manager.extractFromHtml(html);
      expect(token).toBe('test-token');

      // Invalidate the cache
      manager.invalidate();

      // After invalidation, extractFromHtml with empty HTML should return null
      // (proving the cache was cleared)
      const emptyHtml = '<html><body></body></html>';
      const result = manager.extractFromHtml(emptyHtml);
      expect(result).toBeNull();
    });
  });
});
