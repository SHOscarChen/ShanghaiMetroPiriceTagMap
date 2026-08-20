const fs = require('fs');
const g = JSON.parse(fs.readFileSync('data/latlng_dist.json', 'utf8'));
const coord = {};
for (const line of g) for (const s of line.stations) if (!coord[s.code] && s.lng != null) coord[s.code] = { code: s.code, lng: s.lng, lat: s.lat, name: s.name };
const codes = Object.keys(coord);

class UF { constructor(k){this.p={};k.forEach(x=>this.p[x]=x);} find(x){if(this.p[x]!==x)this.p[x]=this.find(this.p[x]);return this.p[x];} union(a,b){const ra=this.find(a),rb=this.find(b);if(ra!==rb)this.p[ra]=rb;} }
const uf = new UF(codes);
for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
  const a = coord[codes[i]], b = coord[codes[j]];
  if (Math.hypot(a.lng - b.lng, a.lat - b.lat) * 111.0 < 0.3) uf.union(codes[i], codes[j]);
}
// root 规范化名：记录每个 root 的"标准站名"（取该簇第一个有 name 的）
const rootName = {};
for (const c of codes) { const r = uf.find(c); if (!rootName[r]) rootName[r] = coord[c].name; }

const adj = {};
codes.forEach((c) => (adj[c] = []));
const addEdge = (a, b, w) => { if (w == null || a === b) return; adj[a].push([b, w]); adj[b].push([a, w]); };
for (const line of g) { const st = line.stations; for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext); }
const cl = {};
codes.forEach((c) => { const r = uf.find(c); (cl[r] = cl[r] || []).push(c); });
for (const mem of Object.values(cl)) if (mem.length >= 2) for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);

function dijkstraPath(src, dst) {
  const dist = {}; dist[src] = 0; const prev = {}; const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]); const [d, u] = pq.shift();
    if (d > (dist[u] ?? Infinity)) continue;
    if (u === dst) break;
    for (const [v, w] of adj[u] || []) { const nd = d + w; if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; prev[v] = u; pq.push([nd, v]); } }
  }
  if (dist[dst] == null) return null;
  const path = []; let cur = dst;
  while (cur !== undefined) { path.unshift(cur); cur = prev[cur]; }
  return { dist: dist[dst], path };
}

async function plantrip(a, b) {
  const u = `https://m.shmetro.com/interface/plantrip/pt.aspx?func=plantrip&startId=${a}&endId=${b}&planTime=12:00&week=1&ticket=oneCard&type=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  const p = j.pathList && j.pathList[0];
  if (!p) return { ok: false };
  return { ok: true, price: p.price, pass: (p.passStationList || []).map((s) => String(s.stationId).padStart(4, '0')) };
}

const tests = [['0111','0123'],['0123','1633'],['0329','1629'],['0111','5137'],['0111','1521'],['0111','0321'],['0123','0821'],['0201','0138'],['0518','0111']];
async function main() {
  for (const [a, b] of tests) {
    const pr = await plantrip(a, b);
    const mine = dijkstraPath(a, b);
    if (!pr.ok) { console.log(`${a}→${b} 官网失败`); continue; }
    // 官网路径：站序列 -> 物理站 root -> 标准名，压缩相邻重复
    const offNm = [];
    for (const c of pr.pass) {
      if (!coord[c]) continue;
      const nm = rootName[uf.find(c)];
      if (offNm[offNm.length - 1] !== nm) offNm.push(nm);
    }
    const myNm = [];
    for (const c of mine.path) {
      const nm = rootName[uf.find(c)];
      if (myNm[myNm.length - 1] !== nm) myNm.push(nm);
    }
    const sameSeq = offNm.join('|') === myNm.join('|');
    console.log(`${coord[a]?.name}(${a}) → ${coord[b]?.name}(${b})  官网价=${pr.price}`);
    console.log('  官网路径:', offNm.join(' → '));
    console.log('  我算路径:', myNm.join(' → '));
    console.log(sameSeq ? '  ✅ 与官网最短路径完全一致' : '  ⚠️ 序列不同');
  }
}
main().catch((e) => console.error('ERR', e.message));