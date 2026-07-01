// 统计图表页逻辑 —— 纯 SVG 绘制，无需任何外部依赖，离线可用。

let statType = '';     // 当前类型筛选
let statTopic = '';    // 当前议题筛选
let yearStart = null;  // 起始年（含）
let yearEnd = null;    // 结束年（含）

// 类型配色（与议题色区分开）
const TYPE_COLORS = {
  '报刊文章': '#8B2C3C',
  '专著': '#2C3E5C',
  '档案文件': '#5D5D6E',
  '图像': '#A0573B',
  '文学作品': '#67A949'
};

// 舆论类型配色
const OPINION_LINE_COLORS = {
  '规范约束型': '#0495C8',
  '体验反馈型': '#C370CE',
  '价值重构型': '#E74583'
};

function statsInit() {
  renderFilters();
  bindEvents();
  renderAll();
}

/* ---------- 筛选器 ---------- */

function renderFilters() {
  const typeBar = document.getElementById('type-filters');
  const topicBar = document.getElementById('topic-filters');

  typeBar.innerHTML = '';
  topicBar.innerHTML = '';

  const typeAll = makeChip('全部', statType === '', () => { statType = ''; renderFilters(); renderAll(); });
  typeBar.appendChild(typeAll);
  ALL_TYPES.forEach(t => {
    const chip = makeChip(`${TYPE_ICONS[t] || ''} ${t}`, statType === t,
      () => { statType = t; renderFilters(); renderAll(); });
    typeBar.appendChild(chip);
  });

  const topicAll = makeChip('全部', statTopic === '', () => { statTopic = ''; renderFilters(); renderAll(); });
  topicBar.appendChild(topicAll);
  ALL_TOPICS.forEach(t => {
    const chip = makeChip(t, statTopic === t,
      () => { statTopic = t; renderFilters(); renderAll(); });
    chip.dataset.topic = t;
    chip.style.setProperty('--chip-color', getTopicColor(t));
    topicBar.appendChild(chip);
  });
}

function makeChip(label, active, onClick) {
  const span = document.createElement('span');
  span.className = 'filter-chip' + (active ? ' active' : '');
  span.textContent = label;
  span.addEventListener('click', onClick);
  return span;
}

function bindEvents() {
  document.getElementById('btn-apply-year').addEventListener('click', () => {
    const s = parseInt(document.getElementById('year-start').value, 10);
    const e = parseInt(document.getElementById('year-end').value, 10);
    yearStart = isNaN(s) ? null : s;
    yearEnd = isNaN(e) ? null : e;
    if (yearStart !== null && yearEnd !== null && yearStart > yearEnd) {
      const t = yearStart; yearStart = yearEnd; yearEnd = t;
      document.getElementById('year-start').value = yearStart;
      document.getElementById('year-end').value = yearEnd;
    }
    renderAll();
  });
  document.getElementById('btn-reset-year').addEventListener('click', () => {
    yearStart = null; yearEnd = null;
    document.getElementById('year-start').value = '';
    document.getElementById('year-end').value = '';
    renderAll();
  });
}

/* ---------- 数据筛选 ---------- */

function yearInRange(year) {
  if (yearStart === null && yearEnd === null) return true; // 未设时间段 -> 全部
  if (year === null) return false;                          // 设了时间段则排除无年份记录
  if (yearStart !== null && year < yearStart) return false;
  if (yearEnd !== null && year > yearEnd) return false;
  return true;
}

// applyType / applyTopic：是否套用对应维度的筛选
function getRecords(applyType, applyTopic) {
  let recs = loadAllRecords();
  recs = recs.filter(r => yearInRange(parseYear(r.time)));
  if (applyType && statType) recs = recs.filter(r => r.type === statType);
  if (applyTopic && statTopic) recs = recs.filter(r => (r.topics || []).includes(statTopic));
  return recs;
}

/* ---------- 总渲染 ---------- */

function renderAll() {
  renderSummary();
  renderWordCloud();
  renderLineChart();
  renderOpinionLineChart();
  renderBarChart('chart-type', countByType(getRecords(false, true)), '篇');
  renderBarChart('chart-topic', countByTopic(getRecords(true, false)), '篇');
  renderSourcePie();
}

