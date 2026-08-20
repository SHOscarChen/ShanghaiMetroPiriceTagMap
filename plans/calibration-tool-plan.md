# 站点坐标校准工具 - 完整实现计划

## 项目背景

当前 `stations-coords.json` 中的坐标由 `buildData.js` 从 `metromap.json`（GIS百分比坐标）生成，与 `linesh.svg`（Inkscape矢量图）的实际视觉位置存在系统性偏差。需要创建一个交互式校准工具来修正坐标。

---

## 一、目标文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `public/calibrate.html` | 新建 | 校准工具主页面 |
| `public/css/calibrate.css` | 新建 | 校准工具样式 |
| `public/js/calibrate.js` | 新建 | 校准工具核心逻辑 |

**不影响现有文件**：主应用 `app.js`、`index.html` 保持不变。

---

## 二、页面结构设计

### 2.1 calibrate.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>站点坐标校准工具</title>
  <link rel="stylesheet" href="/css/calibrate.css">
</head>
<body>
  <!-- 顶部工具栏 -->
  <div class="toolbar">
    <h1>站点坐标校准</h1>
    <div class="toolbar-controls">
      <button id="btn-load">加载并解析SVG</button>
      <button id="btn-save" disabled>导出校准结果</button>
      <button id="btn-reset" disabled>重置所有修改</button>
      <span id="status">就绪 - 点击"加载并解析SVG"开始</span>
    </div>
    <div class="toolbar-options">
      <label><input type="checkbox" id="chk-labels" checked> 显示站名</label>
      <label><input type="checkbox" id="chk-current" checked> 显示当前坐标点(红)</label>
      <label><input type="checkbox" id="chk-svg"> 显示SVG提取点(蓝)</label>
      <label><input type="checkbox" id="chk-modified"> 仅显示已修改点</label>
      <label>圆点大小: <input type="range" id="dot-size" min="4" max="24" value="10"></label>
    </div>
  </div>

  <!-- 地图画布 -->
  <div id="canvas-wrap">
    <div id="canvas-content">
      <!-- SVG底图 + 叠加层动态创建 -->
    </div>
    <div class="help-text">滚轮缩放 · 拖拽平移 · 拖拽红色圆点校准位置</div>
  </div>

  <!-- 站点信息面板 -->
  <div id="info-panel" class="hidden">
    <div id="info-content"></div>
  </div>

  <!-- 工具提示 -->
  <div id="tooltip"></div>

  <script src="/js/calibrate.js"></script>
</body>
</html>
```

### 2.2 核心DOM结构

```
#canvas-wrap (容器, overflow:hidden, relative)
  └── #canvas-content (变换容器, transform-origin:0 0)
        ├── <svg> 底图层 (inline SVG from linesh.svg, pointer-events:none)
        ├── <svg id="overlay-svg"> 圆点叠加层
        │     ├── <g id="dots-current"> 红色圆点 (当前坐标)
        │     ├── <g id="dots-svg"> 蓝色圆点 (SVG提取坐标)
        │     └── <g id="labels"> 站名标签
        └── <div id="drag-indicator"> 拖拽偏移量指示器
```

---

## 三、核心功能实现

### 3.1 SVG加载与站点坐标提取

#### 3.1.1 加载SVG并内联

```javascript
async function loadSVGInline() {
  const resp = await fetch('/images/linesh.svg');
  const svgText = await resp.text();
  
  // 解析为DOM
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = svgDoc.documentElement;
  
  // 设置属性确保正确渲染
  svgEl.setAttribute('id', 'bg-svg');
  svgEl.style.cssText = 'width:100%;height:100%;pointer-events:none;';
  
  // 插入到canvas-content
  const content = document.getElementById('canvas-content');
  content.insertBefore(svgEl, content.firstChild);
}
```

#### 3.1.2 从SVG DOM提取站点坐标

**解析规则**（基于SVG结构分析）：

1. **识别中文站名元素**：
   - 查找所有 `<tspan>` 元素
   - 父级 `<text>` 的 `style` 包含 `font-size:17.3333px`（允许微小差异如16px、15.3333px）
   - 文本内容为中文字符

2. **计算实际坐标**：
   - 获取 `<tspan>` 的 `x`, `y` 属性
   - 向上遍历所有父级 `<g>` 元素
   - 累加所有 `transform="translate(X,Y)"` 的偏移量
   - 最终坐标 = `x + translateX`, `y + translateY`

3. **提取translate偏移**：
   ```javascript
   function getTranslateOffset(element) {
     let tx = 0, ty = 0;
     let el = element;
     while (el && el !== document.documentElement) {
       if (el.tagName === 'g' || el.tagName === 'svg') {
         const transform = el.getAttribute('transform');
         if (transform) {
           const match = transform.match(/translate\(([-\d.]+),?\s*([-\d.]+)\)/);
           if (match) {
             tx += parseFloat(match[1]);
             ty += parseFloat(match[2]);
           }
         }
       }
       el = el.parentElement;
     }
     return { tx, ty };
   }
   ```

4. **去重逻辑**：
   - 换乘站（如人民广场、徐家汇）会在多个线路图层重复出现
   - 使用 `Map<站名, 坐标[]>` 存储，最终取平均值或第一个匹配
   - 同时记录 `code`（通过站名匹配 `allStations`）

#### 3.1.3 匹配站点code

```javascript
// 站名 → code 的映射
const nameToCode = {};
for (const s of allStations) {
  nameToCode[s.name] = s.code;
}

