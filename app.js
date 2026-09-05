(function () {
  'use strict';
  const C = DailyReport;
  const $ = id => document.getElementById(id);
  let state = C.emptyState();
  let raw = null;
  let selectedDate = C.today();
  let editingId = null;
  let legacyTime = '';
  let recoveryMode = false;
  let unsaved = false;
  let pendingImport = null;
  let composing = false;
  const durationMinutes = [15, 30, 60, 120];

  function saveTimeChange(message) {
    legacyTime = '';
    $('legacyHint').hidden = true;
    $('timeFeedback').textContent = message;
    unsaved = true;
    saveForm();
  }
  function fillDuration(minutes, accumulate = false) {
    if (recoveryMode) return;
    const start = $('timeStart').value;
    if (!start) {
      $('timeFeedback').textContent = '请先填写开始时间，也可以点开始时间旁的“现在”。';
      $('timeStart').focus();
      return;
    }
    const [hours, mins] = start.split(':').map(Number);
    const startMinutes = hours * 60 + mins;
    let base = startMinutes;
    const currentEnd = $('timeEnd').value;
    if (accumulate && currentEnd) {
      try { C.validateRange(start, currentEnd, $('nextDay').checked); }
      catch (error) { $('timeFeedback').textContent = error.message; return; }
      const [endHours, endMins] = currentEnd.split(':').map(Number);
      base = endHours * 60 + endMins + ($('nextDay').checked ? 1440 : 0);
    }
    const total = base + minutes;
    if (total >= 2880) {
      $('timeFeedback').textContent = '结束时间将超过次日，请分成两条记录。';
      return;
    }
    const end = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    $('timeEnd').value = end;
    $('nextDay').checked = total >= 1440;
    const elapsed = total - startMinutes;
    const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)}小时${elapsed % 60 ? `${elapsed % 60}分钟` : ''}` : `${elapsed}分钟`;
    saveTimeChange(`${accumulate ? `已增加 ${minutes} 分钟，累计` : '已填写'}${duration}：${start}–${total >= 1440 ? '次日' : ''}${end}。`);
  }
  function fillNow(field) {
    if (recoveryMode) return;
    const now = new Date();
    if (selectedDate !== C.today(now)) {
      $('timeFeedback').textContent = '补录日期请填写当日实际时间，“现在”仅用于今天。';
      return;
    }
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    // Do not reinterpret an earlier end time as an overnight shift without intent.
    if (field === 'timeEnd' && $('timeStart').value && time <= $('timeStart').value) {
      $('timeFeedback').textContent = '当前时刻不晚于开始时间，请检查开始时间或手动填写结束时间。';
      return;
    }
    $(field).value = time;
    if (field === 'timeEnd') $('nextDay').checked = false;
    saveTimeChange(`已将${field === 'timeStart' ? '开始' : '结束'}时间填为 ${time}。`);
  }
  function clearTime() {
    if (recoveryMode) return;
    $('timeStart').value = '';
    $('timeEnd').value = '';
    $('nextDay').checked = false;
    saveTimeChange('时间已清空，可以只记录工作内容。');
  }

  function notice(message) {
    $('notice').textContent = message;
    $('notice').hidden = !message;
  }
  function errorMessage(error) {
    if (error?.name === 'QuotaExceededError') return '保存空间不足，当前输入尚未保存。请先导出备份，再清理不需要的记录。';
    if (error?.name === 'SecurityError') return '浏览器不允许保存数据。当前输入仍在页面中，请先导出备份。';
    return error?.message || '保存失败，当前输入仍在页面中，请先导出备份。';
  }
  function commit(next) {
    if (recoveryMode) { notice('原有数据无法读取，已停止写入。请在“备份与恢复”中导出原始数据或恢复有效备份。'); return false; }
    try {
      raw = C.save(localStorage, next, raw);
      state = next;
      unsaved = false;
      notice('');
      return true;
    } catch (error) {
      unsaved = true;
      $('saveStatus').textContent = '尚未保存，请先备份';
      notice(errorMessage(error));
      return false;
    }
  }
  function captureDraft() {
    return { entryId: editingId, start: $('timeStart').value, end: $('timeEnd').value,
      nextDay: $('nextDay').checked, content: $('workContent').value, legacyTime };
  }
  function hasDraft(draft) { return !!(draft.entryId || draft.start || draft.end || draft.nextDay || draft.content || draft.legacyTime); }
  function withForm(base = state) {
    const next = C.clone(base);
    const name = $('userName').value.trim();
    const draft = captureDraft();
    next.preferredName = name;
    if (next.reports[selectedDate] || name || hasDraft(draft)) {
      next.reports[selectedDate] ||= { name, entries: [] };
      next.reports[selectedDate].name = name;
    }
    if (hasDraft(draft)) next.drafts[selectedDate] = draft;
    else delete next.drafts[selectedDate];
    return next;
  }
  function saveForm() {
    if (recoveryMode) return false;
    const next = withForm();
    if (!unsaved && JSON.stringify(next) === JSON.stringify(state)) return true;
    const ok = commit(next);
    if (ok) $('saveStatus').textContent = hasDraft(captureDraft()) ? '草稿已保存' : '已保存';
    return ok;
  }
  function resizeText() {
    const area = $('workContent');
    area.style.height = 'auto';
    area.style.height = Math.min(Math.max(area.scrollHeight, 96), 320) + 'px';
  }
  function updateDate() {
    const today = C.today();
    $('todayDate').textContent = C.displayDate(today);
    $('reportDate').value = selectedDate;
    $('dateHint').textContent = selectedDate === today ? '正在记录今天的工作' : `当前记录日期：${C.displayDate(selectedDate)}。提交和删除均作用于这一天。`;
    $('todayButton').hidden = selectedDate === today;
    $('listTitle').textContent = selectedDate === today ? '今日记录' : `${C.displayDate(selectedDate)}的记录`;
    ['startNowButton', 'endNowButton'].forEach(id => {
      $(id).disabled = recoveryMode || selectedDate !== today;
      $(id).title = selectedDate === today ? '填入当前时刻' : '补录日期请填写当日实际时间';
    });
  }
  function loadForm() {
    const report = state.reports[selectedDate];
    const draft = state.drafts[selectedDate];
    $('userName').value = report?.name ?? state.preferredName;
    $('timeStart').value = draft?.start || '';
    $('timeEnd').value = draft?.end || '';
    $('nextDay').checked = !!draft?.nextDay;
    $('workContent').value = draft?.content || '';
    editingId = draft?.entryId || null;
    legacyTime = draft?.legacyTime || '';
    $('legacyHint').textContent = legacyTime ? `保留旧记录时间：${legacyTime}。重新填写时间可替换。` : '';
    $('legacyHint').hidden = !legacyTime;
    $('saveEntryButton').textContent = editingId ? '保存修改' : '＋ 添加记录';
    $('cancelEditButton').hidden = !editingId;
    $('saveStatus').textContent = draft ? (editingId ? '已恢复编辑草稿' : '已恢复上次草稿') : '记录保存在当前浏览器';
    $('timeFeedback').textContent = selectedDate === C.today() ? '选好时长后，可点“＋30分钟”继续累加。' : '补录也可用“＋30分钟”累加；“现在”仅用于今天。';
    resizeText();
    updateDate();
  }
  function button(label, className, action) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.className = className;
    node.addEventListener('click', action);
    return node;
  }
  function emptyMessage(message) {
    const node = document.createElement('p');
    node.className = 'empty-state';
    node.textContent = message;
    return node;
  }
  function renderEntries() {
    updateDate();
    const entries = state.reports[selectedDate]?.entries || [];
    const list = $('entryList');
    list.replaceChildren();
    $('entryCount').textContent = `${entries.length} 条`;
    $('generateButton').disabled = recoveryMode || !entries.length;
    $('clearButton').disabled = recoveryMode || !entries.length;
    if (!entries.length) { list.append(emptyMessage('还没有记录，完成一项工作后在上方添加。')); return; }
    entries.forEach((entry, index) => {
      const card = document.createElement('div');
      card.className = 'entry-card' + (editingId === entry.id ? ' editing' : '');
      const number = document.createElement('span');
      number.className = 'index';
      number.textContent = index + 1;
      const content = document.createElement('div');
      content.className = 'text';
      const time = C.entryTime(entry);
      if (time) {
        const strong = document.createElement('b');
        strong.textContent = time + '\n';
        content.append(strong);
      }
      content.append(document.createTextNode(entry.content));
      const actions = document.createElement('div');
      actions.className = 'entry-actions';
      const edit = button('编辑', '', () => editEntry(entry.id));
      edit.setAttribute('aria-label', `编辑第 ${index + 1} 条记录`);
      const remove = button('删除', 'delete-action', () => deleteEntry(entry.id));
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条记录`);
      actions.append(edit, remove);
      card.append(number, content, actions);
      list.append(card);
    });
  }
  function switchDate(date) {
    if (!C.validDate(date)) { $('reportDate').value = selectedDate; return; }
    if (!saveForm()) { $('reportDate').value = selectedDate; return; }
    selectedDate = date;
    loadForm();
    renderEntries();
  }
  function submitEntry(event) {
    event.preventDefault();
    if (composing || event.isComposing || recoveryMode) return;
    try {
      const entry = C.makeEntry(captureDraft(), editingId || C.id());
      const next = withForm();
      next.reports[selectedDate] ||= { name: $('userName').value.trim(), entries: [] };
      const entries = next.reports[selectedDate].entries;
      if (editingId) {
        const index = entries.findIndex(item => item.id === editingId);
        if (index < 0) throw new Error('原记录已不存在，请将内容另存为新记录');
        entries[index] = entry;
      } else entries.push(entry);
      delete next.drafts[selectedDate];
      const continueAt = !editingId && !entry.nextDay && !entry.legacyTime && entry.end;
      if (continueAt) next.drafts[selectedDate] = { entryId: null, start: continueAt, end: '', nextDay: false, content: '', legacyTime: '' };
      if (!commit(next)) return;
      loadForm();
      renderEntries();
      $('saveStatus').textContent = '记录已保存';
      if (continueAt) $('timeFeedback').textContent = `下一条从 ${continueAt} 开始，可修改或清空时间。`;
    } catch (error) { notice(errorMessage(error)); }
  }
  function editEntry(id) {
    if (editingId === id) { $('workContent').focus(); return; }
    if (!saveForm()) return;
    if ((editingId || $('workContent').value.trim()) && !confirm('当前有未提交草稿。放弃这份草稿并编辑所选记录？')) return;
    const entry = state.reports[selectedDate]?.entries.find(item => item.id === id);
    if (!entry) return;
    const next = C.clone(state);
    next.drafts[selectedDate] = { entryId: id, start: entry.start, end: entry.end, nextDay: entry.nextDay, content: entry.content, legacyTime: entry.legacyTime };
    if (!commit(next)) return;
    loadForm();
    renderEntries();
    $('workContent').focus();
  }
  function cancelEdit() {
    if (!confirm('放弃这次修改？原记录会保留。')) return;
    const next = C.clone(state);
    delete next.drafts[selectedDate];
    if (commit(next)) { loadForm(); renderEntries(); }
  }
  function deleteEntry(id) {
    if (!saveForm()) return;
    if (!confirm(`删除 ${C.displayDate(selectedDate)} 的这条记录？`)) return;
    const next = C.clone(state);
    next.reports[selectedDate].entries = next.reports[selectedDate].entries.filter(entry => entry.id !== id);
    const wasEditing = next.drafts[selectedDate]?.entryId === id;
    // Keep an in-progress edit as a new draft rather than discard its text.
    if (wasEditing) next.drafts[selectedDate].entryId = null;
    if (commit(next)) { loadForm(); renderEntries(); }
  }
  function clearEntries() {
    if (!saveForm()) return;
    const entries = state.reports[selectedDate]?.entries || [];
    if (!entries.length || !confirm(`清空 ${C.displayDate(selectedDate)} 的全部 ${entries.length} 条记录？当前草稿会保留。`)) return;
    const next = C.clone(state);
    next.reports[selectedDate].entries = [];
    if (next.drafts[selectedDate]) next.drafts[selectedDate].entryId = null;
    if (commit(next)) { loadForm(); renderEntries(); }
  }
  function openDialog(id) {
    const dialog = $(id);
    if (!dialog.open) dialog.showModal();
  }
  function showReport(date) {
    if (!saveForm()) return;
    const report = state.reports[date];
    if (!report?.entries.length) return;
    if (date === selectedDate && (editingId || $('workContent').value.trim()) && !confirm('当前草稿尚未添加到记录。先生成已保存记录的汇报？')) return;
    $('previewText').textContent = C.buildReport(date, report);
    $('copyHint').hidden = true;
    $('manualCopy').hidden = true;
    $('copyButton').textContent = '复制到剪贴板';
    $('historyDialog').close();
    openDialog('previewDialog');
  }
  async function copyReport() {
    const text = $('previewText').textContent;
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { /* Fall through to the legacy API, then manual selection. */ }
    if (!copied) {
      const area = $('manualCopy');
      area.value = text;
      area.hidden = false;
      area.focus();
      area.select();
      area.setSelectionRange(0, text.length);
      try { copied = typeof document.execCommand === 'function' && document.execCommand('copy') === true; }
      catch { copied = false; }
      area.hidden = copied;
    }
    $('copyHint').textContent = copied ? '已复制，可以粘贴到微信等应用发送。' : '自动复制失败，请长按下方文字，选择全选并复制。';
    $('copyHint').hidden = false;
    $('copyButton').textContent = copied ? '再次复制' : '重试复制';
  }
  function showHistory() {
    if (!saveForm()) return;
    renderHistory();
    openDialog('historyDialog');
  }
  function renderHistory() {
    const list = $('historyList');
    list.replaceChildren();
    const dates = [...new Set([...Object.keys(state.reports), ...Object.keys(state.drafts)])]
      .filter(date => state.reports[date]?.entries.length || state.drafts[date]).sort().reverse();
    if (!dates.length) { list.append(emptyMessage('暂无历史记录')); return; }
    dates.forEach(date => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const label = document.createElement('span');
      const count = state.reports[date]?.entries.length || 0;
      const draft = state.drafts[date];
      label.textContent = `${date}（${count} 条${draft && (draft.entryId || draft.content.trim()) ? '，有草稿' : ''}）`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const view = button('查看', 'btn-view', () => showReport(date));
      view.disabled = !count;
      actions.append(view, button('编辑 / 补录', 'btn-view', () => {
        switchDate(date);
        if (selectedDate === date) $('historyDialog').close();
      }), button('删除', 'btn-del', () => deleteHistory(date)));
      row.append(label, actions);
      list.append(row);
    });
  }
  function deleteHistory(date) {
    if (!saveForm()) return;
    if (!confirm(`删除 ${C.displayDate(date)} 的全部记录及草稿？`)) return;
    const next = C.clone(state);
    delete next.reports[date];
    delete next.drafts[date];
    if (commit(next)) {
      if (selectedDate === date) loadForm();
      renderEntries();
      renderHistory();
    }
  }
  function download(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function backupError(message) {
    $('backupError').textContent = message;
    $('backupError').hidden = !message;
  }
  function showBackup() {
    if (!recoveryMode) saveForm();
    pendingImport = null;
    $('importPreview').hidden = true;
    $('importFile').value = '';
    $('exportButton').textContent = recoveryMode ? '导出无法读取的原始数据' : '导出全部日报与草稿';
    $('backupStatus').textContent = recoveryMode ? '原数据保持不变。请先导出留存，再导入有效备份恢复使用。' : '';
    backupError('');
    openDialog('backupDialog');
  }
  function exportAll() {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (recoveryMode) {
        const original = { format: 'daily-report-recovery', exportedAt: new Date().toISOString(), rawV2: localStorage.getItem(C.STORAGE_KEY), rawLegacy: localStorage.getItem(C.LEGACY_KEY), rawName: localStorage.getItem(C.NAME_KEY) };
        download(`工作日报-原始数据-${stamp}.json`, JSON.stringify(original, null, 2));
      } else {
        // Include current unsaved input even when browser storage is unavailable/full.
        download(`工作日报-备份-${stamp}.json`, C.exportBackup(withForm()));
      }
      $('backupStatus').textContent = '已发起备份下载，请确认文件已保存。';
      backupError('');
    } catch (error) { backupError(`导出失败：${errorMessage(error)}`); }
  }
  async function previewImport() {
    const file = $('importFile').files[0];
    pendingImport = null;
    $('importPreview').hidden = true;
    backupError('');
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件过大（最大 10 MB）');
      const incoming = C.parseBackup(await file.text());
      // Ignore an earlier file read that completes after a new selection or dialog closure.
      if ($('importFile').files[0] !== file || !$('backupDialog').open) return;
      if (!recoveryMode && !saveForm()) throw new Error('请先导出当前输入并解决保存问题，再导入备份');
      const merged = recoveryMode ? { state: incoming, stats: { added: Object.values(incoming.reports).reduce((sum, report) => sum + report.entries.length, 0), drafts: Object.keys(incoming.drafts).length, skipped: 0, conflicts: 0, draftConflicts: 0, nameConflicts: 0 } } : C.mergeBackup(state, incoming);
      const s = merged.stats;
      let summary = `将${recoveryMode ? '恢复' : '新增'} ${s.added} 条记录、${s.drafts} 份草稿，跳过 ${s.skipped} 条重复记录。`;
      if (s.conflicts) summary += ` ${s.conflicts} 条不同版本的记录将同时保留。`;
      if (s.draftConflicts) summary += ` ${s.draftConflicts} 天的草稿有冲突：保留本机草稿，备份中的冲突草稿不导入，请保留备份文件。`;
      if (s.nameConflicts) summary += ` ${s.nameConflicts} 天的姓名不同，将保留本机姓名。`;
      if (recoveryMode) summary += ' 无法读取的原始数据会另存后再恢复。';
      pendingImport = { state: merged.state, raw, recoveryMode };
      $('importSummary').textContent = summary;
      $('confirmImportButton').textContent = recoveryMode ? '确认恢复备份' : '确认合并恢复';
      $('importPreview').hidden = false;
    } catch (error) { backupError(`无法导入：${errorMessage(error)}。原有记录未改变。`); }
  }
  function confirmImport() {
    if (!pendingImport) return;
    try {
      if (localStorage.getItem(C.STORAGE_KEY) !== pendingImport.raw || raw !== pendingImport.raw) throw new Error('数据已有变化，请重新选择备份文件以更新合并预览');
      if (pendingImport.recoveryMode) {
        // Preserve corrupt source before any replacement. If this fails, do not overwrite it.
        const original = { rawV2: localStorage.getItem(C.STORAGE_KEY), rawLegacy: localStorage.getItem(C.LEGACY_KEY), rawName: localStorage.getItem(C.NAME_KEY) };
        localStorage.setItem(`daily_report_recovery_${Date.now()}`, JSON.stringify(original));
        const saved = C.save(localStorage, pendingImport.state, pendingImport.raw);
        raw = saved;
        state = pendingImport.state;
        recoveryMode = false;
        unsaved = false;
        notice('');
      } else if (!commit(pendingImport.state)) return;
      pendingImport = null;
      $('importPreview').hidden = true;
      $('importFile').value = '';
      $('backupStatus').textContent = '恢复完成，已有记录已保留。';
      $('exportButton').textContent = '导出全部日报与草稿';
      backupError('');
      setRecoveryControls();
      loadForm();
      renderEntries();
    } catch (error) { backupError(`恢复失败：${errorMessage(error)}`); }
  }
  function setRecoveryControls() {
    ['userName', 'timeStart', 'timeEnd', 'nextDay', 'workContent', 'saveEntryButton', 'reportDate', 'historyButton', 'todayButton', 'clearTimeButton', 'durationAdd30', ...durationMinutes.map(minutes => `duration${minutes}`)].forEach(id => { $(id).disabled = recoveryMode; });
  }

  try {
    const loaded = C.load(localStorage);
    state = loaded.state;
    raw = loaded.raw;
  } catch (error) {
    recoveryMode = true;
    try { raw = localStorage.getItem(C.STORAGE_KEY); } catch { /* Browser denies access. */ }
    notice(`原有数据无法读取，已停止写入以保护记录。请打开“备份与恢复”。${errorMessage(error)}`);
  }
  setRecoveryControls();
  loadForm();
  renderEntries();
  if (recoveryMode) $('saveStatus').textContent = '数据读取失败，已停止写入';

  $('entryForm').addEventListener('submit', submitEntry);
  $('reportDate').addEventListener('change', () => switchDate($('reportDate').value));
  $('todayButton').addEventListener('click', () => switchDate(C.today()));
  $('startNowButton').addEventListener('click', () => fillNow('timeStart'));
  $('endNowButton').addEventListener('click', () => fillNow('timeEnd'));
  $('clearTimeButton').addEventListener('click', clearTime);
  durationMinutes.forEach(minutes => $(`duration${minutes}`).addEventListener('click', () => fillDuration(minutes)));
  $('durationAdd30').addEventListener('click', () => fillDuration(30, true));
  ['userName', 'timeStart', 'timeEnd', 'nextDay', 'workContent'].forEach(id => {
    $(id).addEventListener('input', () => {
      if (id === 'timeStart' || id === 'timeEnd' || id === 'nextDay') {
        legacyTime = '';
        $('legacyHint').hidden = true;
        $('timeFeedback').textContent = '时间已修改；可点击时长重新计算结束时间。';
      }
      resizeText();
      // Synchronous draft persistence also covers immediate app switches and reloads.
      unsaved = true;
      saveForm();
    });
  });
  $('workContent').addEventListener('compositionstart', () => { composing = true; });
  $('workContent').addEventListener('compositionend', () => { composing = false; saveForm(); });
  $('workContent').addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitEntry(event);
  });
  $('cancelEditButton').addEventListener('click', cancelEdit);
  $('clearButton').addEventListener('click', clearEntries);
  $('generateButton').addEventListener('click', () => showReport(selectedDate));
  $('copyButton').addEventListener('click', copyReport);
  $('historyButton').addEventListener('click', showHistory);
  $('backupButton').addEventListener('click', showBackup);
  $('exportButton').addEventListener('click', exportAll);
  $('importFile').addEventListener('change', previewImport);
  $('confirmImportButton').addEventListener('click', confirmImport);
  document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => $(node.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  });
  window.addEventListener('beforeunload', event => {
    if (unsaved) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('storage', event => {
    if (event.key === C.STORAGE_KEY || event.key === null) notice('另一个页面更新了日报。当前页面已暂停覆盖保存，请先导出当前输入，再刷新查看最新记录。');
  });
  function checkDate() {
    // Keep every action bound to the displayed date; midnight must never retarget a deletion.
    updateDate();
  }
  window.addEventListener('focus', checkDate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !recoveryMode) saveForm();
    if (document.visibilityState === 'visible') checkDate();
  });
  setInterval(checkDate, 30000);
})();