function renderSummary() {
  const recs = getRecords(true, true);
  const years = recs.map(r => parseYear(r.time)).filter(y => y !== null);
  const minY = years.length ? Math.min(...years) : null;
  const maxY = years.length ? Math.max(...years) : null;
  const rangeText = (yearStart !== null || yearEnd !== null)
    ? `${yearStart !== null ? yearStart : '不限'} — ${yearEnd !== null ? yearEnd : '不限'}`
    : '全部年份';

  const cards = [
    { label: '当前筛选记录数', value: recs.length },
    { label: '时间段', value: rangeText },
    { label: '记录最早 / 最晚', value: minY !== null ? `${minY} / ${maxY}` : '—' },
    { label: '无时间信息记录', value: recs.length - years.length }
  ];

  document.getElementById('stats-summary').innerHTML = cards.map(c =>
    `<div class="summary-card">
       <div class="summary-value">${c.value}</div>
       <div class="summary-label">${c.label}</div>
     </div>`
  ).join('');
}

/* ---------- 统计函数 ---------- */

function countByType(recs) {
  return ALL_TYPES.map(t => ({
    label: t,
    value: recs.filter(r => r.type === t).length,
    color: TYPE_COLORS[t] || '#888'
  }));
}

function countByTopic(recs) {
  return ALL_TOPICS.map(t => ({
    label: t,
    value: recs.filter(r => (r.topics || []).includes(t)).length,
    color: getTopicColor(t)
  }));
}

// 统计报刊文章的来源分布
function countBySource(recs) {
  const sources = {};
  recs
    .filter(r => r.type === '报刊文章' && r.source)
    .forEach(r => {
      sources[r.source] = (sources[r.source] || 0) + 1;
    });

  return Object.entries(sources)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12); // 只取前 12 个
}

// 饼图配色方案（和谐的渐变色调）
const SOURCE_COLORS = [
  '#8B4789', '#C85A7C', '#E07C6B', '#E5A55B', '#D8C34A',
  '#A8C562', '#6FB882', '#4A9B8E', '#3A7FA8', '#4A6FA5',
  '#6B5B95', '#D4A5A5'
];

/* ---------- 折线图：年度分布 ---------- */

function renderLineChart() {
  const recs = getRecords(true, true);
  const years = recs.map(r => parseYear(r.time)).filter(y => y !== null);

  const titleEl = document.getElementById('line-title');
  const container = document.getElementById('chart-line');

  if (years.length === 0) {
    titleEl.textContent = '年度分布折线图';
    container.innerHTML = emptyMsg('当前筛选条件下没有带时间信息的记录');
    return;
  }

  // 确定 x 轴年份范围
  const lo = yearStart !== null ? yearStart : Math.min(...years);
  const hi = yearEnd !== null ? yearEnd : Math.max(...years);

  titleEl.textContent = `${lo}-${hi}年 历史资料数量折线图`;

  // 统计每年数量
  const counts = {};
  for (let y = lo; y <= hi; y++) counts[y] = 0;
  years.forEach(y => { if (y >= lo && y <= hi) counts[y] = (counts[y] || 0) + 1; });

  const points = [];
  for (let y = lo; y <= hi; y++) points.push({ label: String(y), value: counts[y] });

  container.innerHTML = buildLineSVG(points);
}

/* ---------- 多线折线图：舆论类型年度走向 ---------- */

