const fs = require('fs');

const fetch = global.fetch;
function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371.0088;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 站代码 -> 站点信息
const infoMap = new Map();

async function getStationInfo(code) {
  const r = await fetch(`https://m.shmetro.com/interface/metromap/metromap.aspx?func=stationInfo&stat_id=${code}`, { signal: AbortSignal.timeout(8000) });
  const t = await r.text();
  try { return JSON.parse(t)[0]; } catch { return null; }
}

const stationCoordCache = JSON.parse(fs.readFileSync('public/stations-coords.json', 'utf8'));

async function main() {
  // 1. 所有线路
  const lines = await (await fetch('https://m.shmetro.com/interface/metromap/metromap.aspx?func=lines', { signal: AbortSignal.timeout(8000) })).json();
  // 2. 逐线抓站点顺序与经纬度
  const out = [];
  const visited = new Set();
  for (const l of lines) {
    const locs = await (await fetch(`https://m.shmetro.com/interface/metromap/metromap.aspx?func=lineStations&line=${l.line_no}`, { signal: AbortSignal.timeout(8000) })).json()
      .then(j => j.levels[0].locations).catch(() => []);
    if (!locs.length) continue;
    const st = [];
    for (const loc of locs) {
      const code = loc.id.replace('station', '').padStart(4, '0');
      let info = null;
      if (!infoMap.has(code)) {
        info = await getStationInfo(code);
        if (info) infoMap.set(code, info);
        await sleep(150);
      }
      info = infoMap.get(code);
      const coord = stationCoordCache.find(c => c.code === code);
      st.push({
        code,
        name: info?.name_cn || loc.title,
        line: l.line_no,
        lng: info?.longitude ?? null,
        lat: info?.latitude ?? null,
        gao_lng: info?.gao_lng ?? null,
        gao_lat: info?.gao_lat ?? null,
        x: coord?.x ?? null, y: coord?.y ?? null,
      });
    }
    if (st.length) { out.push({ line: l.line_no, stations: st }); console.log(`line ${l.line_no}: ${st.length} stations`); }
  }
  // 3. 相邻站站间距（公里，取有效经纬度，失败后续置空）
  for (const lin of out) {
    const s = lin.stations;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (a.lng != null && b.lng != null) {
        a.distNext = haversineKm(a.lng, a.lat, b.lng, b.lat);
      } else {
        a.distNext = null;
      }
    }
  }
  fs.writeFileSync('data/latlng_dist.json', JSON.stringify(out, null, 1), 'utf8');
  const total = out.reduce((n, l) => n + l.stations.length, 0);
  let withLng = 0, withDist = 0;
  for (const l of out) for (const s of l.stations) { if (s.lng != null) withLng++; if (s.distNext != null) withDist++; }
  console.log(`total stations: ${total}, with lng/lat: ${withLng}, with station-gap km: ${withDist}`);
}

main().catch((e) => console.error('ERR', e.message));