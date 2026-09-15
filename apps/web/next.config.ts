import type { NextConfig } from "next";

const API_INTERNAL_URL = process.env.INTERNAL_API_URL || "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cloudops/shared"],
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${API_INTERNAL_URL}/v1/:path*`
      },
      {
        source: "/healthz",
        destination: `${API_INTERNAL_URL}/healthz`
      },
      {
        source: "/readyz",
        destination: `${API_INTERNAL_URL}/readyz`
      }
    ];
  }
};

export default nextConfig;
