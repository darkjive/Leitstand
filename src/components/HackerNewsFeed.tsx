import { useState, useEffect } from 'react';
import { Flame, ExternalLink, TrendingUp, MessageSquare } from 'lucide-react';

interface HNStory {
  id: number;
  title: string;
  url: string;
  score: number;
  by: string;
  time: number;
  descendants: number;
}

export function HackerNewsFeed() {
  const [stories, setStories] = useState<HNStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'npm' | 'security'>('all');

  useEffect(() => {
    const fetchStories = async () => {
      try {
        // Fetch top stories from HN API
        const topStoriesRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
        const topStoryIds = await topStoriesRes.json();

        // Fetch first 15 stories
        const storyPromises = topStoryIds.slice(0, 15).map(async (id: number) => {
          const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return res.json();
        });

        const fetchedStories = await Promise.all(storyPromises);
        setStories(fetchedStories.filter(s => s && s.url)); // Filter out Ask HN posts
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch HN stories:', error);
        setLoading(false);
      }
    };

    fetchStories();
    const interval = setInterval(fetchStories, 300000); // Update every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const filterStories = () => {
    if (filter === 'npm') {
      return stories.filter(
        s =>
          s.title.toLowerCase().includes('npm') ||
          s.title.toLowerCase().includes('node') ||
          s.title.toLowerCase().includes('javascript')
      );
    }
    if (filter === 'security') {
      return stories.filter(
        s =>
          s.title.toLowerCase().includes('security') ||
          s.title.toLowerCase().includes('vulnerability') ||
          s.title.toLowerCase().includes('breach')
      );
    }
    return stories;
  };

  const filteredStories = filterStories();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent-bright">
          FETCHING HACKER NEWS<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-accent-bright" />
          <h3 className="text-lg font-bold text-accent-bright">HACKER NEWS</h3>
        </div>
        <TrendingUp className="w-4 h-4 text-accent-bright" />
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(['all', 'npm', 'security'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-bold transition-all ${
              filter === f
                ? 'bg-accent-bright text-bg'
                : 'bg-bg border border-line text-gray-400 hover:border-accent-bright'
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Stories */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {filteredStories.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">No stories matching filter</div>
        ) : (
          filteredStories.map(story => (
            <a
              key={story.id}
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 bg-bg rounded border border-line hover:border-accent-bright transition-all group"
            >
              <div className="flex items-start gap-2 mb-2">
                <div className="flex-1">
                  <h4 className="text-sm font-medium group-hover:text-accent-bright line-clamp-2">
                    {story.title}
                  </h4>
                </div>
                <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-accent-bright flex-shrink-0" />
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="text-accent-bright font-bold">▲ {story.score}</span>
                <span>{story.by}</span>
                {story.descendants > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare size={12} />
                    {story.descendants}
                  </span>
                )}
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
