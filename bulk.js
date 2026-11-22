(function () {
  'use strict';
  const C = DailyReport, B = DailyReportBulk, $ = id => document.getElementById(id);
  const sourceInput = $('source');
  const appendInput = $('appendSource');
  const host = window.DailyReportBulkHost;
  const writer = host ? host.writer : C.createWriter(navigator.locks), draftKey = 'daily_report_bulk_draft_v1';
  let state = C.emptyState(), raw = null, healthy = false, entries = [], previewRaw = null, plan = null;
  let dirty = false;
  let previewRevision = 0;
  let generateAppend = null;
  let appendDate = '';
  function hasPendingAppend() { return !!appendInput.value.trim(); }
  let copyAttempt = 0;
  function message(text) { $('message').textContent = text; }
  function saveMessage(text) { message(text); $('saveResult').textContent = text; }
  function stash() {
    dirty = true;
    try { sessionStorage.setItem(draftKey, JSON.stringify({
      source: sourceInput.value, appendSource: appendInput.value, appendDate, date: $('date').value, name: $('name').value, entries,
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
    $('bulkManualCopy').hidden = true;
    $('confirm').checked = false;
    try {
      if (showingSavedDay()) {
        $('summary').textContent = `当天已保存 ${state.reports[$('date').value].entries.length} 条。可以继续补充，或返回日报修改已保存的记录。`;
        $('warnings').hidden = $('confirmWrap').hidden = true;
      } else if (!$('preview').hidden) {
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
  function showingSavedDay() {
    return !entries.length && !$('preview').hidden && !!state.reports[$('date').value]?.entries.length;
  }
  function enableSave() {
    const pending = hasPendingAppend();
    $('appendPendingMark').hidden = !pending;
    const ready = healthy && writer.active && previewRaw === raw && !pending &&
      (!plan?.warnings.length || $('confirm').checked);
    const copyOnly = showingSavedDay() || (plan && !plan.added && plan.skipped > 0);
    $('save').disabled = !ready || !plan?.added;
    $('saveCopy').disabled = !ready || (!plan?.added && !copyOnly);
    $('saveCopy').textContent = copyOnly ? '复制当天完整汇报' : '保存并复制汇报';
    if (pending) $('bulkManualCopy').hidden = true;
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
      if (entry.needsTimeReview) head.append(node('strong', '请核对本条时间'));
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
      sourceInput.value = cached.source;
      if (C.validDate(cached.date)) $('date').value = cached.date;
      if (typeof cached.name === 'string') $('name').value = cached.name;
      if (typeof cached.appendSource === 'string' && cached.appendSource) {
        appendInput.value = cached.appendSource;
        appendDate = C.validDate(cached.appendDate) ? cached.appendDate : $('date').value;
        $('appendPanel').open = true;
        if (!cached.preview) message('补充内容已暂存，重新预览后可继续追加。');
      }
      if (cached.preview && Array.isArray(cached.entries)) {
        // Draft rows can be incomplete. prepare() validates them before saving.
        entries = cached.entries.map(({ start, end, nextDay, content, needsTimeReview }) => {
          if (typeof start !== 'string' || typeof end !== 'string' || typeof content !== 'string') {
            throw new Error('预览草稿字段无效');
          }
          return { start, end, nextDay: nextDay === true, content, needsTimeReview: needsTimeReview === true };
        });
        if (healthy) previewRaw = raw;
        const estimate = $('aiEstimate');
        if (estimate) estimate.hidden = cached.estimated !== true;
        const timeReview = $('aiTimeReview');
        if (timeReview) timeReview.hidden = cached.needsTimeReview !== true;
        $('preview').hidden = false; renderRows();
      }
      dirty = !!cached.source || !!entries.length || hasPendingAppend();
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
    if (previousRaw !== raw) {
      previewRaw = showingSavedDay() && !hasPendingAppend() ? raw : undefined;
      if (showingSavedDay()) $('name').value = state.reports[$('date').value].name;
    }
    if (healthy) $('lockStatus').textContent = writer.active
      ? ''
      : '当前页面为只读。请关闭其他日报页面，再刷新本页；当前输入会暂存。';
    if (healthy && writer.active && !$('preview').hidden && previewRaw !== raw) $('lockStatus').textContent = '日报记录已有变化，请重新预览后保存。';
    $('retry').hidden = true;
    update();
  }
  if (host) host.subscribe(refreshHost);
  $('retry').addEventListener('click', acquire);
  appendInput.addEventListener('input', () => {
    appendDate = hasPendingAppend() ? appendDate || $('date').value : '';
    $('appendStatus').textContent = '';
    $('appendLocal').hidden = true;
    enableSave(); stash();
  });
  sourceInput.addEventListener('input', () => {
    previewRevision++;
    $('appendPanel').open = hasPendingAppend();
    $('appendStatus').textContent = '';
    $('appendLocal').hidden = true;
    entries = []; plan = null; $('preview').hidden = true;
    message(hasPendingAppend() ? '补充内容已暂存，重新预览后可继续追加。' : ''); stash(); enableSave();
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
  function appendPreview(parsed, note) {
    const date = $('date').value;
    if (parsed.date && parsed.date !== date) throw new Error('补充内容的日期与当前预览不同，请核对日期再追加。');
    const selectedName = $('name').value.trim();
    if (parsed.name) {
      const conflict = [state.reports[date]?.name, selectedName].find(name => name && name !== parsed.name);
      if (conflict) throw new Error(`补充内容的姓名“${parsed.name}”与当前日报姓名“${conflict}”不同，请核对后再追加。`);
    }
    const existing = (state.reports[date]?.entries || []).concat(entries);
    const result = B.planAppend(existing, parsed.entries, note, parsed.estimated);
    if (!selectedName && parsed.name) $('name').value = parsed.name;
    const firstNew = entries.length;
    entries.push(...result.added);
    if (result.added.length) {
      if (parsed.estimated && $('aiEstimate')) $('aiEstimate').hidden = false;
      if ((result.cleared || parsed.needsTimeReview) && $('aiTimeReview')) $('aiTimeReview').hidden = false;
    }
    appendInput.value = '';
    appendDate = '';
    $('appendLocal').hidden = true;
    renderRows(); update(); stash();
    let text = `已追加 ${result.added.length} 条到预览。`;
    if (result.skipped) text += `已跳过 ${result.skipped} 条完全重复的记录。`;
    if (result.cleared) text += `其中 ${result.cleared} 条估排时间已被占用，已留空，请填写。`;
    $('appendStatus').textContent = text;
    $('rows').children[firstNew]?.scrollIntoView?.({ block: 'nearest' });
  }
  function submitAppend(useAi) {
    const note = appendInput.value.trim();
    if (!note) {
      $('appendStatus').textContent = '请填写要补充的工作。';
      appendInput.focus?.();
      return;
    }
    try {
      if ($('preview').hidden) throw new Error('请先预览当天的记录。');
      if (!C.validDate($('date').value)) throw new Error('请先在预览中选择日期。');
      const decision = B.inspectInput(note);
      if (decision.error) throw decision.error;
      if (appendDate && appendDate !== $('date').value &&
          !confirm(`补充内容原属 ${appendDate}，确定追加至 ${$('date').value} 吗？`)) return;
      if (useAi && generateAppend && decision.mode === 'ai') return generateAppend();
      appendPreview(decision.parsed || B.parse(note), note);
    } catch (error) {
      $('appendStatus').textContent = error.message;
    }
  }
  $('appendSubmit').addEventListener('click', () => submitAppend(true));
  $('appendLocal').addEventListener('click', () => submitAppend(false));
  function checkPendingAppend() {
    if ($('preview').hidden || !hasPendingAppend()) return false;
    $('appendPanel').open = true;
    $('appendStatus').textContent = '请先追加这段补充内容，或清空补充框，再重新生成。';
    appendInput.focus?.();
    return true;
  }
  function parseSource(decision) {
    if (checkPendingAppend()) return;
    try {
      if (decision?.error) throw decision.error;
      const parsed = decision?.parsed || B.parse(sourceInput.value);
      const selectedDate = host && $('reportDate').value;
      showPreview({ ...parsed, date: parsed.date || (C.validDate(selectedDate) ? selectedDate : '') });
      message(`已识别 ${entries.length} 条，请在下方检查日期、时间和内容。`);
      $('preview').scrollIntoView?.({ block: 'start' });
    } catch (error) {
      previewRevision++;
      plan = null; $('preview').hidden = true; enableSave(); message(error.message); stash();
    }
  }
  $('parse').addEventListener('click', () => parseSource());
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
    if (location.protocol === 'file:') {
      $('aiLocalNotice').hidden = false;
      return;
    }
    aiSection.hidden = false;
    const intake = $('intake');
    const parse = $('parse');
    const generate = $('aiGenerate');
    const status = $('aiStatus');
    let choice = null;
    let active = null;
    let activeAppend = false;
    function showChoices(decision = null) {
      choice = decision;
      intake.hidden = !!choice;
      parse.hidden = !choice;
      generate.hidden = !choice;
    }
    function stopActive() {
      if (!active) return;
      active.abort();
      active = null;
      if (activeAppend && hasPendingAppend()) $('appendStatus').textContent = '补充内容已保留，可以继续追加。';
      activeAppend = false;
      $('appendSubmit').disabled = intake.disabled = generate.disabled = false;
    }
    generateAppend = () => generateReport(null, true);
    appendInput.addEventListener('input', () => {
      if (active) {
        stopActive();
        status.textContent = '';
        $('appendStatus').textContent = '';
      }
    });
    showChoices();
    sourceInput.addEventListener('input', () => {
      stopActive();
      status.textContent = '';
      showChoices();
    });
    parse.addEventListener('click', () => {
      stopActive();
      status.textContent = '';
    });
    intake.addEventListener('click', () => {
      const note = sourceInput.value.trim();
      if (!note) {
        message('请填写工作内容或粘贴整份日报。');
        sourceInput.focus();
        return;
      }
      const decision = B.inspectInput(note);
      if (decision.mode === 'local') {
        stopActive();
        status.textContent = '';
        parseSource(decision);
      } else if (decision.mode === 'choose') {
        status.textContent = '';
        showChoices(decision);
        message('有些事项没有明确时间。按原文录入会留空，AI 整理可帮你拆分和估排。');
      } else {
        return generateReport();
      }
    });
    const accessInput = $('aiToken');
    const remember = $('aiRememberDevice');
    const forget = $('aiForgetDevice');
    const accessSummary = $('aiAccessSummary');
    // Keep browser credentials when the same Worker moves to a different hostname.
    const credentialScope = aiSection.dataset.credentialScope || endpoint.href;
    const deviceStorageKey = 'daily_report_ai_device_v1:' + credentialScope;
    const devicePattern = /^device\.v1\.\d{10}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;
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
    const approvals = window.DailyReportApprovals?.setup({ endpoint, credentialScope, readDevice, saveDevice, onApproved() {
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
      stopActive();
      accessInput.value = '';
      remember.checked = false;
      status.textContent = '已忘记此设备，下次生成时请输入口令。';
      approvals?.refresh();
    });
    $('bulkDialog').addEventListener('close', stopActive);
    generate.addEventListener('click', () => generateReport(choice?.parsed));
    async function generateReport(parsed, appending = false) {
      if (active) return;
      if (!appending && checkPendingAppend()) return;
      const input = appending ? appendInput : sourceInput;
      const feedback = appending ? $('appendStatus') : status;
      const localButton = appending ? $('appendLocal') : parse;
      const note = input.value.trim();
      const entered = accessInput.value.trim();
      const token = entered || readDevice();
      if (!note) {
        feedback.textContent = '请先填写工作内容。';
        input.focus();
        return;
      }
      if (note.length > 1800) {
        feedback.textContent = 'AI 一次最多整理 1800 字。可以缩短后再试，或按原文录入。';
        localButton.hidden = false;
        return;
      }
      if (!token) {
        localButton.hidden = false;
        if (approvals?.hasPending()) {
          feedback.textContent = 'AI 权限还在等待审批，请稍后查询。';
          return;
        }
        feedback.textContent = '请输入 AI 访问口令，或按原文录入。';
        $('aiAccess').open = true;
        accessInput.focus();
        return;
      }
      const rememberRequested = !!entered && remember.checked;
      const requestedDate = parsed?.date || $('reportDate').value;
      const revision = previewRevision;
      const controller = new AbortController();
      active = controller;
      activeAppend = appending;
      const timer = setTimeout(() => controller.abort(), 30000);
      $('appendSubmit').disabled = intake.disabled = generate.disabled = true;
      if (appending) localButton.hidden = true;
      message('');
      feedback.textContent = appending ? '正在整理补充内容…' : '正在生成日报…';
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
        if (active !== controller || revision !== previewRevision) return;
        if (controller.signal.aborted) throw new Error('Generation timed out');
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
          } else if (response.status === 402) {
            failure = 'DeepSeek API 账户余额不足，简述已保留。';
          } else if (response.status === 429) {
            failure = 'AI 请求过多，请稍后重试。简述已保留。';
          } else if (response.status === 422) {
            failure = '未识别到工作事项，请补充当天做了什么。';
          } else if (response.status === 503) {
            failure = 'AI 接口尚未完成配置。';
          } else if (response.status === 504) {
            failure = '模型响应超时，简述已保留，请稍后重试。';
          } else if (response.status === 502) {
            const detail = await response.json().catch(() => null);
            if (detail?.code === 'provider_key_invalid') {
              failure = 'DeepSeek API 密钥无效，请在 Cloudflare 更新 DEEPSEEK_API_KEY。';
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
        const generated = result.entries.map(entry => ({
          ...C.makeEntry({ content: entry.content, start: entry.start, end: entry.end, nextDay: entry.nextDay }),
          needsTimeReview: entry.needsTimeReview === true
        }));
        if (controller.signal.aborted) throw new Error('Generation timed out');
        if (active !== controller || note !== input.value.trim() || revision !== previewRevision) return;
        const newRows = {
          entries: generated,
          estimated: result.estimated === true,
          needsTimeReview: result.needsTimeReview === true
        };
        if (appending) {
          appendPreview(newRows, note);
        } else {
          showPreview({ ...newRows, date: C.validDate(requestedDate) ? requestedDate : C.today(), name: parsed?.name });
        }
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
        if (!appending) {
          status.textContent = `${rememberMessage}已生成 ${generated.length} 条，确认后保存。`;
          message('');
          $('preview').scrollIntoView({ block: 'start' });
        }
      } catch {
        if (active === controller && revision === previewRevision) {
          feedback.textContent = controller.signal.aborted ? '生成超时，输入已保留，请重试。' : failure;
          localButton.hidden = false;
        }
      } finally {
        clearTimeout(timer);
        if (active === controller) {
          if (appending && hasPendingAppend() && revision !== previewRevision) {
            feedback.textContent = '预览已修改，补充内容已保留，请重新追加。';
          }
          active = null;
          activeAppend = false;
          $('appendSubmit').disabled = intake.disabled = generate.disabled = false;
        }
      }
    }
  }
  $('date').addEventListener('change', () => { update(); stash(); });
  $('name').addEventListener('input', () => { update(); stash(); });
  $('confirm').addEventListener('change', enableSave);
  async function copySavedReport(date) {
    const revision = previewRevision;
    const attempt = ++copyAttempt;
    const isCurrent = () => attempt === copyAttempt && revision === previewRevision && !hasPendingAppend() &&
      (!host || $('bulkDialog').open);
    const text = C.buildReport(date, state.reports[date]);
    const copied = await C.copyReportText(text, $('bulkManualCopy'), navigator, document, isCurrent);
    if (isCurrent()) {
      const message = copied ? '已复制当天完整汇报。' : '自动复制失败，请重试复制或长按下方文字手动复制。';
      saveMessage(`${C.displayDate(date)}的记录已保存。${message}`);
    }
  }
  function finishPreview(withCopy) {
    if ($(withCopy ? 'saveCopy' : 'save').disabled || hasPendingAppend()) return;
    const date = $('date').value;
    try {
      if (!healthy || !writer.active) throw new Error('尚未取得保存权限，请重新连接保存');
      if (previewRaw !== raw || localStorage.getItem(C.STORAGE_KEY) !== previewRaw) throw new Error('日报数据已有变化，请重新预览后保存。当前输入仍保留。');
      if (!showingSavedDay()) {
        const checked = B.prepare(state, date, $('name').value, entries);
        if (checked.warnings.length && !$('confirm').checked) return;
        if (checked.added) {
          raw = host ? host.save(checked.state, previewRaw, date) : C.save(localStorage, checked.state, previewRaw, writer);
          state = checked.state;
          previewRaw = raw;
        } else if (!withCopy || !checked.skipped) {
          return;
        }
        $('name').value = state.reports[date].name;
        entries = [];
        renderRows();
        $('appendStatus').textContent = '';
        for (const id of ['aiEstimate', 'aiTimeReview']) {
          if ($(id)) $(id).hidden = true;
        }
        dirty = false;
        try { sessionStorage.removeItem(draftKey); } catch { /* Records are already saved. */ }
        update();
        saveMessage(`已保存到 ${date}，新增 ${checked.added} 条，跳过重复 ${checked.skipped} 条。`);
      }
    } catch (error) {
      saveMessage(error.name === 'QuotaExceededError' ? '保存空间不足，尚未写入。当前文字和预览仍保留，请先到原日报导出备份并清理空间。' : `保存失败：${error.message}`);
      if (entries.length) stash();
      return;
    }
    if (withCopy) return copySavedReport(date);
  }
  $('save').addEventListener('click', () => finishPreview(false));
  $('saveCopy').addEventListener('click', () => finishPreview(true));
  window.addEventListener('storage', event => {
    if (event.key !== C.STORAGE_KEY && event.key !== null) return;
    load();
    if (showingSavedDay() && !hasPendingAppend()) {
      previewRaw = raw;
      $('name').value = state.reports[$('date').value].name;
    } else {
      $('lockStatus').textContent = '日报数据已变化，请重新识别预览后再保存。';
      // Keep edited rows visible, but never authorize a stale preview.
      previewRaw = undefined;
    }
    update();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { if (!host) writer.release(); enableSave(); });
  window.addEventListener('pageshow', event => { if (event.persisted && !host) acquire(); });
  acquire();
})();
