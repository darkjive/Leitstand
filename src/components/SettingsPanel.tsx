import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Volume2,
  Cloud,
  Github,
  GitBranch,
  Settings as SettingsIcon,
  KeyRound,
} from 'lucide-react';
import { getSetting, getSettingJSON, setSetting, setSettingRaw } from '../lib/settings';
import { getDashboardToken, setDashboardToken } from '../lib/api';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type SectionId = 'general' | 'sound' | 'git';

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof X }> = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'sound', label: 'Sound', icon: Volume2 },
  { id: 'git', label: 'Git Roots', icon: GitBranch },
];

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [section, setSection] = useState<SectionId>('general');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[80vh] bg-elevated border border-accent rounded-lg flex flex-col overflow-hidden"
        style={{ boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-bg">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold">SETTINGS</h2>
          </div>
          <button
            onClick={onClose}
            className="ds-btn ghost icon"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: Sidebar + Content */}
        <div className="flex-1 flex min-h-0">
          <nav className="w-48 border-r border-line bg-bg/50 overflow-y-auto p-2">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-mono transition-all mb-1 ${
                    active
                      ? 'bg-accent/20 text-accent border border-accent/50'
                      : 'text-gray-400 hover:bg-accent/10 hover:text-accent border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-6">
            {section === 'general' && <GeneralSection />}
            {section === 'sound' && <SoundSection />}
            {section === 'git' && <GitSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Reusable bits
// ============================================================

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-bold text-accent">{title}</h3>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-mono text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full px-3 py-2 bg-bg border border-line rounded text-sm text-accent font-mono focus:border-accent focus:outline-none';

// ============================================================
// General: GitHub Username + Weather Location
// ============================================================

function GeneralSection() {
  const [githubUsername, setGithubUsername] = useState(() => getSetting('github-username', ''));
  const [weatherLocation, setWeatherLocation] = useState(() =>
    getSetting('weather-location', 'Munich')
  );
  const [dashboardToken, setToken] = useState(() => getDashboardToken());

  return (
    <div className="space-y-6 max-w-md">
      <SectionHeader title="GENERAL" hint="Global scalar settings used across widgets." />

      <Field label="GITHUB USERNAME">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            type="text"
            value={githubUsername}
            onChange={e => setGithubUsername(e.target.value)}
            onBlur={() => setSettingRaw('github-username', githubUsername.trim())}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setSettingRaw('github-username', githubUsername.trim());
              }
            }}
            placeholder="e.g. torvalds"
            className={inputClass}
          />
        </div>
      </Field>

      <Field label="WEATHER LOCATION">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            type="text"
            value={weatherLocation}
            onChange={e => setWeatherLocation(e.target.value)}
            onBlur={() => setSettingRaw('weather-location', weatherLocation.trim() || 'Munich')}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setSettingRaw('weather-location', weatherLocation.trim() || 'Munich');
              }
            }}
            placeholder="e.g. Berlin"
            className={inputClass}
          />
        </div>
      </Field>

      <Field label="DASHBOARD TOKEN">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            type="password"
            value={dashboardToken}
            onChange={e => setToken(e.target.value)}
            onBlur={() => setDashboardToken(dashboardToken.trim())}
            onKeyDown={e => {
              if (e.key === 'Enter') setDashboardToken(dashboardToken.trim());
            }}
            placeholder="only needed when backend is LAN-exposed"
            autoComplete="off"
            className={inputClass}
          />
        </div>
      </Field>

      <p className="text-xs text-gray-600">
        GitHub username and weather use public data only. The dashboard token is sent as{' '}
        <code className="text-accent">X-Dashboard-Token</code> on every API request and is only
        required if you set <code className="text-accent">DASHBOARD_TOKEN</code> on a
        LAN-exposed backend.
      </p>
    </div>
  );
}

// ============================================================
// Sound
// ============================================================

function SoundSection() {
  const [enabled, setEnabled] = useState(() => getSetting('sound-enabled', 'true'));
  const [volume, setVolume] = useState(() => getSetting('sound-volume', '0.3'));

  const isEnabled = enabled !== 'false';

  const toggle = () => {
    const next = !isEnabled;
    setEnabled(String(next));
    setSettingRaw('sound-enabled', String(next));
  };

  const changeVolume = (v: string) => {
    setVolume(v);
    setSettingRaw('sound-volume', v);
  };

  return (
    <div className="space-y-6 max-w-md">
      <SectionHeader title="SOUND" hint="Background ambiance playback." />

      <div className="flex items-center justify-between p-3 bg-bg border border-line rounded">
        <div>
          <div className="text-sm font-mono text-gray-200">Ambiance Enabled</div>
          <div className="text-xs text-gray-500 mt-1">Toggle background sound playback.</div>
        </div>
        <button
          onClick={toggle}
          className={`relative w-12 h-6 rounded-full transition-all ${
            isEnabled ? 'bg-accent/80' : 'bg-line'
          }`}
          title={isEnabled ? 'Disable' : 'Enable'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-bg transition-all ${
              isEnabled ? 'translate-x-6' : ''
            }`}
          />
        </button>
      </div>

      <Field label={`VOLUME — ${Math.round(parseFloat(volume) * 100)}%`}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={parseFloat(volume) || 0.3}
          onChange={e => changeVolume(e.target.value)}
          className="w-full accent-accent"
        />
      </Field>
    </div>
  );
}

// ============================================================
// Generic list editor
// ============================================================

function ListEditor<T>({
  storageKey,
  defaultItems,
  renderItem,
  emptyLabel,
  addLabel,
  buildNew,
}: {
  storageKey: string;
  defaultItems: T[];
  renderItem: (item: T, replace: (next: T) => void, remove: () => void) => React.ReactNode;
  emptyLabel: string;
  addLabel: string;
  buildNew: () => T;
}) {
  const [items, setItems] = useState<T[]>(() => getSettingJSON<T[]>(storageKey, defaultItems));

  const persist = (next: T[]) => {
    setItems(next);
    setSetting(storageKey, next);
  };

  const add = () => persist([...items, buildNew()]);
  const remove = (idx: number) => persist(items.filter((_, i) => i !== idx));
  const replace = (idx: number, next: T) => persist(items.map((it, i) => (i === idx ? next : it)));

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="text-xs text-gray-500 italic px-3 py-4 border border-dashed border-line rounded text-center">
          {emptyLabel}
        </div>
      )}

      {items.map((item, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 p-2 bg-bg border border-line rounded"
        >
          <div className="flex-1">
            {renderItem(
              item,
              next => replace(idx, next),
              () => remove(idx)
            )}
          </div>
          <button
            onClick={() => remove(idx)}
            className="ds-btn danger sm icon"
            title="Remove"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      <button
        onClick={add}
        className="ds-btn sm"
      >
        <Plus className="w-3 h-3" />
        <span>{addLabel}</span>
      </button>
    </div>
  );
}

// ============================================================
// Git Roots (string[])
// ============================================================

function GitSection() {
  return (
    <div className="space-y-4 max-w-2xl">
      <SectionHeader title="GIT ROOTS" hint="Directories scanned by the Git Status widget." />
      <ListEditor<string>
        storageKey="git-roots"
        defaultItems={[]}
        emptyLabel="No git roots configured."
        addLabel="Add root"
        buildNew={() => ''}
        renderItem={(root, replace) => (
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              type="text"
              value={root}
              onChange={e => replace(e.target.value)}
              placeholder="/home/user/projects"
              className={inputClass}
            />
          </div>
        )}
      />
    </div>
  );
}
