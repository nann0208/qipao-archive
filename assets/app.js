// 主页应用逻辑

let currentTypeFilter = '';
let currentTopicFilter = '';
let currentKeyword = '';
let currentSort = '';
let currentYears = [];
let tempYears = []; // Modal 中临时修改的年份
let currentImportance = '';
let currentSources = []; // 选中的刊物名称
let tempSources = []; // Modal 中临时修改的刊物名称

const PAGE_SIZE = 40;     // 每页显示数量
let currentPage = 1;      // 当前页码
let currentView = 'card'; // 'card' 卡片视图 | 'list' 列表视图

function init() {
  // 🚨 关键检查：如果 data.js 没加载成功，立刻警告，禁止编辑
  if (!window.INITIAL_DATA || !Array.isArray(window.INITIAL_DATA) || window.INITIAL_DATA.length === 0) {
    showDataLoadFailureBanner();
  }

  // 🛡️ 启动时检查 IndexedDB 备份（localStorage 空但 IndexedDB 有数据时提示恢复）
  if (typeof checkAndRestoreBackup === 'function') {
    checkAndRestoreBackup();
  }

  // 🧹 启动时清理脏数据（重复的新增记录）
  if (typeof cleanupDuplicates === 'function') {
    const removed = cleanupDuplicates();
    if (removed > 0) {
      console.log(`[清理] 移除了 ${removed} 条重复的本地记录`);
    }
  }

  // 从 sessionStorage 恢复搜索/筛选状态（从详情页返回时）
  restoreState();

  renderFilters();
  bindEvents();
  bindYearModal();
  bindSourceModal();
  bindIncompleteToggle();
  updateYearFilterDisplay();
  updateSourceFilterDisplay();
  updateSourceFilterVisibility();

  // 恢复搜索框和排序下拉框
  if (currentKeyword) document.getElementById('search-input').value = currentKeyword;
  if (currentSort) document.getElementById('sort-select').value = currentSort;
  updateSearchClearVisibility();

  // 视图切换按钮
  bindViewToggle();
  bindFilterCollapse();

  render();

  // 🛡️ 数据保护：横幅提醒 + 关闭页面前确认
  if (!window.READ_ONLY) {
    bindUnsavedBanner();
    bindBeforeUnload();
  } else {
    applyReadOnlyMode();
  }
}

// 只读模式：隐藏所有编辑相关元素
function applyReadOnlyMode() {
  // 隐藏横幅、导出、重置、添加史料按钮
  const hide = ['unsaved-banner', 'btn-export', 'btn-reset'];
  hide.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // 隐藏"添加史料"链接（按 href 匹配）
  document.querySelectorAll('a[href="add.html"]').forEach(el => el.style.display = 'none');
  // 隐藏 尚未完善 区块的编辑链接
  document.querySelectorAll('.incomplete-edit-link').forEach(el => el.style.display = 'none');
  // 版权声明小字（只在只读模式显示）
  const footer = document.getElementById('public-footer');
  if (footer) footer.style.display = 'block';
}

