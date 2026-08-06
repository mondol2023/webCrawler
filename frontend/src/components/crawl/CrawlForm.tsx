import { useState, type FormEvent } from 'react';
import { Rocket } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { TagInput } from '@/components/ui/TagInput';
import { ErrorState } from '@/components/ui/Misc';
import type { SubmitCrawlRequest } from '@/features/crawl/crawlApi';

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export function CrawlForm({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (payload: SubmitCrawlRequest) => void;
  loading: boolean;
  error?: string;
}) {
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(100);
  const [respectRobotsTxt, setRespectRobotsTxt] = useState(true);
  const [urlError, setUrlError] = useState<string>();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isHttpUrl(url)) {
      setUrlError('Enter a valid http(s) URL.');
      return;
    }
    setUrlError(undefined);
    onSubmit({ url, keywords, phrases, categories, maxDepth, maxPages, respectRobotsTxt });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <ErrorState message={error} />}

      <Input
        label="Target URL"
        name="url"
        type="url"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        error={urlError}
        hint="The crawler starts here and follows links within the same domain."
        required
      />

      <TagInput
        label="Keywords (optional)"
        value={keywords}
        onChange={setKeywords}
        max={20}
        placeholder="e.g. pricing, api, security"
        hint="Pages are scored by how often these appear. Leave empty to crawl without keyword scoring."
      />

      <TagInput
        label="Phrases (optional)"
        value={phrases}
        onChange={setPhrases}
        max={10}
        placeholder="e.g. free trial, open source"
        hint="Exact multi-word matches, weighted higher than keywords."
      />

      <TagInput
        label="Categories (optional)"
        value={categories}
        onChange={setCategories}
        max={10}
        placeholder="e.g. blog, docs"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Max depth"
          name="maxDepth"
          type="number"
          min={1}
          max={10}
          value={maxDepth}
          onChange={(e) => setMaxDepth(Number(e.target.value))}
          hint="How many link-levels deep (1–10)."
        />
        <Input
          label="Max pages"
          name="maxPages"
          type="number"
          min={1}
          max={1000}
          value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value))}
          hint="Upper bound on pages fetched (1–1000)."
        />
      </div>

      <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <input
          type="checkbox"
          checked={respectRobotsTxt}
          onChange={(e) => setRespectRobotsTxt(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm">
          <span className="font-medium text-slate-800 dark:text-slate-200">Respect robots.txt</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Honour crawl permissions and crawl-delay directives.
          </span>
        </span>
      </label>

      <Button type="submit" size="lg" loading={loading} className="w-full sm:w-auto">
        <Rocket className="h-4 w-4" />
        Launch crawl
      </Button>
    </form>
  );
}
