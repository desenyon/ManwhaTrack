// Recoverable download diagnostics, stored locally alongside metadata. Not user history.
import { read, write } from './db';
import type { MetaRecord } from '../shared/types/models';

export interface CoverStatus {
  state: 'pending' | 'failed' | 'ready';
  url: string;
  attemptedAt: number;
  error?: string;
  retryAfter?: number;
}
const key = (seriesId: string) => `cover-status:${seriesId}`;
export async function getCoverStatus(seriesId: string): Promise<CoverStatus | undefined> {
  return read(['meta'], async t => (await t.get<MetaRecord<CoverStatus>>('meta', key(seriesId)))?.value);
}
export async function setCoverStatus(seriesId: string, status: CoverStatus): Promise<void> {
  await write(['meta'], async t => { await t.put('meta', {key:key(seriesId), value:{...status,version:1}}); });
}
