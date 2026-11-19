(function () {
  'use strict';
  const C = DailyReport, B = DailyReportBulk, $ = id => document.getElementById(id);
  const host = window.DailyReportBulkHost;
  const writer = host ? host.writer : C.createWriter(navigator.locks), draftKey = 'daily_report_bulk_draft_v1';
  let state = C.emptyState(), raw = null, healthy = false, entries = [], previewRaw = null, plan = null;
  let dirty = false;
  let previewRevision = 0;
  function message(text) { $('message').textContent = text; }
  function saveMessage(text) { message(text); $('saveResult').textContent = text; }
  function stash() {
    dirty = true;
    try { sessionStorage.setItem(draftKey, JSON.stringify({
      source: $('source').value, date: $('date').value, name: $('name').value, entries,
      preview: !$('preview').hidden, estimated: $('aiEstimate')?.hidden === false,
      needsTimeReview: $('aiTimeReview')?.hidden === false
    })); }
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
    previewRevision++;
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
    const timeFields = [];
    const boundaries = entries.map(entry => ({ ...entry }));
    entries.forEach((entry, index) => {
      const row = node('div', '', 'entry'), head = node('div', '', 'entryHead');
      const status = node('span'); status.setAttribute('data-status', '');
      const remove = node('button', '删除', 'remove');
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条`);
      remove.addEventListener('click', () => { entries.splice(index, 1); renderRows(); update(); stash(); });
      head.append(node('strong', `第 ${index + 1} 条`), status, remove); row.append(head);
      const times = node('div', '', 'fields');
      const fields = timeFields[index] = {};
      for (const [key, label] of [['start', '开始时间'], ['end', '结束时间']]) {
        const wrap = node('label', label), input = node('input'); input.type = 'time'; input.value = entry[key];
        fields[key] = input;
        input.addEventListener('input', () => {
          entry[key] = input.value;
          if (key === 'end') {
            const previous = boundaries[index];
            const shift = C.shiftLinkedTimes(entries, index, previous, entry);
            for (const change of shift?.changes || []) {
              const following = entries[change.index];
              following.start = timeFields[change.index].start.value = change.start;
              following.end = timeFields[change.index].end.value = change.end;
              boundaries[change.index] = { ...following };
            }
            // Preserve the link when a temporary end value cannot be applied.
            if (entries[index + 1]?.start !== previous.end) boundaries[index] = { ...entry };
            if (shift?.blocked) message('联动后的时间会占用间隔、与后续时段重叠或跨天，请核对后续时间。');
            else if (shift?.changes.length) message(`已同步调整后续 ${shift.changes.length} 条记录的时间。`);
          }
          update(); stash();
        });
        wrap.append(input); times.append(wrap);
      }
      row.append(times);
      const check = node('label', '', 'check'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.nextDay;
      checkbox.addEventListener('change', () => { entry.nextDay = checkbox.checked; boundaries[index] = { ...entry }; update(); stash(); });
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
        if (healthy) previewRaw = raw;
        const estimate = $('aiEstimate');
        if (estimate) estimate.hidden = cached.estimated !== true;
        const timeReview = $('aiTimeReview');
        if (timeReview) timeReview.hidden = cached.needsTimeReview !== true;
        $('preview').hidden = false; renderRows();
      }
      dirty = !!cached.source || !!entries.length;
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
    previewRevision++;
    entries = []; plan = null; $('preview').hidden = true;
    message('文字已修改，请重新识别。'); stash(); enableSave();
  });
  function showPreview(parsed) {
    load();
    entries = parsed.entries;
    $('date').value = parsed.date || C.today();
    $('name').value = parsed.name || state.reports[$('date').value]?.name || state.preferredName;
    previewRaw = raw;
    $('preview').hidden = false;
    const estimate = $('aiEstimate');
    if (estimate) estimate.hidden = !parsed.estimated;
    const timeReview = $('aiTimeReview');
    if (timeReview) timeReview.hidden = !parsed.needsTimeReview;
    renderRows(); update(); stash();
  }
  $('parse').addEventListener('click', () => {
    try {
      showPreview(B.parse($('source').value));
      message(`已识别 ${entries.length} 条，请在下方检查日期、时间和内容。`);
    } catch (error) {
      previewRevision++;
      plan = null; $('preview').hidden = true; enableSave(); message(error.message); stash();
    }
  });
  const aiSection = host && $('aiSection');
  if (aiSection?.dataset?.endpoint) {
    let endpoint;
    try { endpoint = new URL(aiSection.dataset.endpoint, location.href); }
    catch { /* A malformed deployment address leaves the existing input available. */ }
    if (endpoint && !endpoint.username && !endpoint.password &&
        (endpoint.protocol === 'https:' ||
         (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname) &&
          ['localhost', '127.0.0.1'].includes(location.hostname)))) {
      setupAi(endpoint);
    }
  }
  function setupAi(endpoint) {
    aiSection.hidden = false;
    $('bulkButton').textContent = 'AI 生成日报 / 批量录入';
    if (location.protocol === 'file:') {
      $('bulkEntryHint').textContent = '此文件可粘贴日报，AI 生成请打开正式网页。';
      $('aiForm').hidden = true;
      $('aiLocalNotice').hidden = false;
      return;
    }
    $('bulkEntryHint').textContent = '说一句今天做了什么，让 AI 整理，或粘贴整份日报。';
    const noteInput = $('aiNote');
    const accessInput = $('aiToken');
    const remember = $('aiRememberDevice');
    const forget = $('aiForgetDevice');
    const accessSummary = $('aiAccessSummary');
    const deviceStorageKey = 'daily_report_ai_device_v1:' + endpoint.href;
    const devicePattern = /^device\.v1\.\d{10}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;
    const generate = $('aiGenerate');
    const status = $('aiStatus');
    let active = null;
    function readDevice() {
      let token = '';
      try { token = localStorage.getItem(deviceStorageKey) || ''; }
      catch { /* AI can still be used by entering the access code. */ }
      if (!devicePattern.test(token) && !window.DailyReportApprovals?.proofPattern.test(token)) token = '';
      accessSummary.textContent = token ? 'AI 访问口令（本机已记住）' : 'AI 访问口令';
      forget.hidden = !token;
      return token;
    }
    function saveDevice(token) {
      try {
        if (token) localStorage.setItem(deviceStorageKey, token);
        else localStorage.removeItem(deviceStorageKey);
      } catch { return false; }
      readDevice();
      return true;
    }
    readDevice();
    const approvals = window.DailyReportApprovals?.setup({ endpoint, readDevice, saveDevice, onApproved() {
      accessInput.value = '';
      remember.checked = false;
      $('aiAccess').open = false;
      status.textContent = '';
    } });
    window.addEventListener('storage', event => {
      if (event.key === deviceStorageKey || event.key === null) readDevice();
    });
    forget.addEventListener('click', () => {
      if (!saveDevice('')) {
        status.textContent = '浏览器未能清除本机记忆。';
        return;
      }
      active?.abort();
      accessInput.value = '';
      remember.checked = false;
      status.textContent = '已忘记此设备，下次生成时请输入口令。';
      approvals?.refresh();
    });
    $('bulkDialog').addEventListener('close', () => active?.abort());
    generate.addEventListener('click', async () => {
      if (active) return;
      const note = noteInput.value.trim();
      const entered = accessInput.value.trim();
      const token = entered || readDevice();
      if (!note) {
        status.textContent = '请先填写工作简述。';
        noteInput.focus();
        return;
      }
      if (!token) {
        if (approvals?.hasPending()) {
          status.textContent = 'AI 权限还在等待审批，请稍后查询。';
          return;
        }
        status.textContent = '请输入 AI 访问口令。';
        $('aiAccess').open = true;
        accessInput.focus();
        return;
      }
      const rememberRequested = !!entered && remember.checked;
      const requestedDate = $('reportDate').value;
      const revision = previewRevision;
      const controller = new AbortController();
      active = controller;
      const timer = setTimeout(() => controller.abort(), 30000);
      generate.disabled = true;
      status.textContent = '正在生成日报…';
      let failure = 'AI 暂时无法连接，简述已保留，请重试。';
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(rememberRequested ? { note, rememberDevice: true } : { note }),
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error'
        });
        if (!response.ok) {
          failure = `AI 服务返回错误（HTTP ${response.status}），简述已保留，请重试。`;
          if (response.status === 401) {
            $('aiAccess').open = true;
            if (entered) {
              failure = 'AI 访问口令不正确，请检查后重试。';
            } else {
              if (readDevice() === token) saveDevice('');
              approvals?.refresh();
              failure = window.DailyReportApprovals?.proofPattern.test(token)
                ? '此设备授权已到期或被撤销，请重新申请。'
                : '本机记忆已失效，请重新输入 AI 访问口令。';
            }
            accessInput.focus();
          } else if (response.status === 429) {
            failure = '免费模型暂时限流，请稍后重试。';
          } else if (response.status === 422) {
            failure = '未识别到工作事项，请补充当天做了什么。';
          } else if (response.status === 503) {
            failure = 'AI 接口尚未完成配置。';
          } else if (response.status === 504) {
            failure = '模型响应超时，简述已保留，请稍后重试。';
          } else if (response.status === 502) {
            const detail = await response.json().catch(() => null);
            if (detail?.code === 'provider_key_invalid') {
              failure = '硅基流动 API Key 无效，请在 Cloudflare 更新 SILICONFLOW_API_KEY。';
            } else if (detail?.code === 'provider_output_invalid') {
              failure = '模型返回的日报格式不完整，简述已保留，请重试。';
            } else if (detail?.code === 'provider_unavailable') {
              failure = '模型服务暂时无法响应，简述已保留，请稍后重试。';
            } else {
              failure = '模型生成失败，简述已保留，请重试。';
            }
          }
          throw new Error('Generation failed');
        }
        failure = 'AI 返回的格式无法使用，简述已保留，请重试。';
        const result = await response.json();
        if (!Array.isArray(result.entries) || !result.entries.length || result.entries.length > 15) {
          throw new Error('Invalid report');
        }
        const generated = result.entries.map(entry => C.makeEntry({
          content: entry.content, start: entry.start, end: entry.end, nextDay: entry.nextDay
        }));
        if (controller.signal.aborted) return;
        if (note !== noteInput.value.trim() || revision !== previewRevision) {
          status.textContent = '输入或预览已变化，请重新生成。';
          return;
        }
        showPreview({
          date: C.validDate(requestedDate) ? requestedDate : C.today(),
          entries: generated,
          estimated: result.estimated === true,
          needsTimeReview: result.needsTimeReview === true
        });
        $('aiAccess').open = false;
        let rememberMessage = '';
        if (rememberRequested) {
          if (devicePattern.test(result.deviceToken || '') && saveDevice(result.deviceToken)) {
            accessInput.value = '';
            remember.checked = false;
            rememberMessage = '已记住此设备 30 天。';
            approvals?.refresh();
          } else {
            rememberMessage = '本次未能记住设备。';
          }
        }
        status.textContent = `${rememberMessage}已生成 ${generated.length} 条，确认后保存。`;
        message('');
        $('preview').scrollIntoView({ block: 'start' });
      } catch {
        status.textContent = controller.signal.aborted ? '生成已中止，简述已保留。' : failure;
      } finally {
        clearTimeout(timer);
        active = null;
        generate.disabled = false;
      }
    });
  }
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
