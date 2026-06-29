// 添加/编辑表单逻辑

let editingId = null;

const SUGGESTED_KEYWORDS = [
  '高开叉', '海派', '现代', '保守', '西化', '传统',
  '女性权益', '时代审美', '手工艺', '消费文化',
  '贸易', '国货', '平等', '现代化', '月份牌'
];

function init() {
  const params = new URLSearchParams(location.search);
  editingId = params.get('id');

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
  document.getElementById('field-docs').value = (r.document_paths || []).join('\n');
  document.getElementById('field-custom-keywords').value = '';

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
  document.getElementById('btn-cancel').addEventListener('click', () => {
    if (confirm('确定要放弃当前编辑吗？')) {
      location.href = editingId ? `detail.html?id=${editingId}` : 'index.html';
    }
  });

  // Word 文件提取按钮
  document.getElementById('btn-extract-docx').addEventListener('click', extractDocxFile);

  // 类型变化时，重新填充来源下拉 + 切换档案馆字段显隐 + 切换舆论类型字段显隐
  const typeSelect = document.getElementById('field-type');
  typeSelect.addEventListener('change', () => {
    populateSourceSelect();
    updateArchiveHolderVisibility();
    updateOpinionTypeVisibility();
  });

  // 来源下拉变化时，自动填入输入框
  const sourceSelect = document.getElementById('field-source-select');
  sourceSelect.addEventListener('change', () => {
    if (sourceSelect.value) {
      document.getElementById('field-source').value = sourceSelect.value;
    }
  });

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

function updateOpinionTypeVisibility() {
  const type = document.getElementById('field-type').value;
  const row = document.getElementById('opinion-type-row');
  if (row) row.style.display = type === '报刊文章' ? '' : 'none';
}

// 控制「收藏机构」字段的显隐（仅在档案文件时显示）
function updateArchiveHolderVisibility() {
  const type = document.getElementById('field-type').value;
  const row = document.getElementById('archive-holder-row');
  const helpLabel = document.getElementById('source-field-help');
  if (type === '档案文件') {
    row.style.display = '';
    if (helpLabel) helpLabel.style.display = '';
  } else {
    row.style.display = 'none';
    if (helpLabel) helpLabel.style.display = 'none';
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

// 根据当前选中的类型，填充「来源」下拉列表
function populateSourceSelect() {
  const select = document.getElementById('field-source-select');
  const type = document.getElementById('field-type').value;
  const sources = getSourcesByType(type);

  // 重建选项
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

  // 如果输入框中已有值且是已有来源，自动选中
  const currentInput = document.getElementById('field-source').value.trim();
  if (currentInput && sources.includes(currentInput)) {
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
    .map(s => s.trim())
    .filter(Boolean);

  let docxPreviewText = document.getElementById('field-docx-preview').value.trim();

  // 检查：如果关联了 .docx 但没有提取文字，提醒用户
  if (!docxPreviewText && docPaths.some(p => p.toLowerCase().endsWith('.docx'))) {
    if (!confirm('⚠️ 检测到关联了 Word 文档 (.docx)，但尚未提取文字。\n\n如果不提取，Word 文档内容将无法被全文搜索到！\n\n确定要继续保存吗？')) {
      return; // 用户取消
    }
  }

  const recordType = document.getElementById('field-type').value;
  const record = {
    type: recordType,
    opinion_types: recordType === '报刊文章' ? opinionTypes : [],
    topics,
    source: document.getElementById('field-source').value.trim(),
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
    docx_preview_text: docxPreviewText
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

    // 提取文本（支持各种复杂结构：图片、表格、段落等）
    let fullText = '';

    // 方法1：提取所有 w:t（纯文字节点）
    const textNodes = xmlDoc.getElementsByTagName('w:t');
    for (let i = 0; i < textNodes.length; i++) {
      fullText += textNodes[i].textContent;
    }

    // 方法2：如果没有找到文字，尝试从所有文本节点中提取
    if (!fullText.trim()) {
      const walker = xmlDoc.createTreeWalker(
        xmlDoc.documentElement,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text) fullText += text + ' ';
      }
    }

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

document.addEventListener('DOMContentLoaded', init);