function renderOpinionLineChart() {
  const recs = getRecords(true, true);
  const titleEl = document.getElementById('opinion-line-title');
  const container = document.getElementById('chart-opinion-line');

  // 筛选仅报刊文章（仅报刊文章有舆论类型字段）
  const paperRecs = recs.filter(r => r.type === '报刊文章');
  const years = paperRecs.map(r => parseYear(r.time)).filter(y => y !== null);

  if (years.length === 0) {
    titleEl.textContent = '舆论类型年度走向';
    container.innerHTML = emptyMsg('当前筛选条件下没有符合条件的报刊文章');
    return;
  }

  const lo = yearStart !== null ? yearStart : Math.min(...years);
  const hi = yearEnd !== null ? yearEnd : Math.max(...years);

  titleEl.textContent = `${lo}-${hi}年 报刊文章舆论类型分布折线图`;

  // 按年份和舆论类型统计
  const dataByOpinionAndYear = countOpinionTypeByYear(paperRecs, lo, hi);

  if (Object.keys(dataByOpinionAndYear).length === 0) {
    container.innerHTML = emptyMsg('当前筛选条件下的报刊文章没有舆论类型标注');
    return;
  }

  container.innerHTML = buildMultiLineSVG(dataByOpinionAndYear, lo, hi);
}

// 统计各舆论类型按年份的数量
function countOpinionTypeByYear(recs, lo, hi) {
  const result = {};

  // 初始化每个舆论类型的数据
  OPINION_TYPES.forEach(t => {
    result[t] = {};
    for (let y = lo; y <= hi; y++) result[t][y] = 0;
  });

  // 遍历记录，累计统计
  recs.forEach(r => {
    const y = parseYear(r.time);
    if (y === null || y < lo || y > hi) return;

    const types = Array.isArray(r.opinion_types) ? r.opinion_types : (r.opinion_types ? [r.opinion_types] : []);
    types.forEach(t => {
      if (result[t]) result[t][y] = (result[t][y] || 0) + 1;
    });
  });

  return result;
}

// 多线折线图 SVG 生成
function buildMultiLineSVG(dataByOpinionAndYear, lo, hi) {
  const W = 900, H = 420;
  const mL = 50, mR = 24, mT = 30, mB = 92;
  const pw = W - mL - mR, ph = H - mT - mB;

  // 找出最大值
  let maxV = 1;
  Object.values(dataByOpinionAndYear).forEach(yearData => {
    Object.values(yearData).forEach(v => {
      maxV = Math.max(maxV, v);
    });
  });
  maxV = niceMax(maxV);

  const n = hi - lo + 1;
  const x = i => mL + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
  const y = v => mT + ph - (ph * v) / maxV;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;

  // y 轴网格 + 刻度
  const ticks = tickCount(maxV);
  for (let t = 0; t <= ticks; t++) {
    const v = (maxV / ticks) * t;
    const yy = y(v);
    svg += `<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#E8E0D5" stroke-width="1"/>`;
    svg += `<text x="${mL - 8}" y="${yy + 4}" text-anchor="end" class="axis-text">${fmtNum(v)}</text>`;
  }
  // x 轴
  svg += `<line x1="${mL}" y1="${mT + ph}" x2="${W - mR}" y2="${mT + ph}" stroke="#9C948B" stroke-width="1"/>`;

  // x 标签（年份多时隔位显示）
  const step = n > 40 ? 10 : (n > 20 ? 5 : (n > 12 ? 2 : 1));
  for (let i = 0; i < n; i++) {
    const year = lo + i;
    if (i % step === 0 || i === n - 1) {
      svg += `<text x="${x(i)}" y="${mT + ph + 18}" text-anchor="end" class="axis-text" ` +
             `transform="rotate(-45 ${x(i)} ${mT + ph + 18})">${year}</text>`;
    }
  }

  // 为每个舆论类型绘制折线
  OPINION_TYPES.forEach(opinionType => {
    const color = OPINION_LINE_COLORS[opinionType];
    const yearData = dataByOpinionAndYear[opinionType];

    // 生成路径数据
    const points = [];
    for (let i = 0; i < n; i++) {
      const year = lo + i;
      const v = yearData[year] || 0;
      points.push({ year, value: v, x: x(i), y: y(v) });
    }

    // 绘制折线
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linejoin="round" opacity="0.85"/>`;

    // 绘制数据点
    points.forEach((p, i) => {
      if (p.value > 0) {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}"/>`;
      }
    });
  });

  // 图例（右侧或底部）
  const legendY = mT + 12;
  let legendX = mL + pw - 120;
  OPINION_TYPES.forEach((t, idx) => {
    const color = OPINION_LINE_COLORS[t];
    const ly = legendY + idx * 20;
    svg += `<line x1="${legendX}" y1="${ly + 5}" x2="${legendX + 12}" y2="${ly + 5}" stroke="${color}" stroke-width="2.3"/>`;
    svg += `<text x="${legendX + 18}" y="${ly + 9}" class="axis-text" font-size="12">${t}</text>`;
  });

  // y 轴标题
  svg += `<text x="14" y="${mT + ph / 2}" text-anchor="middle" class="axis-title" ` +
         `transform="rotate(-90 14 ${mT + ph / 2})">资料数量（篇）</text>`;

  svg += `</svg>`;
  return svg;
}

