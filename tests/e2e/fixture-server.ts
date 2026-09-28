// A tiny local "manhwa site" for end-to-end tests. Madara-like markup, served from 127.0.0.1.

import { createServer, type Server } from "node:http";
import { coverArt, pageArt } from "./art";

const coverCache = new Map<string, Buffer>();
const palettes = new Map<string, number>();
const coverFor = (slug: string) => coverCache.get(slug) ?? (coverCache.set(slug, coverArt(slug, 300, 450, palettes.get(slug))), coverCache.get(slug)!);
const pageCache = new Map<string, Buffer>();
const pageFor = (key: string) => pageCache.get(key) ?? (pageCache.set(key, pageArt(key)), pageCache.get(key)!);
const SMALL_WORDS = new Set(["of", "the", "in", "a", "an", "and"]);
const titleOf = (slug: string) =>
  slug
    .split("-")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");

function seriesPage(base: string, slug = "solo-leveling", latest = 33): string {
  const chapters = Array.from({ length: latest }, (_, i) => latest - i)
    .map((n) => `<li class="wp-manga-chapter"><a href="${base}/manga/${slug}/chapter-${n}/">Chapter ${n}</a></li>`)
    .join("");
  const title = titleOf(slug);
  return `<!doctype html><html><head><title>${title} - Test Scans</title>
<meta property="og:site_name" content="Test Scans"><meta property="og:image" content="${base}/covers/${slug}.png"></head>
<body><div class="post-title"><h1>${title}</h1></div>
<div class="summary_image"><img src="${base}/covers/${slug}.png" width="193" height="278"></div>
<div id="manga-chapters-holder"><ul>${chapters}</ul></div></body></html>`;
}

function chapterPage(base: string, n: number, slug = "solo-leveling", latest = Infinity): string {
  const imgs = Array.from({ length: 6 }, (_, i) => `<img src="${base}/pages/${slug}-${n}-${i}.png" width="800" height="1400" style="display:block;margin:0 auto;max-width:100%;height:auto">`).join("");
  const title = titleOf(slug);
  return `<!doctype html><html><head><title>${title} - Chapter ${n} - Test Scans</title></head>
<body style="margin:0"><ol class="breadcrumb"><li><a href="${base}/">Home</a></li><li><a href="${base}/manga/${slug}/">${title}</a></li><li class="active">Chapter ${n}</li></ol>
<h1 id="chapter-heading">${title} - Chapter ${n}</h1>
<div class="wp-manga-nav"><div class="nav-previous"><a class="prev_page" href="${base}/manga/${slug}/chapter-${n - 1}/">Prev</a></div></div>
<div class="reading-content">${imgs}</div>
${n < latest ? `<div class="wp-manga-nav"><div class="nav-next"><a id="next" class="next_page" href="${base}/manga/${slug}/chapter-${n + 1}/">Next</a></div></div>` : ""}
<div style="height:600px">Comments</div></body></html>`;
}

export interface FixtureServer {
  base: string;
  server: Server;
  /** Simulates a site publishing new chapters. */
  setLatest(slug: string, n: number): void;
  /** Picks the cover palette for a series (screenshots). */
  setPalette(slug: string, i: number): void;
  requests: string[];
}

/** `host` lets screenshots show a realistic site name (mapped to 127.0.0.1 by the browser). */
export async function startFixtureServer(opts: { host?: string } = {}): Promise<FixtureServer> {
  let base = "";
  const latest = new Map<string, number>();
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    // Links use the host the page was requested on, so several fake sites can share one server.
    const pageBase = req.headers.host ? `http://${req.headers.host}` : base;
    requests.push(`${req.method} ${url} referer=${req.headers.referer ?? ""}`);
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    const sm = /^\/manga\/([a-z0-9-]+)\/(?:\?latest=(\d+))?$/.exec(url);
    if (sm) return send(200, "text/html", seriesPage(pageBase, sm[1], sm[2] ? Number(sm[2]) : latest.get(sm[1]!) ?? 33));
    const m = /^\/manga\/([a-z0-9-]+)\/chapter-(\d+)\/$/.exec(url);
    if (m) return send(200, "text/html", chapterPage(pageBase, Number(m[2]), m[1], latest.get(m[1]!)));
    const cm = /^\/covers\/([a-z0-9-]+)\.png$/.exec(url);
    if (cm) return send(200, "image/png", coverFor(cm[1]!));
    const pm = /^\/pages\/([a-z0-9-]+)\.png$/.exec(url);
    if (pm) return send(200, "image/png", pageFor(pm[1]!));
    return send(404, "text/html", "<title>404 Not Found</title><h1>Page not found</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://${opts.host ?? "127.0.0.1"}:${typeof addr === "object" && addr ? addr.port : 0}`;
  return { base, server, requests, setLatest: (slug, n) => latest.set(slug, n), setPalette: (slug, i) => palettes.set(slug, i) };
}
