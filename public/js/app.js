const SVG_W = 2638.57, SVG_H = 3692.52;
let allStations = [];
let stationCoords = {};
let fareData = null;        // { old: {code: 元}, new: {code: 元} }
let currentScheme = 'new';  // old | new | diff
let currentOrigin = null;
let maxPrice = 15;
let zoomLevel = 1;
let panX = 0, panY = 0;
let isDragging = false, dragStartX, dragStartY;

const SCHEME_LABEL = { old: '现行价', new: '新票价', diff: '涨跌对比' };
const META = {
  effectiveDate: '2026-12-01',
  publishedDate: '2026-11-23',
  docNo: '沪发改价调〔2026〕58号',
  sourceUrl: 'https://fgw.sh.gov.cn/fgw_jjjctk/20261123/f57b63885c514c829ee269ed589ab2b9.html',
  archiveUrl: 'archive/2025-fare/',
};

const LINE_ORDER = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','41','51'];

function getLineName(code) {
  const p = code.substring(0, 2), m = { '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线' };
  return m[p] || '其他';
}

function getLineOrder(line) {
  const idx = LINE_ORDER.indexOf(line);
  return idx === -1 ? 99 : idx;
}

function deltaOf(code) {
  if (!fareData) return null;
  const o = fareData.old[code], n = fareData.new[code];
  if (o == null || n == null) return null;
  return Number(n) - Number(o);
}

function diffColor(d) {
  if (d > 0) return { fill: '#fff0f0', stroke: '#e6002e', text: '#c4001f' };
  if (d < 0) return { fill: '#eefaf1', stroke: '#009944', text: '#007a36' };
  return { fill: '#f3f4f6', stroke: '#9aa3ad', text: '#5f6670' };
}

function setOriginFromCode(code) {
  const line = getLineName(code);
  document.getElementById('line-select').value = line;
  document.getElementById('line-select').dispatchEvent(new Event('change'));
  document.getElementById('station-select').value = code;
  queryPrices(code);
}

async function init() {
  let rs;
  try {
    rs = await fetch('data/stations.json');
    if (!rs.ok) throw new Error('static missing');
  } catch {
    rs = await fetch('api/stations');
  }
  allStations = await rs.json();

  const rc = await fetch('stations-coords.json');
  const rawCoords = await rc.json();
  for (const s of rawCoords) stationCoords[s.code] = s;

  await loadMeta();
  buildStationSelects();

  document.getElementById('app-title').addEventListener('click', resetState);
  document.getElementById('btn-save').addEventListener('click', savePriceImage);

  document.querySelectorAll('.scheme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!fareData) return;
      setScheme(btn.dataset.scheme);
    });
  });

  setupZoomPan();
  createOverlay();
  fitToView();
  renderDots();

  const helpText = document.querySelector('.help-text');
  if (helpText) setTimeout(() => helpText.classList.add('hide-help'), 3000);
}

async function loadMeta() {
  try {
    const r = await fetch('data/meta.json');
    if (r.ok) Object.assign(META, await r.json());
  } catch { /* 使用默认元数据 */ }
  const dateEl = document.getElementById('meta-date');
  if (dateEl) dateEl.textContent = META.effectiveDate;
  const sourceEl = document.getElementById('source-link');
  if (sourceEl) sourceEl.href = META.sourceUrl;
  const archiveEl = document.getElementById('archive-link');
  if (archiveEl) archiveEl.href = META.archiveUrl;
}

