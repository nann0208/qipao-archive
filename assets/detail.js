// 详情页逻辑

let currentRecord = null;
let currentFileIndex = 0;
let searchKeyword = '';

function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  searchKeyword = params.get('kw') || '';

  if (!id) {
    document.body.innerHTML = `<div style="padding: 60px; text-align: center;">缺少史料编号参数 <a href="index.html">返回首页</a></div>`;
    return;
  }

  currentRecord = getRecord(id);
  if (!currentRecord) {
    document.body.innerHTML = `<div style="padding: 60px; text-align: center;">未找到编号为 ${escapeHtml(id)} 的记录 <br><br><a href="index.html">返回首页</a></div>`;
    return;
  }

  renderDetail();
  renderPreview(0);
}

function renderDetail() {
  const r = currentRecord;
  const color = getRecordPrimaryColor(r);
  document.documentElement.style.setProperty('--card-color', color);

  const topics = (r.topics || []).map(t =>
    `<span class="card-topic-tag" style="background: ${getTopicColor(t)}; margin-right: 4px;">${escapeHtml(t)}</span>`
  ).join('');

  const keywords = (r.keywords || []).map(k =>
    `<span style="display:inline-block; padding: 2px 8px; background: var(--color-bg); border-radius: 8px; font-size: 12px; margin: 2px;">${escapeHtml(k)}</span>`
  ).join('');

  const docPaths = r.document_paths || [];
  const fileList = docPaths.map((p, i) => {
    const fname = p.split('/').pop();
    const ext = fname.split('.').pop().toLowerCase();
    return `<div class="file-item ${i === 0 ? 'active' : ''}" data-index="${i}">
      <span class="filename">${escapeHtml(fname)}</span>
      <span class="ext-badge">${escapeHtml(ext)}</span>
    </div>`;
  }).join('');

  const html = `
    <a href="index.html" class="btn" style="margin-bottom: 20px; display: inline-block;">← 返回列表</a>

    <div class="card-header" style="margin-bottom: 8px;">
      <span class="card-type">${TYPE_ICONS[r.type] || '📄'} ${escapeHtml(r.type)}</span>
      <span class="card-importance">${IMPORTANCE_LABELS[r.importance] || ''}</span>
    </div>

    ${topics ? `<div style="margin-bottom: 12px;">${topics}</div>` : ''}

    <h1 class="detail-title">${escapeHtml(r.title || '(无标题)')}</h1>
    <div style="font-size: 12px; color: var(--color-text-muted); margin-bottom: 20px;">
      编号：${escapeHtml(r.shiliao_id)}
    </div>

    <div class="detail-meta-row">
      <div class="detail-meta-item">
        <div class="label">来源</div>
        <div>${escapeHtml(r.source || '—')}</div>
      </div>
      <div class="detail-meta-item">
        <div class="label">作者/责任人</div>
        <div>${escapeHtml(r.author || '—')}</div>
      </div>
      <div class="detail-meta-item">
        <div class="label">时间</div>
        <div>${escapeHtml(r.time || '—')}</div>
      </div>
      <div class="detail-meta-item" style="grid-column: span 2;">
        <div class="label">版次/期号/档案号</div>
        <div>${escapeHtml(r.version_info || '—')}</div>
      </div>
      ${r.type === '档案文件' ? `
      <div class="detail-meta-item" style="grid-column: span 2;">
        <div class="label">收藏机构（档案馆）</div>
        <div>${escapeHtml(getArchiveHolder(r))}</div>
      </div>` : ''}
    </div>

    <div style="margin-bottom: 20px;">
      <button id="btn-cite" class="btn">🔗 引用</button>
    </div>

    ${r.core_content ? `
    <div class="detail-section">
      <div class="detail-label">核心内容</div>
      <div class="detail-text-block">${escapeHtml(r.core_content)}</div>
    </div>` : ''}

    ${r.personal_analysis ? `
    <div class="detail-section">
      <div class="detail-label">个人分析</div>
      <div class="detail-text-block">${escapeHtml(r.personal_analysis)}</div>
    </div>` : ''}

    ${r.quotes ? `
    <div class="detail-section">
      <div class="detail-label">引用片段</div>
      <div class="detail-text-block" style="border-left: 3px solid var(--color-accent-soft); padding-left: 14px;">${escapeHtml(r.quotes)}</div>
    </div>` : ''}

    ${keywords ? `
    <div class="detail-section">
      <div class="detail-label">关键词</div>
      <div>${keywords}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">关联原文档案 (${docPaths.length})</div>
      ${docPaths.length > 0 ? `<div class="file-list" id="file-list">${fileList}</div>` : '<div style="font-size: 12px; color: var(--color-text-muted);">尚未关联文档</div>'}
    </div>

    ${docPaths.some(p => p.toLowerCase().endsWith('.docx')) ? `
    <div class="detail-section">
      <div class="detail-label">Word 文字提取</div>
      <div style="display: flex; gap: 10px; margin-bottom: 10px;">
        <input id="detail-docx-input" type="file" accept=".docx" style="flex: 1; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 4px; font-size: 12px;" />
        <button id="btn-extract-detail-docx" class="btn" style="padding: 6px 12px;">提取</button>
      </div>
      <textarea id="detail-docx-preview" class="detail-text-block" style="min-height: 120px; font-size: 12px; resize: vertical;" placeholder="提取的 Word 文本将显示在这里"></textarea>
      <div class="form-help" style="margin-top: 8px;">选择 .docx 文件并点击「提取」，文字内容会保存到此史料并支持全文搜索</div>
    </div>` : ''}

    ${window.READ_ONLY ? '' : `<div class="detail-actions">
      <a href="add.html?id=${encodeURIComponent(r.shiliao_id)}" class="btn primary">✏️ 编辑</a>
      <button class="btn danger" id="btn-delete">🗑️ 删除</button>
    </div>`}
  `;

  document.getElementById('detail-info').innerHTML = html;

  // 绑定文件项点击
  document.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      currentFileIndex = idx;
      document.querySelectorAll('.file-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.index) === idx));
      renderPreview(idx);
    });
  });

  // 删除按钮（只读模式下不存在此元素）
  const delBtn = document.getElementById('btn-delete');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (confirm(`确定要删除「${r.title}」吗？\n\n删除是本地操作，可以通过浏览器缓存重置恢复。`)) {
      deleteRecord(r.shiliao_id);
      alert('已删除');
      location.href = 'index.html';
    }
  });


  // 引用按钮
  const btnCite = document.getElementById('btn-cite');
  if (btnCite) {
    btnCite.addEventListener('click', () => openCiteModal(r));
  }

  // Word 提取按钮（如果有 .docx 文件）
  const btnExtractDocx = document.getElementById('btn-extract-detail-docx');
  if (btnExtractDocx) {
    // 初始化提取文本框（显示已有的内容）
    const previewTextarea = document.getElementById('detail-docx-preview');
    if (previewTextarea && r.docx_preview_text) {
      previewTextarea.value = r.docx_preview_text;
    }

    btnExtractDocx.addEventListener('click', async () => {
      await extractDocxInDetail(r.shiliao_id);
    });
  }
}

function renderPreview(index) {
  const docPaths = currentRecord.document_paths || [];
  const preview = document.getElementById('preview-area');
  const toolbar = document.getElementById('preview-toolbar');

  if (docPaths.length === 0) {
    preview.innerHTML = `
      <div class="preview-empty">
        <div style="font-size: 36px; margin-bottom: 12px;">📭</div>
        <div>暂无关联原文档案</div>
        <div style="font-size: 12px; margin-top: 8px;">可在编辑页面手动添加文件路径</div>
      </div>
    `;
    toolbar.innerHTML = '<span>无原文</span>';
    return;
  }

  const path = docPaths[index];
  const fname = path.split('/').pop();
  const ext = fname.split('.').pop().toLowerCase();

  toolbar.innerHTML = `
    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(fname)}</span>
    <div style="display: flex; gap: 8px;">
      <a href="${escapeAttr(path)}" target="_blank" style="color: #fff; text-decoration: none; padding: 4px 10px; background: rgba(255,255,255,0.15); border-radius: 3px;">↗ 新窗口打开</a>
    </div>
  `;

  if (['pdf'].includes(ext)) {
    preview.innerHTML = `<iframe src="${escapeAttr(path)}" type="application/pdf"></iframe>`;
  } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    preview.innerHTML = `<img src="${escapeAttr(path)}" alt="${escapeAttr(fname)}" />`;
  } else if (['docx'].includes(ext)) {
    // 优先显示提取保存的文字，否则尝试加载原文件
    if (currentRecord.docx_preview_text) {
      preview.innerHTML = renderDocxPanel(currentRecord);
      if (!window.READ_ONLY) bindDocxAnnotationEvents(currentRecord, preview);
      // 若有关键词，自动滚动到第一个搜索高亮处
      if (searchKeyword) {
        setTimeout(() => {
          const firstMark = preview.querySelector('.search-mark');
          if (firstMark) firstMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
      }
    } else {
      preview.innerHTML = `
        <div class="preview-empty">
          <div style="font-size: 36px; margin-bottom: 12px;">📄</div>
          <div style="font-size: 16px; margin-bottom: 8px; color: rgba(250, 246, 240, 0.85);">Word 文档文字内容</div>
          <div style="font-size: 13px; margin-bottom: 20px;">在添加/编辑此史料时，可以提取并保存 Word 文档的文字内容</div>
          <div style="margin: 20px 0;">
            <a href="${escapeAttr(path)}" target="_blank" style="display: inline-block; padding: 10px 24px; background: var(--color-accent); color: #fff; text-decoration: none; border-radius: 4px;">↗ 在系统中打开</a>
          </div>
          <div style="font-size: 12px; margin-top: 12px; color: rgba(250, 246, 240, 0.6);">💡 提示：编辑此史料，在表单中选择 .docx 文件，点击「提取文字」按钮</div>
        </div>
      `;
    }
  } else if (['doc'].includes(ext)) {
    preview.innerHTML = `
      <div class="preview-empty">
        <div style="font-size: 36px; margin-bottom: 12px;">📄</div>
        <div style="font-size: 16px; margin-bottom: 8px; color: rgba(250, 246, 240, 0.85);">这是 Word 文档 (.doc)</div>
        <div style="font-size: 13px; margin-bottom: 20px;">浏览器无法预览 .doc 格式（请转换为 .docx）</div>
        <a href="${escapeAttr(path)}" target="_blank" style="display: inline-block; padding: 10px 24px; background: var(--color-accent); color: #fff; text-decoration: none; border-radius: 4px;">↗ 在系统中打开</a>
      </div>
    `;
  } else {
    preview.innerHTML = `
      <div class="preview-empty">
        <div style="font-size: 36px; margin-bottom: 12px;">📎</div>
        <div>无法预览 .${escapeHtml(ext)} 文件</div>
        <div style="margin-top: 16px;">
          <a href="${escapeAttr(path)}" target="_blank" style="color: var(--color-accent-soft);">↗ 在新窗口打开</a>
        </div>
      </div>
    `;
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// 对文本进行关键词高亮（黄色背景）
function highlightText(text, keyword) {
  if (!text || !keyword) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const kw = escapeHtml(keyword);
  const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark style="background-color: #FFFF99; padding: 0 2px;">$1</mark>');
}

// 在详情页提取 Word 文字
async function extractDocxInDetail(recordId) {
  const fileInput = document.getElementById('detail-docx-input');
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
    const btnExtract = document.getElementById('btn-extract-detail-docx');
    btnExtract.textContent = '提取中...';
    btnExtract.disabled = true;

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

    // 检查是否有解析错误
    if (xmlDoc && xmlDoc.documentElement && xmlDoc.documentElement.tagName === 'parsererror') {
      throw new Error('XML 解析失败，文档格式可能已损坏');
    }

    // 提取文本
    let fullText = '';
    const textNodes = xmlDoc.getElementsByTagName('w:t');
    for (let i = 0; i < textNodes.length; i++) {
      fullText += textNodes[i].textContent;
    }

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

    // 显示在文本框中
    const previewTextarea = document.getElementById('detail-docx-preview');
    previewTextarea.value = fullText.trim();

    // 保存到数据库（更新记录）
    updateRecord(recordId, { docx_preview_text: fullText.trim() });

    // 更新当前记录
    if (currentRecord) {
      currentRecord.docx_preview_text = fullText.trim();
    }

    alert('✓ 提取成功并已保存！');

  } catch (error) {
    alert(`❌ 提取失败：${error.message}\n\n请确保：\n1. 文件是有效的 .docx 格式\n2. 文档中包含文字内容`);
  } finally {
    const btnExtract = document.getElementById('btn-extract-detail-docx');
    btnExtract.textContent = '提取';
    btnExtract.disabled = false;
    fileInput.value = ''; // 重置文件输入
  }
}

/* ===================== Word 批注功能 ===================== */

let docxAnnotGlobalInited = false;

// 渲染 docx 双栏面板（左：文字 + 高亮；右：批注列表）
function renderDocxPanel(record) {
  const text = record.docx_preview_text || '';
  const annotations = record.annotations || [];
  const textHtml = renderTextWithAnnotations(text, annotations, searchKeyword);

  const sortedAnns = [...annotations].sort((a, b) => a.start - b.start);
  const annotItemsHtml = sortedAnns.map(ann => `
    <div class="annot-item" data-id="${ann.id}">
      <div class="annot-quote">"${escapeHtml(ann.text.length > 40 ? ann.text.slice(0, 40) + '…' : ann.text)}"</div>
      <div class="annot-note">${ann.note ? escapeHtml(ann.note) : '<em style="color:#aaa;">（无批注，点击编辑）</em>'}</div>
      ${window.READ_ONLY ? '' : `<div class="annot-actions">
        <button class="annot-btn annot-edit" data-id="${ann.id}" title="编辑">✏️</button>
        <button class="annot-btn annot-delete" data-id="${ann.id}" title="删除">🗑️</button>
      </div>`}
    </div>
  `).join('');

  return `
    <div class="docx-panel">
      <div class="docx-text-pane" id="docx-text-pane">${textHtml}</div>
      <div class="docx-annot-pane">
        <div class="docx-annot-header">📝 批注 <span style="color:#aaa;">(${annotations.length})</span></div>
        <div class="docx-annot-list" id="docx-annot-list">
          ${annotItemsHtml || (window.READ_ONLY ? '<div class="docx-annot-empty">暂无批注</div>' : '<div class="docx-annot-empty">💡 在左侧选中文字后<br>点击「添加批注」即可记录</div>')}
        </div>
      </div>
    </div>
  `;
}

// 渲染带批注和搜索高亮的文本
function renderTextWithAnnotations(text, annotations, searchKw) {
  // 过滤无效的批注（位置越界或重叠）
  const sorted = [...annotations]
    .filter(a => a && a.start >= 0 && a.end <= text.length && a.start < a.end)
    .sort((a, b) => a.start - b.start);

  // 渲染非批注的文本片段（如有搜索词则套用搜索高亮）
  const renderSegment = (s) => {
    if (!s) return '';
    if (searchKw) {
      // 用 search-mark 类区分搜索高亮和批注高亮
      const escaped = escapeHtml(s);
      const kw = escapeHtml(searchKw);
      const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escaped.replace(regex, '<mark class="search-mark" style="background-color:#FFFF99;padding:0 2px;">$1</mark>');
    }
    return escapeHtml(s);
  };

  let result = '';
  let lastEnd = 0;
  sorted.forEach(ann => {
    if (ann.start < lastEnd) return; // 跳过重叠
    result += renderSegment(text.slice(lastEnd, ann.start));
    const annText = text.slice(ann.start, ann.end);
    const titleAttr = ann.note ? escapeAttr(ann.note) : '(无批注，点击编辑)';
    result += `<mark class="annot-mark" data-id="${ann.id}" title="${titleAttr}">${escapeHtml(annText)}</mark>`;
    lastEnd = ann.end;
  });
  result += renderSegment(text.slice(lastEnd));

  return result;
}

// 绑定批注相关事件
function bindDocxAnnotationEvents(record, container) {
  // 全局事件只绑定一次（用于隐藏选区弹出按钮）
  if (!docxAnnotGlobalInited) {
    document.addEventListener('mousedown', (e) => {
      const popup = document.getElementById('selection-popup');
      if (popup && popup.style.display !== 'none' && !popup.contains(e.target)) {
        hideSelectionPopup();
      }
    });
    docxAnnotGlobalInited = true;
  }

  const textPane = container.querySelector('#docx-text-pane');
  if (!textPane) return;

  // 已有批注 mark 点击 → 编辑
  textPane.querySelectorAll('.annot-mark').forEach(mark => {
    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = mark.dataset.id;
      const ann = (record.annotations || []).find(a => a.id === id);
      if (ann) openAnnotationModal(record, ann);
    });
  });

  // 右侧批注项点击 → 滚动到对应高亮
  container.querySelectorAll('.annot-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.annot-actions')) return;
      const id = item.dataset.id;
      const mark = textPane.querySelector(`.annot-mark[data-id="${id}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        mark.classList.add('annot-mark-focus');
        setTimeout(() => mark.classList.remove('annot-mark-focus'), 1800);
      }
    });
  });

  // 编辑按钮
  container.querySelectorAll('.annot-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ann = (record.annotations || []).find(a => a.id === id);
      if (ann) openAnnotationModal(record, ann);
    });
  });

  // 删除按钮
  container.querySelectorAll('.annot-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('确定删除该批注吗？')) {
        deleteAnnotation(record.shiliao_id, id);
        currentRecord = getRecord(record.shiliao_id);
        renderPreview(currentFileIndex);
      }
    });
  });

  // 选区监听 → 显示「添加批注」浮动按钮
  textPane.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) { hideSelectionPopup(); return; }
      const selectedText = sel.toString();
      if (!selectedText.trim()) { hideSelectionPopup(); return; }

      const range = sel.getRangeAt(0);
      if (!textPane.contains(range.commonAncestorContainer)) {
        hideSelectionPopup();
        return;
      }

      const rect = range.getBoundingClientRect();
      showSelectionPopup(rect, () => {
        const pos = getSelectionPositionInText(textPane, record.docx_preview_text);
        if (!pos) {
          alert('选区无效或跨越了已有批注，请重新选择');
          return;
        }
        openAnnotationModal(record, { start: pos.start, end: pos.end, text: pos.text, note: '' });
        sel.removeAllRanges();
      });
    }, 10);
  });
}

