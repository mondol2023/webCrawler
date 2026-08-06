import { useState, useRef, useEffect } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut, ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { useHideOnScroll } from '@/hooks/useHideOnScroll';
import { useLogoutMutation } from '@/features/auth/authApi';
import { cn } from '@/lib/utils';

export function Navbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const [logout, { isLoading }] = useLogoutMutation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { hidden, scrolled } = useHideOnScroll();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  return (
    <header
      className={cn(
        // Slides out of the way on the way down and snaps back on the way up.
        'sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b px-4 transition-transform duration-300 ease-out lg:px-6',
        'bg-white/80 backdrop-blur dark:bg-slate-900/80',
        scrolled
          ? 'border-slate-200 shadow-sm dark:border-slate-800'
          : 'border-transparent',
        // Keep the bar put while its own menu is open, or the menu leaves with it.
        hidden && !menuOpen && '-translate-y-full'
      )}
    >
      <button
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* The downloader is the app's headline action — promoted out of the sidebar. */}
        <NavLink
          to="/media"
          className={({ isActive }) =>
            cn(
              'group inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-all duration-200 sm:px-4',
              isActive
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-brand-50 text-brand-700 hover:bg-brand-100 hover:shadow-sm dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20'
            )
          }
        >
          <Download className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
          <span className="hidden sm:inline">Media Downloader</span>
        </NavLink>

        <button
          onClick={toggle}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
              {initials}
            </span>
            <span className="hidden text-sm font-medium text-slate-700 dark:text-slate-200 sm:block">
              {user?.name}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>

          <div
            className={cn(
              'absolute right-0 mt-2 w-56 origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900',
              menuOpen ? 'block' : 'hidden'
            )}
          >
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{user?.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
            <div className="p-1">
              <Button
                variant="ghost"
                size="sm"
                loading={isLoading}
                onClick={handleLogout}
                className="w-full justify-start text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
