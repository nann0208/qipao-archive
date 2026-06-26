// 数据存储模块 - 负责合并初始数据与本地修改

const STORAGE_KEYS = {
  OVERRIDES: 'shiliao_overrides_v1',
  NEW_RECORDS: 'shiliao_new_v1',
  DELETED: 'shiliao_deleted_v1'
};

// 主题配色（与 style.css 同步）
const TOPIC_COLORS = {
  '旗袍流行款式': '#8B2C3C',
  '性别议题': '#C97B89',
  '消费生活': '#D4B26A',
  '轻工业业态': '#3E5641',
  '外贸': '#2C3E5C',
  '服制条例': '#3A78BC',
  '服装制作工艺': '#A0573B',
  '民族国家': '#B977CB'
};

const TYPE_ICONS = {
  '报刊文章': '📰',
  '专著': '📖',
  '档案文件': '📜',
  '图像': '🖼️',
  '文学作品': '✒️'
};

const IMPORTANCE_LABELS = {
  3: '⭐⭐⭐ 核心',
  2: '⭐⭐ 参考',
  1: '⭐ 备用'
};

const ALL_TOPICS = [
  '旗袍流行款式', '性别议题', '消费生活', '轻工业业态',
  '外贸', '服制条例', '服装制作工艺', '民族国家'
];

const ALL_TYPES = ['报刊文章', '专著', '档案文件', '图像', '文学作品'];

// 类型专属配色（只为需要醒目区分的类型设置；未列出的用默认强调色）
const TYPE_CHIP_COLORS = {};

function getOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.OVERRIDES) || '{}');
  } catch (e) {
    return {};
  }
}

function getNewRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.NEW_RECORDS) || '[]');
  } catch (e) {
    return [];
  }
}

function getDeleted() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.DELETED) || '[]');
  } catch (e) {
    return [];
  }
}

// 加载所有记录（合并初始数据 + localStorage 修改 + 新增 - 删除）
function loadAllRecords() {
  const initial = window.INITIAL_DATA || [];
  const overrides = getOverrides();
  const newRecords = getNewRecords();
  const deleted = new Set(getDeleted());

  const merged = initial
    .filter(r => !deleted.has(r.shiliao_id))
    .map(r => overrides[r.shiliao_id] ? { ...r, ...overrides[r.shiliao_id] } : r);

  const combined = [...merged, ...newRecords.filter(r => !deleted.has(r.shiliao_id))];

  // 🛡️ 按 shiliao_id 去重：防止脏数据导致同一条史料重复显示
  // （保留首次出现的版本；后续相同 id 的丢弃）
  const seen = new Set();
  const deduped = [];
  for (const r of combined) {
    if (!r.shiliao_id) { deduped.push(r); continue; }
    if (seen.has(r.shiliao_id)) continue;
    seen.add(r.shiliao_id);
    deduped.push(r);
  }
  return deduped;
}

function getRecord(id) {
  const all = loadAllRecords();
  return all.find(r => r.shiliao_id === id);
}

// 🧹 清理 localStorage 里的脏数据（重复的新增记录 / 与初始数据 id 冲突的记录）
// 返回清理了多少条。供首页启动时自动调用。
function cleanupDuplicates() {
  const initialIds = new Set((window.INITIAL_DATA || []).map(r => r.shiliao_id));
  const newRecords = getNewRecords();
  const seen = new Set();
  const cleaned = [];
  let removed = 0;

  for (const r of newRecords) {
    // 与初始数据 id 冲突的新增记录 → 丢弃（初始数据优先）
    if (initialIds.has(r.shiliao_id)) { removed++; continue; }
    // newRecords 内部重复 → 只留第一条
    if (seen.has(r.shiliao_id)) { removed++; continue; }
    seen.add(r.shiliao_id);
    cleaned.push(r);
  }

  if (removed > 0) {
    localStorage.setItem(STORAGE_KEYS.NEW_RECORDS, JSON.stringify(cleaned));
    backupToIDB();
  }
  return removed;
}