// 🚨 data.js 加载失败时的大红警告（覆盖整个页面顶部）
function showDataLoadFailureBanner() {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #C0392B; color: #fff; padding: 16px 24px;
    font-size: 15px; font-weight: 600; text-align: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    animation: banner-pulse 1.5s ease-in-out infinite;
  `;
  div.innerHTML = `
    🚨 严重错误：data.js 加载失败！数据库当前为空。<br>
    <span style="font-weight:normal; font-size:13px;">
      请检查 shiliao_website/data/ 文件夹中是否存在<strong>正确命名</strong>的 data.js 文件（不是 data.js.js）。<br>
      <strong>在修复前请不要编辑数据</strong>，否则改动会无法关联到原记录！
    </span>
  `;
  document.body.insertBefore(div, document.body.firstChild);
}

// 🛡️ 横幅：根据状态显示不同内容（绿色已导出 / 黄色未导出 / 红色超 24h 未导出）
function bindUnsavedBanner() {
  // 按钮的事件绑定改成在 updateUnsavedBanner 里做（因为 innerHTML 会被重写）
  updateUnsavedBanner();
}

function updateUnsavedBanner() {
  const banner = document.getElementById('unsaved-banner');
  if (!banner) return;
  const stats = getStatistics();
  const unsaved = stats.localNew + stats.localModified + stats.localDeleted;
  if (unsaved === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = '';
  banner.classList.remove('unsaved-banner-success', 'unsaved-banner-danger');

  if (isDataSafelyExported()) {
    // ✅ 绿色：已安全导出，等待用户归档 data.js
    banner.classList.add('unsaved-banner-success');
    banner.innerHTML = `
      <span class="unsaved-icon">✔</span>
      <span class="unsaved-text">
        <strong>已经安全导出，快去归档 data！</strong>
        &nbsp;·&nbsp;
        共 <strong>${unsaved}</strong> 条本地数据
      </span>
      <button id="banner-export-btn" class="banner-btn">⬇ 再次导出</button>
      <span class="unsaved-tip">（请把下载的 data.js 移到 shiliao_website/data/ 覆盖原文件）</span>
    `;
  } else {
    // ⚠️ 黄色（或红色）：未导出警告
    const exportInfo = getLastExportInfo();
    if (exportInfo.hoursAgo > 24) {
      banner.classList.add('unsaved-banner-danger');
    }
    banner.innerHTML = `
      <span class="unsaved-icon">⚠️</span>
      <span class="unsaved-text">
        你有 <strong>${unsaved}</strong> 条本地数据未保存到 data.js
        &nbsp;·&nbsp;
        上次导出：<strong>${exportInfo.text}</strong>
      </span>
      <button id="banner-export-btn" class="banner-btn">⬇ 立即导出</button>
      <span class="unsaved-tip">（关闭浏览器前请务必导出！否则数据可能丢失）</span>
    `;
  }

  // 因为 innerHTML 重写了，需要重新绑定按钮
  const exportBtn = document.getElementById('banner-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportData();
      updateUnsavedBanner();
      showToast('✓ 已下载 data.js！请把它放到 data/ 文件夹覆盖原文件');
    });
  }
}

// 🛡️ 关闭页面 / 刷新前提醒
function bindBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    const stats = getStatistics();
    const unsaved = stats.localNew + stats.localModified + stats.localDeleted;
    if (unsaved > 0) {
      const msg = `你有 ${unsaved} 条本地数据未导出！关闭页面可能丢失数据。`;
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }
  });
}

// 保存当前搜索/筛选状态到 sessionStorage
function saveState() {
  const state = {
    keyword: currentKeyword,
    type: currentTypeFilter,
    topic: currentTopicFilter,
    importance: currentImportance,
    years: currentYears,
    sort: currentSort,
    sources: currentSources,
    page: currentPage,
    view: currentView
  };
  sessionStorage.setItem('shiliao_browse_state', JSON.stringify(state));
}

// 从 sessionStorage 恢复状态
function restoreState() {
  try {
    const raw = sessionStorage.getItem('shiliao_browse_state');
    if (!raw) return;
    const state = JSON.parse(raw);
    currentKeyword = state.keyword || '';
    currentTypeFilter = state.type || '';
    currentTopicFilter = state.topic || '';
    currentImportance = state.importance || '';
    currentYears = state.years || [];
    currentSort = state.sort || '';
    currentSources = state.sources || [];
    currentPage = state.page || 1;
    currentView = state.view || 'card';
  } catch (e) {
    // 忽略
  }
}

// 当任何筛选条件或搜索词改变时，重置回第 1 页
function resetPage() {
  currentPage = 1;
}

// 视图切换
function bindViewToggle() {
  const btnCard = document.getElementById('view-card');
  const btnList = document.getElementById('view-list');
  if (!btnCard || !btnList) return;

  updateViewToggleUI();

  btnCard.addEventListener('click', () => {
    if (currentView === 'card') return;
    currentView = 'card';
    updateViewToggleUI();
    render();
  });

  btnList.addEventListener('click', () => {
    if (currentView === 'list') return;
    currentView = 'list';
    updateViewToggleUI();
    render();
  });
}

function updateViewToggleUI() {
  const btnCard = document.getElementById('view-card');
  const btnList = document.getElementById('view-list');
  if (!btnCard || !btnList) return;
  btnCard.classList.toggle('active', currentView === 'card');
  btnList.classList.toggle('active', currentView === 'list');
}

// 筛选栏收起/展开
let filterCollapsed = false;

function bindFilterCollapse() {
  const btn = document.getElementById('btn-filter-collapse');
  if (!btn) return;
  btn.addEventListener('click', () => {
    filterCollapsed = !filterCollapsed;
    const filterBar = document.querySelector('.filter-bar');
    const filterRows = filterBar.querySelectorAll('.filter-row');
    filterRows.forEach(row => {
      row.style.display = filterCollapsed ? 'none' : '';
    });
    // 收起行本身（含按钮）始终显示
    const collapseRow = filterBar.querySelector('.filter-collapse-row');
    if (collapseRow) collapseRow.style.display = '';
    // 按钮箭头切换
    btn.textContent = filterCollapsed ? '↓' : '↑';
    btn.title = filterCollapsed ? '展开筛选栏' : '收起筛选栏';
    // 收起时更新 sticky 位置的 top 值
    updateFilterBarStickyOffset();
  });
}

// 筛选栏高度变化后，更新下方组件的 sticky top（如列表表头）
function updateFilterBarStickyOffset() {
  const filterBar = document.querySelector('.filter-bar');
  if (!filterBar) return;
  const h = filterBar.offsetHeight;
  const listHeader = document.querySelector('.list-header');
  if (listHeader) listHeader.style.top = (h + 70) + 'px'; // 70 = header 高度
}

// 列表视图：创建一行
function createListRow(record) {
  const row = document.createElement('div');
  row.className = 'list-row';
  const color = getRecordPrimaryColor(record);
  row.style.setProperty('--card-color', color);

  const typeIcon = TYPE_ICONS[record.type] || '📄';
  const importance = IMPORTANCE_LABELS[record.importance] || '';
  const topics = (record.topics || []).map(t =>
    `<span class="list-topic" style="background: ${getTopicColor(t)}">${escapeHtml(t)}</span>`
  ).join('');

  const kw = record._searchKeyword || '';
  const titleText = kw ? highlightText(record.title || '(无标题)', kw) : escapeHtml(record.title || '(无标题)');

  const docCount = (record.document_paths || []).length;

  row.innerHTML = `
    <div class="list-color" style="background: ${color};"></div>
    <span class="list-type">${typeIcon}</span>
    <div class="list-topics">${topics}</div>
    <div class="list-title">${titleText}</div>
    <span class="list-meta">${record.author ? `✍️ ${escapeHtml(record.author)}` : ''}</span>
    <span class="list-meta">📍 ${escapeHtml(record.source || '—')}</span>
    <span class="list-meta">📅 ${escapeHtml(record.time || '—')}</span>
    <span class="list-meta">${record.version_info ? `📑 ${escapeHtml(record.version_info)}` : ''}</span>
    <span class="list-importance">${importance}</span>
    <span class="list-docs">${docCount > 0 ? `📎${docCount}` : ''}</span>
  `;

  row.addEventListener('click', () => {
    const kwParam = kw ? `&kw=${encodeURIComponent(kw)}` : '';
    location.href = `detail.html?id=${encodeURIComponent(record.shiliao_id)}${kwParam}`;
  });

  return row;
}

function renderFilters() {
  const typeBar = document.getElementById('type-filters');
  const topicBar = document.getElementById('topic-filters');
  const importanceBar = document.getElementById('importance-filters');

  // 类型筛选
  typeBar.innerHTML = '';
  const typeAll = createChip('全部', '', () => setTypeFilter(''));
  if (currentTypeFilter === '') typeAll.classList.add('active');
  typeBar.appendChild(typeAll);
  ALL_TYPES.forEach(t => {
    const chip = createChip(`${TYPE_ICONS[t] || ''} ${t}`, '', () => setTypeFilter(t));
    // 文学作品使用专属配色
    if (TYPE_CHIP_COLORS[t]) {
      chip.dataset.typecolor = t;
      chip.style.setProperty('--chip-color', TYPE_CHIP_COLORS[t]);
    }
    if (currentTypeFilter === t) chip.classList.add('active');
    typeBar.appendChild(chip);
  });

  // 议题筛选
  topicBar.innerHTML = '';
  const topicAll = createChip('全部', '', () => setTopicFilter(''));
  if (currentTopicFilter === '') topicAll.classList.add('active');
  topicBar.appendChild(topicAll);
  ALL_TOPICS.forEach(t => {
    const chip = createChip(t, '', () => setTopicFilter(t));
    chip.dataset.topic = t;
    chip.style.setProperty('--chip-color', getTopicColor(t));
    if (currentTopicFilter === t) chip.classList.add('active');
    topicBar.appendChild(chip);
  });

  // 重要程度筛选
  importanceBar.innerHTML = '';
  const impAll = createChip('全部', '', () => setImportanceFilter(''));
  if (currentImportance === '') impAll.classList.add('active');
  importanceBar.appendChild(impAll);
  const importanceLevels = [
    { value: 3, label: '⭐⭐⭐ 核心' },
    { value: 2, label: '⭐⭐ 参考' },
    { value: 1, label: '⭐ 备用' }
  ];
  importanceLevels.forEach(({ value, label }) => {
    const chip = createChip(label, '', () => setImportanceFilter(value));
    if (currentImportance === value) chip.classList.add('active');
    importanceBar.appendChild(chip);
  });
}

function createChip(label, classes, onClick) {
  const span = document.createElement('span');
  span.className = 'filter-chip ' + (classes || '');
  span.textContent = label;
  span.addEventListener('click', onClick);
  return span;
}

function setTypeFilter(type) {
  // 切换类型时，清空已选来源（不同类型的来源不通用）
  if (type !== currentTypeFilter) {
    currentSources = [];
    updateSourceFilterDisplay();
  }
  currentTypeFilter = type;
  resetPage();
  updateSourceFilterVisibility();
  renderFilters();
  render();
}

// 来源筛选行的显隐控制 + 标签文本切换
// "报刊文章" → "刊物名称"，"档案文件" → "档案来源"
function updateSourceFilterVisibility() {
  const row = document.getElementById('source-filter-row');
  if (!row) return;

  const config = getSourceFilterConfig(currentTypeFilter);
  if (config) {
    row.style.display = '';
    document.getElementById('source-filter-label').textContent = config.label;
    document.getElementById('btn-source-text').textContent = config.btn;
    document.getElementById('source-modal-title').textContent = config.modalTitle;
  } else {
    row.style.display = 'none';
  }
}

// 根据类型返回来源筛选的标签配置
function getSourceFilterConfig(type) {
  if (type === '报刊文章') {
    return {
      label: '刊物名称',
      btn: '选择刊物',
      modalTitle: '选择刊物名称（按拼音排序）'
    };
  }
  if (type === '档案文件') {
    return {
      label: '档案来源',
      btn: '选择档案来源',
      modalTitle: '选择档案来源（按拼音排序）'
    };
  }
  if (type === '图像') {
    return {
      label: '图像来源',
      btn: '选择图像来源',
      modalTitle: '选择图像来源（按拼音排序）'
    };
  }
  if (type === '文学作品') {
    return {
      label: '作者',
      btn: '选择作者',
      modalTitle: '选择作者（按拼音排序）'
    };
  }
  return null;
}

function setTopicFilter(topic) {
  currentTopicFilter = topic;
  resetPage();
  renderFilters();
  render();
}

function setImportanceFilter(importance) {
  currentImportance = importance;
  resetPage();
  renderFilters();
  render();
}

function toggleYear(year) {
  const idx = tempYears.indexOf(year);
  if (idx >= 0) {
    tempYears.splice(idx, 1);
  } else {
    tempYears.push(year);
  }
  tempYears.sort((a, b) => a - b);
  renderYearModal(); // 只重新渲染 modal，不调用 render()
}

function clearYearFilter() {
  tempYears = [];
  renderYearModal();
}

/* ---------- 年度 Modal 相关 ---------- */

function renderYearModal() {
  const allYears = getAllYears(loadAllRecords());
  const chipsContainer = document.getElementById('year-modal-chips');
  chipsContainer.innerHTML = '';

  const yearAll = createChip('全部年份', '', () => {
    tempYears = [];
    renderYearModal();
  });
  if (tempYears.length === 0) yearAll.classList.add('active');
  chipsContainer.appendChild(yearAll);

  allYears.forEach(y => {
    const chip = createChip(String(y), '', () => toggleYear(y));
    if (tempYears.includes(y)) chip.classList.add('active');
    chipsContainer.appendChild(chip);
  });
}

function bindYearModal() {
  const modal = document.getElementById('year-modal');
  const btnOpen = document.getElementById('btn-year-filter');
  const btnClose = document.getElementById('btn-year-close');
  const overlay = document.querySelector('.year-modal-overlay');
  const btnConfirm = document.getElementById('btn-year-confirm');
  const btnClear = document.getElementById('btn-year-clear');

  btnOpen.addEventListener('click', () => {
    tempYears = [...currentYears]; // 打开 modal 时，tempYears = currentYears 副本
    renderYearModal();
    modal.classList.add('show');
  });

  const closeModal = () => {
    modal.classList.remove('show');
  };

  btnClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);

  btnConfirm.addEventListener('click', () => {
    currentYears = [...tempYears]; // 确定时，currentYears = tempYears
    resetPage();
    closeModal();
    updateYearFilterDisplay();
    render();
  });

  btnClear.addEventListener('click', () => {
    clearYearFilter();
  });

  // 按区间选中：把 起始~结束 之间所有"有数据的年份"加入 tempYears
  const btnRangeApply = document.getElementById('btn-year-range-apply');
  const inputStart = document.getElementById('year-range-start');
  const inputEnd = document.getElementById('year-range-end');
  if (btnRangeApply) {
    btnRangeApply.addEventListener('click', () => {
      let lo = parseInt(inputStart.value, 10);
      let hi = parseInt(inputEnd.value, 10);
      if (isNaN(lo) && isNaN(hi)) {
        alert('请至少填写起始年或结束年');
        return;
      }
      // 只填一个时，另一个用数据里的极值兜底
      const allYears = getAllYears(loadAllRecords());
      if (allYears.length === 0) return;
      if (isNaN(lo)) lo = Math.min(...allYears);
      if (isNaN(hi)) hi = Math.max(...allYears);
      if (lo > hi) { const t = lo; lo = hi; hi = t; } // 自动纠正大小顺序
      // 选中区间内所有"实际存在的年份"
      tempYears = allYears.filter(y => y >= lo && y <= hi);
      renderYearModal();
    });
  }
}

function updateYearFilterDisplay() {
  const countEl = document.getElementById('year-count');
  if (currentYears.length === 0) {
    countEl.textContent = '';
  } else {
    countEl.textContent = ` (${currentYears.length})`;
  }
}

/* ---------- 刊物名称 Modal 相关 ---------- */

function renderSourceModal() {
  // 档案文件用档案馆，文学作品用作者，其余用 source
  let allSources;
  if (currentTypeFilter === '档案文件') {
    allSources = getArchiveHolders();
  } else if (currentTypeFilter === '文学作品') {
    allSources = getAuthorsByType('文学作品');
  } else {
    allSources = getSourcesByType(currentTypeFilter);
  }
  const listContainer = document.getElementById('source-modal-list');
  listContainer.innerHTML = '';

  if (allSources.length === 0) {
    listContainer.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--color-text-muted);">暂无「${currentTypeFilter}」的来源数据</div>`;
    return;
  }

  // 按拼音首字母分组
  const groups = {};
  allSources.forEach(s => {
    const initial = getPinyinInitial(s);
    if (!groups[initial]) groups[initial] = [];
    groups[initial].push(s);
  });

  // 按字母顺序输出分组
  const sortedInitials = Object.keys(groups).sort();
  sortedInitials.forEach(initial => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'source-group';
    groupDiv.innerHTML = `<div class="source-group-letter">${initial}</div>`;
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'source-group-items';
    groups[initial].forEach(s => {
      const item = document.createElement('div');
      item.className = 'source-item' + (tempSources.includes(s) ? ' active' : '');
      item.textContent = s;
      item.addEventListener('click', () => toggleSource(s));
      itemsDiv.appendChild(item);
    });
    groupDiv.appendChild(itemsDiv);
    listContainer.appendChild(groupDiv);
  });
}

