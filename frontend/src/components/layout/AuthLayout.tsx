import type { ReactNode } from 'react';
import { Radar } from 'lucide-react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel (hidden on small screens) */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-brand-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <Radar className="h-7 w-7" />
          <span className="text-xl font-bold">WebCrawler</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Turn any website into structured, searchable intelligence.
          </h1>
          <p className="mt-4 text-brand-100">
            Submit a URL, target your keywords, and watch pages get crawled, scored, and
            indexed in real time.
          </p>
        </div>
        <p className="text-sm text-brand-200">© {new Date().getFullYear()} WebCrawler</p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Radar className="h-6 w-6 text-brand-600" />
            <span className="text-lg font-bold">WebCrawler</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</div>
        </div>
      </div>
    </div>
  );
}
