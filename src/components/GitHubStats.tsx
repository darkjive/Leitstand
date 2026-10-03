import { useState, useEffect } from 'react';
import { Github, Star, GitFork, Eye, GitPullRequest } from 'lucide-react';

interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  public_repos: number;
  followers: number;
  following: number;
  bio: string;
}

interface GitHubRepo {
  name: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  language: string;
  description: string;
}

export function GitHubStats({ username = '' }: { username?: string }) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;

    let isFirstLoad = true;

    const fetchGitHub = async () => {
      try {
        // Fetch user data
        const userRes = await fetch(`https://api.github.com/users/${username}`);

        if (!userRes.ok) {
          // Handle rate limiting silently after first load
          if (userRes.status === 403 && !isFirstLoad) {
            console.warn('[GitHub] Rate limited, will retry later');
            return; // Don't show error, just skip this update
          }
          throw new Error(
            userRes.status === 403
              ? 'GitHub API rate limit exceeded. Try again later.'
              : 'User not found'
          );
        }

        const userData = await userRes.json();
        setUser(userData);

        // Fetch repos (top 5 by stars)
        const reposRes = await fetch(
          `https://api.github.com/users/${username}/repos?sort=stars&per_page=5`
        );
        if (!reposRes.ok) {
          if (reposRes.status === 403 && !isFirstLoad) {
            return; // Silent fail on rate limit
          }
          throw new Error('Repos not found');
        }
        const reposData = await reposRes.json();
        setRepos(reposData);

        setError(null); // Clear any previous errors
        setLoading(false);
        isFirstLoad = false;
      } catch (err) {
        if (isFirstLoad) {
          // Only log and show error on first load
          console.error('[GitHub] Failed to fetch data:', err);
          setError(err instanceof Error ? err.message : 'Unknown error');
          setLoading(false);
        }
        isFirstLoad = false;
      }
    };

    fetchGitHub();
    const interval = setInterval(fetchGitHub, 600000); // Update every 10 minutes (reduced from 5)
    return () => clearInterval(interval);
  }, [username]);

  if (!username) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2">
        <Github className="w-10 h-10 text-gray-600" />
        <div className="text-sm text-gray-400">No GitHub username configured</div>
        <div className="text-xs text-gray-600">Set one under Settings → General</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent">
          LOADING GITHUB STATS<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-red-500">GitHub data unavailable: {error}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
        <Github className="w-6 h-6 text-accent" />
        <h3 className="text-xl font-bold">GITHUB STATS</h3>
      </div>

      {/* User Profile */}
      <div className="flex items-center gap-4 mb-6 pb-6 border-b border-line">
        <img
          src={user.avatar_url}
          alt={user.login}
          className="w-16 h-16 rounded-full border-2 border-accent"
          style={{ boxShadow: 'none' }}
        />
        <div className="flex-1">
          <div className="text-lg font-bold text-accent">{user.name || user.login}</div>
          <div className="text-sm text-gray-400">@{user.login}</div>
          {user.bio && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{user.bio}</div>}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-3 bg-bg rounded border border-line">
          <div className="text-2xl font-bold text-accent">{user.public_repos}</div>
          <div className="text-xs text-gray-400 mt-1">Repositories</div>
        </div>
        <div className="text-center p-3 bg-bg rounded border border-line">
          <div className="text-2xl font-bold text-accent-bright">{user.followers}</div>
          <div className="text-xs text-gray-400 mt-1">Followers</div>
        </div>
        <div className="text-center p-3 bg-bg rounded border border-line">
          <div className="text-2xl font-bold text-accent">{user.following}</div>
          <div className="text-xs text-gray-400 mt-1">Following</div>
        </div>
      </div>

      {/* Top Repositories */}
      <div>
        <h4 className="text-sm font-bold text-gray-400 mb-3">TOP REPOSITORIES</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {repos.map((repo, i) => (
            <div
              key={i}
              className="p-3 bg-bg rounded border border-line hover:border-accent transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-mono text-sm text-accent font-bold">{repo.name}</div>
                {repo.language && (
                  <span className="text-xs px-2 py-1 bg-elevated rounded text-gray-400">
                    {repo.language}
                  </span>
                )}
              </div>
              {repo.description && (
                <div className="text-xs text-gray-500 mb-2 line-clamp-2">{repo.description}</div>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-accent-bright" />
                  <span>{repo.stargazers_count}</span>
                </div>
                <div className="flex items-center gap-1">
                  <GitFork className="w-3 h-3 text-accent" />
                  <span>{repo.forks_count}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Eye className="w-3 h-3 text-gray-500" />
                  <span>{repo.watchers_count}</span>
                </div>
                {repo.open_issues_count > 0 && (
                  <div className="flex items-center gap-1">
                    <GitPullRequest className="w-3 h-3 text-green-500" />
                    <span>{repo.open_issues_count}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