function toggleSource(s) {
  const idx = tempSources.indexOf(s);
  if (idx >= 0) tempSources.splice(idx, 1);
  else tempSources.push(s);
  renderSourceModal();
}

function bindSourceModal() {
  const modal = document.getElementById('source-modal');
  const btnOpen = document.getElementById('btn-source-filter');
  const btnClose = document.getElementById('btn-source-close');
  const overlay = modal.querySelector('.year-modal-overlay');
  const btnConfirm = document.getElementById('btn-source-confirm');
  const btnClear = document.getElementById('btn-source-clear');

  btnOpen.addEventListener('click', () => {
    tempSources = [...currentSources];
    renderSourceModal();
    modal.classList.add('show');
  });

  const closeModal = () => modal.classList.remove('show');
  btnClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);

  btnConfirm.addEventListener('click', () => {
    currentSources = [...tempSources];
    resetPage();
    closeModal();
    updateSourceFilterDisplay();
    render();
  });

  btnClear.addEventListener('click', () => {
    tempSources = [];
    renderSourceModal();
  });
}

function updateSourceFilterDisplay() {
  const countEl = document.getElementById('source-count');
  if (!countEl) return;
  if (currentSources.length === 0) {
    countEl.textContent = '';
  } else {
    countEl.textContent = ` (${currentSources.length})`;
  }
}

