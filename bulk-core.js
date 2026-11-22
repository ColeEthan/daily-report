(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.DailyReportBulk = factory(root.DailyReport);
})(typeof globalThis === 'object' ? globalThis : this, function (C) {
  'use strict';
  const listPrefix = /^(?:[0-9０-９]+(?:[、)）]|[.．](?![0-9０-９]))|[一二三四五六七八九十]+、|[(（][0-9０-９一二三四五六七八九十]+[)）]|[-*•]\s+)\s*/;
  const clock = /^([0-9０-９]{1,2})\s*[:：]\s*([0-9０-９]{2})/;
  const looksLikeTime = /^[0-9０-９]{1,2}\s*[:：点]/;
  const rangeSeparator = /^\s*[-－—–~～至]\s*(?:(次日)\s*)?/;
  const contentSeparator = /^[\s,，:：、]+/;
  const inlineChinese = /^\p{Script=Han}/u;
  const dateHeader = /^(?:日期\s*[:：]\s*)?(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?$/;
  const nameHeader = /^姓名\s*[:：]\s*(.*)$/;
  const namedTitle = /^(.{1,100}?)工作汇报$/;
  const reportTitle = /^(工作日报|工作汇报)$/;
  const leaveLine = /^(?:(?:上午|下午|全天)\s*)?(?:休班|休假|请假)(?:半天|一天)?[。.]?$/;
  function matchNameHeader(line, awaitingContent = false) {
    return nameHeader.exec(line) ||
      (!awaitingContent && !listPrefix.test(line) && !looksLikeTime.test(line) && namedTitle.exec(line));
  }
  function parseTimedLine(line, lineNumber) {
    const candidate = line.replace(listPrefix, '');
    const start = clock.exec(candidate);
    const invalidTime = () => new Error(`第 ${lineNumber} 行时间无法识别，请使用 08:00—10:00`);
    if (!start) {
      if (looksLikeTime.test(candidate)) throw invalidTime();
      return null;
    }

    let rest = candidate.slice(start[0].length);
    const range = rangeSeparator.exec(rest);
    let end;
    if (range) {
      rest = rest.slice(range[0].length);
      end = clock.exec(rest);
      if (end) rest = rest.slice(end[0].length);
      else if (range[1] || looksLikeTime.test(rest)) throw invalidTime();
    }
    if (rest && (!range || end) && !contentSeparator.test(rest) && !inlineChinese.test(rest)) throw invalidTime();
    const format = match => match[1].normalize('NFKC').padStart(2, '0') + ':' + match[2].normalize('NFKC');
    // Normalize only the clock digits so the pasted work description stays intact.
    return { start: format(start), end: end ? format(end) : '', nextDay: !!range?.[1],
      content: rest.replace(contentSeparator, ''), line: lineNumber };
  }

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
      if ((match = dateHeader.exec(line))) {
        const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        if (!C.validDate(date)) throw new Error(`第 ${i + 1} 行日期无效`);
        if (result.entries.length || current || (result.date && result.date !== date)) throw new Error('一次请只粘贴一天的日报，日期放在开头');
        result.date = date; continue;
      }
      if (/^(?:日期\s*[:：]|\d{4}[-年/]\d)/.test(line)) throw new Error(`第 ${i + 1} 行日期无法识别，请使用 YYYY-MM-DD`);
      if (reportTitle.test(line)) continue;
      if ((match = matchNameHeader(line, current?.content === ''))) {
        if (result.entries.length || current) throw new Error('姓名请放在日报开头');
        const name = match[1].trim();
        if (name.length > 100 || (result.name && result.name !== name)) throw new Error('姓名过长或包含多个姓名');
        result.name = name; continue;
      }
      if (leaveLine.test(line)) {
        flush();
        result.entries.push(C.makeEntry({ start: '', end: '', nextDay: false, content: line }));
        continue;
      }
      if (/^\|/.test(line)) throw new Error(`第 ${i + 1} 行是表格，请粘贴“时间段＋工作内容”的纯文字日报`);
      const timed = parseTimedLine(line, i + 1);
      if (timed) {
        flush();
        current = timed;
      } else if (listPrefix.test(line)) {
        flush();
        result.entries.push(C.makeEntry({ start: '', end: '', nextDay: false, content: line }));
      } else {
        if (current) current.content += (current.content ? '\n' : '') + line;
        else result.entries.push(C.makeEntry({ start: '', end: '', nextDay: false, content: line }));
      }
    }
    flush();
    if (!result.entries.length) throw new Error('没有识别到工作内容，请粘贴完整日报');
    return result;
  }
  function inspectInput(source) {
    let listed = 0;
    const lines = source.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
    const hasStructure = lines.some(line => {
      if (dateHeader.test(line) || reportTitle.test(line) || (lines.length > 1 && matchNameHeader(line))) return true;
      const item = line.replace(listPrefix, '');
      const numbered = line !== item;
      if (numbered && (++listed >= 2 || looksLikeTime.test(item))) return true;
      const time = clock.exec(item);
      if (!time) return false;
      const rest = item.slice(time[0].length);
      return !rest || contentSeparator.test(rest) || rangeSeparator.test(rest) || inlineChinese.test(rest);
    });
    if (!hasStructure) return { mode: 'ai' };
    try {
      const parsed = parse(source);
      const someUntimed = parsed.entries.some(item => !item.start && !leaveLine.test(item.content));
      return { mode: someUntimed ? 'choose' : 'local', parsed };
    } catch (error) {
      // An invalid report still belongs to the local validator. Never upload it by default.
      return { mode: 'local', error };
    }
  }
  const key = e => JSON.stringify([e.start, e.end, !!e.nextDay, e.legacyTime || '', e.content.trim()]);
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  function overlaps(a, b) {
    if (a.legacyTime || b.legacyTime || !a.start || !a.end || !b.start || !b.end) return false;
    return minutes(a.start) < minutes(b.end) + (b.nextDay ? 1440 : 0) && minutes(b.start) < minutes(a.end) + (a.nextDay ? 1440 : 0);
  }
  function planAppend(existing, incoming, note, estimated) {
    const occupied = existing.slice();
    const seen = new Set(existing.map(key));
    const added = [];
    let skipped = 0, cleared = 0;
    // The current AI response marks estimates for the whole batch. When the
    // note includes clock times, retain these values for the user to review.
    const mentionsClock = /[\d一二两三四五六七八九十百零〇]\s*(?:[:点时時]|分[钟鐘]|[-—–~至到]\s*[\d一二两三四五六七八九十])|(?:早|上午|中午|下午|晚)\s*[\d一二两三四五六七八九十]/.test(note.normalize('NFKC'));
    for (const entry of incoming) {
      let item = entry;
      if (seen.has(key(entry))) { skipped++; continue; }
      if (estimated && !mentionsClock && entry.start && entry.end && occupied.some(other => {
        if (!other.start && leaveLine.test(other.content.trim())) {
          if (/^上午/.test(other.content.trim())) return entry.start < '12:00';
          if (/^下午/.test(other.content.trim())) return entry.end > '13:30';
          return true;
        }
        // A start without an end leaves the remainder of the day uncertain.
        return overlaps(entry, other.start && !other.end ? { ...other, end: '00:00', nextDay: true } : other);
      })) {
        item = { ...entry, start: '', end: '', nextDay: false, needsTimeReview: true };
      }
      if (seen.has(key(item))) { skipped++; continue; }
      if (item !== entry) cleared++;
      seen.add(key(entry));
      seen.add(key(item));
      occupied.push(item);
      added.push(item);
    }
    return { added, skipped, cleared };
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
  return { parse, prepare, inspectInput, planAppend };
});
