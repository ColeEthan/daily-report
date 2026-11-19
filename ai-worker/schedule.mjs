const windows = {
  morning: [480, 720],
  afternoon: [810, 1050]
};
const periods = new Set(['morning', 'afternoon', 'unknown', 'untimed', 'morning_off', 'afternoon_off', 'day_off']);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const estimateStep = 30;

function roundUp(minutes) {
  return Math.ceil(minutes / estimateStep) * estimateStep;
}

function toMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function toClock(minutes) {
  const pad = value => String(value).padStart(2, '0');
  return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
}

function mentionedStartBounds(note) {
  const pattern = /(?:(上午|下午|晚上|傍晚)\s*)?(?:(\d{1,2})[:：]([0-5]\d)|(\d{1,2}|[一二两三四五六七八九十]{1,2})点\s*(半)?)(?:\s*(?:以后|之后|后))/g;
  const spokenHours = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const bounds = [];
  for (const [, part, hours, minutes, spoken, half] of note.matchAll(pattern)) {
    let hour = Number(hours ?? spoken);
    if (Number.isNaN(hour)) hour = spoken === '两' ? 2 : spokenHours.indexOf(spoken);
    if (hour < 0 || hour > 23) continue;
    if (part && part !== '上午' && hour > 0 && hour < 12) hour += 12;
    bounds.push(hour * 60 + (minutes ? Number(minutes) : half ? 30 : 0));
  }
  return new Set(bounds);
}

function keepBoundsOpen(work, note) {
  for (const bound of mentionedStartBounds(note)) {
    const matches = work.filter(item => item.start && toMinutes(item.start) === bound);
    // Restore the original meaning when the model turns an "after" constraint
    // into a start-only entry. Leave explicit ranges and ambiguous matches alone.
    if (matches.length !== 1 || matches[0].end) continue;
    matches[0].start = '';
    matches[0].notBefore = Math.max(matches[0].notBefore, bound);
  }
}

function normalizeItem(item) {
  if (!item || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 500 ||
      !periods.has(item.period) || typeof item.nextDay !== 'boolean') {
    throw new Error('Invalid work item');
  }
  let { start, end, nextDay, period } = item;
  if (start === null) start = '';
  if (end === null) end = '';
  if (typeof start !== 'string' || typeof end !== 'string' ||
      (start && !timePattern.test(start)) || (end && !timePattern.test(end)) ||
      (end && !start) || (nextDay && !end) || (end && !nextDay && end <= start)) {
    throw new Error('Invalid time range');
  }
  if (period.endsWith('_off') || period === 'untimed') {
    start = '';
    end = '';
    nextDay = false;
  } else if (start) {
    period = toMinutes(start) < 720 ? 'morning' : 'afternoon';
  }
  const notBefore = typeof item.notBefore === 'string' && timePattern.test(item.notBefore) ? toMinutes(item.notBefore) : 0;
  if (period === 'unknown' && notBefore >= 720) period = 'afternoon';
  const weight = item.effort === 'short' ? 1 : item.effort === 'long' ? 3 : 2;
  return { content: item.content.trim(), period, start, end, nextDay, notBefore, weight };
}

function occupiedBy(item) {
  if (!item.start) return null;
  const start = toMinutes(item.start);
  // A start-only item leaves its duration unknown. Stop earlier estimates at it.
  const end = item.end ? toMinutes(item.end) + (item.nextDay ? 1440 : 0) : 1440;
  return [start, end];
}

function gapsBetween(start, end, occupied) {
  const gaps = [];
  for (const [from, until] of occupied) {
    if (until <= start || from >= end) continue;
    if (from > start) gaps.push([start, from]);
    start = Math.max(start, until);
  }
  if (end > start) gaps.push([start, end]);
  return gaps;
}

