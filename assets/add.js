// 添加/编辑表单逻辑

let editingId = null;
let relatedRecords = []; // [{id, relation}]
let aiSelectedFiles = [];
let aiPreviewUrls = [];
let aiSuggestedHighlights = [];

const SUGGESTED_KEYWORDS = [
  '高开叉', '海派', '现代', '保守', '西化', '传统',
  '女性权益', '时代审美', '手工艺', '消费文化',
  '贸易', '国货', '平等', '现代化', '月份牌'
];

function init() {
  const params = new URLSearchParams(location.search);
  editingId = params.get('id');

  // AI 中间服务只在本机运行，公开网页端不显示该入口。
  const isLocalSite = location.hostname.includes('localhost') || location.hostname.includes('127.0.0.1');
  const aiGroup = document.querySelector('.ai-analysis-group');
  if (aiGroup && !isLocalSite) aiGroup.style.display = 'none';

  if (editingId) {
    const r = getRecord(editingId);
    if (r) {
      document.getElementById('form-title').textContent = '编辑史料';
      fillForm(r);
    } else {
      alert('未找到该记录');
      location.href = 'index.html';
      return;
    }
  }

  renderTopicChips();
  renderImportance();
  renderKeywordSuggestions();
  renderOpinionTypeChips();
  bindEvents();
  bindRelatedSearch();
  updateOpinionTypeVisibility(); // 确保初始状态正确显示/隐藏
}

function renderOpinionTypeChips() {
  const container = document.getElementById('opinion-type-chips');
  if (!container) return;
  container.innerHTML = '';
  OPINION_TYPES.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'checkbox-chip';
    chip.textContent = t;
    chip.dataset.value = t;
    chip.style.setProperty('--chip-color', getOpinionTypeColor(t));
    chip.addEventListener('click', () => {
      chip.classList.toggle('checked');
    });
    container.appendChild(chip);
  });
}

function renderTopicChips() {
  const container = document.getElementById('topics-chips');
  container.innerHTML = '';
  ALL_TOPICS.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'checkbox-chip';
    chip.textContent = t;
    chip.dataset.value = t;
    chip.style.setProperty('--chip-color', getTopicColor(t));
    chip.addEventListener('click', () => {
      chip.classList.toggle('checked');
    });
    container.appendChild(chip);
  });
}

function renderImportance() {
  const container = document.getElementById('importance-chips');
  container.innerHTML = '';
  [3, 2, 1].forEach(level => {
    const chip = document.createElement('span');
    chip.className = 'checkbox-chip';
    chip.textContent = IMPORTANCE_LABELS[level];
    chip.dataset.value = level;
    chip.style.setProperty('--chip-color', '#8B2C3C');
    chip.addEventListener('click', () => {
      container.querySelectorAll('.checkbox-chip').forEach(c => c.classList.remove('checked'));
      chip.classList.add('checked');
    });
    container.appendChild(chip);
  });
  // 默认选中"参考"
  container.querySelectorAll('.checkbox-chip')[1].classList.add('checked');
}

function renderKeywordSuggestions() {
  const container = document.getElementById('keyword-chips');
  container.innerHTML = '';
  SUGGESTED_KEYWORDS.forEach(kw => {
    const chip = document.createElement('span');
    chip.className = 'checkbox-chip';
    chip.textContent = kw;
    chip.dataset.value = kw;
    chip.style.setProperty('--chip-color', '#6B645C');
    chip.addEventListener('click', () => {
      chip.classList.toggle('checked');
    });
    container.appendChild(chip);
  });
}

