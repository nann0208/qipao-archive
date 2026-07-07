// 海派旗袍史料库 PWA - 核心逻辑

const DATA_URL = 'https://nann0208.github.io/qipao-archive/data/data.js';
const CACHE_KEY = 'qipao_pwa_data';

const TOPIC_COLORS = {
  '旗袍流行款式': '#8B2C3C', '性别议题': '#C97B89', '消费生活': '#D4B26A',
  '轻工业业态': '#3E5641', '外贸': '#2C3E5C', '服制条例': '#3A78BC',
  '服装制作工艺': '#A0573B', '民族国家': '#B977CB', '更名争议': '#21AB94'
};
const TYPE_ICONS = {
  '报刊文章': '📰', '专著': '📖', '档案文件': '📜', '图像': '🖼️', '文学作品': '✒️'
};
const IMP_LABELS = { 3: '⭐⭐⭐ 核心', 2: '⭐⭐ 参考', 1: '⭐ 备用' };

let allRecords = [];
let filtered = [];
let keyword = '';
let activeType = '';
let activeTopic = '';
let pageSize = 30;
let shownCount = 0;

// ===== 启动 =====

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadData();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

// ===== Tab 切换 =====

function initTabs() {
  document.querySelector('.tab-bar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchPage(btn.dataset.page);
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    switchPage('list');
  });
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  document.getElementById('page-' + page).classList.add('active');
  const tab = document.querySelector(`.tab[data-page="${page}"]`);
  if (tab) tab.classList.add('active');

  const titles = { home: '海派旗袍史料库', list: '史料检索', detail: '史料详情', charts: '可视化图表' };
  document.getElementById('top-title').textContent = titles[page] || '海派旗袍史料库';

  window.scrollTo(0, 0);

  if (page === 'charts' && allRecords.length > 0) renderCharts();
}

// ===== 数据加载 =====

async function loadData() {
  setSyncStatus('同步中...');

  // 先尝试本地缓存
  const cached = loadFromCache();
  if (cached && cached.length > 0) {
    allRecords = cached;
    onDataReady();
  }

  // 再从远程拉取
  try {
    const records = await fetchRemoteData();
    if (records && records.length > 0) {
      allRecords = records;
      saveToCache(records);
      onDataReady();
      setSyncStatus('已同步 ✓');
    } else if (allRecords.length > 0) {
      setSyncStatus('使用缓存');
    } else {
      setSyncStatus('加载失败');
    }
  } catch (e) {
    console.warn('远程加载失败:', e);
    if (allRecords.length > 0) {
      setSyncStatus('离线模式');
    } else {
      setSyncStatus('无数据');
    }
  }
}

async function fetchRemoteData() {
  const resp = await fetch(DATA_URL, { cache: 'no-cache' });
  const text = await resp.text();
  // data.js 格式: window.INITIAL_DATA = [...];
  const match = text.match(/window\.INITIAL_DATA\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function saveToCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: data
    }));
  } catch (e) {
    console.warn('缓存写入失败:', e);
  }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj.data || null;
  } catch (e) {
    return null;
  }
}

function setSyncStatus(text) {
  document.getElementById('sync-status').textContent = text;
}

// ===== 数据就绪 =====

function onDataReady() {
  renderDashboard();
  initListPage();
}

// ===== 仪表盘 =====

function renderDashboard() {
  const data = allRecords;
  document.getElementById('stat-total').textContent = data.length;

  // 类型统计卡片
  const byType = {};
  data.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });
  const cardsHtml = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `
      <div class="stat-card">
        <div class="stat-card-icon">${TYPE_ICONS[type] || '📄'}</div>
        <div class="stat-card-num">${count}</div>
        <div class="stat-card-label">${type}</div>
      </div>
    `).join('');
  document.getElementById('stat-cards').innerHTML = cardsHtml;

}

// ===== 列表页 =====

function initListPage() {
  renderFilterChips();
  bindSearch();
  applyFilters();
}