// 生成新的史料编号
function generateNewId() {
  const all = loadAllRecords();
  const year = new Date().getFullYear();
  const prefix = `SL-${year}-`;
  const yearRecords = all.filter(r => r.shiliao_id && r.shiliao_id.startsWith(prefix));
  const maxNum = yearRecords.reduce((max, r) => {
    const num = parseInt(r.shiliao_id.split('-')[2]) || 0;
    return Math.max(max, num);
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

// 添加新记录
function addRecord(record) {
  if (!record.shiliao_id) record.shiliao_id = generateNewId();
  if (!record.created_at) record.created_at = new Date().toISOString();
  record.updated_at = new Date().toISOString();

  const newRecords = getNewRecords();
  newRecords.push(record);
  localStorage.setItem(STORAGE_KEYS.NEW_RECORDS, JSON.stringify(newRecords));
  backupToIDB(); // 🛡️ 自动备份到 IndexedDB
  markModified(); // 📝 记录修改时间，用于横幅状态判断
  bumpTodayWork(); // 📅 今日工作量 +1
  return record;
}

// 更新记录
// countAsWork: 是否计入"今日工作量"（批注等内部调用传 false）
function updateRecord(id, updates, countAsWork = true) {
  const initial = window.INITIAL_DATA || [];
  const isInitial = initial.some(r => r.shiliao_id === id);

  if (isInitial) {
    // 来自初始数据 -> 写入 overrides
    const overrides = getOverrides();
    overrides[id] = { ...(overrides[id] || {}), ...updates, updated_at: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEYS.OVERRIDES, JSON.stringify(overrides));
  } else {
    // 用户新增的 -> 直接修改 newRecords
    const newRecords = getNewRecords();
    const idx = newRecords.findIndex(r => r.shiliao_id === id);
    if (idx >= 0) {
      newRecords[idx] = { ...newRecords[idx], ...updates, updated_at: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEYS.NEW_RECORDS, JSON.stringify(newRecords));
    } else {
      // 🛡️ 兜底：既不在 INITIAL_DATA、也不在 newRecords 中
      // 这通常发生在 data.js 加载失败的情况下。把修改写入 overrides，
      // 这样将来 data.js 修好后，修改会正确合并到目标记录上 —— 防止 silently 丢失数据
      console.warn(`[updateRecord] 记录 ${id} 不在 INITIAL_DATA 也不在 newRecords 中。已写入 overrides 兜底保存。`);
      const overrides = getOverrides();
      overrides[id] = { ...(overrides[id] || {}), ...updates, updated_at: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEYS.OVERRIDES, JSON.stringify(overrides));
    }
  }
  backupToIDB(); // 🛡️ 自动备份到 IndexedDB
  markModified(); // 📝 记录修改时间，用于横幅状态判断
  if (countAsWork) bumpTodayWork(); // 📅 今日工作量 +1（批注等内部调用不计）
}

// 删除记录
function deleteRecord(id) {
  const initial = window.INITIAL_DATA || [];
  const isInitial = initial.some(r => r.shiliao_id === id);

  if (isInitial) {
    const deleted = getDeleted();
    if (!deleted.includes(id)) {
      deleted.push(id);
      localStorage.setItem(STORAGE_KEYS.DELETED, JSON.stringify(deleted));
    }
  } else {
    const newRecords = getNewRecords().filter(r => r.shiliao_id !== id);
    localStorage.setItem(STORAGE_KEYS.NEW_RECORDS, JSON.stringify(newRecords));
  }
  backupToIDB(); // 🛡️ 自动备份到 IndexedDB
  markModified(); // 📝 记录修改时间，用于横幅状态判断
}

// 全文搜索（附带关键词标记以供高亮）
function searchRecords(records, keyword) {
  if (!keyword || !keyword.trim()) return records;
  const kw = keyword.trim().toLowerCase();
  const result = records.filter(r => {
    const haystack = [
      r.title, r.source, r.author, r.time, r.version_info,
      r.core_content, r.personal_analysis, r.quotes,
      r.docx_preview_text,
      ...(r.topics || []), ...(r.keywords || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(kw);
  });
  // 为搜索结果标记关键词，供卡片渲染时高亮
  result.forEach(r => {
    r._searchKeyword = kw;
  });
  return result;
}

// 按类型筛选
function filterByType(records, type) {
  if (!type) return records;
  return records.filter(r => r.type === type);
}

// 按议题筛选
function filterByTopic(records, topic) {
  if (!topic) return records;
  return records.filter(r => (r.topics || []).includes(topic));
}

// 检查一条史料是否"未完善"，返回缺失字段列表
function getIncompleteIssues(r) {
  if (!r) return [];
  const issues = [];
  if (!r.title || !r.title.trim()) issues.push('缺少题名');
  if (!r.source || !r.source.trim()) issues.push('缺少来源');
  if (!r.author || !r.author.trim()) issues.push('缺少作者');
  if (!r.time || !r.time.trim()) issues.push('缺少时间');
  if (!r.core_content || !r.core_content.trim()) issues.push('缺少核心内容');
  if (!r.topics || r.topics.length === 0) issues.push('缺少议题');
  // 没有任何关联文件 或 有 docx 但未提取文字 → 提醒
  const hasDocs = r.document_paths && r.document_paths.length > 0;
  const hasDocxButNoText = hasDocs
    && r.document_paths.some(p => p.toLowerCase().endsWith('.docx'))
    && (!r.docx_preview_text || !r.docx_preview_text.trim());
  if (!hasDocs) issues.push('缺少原文档案');
  else if (hasDocxButNoText) issues.push('Word未提取');
  return issues;
}

// 添加一条批注
function addAnnotation(recordId, annotation) {
  const r = getRecord(recordId);
  if (!r) return null;
  const annotations = (r.annotations || []).slice();
  const newAnn = {
    id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    text: annotation.text,
    start: annotation.start,
    end: annotation.end,
    note: annotation.note || '',
    created_at: new Date().toISOString()
  };
  annotations.push(newAnn);
  updateRecord(recordId, { annotations }, false); // 批注不计入今日工作量
  return newAnn;
}

// 修改批注
function updateAnnotation(recordId, annId, updates) {
  const r = getRecord(recordId);
  if (!r) return;
  const annotations = (r.annotations || []).map(a =>
    a.id === annId ? { ...a, ...updates } : a
  );
  updateRecord(recordId, { annotations }, false); // 批注不计入今日工作量
}

// 删除批注
function deleteAnnotation(recordId, annId) {
  const r = getRecord(recordId);
  if (!r) return;
  const annotations = (r.annotations || []).filter(a => a.id !== annId);
  updateRecord(recordId, { annotations }, false); // 批注不计入今日工作量
}

/* ============================================================
 * 🛡️ 数据备份系统：双重存储 + 自动备份
 * ============================================================
 * 主存储：localStorage（可能被浏览器清理）
 * 备份层：IndexedDB（更大容量、清理策略不同，作为保险）
 * 每次写入 localStorage 时，同步备份到 IndexedDB
 * 页面加载时如果发现 localStorage 空了但 IndexedDB 有数据，自动恢复
 * ============================================================ */

const IDB_NAME = 'shiliao_backup_db';
const IDB_STORE = 'snapshots';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 备份当前 localStorage 状态到 IndexedDB
async function backupToIDB() {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const snapshot = {
      overrides: getOverrides(),
      newRecords: getNewRecords(),
      deleted: getDeleted(),
      savedAt: new Date().toISOString()
    };
    store.put(snapshot, 'main');
    // 同时保留历史快照（每天一份，最多 7 份）
    const today = new Date().toISOString().slice(0, 10);
    store.put(snapshot, 'day_' + today);
    return new Promise(resolve => { tx.oncomplete = resolve; });
  } catch (e) {
    console.warn('[备份] IndexedDB 写入失败:', e);
  }
}

// 从 IndexedDB 读取备份（不自动恢复，需用户确认）
async function readIDBBackup(key = 'main') {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

// 从 IndexedDB 备份恢复 localStorage
function restoreFromBackup(snapshot) {
  if (!snapshot) return false;
  if (snapshot.overrides) localStorage.setItem(STORAGE_KEYS.OVERRIDES, JSON.stringify(snapshot.overrides));
  if (snapshot.newRecords) localStorage.setItem(STORAGE_KEYS.NEW_RECORDS, JSON.stringify(snapshot.newRecords));
  if (snapshot.deleted) localStorage.setItem(STORAGE_KEYS.DELETED, JSON.stringify(snapshot.deleted));
  return true;
}

// 启动时检查：如果 localStorage 空了但 IndexedDB 有数据，提示恢复
async function checkAndRestoreBackup() {
  const ls_new = getNewRecords();
  const ls_overrides = getOverrides();
  const ls_deleted = getDeleted();
  const lsEmpty = ls_new.length === 0 &&
                  Object.keys(ls_overrides).length === 0 &&
                  ls_deleted.length === 0;

  if (!lsEmpty) return; // localStorage 有数据，无需恢复

  const backup = await readIDBBackup('main');
  if (!backup) return;

  const newCount = (backup.newRecords || []).length;
  const overrideCount = Object.keys(backup.overrides || {}).length;
  const deletedCount = (backup.deleted || []).length;
  const total = newCount + overrideCount + deletedCount;
  if (total === 0) return;

  const time = new Date(backup.savedAt).toLocaleString('zh-CN');
  const msg = `🛡️ 发现 IndexedDB 备份！\n\n` +
    `本地 localStorage 当前为空，但 IndexedDB 备份显示你曾有：\n` +
    `  • ${newCount} 条新增记录\n` +
    `  • ${overrideCount} 条修改\n` +
    `  • ${deletedCount} 条删除\n\n` +
    `备份时间：${time}\n\n` +
    `是否立即恢复？（强烈建议立即恢复并导出 data.js 永久保存）`;

  if (confirm(msg)) {
    restoreFromBackup(backup);
    alert('✓ 已恢复！请立即点击「⬇ 导出」按钮，将数据保存到 data.js 文件！');
    location.reload();
  }
}

// 记录最后一次导出时间
function markExported() {
  localStorage.setItem('shiliao_last_export', new Date().toISOString());
}

// 记录最后一次本地数据修改时间（任何 add/update/delete 都触发）
function markModified() {
  localStorage.setItem('shiliao_last_modify', new Date().toISOString());
}

// 获取"今天"的本地日历日期 YYYY-MM-DD（按用户所在时区，而非 UTC）
function getLocalDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readDailyWork() {
  try {
    return JSON.parse(localStorage.getItem('shiliao_daily_work') || '{}');
  } catch (e) {
    return {};
  }
}

// 一次性迁移：把旧的 UTC 日期 key 的计数合并到本地日期 key
// （只在首次需要时运行，避免因时区切换导致今天的计数“突然归零”）
function migrateDailyWorkToLocal() {
  const data = readDailyWork();
  const localToday = getLocalDateStr();
  // 旧 UTC “今天”
  const utcToday = new Date().toISOString().slice(0, 10);
  if (utcToday !== localToday && data[utcToday] && !data['_migrated_' + localToday]) {
    // 把 UTC-今天 的计数并入 本地-今天
    data[localToday] = (data[localToday] || 0) + data[utcToday];
    delete data[utcToday];
    data['_migrated_' + localToday] = 1; // 标记已迁移，避免重复
    localStorage.setItem('shiliao_daily_work', JSON.stringify(data));
  }
}

// 记录"今天"的维护工作量（新增 + 修改各算一次）
function bumpTodayWork() {
  const today = getLocalDateStr();
  const data = readDailyWork();
  data[today] = (data[today] || 0) + 1;
  // 只保留最近 30 个日期 key（忽略迁移标记），避免无限增长
  const dateKeys = Object.keys(data).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  while (dateKeys.length > 30) {
    delete data[dateKeys.shift()];
  }
  localStorage.setItem('shiliao_daily_work', JSON.stringify(data));
}

// 获取"今天"的维护工作量
function getTodayWork() {
  migrateDailyWorkToLocal();
  const today = getLocalDateStr();
  const data = readDailyWork();
  return data[today] || 0;
}

// 判断当前本地数据是否处于"已安全导出"状态
// 即：上次导出时间 >= 上次修改时间（导出后没再改过）
function isDataSafelyExported() {
  const exp = localStorage.getItem('shiliao_last_export');
  const mod = localStorage.getItem('shiliao_last_modify');
  if (!exp) return false; // 从未导出
  if (!mod) return true;  // 从未修改过，视为已导出
  return new Date(exp) >= new Date(mod);
}

function getLastExportInfo() {
  const ts = localStorage.getItem('shiliao_last_export');
  if (!ts) return { time: null, text: '从未导出', hoursAgo: Infinity };
  const date = new Date(ts);
  const hoursAgo = (Date.now() - date.getTime()) / 3600000;
  let text;
  if (hoursAgo < 1) text = '不到 1 小时前';
  else if (hoursAgo < 24) text = `${Math.floor(hoursAgo)} 小时前`;
  else text = `${Math.floor(hoursAgo / 24)} 天前`;
  return { time: date, text, hoursAgo };
}

// 按重要程度筛选
function filterByImportance(records, importance) {
  if (!importance) return records;
  return records.filter(r => r.importance === importance);
}

// 按来源（刊物名称）筛选（支持多选）
function filterBySources(records, sourcesArray) {
  if (!sourcesArray || sourcesArray.length === 0) return records;
  const set = new Set(sourcesArray);
  return records.filter(r => r.source && set.has(r.source.trim()));
}

// 获取指定类型的所有不重复来源（按拼音排序）
// 不传 type 则返回所有类型的来源
function getSourcesByType(type) {
  const all = loadAllRecords();
  const sources = new Set();
  all.forEach(r => {
    if ((!type || r.type === type) && r.source && r.source.trim()) {
      sources.add(r.source.trim());
    }
  });
  return Array.from(sources).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

// 获取指定类型的所有不重复作者（按拼音排序）
function getAuthorsByType(type) {
  const all = loadAllRecords();
  const authors = new Set();
  all.forEach(r => {
    if ((!type || r.type === type) && r.author && r.author.trim()) {
      authors.add(r.author.trim());
    }
  });
  return Array.from(authors).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

// 按作者筛选（支持多选）
function filterByAuthors(records, authorsArray) {
  if (!authorsArray || authorsArray.length === 0) return records;
  const set = new Set(authorsArray);
  return records.filter(r => r.author && set.has(r.author.trim()));
}

// 保留旧函数名作为兼容别名
function getNewspaperSources() {
  return getSourcesByType('报刊文章');
}

// 获取档案文件的收藏机构（档案馆）。
// 已有档案记录未填该字段则默认归为「上海市档案馆」。
function getArchiveHolder(record) {
  if (record && record.archive_holder && record.archive_holder.trim()) {
    return record.archive_holder.trim();
  }
  return '上海市档案馆';
}

// 获取所有档案文件的不重复收藏机构（按拼音排序）
function getArchiveHolders() {
  const all = loadAllRecords();
  const holders = new Set();
  all.forEach(r => {
    if (r.type === '档案文件') {
      holders.add(getArchiveHolder(r));
    }
  });
  return Array.from(holders).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

// 按档案馆（收藏机构）筛选
function filterByArchiveHolders(records, holdersArray) {
  if (!holdersArray || holdersArray.length === 0) return records;
  const set = new Set(holdersArray);
  return records.filter(r => set.has(getArchiveHolder(r)));
}

// 获取字符串的拼音首字母（用于分组显示）
function getPinyinInitial(str) {
  if (!str) return '#';
  const ch = str.charAt(0);
  // 英文字母直接返回
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  // 数字归为 #
  if (/[0-9]/.test(ch)) return '#';
  // 中文：根据 Unicode 范围估算（基于 GB2312 拼音区间）
  if (/[一-龥]/.test(ch)) {
    // 用 localeCompare 比较法判断首字母分组
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'W', 'X', 'Y', 'Z'];
    // 每个字母对应的"分界汉字"（用于二分判断）
    const boundaries = ['啊', '芭', '擦', '搭', '蛾', '发', '噶', '哈', '击', '咖', '垃', '妈', '拿', '哦', '啪', '期', '然', '撒', '塌', '挖', '昔', '压', '匝'];
    for (let i = letters.length - 1; i >= 0; i--) {
      if (ch.localeCompare(boundaries[i], 'zh-Hans-CN') >= 0) {
        return letters[i];
      }
    }
    return 'A';
  }
  return '#';
}

// 按年份筛选（支持多选）
function filterByYears(records, yearsArray) {
  if (!yearsArray || yearsArray.length === 0) return records;
  const yearSet = new Set(yearsArray);
  return records.filter(r => {
    const year = parseYear(r.time);
    return year !== null && yearSet.has(year);
  });
}

// 获取所有不重复的年份（从记录中提取并排序）
function getAllYears(records) {
  const years = new Set();
  records.forEach(r => {
    const y = parseYear(r.time);
    if (y !== null) years.add(y);
  });
  return Array.from(years).sort((a, b) => a - b);
}

// 导出最新数据为 data.js 文件
function exportData() {
  const all = loadAllRecords();
  const stats = getStatistics();
  const content = `// 民国海派旗袍史料库 - 数据
// 导出时间: ${new Date().toLocaleString('zh-CN')}
// 共 ${all.length} 条记录（含本地新增 ${stats.localNew} / 修改 ${stats.localModified} / 删除 ${stats.localDeleted}）
//
// 【使用方法】将本文件移入 data\\ 文件夹，覆盖原 data.js，
// 然后在网站上点击"重置本地缓存"按钮即可。

window.INITIAL_DATA = ${JSON.stringify(all, null, 2)};
`;

  const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `data.js`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  markExported(); // 记录导出时间，用于横幅提醒
}

// 清除所有本地修改（在用户替换了 data.js 之后调用）—— 强化版
function clearLocalChanges() {
  const stats = getStatistics();
  const unsaved = stats.localNew + stats.localModified + stats.localDeleted;

  if (unsaved === 0) {
    alert('当前没有任何本地修改，无需重置。');
    return;
  }

  const lastExport = getLastExportInfo();
  const warning =
    `⚠️⚠️⚠️ 危险操作！这将永久清除以下本地数据：\n\n` +
    `  • 新增 ${stats.localNew} 条\n` +
    `  • 修改 ${stats.localModified} 条\n` +
    `  • 删除标记 ${stats.localDeleted} 条\n\n` +
    `上次导出 data.js：${lastExport.text}\n\n` +
    `❗ 请先确认：\n` +
    `  1. 你已经点击「⬇ 导出」下载了 data.js\n` +
    `  2. 你已经把下载的 data.js 移到了 data/ 文件夹\n` +
    `  3. 你已经覆盖了原 data.js 文件\n\n` +
    `如要继续，请在下一个对话框中输入：我已备份`;

  if (!confirm(warning)) return;

  const code = prompt('请输入「我已备份」以确认清除（区分大小写、不含引号）：');
  if (code !== '我已备份') {
    alert('已取消。你的数据安然无恙。');
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.OVERRIDES);
  localStorage.removeItem(STORAGE_KEYS.NEW_RECORDS);
  localStorage.removeItem(STORAGE_KEYS.DELETED);
  // 注意：故意不清除 shiliao_daily_work（今日工作量）和 shiliao_last_export，
  // 让"今天共维护了 X 条"的计数在导出/重置后保持连贯。
  alert('已清除。请刷新页面。');
  location.reload();
}

// 获取统计信息
function getStatistics() {
  const all = loadAllRecords();
  const byType = {};
  const byTopic = {};

  all.forEach(r => {
    byType[r.type] = (byType[r.type] || 0) + 1;
    (r.topics || []).forEach(t => {
      byTopic[t] = (byTopic[t] || 0) + 1;
    });
  });

  return {
    total: all.length,
    initial: (window.INITIAL_DATA || []).length,
    localNew: getNewRecords().length,
    localModified: Object.keys(getOverrides()).length,
    localDeleted: getDeleted().length,
    byType,
    byTopic
  };
}

// 从时间字符串中解析年份（4位数字，范围 1800-2099）
function parseYear(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/(1[89]\d{2}|20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

// 解析用于排序的时间值（年*10000 + 月*100 + 日），无法解析返回 null
function parseTimeValue(timeStr) {
  if (!timeStr) return null;
  const s = String(timeStr);
  const ym = s.match(/(1[89]\d{2}|20\d{2})/);
  if (!ym) return null;
  const year = parseInt(ym[1], 10);
  let month = 0, day = 0;
  // 匹配 yyyy-mm-dd / yyyy.m.d / yyyy年m月d日 等
  const full = s.match(/(1[89]\d{2}|20\d{2})\s*[-./年]\s*(\d{1,2})(?:\s*[-./月]\s*(\d{1,2}))?/);
  if (full) {
    month = parseInt(full[2], 10) || 0;
    day = parseInt(full[3], 10) || 0;
  }
  return year * 10000 + month * 100 + day;
}

// 按时间排序（order: 'asc' 正序 / 'desc' 倒序 / 空字符串保持原顺序）
// 无法解析时间的记录始终排在最后
function sortByTime(records, order) {
  if (!order) return records;
  const arr = records.map((r, i) => ({ r, v: parseTimeValue(r.time), i }));
  arr.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (a.v === b.v) return a.i - b.i;
    return order === 'asc' ? a.v - b.v : b.v - a.v;
  });
  return arr.map(x => x.r);
}

// 工具函数：根据议题获取颜色
function getTopicColor(topic) {
  return TOPIC_COLORS[topic] || '#888';
}

// 工具函数：根据记录的第一个议题获取主色
function getRecordPrimaryColor(record) {
  if (!record.topics || record.topics.length === 0) return '#888';
  return getTopicColor(record.topics[0]);
}
