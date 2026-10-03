import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useSetting } from '../lib/settings';

// The ambiance file is intentionally not checked into the repo (see
// .gitignore) — drop any .ogg at public/audio/ambiance-legal.ogg to enable
// playback. Without it the widget shows a muted, disabled state.
const AUDIO_SRC = '/audio/ambiance-legal.ogg';

export function SoundManager() {
  // Persisted + synced with SettingsPanel automatically
  const [soundEnabledRaw, setSoundEnabledRaw] = useSetting('sound-enabled', 'true');
  const [volumeRaw, setVolumeRaw] = useSetting('sound-volume', '0.3');
  const [audioAvailable, setAudioAvailable] = useState(true);

  const soundEnabled = soundEnabledRaw !== 'false';
  const volume = parseFloat(volumeRaw) || 0.3;

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && audioAvailable) {
      audioRef.current.volume = volume;

      if (soundEnabled) {
        audioRef.current.play().catch(() => {
          // Autoplay blocked - silent
        });
      } else {
        audioRef.current.pause();
      }
    }
  }, [soundEnabled, volume, audioAvailable]);

  const toggleSound = () => {
    setSoundEnabledRaw(String(!soundEnabled));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolumeRaw(e.target.value);
  };

  if (!audioAvailable) {
    return (
      <div
        className="p-2 text-gray-600"
        title={`Ambiance audio missing — add a file at public${AUDIO_SRC}`}
      >
        <VolumeX className="w-5 h-5" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <audio
        ref={audioRef}
        src={AUDIO_SRC}
        loop
        preload="auto"
        onError={() => setAudioAvailable(false)}
      />

      <button
        onClick={toggleSound}
        className="ds-btn ghost icon"
        title={soundEnabled ? 'Mute Ambiance' : 'Play Ambiance'}
      >
        {soundEnabled ? (
          <Volume2 className="w-5 h-5 text-accent" />
        ) : (
          <VolumeX className="w-5 h-5 text-gray-500" />
        )}
      </button>

      {soundEnabled && (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={handleVolumeChange}
            className="w-20 accent-accent"
          />
          <span className="text-xs text-gray-400 w-8">{Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}
