const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function dirLabel(deg) {
  if (deg == null) return null;
  return DIRS[Math.round(((deg % 360) / 22.5)) % 16];
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function computeScore(waveM, periodS, windKmh, aligned) {
  let s = Math.min(waveM * 28, 55) + Math.min(periodS * 2.5, 30);
  s += aligned ? Math.max(0, 15 - windKmh * 0.3) : -Math.min(25, windKmh * 0.6);
  return Math.max(5, Math.min(99, Math.round(s)));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const spots = Array.isArray(body && body.spots) ? body.spots : [];
  if (!spots.length) {
    res.status(400).json({ error: 'missing spots' });
    return;
  }

  const lats = spots.map(s => s.lat).join(',');
  const lngs = spots.map(s => s.lng).join(',');

  try {
    const [marineRes, weatherRes] = await Promise.all([
      fetch(`${MARINE_URL}?latitude=${lats}&longitude=${lngs}&current=wave_height,wave_period,wave_direction&timezone=auto`),
      fetch(`${WEATHER_URL}?latitude=${lats}&longitude=${lngs}&current=precipitation,wind_speed_10m,wind_direction_10m,temperature_2m&daily=precipitation_sum&timezone=auto&wind_speed_unit=kmh&forecast_days=1`)
    ]);

    if (!marineRes.ok || !weatherRes.ok) {
      res.status(200).json({ error: 'upstream-error', spots: [] });
      return;
    }

    const marine = await marineRes.json();
    const weather = await weatherRes.json();
    const marineArr = Array.isArray(marine) ? marine : [marine];
    const weatherArr = Array.isArray(weather) ? weather : [weather];

    const result = spots.map((s, i) => {
      const m = marineArr[i] || {};
      const w = weatherArr[i] || {};
      const mc = m.current || {};
      const wc = w.current || {};

      const wave = typeof mc.wave_height === 'number' ? mc.wave_height : null;
      const period = typeof mc.wave_period === 'number' ? mc.wave_period : null;
      const waveDir = typeof mc.wave_direction === 'number' ? mc.wave_direction : null;
      const wind = typeof wc.wind_speed_10m === 'number' ? wc.wind_speed_10m : null;
      const windDir = typeof wc.wind_direction_10m === 'number' ? wc.wind_direction_10m : null;
      const precip = typeof wc.precipitation === 'number' ? wc.precipitation : null;
      const precipToday = w.daily && Array.isArray(w.daily.precipitation_sum) ? w.daily.precipitation_sum[0] : null;
      const temp = typeof wc.temperature_2m === 'number' ? wc.temperature_2m : null;

      let score = null;
      let windKind = null;
      if (wave != null && period != null && wind != null && windDir != null) {
        const offshoreRef = typeof s.windAngle === 'number' ? s.windAngle : waveDir;
        const aligned = offshoreRef != null && angleDiff(windDir, offshoreRef) < 90;
        score = computeScore(wave, period, wind, aligned);
        windKind = aligned ? (wind < 10 ? 'OFFSHORE' : 'OFFSHORE LEVE') : (wind < 12 ? 'CROSS-SHORE' : 'ONSHORE');
      }

      return {
        id: s.id,
        wave: wave != null ? wave.toFixed(1).replace('.', ',') : null,
        period: period != null ? Math.round(period) : null,
        waveDir: waveDir != null ? dirLabel(waveDir) : null,
        waveDirDeg: waveDir,
        wind: wind != null ? Math.round(wind) : null,
        windDir: windDir != null ? dirLabel(windDir) : null,
        windKind,
        precip, precipToday, temp,
        score
      };
    });

    res.status(200).json({ updatedAt: new Date().toISOString(), spots: result });
  } catch (err) {
    res.status(200).json({ error: 'fetch-failed', spots: [] });
  }
};
