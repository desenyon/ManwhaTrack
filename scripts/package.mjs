// Zips dist/ into manwhatrack-<version>.zip for distribution (e.g. Chrome Web Store upload).
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const out = `manwhatrack-${version}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-qr", `../${out}`, "."], { cwd: "dist", stdio: "inherit" });
console.log(`Packaged ${out}`);
