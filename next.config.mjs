/** @type {import('next').NextConfig} */
const nextConfig = {
  // rules/*.md and data/*.json are read at runtime by the API routes
  outputFileTracingIncludes: { "/api/**": ["./rules/**", "./data/**"] },
};
export default nextConfig;
