import { useState, type FormEvent } from 'react';
import { Search, Globe2, ShieldCheck, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProxySettings } from './ProxySettings';
import { cn } from '@/lib/utils';

interface ProbeFormProps {
  onSubmit: (params: { url: string; proxyUrl: string; respectRobotsTxt: boolean }) => void;
  loading: boolean;
  serverDefaultProxy: boolean;
  /** Whether the proxy panel is expanded — owned by the parent. */
  proxyOpen: boolean;
  onProxyOpenChange: (open: boolean) => void;
}

/**
 * The single entry point of the downloader: paste a page URL, optionally route
 * it through a proxy, and scan.
 *
 * The proxy panel is collapsed by default because the common case needs no
 * proxy at all — it only matters once a scan comes back geo-blocked, which is
 * why the parent owns whether it is open: the restriction notice it renders
 * further down the page needs to be able to reveal it.
 */
export function ProbeForm({
  onSubmit,
  loading,
  serverDefaultProxy,
  proxyOpen,
  onProxyOpenChange,
}: ProbeFormProps) {
  const [url, setUrl] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [respectRobots, setRespectRobots] = useState(true);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    onSubmit({ url: trimmed, proxyUrl: proxyUrl.trim(), respectRobotsTxt: respectRobots });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <Link2 className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          name="pageUrl"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/watch/some-video"
          autoComplete="off"
          spellCheck={false}
          aria-label="Page URL to scan for media"
          className="h-14 w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 text-base text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 sm:pr-44"
        />
        <div className="mt-3 sm:absolute sm:right-2 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">
          <Button
            type="submit"
            size="lg"
            loading={loading}
            disabled={!url.trim()}
            className="w-full rounded-xl sm:h-10 sm:w-auto sm:px-5"
          >
            {!loading && <Search className="h-4 w-4" />}
            {loading ? 'Scanning…' : 'Scan page'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          active={respectRobots}
          onClick={() => setRespectRobots((v) => !v)}
          icon={<ShieldCheck className="h-4 w-4" />}
          label={respectRobots ? 'Respecting robots.txt' : 'Ignoring robots.txt'}
        />
        <Toggle
          active={proxyOpen || Boolean(proxyUrl)}
          onClick={() => onProxyOpenChange(!proxyOpen)}
          icon={<Globe2 className="h-4 w-4" />}
          label={proxyUrl ? 'Proxy set' : 'Proxy / VPN'}
        />
        {serverDefaultProxy && !proxyUrl && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Server proxy available
          </span>
        )}
      </div>

      {proxyOpen && (
        <ProxySettings
          value={proxyUrl}
          onChange={setProxyUrl}
          onClose={() => onProxyOpenChange(false)}
          serverDefaultConfigured={serverDefaultProxy}
        />
      )}
    </form>
  );
}

function Toggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
        active
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
          : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