// 从SVG提取的站点
const svgStations = []; // [{name, svgX, svgY}]
// ... 解析SVG填充 svgStations

// 关联code
for (const s of svgStations) {
  s.code = nameToCode[s.name];
}
```

### 3.2 渲染系统

#### 3.2.1 坐标系

| 层 | viewBox | 说明 |
|----|---------|------|
| SVG底图 | `0 0 2638.57 3692.52` | linesh.svg 原始viewBox |
| 叠加SVG | `0 0 2638.57 3692.52` | 与底图完全对齐 |

#### 3.2.2 渲染红色圆点（当前坐标）

```javascript
function renderCurrentDots() {
  const g = document.getElementById('dots-current');
  g.innerHTML = '';
  
  for (const station of allStations) {
    const coord = currentCoords[station.code];
    if (!coord) continue;
    
    const circle = createSVGElement('circle', {
      cx: coord.x,
      cy: coord.y,
      r: dotSize,
      class: 'calibrate-dot dot-current',
      'data-code': station.code
    });
    
    // 绑定拖拽事件
    circle.addEventListener('mousedown', startDrag);
    
    g.appendChild(circle);
  }
}
```

#### 3.2.3 渲染蓝色圆点（SVG提取坐标）

```javascript
function renderSVGDots() {
  const g = document.getElementById('dots-svg');
  g.innerHTML = '';
  
  for (const station of svgStations) {
    if (!station.code) continue;
    
    const circle = createSVGElement('circle', {
      cx: station.svgX,
      cy: station.svgY,
      r: dotSize,
      class: 'calibrate-dot dot-svg',
      'data-code': station.code
    });
    
    g.appendChild(circle);
  }
}
```

#### 3.2.4 渲染站名标签

```javascript
function renderLabels() {
  const g = document.getElementById('labels');
  g.innerHTML = '';
  
  for (const station of allStations) {
    const coord = currentCoords[station.code];
    if (!coord) continue;
    
    const text = createSVGElement('text', {
      x: coord.x,
      y: coord.y - dotSize - 4,
      class: 'station-label',
      'text-anchor': 'middle',
      'font-size': '12'
    });
    text.textContent = station.name;
    
    g.appendChild(text);
  }
}
```

### 3.3 缩放与平移

复用 `app.js` 的逻辑：

```javascript
let zoomLevel = 1;
let panX = 0, panY = 0;
let isPanning = false;

function setupZoomPan() {
  const wrap = document.getElementById('canvas-wrap');
  
  // 滚轮缩放
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const oldZoom = zoomLevel;
    zoomLevel *= e.deltaY < 0 ? 1.1 : 0.9;
    zoomLevel = Math.max(0.2, Math.min(zoomLevel, 4));
    
    const factor = zoomLevel / oldZoom;
    panX = mx - (mx - panX) * factor;
    panY = my - (my - panY) * factor;
    
    applyTransform();
  }, { passive: false });
  
  // 拖拽平移（在空白区域）
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap || e.target.id === 'canvas-content') {
      isPanning = true;
      // ... 记录起始位置
    }
  });
}

function applyTransform() {
  const content = document.getElementById('canvas-content');
  content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}
