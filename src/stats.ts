/**
 * Visitor stats (GoatCounter, loaded from index.html). Page views count themselves; these are the
 * events on top: a match started, a match finished. count.js loads async, so events fired before
 * it arrives wait in a small queue and flush when it is ready (or are dropped after a minute,
 * blocked or offline). Nothing here may ever break the game.
 */
type Counter = { count?: (o: { path: string; title?: string; event?: boolean }) => void };

const queue: Array<{ path: string; title: string }> = [];
let flusher: ReturnType<typeof setInterval> | null = null;
let waited = 0;

function counter(): Counter | null {
  const gc = (window as unknown as { goatcounter?: Counter }).goatcounter;
  return gc && typeof gc.count === 'function' ? gc : null;
}

function flush(): void {
  const gc = counter();
  if (!gc) return;
  while (queue.length) {
    const e = queue.shift() as { path: string; title: string };
    try {
      gc.count?.({ path: e.path, title: e.title, event: true });
    } catch {
      /* stats are best-effort */
    }
  }
}

export function track(path: string, title: string): void {
  try {
    queue.push({ path, title });
    if (counter()) {
      flush();
      return;
    }
    // count.js is still loading (or blocked): check for it now and then, up to a minute.
    if (!flusher) {
      flusher = setInterval(() => {
        waited += 1;
        if (counter()) flush();
        if (queue.length === 0 || waited > 30) {
          clearInterval(flusher as ReturnType<typeof setInterval>);
          flusher = null;
          waited = 0;
          queue.length = 0;
        }
      }, 2000);
    }
  } catch {
    /* stats are best-effort */
  }
}