function fillForm(r) {
  document.getElementById('field-type').value = r.type || '报刊文章';
  document.getElementById('field-source').value = r.source || '';
  document.getElementById('field-title').value = r.title || '';
  document.getElementById('field-author').value = r.author || '';
  document.getElementById('field-time').value = r.time || '';
  document.getElementById('field-version').value = r.version_info || '';
  document.getElementById('field-core').value = r.core_content || '';
  document.getElementById('field-analysis').value = r.personal_analysis || '';
  document.getElementById('field-docx-preview').value = r.docx_preview_text || '';
  document.getElementById('field-docs').value = (r.document_paths || [])
    .map(path => `files/${stripDocumentPathPrefix(path)}`)
    .join('\n') || 'files/';
  document.getElementById('field-custom-keywords').value = '';
  document.getElementById('field-female-authored').checked = !!r.female_authored;

  // 相关史料
  relatedRecords = (r.related_records || []).map(item =>
    typeof item === 'string' ? { id: item, relation: '' } : { id: item.id || '', relation: item.relation || '' }
  ).filter(item => item.id);
  renderRelatedList();

  // 档案馆字段：编辑时若已存值则填入，否则按现有数据默认「上海市档案馆」
  if (r.type === '档案文件') {
    document.getElementById('field-archive-holder').value = r.archive_holder || '上海市档案馆';
  }

  // 等渲染完后再选择
  setTimeout(() => {
    const opinionTypes = Array.isArray(r.opinion_types) ? r.opinion_types : (r.opinion_types ? [r.opinion_types] : []);
    document.querySelectorAll('#opinion-type-chips .checkbox-chip').forEach(c => {
      c.classList.toggle('checked', opinionTypes.includes(c.dataset.value));
    });
    document.querySelectorAll('#topics-chips .checkbox-chip').forEach(c => {
      if ((r.topics || []).includes(c.dataset.value)) c.classList.add('checked');
    });
    document.querySelectorAll('#importance-chips .checkbox-chip').forEach(c => {
      c.classList.toggle('checked', parseInt(c.dataset.value) === r.importance);
    });
    // 关键词：在建议中存在则选中，否则填到自定义
    const existing = r.keywords || [];
    const customs = [];
    existing.forEach(kw => {
      const chip = document.querySelector(`#keyword-chips .checkbox-chip[data-value="${kw}"]`);
      if (chip) chip.classList.add('checked');
      else customs.push(kw);
    });
    document.getElementById('field-custom-keywords').value = customs.join(', ');
  }, 50);
}

function bindEvents() {
  document.getElementById('btn-submit').addEventListener('click', submit);
  document.getElementById('btn-generate-filename').addEventListener('click', generateAndCopyFilename);
  document.getElementById('btn-cancel').addEventListener('click', () => {
    if (confirm('确定要放弃当前编辑吗？')) {
      location.href = editingId ? `detail.html?id=${editingId}` : 'index.html';
    }
  });

  // Word 文件提取按钮
  document.getElementById('btn-extract-docx').addEventListener('click', extractDocxFile);
  document.getElementById('btn-export-docx').addEventListener('click', exportTranscriptionDocx);
  bindDocumentPathInput();

  const aiAnalyzeButton = document.getElementById('btn-ai-analyze');
  if (aiAnalyzeButton) aiAnalyzeButton.addEventListener('click', analyzeWithAI);
  bindAIImageInput();

  // 类型变化时，重新填充来源下拉 + 切换档案馆字段显隐 + 切换舆论类型字段显隐
  const typeSelect = document.getElementById('field-type');
  typeSelect.addEventListener('change', () => {
    populateSourceSelect();
    updateArchiveHolderVisibility();
    updateOpinionTypeVisibility();
  });

  // 来源下拉变化时，自动填入输入框
  const sourceSelect = document.getElementById('field-source-select');
  if (sourceSelect) {
    sourceSelect.addEventListener('change', () => {
      if (sourceSelect.value) {
        document.getElementById('field-source').value = sourceSelect.value;
      }
    });
  }

  // 档案馆下拉变化时，自动填入输入框
  const holderSelect = document.getElementById('field-archive-holder-select');
  if (holderSelect) {
    holderSelect.addEventListener('change', () => {
      if (holderSelect.value) {
        document.getElementById('field-archive-holder').value = holderSelect.value;
      }
    });
  }

  // 初次填充
  populateSourceSelect();
  populateArchiveHolderSelect();
  updateArchiveHolderVisibility();
  updateOpinionTypeVisibility();
}

async function generateAndCopyFilename() {
  const time = sanitizeFilenamePart(document.getElementById('field-time').value);
  const version = sanitizeFilenamePart(document.getElementById('field-version').value);
  const title = sanitizeFilenamePart(document.getElementById('field-title').value);
  const author = sanitizeFilenamePart(document.getElementById('field-author').value);
  const mainParts = [time, version, title].filter(Boolean);
  const output = `${mainParts.join('-')}${author ? `（${author}）` : ''}`;
  const resultField = document.getElementById('generated-filename');
  const status = document.getElementById('filename-copy-status');

  if (!output) {
    resultField.value = '';
    status.textContent = '请先填写时间、版次或题名。';
    status.className = 'filename-copy-status error';
    return;
  }

  resultField.value = output;
  try {
    await navigator.clipboard.writeText(output);
  } catch (_) {
    resultField.focus();
    resultField.select();
    document.execCommand('copy');
    resultField.setSelectionRange(0, 0);
  }
  status.textContent = '✓ 已复制，可直接粘贴为文件名';
  status.className = 'filename-copy-status success';
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
}

