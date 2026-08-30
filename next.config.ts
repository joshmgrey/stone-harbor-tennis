import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit `.next/standalone` with a minimal `server.js` and a traced
  // `node_modules` — the container copies that instead of installing deps.
  output: "standalone",

  serverExternalPackages: ["pg", "@prisma/adapter-pg"],

  outputFileTracingIncludes: {
    // Prisma's generated client lives in `node_modules/.prisma/client` and is
    // pulled in with a bare `require('.prisma/client')`, which the file
    // tracer sometimes fails to follow into the standalone bundle. "/*" is
    // the documented "all routes" key.
    "/*": ["./node_modules/.prisma/client/**/*"],
  },
};

export default nextConfig;
