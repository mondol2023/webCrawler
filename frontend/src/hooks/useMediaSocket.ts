import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/hooks/useAuth';
import type { MediaDownload } from '@/lib/types';

/**
 * Live download state, keyed by download id.
 *
 * Progress arrives many times a second, so it is held in local component state
 * rather than pushed through RTK Query — the list query stays the source of
 * truth for *which* downloads exist, and this overlays their live progress.
 * `onSettled` fires on each terminal event so the caller can refetch once.
 */
export function useMediaSocket(onSettled?: () => void): Record<string, MediaDownload> {
  const { user } = useAuth();
  const [live, setLive] = useState<Record<string, MediaDownload>>({});

  // Kept in a ref so a new callback identity doesn't tear down the listeners.
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    const userId = user?._id;
    if (!userId) return;

    const socket = getSocket();
    const join = () => socket.emit('join:user', userId);
    join();
    socket.on('connect', join);

    const apply = (payload: { download: MediaDownload }) => {
      setLive((prev) => ({ ...prev, [payload.download._id]: payload.download }));
    };

    const applyTerminal = (payload: { download: MediaDownload }) => {
      apply(payload);
      settledRef.current?.();
    };

    socket.on('media:started', apply);
    socket.on('media:progress', apply);
    socket.on('media:completed', applyTerminal);
    socket.on('media:failed', applyTerminal);
    socket.on('media:blocked', applyTerminal);

    return () => {
      socket.emit('leave:user', userId);
      socket.off('connect', join);
      socket.off('media:started', apply);
      socket.off('media:progress', apply);
      socket.off('media:completed', applyTerminal);
      socket.off('media:failed', applyTerminal);
      socket.off('media:blocked', applyTerminal);
    };
  }, [user?._id]);

  return live;
}
