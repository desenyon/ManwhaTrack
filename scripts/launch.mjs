// Opens a separate Chrome for Testing window with the built extension loaded and its own
// persistent profile, so the library survives between launches.
//   npm run launch
// Branded Google Chrome no longer accepts --load-extension; there, use chrome://extensions →
// "Load unpacked" → dist/ instead.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const candidates = [];
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      candidates.push(join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
      candidates.push(join(cache, d, "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
      candidates.push(join(cache, d, "chrome-linux/chrome"));
    }
  }
  candidates.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  return candidates.find((p) => existsSync(p));
}

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome for Testing or Chromium found. Set CHROME_PATH, or load dist/ via chrome://extensions → Load unpacked.");
  process.exit(1);
}
const ext = resolve("dist");
const profile = process.env.MT_PROFILE ?? join(homedir(), ".manwhatrack", "chrome-profile");
mkdirSync(profile, { recursive: true });
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check", ...process.argv.slice(2)], {
  detached: true,
  stdio: "ignore",
});
child.unref();
console.log(`Launched ${chrome}\n  extension: ${ext}\n  profile:   ${profile}`);