function buildLineSVG(points) {
  const W = 900, H = 420;
  const mL = 50, mR = 24, mT = 30, mB = 92;
  const pw = W - mL - mR, ph = H - mT - mB;
  const maxV = niceMax(Math.max(...points.map(p => p.value), 1));
  const n = points.length;

  const x = i => mL + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
  const y = v => mT + ph - (ph * v) / maxV;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;

  // y 轴网格 + 刻度
  const ticks = tickCount(maxV);
  for (let t = 0; t <= ticks; t++) {
    const v = (maxV / ticks) * t;
    const yy = y(v);
    svg += `<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#E8E0D5" stroke-width="1"/>`;
    svg += `<text x="${mL - 8}" y="${yy + 4}" text-anchor="end" class="axis-text">${fmtNum(v)}</text>`;
  }
  // x 轴
  svg += `<line x1="${mL}" y1="${mT + ph}" x2="${W - mR}" y2="${mT + ph}" stroke="#9C948B" stroke-width="1"/>`;

  // x 标签（年份多时隔位显示）
  const step = n > 40 ? 10 : (n > 20 ? 5 : (n > 12 ? 2 : 1));
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) {
      svg += `<text x="${x(i)}" y="${mT + ph + 18}" text-anchor="end" class="axis-text" ` +
             `transform="rotate(-45 ${x(i)} ${mT + ph + 18})">${p.label}</text>`;
    }
  });

  // 折线
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  svg += `<path d="${path}" fill="none" stroke="#8B2C3C" stroke-width="2.5" stroke-linejoin="round"/>`;

  // 数据点 + 数值
  points.forEach((p, i) => {
    svg += `<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" fill="#8B2C3C"/>`;
    if (p.value > 0) {
      svg += `<text x="${x(i)}" y="${y(p.value) - 9}" text-anchor="middle" class="point-text">${p.value}</text>`;
    }
  });

  // y 轴标题
  svg += `<text x="14" y="${mT + ph / 2}" text-anchor="middle" class="axis-title" ` +
         `transform="rotate(-90 14 ${mT + ph / 2})">资料数量（篇）</text>`;

  svg += `</svg>`;
  return svg;
}

/* ---------- 柱状图：类型 / 议题分布 ---------- */

function renderBarChart(containerId, data, unit) {
  const container = document.getElementById(containerId);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    container.innerHTML = emptyMsg('当前筛选条件下没有匹配的记录');
    return;
  }
  container.innerHTML = buildBarSVG(data, unit);
}

