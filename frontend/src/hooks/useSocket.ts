import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useAppDispatch } from '@/app/hooks';
import {
  jobProgress,
  jobStarted,
  jobCompleted,
  jobFailed,
} from '@/features/crawl/crawlSlice';
import type { JobProgress } from '@/lib/types';

/**
 * Subscribes to realtime updates for a single crawl job. Joins the job's room
 * on mount, dispatches incoming events into the crawl slice, and cleans up on
 * unmount. `onSettled` fires when the job completes or fails (e.g. to refetch).
 */
export function useJobSocket(
  jobId: string | undefined,
  onSettled?: () => void
): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!jobId) return;
    const socket = getSocket();

    const join = () => socket.emit('join:job', jobId);
    join();
    // Re-join automatically if the socket reconnects.
    socket.on('connect', join);

    const handleProgress = (payload: JobProgress) => {
      if (payload.jobId === jobId) dispatch(jobProgress(payload));
    };
    const handleStarted = (payload: { jobId: string }) => {
      if (payload.jobId === jobId) dispatch(jobStarted(payload));
    };
    const handleCompleted = (payload: { jobId: string }) => {
      if (payload.jobId === jobId) {
        dispatch(jobCompleted(payload));
        onSettled?.();
      }
    };
    const handleFailed = (payload: { jobId: string; error?: string }) => {
      if (payload.jobId === jobId) {
        dispatch(jobFailed(payload));
        onSettled?.();
      }
    };

    socket.on('job:progress', handleProgress);
    socket.on('job:started', handleStarted);
    socket.on('job:completed', handleCompleted);
    socket.on('job:failed', handleFailed);

    return () => {
      socket.emit('leave:job', jobId);
      socket.off('connect', join);
      socket.off('job:progress', handleProgress);
      socket.off('job:started', handleStarted);
      socket.off('job:completed', handleCompleted);
      socket.off('job:failed', handleFailed);
    };
  }, [jobId, dispatch, onSettled]);
}