function buildStationSelects() {
  const lineSelect = document.getElementById('line-select');
  const stationSelect = document.getElementById('station-select');
  const grouped = {};
  for (const s of allStations) {
    // 跳过被隐藏的同名换乘站代码（如 5137 浦东机场，已由 0263 代表）
    if (stationCoords[s.code] && stationCoords[s.code].hidden) continue;
    const p = s.code.substring(0, 2);
    const line = getLineName(s.code);
    if (!grouped[p]) grouped[p] = { name: line, stations: [] };
    grouped[p].stations.push(s);
  }
  const lineKeys = Object.keys(grouped).sort((a, b) => getLineOrder(a) - getLineOrder(b));
  for (const p of lineKeys) {
    const o = document.createElement('option'); o.value = grouped[p].name; o.textContent = grouped[p].name;
    lineSelect.appendChild(o);
  }

  lineSelect.addEventListener('change', () => {
    const line = lineSelect.value;
    stationSelect.innerHTML = '';
    stationSelect.disabled = !line;
    const first = document.createElement('option');
    first.value = ''; first.textContent = '— 选择站点 —';
    stationSelect.appendChild(first);
    if (line) {
      const g = Object.values(grouped).find((x) => x.name === line);
      for (const s of g.stations) {
        const o = document.createElement('option'); o.value = s.code; o.textContent = s.name;
        stationSelect.appendChild(o);
      }
    }
  });

  stationSelect.addEventListener('change', () => { if (stationSelect.value) queryPrices(stationSelect.value); });
}

function fitToView() {
  const wrap = document.getElementById('map-wrap');
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (!cw || !ch) return;
  const mapRatio = SVG_W / SVG_H;
  const viewRatio = cw / ch;
  if (viewRatio >= mapRatio) {
    // 横屏：宽度填满整个视口，上下居中（超出部分裁剪，可由用户拖动查看）
    zoomLevel = cw / SVG_W;
    panX = 0;
    panY = (ch - SVG_H * zoomLevel) / 2;
  } else {
    // 竖屏：整块地图完整显示并居中
    zoomLevel = Math.min(cw / SVG_W, ch / SVG_H) * 0.92;
    panX = (cw - SVG_W * zoomLevel) / 2;
    panY = (ch - SVG_H * zoomLevel) / 2;
  }
  applyTransform();
}

window.addEventListener('resize', () => {
  if (!fareData) fitToView();
});

function resetState() {
  fareData = null;
  currentScheme = 'new';
  currentOrigin = null;
  document.querySelectorAll('.scheme-btn').forEach((b) => b.classList.toggle('active', b.dataset.scheme === 'new'));
  document.getElementById('scheme-btn').style.display = 'none';
  document.getElementById('legend').style.display = 'none';
  const lineSelect = document.getElementById('line-select');
  const stationSelect = document.getElementById('station-select');
  lineSelect.value = '';
  stationSelect.innerHTML = '';
  stationSelect.disabled = true;
  const first = document.createElement('option');
  first.value = ''; first.textContent = '— 选择站点 —';
  stationSelect.appendChild(first);
  document.getElementById('status-bar').textContent = '选择起始站 → 显示到各站新旧票价';
  document.getElementById('btn-save').disabled = true;
  renderDots();
}

function setupZoomPan() {
  const wrap = document.getElementById('map-wrap');
  let dragMoved = false;
  let downClientX = 0, downClientY = 0;

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const oldZoom = zoomLevel;
    zoomLevel *= e.deltaY < 0 ? 1.15 : 0.87;
    zoomLevel = Math.max(0.15, Math.min(zoomLevel, 5));
    const factor = zoomLevel / oldZoom;
    panX = mx - (mx - panX) * factor;
    panY = my - (my - panY) * factor;
    applyTransform();
  }, { passive: false });

  wrap.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isDragging = true;
      dragMoved = false;
      downClientX = e.clientX; downClientY = e.clientY;
      dragStartX = e.clientX - panX; dragStartY = e.clientY - panY;
      wrap.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    if (Math.hypot(e.clientX - downClientX, e.clientY - downClientY) > 6) dragMoved = true;
    panX = e.clientX - dragStartX; panY = e.clientY - dragStartY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; document.getElementById('map-wrap').style.cursor = 'grab'; } });

  // 点击地图：优先选最近的站点（屏幕距离 22px 内），圆点或站名附近都生效
  wrap.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }
    selectNearestStation(e);
  });

  // ===== 触摸支持：单指平移、双指缩放 =====
  let pinchDist = 0, pinchZoom = 1;
  wrap.addEventListener('touchstart', (e) => {
    dragMoved = false;
    downClientX = e.touches[0] ? e.touches[0].clientX : 0;
    downClientY = e.touches[0] ? e.touches[0].clientY : 0;
    if (e.target.closest('#overlay-dots circle')) return;
    if (e.touches.length === 1) {
      isDragging = true;
      dragStartX = e.touches[0].clientX - panX;
      dragStartY = e.touches[0].clientY - panY;
    } else if (e.touches.length === 2) {
      isDragging = false;
      pinchZoom = zoomLevel;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist = Math.hypot(dx, dy);
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchDist > 0) {
        const rect = wrap.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const newZoom = Math.max(0.15, Math.min(5, pinchZoom * (dist / pinchDist)));
        const factor = newZoom / zoomLevel;
        panX = mx - (mx - panX) * factor;
        panY = my - (my - panY) * factor;
        zoomLevel = newZoom;
        applyTransform();
      }
    } else if (e.touches.length === 1 && isDragging) {
      if (Math.hypot(e.touches[0].clientX - downClientX, e.touches[0].clientY - downClientY) > 6) dragMoved = true;
      panX = e.touches[0].clientX - dragStartX;
      panY = e.touches[0].clientY - dragStartY;
      applyTransform();
    }
  }, { passive: false });

  const endTouch = () => { if (isDragging) isDragging = false; pinchDist = 0; };
  wrap.addEventListener('touchend', endTouch);
  wrap.addEventListener('touchcancel', endTouch);
}

