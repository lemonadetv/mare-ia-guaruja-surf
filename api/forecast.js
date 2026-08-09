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

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function buildWeek(m, w, spotName, windAngle) {
  const md = (m && m.daily) || {};
  const wd = (w && w.daily) || {};
  const times = Array.isArray(md.time) ? md.time : [];
  if (!times.length) return [];
  return times.map((dateStr, i) => {
    const wave = md.wave_height_max ? md.wave_height_max[i] : null;
    const period = md.wave_period_max ? md.wave_period_max[i] : null;
    const waveDir = md.wave_direction_dominant ? md.wave_direction_dominant[i] : null;
    const wind = wd.wind_speed_10m_max ? wd.wind_speed_10m_max[i] : null;
    const windDir = wd.wind_direction_10m_dominant ? wd.wind_direction_10m_dominant[i] : null;
    const precip = wd.precipitation_sum ? wd.precipitation_sum[i] : null;

    let score = null;
    if (wave != null && period != null && wind != null && windDir != null) {
      const offshoreRef = typeof windAngle === 'number' ? windAngle : waveDir;
      const aligned = offshoreRef != null && angleDiff(windDir, offshoreRef) < 90;
      score = computeScore(wave, period, wind, aligned);
    }

    const d = new Date(dateStr + 'T12:00:00');
    return {
      day: WEEKDAYS[d.getDay()],
      date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      spot: spotName,
      wave: wave != null ? wave.toFixed(1).replace('.', ',') : null,
      period: period != null ? Math.round(period) : null,
      waveDir: waveDir != null ? dirLabel(waveDir) : null,
      wind: wind != null ? Math.round(wind) : null,
      windDir: windDir != null ? dirLabel(windDir) : null,
      precip,
      score
    };
  });
}

function buildHourly(m, w) {
  const mh = (m && m.hourly) || {};
  const wh = (w && w.hourly) || {};
  const times = Array.isArray(mh.time) ? mh.time : [];
  if (!times.length) return [];
  const now = Date.now();
  let startIdx = times.findIndex(t => new Date(t).getTime() >= now);
  if (startIdx === -1) startIdx = 0;
  const waves = Array.isArray(mh.wave_height) ? mh.wave_height : [];
  const winds = Array.isArray(wh.wind_speed_10m) ? wh.wind_speed_10m : [];
  const precs = Array.isArray(wh.precipitation) ? wh.precipitation : [];
  const out = [];
  for (let i = startIdx; i < Math.min(startIdx + 13, times.length); i++) {
    out.push({
      t: new Date(times[i]).toLocaleTimeString('pt-BR', { hour: '2-digit', timeZone: 'America/Sao_Paulo' }),
      wave: typeof waves[i] === 'number' ? waves[i] : null,
      wind: typeof winds[i] === 'number' ? winds[i] : null,
      precip: typeof precs[i] === 'number' ? precs[i] : null
    });
  }
  return out;
}

function computeScore(waveM, periodS, windKmh, aligned) {
  let s = Math.min(waveM * 28, 55) + Math.min(periodS * 2.5, 30);
  s += aligned ? Math.max(0, 15 - windKmh * 0.3) : -Math.min(25, windKmh * 0.6);
  return Math.max(5, Math.min(99, Math.round(s)));
}

// Stormglass free tier is very limited (10 req/day) — cache the shared tide
// read in-memory per warm serverless instance so concurrent refreshes across
// visitors don't each burn a request.
let tideCache = { data: null, fetchedAt: 0 };
const TIDE_CACHE_MS = 20 * 60 * 1000;
const TOWN_LAT = -24.0027, TOWN_LNG = -46.2611;

async function fetchTideExtremes() {
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) return null;
  const now = Date.now();
  if (tideCache.data && (now - tideCache.fetchedAt) < TIDE_CACHE_MS) return tideCache.data;
  try {
    const start = new Date(now - 6 * 3600 * 1000).toISOString();
    const end = new Date(now + 24 * 3600 * 1000).toISOString();
    const res = await fetch(
      `https://api.stormglass.io/v2/tide/extremes/point?lat=${TOWN_LAT}&lng=${TOWN_LNG}&start=${start}&end=${end}`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) return tideCache.data;
    const json = await res.json();
    tideCache = { data: json, fetchedAt: now };
    return json;
  } catch (e) {
    return tideCache.data;
  }
}

function summarizeTide(json) {
  if (!json || !Array.isArray(json.data) || !json.data.length) return null;
  const now = Date.now();
  const points = json.data
    .map(p => ({ type: p.type, time: new Date(p.time).getTime(), height: p.height }))
    .sort((a, b) => a.time - b.time);
  const past = points.filter(p => p.time <= now);
  const future = points.filter(p => p.time > now);
  const prev = past[past.length - 1];
  const next = future[0];

  let height = null, direction = null;
  if (prev && next) {
    const frac = (now - prev.time) / (next.time - prev.time);
    height = prev.height + (next.height - prev.height) * (1 - Math.cos(Math.PI * frac)) / 2;
    direction = next.height > prev.height ? 'up' : 'down';
  } else if (next) {
    height = next.height;
  }

  const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const nextHigh = future.find(p => p.type === 'high');
  const nextLow = future.find(p => p.type === 'low');

  return {
    height: height != null ? height.toFixed(1).replace('.', ',') : null,
    direction,
    nextHighTime: nextHigh ? fmtTime(nextHigh.time) : null,
    nextLowTime: nextLow ? fmtTime(nextLow.time) : null
  };
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
    const [marineRes, weatherRes, tideRaw] = await Promise.all([
      fetch(`${MARINE_URL}?latitude=${lats}&longitude=${lngs}&current=wave_height,wave_period,wave_direction&hourly=wave_height,wave_period&daily=wave_height_max,wave_period_max,wave_direction_dominant&timezone=auto&forecast_days=7`),
      fetch(`${WEATHER_URL}?latitude=${lats}&longitude=${lngs}&current=precipitation,wind_speed_10m,wind_direction_10m,temperature_2m&hourly=wind_speed_10m,precipitation&daily=precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant&timezone=auto&wind_speed_unit=kmh&forecast_days=7`),
      fetchTideExtremes()
    ]);

    if (!marineRes.ok || !weatherRes.ok) {
      res.status(200).json({ error: 'upstream-error', spots: [] });
      return;
    }

    const tide = summarizeTide(tideRaw);

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
        windDirDeg: windDir,
        windKind,
        precip, precipToday, temp,
        score,
        hourly: buildHourly(m, w),
        week: buildWeek(m, w, s.name || s.id, s.windAngle)
      };
    });

    res.status(200).json({ updatedAt: new Date().toISOString(), spots: result, tide });
  } catch (err) {
    res.status(200).json({ error: 'fetch-failed', spots: [] });
  }
};
