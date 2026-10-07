const PROD = process.env.NODE_ENV === 'production';

// Headers every response carries. The page-specific Content-Security-Policy (with a nonce) is added in proxy.js.
const SECURITY_HEADERS = [
  ...(PROD ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,                                  // do not advertise the framework
  serverExternalPackages: ['@google-cloud/firestore'],     // native gRPC client: load it from node_modules instead of bundling
  async headers() { return [{ source: '/:path*', headers: SECURITY_HEADERS }]; },
};
