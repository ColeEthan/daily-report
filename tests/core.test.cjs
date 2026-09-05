const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const date = '2026-09-05';
const entry = (id = 'one', content = '调试摄像头') => ({ id, start: '08:00', end: '09:30', nextDay: false, content, legacyTime: '' });
function sample() {
  const state = C.emptyState('张工');
  state.reports[date] = { name: '张工', entries: [entry()] };
  return state;
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
test('legacy migration preserves content, name and unusual time strings without modifying old keys', () => {
  const legacy = JSON.stringify({ [date]: [{ time: '8:00-9:30', content: '布线\n测试' }, { time: '18:00-8:00', content: '旧跨夜记录' }] });
  const db = storage({ daily_report: legacy, daily_report_name: '张工' });
  const loaded = C.load(db);
  assert.equal(loaded.state.reports[date].entries[0].content, '布线\n测试');
  assert.equal(C.entryTime(loaded.state.reports[date].entries[1]), '18:00-8:00');
  C.save(db, loaded.state, loaded.raw);
  assert.equal(db.getItem('daily_report'), legacy);
  assert.equal(C.load(db).state.reports[date].name, '张工');
});
test('corrupted data does not silently fall back to empty or legacy records', () => {
  for (const bad of ['{broken', 'null', '{"version":99}', '{"version":2,"preferredName":"","reports":{},"drafts":null}']) {
    const db = storage({ [C.STORAGE_KEY]: bad, daily_report: '{}' });
    assert.throws(() => C.load(db));
    assert.equal(db.getItem(C.STORAGE_KEY), bad);
  }
});
test('storage quota and concurrent changes never overwrite the last saved records', () => {
  const db = storage();
  const raw = C.save(db, sample(), null);
  db.setItem(C.STORAGE_KEY, 'other tab');
  assert.throws(() => C.save(db, C.emptyState(), raw), /另一个页面/);
  assert.equal(db.getItem(C.STORAGE_KEY), 'other tab');
  db.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  assert.throws(() => C.save(db, sample(), 'other tab'), { name: 'QuotaExceededError' });
});
test('time validation distinguishes omitted, incomplete, reversed and explicit overnight ranges', () => {
  assert.doesNotThrow(() => C.validateRange('', '', false));
  assert.doesNotThrow(() => C.validateRange('08:00', '', false));
  assert.throws(() => C.validateRange('', '09:00', false), /开始/);
  assert.throws(() => C.validateRange('18:00', '08:00', false), /次日/);
  assert.throws(() => C.validateRange('08:00', '08:00', false));
  assert.throws(() => C.validateRange('', '', true));
  assert.doesNotThrow(() => C.validateRange('18:00', '08:00', true));
  assert.equal(C.entryTime({ start: '18:00', end: '08:00', nextDay: true }), '18:00-次日8:00');
});
test('empty name gives a single title and historical report retains its own name', () => {
  assert.match(C.buildReport(date, { name: '', entries: [entry()] }), /^2026年9月5日\n工作汇报\n/);
  const state = sample();
  state.preferredName = '李工';
  assert.match(C.buildReport(date, state.reports[date]), /张工工作汇报/);
  assert.doesNotMatch(C.buildReport(date, { name: '', entries: [entry('a', '完成！')] }), /！。/);
});
test('backup round-trip preserves multiple dates, entries and unfinished edit drafts', () => {
  const state = sample();
  state.reports['2026-09-04'] = { name: '', entries: [entry('two', '<script>literal text</script>')] };
  state.drafts[date] = { entryId: 'one', start: '', end: '09:00', nextDay: true, content: '尚未填完', legacyTime: '' };
  assert.deepEqual(C.parseBackup(C.exportBackup(state)), state);
});
test('invalid dates and schema are rejected before any import', () => {
  for (const date of ['2026-02-30', '2026-13-01', '__proto__', '<img>']) {
    assert.equal(C.validDate(date), false);
    assert.throws(() => C.parseBackup(JSON.stringify({ [date]: [] })));
  }
  assert.equal(C.validDate('2024-02-29'), true);
  assert.throws(() => C.parseBackup('{"format":"daily-report-backup","version":3,"data":{}}'));
  assert.throws(() => C.parseBackup('{}'));
  assert.throws(() => C.parseBackup('not json'));
});
test('restoring a backup twice is idempotent and preserves legitimate duplicate entries', () => {
  const original = sample();
  original.reports[date].entries.push(entry('two'));
  const first = C.mergeBackup(C.emptyState(), original);
  assert.equal(first.stats.added, 2);
  assert.equal(first.state.reports[date].entries.length, 2);
  const second = C.mergeBackup(first.state, original);
  assert.equal(second.stats.added, 0);
  assert.equal(second.stats.skipped, 2);
});
test('edited versions sharing an ID survive a merge and repeated imports do not create extra copies', () => {
  const local = sample();
  const incoming = sample();
  incoming.reports[date].entries[0].content = '备份中的修改';
  const first = C.mergeBackup(local, incoming);
  assert.equal(first.stats.conflicts, 1);
  assert.equal(first.state.reports[date].entries.length, 2);
  assert.equal(local.reports[date].entries.length, 1);
  const second = C.mergeBackup(first.state, incoming);
  assert.equal(second.stats.added, 0);
  assert.equal(second.state.reports[date].entries.length, 2);
});
test('conflicting drafts and report names preserve local values and surface conflict counts', () => {
  const local = sample(), incoming = sample();
  const draft = { entryId: null, start: '', end: '', nextDay: false, content: '本机草稿', legacyTime: '' };
  local.drafts[date] = draft;
  incoming.drafts[date] = { ...draft, content: '备份草稿' };
  incoming.reports[date].name = '李工';
  const result = C.mergeBackup(local, incoming);
  assert.equal(result.stats.draftConflicts, 1);
  assert.equal(result.stats.nameConflicts, 1);
  assert.equal(result.state.drafts[date].content, '本机草稿');
  assert.equal(result.state.reports[date].name, '张工');
});