function buildBarSVG(data, unit) {
  const W = 900, H = 420;
  const mL = 50, mR = 24, mT = 30, mB = 92;
  const pw = W - mL - mR, ph = H - mT - mB;
  const maxV = niceMax(Math.max(...data.map(d => d.value), 1));
  const n = data.length;
  const slot = pw / n;
  const barW = Math.min(slot * 0.55, 80);

  const y = v => mT + ph - (ph * v) / maxV;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;

  const ticks = tickCount(maxV);
  for (let t = 0; t <= ticks; t++) {
    const v = (maxV / ticks) * t;
    const yy = y(v);
    svg += `<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#E8E0D5" stroke-width="1"/>`;
    svg += `<text x="${mL - 8}" y="${yy + 4}" text-anchor="end" class="axis-text">${fmtNum(v)}</text>`;
  }
  svg += `<line x1="${mL}" y1="${mT + ph}" x2="${W - mR}" y2="${mT + ph}" stroke="#9C948B" stroke-width="1"/>`;

  data.forEach((d, i) => {
    const cx = mL + slot * i + slot / 2;
    const bx = cx - barW / 2;
    const bh = (ph * d.value) / maxV;
    const by = mT + ph - bh;
    svg += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="${d.color}" rx="2"/>`;
    svg += `<text x="${cx}" y="${by - 8}" text-anchor="middle" class="point-text">${d.value}</text>`;
    svg += `<text x="${cx}" y="${mT + ph + 20}" text-anchor="middle" class="axis-text">${d.label}</text>`;
  });

  svg += `<text x="14" y="${mT + ph / 2}" text-anchor="middle" class="axis-title" ` +
         `transform="rotate(-90 14 ${mT + ph / 2})">资料数量（${unit}）</text>`;

  svg += `</svg>`;
  return svg;
}

/* ---------- 饼图：报刊来源分布 ---------- */

function renderSourcePie() {
  const recs = getRecords(true, true);
  const data = countBySource(recs);
  const container = document.getElementById('chart-source');

  if (data.length === 0) {
    container.innerHTML = emptyMsg('当前筛选条件下没有报刊文章');
    return;
  }

  container.innerHTML = buildPieSVG(data);
  bindPieEvents(data);
}

function buildPieSVG(data) {
  const W = 900;
  const legendCols = 4;
  const legendColW = W / legendCols;
  const legendRowH = 28;
  const legendRows = Math.ceil(data.length / legendCols);
  const legendTop = 20;
  const legendH = legendRows * legendRowH + 16;

  const r = 155;
  const cx = W / 2;
  const cy = legendTop + legendH + r + 20;
  const H = cy + r + 30;

  const total = data.reduce((s, d) => s + d.value, 0);

  let svg = `<svg id="source-pie-svg" viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;

  // 图例（顶部）
  data.forEach((d, i) => {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const lx = col * legendColW + 18;
    const ly = legendTop + row * legendRowH + legendRowH / 2;
    const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
    svg += `<g id="pie-legend-${i}" class="pie-legend-item" data-index="${i}" style="cursor:pointer">`;
    svg += `<circle id="pie-legend-dot-${i}" cx="${lx + 7}" cy="${ly}" r="6" fill="${color}"/>`;
    svg += `<text id="pie-legend-text-${i}" x="${lx + 20}" y="${ly + 5}" class="axis-text" font-size="12.5">${d.label} (${d.value})</text>`;
    svg += `</g>`;
  });

  // 分隔线
  svg += `<line x1="24" y1="${legendTop + legendH - 6}" x2="${W - 24}" y2="${legendTop + legendH - 6}" stroke="#E8E0D5" stroke-width="1"/>`;

  // 饼图切片
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const midAngle = angle + sliceAngle / 2;
    const endAngle = angle + sliceAngle;

    const x1 = (cx + r * Math.cos(angle)).toFixed(2);
    const y1 = (cy + r * Math.sin(angle)).toFixed(2);
    const x2 = (cx + r * Math.cos(endAngle)).toFixed(2);
    const y2 = (cy + r * Math.sin(endAngle)).toFixed(2);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
    const ex = (20 * Math.cos(midAngle)).toFixed(2);
    const ey = (20 * Math.sin(midAngle)).toFixed(2);

    svg += `<g id="pie-slice-${i}" class="pie-slice-group" data-index="${i}" data-ex="${ex}" data-ey="${ey}" style="cursor:pointer">`;
    svg += `<path id="pie-path-${i}" d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="#fff" stroke-width="2" opacity="0.88"/>`;

    // 切片内数字标签（切片够大才显示）
    if (d.value / total > 0.04) {
      const labelR = r * 0.66;
      const lx2 = (cx + labelR * Math.cos(midAngle)).toFixed(2);
      const ly2 = (cy + labelR * Math.sin(midAngle) + 5).toFixed(2);
      svg += `<text x="${lx2}" y="${ly2}" text-anchor="middle" class="pie-label">${d.value}</text>`;
    }
    svg += `</g>`;
    angle = endAngle;
  });

  svg += `</svg>`;
  return svg;
}

