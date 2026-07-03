/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is handled separately; don't block production builds on it.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