// 🔧 唯一可靠的「× 按钮显隐」判断：只看当前输入框真实的值
function updateSearchClearVisibility() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  if (!searchInput || !searchClear) return;
  searchClear.style.display = searchInput.value ? '' : 'none';
}

function bindEvents() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  // 输入框变化 → 同步关键词 + 切换 × 按钮显隐
  searchInput.addEventListener('input', (e) => {
    currentKeyword = e.target.value;
    resetPage();
    updateSearchClearVisibility();
    render();
  });

  // 初始状态：按当前输入框内容决定 × 按钮显隐
  updateSearchClearVisibility();

  // 点击 × → 清空搜索框 + 触发重新渲染
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      currentKeyword = '';
      resetPage();
      updateSearchClearVisibility();
      render();
      searchInput.focus();
    });
  }

  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      resetPage();
      render();
    });
  }

  // 导出按钮
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const stats = getStatistics();
      if (stats.localNew + stats.localModified + stats.localDeleted === 0) {
        if (!confirm('当前没有未保存的本地修改，确定要导出吗？')) return;
      }
      if (confirm(`将下载 data.js 文件（包含 ${stats.total} 条记录）。\n\n下载后操作步骤：\n1. 将下载的 data.js 文件移到 shiliao_website\\data\\ 文件夹\n2. 替换原有的 data.js 文件\n3. 刷新本网站\n\n是否继续？`)) {
        exportData();
        showToast('已导出 data.js，请按提示替换文件');
      }
    });
  }

  // 重置本地缓存按钮
  const resetBtn = document.getElementById('btn-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', clearLocalChanges);
  }
}

