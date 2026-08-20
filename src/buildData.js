const fs = require('fs');
const path = require('path');
const SVG_W = 2638.57, SVG_H = 3692.52;

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/metromap.json'), 'utf-8'));
const locations = raw.levels[0].locations;

const codeList = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/stations.json'), 'utf-8'));
// 名称(去空格) -> 该名称对应的所有代码（同名换乘站有多个代码）
const nameToCodes = {};
for (const s of codeList) {
  const n = s.name.replace(/\s+/g, '');
  if (!nameToCodes[n]) nameToCodes[n] = [];
  nameToCodes[n].push(s.code);
}

// 每个位置 -> 该位置上的站点名
const posToNames = {};
for (const loc of locations) {
  const name = loc.title.replace(/\s+/g, '');
  const key = `${Math.round(parseFloat(loc.x) * SVG_W)}_${Math.round(parseFloat(loc.y) * SVG_H)}`;
  if (!posToNames[key]) posToNames[key] = { name, x: Math.round(parseFloat(loc.x) * SVG_W), y: Math.round(parseFloat(loc.y) * SVG_H) };
}

// 生成完整映射：每个站点代码映射到它的坐标（同名换乘站共享坐标）
const resultMap = {};
for (const [key, { name, x, y }] of Object.entries(posToNames)) {
  const codes = nameToCodes[name];
  if (!codes) continue;
  for (const code of codes) {
    resultMap[code] = { code, name, x, y };
  }
}

// 检查缺失
const usedCodes = new Set(Object.keys(resultMap));
const unmatchedCodes = codeList.filter((s) => !usedCodes.has(s.code) && !s.name.startsWith('内圈') && !s.name.startsWith('外圈'));

let result = Object.values(resultMap);
result.sort((a, b) => a.code.localeCompare(b.code));
console.log('匹配站点:', result.length);

console.log('缺失代码 (' + unmatchedCodes.length + '):');
if (unmatchedCodes.length <= 30) unmatchedCodes.forEach((s) => console.log('  ' + s.code, s.name));

fs.writeFileSync(path.join(__dirname, '../data/officialStations.json'), JSON.stringify(result, null, 2));
console.log('已写入 officialStations.json');