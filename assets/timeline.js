// 同期史料浏览：只纳入能解析出完整年月日的记录
(function () {
  const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.INITIAL_DATA || []);
  const exact = records.map(record => ({ record, date: parseExactDate(record.time) })).filter(item => item.date);
  const groups = new Map();
  exact.forEach(item => {
    if (!groups.has(item.date.key)) groups.set(item.date.key, []);
    groups.get(item.date.key).push(item.record);
  });

  const years = [...new Set(exact.map(item => item.date.year))].sort((a, b) => a - b);
  const yearSelect = document.getElementById('year-select');
  const monthSelect = document.getElementById('month-select');
  const dateList = document.getElementById('date-list');
  const recordList = document.getElementById('record-list');
  const heading = document.getElementById('selected-date-heading');
  const summary = document.getElementById('timeline-summary');
  let selectedKey = '';

  function parseExactDate(value) {
    const s = String(value || '');
    const match = s.match(/(18\d{2}|19\d{2}|20\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日)?/);
    if (!match) return null;
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const check = new Date(year, month - 1, day);
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
    return { year, month, day, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  }

  function formatDate(key) {
    const [y, m, d] = key.split('-');
    return `${y}年${Number(m)}月${Number(d)}日`;
  }

  function filteredKeys() {
    const y = Number(yearSelect.value); const m = Number(monthSelect.value);
    return [...groups.keys()].filter(key => {
      const d = key.split('-').map(Number);
      return d[0] === y && (!m || d[1] === m);
    }).sort();
  }

  function renderMonths() {
    const year = Number(yearSelect.value);
    const months = [...new Set(exact.filter(item => item.date.year === year).map(item => item.date.month))].sort((a, b) => a - b);
    const previous = Number(monthSelect.value);
    monthSelect.innerHTML = '<option value="0">全年</option>' + months.map(m => `<option value="${m}">${m}月</option>`).join('');
    if (months.includes(previous)) monthSelect.value = previous;
  }

  function renderDates(preferredKey) {
    const keys = filteredKeys();
    dateList.innerHTML = keys.length ? keys.map(key => `<button class="date-item${key === (preferredKey || selectedKey) ? ' active' : ''}" data-key="${key}"><span>${formatDate(key)}</span><span class="date-count">${groups.get(key).length} 条</span></button>`).join('') : '<div class="timeline-empty">这个时期还没有完整日期的史料。</div>';
    dateList.querySelectorAll('.date-item').forEach(button => button.addEventListener('click', () => selectDate(button.dataset.key)));
    summary.textContent = `${keys.length} 个日期 · ${keys.reduce((n, key) => n + groups.get(key).length, 0)} 条史料`;
    if (keys.length) selectDate((preferredKey && keys.includes(preferredKey)) ? preferredKey : (keys.includes(selectedKey) ? selectedKey : keys[0]));
    else { selectedKey = ''; heading.textContent = ''; recordList.innerHTML = ''; }
  }

  function selectDate(key) {
    selectedKey = key;
    dateList.querySelectorAll('.date-item').forEach(button => button.classList.toggle('active', button.dataset.key === key));
    const dayRecords = groups.get(key) || [];
    heading.innerHTML = `${formatDate(key)}<small>${dayRecords.length} 条史料</small>`;
    recordList.innerHTML = dayRecords.map(record => {
      const color = typeof getRecordPrimaryColor === 'function' ? getRecordPrimaryColor(record) : '#8b2c3c';
      const topics = (record.topics || []).slice(0, 3).map(topic => `<span class="timeline-tag" style="background:${colorFor(topic)}">${escapeText(topic)}</span>`).join('');
      const summaryText = record.core_content || record.personal_analysis || '暂无内容摘要';
      return `<article class="timeline-record" data-id="${escapeText(record.shiliao_id)}"><div class="timeline-record-color" style="background:${color}"></div><div class="timeline-record-content"><div class="timeline-record-meta">${escapeText(record.type || '史料')} · ${escapeText(record.source || '来源未详')} ${record.author ? `· ${escapeText(record.author)}` : ''}</div><div class="timeline-record-title">${escapeText(record.title || '未命名史料')}</div><div class="timeline-record-summary">${escapeText(summaryText)}</div><div class="timeline-tags">${topics}</div></div></article>`;
    }).join('');
    recordList.querySelectorAll('.timeline-record').forEach(card => card.addEventListener('click', () => { location.href = `detail.html?id=${encodeURIComponent(card.dataset.id)}`; }));
  }

  function colorFor(topic) { return typeof getTopicColor === 'function' ? getTopicColor(topic) : '#8b2c3c'; }
  function escapeText(value) { return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  yearSelect.innerHTML = years.map(year => `<option value="${year}">${year}年</option>`).join('');
  if (!years.length) { summary.textContent = '暂无完整日期史料'; return; }
  yearSelect.value = years[0]; renderMonths(); renderDates();
  yearSelect.addEventListener('change', () => { monthSelect.value = '0'; renderMonths(); renderDates(); });
  monthSelect.addEventListener('change', () => renderDates());
  document.getElementById('all-dates').addEventListener('click', () => { monthSelect.value = '0'; renderDates(); });
})();
