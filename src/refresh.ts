/** Coalescing is for event bursts, not a metadata-indexing guarantee. */
export function coalescedRefresh(refresh: () => void, delay = 60) {
  let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false;
  return {
    request() { if (disposed || timer !== undefined) return; timer = setTimeout(() => { timer = undefined; if (!disposed) refresh(); }, delay); },
    dispose() { disposed = true; if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  };
}
