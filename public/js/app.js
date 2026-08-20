const SVG_W = 2638.57, SVG_H = 3692.52;
let allStations = [];
let stationCoords = {};
let currentPrices = null;    // 现行票价（兼容旧逻辑；{code: 字符串 或 {normal,fast}}）
let schemePrices = null;     // 三套：{ current, scheme1, scheme2 } 均为 {code: 数字}
let currentScheme = 'current';
let currentOrigin = null;
let maxPrice = 15;
let zoomLevel = 1;
let panX = 0, panY = 0;
let isDragging = false, dragStartX, dragStartY;

const SCHEME_LABEL = { current: '现行价', scheme1: '方案一', scheme2: '方案二', combo: '三合一' };

const LINE_ORDER = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','41','51'];

function getLineName(code) {
  const p = code.substring(0, 2), m = { '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线' };
  return m[p] || '其他';
}

function getLineOrder(line) {
  const idx = LINE_ORDER.indexOf(line);
  return idx === -1 ? 99 : idx;
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
    rs = await fetch('/data/stations.json');
    if (!rs.ok) throw new Error('static missing');
  } catch {
    rs = await fetch('/api/stations');
  }
  allStations = await rs.json();
  const rc = await fetch('/stations-coords.json');
  const raw = await rc.json();
  for (const s of raw) stationCoords[s.code] = s;

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

  document.getElementById('app-title').addEventListener('click', resetState);
  document.getElementById('btn-save').addEventListener('click', savePriceImage);

  // 方案切换：仅切换显示，不改动已查数据
  document.querySelectorAll('.scheme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!schemePrices) return;
      setScheme(btn.dataset.scheme);
    });
  });

  setupZoomPan();
  createOverlay();
  fitToView();
  renderDots();

  const helpText = document.querySelector('.help-text');
  if (helpText) {
    setTimeout(() => helpText.classList.add('hide-help'), 3000);
  }
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
  if (!currentPrices) fitToView();
});

function resetState() {
  currentPrices = null;
  schemePrices = null;
  currentScheme = 'current';
  currentOrigin = null;
  document.querySelectorAll('.scheme-btn').forEach((b) => b.classList.toggle('active', b.dataset.scheme === 'current'));
  document.getElementById('scheme-btn').style.display = 'none';
  const lineSelect = document.getElementById('line-select');
  const stationSelect = document.getElementById('station-select');
  lineSelect.value = '';
  stationSelect.innerHTML = '';
  stationSelect.disabled = true;
  const first = document.createElement('option');
  first.value = ''; first.textContent = '— 选择站点 —';
  stationSelect.appendChild(first);
  document.getElementById('status-bar').textContent = '选择起始站 → 显示到各站票价';
  document.getElementById('btn-save').disabled = true;
  renderDots();
}

function setupZoomPan() {
  const wrap = document.getElementById('map-wrap');
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
    if (e.button === 0) { isDragging = true; dragStartX = e.clientX - panX; dragStartY = e.clientY - panY; wrap.style.cursor = 'grabbing'; }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX; panY = e.clientY - dragStartY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; document.getElementById('map-wrap').style.cursor = 'grab'; } });

  // ===== 触摸支持：单指平移、双指缩放 =====
  let pinchDist = 0, pinchZoom = 1;
  const isTouch = ('ontouchstart' in window);

  wrap.addEventListener('touchstart', (e) => {
    if (e.target.closest('.calibrate-dot') || e.target.closest('#overlay-dots circle')) return;
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
      panX = e.touches[0].clientX - dragStartX;
      panY = e.touches[0].clientY - dragStartY;
      applyTransform();
    }
  }, { passive: false });

  const endTouch = () => { if (isDragging) isDragging = false; pinchDist = 0; };
  wrap.addEventListener('touchend', endTouch);
  wrap.addEventListener('touchcancel', endTouch);
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
  img.src = '/images/linesh.svg';
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

