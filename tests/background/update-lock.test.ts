import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useDatabase } from '../../src/storage/db';
import { trackSeriesPage } from '../../src/storage/tracking';
import { seriesObs } from '../helpers/obs';
import { runUpdateChecks } from '../../src/background/update-checker';
vi.mock('../../src/background/net',()=>({fetchText:async()=>({ok:false,status:503,text:'',finalUrl:'',redirected:false})}));
vi.mock('../../src/background/offscreen',()=>({closeOffscreen:async()=>{},parseInOffscreen:async()=>null}));
let data:Record<string,unknown>;
beforeEach(()=>{
 useDatabase(`lock-${crypto.randomUUID()}`);data={};
 const kv={get:async(k:string)=>({...{[k]:data[k]}}),set:async(v:Record<string,unknown>)=>Object.assign(data,v),remove:async(k:string)=>{delete data[k]}};
 vi.stubGlobal('chrome',{storage:{local:kv,session:kv},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}});
});
afterEach(()=>vi.unstubAllGlobals());
it('concurrent manual and alarm runs check a source only once',async()=>{
 const r=(await trackSeriesPage(seriesObs({title:'Solo Leveling',url:'https://example-scans.com/manga/solo-leveling/'})))!;
 const results=await Promise.all([runUpdateChecks({force:true,seriesIds:[r.seriesId]}),runUpdateChecks({force:true,seriesIds:[r.seriesId]})]);
 expect(results.sort()).toEqual([0,1]);
});
it('preserves a restart-safe active lease and recovers an expired lease',async()=>{
 const r=(await trackSeriesPage(seriesObs({title:'Solo Leveling',url:'https://example-scans.com/manga/solo-leveling/'})))!;
 data['updates:lock']=Date.now();expect(await runUpdateChecks({force:true,seriesIds:[r.seriesId]})).toBe(0);
 data['updates:lock']=Date.now()-6*60_000;expect(await runUpdateChecks({force:true,seriesIds:[r.seriesId]})).toBe(1);
});
