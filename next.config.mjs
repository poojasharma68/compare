/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright must stay outside the bundler: it resolves browser binaries from its
  // own package directory at runtime.
  serverExternalPackages: ['playwright', 'playwright-core'],
  experimental: {
    // Audit payloads (design tree + DOM snapshots) are large.
    largePageDataBytes: 12 * 1024 * 1024,
  },
};
export default nextConfig;
