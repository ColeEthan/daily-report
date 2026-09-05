/* Shared, dependency-free data rules. The old storage keys remain untouched. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailyReport = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'daily_report_v2';
  const LEGACY_KEY = 'daily_report';
  const NAME_KEY = 'daily_report_name';
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function text(value, max = 20000) {
    assert(typeof value === 'string' && value.length <= max, '备份中的文字格式或长度不正确');
    return value;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function today(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function displayDate(date) {
    assert(validDate(date), '日期无效');
    const [y, m, d] = date.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  }
  function id() {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  function emptyState(name = '') { return { version: 2, preferredName: name, reports: {}, drafts: {} }; }
  function timeValue(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function validateRange(start, end, nextDay) {
    assert(!start || timeValue(start), '开始时间无效');
    assert(!end || timeValue(end), '结束时间无效');
    assert(!end || start, '请填写开始时间');
    assert(!nextDay || (start && end), '跨夜工作请填写开始和结束时间');
    assert(!start || !end || nextDay || end > start, '结束时间应晚于开始时间；跨夜工作请勾选“次日结束”');
  }
  function shortTime(value) { return value ? value.replace(/^0/, '') : ''; }
  function entryTime(entry) {
    if (entry.legacyTime) return entry.legacyTime;
    if (!entry.start) return '';
    return shortTime(entry.start) + (entry.end ? `-${entry.nextDay ? '次日' : ''}${shortTime(entry.end)}` : '');
  }
  function validateState(input) {
    assert(isObject(input) && input.version === 2, '不支持的日报数据版本');
    assert(isObject(input.reports) && isObject(input.drafts), '日报数据结构不正确');
    const result = emptyState(text(input.preferredName, 100));
    const ids = new Set();
    for (const [date, report] of Object.entries(input.reports)) {
      assert(validDate(date) && isObject(report) && Array.isArray(report.entries), '日报日期或记录格式不正确');
      result.reports[date] = { name: text(report.name, 100), entries: report.entries.map(entry => {
        assert(isObject(entry), '记录格式不正确');
        const clean = {
          id: text(entry.id, 150), start: text(entry.start, 5), end: text(entry.end, 5),
          nextDay: entry.nextDay, content: text(entry.content), legacyTime: text(entry.legacyTime || '', 100)
        };
        assert(clean.id && !ids.has(clean.id), '记录编号重复或缺失');
        ids.add(clean.id);
        assert(typeof clean.nextDay === 'boolean' && (!clean.start || timeValue(clean.start)) && (!clean.end || timeValue(clean.end)), '时间格式不正确');
        assert(clean.content.trim(), '记录内容不能为空');
        return clean;
      }) };
    }
    for (const [date, draft] of Object.entries(input.drafts)) {
      assert(validDate(date) && isObject(draft), '草稿格式不正确');
      const clean = {
        entryId: draft.entryId === null ? null : text(draft.entryId, 150),
        start: text(draft.start, 5), end: text(draft.end, 5), nextDay: draft.nextDay,
        content: text(draft.content), legacyTime: text(draft.legacyTime || '', 100)
      };
      assert(typeof clean.nextDay === 'boolean' && (!clean.start || timeValue(clean.start)) && (!clean.end || timeValue(clean.end)), '草稿时间格式不正确');
      if (clean.entryId && !result.reports[date]?.entries.some(entry => entry.id === clean.entryId)) clean.entryId = null;
      result.drafts[date] = clean;
    }
    return result;
  }
  function migrateLegacy(input, name = '') {
    assert(isObject(input), '旧版日报数据损坏，已停止写入');
    const state = emptyState(name === '工作汇报' ? '' : name);
    for (const [date, entries] of Object.entries(input)) {
      assert(validDate(date) && Array.isArray(entries), '旧版日报格式不正确，已停止写入');
      state.reports[date] = { name: state.preferredName, entries: entries.map((entry, index) => {
        assert(isObject(entry), '旧版记录格式不正确');
        const content = text(entry.content);
        const oldTime = text(entry.time || '', 100);
        const match = /^(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?$/.exec(oldTime);
        const start = match ? match[1].padStart(5, '0') : '';
        const end = match?.[2] ? match[2].padStart(5, '0') : '';
        const structured = match && timeValue(start) && (!end || (timeValue(end) && end > start));
        // Deterministic IDs let repeated imports of the same legacy backup deduplicate.
        let hash = 2166136261;
        for (const char of `${oldTime}\n${content}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        return { id: `legacy-${date}-${index}-${hash}`, start: structured ? start : '', end: structured ? end : '', nextDay: false, content, legacyTime: structured ? '' : oldTime };
      }) };
    }
    return validateState(state);
  }
  function load(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) return { state: validateState(JSON.parse(raw)), raw };
    const legacy = storage.getItem(LEGACY_KEY);
    const name = storage.getItem(NAME_KEY) || '';
    return { state: migrateLegacy(legacy === null ? {} : JSON.parse(legacy), name), raw: null };
  }
  function save(storage, state, expectedRaw) {
    assert(storage.getItem(STORAGE_KEY) === expectedRaw, '另一个页面更新了日报，请先备份当前输入，再刷新页面');
    const raw = JSON.stringify(validateState(state));
    storage.setItem(STORAGE_KEY, raw);
    return raw;
  }
  function makeEntry(draft, entryId = id()) {
    const content = draft.content.trim();
    assert(content, '请输入工作内容');
    assert(content.length <= 20000, '工作内容不能超过 20000 字');
    if (!draft.legacyTime) validateRange(draft.start, draft.end, draft.nextDay);
    return { id: entryId, start: draft.start, end: draft.end, nextDay: !!draft.nextDay, content, legacyTime: draft.legacyTime || '' };
  }
  function buildReport(date, report) {
    const title = report.name.trim() ? `${report.name.trim()}工作汇报` : '工作汇报';
    const lines = report.entries.map((entry, index) => {
      const time = entryTime(entry);
      let content = entry.content.trim().replace(/[。.，,；;]+$/g, '');
      if (!/[！？!?]$/.test(content)) content += '。';
      return `${index + 1}，${time ? `${time}，` : ''}${content}`;
    });
    return `${displayDate(date)}\n${title}\n${lines.join('\n')}\n`;
  }
  function exportBackup(state) {
    return JSON.stringify({ format: 'daily-report-backup', version: 2, exportedAt: new Date().toISOString(), data: validateState(state) }, null, 2);
  }
  function parseBackup(raw) {
    assert(typeof raw === 'string' && raw.length <= 10 * 1024 * 1024, '备份文件过大（最大 10 MB）');
    const input = JSON.parse(raw);
    if (isObject(input) && input.format === 'daily-report-backup') {
      assert(input.version === 2, '不支持的备份版本');
      return validateState(input.data);
    }
    if (isObject(input) && own(input, 'version')) return validateState(input);
    assert(isObject(input) && Object.keys(input).length > 0, '文件不包含日报记录');
    return migrateLegacy(input);
  }
  function sameEntry(a, b) {
    return a.content === b.content && entryTime(a) === entryTime(b);
  }
  function conflictId(entry, date) {
    let hash = 2166136261;
    for (const char of `${date}\n${entryTime(entry)}\n${entry.content}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return `${entry.id.slice(0, 90)}-import-${hash}`;
  }
  function mergeBackup(current, incoming) {
    const state = validateState(current);
    incoming = validateState(incoming);
    const stats = { added: 0, skipped: 0, conflicts: 0, drafts: 0, draftConflicts: 0, nameConflicts: 0 };
    const ids = new Set(Object.values(state.reports).flatMap(report => report.entries.map(entry => entry.id)));
    for (const [date, report] of Object.entries(incoming.reports)) {
      if (!state.reports[date]) state.reports[date] = { name: report.name, entries: [] };
      const target = state.reports[date];
      if (target.name && report.name && target.name !== report.name) stats.nameConflicts++;
      if (!target.name) target.name = report.name;
      for (const entry of report.entries) {
        if (target.entries.some(existing => existing.id === entry.id && sameEntry(existing, entry))) { stats.skipped++; continue; }
        const added = clone(entry);
        if (ids.has(added.id)) {
          const baseId = conflictId(entry, date);
          added.id = baseId;
          let suffix = 1;
          while (ids.has(added.id) && !target.entries.some(existing => existing.id === added.id && sameEntry(existing, entry))) added.id = `${baseId}-${suffix++}`;
          if (target.entries.some(existing => existing.id === added.id && sameEntry(existing, entry))) { stats.skipped++; continue; }
          stats.conflicts++;
        }
        target.entries.push(added);
        ids.add(added.id);
        stats.added++;
      }
    }
    for (const [date, draft] of Object.entries(incoming.drafts)) {
      const existing = state.drafts[date];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(draft)) stats.draftConflicts++;
      } else {
        // Imported edits become independent drafts so saving cannot overwrite a local entry.
        state.drafts[date] = { ...draft, entryId: null };
        stats.drafts++;
      }
    }
    if (!state.preferredName) state.preferredName = incoming.preferredName;
    return { state: validateState(state), stats };
  }
  return { STORAGE_KEY, LEGACY_KEY, NAME_KEY, clone, validDate, today, displayDate, id, emptyState, validateRange, entryTime, validateState, migrateLegacy, load, save, makeEntry, buildReport, exportBackup, parseBackup, mergeBackup };
});
