import { Routes, Route, Navigate } from 'react-router-dom';
import { useGetMeQuery } from '@/features/auth/authApi';
import { useAuth } from '@/hooks/useAuth';
import { PageLoader } from '@/components/ui/Misc';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute, AdminRoute, PublicOnlyRoute } from '@/components/routing/Guards';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import CrawlSubmit from '@/pages/CrawlSubmit';
import JobDetail from '@/pages/JobDetail';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import UserManagement from '@/pages/admin/UserManagement';

export default function App() {
  // Hydrate the session once on load; the query dispatches setUser/clearUser.
  useGetMeQuery();
  const { initialized } = useAuth();

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PageLoader label="Starting WebCrawler…" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Authenticated app */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/crawl/new" element={<CrawlSubmit />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />

          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<UserManagement />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