function bindAIImageInput() {
  const input = document.getElementById('ai-image-input');
  const pasteZone = document.getElementById('ai-paste-zone');
  if (!input || !pasteZone) return;

  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    if (files.length) addAIImages(files, false);
  });

  document.addEventListener('paste', event => {
    const target = event.target;
    const isEditingText = target instanceof HTMLElement &&
      (target.matches('input:not([type="file"]), textarea, [contenteditable="true"]'));
    if (isEditingText && !pasteZone.contains(target)) return;

    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;

    event.preventDefault();
    addAIImages(files, true);
  });
}

function addAIImages(files, fromClipboard) {
  const accepted = [];
  for (const originalFile of files) {
    if (!originalFile.type.startsWith('image/')) continue;
    if (originalFile.size > 15 * 1024 * 1024) {
      setAIStatus(`图片「${originalFile.name || '剪贴板截图'}」超过 15MB，未添加。`, 'error');
      continue;
    }
    const extension = originalFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const file = fromClipboard
      ? new File([originalFile], `剪贴板截图-${formatPasteTimestamp()}-${aiSelectedFiles.length + accepted.length + 1}.${extension}`, { type: originalFile.type, lastModified: Date.now() })
      : originalFile;
    accepted.push(file);
  }

  if (!accepted.length) return;
  if (aiSelectedFiles.length + accepted.length > 10) {
    setAIStatus('最多只能添加 10 张图片，请先移除部分图片。', 'error');
    return;
  }
  const totalSize = [...aiSelectedFiles, ...accepted].reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 50 * 1024 * 1024) {
    setAIStatus('全部图片总大小不能超过 50MB，请先移除或压缩部分图片。', 'error');
    return;
  }
  aiSelectedFiles.push(...accepted);

  const input = document.getElementById('ai-image-input');
  try {
    const transfer = new DataTransfer();
    aiSelectedFiles.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
  } catch (_) {
    // 部分浏览器不允许脚本设置文件框；aiSelectedFiles 仍可用于上传。
  }

  renderAIImagePreviews();
  document.getElementById('ai-paste-zone')?.classList.add('has-image');
  setAIStatus(`已添加 ${accepted.length} 张图片，共 ${aiSelectedFiles.length} 张；将按当前顺序识别。`, 'success');
}

function renderAIImagePreviews() {
  const preview = document.getElementById('ai-image-preview');
  if (!preview) return;
  aiPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  aiPreviewUrls = [];
  preview.innerHTML = '';
  aiSelectedFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    aiPreviewUrls.push(url);
    const item = document.createElement('div');
    item.className = 'ai-image-preview-item';
    item.innerHTML = `<span class="ai-image-order">${index + 1}</span><img alt="第 ${index + 1} 张待识别图片"><div class="ai-image-meta"><strong></strong><span></span></div><button type="button" class="ai-image-remove" aria-label="移除第 ${index + 1} 张图片">×</button>`;
    item.querySelector('img').src = url;
    item.querySelector('strong').textContent = file.name;
    item.querySelector('.ai-image-meta span').textContent = formatFileSize(file.size);
    item.querySelector('button').addEventListener('click', () => removeAIImage(index));
    preview.appendChild(item);
  });
  preview.hidden = aiSelectedFiles.length === 0;
}

function removeAIImage(index) {
  aiSelectedFiles.splice(index, 1);
  renderAIImagePreviews();
  const pasteZone = document.getElementById('ai-paste-zone');
  pasteZone?.classList.toggle('has-image', aiSelectedFiles.length > 0);
  setAIStatus(aiSelectedFiles.length ? `已保留 ${aiSelectedFiles.length} 张图片。` : '图片已全部移除。', aiSelectedFiles.length ? 'success' : '');
}

function formatPasteTimestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatFileSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stripDocumentPathPrefix(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)?files\/+/i, '')
    .replace(/^\.\.\/+/g, '')
    .replace(/^\/+/g, '');
}

function bindDocumentPathInput() {
  const input = document.getElementById('field-docs');
  if (!input) return;
  if (!input.value.trim()) input.value = 'files/';

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const cursor = input.selectionStart;
    const nextBreak = input.value.indexOf('\n', cursor);
    const lineEnd = nextBreak === -1 ? input.value.length : nextBreak;
    input.setRangeText('\nfiles/', lineEnd, lineEnd, 'end');
  });

  input.addEventListener('paste', () => {
    setTimeout(() => {
      const cursor = input.selectionStart;
      input.value = input.value
        .split('\n')
        .map(line => line.trim() ? `files/${stripDocumentPathPrefix(line)}` : 'files/')
        .join('\n');
      input.setSelectionRange(Math.min(cursor, input.value.length), Math.min(cursor, input.value.length));
    }, 0);
  });

  input.addEventListener('blur', () => {
    if (!input.value.trim()) input.value = 'files/';
  });
}

async function analyzeWithAI() {
  const button = document.getElementById('btn-ai-analyze');

  if (!aiSelectedFiles.length) {
    setAIStatus('请先选择图片，或按 Ctrl+V 粘贴刚截好的截图。', 'error');
    return;
  }

  const formData = new FormData();
  aiSelectedFiles.forEach(file => formData.append('files', file, file.name));
  button.disabled = true;
  button.textContent = `⏳ 正在分析 ${aiSelectedFiles.length} 张…`;
  setAIStatus(`正在按顺序识别 ${aiSelectedFiles.length} 张图片、合并原文并转换为简体，请稍候…`, 'loading');

  try {
    const response = await fetch('http://127.0.0.1:8765/analyze', {
      method: 'POST',
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'AI 服务暂时无法使用。');

    const filled = applyAIResult(payload);
    setAIStatus(`AI 分析完成，已回填 ${filled} 个空白字段。请人工核对后再保存。`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 分析失败，请稍后重试。';
    const hint = message === 'Failed to fetch'
      ? '本地 AI 服务未连接。请重新双击「启动.bat」，并保持弹出的 AI 服务窗口开启。'
      : '请检查 AI 服务窗口中的具体错误。';
    setAIStatus(`${message} ${hint}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '✨ 识别并回填';
  }
}

function applyAIResult(result) {
  const fieldMap = {
    title: 'field-title', source: 'field-source', author: 'field-author',
    time: 'field-time', version_info: 'field-version', transcription: 'field-docx-preview',
    core_content: 'field-core', research_analysis: 'field-analysis'
  };
  let count = 0;

  Object.entries(fieldMap).forEach(([key, id]) => {
    const field = document.getElementById(id);
    const value = typeof result[key] === 'string' ? result[key].trim() : '';
    if (field && value && !field.value.trim()) {
      field.value = value;
      count += 1;
    }
  });

  const keywordField = document.getElementById('field-custom-keywords');
  const keywords = Array.isArray(result.keywords) ? result.keywords.filter(Boolean) : [];
  if (keywordField && keywords.length && !keywordField.value.trim()) {
    keywordField.value = keywords.join(', ');
    count += 1;
  }
  aiSuggestedHighlights = Array.isArray(result.highlight_candidates)
    ? result.highlight_candidates
      .filter(item => item && typeof item.quote === 'string' && item.quote.trim())
      .map(item => ({ quote: item.quote.trim(), note: String(item.note || '').trim(), selected: true }))
    : [];
  renderAIHighlightSuggestions();
  return count;
}

function renderAIHighlightSuggestions() {
  const container = document.getElementById('ai-highlight-suggestions');
  const list = document.getElementById('ai-highlight-list');
  if (!container || !list) return;
  list.innerHTML = '';
  aiSuggestedHighlights.forEach((item, index) => {
    const row = document.createElement('label');
    row.className = 'ai-highlight-item';
    row.innerHTML = `<input type="checkbox" ${item.selected ? 'checked' : ''}><div><div class="ai-highlight-quote"></div><div class="ai-highlight-note"></div></div>`;
    row.querySelector('input').addEventListener('change', event => { item.selected = event.target.checked; });
    row.querySelector('.ai-highlight-quote').textContent = `原文：${item.quote}`;
    row.querySelector('.ai-highlight-note').textContent = `批注：${item.note || '（待补充）'}`;
    list.appendChild(row);
  });
  container.hidden = aiSuggestedHighlights.length === 0;
}

function buildSuggestedAnnotations(fullText, existing = []) {
  const annotations = [];
  const occupied = existing
    .filter(item => Number.isInteger(item.start) && Number.isInteger(item.end))
    .map(item => ({ start: item.start, end: item.end }));
  aiSuggestedHighlights.filter(item => item.selected).forEach((item, index) => {
    if (existing.some(annotation => annotation.text === item.quote)) return;
    let start = fullText.indexOf(item.quote);
    while (start >= 0 && occupied.some(range => start < range.end && start + item.quote.length > range.start)) {
      start = fullText.indexOf(item.quote, start + 1);
    }
    if (start < 0) return;
    const end = start + item.quote.length;
    occupied.push({ start, end });
    annotations.push({
      id: `ann_ai_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      text: item.quote,
      start,
      end,
      note: item.note,
      created_at: new Date().toISOString(),
      ai_suggested: true
    });
  });
  return annotations.sort((a, b) => a.start - b.start);
}