```

### 3.4 拖拽校准系统

#### 3.4.1 坐标转换

```javascript
function screenToSVG(screenX, screenY) {
  const svg = document.getElementById('overlay-svg');
  const pt = svg.createSVGPoint();
  pt.x = screenX;
  pt.y = screenY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
```

#### 3.4.2 拖拽流程

```javascript
let dragTarget = null;
let dragStartSVG = null;
let dragOriginalPos = null;

function startDrag(e) {
  e.stopPropagation();
  dragTarget = e.target;
  dragTarget.classList.add('dragging');
  
  // 记录SVG坐标系中的起始位置
  dragStartSVG = screenToSVG(e.clientX, e.clientY);
  dragOriginalPos = {
    x: parseFloat(dragTarget.getAttribute('cx')),
    y: parseFloat(dragTarget.getAttribute('cy'))
  };
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}

function onDrag(e) {
  if (!dragTarget) return;
  
  const currentSVG = screenToSVG(e.clientX, e.clientY);
  
  // 计算偏移量
  const dx = currentSVG.x - dragStartSVG.x;
  const dy = currentSVG.y - dragStartSVG.y;
  
  // 更新圆点位置
  const newX = dragOriginalPos.x + dx;
  const newY = dragOriginalPos.y + dy;
  
  dragTarget.setAttribute('cx', newX);
  dragTarget.setAttribute('cy', newY);
  
  // 显示偏移量指示
  showDragIndicator(e.clientX, e.clientY, dx, dy);
}

function endDrag(e) {
  if (!dragTarget) return;
  
  const code = dragTarget.getAttribute('data-code');
  const newX = parseFloat(dragTarget.getAttribute('cx'));
  const newY = parseFloat(dragTarget.getAttribute('cy'));
  
  // 记录修改
  const original = originalCoords[code];
  modifiedCoords[code] = {
    x: newX,
    y: newY,
    dx: newX - original.x,
    dy: newY - original.y
  };
  
  dragTarget.classList.remove('dragging');
  dragTarget = null;
  
  updateStatus();
  enableSaveButton();
}
```

### 3.5 数据导出

```javascript
function exportResults() {
  // 构建校准后的坐标数据
  const result = allStations.map(s => {
    const modified = modifiedCoords[s.code];
    const original = originalCoords[s.code];
    
    return {
      code: s.code,
      name: s.name,
      x: modified ? modified.x : original.x,
      y: modified ? modified.y : original.y
    };
  });
  
  // 按code排序
  result.sort((a, b) => a.code.localeCompare(b.code));
  
  // 触发下载
  const json = JSON.stringify(result, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stations-coords.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  updateStatus(`已导出 ${result.length} 个站点坐标`);
}
```

### 3.6 辅助功能

#### 3.6.1 偏移量可视化

```javascript
function showDragIndicator(screenX, screenY, dx, dy) {
  let indicator = document.getElementById('drag-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'drag-indicator';
    document.body.appendChild(indicator);
  }
  
  indicator.style.left = (screenX + 15) + 'px';
  indicator.style.top = (screenY + 15) + 'px';
  indicator.innerHTML = `Δx: ${dx.toFixed(1)}  Δy: ${dy.toFixed(1)}`;
  indicator.style.display = 'block';
}
```

#### 3.6.2 信息面板

```javascript
function showInfoPanel(code) {
  const panel = document.getElementById('info-panel');
  const content = document.getElementById('info-content');
  
  const station = allStations.find(s => s.code === code);
  const original = originalCoords[code];
  const modified = modifiedCoords[code];
  const svgCoord = svgStations.find(s => s.code === code);
  
  content.innerHTML = `
    <h3>${station.name} (${code})</h3>
    <p>当前坐标: (${original.x}, ${original.y})</p>
    ${svgCoord ? `<p>SVG提取: (${svgCoord.svgX}, ${svgCoord.svgY})</p>` : ''}
    ${modified ? `<p class="modified">已修改: Δ(${modified.dx.toFixed(1)}, ${modified.dy.toFixed(1)})</p>` : ''}
  `;
  
  panel.classList.remove('hidden');
}
```

---

## 四、样式设计 (calibrate.css)

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
  background: #1a1a1a; color: #fff; 
  display: flex; flex-direction: column; 
  height: 100vh; overflow: hidden; 
}

/* 工具栏 */
.toolbar {
  background: #2d2d2d; 
  padding: 10px 20px; 
  display: flex; align-items: center; gap: 20px; 
  flex-wrap: wrap;
  border-bottom: 1px solid #444;
}
.toolbar h1 { font-size: 16px; font-weight: 600; }
.toolbar-controls { display: flex; gap: 10px; align-items: center; }
.toolbar-options { display: flex; gap: 15px; font-size: 12px; }
.toolbar-options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }

button {
  padding: 6px 12px; border: none; border-radius: 4px;
  background: #E6002E; color: #fff; font-size: 12px;
  cursor: pointer; transition: background 0.2s;
}
button:hover { background: #cc0028; }
button:disabled { background: #666; cursor: not-allowed; }

#status { font-size: 12px; color: #aaa; margin-left: auto; }

/* 画布 */
#canvas-wrap {
  flex: 1; overflow: hidden; position: relative;
  background: #f5f5f5; cursor: grab;
}
#canvas-content {
  transform-origin: 0 0; 
  width: 2638.57px; height: 3692.52px;
  position: relative;
}
#canvas-content svg {
  position: absolute; top: 0; left: 0;
  width: 100%; height: 100%;
}

/* 圆点样式 */
.calibrate-dot {
  fill: rgba(230, 0, 46, 0.7);
  stroke: #fff; stroke-width: 1.5;
  cursor: move;
  transition: fill 0.15s, r 0.15s;
}
.calibrate-dot:hover { fill: rgba(255, 165, 0, 0.9); }
.calibrate-dot.dragging { fill: #ff0; stroke: #000; }
.dot-svg { fill: rgba(0, 120, 255, 0.5); }

/* 站名标签 */
.station-label {
  fill: #333; font-size: 11px;
  pointer-events: none;
  paint-order: stroke;
  stroke: #fff; stroke-width: 3px;
}

/* 帮助文本 */
.help-text {
  position: absolute; bottom: 12px; right: 12px;
  background: rgba(0,0,0,0.7); color: #fff;
  padding: 6px 10px; border-radius: 4px;
  font-size: 11px; pointer-events: none;
}

/* 信息面板 */
#info-panel {
  position: fixed; bottom: 40px; left: 20px;
  background: rgba(0,0,0,0.85); padding: 12px 16px;
  border-radius: 6px; font-size: 12px;
  min-width: 200px;
}
#info-panel.hidden { display: none; }
#info-panel h3 { margin-bottom: 8px; font-size: 14px; }
#info-panel p { margin: 4px 0; color: #ccc; }
#info-panel .modified { color: #0f0; }

/* 拖拽指示器 */
#drag-indicator {
  position: fixed; background: rgba(0,0,0,0.8);
  color: #0f0; padding: 4px 8px; border-radius: 3px;
  font-size: 11px; font-family: monospace;
  pointer-events: none; z-index: 200;
  display: none;
}

/* 工具提示 */
#tooltip {
  position: fixed; background: rgba(0,0,0,0.9);
  color: #fff; padding: 6px 10px; border-radius: 4px;
  font-size: 12px; pointer-events: none;
  z-index: 1000; white-space: nowrap;
  display: none;
}
```

---

## 五、初始化流程

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 加载站点数据
  const resp = await fetch('/api/stations');
  allStations = await resp.json();
  
  // 2. 加载当前坐标
  const coordResp = await fetch('/stations-coords.json');
  const coordData = await coordResp.json();
  for (const s of coordData) {
    currentCoords[s.code] = s;
    originalCoords[s.code] = { ...s }; // 保存原始值用于重置
  }
  
  // 3. 初始化渲染
  setupZoomPan();
  createOverlay();
  
  // 4. 绑定工具栏事件
  document.getElementById('btn-load').addEventListener('click', loadAndParseSVG);
  document.getElementById('btn-save').addEventListener('click', exportResults);
  document.getElementById('btn-reset').addEventListener('click', resetAll);
  
  // 5. 绑定选项事件
  document.getElementById('chk-labels').addEventListener('change', renderLabels);
  document.getElementById('chk-current').addEventListener('change', renderCurrentDots);
  document.getElementById('chk-svg').addEventListener('change', toggleSVGDots);
  document.getElementById('dot-size').addEventListener('input', updateDotSize);
});
```

---

## 六、实施步骤

| 步骤 | 任务 | 预估代码量 |
|------|------|-----------|
| 1 | 创建 `calibrate.html` 骨架 | ~40行 |
| 2 | 创建 `calibrate.css` 完整样式 | ~120行 |
| 3 | 创建 `calibrate.js` 并实现初始化和数据加载 | ~50行 |
| 4 | 实现SVG加载与内联 | ~30行 |
| 5 | 实现站点坐标提取（translate偏移累加） | ~80行 |
| 6 | 实现缩放平移功能 | ~60行 |
| 7 | 实现双层圆点渲染 | ~60行 |
| 8 | 实现拖拽交互与坐标转换 | ~100行 |
| 9 | 实现数据导出下载 | ~40行 |
| 10 | 实现辅助功能（标签、面板、指示器） | ~50行 |

**总计约 630 行代码**

---

## 七、验证清单

完成实施后需验证：

1. [ ] 打开 `http://localhost:3000/calibrate.html` 能正常加载
2. [ ] 点击"加载并解析SVG"后，底图正确显示
3. [ ] 红色圆点数量与 `stations-coords.json` 中站点数一致
4. [ ] 蓝色圆点（SVG提取）能正确显示
5. [ ] 拖拽红色圆点能平滑移动
6. [ ] 拖拽时偏移量指示器正确显示
7. [ ] 导出的 JSON 格式与原文件兼容
8. [ ] 主应用 `index.html` 使用导出的文件后显示正常
