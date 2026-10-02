/** Display names are cosmetic; the original hostname remains available in tooltips. */
export function sourceLabel(host: string): string {
  const name = host.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)webtoons\.com$/.test(name)) return "Webtoons";
  if (/(^|\.)tapas\.io$/.test(name)) return "Tapas";
  if (/(^|\.)mangadex\.org$/.test(name)) return "MangaDex";
  if (/(^|\.)mangaplus\.shueisha\.co\.jp$/.test(name)) return "MANGA Plus";
  const stem = name.split(".")[0]!;
  if (/^asura(?:scans|comics)?$/.test(stem)) return "Asura Scans";
  if (/^os(?:oro|ori|aro)scans?$/.test(stem)) return "Osoro Scan";
  if (/^osoro$/.test(stem)) return "Osoro Scan";
  if (/^(?:\d+|localhost)$/.test(stem)) return host;
  if (/^(?:webtoons|tapas|mangadex|mangaplus)$/.test(stem)) return name;
  return stem.replace(/[-_]+/g, " ").replace(/\s*scans?$/i, " Scans").replace(/\b\w/g, c => c.toUpperCase()).trim();
}
