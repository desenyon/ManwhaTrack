import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useDatabase, closeDb } from '../../src/storage/db';
import { trackSeriesPage } from '../../src/storage/tracking';
import { seriesObs } from '../helpers/obs';
import { cacheDetectedCover, refreshCover } from '../../src/background/covers';
import * as seriesRepository from '../../src/storage/repositories/series';
import * as coverStatus from '../../src/storage/cover-status';
import { clearDetectedCovers } from '../../src/storage/repositories/covers';
import { getCoverStatus, setCoverStatus } from '../../src/storage/cover-status';
const network = vi.hoisted(()=>({fail:true,requests:0}));
vi.mock('../../src/background/net',()=>({fetchImage:async()=>{network.requests++;if(network.fail)throw Error('HTTP 403');return new Blob(['image'],{type:'image/png'})}}));
beforeEach(()=>{useDatabase(`covers-${crypto.randomUUID()}`);network.fail=true;network.requests=0});
afterEach(()=>vi.restoreAllMocks());
const url='https://example-scans.com/cover.png';
async function makeSeries(){return (await trackSeriesPage(seriesObs({title:'Solo Leveling',url:'https://example-scans.com/manga/solo-leveling/'})))!.seriesId}
it('persists a cover download failure and conservatively retries on manual refresh',async()=>{
 const id=await makeSeries();await cacheDetectedCover(id,url);await closeDb();const state=await getCoverStatus(id);
 expect(state?.state).toBe('failed');expect(state?.url).toBe(url);expect(state?.error).toContain('Cover could not be downloaded');
 await cacheDetectedCover(id,url);expect(network.requests).toBe(1);
 network.fail=false;expect(await refreshCover(id,url)).toEqual({ok:true});expect((await getCoverStatus(id))?.state).toBe('ready');
});
it('recovers a cover download interrupted by worker termination',async()=>{
 const id=await makeSeries();await setCoverStatus(id,{state:'pending',url,attemptedAt:Date.now()-3*60_000});network.fail=false;
 await cacheDetectedCover(id,url);expect((await getCoverStatus(id))?.state).toBe('ready');expect(network.requests).toBe(1);
});

it('rebuilds cleared cover blobs despite a previous successful diagnostic',async()=>{
 const id=await makeSeries();network.fail=false;await cacheDetectedCover(id,url);await clearDetectedCovers();
 await cacheDetectedCover(id,url);expect(network.requests).toBe(2);
});

it('a failed preflight cannot poison the next cover attempt',async()=>{
 const id=await makeSeries();network.fail=false;
 vi.spyOn(seriesRepository,'getSeries').mockRejectedValueOnce(Error('temporary read failure'));
 await expect(cacheDetectedCover(id,url)).resolves.toBeUndefined();
 await cacheDetectedCover(id,url);expect(network.requests).toBe(1);expect((await getCoverStatus(id))?.state).toBe('ready');
});

it('a failed diagnostics write does not reject an automatic cover failure',async()=>{
 const id=await makeSeries();const original=coverStatus.setCoverStatus;
 vi.spyOn(coverStatus,'setCoverStatus').mockImplementation(async(id,status)=>{if(status.state==='failed')throw Error('temporary diagnostic failure');await original(id,status)});
 await expect(cacheDetectedCover(id,url)).resolves.toBeUndefined();
 expect(network.requests).toBe(1);
});
