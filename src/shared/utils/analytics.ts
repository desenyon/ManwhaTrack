import type { Chapter, ReadingEvent, Series, SeriesSource } from "../types/models";

export const DAY = 86_400_000;
export const SESSION_GAP = 15 * 60_000;
export type AnalyticsRange = "7D" | "30D" | "3M" | "1Y" | "ALL";
export type ActivityMetric = "chapters" | "minutes" | "sessions";
export interface AnalyticsInput { series: Series[]; chapters: Chapter[]; events: ReadingEvent[]; sources: SeriesSource[] }
export interface ActivityDay { date: number; minutes: number; chapters: number; sessions: number; titles: string[]; backlog?: number }
export interface Session { start: number; end: number; duration: number; seriesIds: Set<string> }
export const dayStart = (time: number) => { const d = new Date(time); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const shiftDay = (time: number, count: number) => { const d = new Date(time); d.setDate(d.getDate() + count); return d.getTime(); };
export function rangeStart(range: AnalyticsRange, now: number, earliest: number): number {
  if (range === "ALL") return dayStart(Math.min(now, earliest));
  return shiftDay(dayStart(now), -({ "7D": 6, "30D": 29, "3M": 89, "1Y": 364 }[range]));
}
function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a,b) => a-b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
export function readingSessions(events: ReadingEvent[]): Session[] {
  const sessions: Session[] = [];
  for (const e of events.filter(e => e.type === "time" && e.durationMs! > 0 && e.durationMs! <= 60_000 && Number.isFinite(e.startedAt) && e.durationMs! <= e.timestamp - e.startedAt!).sort((a,b) => a.startedAt! - b.startedAt!)) {
    const last = sessions.at(-1);
    if (last && e.startedAt! - last.end <= SESSION_GAP) {
      last.end = Math.max(last.end, e.timestamp); last.duration += e.durationMs!; last.seriesIds.add(e.seriesId);
    } else sessions.push({ start: e.startedAt!, end: e.timestamp, duration: e.durationMs!, seriesIds: new Set([e.seriesId]) });
  }
  return sessions;
}