function bindPieEvents(data) {
  let activeSlice = null;

  const highlight = (i, on) => {
    const path = document.getElementById(`pie-path-${i}`);
    const text = document.getElementById(`pie-legend-text-${i}`);
    const dot  = document.getElementById(`pie-legend-dot-${i}`);
    if (!path) return;
    if (on) {
      path.style.stroke = '#8B2C3C';
      path.style.strokeWidth = '3.5';
      path.style.opacity = '1';
      if (text) { text.style.fontWeight = '700'; text.style.fill = '#8B2C3C'; }
      if (dot)  { dot.setAttribute('r', '8'); }
    } else if (activeSlice !== i) {
      path.style.stroke = '#fff';
      path.style.strokeWidth = '2';
      path.style.opacity = '0.88';
      if (text) { text.style.fontWeight = ''; text.style.fill = ''; }
      if (dot)  { dot.setAttribute('r', '6'); }
    }
  };

  const explode = (i) => {
    const g = document.getElementById(`pie-slice-${i}`);
    if (!g) return;
    g.style.transform = `translate(${g.dataset.ex}px, ${g.dataset.ey}px)`;
    g.style.transition = 'transform 0.22s ease';
  };

  const collapse = (i) => {
    const g = document.getElementById(`pie-slice-${i}`);
    if (!g) return;
    g.style.transform = '';
  };

  data.forEach((_, i) => {
    const sliceGroup  = document.getElementById(`pie-slice-${i}`);
    const legendGroup = document.getElementById(`pie-legend-${i}`);

    [sliceGroup, legendGroup].forEach(el => {
      if (!el) return;
      el.addEventListener('mouseenter', () => highlight(i, true));
      el.addEventListener('mouseleave', () => highlight(i, false));
    });

    if (sliceGroup) {
      sliceGroup.addEventListener('click', () => {
        if (activeSlice === i) {
          collapse(i);
          highlight(i, false);
          activeSlice = null;
        } else {
          if (activeSlice !== null) { collapse(activeSlice); highlight(activeSlice, false); }
          explode(i);
          highlight(i, true);
          activeSlice = i;
        }
      });
    }
  });
}

/* ---------- 工具 ---------- */

function niceMax(v) {
  if (v <= 0) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  let m;
  if (n <= 1) m = 1;
  else if (n <= 2) m = 2;
  else if (n <= 5) m = 5;
  else m = 10;
  return m * pow;
}

// 刻度数量：小数值用整数步长，避免出现小数刻度
function tickCount(maxV) {
  return maxV <= 5 ? maxV : 5;
}

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function emptyMsg(text) {
  return `<div class="chart-empty">📭 ${text}</div>`;
}

/* ---------- 词云 ---------- */

