import type { NextConfig } from "next";

// Static export: Vercel serves the `out/` folder as-is, and the same build feeds the
// committed preview (index.html + build/) via scripts/build-static.mjs.
// STATIC_EXPORT=1 builds with a placeholder asset prefix that the script rewrites to
// relative paths, so the preview works from any folder.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: staticExport ? "/__static_prefix__" : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
