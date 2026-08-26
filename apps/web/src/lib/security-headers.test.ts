import { describe, expect, it } from "vitest";
import { buildCsp } from "./security-headers.js";

const API_ORIGIN = "https://api.example.com";

describe("buildCsp", () => {
  describe("production", () => {
    it("uses a nonce-based script-src with no unsafe-inline/unsafe-eval in script-src or style-src", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "abc123", isProduction: true });

      expect(csp).toContain(`script-src 'self' 'nonce-abc123'`);
      expect(csp).not.toContain("unsafe-eval");
      // 'unsafe-inline' is intentionally present, but ONLY on the narrow
      // style-src-attr directive (see the style-src-attr test below) —
      // never on script-src or on style-src itself.
      expect(csp).not.toContain(`script-src 'self' 'nonce-abc123' 'unsafe-inline'`);
      expect(csp).not.toContain(`style-src 'self' 'unsafe-inline'`);
    });

    it("throws if no nonce is provided", () => {
      expect(() => buildCsp({ apiOrigin: API_ORIGIN, isProduction: true })).toThrow(/nonce is required/i);
    });

    // Verified against the real app (not just asserted in principle): this
    // directive silently breaks every API call when NEXT_PUBLIC_API_URL is
    // a plain-HTTP origin, since the browser rewrites the request to
    // https:// and it fails to connect with only a generic "Failed to
    // fetch" — no CSP-violation message to explain why.
    it("never includes upgrade-insecure-requests (breaks HTTP API origins)", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "abc123", isProduction: true });
      expect(csp).not.toContain("upgrade-insecure-requests");
    });
  });

  describe("development", () => {
    it("allows unsafe-eval and unsafe-inline in script-src (required for Fast Refresh)", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, isProduction: false });

      expect(csp).toContain(`script-src 'self' 'unsafe-eval' 'unsafe-inline'`);
    });

    it("never requires a nonce", () => {
      expect(() => buildCsp({ apiOrigin: API_ORIGIN, isProduction: false })).not.toThrow();
    });
  });

  describe("directives common to both environments", () => {
    it("allows inline style ATTRIBUTES (style-src-attr) without loosening style-src itself", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      expect(csp).toContain(`style-src 'self'`);
      expect(csp).toContain(`style-src-attr 'unsafe-inline'`);
      // style-src itself (governing <style> elements/stylesheets) must
      // never carry unsafe-inline — only the narrower attr directive does.
      expect(/style-src 'self';/.test(csp)).toBe(true);
    });

    it("scopes connect-src to exactly the configured API origin, plus self", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      expect(csp).toContain(`connect-src 'self' ${API_ORIGIN}`);
    });

    it("allows blob: for img-src and frame-src (decrypted image/PDF previews)", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      expect(csp).toContain(`img-src 'self' blob:`);
      expect(csp).toContain(`frame-src 'self' blob:`);
    });

    it("blocks framing entirely via frame-ancestors 'none'", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      expect(csp).toContain(`frame-ancestors 'none'`);
    });

    it("sets object-src 'none', base-uri 'self', and form-action 'self'", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      expect(csp).toContain(`object-src 'none'`);
      expect(csp).toContain(`base-uri 'self'`);
      expect(csp).toContain(`form-action 'self'`);
    });

    it("has no unrestricted wildcard source anywhere in the policy", () => {
      const csp = buildCsp({ apiOrigin: API_ORIGIN, nonce: "n", isProduction: true });
      // A bare `*` token would be a directive value equal to "*" or
      // containing " * " as a standalone source — never present.
      expect(/(\s|^)\*(\s|;|$)/.test(csp)).toBe(false);
    });
  });
});
