import type { WeatherData } from '../../shared/types.js';

export async function getWeather(location: string): Promise<WeatherData> {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'leitstand' },
    });
    if (!response.ok) {
      throw new Error(`wttr.in responded with ${response.status}`);
    }
    return (await response.json()) as WeatherData;
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    // Return fallback data instead of throwing
    return {
      current_condition: [
        {
          temp_C: '--',
          weatherDesc: [{ value: 'Unavailable' }],
          humidity: '--',
          windspeedKmph: '--',
          FeelsLikeC: '--',
        },
      ],
      nearest_area: [
        {
          areaName: [{ value: location }],
          country: [{ value: '--' }],
        },
      ],
    };
  }
}