function setAIStatus(message, kind) {
  const status = document.getElementById('ai-analysis-status');
  if (!status) return;
  status.textContent = message;
  status.className = `ai-analysis-status ${kind || ''}`;
}

async function exportTranscriptionDocx() {
  const text = document.getElementById('field-docx-preview').value.trim();
  const title = document.getElementById('field-title').value.trim() || '史料原文';
  const button = document.getElementById('btn-export-docx');
  if (!text) {
    alert('当前没有可导出的原文，请先识别图片或输入文字。');
    return;
  }

  button.disabled = true;
  button.textContent = '正在生成 DOCX…';
  try {
    const response = await fetch('http://127.0.0.1:8765/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || 'DOCX 生成失败。');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '史料原文'}.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    alert(`${error instanceof Error ? error.message : 'DOCX 导出失败。'}\n\n请确认 AI 服务正在运行。`);
  } finally {
    button.disabled = false;
    button.textContent = '导出原文 DOCX';
  }
}

function updateOpinionTypeVisibility() {
  const type = document.getElementById('field-type').value;
  const row = document.getElementById('opinion-type-row');
  if (row) row.style.display = type === '报刊文章' ? '' : 'none';
}

// 控制「收藏机构」字段的显隐（仅在档案文件时显示）
function updateArchiveHolderVisibility() {
  const type = document.getElementById('field-type').value;
  const row = document.getElementById('archive-holder-row');
  const sourceGroup = document.getElementById('source-group');
  if (type === '档案文件') {
    row.style.display = '';
    if (sourceGroup) sourceGroup.style.display = 'none';
  } else {
    row.style.display = 'none';
    if (sourceGroup) sourceGroup.style.display = '';
  }
}

function populateSourceSelect() {
  const select = document.getElementById('field-source-select');
  if (!select) return;
  const type = document.getElementById('field-type').value;
  const sources = getSourcesByType(type);

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = sources.length > 0
    ? `— 从已有 ${sources.length} 个「${type}」来源中选择 —`
    : `— 该类型暂无已有来源 —`;
  select.appendChild(placeholder);

  sources.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });

  const currentInput = document.getElementById('field-source').value.trim();
  if (currentInput && sources.includes(currentInput)) {
    select.value = currentInput;
  }
}

// 填充「收藏机构」下拉
function populateArchiveHolderSelect() {
  const select = document.getElementById('field-archive-holder-select');
  if (!select) return;
  const holders = getArchiveHolders();

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = holders.length > 0
    ? `— 从已有 ${holders.length} 个档案馆中选择 —`
    : `— 暂无已有档案馆 —`;
  select.appendChild(placeholder);

  holders.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h;
    select.appendChild(opt);
  });

  // 若输入框已是已有档案馆，自动选中
  const currentInput = document.getElementById('field-archive-holder').value.trim();
  if (currentInput && holders.includes(currentInput)) {
    select.value = currentInput;
  }
}


