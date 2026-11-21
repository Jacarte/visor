import { afterEach, expect, it, vi } from 'vitest';
import { coalescedRefresh } from '../src/refresh';
afterEach(() => vi.useRealTimers());
it('coalesces changed/resolved/create/delete/rename bursts and can refresh repeatedly', () => {
  vi.useFakeTimers(); const callback = vi.fn(); const refresh = coalescedRefresh(callback);
  for (let i = 0; i < 6; i++) refresh.request();
  expect(callback).not.toHaveBeenCalled(); vi.advanceTimersByTime(60); expect(callback).toHaveBeenCalledTimes(1);
  refresh.request(); vi.advanceTimersByTime(60); expect(callback).toHaveBeenCalledTimes(2); refresh.dispose();
});
it('cancels pending refresh on disposal and ignores later requests', () => {
  vi.useFakeTimers(); const callback = vi.fn(); const refresh = coalescedRefresh(callback);
  refresh.request(); refresh.dispose(); refresh.request(); vi.runAllTimers(); expect(callback).not.toHaveBeenCalled();
});
