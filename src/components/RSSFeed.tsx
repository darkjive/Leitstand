import { useState, useEffect, useCallback } from 'react';
import { Rss, ExternalLink, Clock, Loader2 } from 'lucide-react';

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  content?: string;
}

interface RSSFeedProps {
  url: string;
  maxItems?: number;
}

export function RSSFeed({ url, maxItems = 10 }: RSSFeedProps) {
  const [items, setItems] = useState<RSSItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const fetchRSS = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Use RSS2JSON API as CORS proxy
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'error') {
        throw new Error(data.message || 'Failed to fetch RSS feed');
      }

      setItems(data.items.slice(0, maxItems));
    } catch (err) {
      console.error('RSS fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, [url, maxItems]);

  useEffect(() => {
    fetchRSS();
  }, [fetchRSS]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = Date.now();
      const diff = now - date.getTime();
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (hours < 1) return 'just now';
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const stripHtml = (html: string) => {
    // DOMParser neither executes scripts nor loads resources — unlike
    // innerHTML on a detached node, where <img onerror=…> still fires.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 border border-red-500/30 rounded">
        <p className="text-sm text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <Rss className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No items found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <a
          key={index}
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-3 bg-bg border border-line rounded hover:border-accent transition-all group"
        >
          <div className="flex items-start gap-2">
            <ExternalLink className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5 group-hover:text-accent transition-colors" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-200 group-hover:text-accent transition-colors line-clamp-2 mb-1">
                {item.title}
              </h3>
              {(item.description || item.content) && (
                <p className="text-xs text-gray-400 line-clamp-2 mb-1">
                  {stripHtml(item.description || item.content || '')}
                </p>
              )}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>{formatDate(item.pubDate)}</span>
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
