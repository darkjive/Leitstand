import { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, Wind, Droplets, MapPin, Edit2 } from 'lucide-react';
import type { WeatherData } from '../../shared/types';
import { useSetting } from '../lib/settings';
import { apiFetch } from '../lib/api';

export function WeatherWidget({ location: initialLocation = 'Munich' }: { location?: string }) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  // Persisted + synced with SettingsPanel automatically
  const [location, setLocation] = useSetting('weather-location', initialLocation);
  const [editingLocation, setEditingLocation] = useState(false);
  const [tempLocation, setTempLocation] = useState(location);

  const saveLocation = () => {
    setLocation(tempLocation);
    setEditingLocation(false);
  };

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const res = await apiFetch(`/api/weather?location=${encodeURIComponent(location)}`);
        const data = await res.json();
        setWeather(data);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch weather:', error);
        setLoading(false);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 600000); // Update every 10 minutes
    return () => clearInterval(interval);
  }, [location]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent">
          FETCHING WEATHER DATA<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  if (!weather || !weather.current_condition || !weather.current_condition[0]) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Weather data unavailable</div>
      </div>
    );
  }

  const current = weather.current_condition[0];
  const area = weather.nearest_area[0];
  const temp = current.temp_C === '--' ? '--' : parseInt(current.temp_C);
  const desc = current.weatherDesc[0].value.toLowerCase();

  const getWeatherIcon = () => {
    if (desc.includes('rain')) return <CloudRain className="w-12 h-12 text-accent" />;
    if (desc.includes('cloud')) return <Cloud className="w-12 h-12 text-gray-400" />;
    return <Sun className="w-12 h-12 text-accent-bright" />;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold">WEATHER</h3>
          {editingLocation ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={tempLocation}
                onChange={e => setTempLocation(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveLocation()}
                className="px-2 py-1 bg-bg border border-accent text-xs rounded text-gray-300"
                placeholder="City name"
                autoFocus
              />
              <button
                onClick={saveLocation}
                className="ds-btn primary sm"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setTempLocation(location);
                  setEditingLocation(false);
                }}
                className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingLocation(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-bg border border-accent/30 rounded text-xs text-accent mt-1 hover:border-accent hover:bg-accent/10 transition-all group"
            >
              <MapPin className="w-3 h-3" />
              <span>
                {area.areaName[0].value}, {area.country[0].value}
              </span>
              <Edit2 className="w-3 h-3 opacity-50 group-hover:opacity-100" />
            </button>
          )}
        </div>
        {getWeatherIcon()}
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-5xl font-bold">{temp}°C</div>
          <div className="text-sm text-gray-400 mt-1">
            {current.FeelsLikeC !== '--'
              ? `Feels like ${current.FeelsLikeC}°C`
              : 'Service unavailable'}
          </div>
        </div>
      </div>

      <div className="text-lg text-accent mb-4 capitalize">{desc}</div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-line">
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-accent" />
          <div>
            <div className="text-xs text-gray-400">Humidity</div>
            <div className="text-sm font-bold">{current.humidity}%</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Wind className="w-4 h-4 text-accent" />
          <div>
            <div className="text-xs text-gray-400">Wind</div>
            <div className="text-sm font-bold">{current.windspeedKmph} km/h</div>
          </div>
        </div>
      </div>
    </div>
  );
}
