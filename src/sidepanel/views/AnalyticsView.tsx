import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Series } from "../../shared/types/models";
import { analyticsRecords } from "../../storage/repositories/analytics";
import { buildAnalytics, dayStart, shiftDay, type ActivityDay, type ActivityMetric, type AnalyticsRange } from "../../shared/utils/analytics";
import { formatDuration, shortDate } from "../../shared/utils/format";
import { sourceLabel } from "../../shared/utils/source-label";
import { shortChapterLabel } from "../../detection/normalization/chapter";
import { subscribe } from "../../shared/bus";
import { Icon } from "../../ui/icons";

type Records = Awaited<ReturnType<typeof analyticsRecords>>;
const duration = (ms: number | undefined) => ms === undefined ? "—" : ms === 0 ? "0m" : ms < 1000 ? "<1s" : ms < 60_000 ? `${Math.floor(ms/1000)}s` : formatDuration(ms);
const hourLabel = (h: number) => new Date(2026,0,1,h).toLocaleTimeString(undefined,{hour:"numeric"});
const ranges: AnalyticsRange[] = ["7D","30D","3M","1Y","ALL"];
const periodLabel = (range: AnalyticsRange) => range === "ALL" ? "All recorded time" : `Last ${{"7D":7,"30D":30,"3M":90,"1Y":365}[range]} days`;
const dateLabel = (t: number) => new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});

