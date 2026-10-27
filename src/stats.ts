/**
 * Visitor stats (GoatCounter, loaded from index.html). Page views count themselves; these are the
 * events on top: a match started, a match finished. Nothing here may ever break the game: if the
 * counter is blocked or missing, the calls do nothing.
 */
type Counter = { count?: (o: { path: string; title?: string; event?: boolean }) => void };

export function track(path: string, title: string): void {
  try {
    (window as unknown as { goatcounter?: Counter }).goatcounter?.count?.({ path, title, event: true });
  } catch {
    /* stats are best-effort */
  }
}