function renderFilterChips() {
  const types = [...new Set(allRecords.map(r => r.type).filter(Boolean))];
  const topics = [...new Set(allRecords.flatMap(r => r.topics || []))];

  let html = '';
  html += `<span class="chip active" data-filter="all">全部</span>`;
  types.forEach(t => {
    html += `<span class="chip" data-filter="type" data-val="${esc(t)}">${TYPE_ICONS[t] || ''} ${esc(t)}</span>`;
  });
  html += `<span class="chip" data-filter="topic-toggle">📌 议题 ▾</span>`;

  const container = document.getElementById('filter-chips');
  container.innerHTML = html;

  // 议题子面板
  const subDiv = document.createElement('div');
  subDiv.className = 'filter-sub';
  subDiv.id = 'topic-sub';
  subDiv.innerHTML = topics.map(t =>
    `<span class="chip" data-filter="topic" data-val="${esc(t)}" style="border-color:${TOPIC_COLORS[t] || '#888'}">${esc(t)}</span>`
  ).join('');
  container.parentNode.insertBefore(subDiv, container.nextSibling);

  // 事件绑定
  container.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    const filter = chip.dataset.filter;
    if (filter === 'all') {
      activeType = ''; activeTopic = '';
      document.getElementById('topic-sub').classList.remove('open');
    } else if (filter === 'type') {
      activeType = activeType === chip.dataset.val ? '' : chip.dataset.val;
      activeTopic = '';
      document.getElementById('topic-sub').classList.remove('open');
    } else if (filter === 'topic-toggle') {
      document.getElementById('topic-sub').classList.toggle('open');
      return;
    }
    updateChipStates();
    applyFilters();
  });

  subDiv.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    activeTopic = activeTopic === chip.dataset.val ? '' : chip.dataset.val;
    activeType = '';
    updateChipStates();
    applyFilters();
  });
}

function updateChipStates() {
  document.querySelectorAll('#filter-chips .chip').forEach(c => {
    const f = c.dataset.filter;
    if (f === 'all') c.classList.toggle('active', !activeType && !activeTopic);
    else if (f === 'type') c.classList.toggle('active', activeType === c.dataset.val);
    else if (f === 'topic-toggle') c.classList.toggle('active', !!activeTopic);
  });
  document.querySelectorAll('#topic-sub .chip').forEach(c => {
    c.classList.toggle('active', activeTopic === c.dataset.val);
  });
}

function bindSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    clear.style.display = input.value ? 'block' : 'none';
    timer = setTimeout(() => {
      keyword = input.value.trim().toLowerCase();
      applyFilters();
    }, 250);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    keyword = '';
    clear.style.display = 'none';
    applyFilters();
  });
}

function applyFilters() {
  let result = allRecords;

  if (activeType) result = result.filter(r => r.type === activeType);
  if (activeTopic) result = result.filter(r => (r.topics || []).includes(activeTopic));

  if (keyword) {
    result = result.filter(r => {
      const hay = [
        r.title, r.source, r.author, r.time, r.version_info,
        r.core_content, r.personal_analysis, r.quotes,
        r.docx_preview_text,
        ...(r.topics || []), ...(r.keywords || [])
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(keyword);
    });
  }

  filtered = result;
  shownCount = 0;
  document.getElementById('record-list').innerHTML = '';
  document.getElementById('results-info').textContent =
    `共 ${filtered.length} 条${keyword ? ` · 关键词: "${keyword}"` : ''}`;
  loadMore();
}

function loadMore() {
  const next = filtered.slice(shownCount, shownCount + pageSize);
  const container = document.getElementById('record-list');

  next.forEach(r => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.style.borderLeftColor = getRecordColor(r);
    card.innerHTML = renderCardInner(r);
    card.addEventListener('click', () => showDetail(r.shiliao_id));
    container.appendChild(card);
  });

  shownCount += next.length;
  const loadMoreBtn = document.getElementById('load-more');
  loadMoreBtn.style.display = shownCount < filtered.length ? 'block' : 'none';

  if (!document.getElementById('btn-load-more')._bound) {
    document.getElementById('btn-load-more').addEventListener('click', loadMore);
    document.getElementById('btn-load-more')._bound = true;
  }
}

function renderCardInner(r) {
  const title = keyword ? highlight(r.title || '无题', keyword) : esc(r.title || '无题');
  const core = keyword ? highlight(r.core_content || '', keyword) : esc(r.core_content || '');
  const tags = (r.topics || []).map(t =>
    `<span class="tag" style="background:${TOPIC_COLORS[t] || '#888'}">${esc(t)}</span>`
  ).join('');

  return `
    <div class="record-title">${title}</div>
    <div class="record-meta">
      <span>${TYPE_ICONS[r.type] || '📄'} ${esc(r.type || '')}</span>
      <span>${esc(r.source || '')}</span>
      <span>${esc(r.time || '')}</span>
      ${r.importance ? `<span class="importance-stars">${'⭐'.repeat(r.importance)}</span>` : ''}
    </div>
    ${core ? `<div class="record-core">${core}</div>` : ''}
    ${tags ? `<div class="record-tags">${tags}</div>` : ''}
  `;
}

