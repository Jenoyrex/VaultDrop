const isProduction = process.env.NODE_ENV === "production";

// Static security headers — everything except Content-Security-Policy,
// which needs a fresh per-request nonce and is set in middleware.ts
// instead (a static value here can't carry a nonce). Kept as plain
// inline data rather than imported from src/lib/security-headers.ts:
// this file is loaded by Node directly at config-build time, before
// Next's own TypeScript/bundler pipeline exists, so it can't import a
// .ts module the way middleware.ts (compiled through that pipeline) can.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt-and-suspenders alongside the CSP's frame-ancestors 'none' (set
  // in middleware.ts) for browsers that don't honor that directive.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "midi=()",
      // Explicitly allowed, not swept into the deny-list above: the
      // recovery-key dialog's "copy to clipboard" button depends on it.
      "clipboard-write=(self)"
    ].join(", ")
  },
  // Production only — HSTS tells the browser to never use plain HTTP for
  // this host for the given duration, which would break local
  // http://localhost dev (and be awkward to undo) if sent there.
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : [])
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is handled separately; don't block production builds on it.
    ignoreDuringBuilds: true
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  },
  webpack: (config) => {
    // lib/crypto/*.ts (Phase 0) imports its sibling modules with explicit
    // ".js" extensions, the correct form for TS's "Bundler" moduleResolution
    // pointing at ".ts" source files. tsc and Vitest already resolve that
    // transparently; webpack's default resolver doesn't, so this checkpoint
    // is the first time anything in the app imports that module tree. This
    // alias just teaches webpack the same ".js" -> ".ts"/".tsx" mapping.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"]
    };
    return config;
  }
};

export default nextConfig;