function assignUnknownPeriods(items, off) {
  const work = items.filter(item => item.start || ['morning', 'afternoon', 'unknown'].includes(item.period));
  const unspecified = work.filter(item => item.period === 'unknown');
  if (!unspecified.length) return;
  if (off.size) {
    const available = Object.keys(windows).find(period => !off.has(period)) || 'untimed';
    for (const item of unspecified) item.period = available;
    return;
  }
  const firstAfternoon = work.findIndex(item => item.period === 'afternoon');
  const lastMorning = work.findLastIndex(item => item.period === 'morning');
  let split = Math.max(Math.ceil(work.length / 2), lastMorning + 1);
  if (firstAfternoon >= 0) split = Math.min(split, firstAfternoon);
  work.forEach((item, index) => {
    if (item.period === 'unknown') item.period = index < split ? 'morning' : 'afternoon';
  });
}

function estimateSlot([from, until], group) {
  const end = Math.floor(until / estimateStep) * estimateStep;
  const planned = [];
  let cursor = roundUp(from);
  for (const item of group) {
    cursor = Math.max(cursor, roundUp(item.notBefore));
    if (cursor + estimateStep > end) break;
    planned.push(item);
    cursor += estimateStep;
  }
  cursor = roundUp(from);
  let weightLeft = planned.reduce((total, item) => total + item.weight, 0);
  planned.forEach((item, index) => {
    const start = Math.max(cursor, roundUp(item.notBefore));
    const slotsLeft = (end - start) / estimateStep;
    const reserved = planned.length - index - 1;
    const ideal = Math.round(slotsLeft * item.weight / weightLeft);
    const slots = Math.max(1, Math.min(ideal, slotsLeft - reserved));
    cursor = start + slots * estimateStep;
    weightLeft -= item.weight;
    item.start = toClock(start);
    item.end = toClock(cursor);
  });
  return planned.length > 0;
}

export function scheduleReport(items, note = '') {
  if (!Array.isArray(items) || items.length > 12) throw new Error('Invalid items');
  const work = items.map(normalizeItem);
  keepBoundsOpen(work, note);
  const off = new Set();
  for (const { period } of work) {
    if (period === 'day_off' || period === 'morning_off') off.add('morning');
    if (period === 'day_off' || period === 'afternoon_off') off.add('afternoon');
  }
  assignUnknownPeriods(work, off);
  // Keep any explicitly reported intervals intact. The preview flags explicit conflicts.
  const occupied = work.map(occupiedBy).filter(Boolean).sort(([a], [b]) => a - b);
  let estimated = false;
  for (const [period, [start, end]] of Object.entries(windows)) {
    if (off.has(period)) continue;
    const slots = gapsBetween(start, end, occupied);
    const inPeriod = work.filter(item => item.period === period && !item.start);
    if (!inPeriod.length || !slots.length) continue;
    // Keep estimates between explicit work times. Leave the time blank
    // when even one half-hour block cannot fit.
    const groups = new Map();
    let previousSlotStart = start;
    for (const item of inPeriod) {
      const index = work.indexOf(item);
      const previous = work.slice(0, index).findLast(other => other.start && other.period === period);
      const following = work.slice(index + 1).find(other => other.start && other.period === period);
      const earliest = previous ? occupiedBy(previous)[1] : start;
      const latest = following ? toMinutes(following.start) : end;
      const available = ([from, until]) => Math.floor(until / estimateStep) * estimateStep -
        roundUp(Math.max(from, item.notBefore));
      const slot = slots.filter(([from, until]) => from >= Math.max(earliest, previousSlotStart) && until <= latest)
        .filter(gap => available(gap) >= estimateStep)
        .sort((a, b) => available(b) - available(a))[0];
      if (!slot) continue;
      previousSlotStart = slot[0];
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot).push(item);
    }
    for (const [slot, group] of groups) {
      if (estimateSlot(slot, group)) estimated = true;
    }
  }
  return { estimated, entries: work.map(({ content, start, end, nextDay }) => ({ content, start, end, nextDay })) };
}
