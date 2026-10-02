// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { watchPage } from '../../src/content/observer';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
it('cannot revive an observer from queued navigation after stop',()=>{
 vi.useFakeTimers();let active=0;
 vi.stubGlobal('MutationObserver',class {observe(){active++}disconnect(){active--}});
 const change=vi.fn();const watcher=watchPage(change);
 window.dispatchEvent(new Event('popstate'));history.replaceState({},'', '/moved');watcher.stop();
 vi.advanceTimersByTime(1000);expect(active).toBe(0);expect(change).not.toHaveBeenCalled();
 const resumed=watchPage(change);expect(active).toBe(1);resumed.stop();
});
