const windows = {
  morning: [480, 720],
  afternoon: [810, 1050]
};
const periods = new Set(['morning', 'afternoon', 'unknown', 'untimed', 'morning_off', 'afternoon_off', 'day_off']);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function toClock(minutes) {
  const pad = value => String(value).padStart(2, '0');
  return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
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
  return { content: item.content.trim(), period, start, end, nextDay };
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

export function scheduleReport(items) {
  if (!Array.isArray(items) || items.length > 12) throw new Error('Invalid items');
  const work = items.map(normalizeItem);
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
    // Give each group a contiguous slot. Leave a row undated if there is
    // no usable slot between the explicitly timed rows that surround it.
    const groups = new Map();
    for (const item of inPeriod) {
      const index = work.indexOf(item);
      const previous = work.slice(0, index).findLast(other => other.start && other.period === period);
      const following = work.slice(index + 1).find(other => other.start && other.period === period);
      const earliest = previous ? occupiedBy(previous)[1] : start;
      const latest = following ? toMinutes(following.start) : end;
      const slot = slots.filter(([from, until]) => from >= earliest && until <= latest)
        .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
      if (!slot) continue;
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot).push(item);
    }
    for (const [[from, until], group] of groups) {
      if (until - from < group.length) continue;
      group.forEach((item, index) => {
        item.start = toClock(from + Math.floor((until - from) * index / group.length));
        item.end = toClock(from + Math.floor((until - from) * (index + 1) / group.length));
      });
      estimated = true;
    }
  }
  return { estimated, entries: work.map(({ content, start, end, nextDay }) => ({ content, start, end, nextDay })) };
}
