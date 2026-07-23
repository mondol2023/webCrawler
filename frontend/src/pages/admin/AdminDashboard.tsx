import { Users, UserCheck, Briefcase, Activity, CheckCircle2, XCircle, Database } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageLoader, ErrorState } from '@/components/ui/Misc';
import { useGetStatsQuery } from '@/features/admin/adminApi';
import { getApiErrorMessage } from '@/lib/apiError';

export default function AdminDashboard() {
  const { data, isLoading, isError, error } = useGetStatsQuery(undefined, {
    pollingInterval: 15000,
  });

  if (isLoading) return <PageLoader label="Loading platform stats…" />;
  if (isError || !data) return <ErrorState message={getApiErrorMessage(error)} />;

  const s = data.data;
  const tiles = [
    { label: 'Total users', value: s.users.total, icon: Users, tone: 'text-brand-600' },
    { label: 'Active users', value: s.users.active, icon: UserCheck, tone: 'text-green-600' },
    { label: 'Total jobs', value: s.jobs.total, icon: Briefcase, tone: 'text-slate-600' },
    { label: 'Running now', value: s.jobs.running, icon: Activity, tone: 'text-blue-600' },
    { label: 'Completed', value: s.jobs.completed, icon: CheckCircle2, tone: 'text-green-600' },
    { label: 'Failed', value: s.jobs.failed, icon: XCircle, tone: 'text-red-600' },
    { label: 'Results indexed', value: s.results.total, icon: Database, tone: 'text-brand-600' },
  ];

  const maxDay = Math.max(1, ...s.jobsPerDay.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Platform overview</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Live metrics across all users and crawl jobs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardBody>
              <Icon className={`h-5 w-5 ${tone}`} />
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
                {value.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Jobs per day" description="Last 7 days" />
        <CardBody>
          {s.jobsPerDay.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No jobs in this period.</p>
          ) : (
            <div className="flex items-end gap-3" style={{ height: 180 }}>
              {s.jobsPerDay.map((d) => (
                <div key={d._id} className="flex flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{d.count}</span>
                  <div
                    className="w-full rounded-t-md bg-brand-500 transition-all"
                    style={{ height: `${(d.count / maxDay) * 140}px` }}
                  />
                  <span className="text-[10px] text-slate-400">{d._id.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
