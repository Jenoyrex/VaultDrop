import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp } from "@/lib/security-headers";

function resolveApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return new URL(raw).origin;
}

/**
 * Sets a per-request Content-Security-Policy — the one security header
 * that can't be a static value in `next.config.mjs` (see that file for
 * the rest), since a real, non-`unsafe-inline` `script-src` requires a
 * fresh random nonce on every request.
 *
 * The CSP is set on BOTH the forwarded request headers and the actual
 * response headers. This isn't redundant: Next's own App Router server
 * render reads the nonce back out of `req.headers["content-security-
 * policy"]` (see the installed `next@14.2.35` source at
 * `next/dist/server/app-render/app-render.js` and
 * `.../get-script-nonce-from-header.js`, read directly to confirm this
 * rather than assumed) and threads it into its own inline hydration
 * bootstrap script — that only works if the header is present on the
 * request Next's renderer sees. The response header is what the browser
 * actually receives and enforces. `get-script-nonce-from-header.js`
 * specifically looks for a `'nonce-...'` token inside the `script-src`
 * (or `default-src`) directive, which is exactly how `buildCsp` formats
 * it.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isProduction = process.env.NODE_ENV === "production";

  const csp = buildCsp({
    apiOrigin: resolveApiOrigin(),
    nonce: isProduction ? nonce : undefined,
    isProduction
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });

  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  // Skips static assets and the favicon — nothing there needs a
  // per-request CSP/nonce, and running middleware on every asset request
  // would be pure overhead.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
