import type { NextConfig } from 'next';

// One id per deploy. The installed app compares this against /api/version
// to know when a newer deploy is live.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
