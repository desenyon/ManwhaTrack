import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixtureHtml(name: string): string {
  return readFileSync(fixturesDir + name, "utf8");
}

export function fixture(name: string, url: string): { doc: Document; url: URL; dom: JSDOM } {
  const dom = new JSDOM(fixtureHtml(name), { url });
  return { doc: dom.window.document, url: new URL(url), dom };
}