// ===== 详情页 =====

function showDetail(id) {
  const r = allRecords.find(x => x.shiliao_id === id);
  if (!r) return;

  switchPage('detail');

  const sections = [];

  if (r.core_content) {
    sections.push(makeSection('核心内容', r.core_content));
  }
  if (r.personal_analysis) {
    sections.push(makeSection('个人分析', r.personal_analysis));
  }
  if (r.quotes) {
    sections.push(makeSection('原文摘录', r.quotes));
  }
  if (r.docx_preview_text) {
    sections.push(makeSection('文档全文', r.docx_preview_text));
  }
  if (r.keywords && r.keywords.length > 0) {
    sections.push(makeSection('关键词', r.keywords.join('、')));
  }
  if (r.annotations && r.annotations.length > 0) {
    const annText = r.annotations.map(a =>
      `"${a.text}"${a.note ? ` — ${a.note}` : ''}`
    ).join('\n\n');
    sections.push(makeSection('批注', annText));
  }
  if (r.document_paths && r.document_paths.length > 0) {
    const paths = r.document_paths.map(p => `· ${p.split('/').pop()}`).join('\n');
    sections.push(makeSection('关联文档', paths));
  }

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-header">
      <div class="detail-title">${esc(r.title || '无题')}</div>
      <div class="detail-meta-grid">
        <span class="detail-label">编号</span><span class="detail-value">${esc(r.shiliao_id)}</span>
        <span class="detail-label">类型</span><span class="detail-value">${TYPE_ICONS[r.type] || ''} ${esc(r.type || '')}</span>
        <span class="detail-label">来源</span><span class="detail-value">${esc(r.source || '—')}</span>
        <span class="detail-label">作者</span><span class="detail-value">${esc(r.author || '—')}</span>
        <span class="detail-label">时间</span><span class="detail-value">${esc(r.time || '—')}</span>
        <span class="detail-label">版本</span><span class="detail-value">${esc(r.version_info || '—')}</span>
        <span class="detail-label">重要程度</span><span class="detail-value">${IMP_LABELS[r.importance] || '—'}</span>
        <span class="detail-label">议题</span><span class="detail-value">${(r.topics || []).join('、') || '—'}</span>
        ${r.opinion_types ? `<span class="detail-label">舆论类型</span><span class="detail-value">${Array.isArray(r.opinion_types) ? r.opinion_types.join('、') : r.opinion_types}</span>` : ''}
      </div>
    </div>
    ${sections.join('')}
  `;

  // 滚回顶部
  document.getElementById('page-detail').scrollTop = 0;
  window.scrollTo(0, 0);
}

function makeSection(title, body) {
  return `
    <div class="detail-section">
      <div class="detail-section-title">${esc(title)}</div>
      <div class="detail-section-body">${esc(body)}</div>
    </div>`;
}

// ===== 图表页 =====

function renderCharts() {
  renderTopicBars();
  renderSourceList();
  renderTimeRange();
  renderYearChart();
  renderTypeChart();
  renderTopicChart();
  renderImportanceChart();
}

function renderTopicBars() {
  const byTopic = {};
  allRecords.forEach(r => (r.topics || []).forEach(t => { byTopic[t] = (byTopic[t] || 0) + 1; }));
  const maxTopic = Math.max(...Object.values(byTopic), 1);
  document.getElementById('topic-bars').innerHTML = Object.entries(byTopic)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => {
      const pct = (count / maxTopic * 100).toFixed(1);
      const color = TOPIC_COLORS[topic] || '#888';
      return `<div class="topic-bar-row">
        <span class="topic-bar-label">${topic}</span>
        <div class="topic-bar-track">
          <div class="topic-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="topic-bar-count">${count}</span>
      </div>`;
    }).join('');
}

function renderSourceList() {
  const bySource = {};
  allRecords.forEach(r => {
    if (r.source && r.source.trim()) bySource[r.source.trim()] = (bySource[r.source.trim()] || 0) + 1;
  });
  const topSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById('source-list').innerHTML = topSources.map(([name, count]) =>
    `<div class="source-item"><span class="source-name">${esc(name)}</span><span class="source-count">${count}</span></div>`
  ).join('');
}

function renderTimeRange() {
  const years = allRecords.map(r => parseYear(r.time)).filter(Boolean);
  if (years.length > 0) {
    const min = Math.min(...years), max = Math.max(...years);
    document.getElementById('time-range').innerHTML =
      `<strong>${min}</strong> 年 — <strong>${max}</strong> 年，跨越 <strong>${max - min}</strong> 年`;
  }
}

function renderYearChart() {
  const byYear = {};
  allRecords.forEach(r => {
    const y = parseYear(r.time);
    if (y) byYear[y] = (byYear[y] || 0) + 1;
  });

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return;

  const counts = years.map(y => byYear[y]);
  const maxCount = Math.max(...counts, 1);

  const barW = 28, gap = 4, padL = 36, padR = 10, padT = 10, padB = 44;
  const w = padL + years.length * (barW + gap) + padR;
  const h = 220;
  const chartH = h - padT - padB;

  let bars = '';
  years.forEach((y, i) => {
    const x = padL + i * (barW + gap);
    const bh = (byYear[y] / maxCount) * chartH;
    const by = padT + chartH - bh;
    bars += `<rect x="${x}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="var(--primary)" opacity="0.85"/>`;
    bars += `<text x="${x + barW / 2}" y="${by - 4}" text-anchor="middle" font-size="10" fill="#666">${byYear[y]}</text>`;
    bars += `<text x="${x + barW / 2}" y="${h - padB + 14}" text-anchor="middle" font-size="9" fill="#999" transform="rotate(-45 ${x + barW / 2} ${h - padB + 14})">${y}</text>`;
  });

  document.getElementById('chart-year').innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <line x1="${padL}" y1="${padT + chartH}" x2="${w - padR}" y2="${padT + chartH}" stroke="#ddd" stroke-width="1"/>
      ${bars}
    </svg>`;
}

function renderTypeChart() {
  const byType = {};
  allRecords.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const total = allRecords.length;

  const typeColors = {
    '报刊文章': '#8B2C3C', '专著': '#2C3E5C', '档案文件': '#5D5D6E',
    '图像': '#A0573B', '文学作品': '#67A949'
  };

  document.getElementById('chart-type').innerHTML = renderPieChart(entries, total, typeColors);
}

function renderTopicChart() {
  const byTopic = {};
  allRecords.forEach(r => (r.topics || []).forEach(t => { byTopic[t] = (byTopic[t] || 0) + 1; }));
  const entries = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);

  document.getElementById('chart-topic').innerHTML = renderPieChart(entries, total, TOPIC_COLORS);
}

function renderPieChart(entries, total, colors) {
  const size = 180, cx = size / 2, cy = size / 2, r = 70;
  let startAngle = -Math.PI / 2;
  let paths = '';

  entries.forEach(([name, count]) => {
    const angle = (count / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const color = colors[name] || '#888';
    paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    startAngle = endAngle;
  });

  const legend = entries.map(([name, count]) => {
    const pct = (count / total * 100).toFixed(1);
    const color = colors[name] || '#888';
    return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
      <span style="color:#555">${esc(name)}</span>
      <span style="color:#999;margin-left:auto">${count} (${pct}%)</span>
    </div>`;
  }).join('');

  return `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}</svg>
    <div style="flex:1;min-width:120px">${legend}</div>
  </div>`;
}