function submit() {
  const title = document.getElementById('field-title').value.trim();
  if (!title) {
    alert('请填写「题名」字段');
    return;
  }

  // 收集舆论类型（多选，仅报刊文章）
  const opinionTypes = [];
  document.querySelectorAll('#opinion-type-chips .checkbox-chip.checked').forEach(c => {
    opinionTypes.push(c.dataset.value);
  });

  // 收集议题
  const topics = [];
  document.querySelectorAll('#topics-chips .checkbox-chip.checked').forEach(c => topics.push(c.dataset.value));

  // 重要程度
  const importanceChip = document.querySelector('#importance-chips .checkbox-chip.checked');
  const importance = importanceChip ? parseInt(importanceChip.dataset.value) : 2;

  // 关键词（建议 + 自定义）
  const keywords = [];
  document.querySelectorAll('#keyword-chips .checkbox-chip.checked').forEach(c => keywords.push(c.dataset.value));
  const customKw = document.getElementById('field-custom-keywords').value.trim();
  if (customKw) {
    customKw.split(/[,，、]/).map(s => s.trim()).filter(Boolean).forEach(kw => {
      if (!keywords.includes(kw)) keywords.push(kw);
    });
  }

  // 文档路径
  const docPaths = document.getElementById('field-docs').value
    .split('\n')
    .map(stripDocumentPathPrefix)
    .filter(Boolean)
    .map(path => `files/${path}`);

  let docxPreviewText = document.getElementById('field-docx-preview').value.trim();

  // 检查：如果关联了 .docx 但没有提取文字，提醒用户
  if (!docxPreviewText && docPaths.some(p => p.toLowerCase().endsWith('.docx'))) {
    if (!confirm('⚠️ 检测到关联了 Word 文档 (.docx)，但尚未提取文字。\n\n如果不提取，Word 文档内容将无法被全文搜索到！\n\n确定要继续保存吗？')) {
      return; // 用户取消
    }
  }

  const recordType = document.getElementById('field-type').value;
  // 收集相关史料（同步最新的 relation 输入值）
  const relatedInputs = document.querySelectorAll('#related-list .related-record-item');
  relatedInputs.forEach(item => {
    const id = item.dataset.id;
    const rel = item.querySelector('.related-relation-input');
    const found = relatedRecords.find(r => r.id === id);
    if (found && rel) found.relation = rel.value.trim();
  });

  const record = {
    type: recordType,
    opinion_types: recordType === '报刊文章' ? opinionTypes : [],
    topics,
    source: document.getElementById('field-source') ? document.getElementById('field-source').value.trim() : '',
    title,
    author: document.getElementById('field-author').value.trim(),
    time: document.getElementById('field-time').value.trim(),
    version_info: document.getElementById('field-version').value.trim(),
    core_content: document.getElementById('field-core').value.trim(),
    personal_analysis: document.getElementById('field-analysis').value.trim(),
    keywords,
    importance,
    document_paths: docPaths,
    image_paths: [],
    docx_preview_text: docxPreviewText,
    related_records: relatedRecords.filter(r => r.id),
    female_authored: document.getElementById('field-female-authored').checked,
    annotations: editingId
      ? (() => {
          const existing = (getRecord(editingId) || {}).annotations || [];
          return [...existing, ...buildSuggestedAnnotations(docxPreviewText, existing)];
        })()
      : buildSuggestedAnnotations(docxPreviewText)
  };

  // 仅档案文件保存「收藏机构」字段
  if (recordType === '档案文件') {
    const holder = document.getElementById('field-archive-holder').value.trim();
    if (holder) record.archive_holder = holder;
  }

  if (editingId) {
    updateRecord(editingId, record);
    alert('已保存修改');
    location.href = `detail.html?id=${editingId}`;
  } else {
    const saved = addRecord(record);
    alert(`已添加：${saved.shiliao_id}\n\n💡 提示：建议定期使用首页「⬇ 导出数据」备份你的数据。`);
    location.href = `detail.html?id=${saved.shiliao_id}`;
  }
}