function render() {
  saveState();  // 每次渲染时保存状态
  updateUnsavedBanner(); // 🛡️ 同步未导出数据横幅
  let records = loadAllRecords();
  records = filterByType(records, currentTypeFilter);
  records = filterByTopic(records, currentTopicFilter);
  records = filterByImportance(records, currentImportance);
  records = filterByYears(records, currentYears);
  // 应用来源筛选：报刊文章/图像用 source，档案文件用 archive_holder，文学作品用 author
  if (currentTypeFilter === '报刊文章' || currentTypeFilter === '图像') {
    records = filterBySources(records, currentSources);
  } else if (currentTypeFilter === '档案文件') {
    records = filterByArchiveHolders(records, currentSources);
  } else if (currentTypeFilter === '文学作品') {
    records = filterByAuthors(records, currentSources);
  }
  records = searchRecords(records, currentKeyword);
  records = sortByTime(records, currentSort);

  // 📄 分页：算出总页数，规范当前页码，再切片得到本页要显示的卡片
  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = records.slice(startIdx, startIdx + PAGE_SIZE);

  // 更新计数（含页码信息）
  const meta = document.getElementById('results-meta');
  const stats = getStatistics();
  const pageInfo = totalPages > 1
    ? ` · 第 <strong>${currentPage}</strong> / ${totalPages} 页`
    : '';
  meta.innerHTML = `
    <div>
      <strong>${totalCount}</strong> 条记录${pageInfo}
      ${currentKeyword || currentTypeFilter || currentTopicFilter ? `（共 ${stats.total} 条）` : ''}
    </div>
    <div style="font-size: 12px; color: var(--color-text-muted);">
      ${getTodayWork() > 0 ? `<span style="color: var(--color-accent); margin-right: 12px;">今天共维护了 ${getTodayWork()} 条史料，蒸蚌！(๑•̀ㅂ•́)و✧</span>` : ''}
      本地新增 ${stats.localNew} · 修改 ${stats.localModified} · 删除 ${stats.localDeleted}
    </div>
  `;

  // 渲染卡片
  const grid = document.getElementById('cards-grid');
  if (totalCount === 0) {
    grid.innerHTML = '';
    grid.parentNode.replaceChild(makeEmpty(), grid);
    // 空状态时也清空分页
    const pag = document.getElementById('pagination');
    if (pag) pag.innerHTML = '';
    renderIncompleteSection();
    return;
  }

  // 重建 grid（如果之前被空状态替换了）
  let actualGrid = document.getElementById('cards-grid');
  if (!actualGrid) {
    actualGrid = document.createElement('div');
    actualGrid.id = 'cards-grid';
    document.querySelector('.main-container').appendChild(actualGrid);
  }
  // 根据视图模式选择 class 和渲染方式
  actualGrid.className = currentView === 'list' ? 'list-view' : 'cards-grid';
  actualGrid.innerHTML = '';

  // 列表视图：加表头
  if (currentView === 'list') {
    const header = document.createElement('div');
    header.className = 'list-header';
    header.innerHTML = `
      <div class="list-color"></div>
      <span class="list-type"></span>
      <div class="list-topics">议题</div>
      <div class="list-title">题名</div>
      <span class="list-meta">作者</span>
      <span class="list-meta">来源</span>
      <span class="list-meta">时间</span>
      <span class="list-meta">版次</span>
      <span class="list-importance">重要</span>
      <span class="list-docs">附件</span>
    `;
    actualGrid.appendChild(header);
  }

  // 渲染本页的内容
  pageRecords.forEach(r => {
    actualGrid.appendChild(
      currentView === 'list' ? createListRow(r) : createCard(r)
    );
  });

  // 渲染分页 UI
  renderPagination(totalPages);

  // 渲染「尚未完善史料」区块（独立于筛选，始终基于全部数据）
  renderIncompleteSection();
}