/** Local calendar boundaries (including DST); only recorded activity enters charts. */
export function buildAnalytics(input: AnalyticsInput, range: AnalyticsRange = "30D", now = Date.now()) {
  const series = input.series.filter(s => !s.removedAt);
  const byId = new Map(series.map(s => [s.id,s]));
  const chapterById = new Map(input.chapters.map(c => [c.id,c]));
  const events = input.events.filter(e => byId.has(e.seriesId) && Number.isFinite(e.timestamp) && e.timestamp <= now);
  const time = events.filter(e => e.type === "time" && e.durationMs! > 0 && e.durationMs! <= 60_000 && Number.isFinite(e.startedAt) && e.durationMs! <= e.timestamp - e.startedAt!);
  const earliest = events.reduce((first,e) => e.type === "time" || e.type === "completed" ? Math.min(first,e.startedAt ?? e.timestamp) : first, now);
  const start = rangeStart(range, now, earliest);
  // Manual bulk corrections aren't evidence of reading on that day. Canonical chapter
  // identity prevents two sources of the same chapter inflating daily completions.
  const seen = new Set<string>();
  const finished = events.filter(e => e.type === "completed").sort((a,b) => a.timestamp-b.timestamp).filter(e => {
    const c = e.chapterId ? chapterById.get(e.chapterId) : undefined;
    const key = `${e.seriesId}:${c?.key ?? e.chapterLabel ?? e.chapterId}:${dayStart(e.timestamp)}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  const sessions = readingSessions(time);
  const eligible = series.filter(s => s.status !== "completed" && s.status !== "dropped");
  const snapshots = new Map<string, ReadingEvent[]>();
  for (const e of events.filter(e => e.type === "backlog" && Number.isInteger(e.backlogCount) && e.backlogCount! >= 0)) {
    const list = snapshots.get(e.seriesId) ?? []; list.push(e); snapshots.set(e.seriesId,list);
  }
  for (const list of snapshots.values()) list.sort((a,b) => a.timestamp-b.timestamp);
  const backlogAt = (at: number): number | undefined => {
    let count = 0;
    for (const s of series) { if (s.discoveredAt > at) continue; const sample = snapshots.get(s.id)?.findLast(e => e.timestamp <= at); if (!sample) return undefined; count += sample.backlogCount!; }
    return count;
  };
  const daily = new Map<number, ActivityDay>();
  // Bound ALL to the recorded period, never manufacture pre-tracking history.
  for (let d = start; d <= dayStart(now); d = shiftDay(d,1)) daily.set(d,{ date:d,minutes:0,chapters:0,sessions:0,titles:[],backlog:backlogAt(Math.min(now,shiftDay(d,1)-1)) });
  const hours = Array<number>(24).fill(0);
  const seriesTime = new Map<string,number>();
  const seriesFinished = new Map<string,number>();
  let selectedTime = 0;
  const addTitle = (day: ActivityDay, id: string) => { const title = byId.get(id)?.title; if (title && !day.titles.includes(title)) day.titles.push(title); };
  for (const e of time) {
    const from = Math.max(start,e.startedAt!); const to = Math.min(now,e.timestamp);
    const span = e.timestamp-e.startedAt!;
    if (to <= from || span <= 0) continue;
    const measured = e.durationMs! * (to-from) / span;
    selectedTime += measured; seriesTime.set(e.seriesId,(seriesTime.get(e.seriesId) ?? 0)+measured);
    let cursor = from;
    while (cursor < to) {
      const d = new Date(cursor); d.setMinutes(60,0,0);
      const end = Math.min(to,d.getTime());
      const ms = e.durationMs! * (end-cursor) / span;
      const day = daily.get(dayStart(cursor));
      if (day) { day.minutes += ms / 60_000; addTitle(day,e.seriesId); }
      hours[new Date(cursor).getHours()]! += ms;
      cursor = end;
    }
  }
  for (const e of finished.filter(e => e.timestamp >= start)) {
    const day = daily.get(dayStart(e.timestamp)); if (day) { day.chapters++; addTitle(day,e.seriesId); }
    seriesFinished.set(e.seriesId,(seriesFinished.get(e.seriesId) ?? 0)+1);
  }
  const selectedSessions = sessions.filter(s => s.end >= start && s.start <= now);
  for (const s of selectedSessions) { const day = daily.get(dayStart(Math.max(start,s.start))); if (day) day.sessions++; }
  const sessionDurations = selectedSessions.map(() => 0);
  let sessionIndex = 0;
  for (const e of [...time].sort((a,b) => a.startedAt! - b.startedAt!)) {
    while (selectedSessions[sessionIndex] && e.startedAt! > selectedSessions[sessionIndex]!.end) sessionIndex++;
    const session = selectedSessions[sessionIndex];
    if (!session || e.timestamp < start || e.startedAt! < session.start) continue;
    const span = e.timestamp-e.startedAt!;
    if (span > 0) sessionDurations[sessionIndex]! += e.durationMs! * Math.max(0,Math.min(now,e.timestamp)-Math.max(start,e.startedAt!)) / span;
  }
  const measuredChapters = input.chapters.filter(c => byId.has(c.seriesId) && c.completedAt && c.completionSource !== "manual" && c.readingTimeMs > 0);
  const avgChapter = measuredChapters.length ? measuredChapters.reduce((n,c) => n+c.readingTimeMs,0)/measuredChapters.length : undefined;
  const backlogRows = eligible.filter(s => s.summary.newCount > 0).map(s => {
    const own = measuredChapters.filter(c => c.seriesId === s.id);
    const rate = own.length ? own.reduce((n,c) => n+c.readingTimeMs,0)/own.length : avgChapter;
    return { series:s, count:s.summary.newCount, estimate:rate ? s.summary.newCount*rate : undefined };
  }).sort((a,b) => b.count-a.count);
  const backlog = backlogRows.reduce((n,r) => n+r.count,0);
  const backlogEstimate = backlogRows.every(r => r.estimate !== undefined) ? backlogRows.reduce((n,r) => n+r.estimate!,0) : undefined;
  const weekStart = shiftDay(dayStart(now), -((new Date(now).getDay()+6)%7));
  const timeSince = (since:number) => time.reduce((n,e) => n+(e.timestamp>since && e.timestamp>e.startedAt! ? e.durationMs!*Math.max(0,e.timestamp-Math.max(since,e.startedAt!))/(e.timestamp-e.startedAt!) : 0),0);
  const activityDates = new Set(finished.map(e => dayStart(e.timestamp)));
  for (const e of time) for (let d = dayStart(e.startedAt!); d <= dayStart(e.timestamp - 1); d = shiftDay(d,1)) activityDates.add(d);
  const activeDays = [...activityDates].sort((a,b)=>a-b);
  let longestStreak = 0, running = 0, previous: number | undefined;
  for (const d of activeDays) { running = previous !== undefined && shiftDay(previous,1) === d ? running+1 : 1; longestStreak = Math.max(longestStreak,running); previous=d; }
  let currentStreak = 0, day = dayStart(now);
  if (!activeDays.includes(day)) day=shiftDay(day,-1);
  while (activeDays.includes(day)) { currentStreak++; day=shiftDay(day,-1); }
  const pace = [7,30,90].map(days => { const since=shiftDay(dayStart(now),-(days-1)); return { days, value:finished.filter(e=>e.timestamp>=since).length/days }; });
  const ranking = series.map(s => ({ series:s,time:seriesTime.get(s.id) ?? 0,chapters:seriesFinished.get(s.id) ?? 0 })).filter(r=>r.time>0 || r.chapters>0).sort((a,b)=>b.time-a.time || b.chapters-a.chapters);
  const releases = input.chapters.filter(c => byId.has(c.seriesId) && !c.inferred && c.observedReleaseAt !== undefined && c.observedReleaseAt >= start && c.observedReleaseAt <= now);
  const uniqueReleases = [...new Map(releases.map(c=>[`${c.seriesId}:${c.key}`,c])).values()];
  const delays = uniqueReleases.filter(c=>c.firstOpenedAt !== undefined && c.firstOpenedAt >= c.observedReleaseAt!).map(c=>({ seriesId:c.seriesId,delay:c.firstOpenedAt!-c.observedReleaseAt! }));
  const genreRows = [...new Set(series.flatMap(s=>s.genres ?? []))].map(genre => {
    const cohort=series.filter(s=>s.genres?.includes(genre)); const rated=cohort.filter(s=>s.personalRating !== undefined);
    return { name:genre,time:cohort.reduce((n,s)=>n+(seriesTime.get(s.id) ?? 0),0),rating:rated.length ? rated.reduce((n,s)=>n+s.personalRating!,0)/rated.length : undefined,
      completed:cohort.filter(s=>s.status==="completed").length,total:cohort.length,dropped:cohort.filter(s=>s.status==="dropped").map(s=>s.summary.chaptersRead) };
  }).sort((a,b)=>b.time-a.time);
  const retention = [10,25,50].map(threshold => {
    const candidates=series.filter(s=>s.summary.chaptersRead>0 && (s.summary.chaptersKnown>threshold || s.summary.chaptersRead>threshold));
    const cohort=candidates.filter(s=>s.summary.chaptersRead>threshold || s.status==="dropped" || s.status==="completed");
    return { threshold, total:cohort.length, reached:cohort.filter(s=>s.summary.chaptersRead>threshold).length };
  });
  const milestones: {at:number;label:string}[]=[];
  for (const n of [100,500,1000,5000,10000]) if (finished.length>=n) milestones.push({ at:finished[n-1]!.timestamp,label:`${n.toLocaleString()} observed chapters finished` });
  let measuredTotal=0; const timeSorted=[...time].sort((a,b)=>a.timestamp-b.timestamp);
  for (const e of timeSorted) { const before=measuredTotal; measuredTotal+=e.durationMs!; for (const h of [10,50,100,500]) if (before<h*3_600_000 && measuredTotal>=h*3_600_000) milestones.push({at:e.timestamp,label:`${h} hours of dated reading`}); }
  const weekdays=Array<number>(7).fill(0); for(const d of daily.values()) weekdays[new Date(d.date).getDay()]!+=d.minutes;
  const topHour=hours.some(Boolean) ? hours.indexOf(Math.max(...hours)) : undefined;
  const topDay=weekdays.some(Boolean) ? weekdays.indexOf(Math.max(...weekdays)) : undefined;
  const historicalTime=Math.max(0,series.reduce((n,s)=>n+s.totalReadingTimeMs,0)-time.reduce((n,e)=>n+e.durationMs!,0));
  const sourceById = new Map(input.sources.map(s => [s.id,s.hostname]));
  const sourceTime = new Map<string,number>();
  for (const e of time) {
    const host = e.chapterId ? sourceById.get(chapterById.get(e.chapterId)?.sourceId ?? "") : undefined;
    const span = e.timestamp-e.startedAt!;
    if (host && span > 0) sourceTime.set(host,(sourceTime.get(host) ?? 0)+e.durationMs!*Math.max(0,e.timestamp-Math.max(start,e.startedAt!))/span);
  }
  const sourceRows = [...sourceTime].map(([name,time])=>({name,time})).filter(r=>r.time>0).sort((a,b)=>b.time-a.time);
  const statusRows=[...new Set(series.map(s=>s.status))].map(status=>({name:status,count:series.filter(s=>s.status===status).length}));
  const startHours = Array<number>(24).fill(0);
  for (const session of selectedSessions) startHours[new Date(session.start).getHours()]!++;
  const commonStart = startHours.some(Boolean) ? startHours.indexOf(Math.max(...startHours)) : undefined;
  const sessionChapterCounts = selectedSessions.map(session => finished.filter(e => e.timestamp >= session.start && e.timestamp <= session.end).length);
  const fastestGenre = genreRows.map(g => {
    const chapters = measuredChapters.filter(c => byId.get(c.seriesId)?.genres?.includes(g.name));
    return { name:g.name, average:chapters.length ? chapters.reduce((n,c)=>n+c.readingTimeMs,0)/chapters.length : undefined, count:chapters.length };
  }).filter(g => g.count >= 3).sort((a,b) => a.average!-b.average!)[0];
  const highestCompletionGenre = genreRows.filter(g=>g.total>=3).sort((a,b)=>b.completed/b.total-a.completed/a.total)[0];
  const neglected = eligible.filter(s => now-(s.lastReadAt ?? s.discoveredAt) >= 30*DAY).sort((a,b)=>(a.lastReadAt ?? a.discoveredAt)-(b.lastReadAt ?? b.discoveredAt));
  const catalogBands = [{label:"1–49",min:1,max:49},{label:"50–149",min:50,max:149},{label:"150–300",min:150,max:300},{label:"301+",min:301,max:Infinity}].map(b=>({...b,time:ranking.filter(r=>r.series.summary.chaptersKnown>=b.min && r.series.summary.chaptersKnown<=b.max).reduce((n,r)=>n+r.time,0)})).filter(b=>b.time>0).sort((a,b)=>b.time-a.time);
  const catalogLength = catalogBands[0]?.label;
  const startBacklog=backlogAt(weekStart-1);
  return { start, now, days:[...daily.values()], hours, ranking, sessions:selectedSessions, averageSession:sessionDurations.length ? sessionDurations.reduce((n,d)=>n+d,0)/sessionDurations.length : undefined,
    longestSession:sessionDurations.length ? Math.max(...sessionDurations) : undefined, typicalSession:median(sessionDurations), avgChapter, time:selectedTime, chapters:finished.filter(e=>e.timestamp>=start).length,
    week:{time:timeSince(weekStart),chapters:finished.filter(e=>e.timestamp>=weekStart).length,sessions:sessions.filter(s=>s.start>=weekStart).length,netBacklog:startBacklog===undefined ? undefined : backlog-startBacklog},
    backlog,backlogRows,backlogEstimate,pace,catchupDays:pace[0]!.value>0 ? Math.ceil(backlog/pace[0]!.value) : undefined,
    currentStreak,longestStreak,activeDays:activeDays.filter(d=>d>=start).length,topHour,topDay,historicalTime,genreRows,retention,statusRows,sourceRows,
    releases:uniqueReleases.length,releasesRead:uniqueReleases.filter(c=>c.completedAt).length,releaseDelay:median(delays.map(d=>d.delay)),delays,
    catalogLength,commonStart,typicalSessionChapters:median(sessionChapterCounts),fastestGenre,highestCompletionGenre,neglected,
    milestones:milestones.sort((a,b)=>b.at-a.at),finished,byId };
}
