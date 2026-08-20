const SVG_W = 2638.57, SVG_H = 3692.52;
let allStations = [];
let originalCoords = {};
let currentCoords = {};
let modifiedCoords = {};
let svgExtracted = [];
let stationGroups = [];
let zoomLevel = 0.5, panX = 0, panY = 0;
let isPanning = false, panStartX, panStartY;
let dragTarget = null, dragStartSVG = null, dragOrigPos = null;
let dotSize = 10;

function ns(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

function getLineName(code) {
  const p = code.substring(0, 2);
  const m = {'01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线'};
  return m[p] || '其他';
}

function screenToSVG(sx, sy) {
  const svg = document.getElementById('overlay-svg');
  if (!svg) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = sx; pt.y = sy;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return pt.matrixTransform(ctm.inverse());
}

function getTranslateOffset(el) {
  let tx = 0, ty = 0;
  while (el && el.tagName !== 'svg' && el !== document.documentElement) {
    const tr = el.getAttribute('transform');
    if (tr) {
      const m = tr.match(/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/);
      if (m) { tx += parseFloat(m[1]); ty += parseFloat(m[2]); }
    }
    el = el.parentElement || el.parentNode;
  }
  return { tx, ty };
}

function updateStatus(msg) {
  document.getElementById('status').textContent = msg || '';
}

function applyTransform() {
  const el = document.getElementById('canvas-content');
  if (el) el.style.transform = `translate(${panX}px,${panY}px) scale(${zoomLevel})`;
}

function setupZoomPan() {
  const wrap = document.getElementById('canvas-wrap');
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const old = zoomLevel;
    zoomLevel *= e.deltaY < 0 ? 1.12 : 0.89;
    zoomLevel = Math.max(0.1, Math.min(zoomLevel, 5));
    const f = zoomLevel / old;
    panX = mx - (mx - panX) * f;
    panY = my - (my - panY) * f;
    applyTransform();
  }, { passive: false });

  wrap.addEventListener('mousedown', (e) => {
    if (e.target.closest('.calibrate-dot')) return;
    if (e.button === 0) {
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      wrap.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      document.getElementById('canvas-wrap').style.cursor = 'grab';
    }
  });
}

function createOverlay() {
  const content = document.getElementById('canvas-content');
  const svg = ns('svg', { id: 'overlay-svg', viewBox: `0 0 ${SVG_W} ${SVG_H}` });
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  svg.innerHTML = '<g id="dots-svg-layer"></g><g id="dots-current-layer"></g><g id="labels-layer"></g>';
  content.appendChild(svg);
}

function renderCurrentDots() {
  const g = document.getElementById('dots-current-layer');
  g.innerHTML = '';
  for (const grp of stationGroups) {
    const circle = ns('circle', {
      cx: grp.x, cy: grp.y, r: dotSize,
      class: 'calibrate-dot', 'data-name': grp.name, 'data-code': grp.codes[0]
    });
    circle.style.pointerEvents = 'auto';
    circle.addEventListener('mousedown', onDotMouseDown);
    circle.addEventListener('mouseenter', onDotEnter);
    circle.addEventListener('mouseleave', onDotLeave);
    g.appendChild(circle);
  }
}

function renderSVGDots() {
  // 已移除：不再渲染SVG提取的蓝色圆点
}

function renderLabels() {
  const g = document.getElementById('labels-layer');
  g.innerHTML = '';
  if (!document.getElementById('chk-labels').checked) return;
  for (const grp of stationGroups) {
    const t = ns('text', {
      x: grp.x, y: grp.y - dotSize - 3,
      class: 'station-label', 'text-anchor': 'middle'
    });
    t.textContent = grp.name;
    g.appendChild(t);
  }
}

