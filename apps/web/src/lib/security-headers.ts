/**
 * Builds the Content-Security-Policy header value. Kept as a small, pure,
 * unit-testable function, separate from `middleware.ts` (which handles
 * per-request nonce generation and header wiring) and from
 * `next.config.mjs` (which owns the static, non-CSP security headers —
 * plain Node ESM at the repo root can't import this TypeScript module
 * directly at config-load time, so that file's small static header list
 * is kept there rather than shared from here).
 *
 * Directive choices, verified against the actual app rather than a
 * generic template:
 *  - `connect-src` is scoped to exactly the configured API origin
 *    (`NEXT_PUBLIC_API_URL`'s origin) — every fetch() in this app targets
 *    that one origin and nothing else.
 *  - `img-src`/`frame-src` include `blob:` — decrypted image previews
 *    (ImageViewer) and the PDF preview iframe (PdfViewer) both render
 *    from `URL.createObjectURL(blob)` results.
 *  - `frame-ancestors 'none'` — nothing should ever be able to embed this
 *    app in an iframe; there's no legitimate embedding use case.
 *  - No `unsafe-inline`/`unsafe-eval` in production `script-src` — a
 *    nonce is required instead, threaded through by `middleware.ts`.
 *  - Deliberately no `upgrade-insecure-requests`: verified against the
 *    real app that this directive breaks every API call when
 *    `NEXT_PUBLIC_API_URL` points at a plain-HTTP origin (e.g. local/
 *    self-hosted deployments without TLS terminated at the API itself)
 *    — the browser silently rewrites the fetch to `https://`, which then
 *    fails to connect, surfacing only as a generic "Failed to fetch"
 *    with no CSP-violation message to explain it. The API origin's
 *    scheme is operator-configured and not guaranteed to match the
 *    frontend's; forcing an upgrade on it is unsafe to do unconditionally.
 *    HSTS (set in next.config.mjs, production only) is the correct,
 *    narrower mechanism for enforcing HTTPS on the frontend itself.
 */

export interface BuildCspOptions {
  /** The API origin (scheme + host + port, no path) fetches are allowed
   * to reach — must exactly match `NEXT_PUBLIC_API_URL`'s origin, or
   * every fetch() in the app is blocked by the browser. */
  apiOrigin: string;
  /** Required when `isProduction` is true — without it, Next's own
   * inline hydration bootstrap script has no way to satisfy `script-src`
   * and the app fails to render. Omit in development, where
   * `'unsafe-eval'` is used instead (required for Fast Refresh) and no
   * nonce is needed. */
  nonce?: string;
  isProduction: boolean;
}

function requireNonce(nonce: string | undefined): string {
  if (!nonce) {
    throw new Error("buildCsp: a nonce is required when isProduction is true");
  }
  return nonce;
}

export function buildCsp({ apiOrigin, nonce, isProduction }: BuildCspOptions): string {
  const scriptSrc = isProduction
    ? `'self' 'nonce-${requireNonce(nonce)}'`
    : `'self' 'unsafe-eval' 'unsafe-inline'`;

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self'`,
    `img-src 'self' blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin}`,
    `frame-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`
  ];

  return directives.join("; ");
}
