import { useState } from 'react';
import { Globe, Download, Loader, AlertCircle, FileText, Link as LinkIcon } from 'lucide-react';
import type { ScrapeResult } from '../../shared/types';
import { apiFetch } from '../lib/api';

// Must match the zod schema in server/index.ts (depth max 3)
const MAX_DEPTH = 3;

export function WebScraper() {
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScrapeResult | null>(null);

  const scrapeUrl = async () => {
    if (!url) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await apiFetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, depth, maxPages: 50 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Server not reachable. Run: pnpm dev:all (includes backend server on :3010)');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to scrape URL');
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadMarkdown = () => {
    if (!data) return;

    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scraped-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scraped-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-5 h-5 text-accent" />
        <h3 className="text-lg font-bold">WEB SCRAPER v2</h3>
        <span className="text-xs text-gray-500 ml-auto">Playwright + Markdown</span>
      </div>

      {/* URL Input */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && url && scrapeUrl()}
            placeholder="https://example.com"
            className="flex-1 bg-bg border border-line rounded px-3 py-2 text-sm focus:border-accent focus:outline-none"
            disabled={loading}
          />
          <button
            onClick={scrapeUrl}
            disabled={loading || !url}
            className="ls-button px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Scraping...
              </>
            ) : (
              'Scrape'
            )}
          </button>
        </div>

        {/* Depth Control */}
        <div className="flex items-center gap-3 bg-bg border border-line rounded p-3">
          <label className="text-xs text-gray-400 font-bold">CRAWL DEPTH:</label>
          <input
            type="range"
            min="1"
            max={MAX_DEPTH}
            value={depth}
            onChange={e => setDepth(parseInt(e.target.value))}
            className="flex-1"
            disabled={loading}
          />
          <div className="text-right min-w-[120px]">
            <div className="text-sm font-bold text-accent">
              {depth} level{depth > 1 ? 's' : ''}
            </div>
            <div className="text-xs text-gray-500">
              {depth === 1 && 'Single page'}
              {depth === 2 && '+ linked pages'}
              {depth === 3 && '+ 2nd level'}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-red-300 mb-1">Scraping Failed</div>
            <div className="text-xs text-red-400">{error}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Metadata Card */}
          <div className="mb-3 p-3 bg-bg rounded border border-line">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="text-sm font-bold text-accent mb-1">{data.title}</div>
                <div className="text-xs text-gray-400 break-all flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" />
                  {data.url}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-bg-sidebar rounded p-2">
                <div className="text-xs text-gray-500">Pages Scraped</div>
                <div className="text-lg font-bold text-accent">
                  {data.metadata.pagesScraped}
                </div>
              </div>
              <div className="bg-bg-sidebar rounded p-2">
                <div className="text-xs text-gray-500">Depth Level</div>
                <div className="text-lg font-bold text-accent">{data.metadata.depth}</div>
              </div>
              <div className="bg-bg-sidebar rounded p-2">
                <div className="text-xs text-gray-500">Content Size</div>
                <div className="text-lg font-bold text-accent">
                  {(data.markdown.length / 1024).toFixed(1)}kb
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={downloadMarkdown}
                className="flex-1 px-3 py-2 bg-accent text-bg rounded font-bold text-xs hover:bg-cyan-400 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Markdown
              </button>
              <button
                onClick={downloadJson}
                className="flex-1 px-3 py-2 bg-bg border border-line rounded font-bold text-xs hover:border-accent text-gray-300 transition-all flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Download JSON
              </button>
            </div>

            <div className="text-xs text-gray-500 mt-3 flex items-center gap-2">
              <span>Scraped at {new Date(data.metadata.timestamp).toLocaleString()}</span>
            </div>
          </div>

          {/* Content Preview */}
          <div className="flex-1 overflow-auto bg-bg rounded border border-line min-h-0">
            <div className="sticky top-0 bg-bg-sidebar border-b border-line px-3 py-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              <span className="text-xs font-bold text-gray-400">MARKDOWN PREVIEW</span>
            </div>
            <div className="p-4">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {data.markdown}
              </pre>
            </div>
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-3">
          <Globe className="w-12 h-12 text-gray-700" />
          <div className="text-center">
            <div className="font-bold mb-1">Professional Web Scraper</div>
            <div className="text-xs text-gray-600">Powered by Playwright + Cheerio + Turndown</div>
          </div>
          <div className="text-xs bg-bg border border-line rounded px-3 py-2 max-w-md">
            Enter a URL, set crawl depth, and extract clean Markdown content
          </div>
        </div>
      )}
    </div>
  );
}