// 提取 Word 文档文字
async function extractDocxFile() {
  const fileInput = document.getElementById('docx-file-input');
  const file = fileInput.files[0];

  if (!file) {
    alert('请先选择 .docx 文件');
    return;
  }

  if (!file.name.toLowerCase().endsWith('.docx')) {
    alert('请选择 .docx 格式的文件');
    return;
  }

  try {
    document.getElementById('btn-extract-docx').textContent = '提取中...';
    document.getElementById('btn-extract-docx').disabled = true;

    // 动态加载 JSZip 库
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      });
    }

    // 用 FileReader 读取文件
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    // 用 JSZip 解析
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const xmlFile = zip.file('word/document.xml');

    if (!xmlFile) {
      throw new Error('不是有效的 .docx 文件（找不到 document.xml）');
    }

    const xmlText = await xmlFile.async('text');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // 检查是否有解析错误（兼容不同浏览器的 parseError 实现）
    if (xmlDoc && xmlDoc.documentElement && xmlDoc.documentElement.tagName === 'parsererror') {
      throw new Error('XML 解析失败，文档格式可能已损坏');
    }

    const paragraphs = xmlDoc.getElementsByTagName('w:p');
    const lines = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      let line = '';
      const runs = p.getElementsByTagName('w:r');
      for (let j = 0; j < runs.length; j++) {
        const tabs = runs[j].getElementsByTagName('w:tab');
        const brs = runs[j].getElementsByTagName('w:br');
        const texts = runs[j].getElementsByTagName('w:t');
        for (let k = 0; k < tabs.length; k++) line += '\t';
        for (let k = 0; k < texts.length; k++) line += texts[k].textContent;
        for (let k = 0; k < brs.length; k++) line += '\n';
      }
      lines.push(line);
    }
    let fullText = lines.join('\n');

    if (!fullText.trim()) {
      throw new Error('文档为空或不包含可提取的文字');
    }

    // 填充到文本框
    document.getElementById('field-docx-preview').value = fullText.trim();
    alert('✓ 提取成功！请审查内容，可直接编辑修改');

  } catch (error) {
    alert(`❌ 提取失败：${error.message}\n\n请确保：\n1. 文件是有效的 .docx 格式\n2. 文档中包含文字内容`);
  } finally {
    document.getElementById('btn-extract-docx').textContent = '提取文字';
    document.getElementById('btn-extract-docx').disabled = false;
    fileInput.value = ''; // 重置文件输入
  }
}

// ── 相关史料 ──

function renderRelatedList() {
  const list = document.getElementById('related-list');
  if (!list) return;
  list.innerHTML = '';
  relatedRecords.forEach(item => {
    const rec = getRecord(item.id);
    const title = rec ? rec.title : item.id;
    const div = document.createElement('div');
    div.className = 'related-record-item';
    div.dataset.id = item.id;
    div.innerHTML = `
      <div class="ritem-info">
        <span class="ritem-id">${escapeHtml(item.id)}</span>
        <span class="ritem-title">${escapeHtml(title || '（已删除）')}</span>
      </div>
      <input class="related-relation-input" placeholder="关系（回复、引用…）" value="${escapeHtml(item.relation || '')}" />
      <button class="related-remove-btn" title="移除">×</button>
    `;
    div.querySelector('.related-remove-btn').addEventListener('click', () => {
      relatedRecords = relatedRecords.filter(r => r.id !== item.id);
      renderRelatedList();
    });
    list.appendChild(div);
  });
}

function bindRelatedSearch() {
  const input = document.getElementById('related-search');
  const dropdown = document.getElementById('related-dropdown');
  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = input.value.trim();
      if (!q) { dropdown.style.display = 'none'; return; }
      const results = searchRecordsForRelated(q);
      if (results.length === 0) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = '';
      results.forEach(rec => {
        const item = document.createElement('div');
        item.className = 'related-dropdown-item';
        item.innerHTML = `<span class="rdrop-id">${escapeHtml(rec.shiliao_id)}</span>${escapeHtml(rec.title || '无题')} <span class="rdrop-type">${escapeHtml(rec.type || '')}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const alreadyAdded = relatedRecords.some(r => r.id === rec.shiliao_id);
          if (!alreadyAdded) {
            relatedRecords.push({ id: rec.shiliao_id, relation: '' });
            renderRelatedList();
          }
          input.value = '';
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = '';
    }, 200);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });
}

function searchRecordsForRelated(query) {
  const q = query.toLowerCase();
  const all = loadAllRecords();
  return all.filter(rec => {
    if (rec.shiliao_id === editingId) return false; // 不能关联自己
    return (rec.title || '').toLowerCase().includes(q) ||
           (rec.shiliao_id || '').toLowerCase().includes(q) ||
           (rec.source || '').toLowerCase().includes(q);
  }).slice(0, 10);
}

document.addEventListener('DOMContentLoaded', init);
