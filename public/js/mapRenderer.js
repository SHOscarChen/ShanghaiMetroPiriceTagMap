const LINE_COLORS = {
  '1号线': '#E6002E', '2号线': '#96D000', '3号线': '#FCD700',
  '4号线': '#5A2E8A', '5号线': '#9C26B6', '6号线': '#D7006D',
  '7号线': '#F37021', '8号线': '#0098D3', '9号线': '#78C800',
  '10号线': '#C6A9D9', '11号线': '#871C2B', '12号线': '#007D65',
  '13号线': '#E998B3', '14号线': '#7B3A96', '15号线': '#BE8C3E',
  '16号线': '#98D1E3', '17号线': '#B87700', '18号线': '#D3A300',
  '浦江线': '#C0C0C0', '市域机场线': '#E2007A'
};

function getPriceColor(price, maxPrice) {
  const ratio = maxPrice > 0 ? price / maxPrice : 0;
  const r = Math.round(220 * ratio);
  const g = Math.round(220 * (1 - ratio));
  const b = Math.round(80 * (1 - ratio * 0.5));
  return `rgb(${r}, ${g}, ${b})`;
}

class MetroMapRenderer {
  constructor(svgEl) {
    this.svg = svgEl;
    this.ns = 'http://www.w3.org/2000/svg';
    this.mapData = null;
    this.stations = [];
    this.stationLookup = {};
    this.prices = null;
    this.originCode = null;
    this.maxPrice = 15;
    this.onStationClick = null;
  }

  async loadMapData() {
    const resp = await fetch('/api/map');
    this.mapData = await resp.json();
    this.stations = this.mapData.stations;
    for (const s of this.stations) {
      this.stationLookup[s.code] = s;
    }
  }

  async loadStations() {
    const resp = await fetch('/api/stations');
    this.stations = await resp.json();
    for (const s of this.stations) {
      this.stationLookup[s.code] = s;
    }
  }

  async loadPrices(originCode) {
    this.originCode = originCode;
    const resp = await fetch(`/api/prices/${originCode}`);
    const data = await resp.json();
    this.prices = data.prices;
    const vals = Object.values(this.prices).map(Number).filter(v => v > 0);
    this.maxPrice = vals.length > 0 ? Math.max(...vals) : 15;
  }

  render() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    if (!this.mapData) return;

    const vb = this.mapData.viewBox;
    this.svg.setAttribute('viewBox', vb);

    const defs = document.createElementNS(this.ns, 'defs');
    this.svg.appendChild(defs);

    const linesGroup = document.createElementNS(this.ns, 'g');
    linesGroup.setAttribute('id', 'lines');
    this.svg.appendChild(linesGroup);

    const stationsGroup = document.createElementNS(this.ns, 'g');
    stationsGroup.setAttribute('id', 'stations');
    this.svg.appendChild(stationsGroup);

    const labelsGroup = document.createElementNS(this.ns, 'g');
    labelsGroup.setAttribute('id', 'labels');
    this.svg.appendChild(labelsGroup);

    for (const line of this.mapData.lines) {
      const path = document.createElementNS(this.ns, 'path');
      path.setAttribute('d', line.path);
      path.setAttribute('class', 'line-path');
      path.setAttribute('stroke', LINE_COLORS[line.name] || '#999');
      linesGroup.appendChild(path);
    }

    const stationNodes = {};
    for (const s of this.stations) {
      const g = document.createElementNS(this.ns, 'g');
      g.setAttribute('data-code', s.code);

      const price = this.prices ? this.prices[s.code] : null;
      const radius = price !== undefined ? 10 : 6;
      const isOrigin = s.code === this.originCode;

      const circle = document.createElementNS(this.ns, 'circle');
      circle.setAttribute('cx', s.x);
      circle.setAttribute('cy', s.y);
      circle.setAttribute('r', isOrigin ? 14 : radius);
      circle.setAttribute('class', 'station-circle' + (isOrigin ? ' origin' : ''));
      if (price !== undefined && !isOrigin) {
        circle.setAttribute('fill', getPriceColor(Number(price), this.maxPrice));
        circle.setAttribute('fill-opacity', '0.85');
      } else if (isOrigin) {
        circle.setAttribute('fill', '#E6002E');
      } else {
        circle.setAttribute('fill', '#ccc');
        circle.setAttribute('fill-opacity', '0.5');
      }
      circle.setAttribute('stroke', isOrigin ? '#fff' : '#666');
      circle.setAttribute('stroke-width', isOrigin ? '3' : '1');

      circle.addEventListener('click', () => {
        if (this.onStationClick) this.onStationClick(s.code);
      });
      circle.addEventListener('mouseenter', (e) => showTooltip(e, s, price));
      circle.addEventListener('mousemove', moveTooltip);
      circle.addEventListener('mouseleave', hideTooltip);

      g.appendChild(circle);
      stationNodes[s.code] = g;

      if (price !== undefined && !isOrigin) {
        const text = document.createElementNS(this.ns, 'text');
        text.setAttribute('x', s.svgX);
        text.setAttribute('y', s.y + 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'price-label');
        text.setAttribute('fill', '#333');
        text.textContent = price + '元';
        g.appendChild(text);
      }

      if (isOrigin) {
        const text = document.createElementNS(this.ns, 'text');
        text.setAttribute('x', s.svgX);
        text.setAttribute('y', s.y + 24);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'price-label');
        text.setAttribute('fill', '#E6002E');
        text.setAttribute('font-size', '13px');
        text.textContent = '★ 起点';
        g.appendChild(text);
      }

      stationsGroup.appendChild(g);
    }
  }
}

function showTooltip(e, station, price) {
  const el = document.getElementById('tooltip');
  let html = `<b>${station.name}</b> (${station.code})`;
  if (price !== null && price !== undefined) {
    html += `<br>票价: ${price}元`;
  }
  el.innerHTML = html;
  el.style.display = 'block';
  const rect = el.getBoundingClientRect();
  el.style.left = (e.clientX - rect.width / 2) + 'px';
  el.style.top = (e.clientY - rect.height - 12) + 'px';
}

function moveTooltip(e) {
  const el = document.getElementById('tooltip');
  const rect = el.getBoundingClientRect();
  el.style.left = (e.clientX - rect.width / 2) + 'px';
  el.style.top = (e.clientY - rect.height - 12) + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}