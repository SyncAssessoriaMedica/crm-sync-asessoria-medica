import type { NextConfig } from "next";

// Security headers applied to all responses.
// CSP is intentionally omitted here — Next.js inline scripts, Supabase SDK,
// and Evolution QR images make a strict policy complex to maintain without
// breaking functionality. Treat a full CSP as a follow-up hardening step.
const securityHeaders = [
  // Prevents MIME-type sniffing attacks.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Blocks the page from being framed by other sites (clickjacking protection).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Limits which referrer information is sent in cross-origin requests.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Voice recording needs microphone access, restricted to this app's own origin.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  // HSTS: tells browsers to only connect via HTTPS for 2 years.
  // Vercel enforces HTTPS in production so this is always appropriate here.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  async headers() {
    return [
      {
        // Apply to all routes.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
