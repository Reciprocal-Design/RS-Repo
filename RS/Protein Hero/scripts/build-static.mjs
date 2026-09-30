// Builds a self-contained static copy of the hero into this folder, so it opens as a
// plain page (e.g. on GitHub Pages or the repo dashboard) with no server or build step:
//   index.html   the page
//   build/       scripts, styles and the model, HDRI and textures it loads
// All paths are relative, so the folder can be moved or hosted under any URL.
// Usage: npm run build:static
import { execSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const PLACEHOLDER = "/__static_prefix__"; // matches next.config.ts
const OUT = "out";
const DEST = "build";

execSync("next build", {
  stdio: "inherit",
  env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_ASSET_BASE: PLACEHOLDER, NEXT_TELEMETRY_DISABLED: "1" },
});

// Relative prefix, and `_next` → `next`: GitHub Pages (Jekyll) skips folders starting with "_".
const rewrite = (text) => text.replaceAll(PLACEHOLDER, `./${DEST}`).replaceAll("/_next/", "/next/");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
// Underscore files (_buildManifest etc.) are unused by this page and skipped by Jekyll anyway.
const nextDir = join(OUT, "_next");
await cp(nextDir, join(DEST, "next"), { recursive: true, filter: (src) => src === nextDir || !basename(src).startsWith("_") });
// Everything from public/ (model, HDRI, textures).
for (const entry of await readdir("public")) await cp(join(OUT, entry), join(DEST, entry), { recursive: true });

let files = 0;
for await (const file of walk(join(DEST, "next"))) {
  if (!/\.(js|css|json|txt)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  const next = rewrite(text);
  if (next !== text) (await writeFile(file, next), files++);
}
await writeFile("index.html", rewrite(await readFile(join(OUT, "index.html"), "utf8")));

console.log(`Static build written: index.html + ${DEST}/ (${files} files rewritten to relative paths)`);
