// 生成「每个站点 → 全网」的三合一票价图（现行 / 方案一 / 方案二）
// 复用本项目内部数据与计价逻辑，产物为 SVG，按线路分目录存放。
const fs = require('fs');
const path = require('path');
const { priceOf } = require('../src/services/fareCalc');

const ROOT = path.join(__dirname, '..');
const SVG_W = 2638.57, SVG_H = 3692.52;
const OUT_DIR = path.join(ROOT, '涨价方案对比');

const coords = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/stations-coords.json'), 'utf8'));
const fares = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fares.json'), 'utf8'));
const distances = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/distances.json'), 'utf8')).distances;

const LINE_NAME = { '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线' };

const visible = coords.filter((s) => !s.hidden);
const byCode = new Map(coords.map((s) => [s.code, s]));

function getLineName(code) {
  return LINE_NAME[code.substring(0, 2)] || '其他';
}

function fairPrice(a, b) {
  const key = [a, b].sort().join(':');
  const v = fares[key];
  return v == null ? null : Number(typeof v === 'object' ? (v.normal ?? v.price) : v);
}

function schemePrice(a, b, scheme) {
  const key = [a, b].sort().join(':');
  if (distances[key] != null) return priceOf(distances[key], scheme);
  const cur = fairPrice(a, b);
  return cur == null ? null : priceOf(cur, 'current');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function labelGroup(origin, s) {
  const segs = [
    fairPrice(origin.code, s.code),
    schemePrice(origin.code, s.code, 'scheme1'),
    schemePrice(origin.code, s.code, 'scheme2'),
  ];
  const colors = ['#fff', '#d6ecff', '#fff3b0'];
  const bw = 20, bh = 15, gap = 1;
  const topY = s.y - (3 * (bh + gap)) / 2 + bh / 2;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const y = topY + i * (bh + gap);
    out.push(`<rect x="${(s.x - bw / 2).toFixed(2)}" y="${(y - bh / 2).toFixed(2)}" width="${bw}" height="${bh}" fill="${colors[i]}" stroke="#333" stroke-width="1"/>`);
    if (segs[i] != null) {
      out.push(`<text x="${s.x.toFixed(2)}" y="${(y + 4.5).toFixed(2)}" text-anchor="middle" font-size="11" font-weight="700" font-family="Arial, sans-serif" fill="#333">${segs[i]}</text>`);
    }
  }
  return out.join('\n');
}

function originMark(origin) {
  return `<circle cx="${origin.x.toFixed(2)}" cy="${origin.y.toFixed(2)}" r="16" fill="#E6002E" stroke="#333" stroke-width="3"/>` +
    `<text x="${origin.x.toFixed(2)}" y="${(origin.y + 5).toFixed(2)}" text-anchor="middle" font-size="14" font-weight="900" font-family="Arial, sans-serif" fill="#fff">起</text>`;
}

function buildSvgDoc(origin) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}" xmlns:xlink="http://www.w3.org/1999/xlink">`);
  parts.push(`<image href="linesh.svg" x="0" y="0" width="${SVG_W}" height="${SVG_H}"/>`);
  const lines = [];
  for (const s of visible) {
    if (s.code === origin.code) {
      lines.push(originMark(s));
      continue;
    }
    const g = labelGroup(origin, s);
    if (g) lines.push(g);
  }
  parts.push(lines.join('\n'));
  parts.push('</svg>');
  return parts.join('\n');
}

function main() {
  const origins = visible.filter((s) => s.code.slice(0, 2) !== '51');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'public/images/linesh.svg'), path.join(OUT_DIR, 'linesh.svg'));

  const skipped = [];
  let total = 0;
  for (const o of origins) {
    const line = getLineName(o.code);
    if (!line || line === '其他') { skipped.push(o); continue; }
    const dir = path.join(OUT_DIR, line);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${o.name}_三合一.svg`);
    fs.writeFileSync(file, buildSvgDoc(o), 'utf8');
    total++;
  }
  console.log(`已生成 ${total} 张三合一图（覆盖 ${Object.keys(LINE_NAME).filter((k) => k !== '51').join(',')} 号线）`);
  console.log(`输出目录: ${OUT_DIR}`);
  if (skipped.length) console.log('跳过(无线路归属):', skipped.map((s) => s.name).join(','));
}

main();