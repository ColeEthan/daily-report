(function () {
  'use strict';
  const C = DailyReport, B = DailyReportBulk, $ = id => document.getElementById(id);
  const host = window.DailyReportBulkHost;
  const writer = host ? host.writer : C.createWriter(navigator.locks), draftKey = 'daily_report_bulk_draft_v1';
  let state = C.emptyState(), raw = null, healthy = false, entries = [], previewRaw = null, plan = null;
  let dirty = false;
  function message(text) { $('message').textContent = text; }
  function saveMessage(text) { message(text); $('saveResult').textContent = text; }
  function stash() {
    dirty = true;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ source: $('source').value, date: $('date').value, name: $('name').value, entries, preview: !$('preview').hidden })); }
    catch { message('浏览器无法暂存输入，请在离开前复制保留文字。'); }
  }
  function load() {
    healthy = false;
    try { const loaded = host ? host.read() : C.load(localStorage); state = loaded.state; raw = loaded.raw; healthy = loaded.healthy !== false;
      if (!healthy) throw new Error('数据无法读取');
    }
    catch { $('lockStatus').textContent = '原有日报数据无法读取，已停止保存。请返回原日报，使用“备份与恢复”处理。粘贴内容可继续整理。'; }
  }
  function update() {
    plan = null;
    $('saveResult').textContent = '';
    $('confirm').checked = false;
    try {
      if (!$('preview').hidden) {
        plan = B.prepare(state, $('date').value, $('name').value, entries);
        $('summary').textContent = `当天已有 ${plan.existing} 条；本次新增 ${plan.added} 条，跳过重复 ${plan.skipped} 条。`;
        $('warnings').textContent = plan.warnings.join('\n');
        $('warnings').hidden = $('confirmWrap').hidden = !plan.warnings.length;
        Array.from($('rows').children).forEach((row, i) => { row.querySelector('[data-status]').textContent = plan.statuses[i]; });
      }
    } catch (error) {
      $('summary').textContent = error.message;
      $('warnings').hidden = $('confirmWrap').hidden = true;
    }
    enableSave();
  }
  function enableSave() {
    $('save').disabled = !healthy || !writer.active || !plan || !plan.added || previewRaw !== raw || (plan.warnings.length > 0 && !$('confirm').checked);
  }
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function renderRows() {
    $('rows').replaceChildren();
    entries.forEach((entry, index) => {
      const row = node('div', '', 'entry'), head = node('div', '', 'entryHead');
      const status = node('span'); status.setAttribute('data-status', '');
      const remove = node('button', '删除', 'remove');
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条`);
      remove.addEventListener('click', () => { entries.splice(index, 1); renderRows(); update(); stash(); });
      head.append(node('strong', `第 ${index + 1} 条`), status, remove); row.append(head);
      const times = node('div', '', 'fields');
      for (const [key, label] of [['start', '开始时间'], ['end', '结束时间']]) {
        const wrap = node('label', label), input = node('input'); input.type = 'time'; input.value = entry[key];
        input.addEventListener('input', () => { entry[key] = input.value; update(); stash(); });
        wrap.append(input); times.append(wrap);
      }
      row.append(times);
      const check = node('label', '', 'check'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.nextDay;
      checkbox.addEventListener('change', () => { entry.nextDay = checkbox.checked; update(); stash(); });
      check.append(checkbox, document.createTextNode('次日结束')); row.append(check);
      const label = node('label', '工作内容'), content = node('textarea'); content.rows = 3; content.maxLength = 20000; content.value = entry.content;
      content.addEventListener('input', () => { entry.content = content.value; update(); stash(); });
      label.append(content); row.append(label); $('rows').append(row);
    });
  }
  $('date').value = C.today();
  load();
  $('name').value = state.reports[$('date').value]?.name || state.preferredName;
  try {
    const cached = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (cached && typeof cached.source === 'string') {
      $('source').value = cached.source;
      if (C.validDate(cached.date)) $('date').value = cached.date;
      if (typeof cached.name === 'string') $('name').value = cached.name;
      if (cached.preview && Array.isArray(cached.entries)) {
        entries = cached.entries.map(e => C.makeEntry(e));
        $('preview').hidden = false; renderRows();
      }
      dirty = !!cached.source;
    }
  } catch { message('上次的预览无法恢复，请重新粘贴识别。'); }
  function acquire() {
    $('retry').hidden = true;
    if (host) { refreshHost(); return; }
    writer.acquire((status, error) => {
      load();
      if (status === 'ready' && healthy) {
        previewRaw = raw;
        $('lockStatus').textContent = '可以保存。请确认预览后，将记录追加到所选日期。';
      } else if (healthy) {
        $('lockStatus').textContent = error?.message || '原日报或其他页面正在编辑。请关闭其他日报页面，再点“重新连接保存”。当前文字会保留。';
      }
      $('retry').hidden = status === 'ready';
      update();
    });
  }
  function refreshHost() {
    const previousRaw = raw;
    load();
    if (previewRaw === null && $('preview').hidden) previewRaw = raw;
    if (previousRaw !== raw) previewRaw = undefined;
    if (healthy) $('lockStatus').textContent = writer.active
      ? '整份粘贴后一次识别、一次保存，无需逐项填写。'
      : '当前页面为只读。请关闭其他日报页面，再刷新本页；当前输入会暂存。';
    if (healthy && writer.active && !$('preview').hidden && previewRaw !== raw) $('lockStatus').textContent = '日报记录已有变化，请点击“识别并预览”重新检查后保存。';
    $('retry').hidden = true;
    update();
  }
  if (host) host.subscribe(refreshHost);
  $('retry').addEventListener('click', acquire);
  $('source').addEventListener('input', () => {
    entries = []; plan = null; $('preview').hidden = true;
    message('文字已修改，请重新识别。'); stash(); enableSave();
  });
  $('parse').addEventListener('click', () => {
    try {
      const parsed = B.parse($('source').value);
      load();
      entries = parsed.entries;
      $('date').value = parsed.date || C.today();
      $('name').value = parsed.name || state.reports[$('date').value]?.name || state.preferredName;
      previewRaw = raw;
      $('preview').hidden = false;
      renderRows(); update(); stash();
      message(`已识别 ${entries.length} 条，请在下方检查日期、时间和内容。`);
    } catch (error) {
      plan = null; $('preview').hidden = true; enableSave(); message(error.message); stash();
    }
  });
  $('date').addEventListener('change', () => { update(); stash(); });
  $('name').addEventListener('input', () => { update(); stash(); });
  $('confirm').addEventListener('change', enableSave);
  $('save').addEventListener('click', () => {
    if ($('save').disabled) return;
    try {
      if (!healthy || !writer.active) throw new Error('尚未取得保存权限，请重新连接保存');
      if (previewRaw !== raw || localStorage.getItem(C.STORAGE_KEY) !== previewRaw) throw new Error('日报数据已有变化，请点击“识别并预览”重新检查后保存。当前输入仍保留。');
      const checked = B.prepare(state, $('date').value, $('name').value, entries);
      if (!checked.added || (checked.warnings.length && !$('confirm').checked)) return;
      raw = host ? host.save(checked.state, previewRaw, $('date').value) : C.save(localStorage, checked.state, previewRaw, writer);
      state = checked.state; previewRaw = raw;
      dirty = false;
      try { sessionStorage.removeItem(draftKey); } catch { /* Data is already committed. */ }
      update();
      saveMessage(`已保存到 ${$('date').value}：新增 ${checked.added} 条，跳过重复 ${checked.skipped} 条。可返回原日报查看。`);
    } catch (error) {
      saveMessage(error.name === 'QuotaExceededError' ? '保存空间不足，尚未写入。当前文字和预览仍保留，请先到原日报导出备份并清理空间。' : `保存失败：${error.message}`);
      stash();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== C.STORAGE_KEY && event.key !== null) return;
    load();
    $('lockStatus').textContent = '日报数据已变化，请重新识别预览后再保存。';
    // Keep edited rows visible, but never authorize a stale preview.
    previewRaw = undefined; update();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { if (!host) writer.release(); enableSave(); });
  window.addEventListener('pageshow', event => { if (event.persisted && !host) acquire(); });
  acquire();
})();
