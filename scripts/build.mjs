// Builds the extension into dist/. Usage: node scripts/build.mjs [--watch] [--dev]
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

const common = {
  bundle: true,
  target: ["chrome120"],
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  legalComments: "none",
  logLevel: "info",
  define: {
    __DEV__: JSON.stringify(dev),
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  },
};

const builds = [
  { entryPoints: { background: "src/background/service-worker.ts" }, format: "esm" },
  // Content scripts cannot be ES modules; keep this bundle framework-free and small.
  { entryPoints: { content: "src/content/index.ts" }, format: "iife" },
  { entryPoints: { offscreen: "src/offscreen/offscreen.ts" }, format: "esm" },
  { entryPoints: { sidepanel: "src/sidepanel/main.tsx" }, format: "esm" },
  { entryPoints: { options: "src/options/main.tsx" }, format: "esm" },
];

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await cp(join(root, "public"), outdir, { recursive: true });
  await cp(join(root, "PRIVACY.md"), join(outdir, "PRIVACY.md"));
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(root, "src/manifest.json"), "utf8"));
  manifest.version = pkg.version;
  await writeFile(join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await rm(outdir, { recursive: true, force: true });
await copyStatic();

const options = builds.map((b) => ({ ...common, ...b, outdir, absWorkingDir: root }));

if (watch) {
  for (const o of options) {
    const ctx = await esbuild.context(o);
    await ctx.watch();
  }
  console.log("Watching for changes…");
} else {
  await Promise.all(options.map((o) => esbuild.build(o)));
}
