// Keep bursts bounded without cancelling a read or losing hints received mid-read.
export function createLiveRefreshQueue(
  isPending: () => boolean,
  refresh: () => Promise<unknown>,
) {
  let disposed = false;
  let dirty = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (disposed || running || timer !== undefined) return;
    timer = setTimeout(() => void flush(), delay);
  };
  const flush = async () => {
    timer = undefined;
    if (disposed) return;
    if (isPending()) {
      schedule(250);
      return;
    }
    dirty = false;
    running = true;
    let retryDelay = 120;
    try {
      await refresh();
    } catch {
      dirty = true;
      retryDelay = 5000;
    } finally {
      running = false;
      if (dirty) schedule(retryDelay);
    }
  };
  return {
    changed: () => {
      dirty = true;
      schedule(120);
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
