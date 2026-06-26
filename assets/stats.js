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
  '文学作品': '#34F0B1'
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
  renderLineChart();
  renderBarChart('chart-type', countByType(getRecords(false, true)), '篇');
  renderBarChart('chart-topic', countByTopic(getRecords(true, false)), '篇');
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

document.addEventListener('DOMContentLoaded', statsInit);
