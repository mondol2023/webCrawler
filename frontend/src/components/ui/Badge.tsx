import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import type { CrawlJobStatus } from '@/lib/types';

type Tone = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'indigo';

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  indigo: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
};

export function Badge({
  tone = 'gray',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

const statusTone: Record<CrawlJobStatus, Tone> = {
  pending: 'gray',
  queued: 'amber',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

export function StatusBadge({ status }: { status: CrawlJobStatus }) {
  return (
    <Badge tone={statusTone[status]} className="capitalize">
      {status === 'running' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </Badge>
  );
}
