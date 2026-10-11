/**
 * In-process registry of running downloads, keyed by download id, so a
 * delete can abort the transfer (axios stream or yt-dlp child) that is
 * writing the file. Only covers downloads running in this process.
 */
const active = new Map<string, AbortController>();

export function register(id: string): AbortSignal {
  if (active.has(id)) throw new Error(`Download ${id} is already active`);
  const controller = new AbortController();
  active.set(id, controller);
  return controller.signal;
}

export function cancel(id: string): boolean {
  const controller = active.get(id);
  if (!controller) return false;
  active.delete(id);
  controller.abort();
  return true;
}

export function unregister(id: string): void {
  active.delete(id);
}
