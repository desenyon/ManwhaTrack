import { expect, it } from "vitest";
import { sourceLabel } from "../../src/shared/utils/source-label";

it("displays readable source names without treating lookalike domains as official sites", () => {
  expect(sourceLabel("www.webtoons.com")).toBe("Webtoons");
  expect(sourceLabel("mangaplus.shueisha.co.jp")).toBe("MANGA Plus");
  expect(sourceLabel("osoriscans.com")).toBe("Osoro Scan");
  expect(sourceLabel("asurascans.com")).toBe("Asura Scans");
  expect(sourceLabel("webtoons.com.evil.example")).not.toBe("Webtoons");
  expect(sourceLabel("moonlight-scans.example")).toBe("Moonlight Scans");
  expect(sourceLabel("127.0.0.1")).toBe("127.0.0.1");
});