// 📄 分页 UI：1 2 3 ... 8 9 10 [下一页]
function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const items = [];
  // 上一页
  items.push({
    label: '上一页',
    page: currentPage - 1,
    disabled: currentPage === 1
  });

  // 页码（含省略号）
  getPageRange(currentPage, totalPages).forEach(p => {
    if (p === '...') items.push({ label: '…', ellipsis: true });
    else items.push({ label: String(p), page: p, active: p === currentPage });
  });

  // 下一页
  items.push({
    label: '下一页',
    page: currentPage + 1,
    disabled: currentPage === totalPages
  });

  container.innerHTML = items.map(it => {
    if (it.ellipsis) return `<span class="page-ellipsis">${it.label}</span>`;
    const cls = ['page-btn'];
    if (it.active) cls.push('active');
    if (it.disabled) cls.push('disabled');
    return `<button class="${cls.join(' ')}" data-page="${it.page}" ${it.disabled ? 'disabled' : ''}>${it.label}</button>`;
  }).join('');

  // 绑定点击
  container.querySelectorAll('.page-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = parseInt(btn.dataset.page, 10);
      if (!isNaN(target) && target !== currentPage) {
        currentPage = target;
        render();
        // 平滑滚动到卡片区顶部
        const grid = document.getElementById('cards-grid');
        if (grid) {
          const top = grid.getBoundingClientRect().top + window.scrollY - 180;
          window.scrollTo(0, Math.max(0, top));
        }
      }
    });
  });
}

