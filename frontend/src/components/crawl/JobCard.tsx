import { Link } from 'react-router-dom';
import { Globe, FileSearch, Target, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Misc';
import { useAppSelector } from '@/app/hooks';
import { resolveStatus } from '@/features/crawl/crawlSlice';
import { formatRelative, truncate } from '@/lib/utils';
import type { CrawlJob } from '@/lib/types';

export function JobCard({ job }: { job: CrawlJob }) {
  // Overlay live socket state (if any) on top of the persisted job.
  const live = useAppSelector((s) => s.crawl.live[job._id]);
  const status = resolveStatus(live, job.status);
  const progress = live?.progress ?? job.progress;
  const pagesCrawled = live?.pagesCrawled ?? job.pagesCrawled;
  const pagesMatched = live?.pagesMatched ?? job.pagesMatched;
  const isActive = status === 'running' || status === 'cancelling' || status === 'queued' || status === 'pending';

  return (
    <Card className="transition-shadow hover:shadow-md">
      <Link to={`/jobs/${job._id}`} className="block p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {truncate(job.url, 48)}
            </span>
          </div>
          <StatusBadge status={status} />
        </div>

        {job.keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.keywords.slice(0, 4).map((kw) => (
              <span
                key={kw}
                className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {kw}
              </span>
            ))}
            {job.keywords.length > 4 && (
              <span className="text-xs text-slate-400">+{job.keywords.length - 4}</span>
            )}
          </div>
        )}

        {isActive && (
          <div className="mt-4">
            <ProgressBar value={progress} />
            <p className="mt-1.5 text-xs text-slate-500">{progress}% complete</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1">
              <FileSearch className="h-3.5 w-3.5" /> {pagesCrawled} crawled
            </span>
            <span className="inline-flex items-center gap-1">
              <Target className="h-3.5 w-3.5" /> {pagesMatched} matched
            </span>
          </div>
          <span>{formatRelative(job.createdAt)}</span>
        </div>

        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
          View details <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </Link>
    </Card>
  );
}
