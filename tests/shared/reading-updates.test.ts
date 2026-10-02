import { expect, it } from "vitest";
import { createSeries } from "../../src/storage/schema";
import { inView } from "../../src/shared/utils/library";

it("New only includes updates for actively read series", () => {
  const s = createSeries({ title: "A tracked series" });
  s.summary.newCount = 3;
  expect(inView(s, "new")).toBe(false); // Merely discovering a chapter list is not an update to reading.
  s.lastReadAt = Date.now();
  expect(inView(s, "new")).toBe(true);
  for (const status of ["planning", "on-hold", "completed", "dropped"] as const) {
    s.status = status;
    expect(inView(s, "new")).toBe(false);
  }
  s.status = "reading";
  s.summary.newCount = 0;
  expect(inView(s, "new")).toBe(false);
});
