/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy API + Socket.IO to the NestJS server during dev so the browser uses same-origin.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      // The NestJS API is served under its own `/api` global prefix, so we pass through verbatim.
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/realtime/:path*', destination: `${apiUrl}/realtime/:path*` },
    ];
  },
};
module.exports = nextConfig;