function renderImportanceChart() {
  const byImp = { 3: 0, 2: 0, 1: 0 };
  allRecords.forEach(r => { if (r.importance) byImp[r.importance]++; });

  const impColors = { 3: '#D4A017', 2: '#C9A96E', 1: '#CCCCCC' };
  const entries = [[3, '核心 ⭐⭐⭐'], [2, '参考 ⭐⭐'], [1, '备用 ⭐']].filter(([k]) => byImp[k] > 0);
  const maxImp = Math.max(...Object.values(byImp), 1);

  const html = entries.map(([k, label]) => {
    const count = byImp[k];
    const pct = (count / maxImp * 100).toFixed(1);
    return `<div class="topic-bar-row">
      <span class="topic-bar-label">${label}</span>
      <div class="topic-bar-track">
        <div class="topic-bar-fill" style="width:${pct}%;background:${impColors[k]};"></div>
      </div>
      <span class="topic-bar-count">${count}</span>
    </div>`;
  }).join('');

  document.getElementById('chart-importance').innerHTML = html;
}

// ===== 工具函数 =====

function parseYear(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/(1[89]\d{2}|20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

function getRecordColor(r) {
  if (r.topics && r.topics.length > 0) return TOPIC_COLORS[r.topics[0]] || '#888';
  return '#888';
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function highlight(text, kw) {
  if (!kw || !text) return esc(text);
  const escaped = esc(text);
  const kwEsc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(kwEsc, 'gi'), m => `<mark>${m}</mark>`);
}