export function AnalyticsView({ series, seriesId, onBack, onOpenSeries, onAnalyzeSeries }: {
  series: Series[]; seriesId?: string; onBack: () => void; onOpenSeries: (id:string) => void; onAnalyzeSeries: (id?:string) => void;
}) {
  const [records,setRecords]=useState<Records>();
  const [error,setError]=useState(false);
  const [range,setRange]=useState<AnalyticsRange>("30D");
  const [metric,setMetric]=useState<ActivityMetric>("minutes");
  const [selected,setSelected]=useState<number>();
  const [heatWeeks,setHeatWeeks]=useState(() => matchMedia("(min-width: 650px)").matches ? 26 : 12);
  useEffect(() => { const media=matchMedia("(min-width: 650px)"); const change=()=>{setHeatWeeks(media.matches ? 26 : 12);setSelected(undefined);};media.addEventListener("change",change);return()=>media.removeEventListener("change",change); },[]);
  const [now,setNow]=useState(Date.now());
  const generation=useRef(0);
  const load=useCallback(async()=>{
    const request=++generation.current;
    try { const next=await analyticsRecords(); if(request!==generation.current)return;setRecords(next);setNow(Date.now());setError(false); }
    catch { if(request===generation.current)setError(true); }
  },[]);
  useEffect(()=>{
    void load();let timeout:ReturnType<typeof setTimeout>|undefined;
    const off=subscribe(m=>{if(m.type==="library-changed" && timeout===undefined)timeout=setTimeout(()=>{timeout=undefined;void load();},500);});
    return()=>{off();clearTimeout(timeout);generation.current++;};
  },[load]);
  const scope=useMemo(()=>seriesId ? series.filter(s=>s.id===seriesId) : series,[series,seriesId]);
  const a=useMemo(()=>records ? buildAnalytics({...records,series:scope},range,now) : undefined,[records,scope,range,now]);
  const heatDays=useMemo(()=>{
    if(!records || !a)return [];
    const start=shiftDay(dayStart(now),-((new Date(now).getDay()+6)%7)-(heatWeeks-1)*7);
    const activity=range!=="1Y" && range!=="ALL" ? buildAnalytics({...records,series:scope},"1Y",now) : a;
    const byDay=new Map(activity.days.map(d=>[d.date,d]));const days:ActivityDay[]=[];
    for(let d=start;d<=dayStart(now);d=shiftDay(d,1))days.push(byDay.get(d) ?? {date:d,minutes:0,chapters:0,sessions:0,titles:[]});
    return days;
  },[records,a,scope,range,now,heatWeeks]);
  const current=seriesId ? scope[0] : undefined;
  if (!a) return <div className="section" role={error ? "alert" : "status"}>{error ? <>Analytics could not be opened. <button className="btn" onClick={()=>void load()}>Retry</button></> : "Opening local analytics…"}</div>;
  const top=a.ranking[0];
  const selectedDay=heatDays.find(d=>d.date===selected);
  const maxHeat=Math.max(1,...heatDays.map(d=>d[metric]));
  const totalHours=a.hours.reduce((n,h)=>n+h,0);
  const maxHour=Math.max(1,...a.hours);
  const groups=[{label:"Morning",from:6,to:12},{label:"Afternoon",from:12,to:18},{label:"Evening",from:18,to:24},{label:"Late night",from:0,to:6}];
  const completed=current?.summary.chaptersRead;
  const completedEvents=a.finished.filter(e=>e.seriesId===seriesId);
  const gaps=completedEvents.slice(1).map((e,i)=>({ before:completedEvents[i]!,after:e,days:Math.round((dayStart(e.timestamp)-dayStart(completedEvents[i]!.timestamp))/86_400_000) })).filter(g=>g.days>=14).sort((x,y)=>y.days-x.days);
  const dropped=scope.filter(s=>s.status==="dropped");
  const dropBands=[{name:"1–9",min:1,max:9},{name:"10–24",min:10,max:24},{name:"25–49",min:25,max:49},{name:"50+",min:50,max:Infinity}].map(b=>({...b,count:dropped.filter(s=>s.summary.chaptersRead>=b.min && s.summary.chaptersRead<=b.max).length})).sort((x,y)=>y.count-x.count);
  return <article className="analytics-page">
    {error && <div className="banner" role="alert"><span>Analytics could not be refreshed. The last saved view is shown.</span><button className="btn sm" onClick={()=>void load()}>Retry</button></div>}
    <div className="analytics-heading"><div><button className="btn ghost sm" onClick={onBack}><Icon name="back" />{current ? "Series details" : "Library"}</button><h1>{current ? current.title : "Analytics"}</h1><p className="muted">{current ? "A closer look at your reading." : "Your reading, in numbers."}</p></div>
      <div className="analytics-period"><span className="small faint">Analysis period</span><div className="range-control" role="group" aria-label="Analytics range">{ranges.map(r=><button key={r} className="btn ghost sm" aria-pressed={range===r} onClick={()=>{setRange(r);setSelected(undefined);}}>{r}</button>)}</div></div>
    </div>
    <section className="analytics-overview" aria-label="This week"><h2 className="section-title">This week</h2><dl className="analytics-metrics"><Fact label="Active reading" value={duration(a.week.time)} /><Fact label="Chapters finished" value={String(a.week.chapters)} /><Fact label="Sessions" value={String(a.week.sessions)} /><Fact label="Net backlog" value={a.week.netBacklog===undefined ? "—" : `${a.week.netBacklog>0 ? "+" : ""}${a.week.netBacklog}`} /></dl>
      {top ? <p className="reading-insight">{current ? "In the selected period, you read" : `Over ${range==="ALL" ? "" : "the "}${periodLabel(range).toLowerCase()}, you spent the most time on`} {!current && <button className="text-link" onClick={()=>onAnalyzeSeries(top.series.id)}>{top.series.title}</button>} — <strong>{duration(top.time)}</strong>{top.chapters ? <> across {top.chapters} finished {top.chapters===1 ? "chapter" : "chapters"}.</> : " of active reading. No chapters finished yet."}</p> : <p className="reading-insight muted">Open a chapter and read to start building your activity record.</p>}
    </section>
    {a.historicalTime>=1000 && <p className="analytics-note">{duration(a.historicalTime)} of earlier reading is retained in lifetime totals. Daily time and sessions started recording in v1.2.0; earlier undated time cannot appear in these charts.</p>}
    <section className="analytics-section activity-section"><div className="analytics-section-heading"><h2>Reading activity</h2><div className="range-control" role="group" aria-label="Activity measure">{(["chapters","minutes","sessions"] as const).map(m=><button key={m} className="btn ghost sm" aria-pressed={metric===m} onClick={()=>setMetric(m)}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>)}</div></div>
      <p className="small faint">Last {heatWeeks} weeks · Each square is one day</p>
      <div className="activity-calendar"><div className="activity-months" style={{"--heat-weeks":heatWeeks} as CSSProperties} aria-hidden="true">{Array.from({length:heatWeeks},(_,i)=>{const day=heatDays[i*7];const previous=heatDays[(i-1)*7];return <span key={i}>{day && (i===0 || new Date(day.date).getMonth()!==new Date(previous!.date).getMonth()) ? new Date(day.date).toLocaleDateString(undefined,{month:"short"}) : ""}</span>;})}</div><div className="activity-weekdays" aria-hidden="true">{["Mon","","Wed","","Fri","",""].map((d,i)=><span key={i}>{d}</span>)}</div><div className="activity-heatmap" style={{"--heat-weeks":heatWeeks} as CSSProperties} aria-label="Daily reading activity">{heatDays.map((d,i)=>{const level=d[metric]>0 ? Math.max(1,Math.ceil(d[metric]/maxHeat*4)) : 0; const label=`${dateLabel(d.date)}: ${duration(d.minutes*60_000)} active reading, ${d.chapters} chapters, ${d.sessions} sessions${d.titles.length ? `. ${d.titles.join(", ")}` : ""}`;return <button key={d.date} className="activity-day" data-level={level} aria-label={label} title={label} tabIndex={selected===d.date || (selected===undefined && i===heatDays.length-1) ? 0 : -1} onMouseEnter={()=>setSelected(d.date)} onFocus={()=>setSelected(d.date)} onClick={()=>setSelected(d.date)} onKeyDown={e=>{const move={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[e.key];if(move!==undefined){e.preventDefault();const next=Math.min(heatDays.length-1,Math.max(0,i+move));(e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}} />;})}</div></div>
      <div className="heatmap-caption"><p aria-live="polite">{selectedDay ? <><strong>{dateLabel(selectedDay.date)}</strong> · {duration(selectedDay.minutes*60_000)} · {selectedDay.chapters} chapters · {selectedDay.sessions} sessions{selectedDay.titles.length>0 && <span className="heatmap-titles">{selectedDay.titles.join(" · ")}</span>}</> : "Hover or focus a day to inspect your reading."}</p><span className="heatmap-key">Less {[0,1,2,3,4].map(n=><i key={n} data-level={n} />)} More</span></div>
    </section>
    <div className="analytics-columns">
      <section className="analytics-section"><h2>Reading time</h2><p className="analytics-big-number">{duration(a.time)} <span className="small muted">in this period</span></p><Trend days={a.days} metric="minutes" label="Daily active reading in minutes" /><p className="small faint">{dateLabel(a.start)} — {dateLabel(now)}</p></section>
      <section className="analytics-section"><h2>Your backlog</h2><p className="analytics-big-number">{a.backlog} <span className="small muted">new chapters waiting{a.backlog>0 && a.backlogEstimate!==undefined ? ` · ~${duration(a.backlogEstimate)} to catch up` : ""}</span></p>
        <Trend days={a.days} metric="backlog" label="Observed daily backlog" />
        <p className="small faint">Backlog history begins when tracked sources are checked or chapters are read. Estimates use your measured chapter times.</p>
        {a.backlogRows.slice(0,8).map(r=><div className="analytics-line" key={r.series.id}><button className="text-link truncate" onClick={()=>onOpenSeries(r.series.id)}>{r.series.title}</button><span className="tabular">{r.count} <span className="muted">{r.estimate===undefined ? "" : ` · ~${duration(r.estimate)}`}</span></span></div>)}
      </section>
    </div>
    <section className="analytics-section"><div className="analytics-section-heading"><h2>{current ? "Reading record" : "Most read"}</h2><span className="small faint">{periodLabel(range)}</span></div>
      {!a.ranking.length && <p className="muted">No recorded reading in this period.</p>}
      {a.ranking.slice(0,10).map(r=><button className="analytics-ranking" key={r.series.id} onClick={()=>current ? onOpenSeries(r.series.id) : onAnalyzeSeries(r.series.id)}><span className="ranking-title">{r.series.title}<small className="faint">{r.series.format==="novel" ? "Novel" : "Manhwa"} · {r.chapters} chapters finished</small></span><span className="tabular">{duration(r.time)}<Icon name="chevron" /></span><i style={{width:`${top?.time ? r.time/top.time*100 : 0}%`}} /></button>)}
      {current && <><dl className="analytics-facts"><Fact label="Completed chapters (all time)" value={String(completed)} /><Fact label="Active reading (all time)" value={duration(current.totalReadingTimeMs)} /><Fact label="Tracked since" value={shortDate(current.discoveredAt)} /><Fact label="Last read" value={current.lastReadAt ? dateLabel(current.lastReadAt) : "Not started"} /><Fact label="Longest measured session" value={duration(a.longestSession)} /><Fact label="Average measured session" value={duration(a.averageSession)} /></dl><h3 className="section-title">Progress over time</h3><ol className="progress-timeline">{completedEvents.filter((_,i)=>i===0 || i===completedEvents.length-1 || i%Math.max(1,Math.ceil(completedEvents.length/8))===0).map(e=><li key={e.id}><time>{dateLabel(e.timestamp)}</time><span>{e.chapterLabel ? shortChapterLabel(e.chapterLabel) : "Chapter finished"}</span></li>)}</ol>{gaps[0] && <p className="analytics-note">After {gaps[0].before.chapterLabel ?? "a chapter"}, your next recorded completion was {gaps[0].days} days later.</p>}</>}
    </section>
    <section className="analytics-section"><h2>When you read</h2><div className="hour-heatmap" aria-label="Reading by hour">{a.hours.map((h,i)=><div key={i} title={`${hourLabel(i)}: ${duration(h)}`} aria-label={`${hourLabel(i)}: ${duration(h)}`} tabIndex={0} data-level={h>0 ? Math.max(1,Math.ceil(h/maxHour*4)) : 0}>{i%6===0 ? <span>{hourLabel(i)}</span> : null}</div>)}</div><dl className="time-of-day">{groups.map(g=><Fact key={g.label} label={g.label} value={totalHours ? `${Math.round(a.hours.slice(g.from,g.to).reduce((n,h)=>n+h,0)/totalHours*100)}%` : "—"} />)}</dl></section>
    <div className="analytics-columns">
      <section className="analytics-section"><h2>Your reading</h2><dl className="analytics-facts"><Fact label="Typical session" value={duration(a.typicalSession)} /><Fact label="Average chapter (all time)" value={duration(a.avgChapter)} /><Fact label="Most active hour" value={a.topHour===undefined ? "—" : `${hourLabel(a.topHour)}–${hourLabel((a.topHour+1)%24)}`} /><Fact label="Most-read day" value={a.topDay===undefined ? "—" : ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][a.topDay]!} /><Fact label="Current streak" value={`${a.currentStreak} days`} /><Fact label="Longest streak" value={`${a.longestStreak} days`} /><Fact label="Active days in period" value={String(a.activeDays)} /></dl></section>
      <section className="analytics-section"><h2>Reading pace</h2><dl className="analytics-facts">{a.pace.map(p=><Fact key={p.days} label={`${p.days}-day average`} value={`${p.value.toFixed(1)} chapters/day`} />)}</dl><p>{a.backlog===0 ? "No known new chapters waiting." : a.catchupDays===undefined ? "Finish chapters to establish a reading pace." : `At your recent pace: ~${a.catchupDays} days to clear your current backlog.`}</p><p className="small faint">A rough estimate. Release rates and chapter lengths can change.</p></section>
    </div>
    <details className="analytics-section"><summary>Your reading fingerprint</summary><dl className="analytics-facts"><Fact label="Most-read known catalog size" value={a.catalogLength ? `${a.catalogLength} chapters` : "—"} /><Fact label="Typical session" value={a.typicalSessionChapters===undefined ? "—" : `${a.typicalSessionChapters.toFixed(0)} chapters finished`} /><Fact label="Most common start hour" value={a.commonStart===undefined ? "—" : `${hourLabel(a.commonStart)}–${hourLabel((a.commonStart+1)%24)}`} /><Fact label="Fastest-read genre" value={a.fastestGenre ? `${a.fastestGenre.name} · ${duration(a.fastestGenre.average)}/chapter` : "Needs 3 measured chapters"} /><Fact label="Highest completion genre" value={a.highestCompletionGenre ? `${a.highestCompletionGenre.name} · ${Math.round(a.highestCompletionGenre.completed/a.highestCompletionGenre.total*100)}%` : "Needs 3 series in a genre"} /></dl><p className="small faint">Based on dated sessions and known genre metadata.</p></details>
    <details className="analytics-section"><summary>Not read in 30 days <span className="faint">{a.neglected.length}</span></summary>{a.neglected.length ? a.neglected.slice(0,10).map(s=><div className="analytics-line" key={s.id}><button className="text-link truncate" onClick={()=>onOpenSeries(s.id)}>{s.title}</button><span className="muted">{s.lastReadAt ? dateLabel(s.lastReadAt) : "Not started"}</span></div>) : <p className="small muted">No active series have been waiting that long.</p>}</details>
    <details className="analytics-section"><summary>Series retention</summary><p className="small muted">Continued reading beyond these observed chapter counts. Active series still below the threshold are excluded until they have enough history; completed or dropped series are treated as ended. Opened chapter numbers never imply earlier chapters were read.</p><dl className="analytics-facts">{a.retention.map(r=><Fact key={r.threshold} label={`Continued after ${r.threshold} completed chapters`} value={r.total ? `${Math.round(r.reached/r.total*100)}% · ${r.reached}/${r.total} series` : "Not enough history"} />)}</dl>{!!dropBands[0] && dropBands[0].count>0 && <p>Most common drop point: {dropBands[0].name} completed chapters ({dropBands[0].count} series).</p>}</details>
    <details className="analytics-section"><summary>Genres, status & sources</summary>{!a.genreRows.length ? <p className="muted small">No genre metadata yet. Add genres in series details or visit a source page that labels them.</p> : <><p className="small faint">Genres can overlap. Completion here means series marked completed.</p>{a.genreRows.map(g=><div className="analytics-line genre-line" key={g.name}><strong>{g.name}</strong><span>{duration(g.time)} · {g.rating===undefined ? "Unrated" : `${g.rating.toFixed(1)} avg rating`} · {Math.round(g.completed/g.total*100)}% series completed{g.dropped.length>0 ? ` · ${(g.dropped.reduce((n,c)=>n+c,0)/g.dropped.length).toFixed(0)} chapters before dropping` : ""}</span></div>)}</>}
      <h3 className="section-title">Library status</h3>{a.statusRows.map(r=><div className="analytics-line" key={r.name}><span>{r.name.replace("planning","Plan to read").replace("on-hold","On hold")}</span><span>{r.count} series</span></div>)}<h3 className="section-title">Reading by source</h3>{a.sourceRows.length ? a.sourceRows.map(r=><div className="analytics-line" key={r.name}><span>{sourceLabel(r.name)}</span><span>{duration(r.time)}</span></div>) : <p className="small faint">No dated reading by source yet.</p>}</details>
    <details className="analytics-section"><summary>Observed updates</summary><p className="small muted">New chapters first seen after a source catalog was established. These are observation times, not publisher release dates.</p><dl className="analytics-facts"><Fact label="New chapters observed" value={String(a.releases)} /><Fact label="Completed / waiting" value={`${a.releasesRead} / ${a.releases-a.releasesRead}`} /><Fact label="Median time to open after first seen" value={duration(a.releaseDelay)} /></dl>{a.delays.length>0 && <>{[...a.delays].sort((x,y)=>x.delay-y.delay).slice(0,1).map(d=><p key={d.seriesId}>Fastest followed: {a.byId.get(d.seriesId)?.title} · {duration(d.delay)} after first seen</p>)}{[...a.delays].sort((x,y)=>y.delay-x.delay).slice(0,1).map(d=><p key={d.seriesId}>Most delayed: {a.byId.get(d.seriesId)?.title} · {duration(d.delay)}</p>)}</>}</details>
    <details className="analytics-section"><summary>Milestones</summary>{a.milestones.length ? <ol className="progress-timeline">{a.milestones.map(m=><li key={m.label}><time>{dateLabel(m.at)}</time><span>{m.label}</span></li>)}</ol> : <p className="small muted">Historical markers will appear as your dated reading record grows.</p>}</details>
    <p className="analytics-note">Everything is calculated on this device. Sessions group measured reading separated by no more than 15 minutes. Manual progress corrections are excluded from activity charts.</p>
    {current && <button className="btn" onClick={()=>onAnalyzeSeries(undefined)}>All reading analytics</button>}
  </article>;
}
function Fact({label,value}: {label:string;value:string}) { return <div><dt>{label}</dt><dd className="tabular">{value}</dd></div>; }
function Trend({days,metric,label}: {days:ActivityDay[];metric:"minutes"|"backlog";label:string}) {
  const values=days.map(d=>d[metric]); const known=values.filter((v):v is number=>v!==undefined);
  if (!known.length || (metric==="minutes" && !known.some(v=>v>0))) return <div className="chart-empty">{metric==="backlog" ? "Backlog snapshots will build from here." : "No measured reading in this period."}</div>;
  const max=Math.max(1,...known);const width=600,height=160;
  const paths: string[]=[];let path="";
  days.forEach((d,i)=>{const v=d[metric];if(v===undefined){if(path)paths.push(path);path="";return;}const x=days.length>1 ? i/(days.length-1)*width : width/2;const y=height-12-v/max*(height-24);path+=`${path ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;});if(path)paths.push(path);
  return <div className="reading-chart"><span className="chart-scale">{metric==="minutes" ? duration(max*60_000) : `${max} chapters`}</span><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none"><title>{label}</title>{[0,0.5,1].map(n=><line key={n} x1="0" x2={width} y1={12+n*(height-24)} y2={12+n*(height-24)} className="chart-grid" />)}{paths.map((p,i)=><path key={i} d={p} className="chart-line" />)}{known.length===1 && <circle cx={days.length>1 ? values.findIndex(v=>v!==undefined)/(days.length-1)*width : width/2} cy={height-12-known[0]!/max*(height-24)} r="3" fill="var(--accent)" />}</svg><details className="chart-data"><summary>View daily data</summary><table><thead><tr><th>Date</th><th>{metric==="minutes" ? "Active reading" : "Backlog"}</th></tr></thead><tbody>{days.filter(d=>d[metric]!==undefined).map(d=><tr key={d.date}><td>{dateLabel(d.date)}</td><td>{metric==="minutes" ? duration(d.minutes*60_000) : d.backlog}</td></tr>)}</tbody></table></details></div>;
}
