/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is handled separately; don't block production builds on it.
    ignoreDuringBuilds: true
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
