import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { JobCard } from '@/components/crawl/JobCard';
import { PageLoader, EmptyState, ErrorState } from '@/components/ui/Misc';
import { crawlApi, useListJobsQuery } from '@/features/crawl/crawlApi';
import { getApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import type { CrawlJobStatus } from '@/lib/types';

const FILTERS: { label: string; value?: CrawlJobStatus }[] = [
  { label: 'All' },
  { label: 'Running', value: 'running' },
  { label: 'Queued', value: 'queued' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
];

const ACTIVE_STATUSES: CrawlJobStatus[] = ['pending', 'queued', 'running', 'cancelling'];

export default function Dashboard() {
  const [status, setStatus] = useState<CrawlJobStatus | undefined>(undefined);
  const [page, setPage] = useState(1);

  const args = { page, limit: 9, status };

  // Decide polling from the cached result for these args (the previous load);
  // the first load always fetches, so starting with no polling is fine.
  const { data: cached } = crawlApi.endpoints.listJobs.useQueryState(args);
  const hasActive = useMemo(
    () => (cached?.data.jobs ?? []).some((j) => ACTIVE_STATUSES.includes(j.status)),
    [cached]
  );

  // Poll only while there are active jobs so progress stays fresh.
  const { data, isLoading, isError, error } = useListJobsQuery(args, {
    pollingInterval: hasActive ? 6000 : 0,
  });

  const jobs = useMemo(() => data?.data.jobs ?? [], [data]);
  const pagination = data?.data.pagination;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Your crawls</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {pagination ? `${pagination.total} total job${pagination.total === 1 ? '' : 's'}` : 'Loading…'}
            {hasActive && <span className="ml-2 text-brand-600 dark:text-brand-400">• live updating</span>}
          </p>
        </div>
        <Link to="/crawl/new">
          <Button>
            <PlusCircle className="h-4 w-4" />
            New crawl
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              status === f.value
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageLoader label="Loading your crawls…" />
      ) : isError ? (
        <ErrorState message={getApiErrorMessage(error)} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title="No crawls yet"
          description="Launch your first crawl to start collecting data."
          action={
            <Link to="/crawl/new">
              <Button>
                <PlusCircle className="h-4 w-4" />
                New crawl
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <JobCard key={job._id} job={job} />
            ))}
          </div>

          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm text-slate-500">
                Page {pagination.page} of {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