function setScheme(scheme) {
  if (!schemePrices) return;
  currentScheme = scheme;
  document.querySelectorAll('.scheme-btn').forEach((b) => b.classList.toggle('active', b.dataset.scheme === scheme));
  const stationName = allStations.find(s => s.code === currentOrigin)?.name || currentOrigin;
  if (scheme === 'combo') {
    const counts = [];
    const maxes = [];
    for (const s of ['current', 'scheme1', 'scheme2']) {
      if (!schemePrices[s]) continue;
      const vals = Object.values(schemePrices[s]).map(v => Number(v)).filter(v => v > 0);
      maxes.push(Math.max(...vals));
      counts.push(Object.keys(schemePrices[s]).length);
    }
    maxPrice = Math.max(...maxes);
    document.getElementById('status-bar').textContent = `${stationName} → 全网 ${Math.max(...counts)} 站 | 三合一 现行最高 ${maxes[0]} / 方案一 ${maxes[1]} / 方案二 ${maxes[2]} 元`;
  } else {
    const activePrices = schemePrices[scheme];
    const vals = Object.values(activePrices).map((v) => Number(v)).filter(v => v > 0);
    maxPrice = vals.length > 0 ? Math.max(...vals) : 15;
    document.getElementById('status-bar').textContent = `${stationName} → 全网 ${Object.keys(activePrices).length} 站 | ${SCHEME_LABEL[scheme]} 最高 ${maxPrice} 元`;
  }
  renderDots();
}