function renderWordCloud() {
  const container = document.getElementById('chart-wordcloud');
  if (!container) return;

  // 用当前筛选条件下的记录统计关键词频率
  const recs = getRecords(true, true);
  const freq = {};
  recs.forEach(r => {
    (r.keywords || []).forEach(kw => {
      const k = kw.trim();
      if (k) freq[k] = (freq[k] || 0) + 1;
    });
  });

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="chart-empty">📭 当前筛选条件下暂无关键词数据</div>';
    return;
  }

  // 民国海派淡雅配色（10色循环）
  const PALETTE = [
    '#8B2C3C', '#2C3E5C', '#3E5641', '#A0573B',
    '#6B4F78', '#3A78BC', '#7A5C38', '#5D7A6E',
    '#B08040', '#C97B89'
  ];

  const top = sorted.slice(0, 60);
  const maxF = top[0][1];
  const minF = top[top.length - 1][1];

  function fontSize(f) {
    // 平方根压缩，避免高频词过于庞大
    const lo = 12, hi = 52;
    if (maxF === minF) return (lo + hi) / 2;
    const norm = (Math.sqrt(f) - Math.sqrt(minF)) / (Math.sqrt(maxF) - Math.sqrt(minF));
    return lo + norm * (hi - lo);
  }

  // 用隐藏 canvas 测量每个词的像素宽度
  const cvs = document.createElement('canvas');
  const cx2d = cvs.getContext('2d');

  const W = 520, H = 220, CX = W / 2, CY = H / 2;

  function measure(text, size, bold) {
    cx2d.font = `${bold ? 'bold' : 'normal'} ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const tw = cx2d.measureText(text).width;
    return { w: Math.ceil(tw) + 6, h: Math.ceil(size * 1.3) };
  }

  // 已占用矩形列表（用于碰撞检测）
  const boxes = [];
  function hits(x1, y1, x2, y2) {
    for (const b of boxes) {
      if (x1 < b.x2 + 2 && x2 > b.x1 - 2 && y1 < b.y2 + 2 && y2 > b.y1 - 2) return true;
    }
    return false;
  }

  const placed = [];

  // Archimedean 螺旋布局：从中心螺旋向外依次尝试
  top.forEach(([text, count], idx) => {
    const size = fontSize(count);
    const bold = size >= 22;
    const { w, h } = measure(text, size, bold);
    const color = PALETTE[idx % PALETTE.length];

    const step = 0.18;
    let θ = (idx % 8) * (Math.PI / 4); // 不同词从不同角度开始，减少聚集
    for (let iter = 0; iter < 4000; iter++) {
      const r = 2.8 * θ;
      const px = CX + r * Math.cos(θ) - w / 2;
      const py = CY + r * Math.sin(θ) - h / 2;

      if (px >= 1 && py >= 1 && px + w <= W - 1 && py + h <= H - 1 && !hits(px, py, px + w, py + h)) {
        boxes.push({ x1: px, y1: py, x2: px + w, y2: py + h });
        placed.push({ px, py, w, h, text, size, bold, color, count });
        break;
      }
      θ += step;
    }
  });

  // 渲染 SVG 词云
  const svgWords = placed.map(p => {
    const tx = (p.px + p.w / 2).toFixed(1);
    const ty = (p.py + p.h * 0.76).toFixed(1);
    return `<text x="${tx}" y="${ty}" text-anchor="middle"
      font-size="${p.size.toFixed(1)}"
      font-weight="${p.bold ? 'bold' : 'normal'}"
      fill="${p.color}"
      font-family="'PingFang SC','Microsoft YaHei','Source Han Sans CN',sans-serif"
      opacity="0.9"><title>${escapeHtml(p.text)}：出现 ${p.count} 次</title>${escapeHtml(p.text)}</text>`;
  }).join('\n    ');

  const cloudSvg = `<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${W} ${H}" style="width:100%;display:block;">
    <rect width="${W}" height="${H}" fill="var(--color-bg-card)" rx="6"/>
    ${svgWords}
  </svg>`;

  // Top 10 图例
  const top10 = sorted.slice(0, 10);
  const totalCount = sorted.reduce((s, [, c]) => s + c, 0);
  const maxCount = top10[0][1];

  const legendRows = top10.map(([text, count], i) => {
    const pct = totalCount > 0 ? (count / totalCount * 100).toFixed(1) : '0.0';
    const barPct = maxCount > 0 ? (count / maxCount * 100).toFixed(1) : '0';
    const color = PALETTE[i % PALETTE.length];
    return `<div class="wc-row">
      <span class="wc-rank">${i + 1}</span>
      <span class="wc-kw" style="color:${color};font-weight:600;">${escapeHtml(text)}</span>
      <div class="wc-bar-bg">
        <div class="wc-bar-fill" style="width:${barPct}%;background:${color};"></div>
      </div>
      <span class="wc-count">${count} 次</span>
      <span class="wc-pct">${pct}%</span>
    </div>`;
  }).join('');

  container.innerHTML = cloudSvg + `
    <div class="wc-legend">
      <div class="wc-legend-hd">频率前十关键词</div>
      <div class="wc-legend-note">（占全部关键词出现总次数 ${totalCount} 次的比例）</div>
      ${legendRows}
    </div>`;
}

document.addEventListener('DOMContentLoaded', statsInit);
