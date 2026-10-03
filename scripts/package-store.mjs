// Builds the submission bundle around the already built extension ZIP and Store assets.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const listing = JSON.parse(readFileSync("chrome-web-store/listing.json", "utf8"));
const extension = `manwhatrack-${version}.zip`;
const output = resolve(`manwhatrack-store-submission-${version}.zip`);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, version);
assert.equal(listing.name, manifest.name);
assert.equal(listing.summary, manifest.description);
assert.ok(listing.summary.length <= 132);
assert.equal(listing.remoteCode, false);
assert.deepEqual(Object.keys(listing.permissionJustifications).sort(), [...manifest.permissions, ...manifest.optional_permissions, "host_permissions"].sort());
assert.ok(Object.values(listing.permissionJustifications).every(value => typeof value === "string" && value.trim().length > 30));
const privacy = readFileSync("PRIVACY.md", "utf8");
assert.ok(privacy.includes("complies with the Chrome Web Store User Data Policy, including its Limited Use requirements"));
assert.equal(readFileSync("dist/PRIVACY.md", "utf8"), privacy);
const expected = {
  "icon-128.png": [128, 128], "promo-440x280.png": [440, 280],
  "01-library-1280x800.png": [1280, 800], "02-lists-1280x800.png": [1280, 800],
  "03-details-1280x800.png": [1280, 800], "04-analytics-1280x800.png": [1280, 800],
  "05-settings-1280x800.png": [1280, 800],
};
for (const [name, dimensions] of Object.entries(expected)) {
  const png = readFileSync(join("chrome-web-store/assets", name));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions, name);
}
assert.ok(readFileSync("chrome-web-store/UPLOAD.md", "utf8").includes(extension));
execFileSync("unzip", ["-tq", extension], { stdio: "inherit" });
const members = execFileSync("unzip", ["-Z1", extension], { encoding: "utf8" }).trim().split("\n");
assert.ok(members.includes("manifest.json"));
assert.ok(!members.some(name => name.endsWith(".map") || name.includes("node_modules") || name.includes("chrome-web-store")));
for (const name of members.filter(name => !name.endsWith("/"))) {
  assert.deepEqual(execFileSync("unzip", ["-p", extension, name], { maxBuffer: 30_000_000 }), readFileSync(join("dist", name)), name);
}
const stage = mkdtempSync(join(tmpdir(), "mt-store-package-"));
try {
  cpSync("chrome-web-store", stage, { recursive: true });
  cpSync(extension, join(stage, extension));
  cpSync("PRIVACY.md", join(stage, "PRIVACY.md"));
  const fields = [
    ["Name", listing.name], ["Summary", listing.summary], ["Description", listing.description],
    ["Homepage URL", listing.homepageUrl], ["Support URL", listing.supportUrl],
    ["Privacy policy URL", listing.privacyPolicyUrl], ["Single purpose", listing.singlePurpose],
    ["Remote code", "No, I am not using remote code.\n" + listing.remoteCodeExplanation],
    ["Data categories", listing.dataCategories.join("\n")], ["Data handling explanation", listing.dataUseExplanation],
    ...Object.entries(listing.permissionJustifications).map(([name, value]) => [`Permission: ${name}`, value]),
  ];
  writeFileSync(join(stage, "dashboard-fields.txt"), fields.map(([name, value]) => `${name.toUpperCase()}\n${value}`).join("\n\n") + "\n");
  const paths = [extension, "PRIVACY.md", "listing.json", "dashboard-fields.txt", "UPLOAD.md", "reviewer-instructions.txt", ...readdirSync(join(stage, "assets")).map(name => `assets/${name}`)];
  writeFileSync(join(stage, "checksums.txt"), paths.map(name => `${createHash("sha256").update(readFileSync(join(stage, name))).digest("hex")}  ${name}`).join("\n") + "\n");
  rmSync(output, { force: true });
  execFileSync("zip", ["-qr", output, "."], { cwd: stage, stdio: "inherit" });
  execFileSync("unzip", ["-tq", output], { stdio: "inherit" });
  console.log(`Store bundle: ${output}\nUpload to Chrome: ${resolve(extension)}\nUpload graphics and paste fields separately using UPLOAD.md.`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
