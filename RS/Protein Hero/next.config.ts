import type { NextConfig } from "next";

// STATIC_EXPORT=1 is set by scripts/build-static.mjs: it builds with a placeholder asset
// prefix that the script rewrites to relative paths, so the page works from any folder.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  assetPrefix: staticExport ? "/__static_prefix__" : undefined,
  images: { unoptimized: true },
  transpilePackages: ["three"],
};

export default nextConfig;