async function queryPrices(originCode) {
  const loading = document.getElementById('loading');
  const statusBar = document.getElementById('status-bar');
  const stationName = allStations.find(s => s.code === originCode)?.name || originCode;
  loading.style.display = 'inline';
  statusBar.textContent = `查询 ${stationName} 到全网的票价...`;

  try {
    let resp;
    try {
      resp = await fetch(`/data/prices/${originCode}.json`);
      if (!resp.ok) throw new Error('static missing');
    } catch {
      resp = await fetch(`/api/prices/${originCode}`);
    }
    const data = await resp.json();
    currentPrices = data.prices;
    schemePrices = data.schemes || { current: data.prices };
    currentScheme = 'current';
    document.querySelectorAll('.scheme-btn').forEach((b) => b.classList.toggle('active', b.dataset.scheme === 'current'));
    document.getElementById('scheme-btn').style.display = 'inline-flex';
    currentOrigin = originCode;
    document.getElementById('btn-save').disabled = false;
    const activePrices = schemePrices[currentScheme] || currentPrices;
    const vals = Object.values(activePrices).map((v) => {
      if (v !== null && typeof v === 'object') return Math.max(Number(v.normal), Number(v.fast || v.normal));
      return Number(v);
    }).filter(v => v > 0);
    maxPrice = vals.length > 0 ? Math.max(...vals) : 15;
    renderDots();
    statusBar.textContent = `${stationName} → 全网 ${Object.keys(activePrices).length} 站，最高 ${maxPrice} 元`;
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

  for (const s of allStations) {
    const coord = stationCoords[s.code];
    if (!coord || coord.hidden) continue;
    const isOrigin = s.code === currentOrigin;

    // ===== 三合一模式：竖排三段标签（现行/方案一/方案二） =====
    if (currentScheme === 'combo' && schemePrices) {
      const segs = ['current', 'scheme1', 'scheme2'].map((k) => {
        const v = schemePrices[k] ? schemePrices[k][s.code] : null;
        return v === null || v === undefined ? null : Number(v);
      });
      if (isOrigin) {
        // 起点用大圆红点
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', coord.x); circle.setAttribute('cy', coord.y);
        circle.setAttribute('r', 16); circle.style.cursor = 'pointer';
        circle.setAttribute('fill', '#E6002E'); circle.setAttribute('stroke', '#333');
        circle.setAttribute('stroke-width', '3'); circle.setAttribute('pointer-events', 'auto');
        g.appendChild(circle);
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', coord.x); t.setAttribute('y', coord.y + 5);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '14');
        t.setAttribute('fill', '#fff'); t.setAttribute('font-weight', '900');
        t.setAttribute('font-family', 'Arial, sans-serif'); t.setAttribute('pointer-events', 'none');
        t.textContent = '起';
        g.appendChild(t);
        continue;
      }
      // 三段竖直标签
      const bw = 20, bh = 15, gap = 1;
      const topY = coord.y - (segs.length * (bh + gap)) / 2 + bh / 2;
      const colors = ['#fff', '#d6ecff', '#fff3b0'];
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('data-code', s.code);
      for (let i = 0; i < segs.length; i++) {
        const v = segs[i];
        const y = topY + i * (bh + gap);
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', coord.x - bw / 2);
        rect.setAttribute('y', y - bh / 2);
        rect.setAttribute('width', bw);
        rect.setAttribute('height', bh);
        rect.setAttribute('fill', colors[i]);
        rect.setAttribute('stroke', '#333');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('pointer-events', 'auto');
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', () => setOriginFromCode(s.code));
        rect.addEventListener('mouseenter', (e) => {
          const el = document.getElementById('tooltip');
          const cur = segs[0], s1 = segs[1], s2 = segs[2];
          el.innerHTML = `<b>${s.name}</b><br>现行 ${cur}元 · 方案一 ${s1}元 · 方案二 ${s2}元`;
          el.style.display = 'block';
          const r = el.getBoundingClientRect();
          el.style.left = (e.clientX - r.width / 2) + 'px';
          el.style.top = (e.clientY - r.height - 14) + 'px';
        });
        rect.addEventListener('mousemove', moveTooltip);
        rect.addEventListener('mouseleave', () => document.getElementById('tooltip').style.display = 'none');
        group.appendChild(rect);
        if (v !== null && v !== undefined) {
          const t = document.createElementNS(ns, 'text');
          t.setAttribute('x', coord.x);
          t.setAttribute('y', y + 4.5);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-size', '11');
          t.setAttribute('fill', '#333');
          t.setAttribute('font-weight', '700');
          t.setAttribute('font-family', 'Arial, sans-serif');
          t.setAttribute('pointer-events', 'none');
          t.textContent = v;
          group.appendChild(t);
        }
      }
      g.appendChild(group);
      continue;
    }

    const activePrices = currentScheme === 'current' ? currentPrices : (schemePrices ? schemePrices[currentScheme] : null);
    const price = activePrices ? activePrices[s.code] : null;
    // 双价仅在现行票存在；{ normal, fast } 对象；单价为字符串/数字
    const isDual = currentScheme === 'current' && price !== null && price !== undefined && typeof price === 'object';
    const normal = isDual ? price.normal : price;
    const fast = isDual ? price.fast : null;

    if (!isOrigin && isDual && fast !== null) {
      // 双票价：左右两个圆圈，左普通（白底），右快速（浅黄底）
      const mk = (cx, fill, val) => {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', coord.y);
        circle.setAttribute('r', 12);
        circle.style.cursor = 'pointer';
        circle.setAttribute('fill', fill);
        circle.setAttribute('stroke', '#333');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('pointer-events', 'auto');
        circle.addEventListener('click', () => {
          const line = getLineName(s.code);
          document.getElementById('line-select').value = line;
          document.getElementById('line-select').dispatchEvent(new Event('change'));
          document.getElementById('station-select').value = s.code;
          queryPrices(s.code);
        });
        circle.addEventListener('mouseenter', (e) => {
          const el = document.getElementById('tooltip');
          el.innerHTML = `<b>${s.name}</b><br>普通 ${normal}元 · 快速 ${fast}元`;
          el.style.display = 'block';
          const r = el.getBoundingClientRect();
          el.style.left = (e.clientX - r.width / 2) + 'px';
          el.style.top = (e.clientY - r.height - 14) + 'px';
        });
        circle.addEventListener('mousemove', moveTooltip);
        circle.addEventListener('mouseleave', () => document.getElementById('tooltip').style.display = 'none');
        g.appendChild(circle);
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', cx);
        t.setAttribute('y', coord.y + 4.5);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '15');
        t.setAttribute('fill', '#333');
        t.setAttribute('font-weight', '700');
        t.setAttribute('font-family', 'Arial, sans-serif');
        t.setAttribute('pointer-events', 'none');
        t.textContent = val;
        g.appendChild(t);
      };
      mk(coord.x - 14, '#fff', normal);
      mk(coord.x + 14, '#FFF3B0', fast);
      continue;
    }

    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', coord.x);
    circle.setAttribute('cy', coord.y);
    circle.setAttribute('r', isOrigin ? 16 : 12);
    circle.style.cursor = 'pointer';
    circle.setAttribute('fill', isOrigin ? '#E6002E' : '#fff');
    circle.setAttribute('stroke', '#333');
    circle.setAttribute('stroke-width', isOrigin ? '3' : '2');
    circle.setAttribute('pointer-events', 'auto');

    if (!isOrigin) {
      const priceVal = normal !== undefined && normal !== null ? parseInt(normal) : null;
      circle.addEventListener('click', () => {
        const line = getLineName(s.code);
        document.getElementById('line-select').value = line;
        document.getElementById('line-select').dispatchEvent(new Event('change'));
        document.getElementById('station-select').value = s.code;
        queryPrices(s.code);
      });
      circle.addEventListener('mouseenter', (e) => {
        const el = document.getElementById('tooltip');
        el.innerHTML = priceVal !== null ? `<b>${s.name}</b><br>${normal}元` : `<b>${s.name}</b><br>点击设为起点`;
        el.style.display = 'block';
        const r = el.getBoundingClientRect();
        el.style.left = (e.clientX - r.width / 2) + 'px';
        el.style.top = (e.clientY - r.height - 14) + 'px';
      });
      circle.addEventListener('mousemove', moveTooltip);
      circle.addEventListener('mouseleave', () => document.getElementById('tooltip').style.display = 'none');
    }

    g.appendChild(circle);

    if (!isOrigin && normal !== undefined && normal !== null) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', coord.x);
      t.setAttribute('y', coord.y + 4.5);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '15');
      t.setAttribute('fill', '#333');
      t.setAttribute('font-weight', '700');
      t.setAttribute('font-family', 'Arial, sans-serif');
      t.setAttribute('pointer-events', 'none');
      t.textContent = normal;
      g.appendChild(t);
    }

    if (isOrigin) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', coord.x);
      t.setAttribute('y', coord.y + 5);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '14');
      t.setAttribute('fill', '#fff');
      t.setAttribute('font-weight', '900');
      t.setAttribute('font-family', 'Arial, sans-serif');
      t.setAttribute('pointer-events', 'none');
      t.textContent = '起';
      g.appendChild(t);
    }
  }
}