function onDotEnter(e) {
  const code = e.target.getAttribute('data-code');
  const grp = stationGroups.find(g => g.codes[0] === code);
  if (!grp) return;
  const mod = modifiedCoords[code];
  const tip = document.getElementById('tooltip');
  let html = `<b>${grp.name}</b>${grp.codes.length > 1 ? ` <span style="color:#aaa">(${grp.codes.length}条记录)</span>` : ''}<br>当前: (${Math.round(grp.x)}, ${Math.round(grp.y)})<br>线路: ${grp.codes.map(c => getLineName(c)).join('、')}`;
  if (mod) html += `<br style="color:#0f0">偏移: Δ(${mod.dx.toFixed(1)}, ${mod.dy.toFixed(1)})`;
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 15) + 'px';
  tip.style.top = (e.clientY - 10) + 'px';
}

function onDotLeave() {
  document.getElementById('tooltip').style.display = 'none';
}

function onDotMouseDown(e) {
  e.stopPropagation();
  e.preventDefault();
  dragTarget = e.target;
  dragTarget.classList.add('dragging');
  dragStartSVG = screenToSVG(e.clientX, e.clientY);
  dragOrigPos = {
    x: parseFloat(dragTarget.getAttribute('cx')),
    y: parseFloat(dragTarget.getAttribute('cy'))
  };
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!dragTarget) return;
  const cur = screenToSVG(e.clientX, e.clientY);
  const dx = cur.x - dragStartSVG.x;
  const dy = cur.y - dragStartSVG.y;
  const nx = dragOrigPos.x + dx;
  const ny = dragOrigPos.y + dy;
  dragTarget.setAttribute('cx', nx);
  dragTarget.setAttribute('cy', ny);

  let ind = document.getElementById('drag-indicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'drag-indicator';
    document.body.appendChild(ind);
  }
  ind.style.left = (e.clientX + 15) + 'px';
  ind.style.top = (e.clientY + 15) + 'px';
  ind.textContent = `dx: ${dx.toFixed(1)}  dy: ${dy.toFixed(1)}`;
  ind.style.display = 'block';
}

function onDragEnd(e) {
  if (!dragTarget) return;
  const code = dragTarget.getAttribute('data-code');
  const grp = stationGroups.find(g => g.codes[0] === code);
  if (grp) {
    const nx = parseFloat(dragTarget.getAttribute('cx'));
    const ny = parseFloat(dragTarget.getAttribute('cy'));
    const orig = originalCoords[grp.codes[0]];
    for (const code of grp.codes) {
      modifiedCoords[code] = { x: nx, y: ny, dx: nx - orig.x, dy: ny - orig.y };
      currentCoords[code] = { x: nx, y: ny };
    }
    grp.x = nx;
    grp.y = ny;
  }
  dragTarget.classList.remove('dragging');
  dragTarget = null;
  document.getElementById('drag-indicator').style.display = 'none';
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  renderLabels();
  updateStatus(`已修改 ${Object.keys(modifiedCoords).length} 条站点记录`);
  document.getElementById('btn-save').disabled = false;
  document.getElementById('btn-reset').disabled = false;
}

function extractStationsFromSVG(svgEl) {
  const results = [];
  const nameToCode = {};
  for (const s of allStations) nameToCode[s.name] = s.code;

  const tspans = svgEl.querySelectorAll('tspan');
  const seen = new Map();

  for (const tspan of tspans) {
    const text = tspan.textContent.trim();
    if (!text || !/[\u4e00-\u9fa5]/.test(text)) continue;
    const parentText = tspan.closest('text');
    if (!parentText) continue;
    const style = parentText.getAttribute('style') || '';
    if (!style.includes('font-size')) continue;

    const code = nameToCode[text];
    if (!code) continue;
    if (seen.has(code)) continue;

    let x = parseFloat(tspan.getAttribute('x')) || parseFloat(parentText.getAttribute('x')) || 0;
    let y = parseFloat(tspan.getAttribute('y')) || parseFloat(parentText.getAttribute('y')) || 0;
    const offset = getTranslateOffset(parentText);
    x += offset.tx;
    y += offset.ty;

    seen.set(code, true);
    results.push({ code, name: text, svgX: Math.round(x * 100) / 100, svgY: Math.round(y * 100) / 100 });
  }
  return results;
}

