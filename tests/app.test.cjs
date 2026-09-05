// DOM stubs verify state-changing application flows without browser automation.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../core.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function setup(initial = {}, options = {}) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false; this.open = false; this.style = {}; this.events = {}; this.children = []; this.files = []; this.scrollHeight = 100; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    async fire(name, event = {}) { for (const fn of this.events[name] || []) await fn({ preventDefault() {}, target: this, ...event }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    focus() {}
    select() {}
    setSelectionRange() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    click() {}
    remove() {}
  }
  const elements = {}, values = new Map(Object.entries(initial)), document = new Element(), window = new Element();
  document.getElementById = id => elements[id] ||= new Element();
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) document.getElementById(match[1]);
  document.createElement = () => new Element();
  document.createTextNode = text => ({ textContent: text });
  document.querySelectorAll = () => [];
  document.execCommand = () => options.fallback === true;
  document.body = new Element();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
    if (options.failWrites) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    values.set(key, value);
  } };
  let now = new Date('2026-09-05T12:00:00');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now.getTime(); } }
  const core = { ...C, today: () => C.today(now) };
  const context = { DailyReport: core, document, window, localStorage: storage, navigator: options.navigator || {}, Date: Clock, Blob, URL: { createObjectURL: () => 'blob:backup', revokeObjectURL() {} }, confirm: () => options.confirm !== false, setTimeout() {}, setInterval() {} };
  vm.runInNewContext(source, context);
  return { elements, values, document, window, storage, options, tick: value => { now = new Date(value); }, saved: () => JSON.parse(values.get(C.STORAGE_KEY)) };
}
async function enter(app, text = '摄像头调试') {
  app.elements.workContent.value = text;
  await app.elements.workContent.fire('input');
}
async function add(app, text) { await enter(app, text); await app.elements.entryForm.fire('submit'); }
function action(app, index, label) {
  return app.elements.entryList.children[index].children[2].children.find(node => node.textContent === label);
}
test('duration shortcuts calculate from start without accumulating and persist the draft', async () => {
  const app = setup();
  await app.elements.duration30.fire('click');
  assert.equal(app.elements.timeEnd.value, '');
  assert.match(app.elements.timeFeedback.textContent, /请先填写开始时间/);
  app.elements.timeStart.value = '10:00';
  await enter(app, '调试');
  for (const [minutes, expected] of [[15, '10:15'], [30, '10:30'], [60, '11:00'], [120, '12:00'], [30, '10:30']]) {
    await app.elements[`duration${minutes}`].fire('click');
    assert.equal(app.elements.timeEnd.value, expected);
    assert.equal(app.saved().drafts['2026-09-05'].end, expected);
  }
  const restored = setup(Object.fromEntries(app.values));
  assert.equal(restored.elements.timeStart.value, '10:00');
  assert.equal(restored.elements.timeEnd.value, '10:30');
  assert.equal(restored.elements.workContent.value, '调试');
});
test('shortcuts mark overnight ranges and do not carry a next-day end into the same report date', async () => {
  const app = setup();
  app.elements.timeStart.value = '23:45';
  await app.elements.duration15.fire('click');
  assert.equal(app.elements.timeEnd.value, '00:00');
  assert.equal(app.elements.nextDay.checked, true);
  await add(app, '夜间维护');
  assert.equal(app.saved().reports['2026-09-05'].entries[0].nextDay, true);
  assert.equal(app.elements.timeStart.value, '');
  app.elements.timeStart.value = '10:00';
  app.elements.nextDay.checked = true;
  await app.elements.duration60.fire('click');
  assert.equal(app.elements.nextDay.checked, false);
});
test('the extra +30 option accumulates across reloads while fixed duration options still reset', async () => {
  const app = setup();
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '');
  app.elements.timeStart.value = '10:00';
  await app.elements.duration30.fire('click');
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '11:00');
  assert.match(app.elements.timeFeedback.textContent, /累计1小时/);
  const restored = setup(Object.fromEntries(app.values));
  await restored.elements.durationAdd30.fire('click');
  assert.equal(restored.elements.timeEnd.value, '11:30');
  await restored.elements.duration30.fire('click');
  assert.equal(restored.elements.timeEnd.value, '10:30');
  restored.elements.timeEnd.value = '';
  await restored.elements.durationAdd30.fire('click');
  assert.equal(restored.elements.timeEnd.value, '10:30');
});
test('+30 preserves overnight meaning and refuses invalid or unrepresentable end times', async () => {
  const app = setup();
  app.elements.timeStart.value = '23:15';
  await app.elements.duration30.fire('click');
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '00:15');
  assert.equal(app.elements.nextDay.checked, true);
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '00:45');
  assert.equal(app.elements.nextDay.checked, true);
  assert.match(app.elements.timeFeedback.textContent, /累计1小时30分钟/);
  app.elements.timeEnd.value = '23:45';
  const before = app.values.get(C.STORAGE_KEY);
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '23:45');
  assert.equal(app.values.get(C.STORAGE_KEY), before);
  assert.match(app.elements.timeFeedback.textContent, /超过次日/);
  app.elements.timeEnd.value = '09:00';
  app.elements.nextDay.checked = false;
  await app.elements.durationAdd30.fire('click');
  assert.equal(app.elements.timeEnd.value, '09:00');
  assert.match(app.elements.timeFeedback.textContent, /结束时间应晚于开始时间/);
});
test('next entry continues from the saved end; clearing time preserves content and allows untimed work', async () => {
  const app = setup({}, { confirm: false });
  app.elements.timeStart.value = '09:00';
  await app.elements.duration60.fire('click');
  await add(app, '第一项');
  assert.equal(app.elements.timeStart.value, '10:00');
  assert.equal(app.elements.timeEnd.value, '');
  assert.equal(app.elements.workContent.value, '');
  // A time-only continuation must not block report generation with a draft prompt.
  await app.elements.generateButton.fire('click');
  assert.equal(app.elements.previewDialog.open, true);
  await enter(app, '不计时工作');
  await app.elements.clearTimeButton.fire('click');
  assert.equal(app.elements.workContent.value, '不计时工作');
  const restored = setup(Object.fromEntries(app.values));
  assert.equal(restored.elements.timeStart.value, '');
  await restored.elements.entryForm.fire('submit');
  assert.equal(restored.saved().reports['2026-09-05'].entries[1].start, '');
});
test('now uses the local clock, protects historical dates, and refuses reversed ranges', async () => {
  const app = setup();
  app.tick('2026-09-05T08:37:55');
  await app.elements.startNowButton.fire('click');
  assert.equal(app.elements.timeStart.value, '08:37');
  app.tick('2026-09-05T09:08:25');
  await app.elements.endNowButton.fire('click');
  assert.equal(app.elements.timeEnd.value, '09:08');
  app.elements.timeStart.value = '18:00';
  await app.elements.endNowButton.fire('click');
  assert.equal(app.elements.timeEnd.value, '09:08');
  assert.match(app.elements.timeFeedback.textContent, /不晚于开始时间/);
  app.elements.reportDate.value = '2026-09-04';
  await app.elements.reportDate.fire('change');
  assert.equal(app.elements.startNowButton.disabled, true);
  await app.elements.startNowButton.fire('click');
  assert.equal(app.elements.timeStart.value, '');
});
test('editing an existing timed record never creates a continuation or overwrites its draft', async () => {
  const app = setup();
  app.elements.timeStart.value = '08:00';
  await app.elements.duration60.fire('click');
  await add(app, '已有记录');
  await action(app, 0, '编辑').fire('click');
  assert.equal(app.elements.timeStart.value, '08:00');
  await app.elements.duration120.fire('click');
  const restored = setup(Object.fromEntries(app.values));
  assert.equal(restored.elements.timeStart.value, '08:00');
  assert.equal(restored.elements.timeEnd.value, '10:00');
  await restored.elements.entryForm.fire('submit');
  assert.equal(restored.saved().reports['2026-09-05'].entries.length, 1);
  assert.equal(restored.saved().reports['2026-09-05'].entries[0].end, '10:00');
  assert.equal(restored.elements.timeStart.value, '');
});
test('unfinished input survives reload and Chinese Enter cannot submit', async () => {
  const app = setup();
  await enter(app, '正在输入中文');
  await app.elements.workContent.fire('keydown', { key: 'Enter', isComposing: true, ctrlKey: true });
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 0);
  await app.elements.workContent.fire('keydown', { key: 'Enter' });
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 0);
  const reload = setup(Object.fromEntries(app.values));
  assert.equal(reload.elements.workContent.value, '正在输入中文');
  await reload.elements.workContent.fire('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(reload.saved().reports['2026-09-05'].entries.length, 1);
});
test('edit updates one record, cancellation preserves original, and drafts switch by date', async () => {
  const app = setup();
  await add(app, '原内容');
  await action(app, 0, '编辑').fire('click');
  await enter(app, '新内容');
  await app.elements.entryForm.fire('submit');
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 1);
  assert.equal(app.saved().reports['2026-09-05'].entries[0].content, '新内容');
  await action(app, 0, '编辑').fire('click');
  await enter(app, '取消的修改');
  await app.elements.cancelEditButton.fire('click');
  assert.equal(app.saved().reports['2026-09-05'].entries[0].content, '新内容');
  await enter(app, '今天的草稿');
  app.elements.reportDate.value = '2026-09-04';
  await app.elements.reportDate.fire('change');
  assert.equal(app.elements.workContent.value, '');
  await add(app, '补录昨日');
  assert.equal(app.saved().reports['2026-09-04'].entries[0].content, '补录昨日');
  await app.elements.todayButton.fire('click');
  assert.equal(app.elements.workContent.value, '今天的草稿');
});
test('midnight does not retarget deletion to the next day', async () => {
  const app = setup();
  await add(app, '昨天的记录');
  app.tick('2026-09-06T00:01:00');
  await app.window.fire('focus');
  assert.match(app.elements.todayDate.textContent, /9月6日/);
  assert.equal(app.elements.reportDate.value, '2026-09-05');
  await action(app, 0, '删除').fire('click');
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 0);
  assert.equal(app.saved().reports['2026-09-06'], undefined);
});
test('quota failure preserves typed text and previous stored report', async () => {
  const app = setup();
  await add(app, '已保存');
  const before = app.values.get(C.STORAGE_KEY);
  app.options.failWrites = true;
  await enter(app, '保存失败的输入');
  await app.elements.entryForm.fire('submit');
  assert.equal(app.elements.workContent.value, '保存失败的输入');
  assert.equal(app.values.get(C.STORAGE_KEY), before);
  assert.match(app.elements.notice.textContent, /保存空间不足/);
});
test('unavailable and rejected clipboard APIs offer manual copying instead of false success', async () => {
  for (const navigator of [{}, { clipboard: { writeText: async () => { throw new Error('denied'); } } }]) {
    const app = setup({}, { navigator });
    app.elements.previewText.textContent = '汇报正文';
    await app.elements.copyButton.fire('click');
    assert.equal(app.elements.manualCopy.hidden, false);
    assert.equal(app.elements.manualCopy.value, '汇报正文');
    assert.match(app.elements.copyHint.textContent, /自动复制失败/);
  }
  const success = setup({}, { navigator: { clipboard: { writeText: async () => {} } } });
  await success.elements.copyButton.fire('click');
  assert.match(success.elements.copyHint.textContent, /已复制/);
});
test('corrupt storage disables writes and preserves the original bytes', async () => {
  const app = setup({ [C.STORAGE_KEY]: '{corrupt' });
  assert.equal(app.elements.saveEntryButton.disabled, true);
  assert.equal(app.values.get(C.STORAGE_KEY), '{corrupt');
  assert.match(app.elements.notice.textContent, /停止写入/);
});
test('backup import previews before saving and rejects stale confirmation after another tab writes', async () => {
  const app = setup();
  await add(app, '本机记录');
  const incoming = C.emptyState();
  incoming.reports['2026-09-04'] = { name: '', entries: [C.makeEntry({ content: '备份记录', start: '', end: '', nextDay: false }, 'imported')] };
  await app.elements.backupButton.fire('click');
  const before = app.values.get(C.STORAGE_KEY);
  app.elements.importFile.files = [{ size: 100, text: async () => C.exportBackup(incoming) }];
  await app.elements.importFile.fire('change');
  assert.equal(app.values.get(C.STORAGE_KEY), before);
  assert.equal(app.elements.importPreview.hidden, false);
  app.values.set(C.STORAGE_KEY, 'another-tab');
  await app.elements.confirmImportButton.fire('click');
  assert.equal(app.values.get(C.STORAGE_KEY), 'another-tab');
  assert.match(app.elements.backupError.textContent, /数据已有变化/);
});
test('confirmed import merges records and valid backup can recover corrupt data with original retained', async () => {
  const incoming = C.emptyState();
  incoming.reports['2026-09-04'] = { name: '张工', entries: [C.makeEntry({ content: '备份记录', start: '', end: '', nextDay: false }, 'imported')] };
  for (const corrupt of [false, true]) {
    const app = setup(corrupt ? { [C.STORAGE_KEY]: '{corrupt' } : {});
    if (!corrupt) await add(app, '本机记录');
    await app.elements.backupButton.fire('click');
    app.elements.importFile.files = [{ size: 100, text: async () => C.exportBackup(incoming) }];
    await app.elements.importFile.fire('change');
    await app.elements.confirmImportButton.fire('click');
    assert.equal(app.saved().reports['2026-09-04'].entries[0].content, '备份记录');
    if (!corrupt) assert.equal(app.saved().reports['2026-09-05'].entries[0].content, '本机记录');
    else {
      assert.ok([...app.values].some(([key, value]) => key.startsWith('daily_report_recovery_') && value.includes('{corrupt')));
      assert.equal(app.elements.saveEntryButton.disabled, false);
    }
  }
});
