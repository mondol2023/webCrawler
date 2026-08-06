import { useEffect, useRef } from 'react';
import { Globe2, ShieldCheck, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';

/**
 * Lets the user route scans and downloads through a proxy/VPN endpoint they
 * supply. We never ship or broker a proxy — the credentials stay in this
 * request and are not persisted with the download record.
 *
 * The panel pulls itself into view when it opens, because the thing that opens
 * it is often a geo-block notice further down the page.
 */
export function ProxySettings({
  value,
  onChange,
  onClose,
  serverDefaultConfigured,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  serverDefaultConfigured: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `nearest` so an already-visible panel does not jolt the page.
    const id = requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    );
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      ref={ref}
      className="animate-pop-in rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-brand-600" />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Proxy / VPN endpoint
          </h4>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close proxy settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Input
        name="proxyUrl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="socks5://user:pass@proxy.example.com:1080"
        autoComplete="off"
        spellCheck={false}
        hint="http, https, socks4, socks5 and socks5h are supported. Leave empty to connect directly."
      />

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Credentials are used for this request only — they are never written to the database, and
          download records store just the masked host.
          {serverDefaultConfigured && ' A server-wide proxy is configured and used when this is empty.'}
        </p>
      </div>
    </div>
  );
}