// 算出页码序列：[1, '...', 4, 5, 6, '...', 30]
function getPageRange(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [1];
  if (current > 4) pages.push('...');
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 3) pages.push('...');
  pages.push(total);
  return pages;
}

/* ===================== 尚未完善史料 ===================== */

let incompleteCollapsed = false;

function renderIncompleteSection() {
  const allRecords = loadAllRecords();
  const incomplete = allRecords
    .map(r => ({ record: r, issues: getIncompleteIssues(r) }))
    .filter(x => x.issues.length > 0)
    // 按缺失项多少倒序：缺得越多越靠前
    .sort((a, b) => b.issues.length - a.issues.length);

  const countEl = document.getElementById('incomplete-count');
  const gridEl = document.getElementById('incomplete-grid');
  if (!countEl || !gridEl) return;

  countEl.textContent = incomplete.length;

  // 🆘 同步更新右下角浮动按钮
  const jumpBtn = document.getElementById('jump-to-incomplete');
  const jumpCount = document.getElementById('jump-incomplete-count');
  if (jumpBtn && jumpCount) {
    if (incomplete.length === 0) {
      jumpBtn.style.display = 'none';
    } else {
      jumpBtn.style.display = '';
      jumpCount.textContent = incomplete.length;
    }
  }

  if (incomplete.length === 0) {
    gridEl.innerHTML = `
      <div class="incomplete-empty">
        <img src="assets/cat-thumbsup.jpeg" alt="猫猫比大拇指" class="complete-cat-img" />
        <div class="complete-congrats">🎉🎉 伟大！🎉🎉</div>
      </div>`;
    return;
  }

  gridEl.innerHTML = incomplete.map(({ record, issues }) => `
    <div class="incomplete-card" data-id="${record.shiliao_id}">
      <div class="incomplete-card-row">
        <span class="incomplete-card-type">${TYPE_ICONS[record.type] || '📄'} ${escapeHtml(record.type)}</span>
        <a href="add.html?id=${encodeURIComponent(record.shiliao_id)}" class="incomplete-edit-link" title="直接编辑此史料" onclick="event.stopPropagation();">✏️</a>
      </div>
      <div class="incomplete-card-title">${escapeHtml(record.title || '(无标题)')}</div>
      <div class="incomplete-card-id">${record.shiliao_id}</div>
      <div class="incomplete-missing">
        ${issues.map(i => `<span class="missing-tag">${i}</span>`).join('')}
      </div>
    </div>
  `).join('');

  // 整卡点击 → 查看详情
  gridEl.querySelectorAll('.incomplete-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      location.href = `detail.html?id=${encodeURIComponent(card.dataset.id)}`;
    });
  });
}

function bindIncompleteToggle() {
  const btn = document.getElementById('btn-incomplete-toggle');
  const grid = document.getElementById('incomplete-grid');
  if (btn && grid) {
    btn.addEventListener('click', () => {
      incompleteCollapsed = !incompleteCollapsed;
      grid.style.display = incompleteCollapsed ? 'none' : '';
      btn.textContent = incompleteCollapsed ? '展开' : '收起';
    });
  }

  // 🆘 浮动跳转按钮：点击 → 自动展开 + 瞬间跳到尚未完善区域
  const jumpBtn = document.getElementById('jump-to-incomplete');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      // 如果是收起状态，先展开
      if (incompleteCollapsed && grid) {
        incompleteCollapsed = false;
        grid.style.display = '';
        const toggleBtn = document.getElementById('btn-incomplete-toggle');
        if (toggleBtn) toggleBtn.textContent = '收起';
      }
      // 瞬间跳到「尚未完善史料」区域（无动画）
      const section = document.getElementById('incomplete-section');
      if (section) {
        const top = section.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top);
      }
    });
  }

  // ⬆️ 浮动「回到顶部」按钮：仅在已下滑时显示，点击瞬间回顶
  const topBtn = document.getElementById('jump-to-top');
  if (topBtn) {
    topBtn.addEventListener('click', () => {
      window.scrollTo(0, 0);
    });
    // 监听滚动，决定 TOP 按钮的显隐（往下滑超过 200px 才出现）
    const updateTopBtnVisibility = () => {
      topBtn.style.display = window.scrollY > 200 ? '' : 'none';
    };
    window.addEventListener('scroll', updateTopBtnVisibility, { passive: true });
    updateTopBtnVisibility(); // 初始判断
  }
}