// 计算选区在原始 text 中的字符位置
function getSelectionPositionInText(container, fullText) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(container);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const start = beforeRange.toString().length;

  const selectedText = sel.toString();
  const end = start + selectedText.length;

  if (start < 0 || end > fullText.length) return null;
  if (fullText.slice(start, end) !== selectedText) return null;

  return { start, end, text: selectedText };
}

// 显示「添加批注」浮动按钮
function showSelectionPopup(rect, onAdd) {
  let popup = document.getElementById('selection-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'selection-popup';
    popup.className = 'selection-popup';
    popup.innerHTML = `<button class="btn-add-annot">📝 添加批注</button>`;
    document.body.appendChild(popup);
  }
  // 默认显示在选区上方；如果太靠上则显示在下方
  const top = rect.top < 60 ? rect.bottom + 8 : rect.top - 42;
  const rawLeft = rect.left + rect.width / 2 - 60;
  const left = Math.max(8, Math.min(window.innerWidth - 140, rawLeft));
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.display = 'block';
  popup.querySelector('.btn-add-annot').onclick = (e) => {
    e.stopPropagation();
    onAdd();
    hideSelectionPopup();
  };
}

function hideSelectionPopup() {
  const popup = document.getElementById('selection-popup');
  if (popup) popup.style.display = 'none';
}

