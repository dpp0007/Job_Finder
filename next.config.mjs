/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  serverExternalPackages: ['@google-cloud/firestore'], // native gRPC client: load it from node_modules instead of bundling
};