async function loadAndParseSVG() {
  const btn = document.getElementById('btn-load');
  btn.disabled = true;
  updateStatus('正在加载SVG...');

  try {
    const resp = await fetch('/images/linesh.svg');
    const svgText = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.documentElement;

    const content = document.getElementById('canvas-content');
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('id', 'bg-svg');
    svgEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    content.insertBefore(svgEl, content.firstChild);

    updateStatus('正在提取站点坐标...');
    svgExtracted = extractStationsFromSVG(svgEl);
    updateStatus(`从SVG提取了 ${svgExtracted.length} 个站点`);

    renderSVGDots();
    renderLabels();
    document.getElementById('btn-save').disabled = false;
    document.getElementById('btn-reset').disabled = false;
  } catch (err) {
    updateStatus('加载失败: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function exportResults() {
  const result = allStations.map(s => {
    const mod = modifiedCoords[s.code];
    const orig = originalCoords[s.code];
    if (!orig) return null;
    return {
      code: s.code,
      name: s.name,
      x: mod ? Math.round(mod.x * 100) / 100 : orig.x,
      y: mod ? Math.round(mod.y * 100) / 100 : orig.y,
      ...(orig.hidden ? { hidden: true } : {})
    };
  }).filter(Boolean);
  result.sort((a, b) => a.code.localeCompare(b.code));
  const json = JSON.stringify(result, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'stations-coords.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  updateStatus(`已导出 ${result.length} 个站点坐标 (${Object.keys(modifiedCoords).length} 个已校准)`);
}

function resetAll() {
  for (const code of Object.keys(modifiedCoords)) {
    currentCoords[code] = { ...originalCoords[code] };
  }
  for (const grp of stationGroups) {
    grp.x = originalCoords[grp.codes[0]].x;
    grp.y = originalCoords[grp.codes[0]].y;
  }
  modifiedCoords = {};
  renderCurrentDots();
  renderLabels();
  document.getElementById('btn-save').disabled = true;
  document.getElementById('btn-reset').disabled = true;
  updateStatus('已重置所有修改');
}

async function init() {
  const rs = await fetch('/api/stations');
  allStations = await rs.json();
  const rc = await fetch('/stations-coords.json');
  const raw = await rc.json();
  for (const s of raw) {
    originalCoords[s.code] = { x: s.x, y: s.y, hidden: !!s.hidden };
    currentCoords[s.code] = { x: s.x, y: s.y };
  }

  // 按（名称+坐标）分组：同坐标同名站合并（共用点），不同坐标同名站独立（如机场线独立站）
  const byKey = {};
  for (const s of raw) {
    const key = `${s.name}@${s.x},${s.y}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(s.code);
  }
  stationGroups = Object.keys(byKey).map(key => {
    const name = key.slice(0, key.indexOf('@'));
    const codes = byKey[key];
    const first = codes[0];
    return {
      name,
      codes,
      x: originalCoords[first].x,
      y: originalCoords[first].y
    };
  });
  stationGroups.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  setupZoomPan();
  createOverlay();
  renderCurrentDots();

  const content = document.getElementById('canvas-content');
  const cw = document.getElementById('canvas-wrap').clientWidth;
  const ch = document.getElementById('canvas-wrap').clientHeight;
  zoomLevel = Math.min(cw / SVG_W, ch / SVG_H) * 0.9;
  panX = (cw - SVG_W * zoomLevel) / 2;
  panY = (ch - SVG_H * zoomLevel) / 2;
  applyTransform();

  updateStatus(`已加载 ${stationGroups.length} 个站名分组 (${allStations.length} 个站点记录)，点击"加载并解析SVG"开始校准`);

  document.getElementById('btn-load').addEventListener('click', loadAndParseSVG);
  document.getElementById('btn-save').addEventListener('click', exportResults);
  document.getElementById('btn-reset').addEventListener('click', resetAll);
  document.getElementById('chk-labels').addEventListener('change', renderLabels);
  document.getElementById('chk-current').addEventListener('change', (e) => {
    document.getElementById('dots-current-layer').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('dot-size').addEventListener('input', (e) => {
    dotSize = parseInt(e.target.value);
    renderCurrentDots();
    renderSVGDots();
    renderLabels();
  });
}

document.addEventListener('DOMContentLoaded', init);