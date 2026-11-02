(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.DailyReportBulk = factory(root.DailyReport);
})(typeof globalThis === 'object' ? globalThis : this, function (C) {
  'use strict';
  function parse(source) {
    if (typeof source !== 'string' || source.length > 100000) throw new Error('一次最多粘贴 10 万字');
    const result = { date: '', name: '', entries: [] };
    let current = null;
    function flush() {
      if (!current) return;
      if (!current.content.trim()) throw new Error(`第 ${current.line} 行的时间段缺少工作内容`);
      try { result.entries.push(C.makeEntry(current)); }
      catch (error) { throw new Error(`第 ${current.line} 行：${error.message}`); }
      current = null;
    }
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^```(?:text|plaintext)?$/.test(line)) continue;
      let match;
      if ((match = /^(?:日期\s*[:：]\s*)?(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?$/.exec(line))) {
        const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        if (!C.validDate(date)) throw new Error(`第 ${i + 1} 行日期无效`);
        if (result.entries.length || current || (result.date && result.date !== date)) throw new Error('一次请只粘贴一天的日报，日期放在开头');
        result.date = date; continue;
      }
      if (/^(?:日期\s*[:：]|\d{4}[-年/]\d)/.test(line)) throw new Error(`第 ${i + 1} 行日期无法识别，请使用 YYYY-MM-DD`);
      if (/^(工作日报|工作汇报)$/.test(line)) continue;
      if ((match = /^(?:姓名\s*[:：]\s*(.*)|(.{1,100}?)工作汇报)$/.exec(line))) {
        if (result.entries.length || current) throw new Error('姓名请放在日报开头');
        const name = (match[1] ?? match[2]).trim();
        if (name.length > 100 || (result.name && result.name !== name)) throw new Error('姓名过长或包含多个姓名');
        result.name = name; continue;
      }
      if (/^(?:(?:上午|下午|全天)\s*)?(?:休班|休假|请假)(?:半天|一天)?[。.]?$/.test(line)) {
        flush();
        result.entries.push(C.makeEntry({ start: '', end: '', nextDay: false, content: line }));
        continue;
      }
      if (/^\|/.test(line)) throw new Error(`第 ${i + 1} 行是表格，请粘贴“时间段＋工作内容”的纯文字日报`);
      const normalized = line.replace(/：/g, ':');
      match = /^(\d{1,2}:\d{2})(?:\s*[-—–~～至]\s*(?:(次日)\s*)?(\d{1,2}:\d{2})?)?(?=$|[\s,，:：、])(?:[\s,，:：、]+)?(.*)$/.exec(normalized);
      if (match) {
        flush();
        // Keep the original punctuation of the content, including Chinese colons.
        const content = line.slice(line.length - match[4].length);
        current = { start: match[1].padStart(5, '0'), end: (match[3] || '').padStart(match[3] ? 5 : 0, '0'), nextDay: !!match[2], content, legacyTime: '', line: i + 1 };
      } else {
        if (/^\d{1,2}\s*[:：]/.test(line) || /^\d{1,2}\s*点/.test(line)) throw new Error(`第 ${i + 1} 行时间无法识别，请使用 08:00—10:00`);
        if (current) current.content += (current.content ? '\n' : '') + line;
        else result.entries.push(C.makeEntry({ start: '', end: '', nextDay: false, content: line }));
      }
    }
    flush();
    if (!result.entries.length) throw new Error('没有识别到工作内容，请粘贴完整日报');
    return result;
  }
  const key = e => JSON.stringify([e.start, e.end, !!e.nextDay, e.legacyTime || '', e.content.trim()]);
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  function overlaps(a, b) {
    if (a.legacyTime || b.legacyTime || !a.start || !a.end || !b.start || !b.end) return false;
    return minutes(a.start) < minutes(b.end) + (b.nextDay ? 1440 : 0) && minutes(b.start) < minutes(a.end) + (a.nextDay ? 1440 : 0);
  }
  function prepare(state, date, name, entries) {
    if (!C.validDate(date)) throw new Error('请选择有效日期');
    if (typeof name !== 'string' || name.trim().length > 100) throw new Error('姓名最多 100 字');
    if (!entries.length) throw new Error('请至少保留一条记录');
    const next = C.clone(state), existing = next.reports[date];
    const target = existing || { name: name.trim(), entries: [] };
    const warnings = [], statuses = [];
    if (existing?.name && name.trim() !== existing.name) warnings.push(`当天已有姓名“${existing.name}”，本次保留该姓名。`);
    let skipped = 0, added = 0;
    for (const [index, input] of entries.entries()) {
      let entry;
      try { entry = C.makeEntry({ ...input, legacyTime: '' }); }
      catch (error) { throw new Error(`第 ${index + 1} 条：${error.message}`); }
      if (target.entries.some(e => key(e) === key(entry))) {
        skipped++; statuses.push('完全重复，将跳过'); continue;
      }
      const reasons = [];
      if (target.entries.some(e => e.content.trim() === entry.content)) reasons.push('相同内容已有记录');
      if (target.entries.some(e => overlaps(e, entry))) reasons.push('时间与其他记录重叠');
      if (reasons.length) warnings.push(`第 ${index + 1} 条：${reasons.join('；')}。`);
      statuses.push(reasons.join('；') || '将新增');
      target.entries.push(entry); added++;
    }
    if (added) {
      if (!target.name) target.name = name.trim();
      next.reports[date] = target;
      if (!next.preferredName) next.preferredName = name.trim();
    }
    return { state: C.validateState(next), added, skipped, warnings, statuses, existing: existing ? existing.entries.length - added : 0 };
  }
  return { parse, prepare };
});