function makeEmpty() {
  const empty = document.createElement('div');
  empty.id = 'cards-grid';
  empty.className = 'empty-state';
  empty.innerHTML = `
    <div class="icon">📭</div>
    <div>没有匹配的史料记录</div>
    <div style="font-size: 12px; margin-top: 8px;">尝试调整筛选条件或搜索关键词</div>
  `;
  return empty;
}

function createCard(record) {
  const card = document.createElement('div');
  card.className = 'card';
  const color = getRecordPrimaryColor(record);
  card.style.setProperty('--card-color', color);

  const typeIcon = TYPE_ICONS[record.type] || '📄';
  const importance = IMPORTANCE_LABELS[record.importance] || '';
  const topics = (record.topics || []).map(t =>
    `<span class="card-topic-tag" style="background: ${getTopicColor(t)}">${escapeHtml(t)}</span>`
  ).join('');

  const docCount = (record.document_paths || []).length;
  const hasDocs = docCount > 0;

  // 如果有搜索关键词，对标题和内容进行高亮
  const kw = record._searchKeyword || '';
  const titleText = kw ? highlightText(record.title || '(无标题)', kw) : escapeHtml(record.title || '(无标题)');
  const contentText = kw ? highlightText(record.core_content || '(暂无内容描述)', kw) : escapeHtml(record.core_content || '(暂无内容描述)');

  // 如果关键词命中 Word 全文（但标题/核心内容里没有），显示一段高亮摘要
  let docxSnippet = '';
  if (kw && record.docx_preview_text) {
    const inTitle = (record.title || '').toLowerCase().includes(kw);
    const inCore = (record.core_content || '').toLowerCase().includes(kw);
    const inDocx = record.docx_preview_text.toLowerCase().includes(kw);
    if (inDocx && !inTitle && !inCore) {
      docxSnippet = `<div class="card-docx-snippet">📄 原文摘录：${makeSnippet(record.docx_preview_text, kw)}</div>`;
    }
  }

  // 带关键词的详情链接
  const kwParam = kw ? `&kw=${encodeURIComponent(kw)}` : '';

  card.innerHTML = `
    <div class="card-header">
      <span class="card-type">${typeIcon} ${escapeHtml(record.type)}</span>
      <span class="card-importance">${importance}</span>
    </div>
    ${topics ? `<div class="card-topics">${topics}</div>` : ''}
    <h3 class="card-title">${titleText}</h3>
    <div class="card-meta">
      ${record.source ? `<span>📍 ${escapeHtml(record.source)}</span>` : ''}
      ${record.author ? `<span>✍️ ${escapeHtml(record.author)}</span>` : ''}
      ${record.time ? `<span>📅 ${escapeHtml(record.time)}</span>` : ''}
      ${record.version_info ? `<span>📑 ${escapeHtml(record.version_info)}</span>` : ''}
    </div>
    <div class="card-content">${contentText}</div>
    ${docxSnippet}
    <div class="card-actions">
      <a href="detail.html?id=${encodeURIComponent(record.shiliao_id)}${kwParam}" class="card-btn primary">查看详情</a>
      ${hasDocs ? `<a href="detail.html?id=${encodeURIComponent(record.shiliao_id)}&open=1${kwParam}" class="card-btn">📎 ${docCount} 个原文</a>` : '<span class="card-btn" style="opacity:0.5;cursor:default;">无原文</span>'}
    </div>
  `;

  // 整卡点击跳转
  card.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return;
    location.href = `detail.html?id=${encodeURIComponent(record.shiliao_id)}${kwParam}`;
  });

  return card;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 对文本进行关键词高亮（黄色背景）
function highlightText(text, keyword) {
  if (!text || !keyword) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const kw = escapeHtml(keyword);
  const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark style="background-color: #FFFF99; padding: 0 2px;">$1</mark>');
}

// 从长文本中截取关键词附近的片段，并高亮（用于卡片摘要）
function makeSnippet(text, keyword, radius = 30) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return highlightText(snippet, keyword);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', init);
