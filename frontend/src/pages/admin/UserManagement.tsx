import { useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageLoader, ErrorState, EmptyState } from '@/components/ui/Misc';
import { useAuth } from '@/hooks/useAuth';
import {
  useListUsersQuery,
  useToggleUserStatusMutation,
  useUpdateCrawlLimitMutation,
} from '@/features/admin/adminApi';
import { getApiErrorMessage } from '@/lib/apiError';
import { formatDateTime } from '@/lib/utils';

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useListUsersQuery({ page, limit: 20, search });
  const [toggleStatus, { isLoading: toggling }] = useToggleUserStatusMutation();
  const [updateLimit] = useUpdateCrawlLimitMutation();

  const users = data?.data.users ?? [];
  const pagination = data?.data.pagination;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User management</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Activate or suspend accounts and tune per-user crawl limits.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          name="search"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <PageLoader label="Loading users…" />
      ) : isError ? (
        <ErrorState message={getApiErrorMessage(error)} />
      ) : users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Crawl limit</th>
                <th className="px-4 py-3 font-semibold">Jobs</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u._id === currentUser?._id;
                return (
                  <tr
                    key={u._id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === 'admin' ? (
                        <Badge tone="indigo">
                          <ShieldCheck className="h-3 w-3" /> admin
                        </Badge>
                      ) : (
                        <Badge tone="gray">user</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.isActive ? 'green' : 'red'}>
                        {u.isActive ? 'active' : 'suspended'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        defaultValue={u.crawlLimit}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (val >= 1 && val <= 50 && val !== u.crawlLimit) {
                            updateLimit({ userId: u._id, crawlLimit: val });
                          }
                        }}
                        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.totalJobsRun}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={u.isActive ? 'outline' : 'primary'}
                        size="sm"
                        disabled={isSelf || toggling}
                        title={isSelf ? 'You cannot change your own status' : undefined}
                        onClick={() => toggleStatus(u._id)}
                      >
                        {u.isActive ? 'Suspend' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
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
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