// 打开批注编辑弹窗
function openAnnotationModal(record, ann) {
  const isNew = !ann.id;

  // 移除已有弹窗
  const old = document.getElementById('annot-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'annot-modal';
  modal.className = 'annot-modal show';
  modal.innerHTML = `
    <div class="annot-modal-overlay"></div>
    <div class="annot-modal-content">
      <div class="annot-modal-header">
        <h3>${isNew ? '✨ 添加批注' : '✏️ 编辑批注'}</h3>
        <button class="btn-close" id="annot-modal-close">&times;</button>
      </div>
      <div class="annot-modal-body">
        <div class="annot-modal-label">📌 选中的文字：</div>
        <div class="annot-modal-quote">${escapeHtml(ann.text)}</div>
        <div class="annot-modal-label" style="margin-top:14px;">📝 批注内容：</div>
        <textarea class="annot-modal-textarea" rows="5" placeholder="记录这段文字的主题、你的思考、联想到的其他史料..."></textarea>
      </div>
      <div class="annot-modal-footer">
        ${!isNew ? '<button class="btn danger" id="annot-modal-delete" style="margin-right:auto;">🗑️ 删除</button>' : ''}
        <button class="btn" id="annot-modal-cancel">取消</button>
        <button class="btn primary" id="annot-modal-save">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const textarea = modal.querySelector('.annot-modal-textarea');
  textarea.value = ann.note || '';
  setTimeout(() => textarea.focus(), 50);

  const close = () => modal.remove();
  modal.querySelector('#annot-modal-close').onclick = close;
  modal.querySelector('#annot-modal-cancel').onclick = close;
  modal.querySelector('.annot-modal-overlay').onclick = close;

  modal.querySelector('#annot-modal-save').onclick = () => {
    const note = textarea.value.trim();
    if (isNew) {
      addAnnotation(record.shiliao_id, { text: ann.text, start: ann.start, end: ann.end, note });
    } else {
      updateAnnotation(record.shiliao_id, ann.id, { note });
    }
    currentRecord = getRecord(record.shiliao_id);
    close();
    renderPreview(currentFileIndex);
  };

  if (!isNew) {
    modal.querySelector('#annot-modal-delete').onclick = () => {
      if (confirm('确定删除该批注吗？')) {
        deleteAnnotation(record.shiliao_id, ann.id);
        currentRecord = getRecord(record.shiliao_id);
        close();
        renderPreview(currentFileIndex);
      }
    };
  }

  // Ctrl/Cmd + Enter 快捷保存
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      modal.querySelector('#annot-modal-save').click();
    }
  });
}

/* ===================== 引用格式自动生成 ===================== */

// 尝试从记录中提取「主要责任者」
// 优先级：1) author 字段 → 2) 个人分析里"编者："开头 → 3) 占位符
function getCiteAuthor(r) {
  if (r && r.author && r.author.trim()) return r.author.trim();
  const pa = (r.personal_analysis || '').trim();
  const m = pa.match(/^编者[:：]\s*([^\n\r]+)/);
  if (m && m[1].trim()) return m[1].trim();
  return '【主要责任者】';
}

// 取年份
function getCiteYear(r) {
  const y = (typeof parseYear === 'function') ? parseYear(r.time) : null;
  return y ? String(y) : (r.time || '【出版年】');
}

// 生成所有可用的引用条目（数组，每项 {icon, label, text}）
function buildCitations(r) {
  const author = getCiteAuthor(r);
  const title = (r.title || '【题名】').trim();
  const source = (r.source || '').trim();
  const year = getCiteYear(r);
  const vinfo = (r.version_info || '').trim();
  const time = (r.time || '').trim();

  const items = [];

  if (r.type === '专著') {
    // 📕专著：主要责任者.书名[M].版本(第1版不写).出版地：出版者，出版年：起止页码.
    items.push({
      icon: '📕',
      label: '专著',
      text: `${author}. ${title}[M]. 【出版地】: ${source || '【出版者】'}, ${year}: ${vinfo || '【起止页码】'}.`
    });
  } else if (r.type === '报刊文章') {
    // ①📚期刊文章 [J]
    items.push({
      icon: '📚',
      label: '期刊文章',
      text: `${author}. ${title}[J]. ${source || '【刊名】'}, ${year}, ${vinfo || '【卷(期)】'}: 【起止页码】.`
    });
    // ②📰报纸文章 [N]
    items.push({
      icon: '📰',
      label: '报纸文章',
      text: `${author}. ${title}[N]. ${source || '【报纸名】'}, ${time || year} (${vinfo || '【版次】'}).`
    });
  } else if (r.type === '档案文件') {
    // 📃档案：责任者.档案题名：档号[A].收藏地：收藏机构，形成日期：页码.
    // 责任者优先用 author 字段，其次 source（发起人）；收藏机构用 archive_holder（默认上海市档案馆）
    const archiveHolder = getArchiveHolder(r);
    const archiveAuthor = (r.author && r.author.trim())
      ? r.author.trim()
      : (source || '【责任者】');
    items.push({
      icon: '📃',
      label: '档案',
      text: `${archiveAuthor}. ${title}: ${vinfo || '【档号】'}[A]. 【收藏地】: ${archiveHolder}, ${time || '【形成日期】'}: 【页码】.`
    });
  } else if (r.type === '文学作品') {
    // ✒️文学作品：著者.篇名//文集名(出自专著时).出版地: 出版者, 出版年.
    // 单行本用 [M]，若选自文集可手动改为 // 文集名
    items.push({
      icon: '✒️',
      label: '文学作品',
      text: `${author}. ${title}[M]. 【出版地】: ${source || '【出版者】'}, ${year}.`
    });
  } else {
    // 图像或其他类型 —— 提供一个通用参考格式
    items.push({
      icon: '🖼️',
      label: '图像/其他',
      text: `${author}. ${title}[Z]. ${source || '【来源】'}, ${year}.`
    });
  }

  return items;
}

// 打开引用弹窗
function openCiteModal(r) {
  const items = buildCitations(r);

  // 移除旧弹窗
  const old = document.getElementById('cite-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'cite-modal';
  modal.className = 'cite-modal show';

  const cardsHtml = items.map((it, i) => `
    <div class="cite-item">
      <div class="cite-item-head">
        <span class="cite-item-label">${it.icon} ${it.label}</span>
        <button class="btn cite-copy-btn" data-index="${i}">📋 复制</button>
      </div>
      <div class="cite-text" id="cite-text-${i}">${escapeHtml(it.text)}</div>
    </div>
  `).join('');

  modal.innerHTML = `
    <div class="cite-modal-overlay"></div>
    <div class="cite-modal-content">
      <div class="cite-modal-header">
        <h3>🔗 引用格式（GB/T 7714）</h3>
        <button class="btn-close" id="btn-cite-close">&times;</button>
      </div>
      <div class="cite-modal-body">
        ${items.length > 1 ? '<div class="cite-hint">该史料归类为「报刊文章」，请按实际情况选择期刊或报纸格式：</div>' : ''}
        ${cardsHtml}
        <div class="cite-hint" style="margin-top: 14px;">💡 带【】的部分为系统无法自动获取的信息，请复制后手动补全。</div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 关闭
  const close = () => modal.remove();
  document.getElementById('btn-cite-close').addEventListener('click', close);
  modal.querySelector('.cite-modal-overlay').addEventListener('click', close);

  // 复制
  modal.querySelectorAll('.cite-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const text = items[idx].text;
      copyToClipboard(text, btn);
    });
  });
}

// 复制到剪贴板（带降级方案）
function copyToClipboard(text, btn) {
  const done = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { alert('复制失败，请手动选择文字复制'); }
  document.body.removeChild(ta);
}

document.addEventListener('DOMContentLoaded', init);