function moveTooltip(e) {
  const el = document.getElementById('tooltip');
  const r = el.getBoundingClientRect();
  el.style.left = (e.clientX - r.width / 2) + 'px';
  el.style.top = (e.clientY - r.height - 14) + 'px';
}

async function savePriceImage() {
  if (!currentOrigin || !schemePrices) return;
  const scale = 2;
  const W = Math.round(SVG_W * scale), H = Math.round(SVG_H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = new Image();
  await new Promise((resolve, reject) => {
    bg.onload = resolve;
    bg.onerror = reject;
    bg.src = '/images/linesh.svg';
  });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bg, 0, 0, W, H);

  const origin = allStations.find(s => s.code === currentOrigin);
  const isCombo = currentScheme === 'combo';
  const activePrices = isCombo ? null : (currentScheme === 'current' ? currentPrices : (schemePrices ? schemePrices[currentScheme] : null));
  for (const s of allStations) {
    const coord = stationCoords[s.code];
    if (!coord || coord.hidden) continue;
    const isOrigin = s.code === currentOrigin;

    // 三合一：三段竖直标签
    if (isCombo && schemePrices) {
      const segs = ['current', 'scheme1', 'scheme2'].map((k) => {
        const v = schemePrices[k] ? schemePrices[k][s.code] : null;
        return v === null || v === undefined ? null : Number(v);
      });
      if (isOrigin) {
        ctx.beginPath();
        ctx.arc(coord.x * scale, coord.y * scale, 16 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#E6002E'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#333'; ctx.stroke();
        ctx.font = `900 ${14 * scale}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText('起', coord.x * scale, coord.y * scale);
        continue;
      }
      const bw = 20, bh = 15, gap = 1;
      const colors = ['#fff', '#d6ecff', '#fff3b0'];
      const topY = coord.y - (segs.length * (bh + gap)) / 2 + bh / 2;
      for (let i = 0; i < segs.length; i++) {
        const v = segs[i];
        const y = topY + i * (bh + gap);
        ctx.beginPath();
        ctx.rect((coord.x - bw / 2) * scale, (y - bh / 2) * scale, bw * scale, bh * scale);
        ctx.fillStyle = colors[i]; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#333'; ctx.stroke();
        if (v !== null && v !== undefined) {
          ctx.font = `700 ${11 * scale}px Arial, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#333';
          ctx.fillText(v, coord.x * scale, (y + 1) * scale);
        }
      }
      continue;
    }

    const price = activePrices[s.code];
    if (price === undefined || price === null) continue;
    const isDual = currentScheme === 'current' && typeof price === 'object';
    const normal = isDual ? price.normal : price;
    const fast = isDual ? price.fast : null;

    const draw = (cx, cy, r, fill, val, fontSize, textY) => {
      ctx.beginPath();
      ctx.arc(cx * scale, cy * scale, r * scale, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = isOrigin ? 3 : 2;
      ctx.strokeStyle = '#333';
      ctx.stroke();
      if (val !== undefined && val !== null) {
        ctx.font = `700 ${fontSize * scale}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isOrigin ? '#fff' : '#333';
        ctx.fillText(val, cx * scale, (cy + textY) * scale);
      }
    };

    if (!isOrigin && isDual && fast !== null) {
      draw(coord.x - 14, coord.y, 12, '#fff', normal, 15, 0);
      draw(coord.x + 14, coord.y, 12, '#FFF3B0', fast, 15, 0);
    } else {
      draw(coord.x, coord.y, isOrigin ? 16 : 12, isOrigin ? '#E6002E' : '#fff', isOrigin ? '起' : normal, isOrigin ? 14 : 15, 0);
    }
  }

  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${origin.name}_${SCHEME_LABEL[currentScheme]}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

document.addEventListener('DOMContentLoaded', init);