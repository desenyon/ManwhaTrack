// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { watchPage } from "../../src/content/observer";
import { detectPage } from "../../src/detection";

describe("SPA route changes", () => {
  it("re-detects after pushState + DOM swap, debounced into one run", async () => {
    vi.useFakeTimers();
    document.title = "Solo Leveling - Test";
    document.body.innerHTML = "<h1>Solo Leveling</h1>";
    const reasons: string[] = [];
    const w = watchPage((r) => reasons.push(r));

    history.pushState({}, "", "/manga/solo-leveling/chapter-3/");
    for (let i = 0; i < 20; i++) document.body.append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reasons).toEqual(["url"]);

    // Later content arriving on the same URL triggers a bounded number of re-runs.
    for (let round = 0; round < 10; round++) {
      document.body.append(document.createElement("p"));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(reasons.filter((r) => r === "dom").length).toBeLessThanOrEqual(4);
    w.stop();
    vi.useRealTimers();
  });

  it("detects the new chapter after a client-side navigation", () => {
    history.pushState({}, "", "/manga/solo-leveling/chapter-3/");
    document.title = "Solo Leveling - Chapter 3 - Test Scans";
    document.body.innerHTML = `
      <ol class="breadcrumb"><li><a href="/">Home</a></li><li><a href="/manga/solo-leveling/">Solo Leveling</a></li><li class="active">Chapter 3</li></ol>
      <div class="reading-content"><img src="/1.jpg" width="800"><img src="/2.jpg" width="800"><img src="/3.jpg" width="800"></div>
      <div class="nav-next"><a class="next_page" href="/manga/solo-leveling/chapter-4/">Next</a></div>`;
    const obs = detectPage(document, new URL(location.href));
    expect(obs.kind).toBe("chapter");
    expect(obs.chapter?.label).toBe("Chapter 3");
    history.pushState({}, "", "/manga/solo-leveling/chapter-4/");
    document.title = "Solo Leveling - Chapter 4 - Test Scans";
    document.querySelector(".active")!.textContent = "Chapter 4";
    expect(detectPage(document, new URL(location.href)).chapter?.label).toBe("Chapter 4");
  });
});
