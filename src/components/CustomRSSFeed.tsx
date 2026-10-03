import { useState } from 'react';
import { RSSFeed } from './RSSFeed';
import { Edit2, Save, Plus, Trash2 } from 'lucide-react';
import { useSettingJSON } from '../lib/settings';

interface SavedFeed {
  id: string;
  name: string;
  url: string;
}

const defaultFeeds: SavedFeed[] = [
  { id: '1', name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { id: '2', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { id: '3', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

export function CustomRSSFeed() {
  // Persisted + synced with SettingsPanel automatically
  const [feeds, setFeeds] = useSettingJSON<SavedFeed[]>('custom-rss-feeds', defaultFeeds);
  const [activeFeedId, setActiveFeedId] = useState<string>(feeds[0]?.id || '');
  const [isEditing, setIsEditing] = useState(false);
  const [newFeedName, setNewFeedName] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');

  const addFeed = () => {
    if (!newFeedName.trim() || !newFeedUrl.trim()) return;

    const newFeed: SavedFeed = {
      id: Date.now().toString(),
      name: newFeedName.trim(),
      url: newFeedUrl.trim(),
    };

    setFeeds([...feeds, newFeed]);
    setActiveFeedId(newFeed.id);
    setNewFeedName('');
    setNewFeedUrl('');
  };

  const removeFeed = (id: string) => {
    const remaining = feeds.filter(f => f.id !== id);
    setFeeds(remaining);
    if (activeFeedId === id) {
      setActiveFeedId(remaining[0]?.id || '');
    }
  };

  const activeFeed = feeds.find(f => f.id === activeFeedId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-lg font-bold">CUSTOM RSS</h3>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="ds-btn icon ml-auto"
          title={isEditing ? 'Done editing' : 'Manage feeds'}
        >
          {isEditing ? <Save className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Edit Mode */}
      {isEditing && (
        <div className="mb-3 p-3 bg-bg border border-accent rounded space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Feed name..."
              value={newFeedName}
              onChange={e => setNewFeedName(e.target.value)}
              className="flex-1 px-2 py-1 bg-bg border border-line rounded text-sm text-gray-200 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Feed URL..."
              value={newFeedUrl}
              onChange={e => setNewFeedUrl(e.target.value)}
              className="flex-1 px-2 py-1 bg-bg border border-line rounded text-sm text-gray-200 focus:border-accent focus:outline-none"
            />
            <button
              onClick={addFeed}
              className="ds-btn icon"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Feed List */}
          <div className="space-y-1 mt-2">
            {feeds.map(feed => (
              <div
                key={feed.id}
                className="flex items-center gap-2 p-2 bg-bg/50 border border-line rounded"
              >
                <span className="flex-1 text-xs text-gray-300 truncate">{feed.name}</span>
                <button
                  onClick={() => removeFeed(feed.id)}
                  className="ds-btn danger sm icon"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feed Tabs */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
        {feeds.map(feed => (
          <button
            key={feed.id}
            onClick={() => setActiveFeedId(feed.id)}
            className={`px-3 py-1 text-xs font-bold rounded whitespace-nowrap transition-all ${
              activeFeedId === feed.id
                ? 'bg-accent text-bg'
                : 'bg-bg border border-line text-gray-400 hover:border-accent'
            }`}
          >
            {feed.name}
          </button>
        ))}
      </div>

      {/* Feed Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeFeed ? (
          <RSSFeed key={activeFeed.id} url={activeFeed.url} maxItems={15} />
        ) : (
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">No feeds configured</p>
          </div>
        )}
      </div>
    </div>
  );
}