function selectNearestStation(e) {
  if (!allStations.length) return;
  const wrap = document.getElementById('map-wrap');
  const rect = wrap.getBoundingClientRect();
  const x = (e.clientX - rect.left - panX) / zoomLevel;
  const y = (e.clientY - rect.top - panY) / zoomLevel;
  let best = null, bestDist = Infinity;
  for (const s of visibleStations()) {
    const c = stationCoords[s.code];
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  // 22 屏幕像素内才响应，避免点空白处乱跳
  if (best && bestDist * zoomLevel <= 22) setOriginFromCode(best.code);
}

function applyTransform() {
  const el = document.getElementById('map-content');
  if (el) el.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

function createOverlay() {
  const wrap = document.getElementById('map-wrap');
  wrap.style.cursor = 'grab';

  const content = document.createElement('div');
  content.id = 'map-content';
  content.style.cssText = `transform-origin: 0 0; width:${SVG_W}px; height:${SVG_H}px; position:relative;`;

  const img = document.createElement('img');
  img.src = 'images/linesh.svg';
  img.alt = '上海轨道交通线路图';
  img.style.cssText = `width:${SVG_W}px; height:${SVG_H}px; display:block; pointer-events:none;`;
  content.appendChild(img);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'overlay-svg';
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
  svg.style.cssText = `position:absolute;top:0;left:0;width:${SVG_W}px;height:${SVG_H}px;pointer-events:none;`;
  svg.innerHTML = '<g id="overlay-dots"></g>';
  content.appendChild(svg);
  wrap.appendChild(content);
}

function visibleStations() {
  return allStations.filter((s) => stationCoords[s.code] && !stationCoords[s.code].hidden);
}

function setScheme(scheme) {
  if (!fareData) return;
  currentScheme = scheme;
  document.querySelectorAll('.scheme-btn').forEach((b) => b.classList.toggle('active', b.dataset.scheme === scheme));
  document.getElementById('legend').style.display = scheme === 'diff' ? 'flex' : 'none';

  const stationName = allStations.find((s) => s.code === currentOrigin)?.name || currentOrigin;
  const visibleCodes = new Set(visibleStations().map((s) => s.code));
  const codes = Object.keys(fareData.old).filter((c) => c !== currentOrigin && visibleCodes.has(c));
  const oldVals = codes.map((c) => Number(fareData.old[c])).filter((v) => v > 0);
  const newVals = codes.map((c) => Number(fareData.new[c])).filter((v) => v > 0);

  if (scheme === 'diff') {
    let up = 0, same = 0, down = 0, maxUp = 0;
    for (const c of codes) {
      const d = deltaOf(c);
      if (d == null) continue;
      if (d > 0) { up++; if (d > maxUp) maxUp = d; }
      else if (d < 0) down++;
      else same++;
    }
    maxPrice = Math.max(...newVals, 0);
    const noDown = down === 0 ? '（本起点无降价）' : '';
    document.getElementById('status-bar').textContent =
      `${stationName} → 全网 ${codes.length} 站 | 涨价 ${up} · 不变 ${same} · 降价 ${down}${noDown} | 单站最高涨价 +${maxUp} 元`;
  } else {
    const active = scheme === 'old' ? oldVals : newVals;
    maxPrice = active.length > 0 ? Math.max(...active) : 15;
    document.getElementById('status-bar').textContent =
      `${stationName} → 全网 ${codes.length} 站 | ${SCHEME_LABEL[scheme]}最高 ${maxPrice} 元`;
  }
  renderDots();
}

async function queryPrices(originCode) {
  const loading = document.getElementById('loading');
  const statusBar = document.getElementById('status-bar');
  const stationName = allStations.find((s) => s.code === originCode)?.name || originCode;
  loading.style.display = 'inline';
  statusBar.textContent = `查询 ${stationName} 到全网的新旧票价...`;

  try {
    let data;
    try {
      const resp = await fetch(`data/prices/${originCode}.json`);
      if (!resp.ok) throw new Error('static missing');
      data = await resp.json();
    } catch {
      const resp = await fetch(`api/prices/${originCode}`);
      const api = await resp.json();
      data = {
        old: api.old || api.schemes?.current || api.prices,
        new: api.new || api.schemes?.new,
      };
    }
    if (!data.old || !data.new) throw new Error('数据不完整');

    fareData = { old: data.old, new: data.new };
    currentOrigin = originCode;
    document.getElementById('scheme-btn').style.display = 'inline-flex';
    document.getElementById('btn-save').disabled = false;
    setScheme('new');
  } catch (err) {
    statusBar.textContent = '查询失败: ' + err.message;
  } finally {
    loading.style.display = 'none';
  }
}

function renderDots() {
  const ov = document.getElementById('overlay-svg');
  if (!ov) return;
  const g = ov.querySelector('#overlay-dots');
  g.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const tooltip = document.getElementById('tooltip');
  tooltip.style.display = 'none';

  for (const s of visibleStations()) {
    const coord = stationCoords[s.code];
    if (!coord) continue;
    const isOrigin = s.code === currentOrigin;

    if (isOrigin) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', coord.x); circle.setAttribute('cy', coord.y);
      circle.setAttribute('r', 16);
      circle.setAttribute('fill', '#E6002E'); circle.setAttribute('stroke', '#333');
      circle.setAttribute('stroke-width', '3');
      g.appendChild(circle);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', coord.x); t.setAttribute('y', coord.y + 5);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '14');
      t.setAttribute('fill', '#fff'); t.setAttribute('font-weight', '900');
      t.setAttribute('font-family', 'Arial, sans-serif');
      t.textContent = '起';
      g.appendChild(t);
      continue;
    }

    if (!fareData) continue;
    const oldPrice = fareData.old[s.code];
    const newPrice = fareData.new[s.code];
    if (oldPrice == null || newPrice == null) continue;

    let label, fill, stroke, textColor;
    if (currentScheme === 'diff') {
      const d = Number(newPrice) - Number(oldPrice);
      const color = diffColor(d);
      fill = color.fill; stroke = color.stroke; textColor = color.text;
      label = d > 0 ? `+${d}` : String(d);
    } else {
      label = String(currentScheme === 'old' ? oldPrice : newPrice);
      fill = currentScheme === 'old' ? '#fff' : '#e8f3ff';
      stroke = currentScheme === 'old' ? '#0a2540' : '#0a6fb5';
      textColor = '#0a2540';
    }

    const showTip = (e) => {
      const el = document.getElementById('tooltip');
      const d = Number(newPrice) - Number(oldPrice);
      const sign = d > 0 ? `+${d}` : String(d);
      el.innerHTML = `<b>${s.name}</b><br>现行 ${oldPrice} 元 → 新 ${newPrice} 元（${d === 0 ? '不变' : sign + ' 元'}）`;
      el.style.display = 'block';
      const r = el.getBoundingClientRect();
      el.style.left = (e.clientX - r.width / 2) + 'px';
      el.style.top = (e.clientY - r.height - 14) + 'px';
    };
    const hideTip = () => { document.getElementById('tooltip').style.display = 'none'; };

    // 透明热区：比可见圆点大，方便在地图上直接点站名附近选中
    const hit = document.createElementNS(ns, 'circle');
    hit.setAttribute('cx', coord.x);
    hit.setAttribute('cy', coord.y);
    hit.setAttribute('r', 32);
    hit.setAttribute('data-code', s.code);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.style.cursor = 'pointer';
    hit.addEventListener('mouseenter', (e) => {
      hit.setAttribute('r', 36);
      showTip(e);
    });
    hit.addEventListener('mousemove', moveTooltip);
    hit.addEventListener('mouseleave', () => {
      hit.setAttribute('r', 32);
      hideTip();
    });
    g.appendChild(hit);

    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', coord.x);
    circle.setAttribute('cy', coord.y);
    circle.setAttribute('r', 13);
    circle.setAttribute('data-code', s.code);
    circle.setAttribute('fill', fill);
    circle.setAttribute('stroke', stroke);
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('pointer-events', 'none');
    g.appendChild(circle);

    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', coord.x);
    t.setAttribute('y', coord.y + 4.5);
    t.setAttribute('data-code', s.code);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', currentScheme === 'diff' ? '12' : '15');
    t.setAttribute('fill', textColor);
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', 'Arial, sans-serif');
    t.setAttribute('pointer-events', 'none');
    t.textContent = label;
    g.appendChild(t);
  }
}

function moveTooltip(e) {
  const el = document.getElementById('tooltip');
  const r = el.getBoundingClientRect();
  el.style.left = (e.clientX - r.width / 2) + 'px';
  el.style.top = (e.clientY - r.height - 14) + 'px';
}

async function savePriceImage() {
  if (!currentOrigin || !fareData) return;
  const scale = 2;
  const W = Math.round(SVG_W * scale), H = Math.round(SVG_H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // 静态线网底图（与页面显示一致）
  try {
    const bg = new Image();
    await new Promise((resolve, reject) => {
      bg.onload = resolve;
      bg.onerror = reject;
      bg.src = 'images/linesh.svg';
    });
    ctx.drawImage(bg, 0, 0, W, H);
  } catch { /* 底图加载失败时保留白底 */ }

  const origin = allStations.find((s) => s.code === currentOrigin);

  for (const s of visibleStations()) {
    const coord = stationCoords[s.code];
    if (!coord) continue;
    const isOrigin = s.code === currentOrigin;

    if (isOrigin) {
      ctx.beginPath();
      ctx.arc(coord.x * scale, coord.y * scale, 16 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#E6002E'; ctx.fill();
      ctx.lineWidth = 3 * scale; ctx.strokeStyle = '#333'; ctx.stroke();
      ctx.font = `900 ${14 * scale}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText('起', coord.x * scale, coord.y * scale);
      continue;
    }

    const oldPrice = fareData.old[s.code];
    const newPrice = fareData.new[s.code];
    if (oldPrice == null || newPrice == null) continue;

    let label, fill, stroke, textColor;
    if (currentScheme === 'diff') {
      const d = Number(newPrice) - Number(oldPrice);
      const color = diffColor(d);
      fill = color.fill; stroke = color.stroke; textColor = color.text;
      label = d > 0 ? `+${d}` : String(d);
    } else {
      label = String(currentScheme === 'old' ? oldPrice : newPrice);
      fill = currentScheme === 'old' ? '#fff' : '#e8f3ff';
      stroke = currentScheme === 'old' ? '#0a2540' : '#0a6fb5';
      textColor = '#0a2540';
    }

    ctx.beginPath();
    ctx.arc(coord.x * scale, coord.y * scale, 13 * scale, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 2 * scale; ctx.strokeStyle = stroke; ctx.stroke();
    ctx.font = `700 ${(currentScheme === 'diff' ? 12 : 15) * scale}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.fillText(label, coord.x * scale, (coord.y + 1) * scale);
  }

  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${origin.name}_新旧票价_${SCHEME_LABEL[currentScheme]}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

document.addEventListener('DOMContentLoaded', init);
