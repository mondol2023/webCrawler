/**
 * True when BullMQ will not retry this job again. A worker's `failed` event
 * fires on every attempt, so terminal bookkeeping must wait for the last one.
 */
export function isFinalAttempt(
  job: { attemptsMade: number; opts: { attempts?: number } } | undefined
): boolean {
  return !job || job.attemptsMade >= (job.opts.attempts ?? 1);
}
