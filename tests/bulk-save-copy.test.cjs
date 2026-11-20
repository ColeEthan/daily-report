const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, C, action, enter } = require('./helpers.cjs');

const date = '2026-09-04';
const morning = { start: '08:00', end: '10:00', nextDay: false, content: '上午维修门禁' };
const afternoon = '13:30—15:00 查看锦园电梯';

function editor(options = {}) {
  const state = C.emptyState('高翔');
  state.reports[date] = { name: '高翔', entries: [C.makeEntry(morning)] };
  return setup({ [C.STORAGE_KEY]: JSON.stringify(state) }, { bulk: true, ...options });
}
async function preview(app, line = afternoon) {
  const ui = app.elements;
  await ui.bulkButton.fire('click');
  ui.source.value = `${date}\n${line}`;
  await ui.source.fire('input');
  await ui.parse.fire('click');
}
test('save and copy includes the full selected day and never adds a second copy', async () => {
  let copied;
  const app = editor({ navigator: { clipboard: { writeText(text) {
    assert.equal(app.saved().reports[date].entries.length, 2);
    copied = text;
  } } } });
  await preview(app);
  const ui = app.elements;
  await ui.saveCopy.fire('click');
  const fullReport = '2026年9月4日\n高翔工作汇报\n8:00-10:00 上午维修门禁。\n13:30-15:00 查看锦园电梯。\n';
  assert.equal(copied, fullReport);
  assert.equal(ui.rows.children.length, 0);
  assert.match(ui.saveResult.textContent, /已复制/);
  assert.match(ui.summary.textContent, /当天已保存 2 条/);
  assert.equal(ui.save.disabled, true);
  app.options.failWrites = true;
  copied = null;
  await ui.saveCopy.fire('click');
  assert.equal(copied, fullReport);
});

test('clipboard denial leaves selectable saved text and allows copy-only retry', async () => {
  let allowed = false, copied;
  const app = editor({ navigator: { clipboard: { async writeText(text) {
    if (!allowed) throw new Error('clipboard disabled');
    copied = text;
  } } } });
  await preview(app);
  const ui = app.elements;
  await ui.saveCopy.fire('click');
  assert.equal(app.saved().reports[date].entries.length, 2);
  assert.match(ui.saveResult.textContent, /已保存。自动复制失败/);
  assert.equal(ui.bulkManualCopy.value, C.buildReport(date, app.saved().reports[date]));
  assert.equal(ui.bulkManualCopy.hidden, false);
  app.options.failWrites = true;
  allowed = true;
  await ui.saveCopy.fire('click');
  assert.equal(copied, ui.bulkManualCopy.value);
  assert.equal(ui.bulkManualCopy.hidden, true);
});

test('an all-duplicate preview copies the stored day without a storage write', async () => {
  let copied;
  const app = editor({ navigator: { clipboard: { writeText(text) { copied = text; } } } });
  await preview(app, '08:00—10:00 上午维修门禁');
  const ui = app.elements;
  assert.equal(ui.save.disabled, true);
  assert.equal(ui.saveCopy.disabled, false);
  app.options.failWrites = true;
  await ui.saveCopy.fire('click');
  assert.equal(copied, C.buildReport(date, app.saved().reports[date]));
  assert.equal(app.saved().reports[date].entries.length, 1);
});

test('save warnings, write failure and a stale preview never copy an unsaved report', async () => {
  let copies = 0;
  const app = editor({ navigator: { clipboard: { writeText() { copies++; } } } });
  await preview(app, '09:00—11:00 查看监控');
  const ui = app.elements;
  assert.equal(ui.saveCopy.disabled, true);
  await ui.saveCopy.fire('click');
  ui.confirm.checked = true;
  await ui.confirm.fire('change');
  assert.equal(ui.saveCopy.disabled, false);
  app.options.failWrites = true;
  await ui.saveCopy.fire('click');
  assert.match(ui.saveResult.textContent, /空间不足/);
  assert.equal(ui.rows.children.length, 1);
  assert.equal(app.saved().reports[date].entries.length, 1);
  app.options.failWrites = false;
  const changed = JSON.stringify(C.emptyState('另一天'));
  app.values.set(C.STORAGE_KEY, changed);
  await ui.saveCopy.fire('click');
  assert.match(ui.saveResult.textContent, /已有变化/);
  assert.equal(app.values.get(C.STORAGE_KEY), changed);
  assert.equal(copies, 0);
});

test('late clipboard denial does not expose the old report on a new preview', async () => {
  let reject;
  const app = editor({ navigator: { clipboard: { writeText() {
    return new Promise((resolve, denied) => { reject = denied; });
  } } } });
  await preview(app);
  const ui = app.elements;
  const pending = ui.saveCopy.fire('click');
  await preview(app, '16:00—17:00 查看商云');
  reject(new Error('denied'));
  await pending;
  assert.equal(ui.bulkManualCopy.hidden, true);
  assert.equal(ui.saveResult.textContent, '');
  assert.equal(ui.rows.children.length, 1);
});

test('a pending supplement restores after saving and the day can still be copied when it is cleared', async () => {
  const session = new Map();
  const first = editor({ session });
  await preview(first);
  await first.elements.save.fire('click');
  first.elements.appendSource.value = '下午补充内容';
  await first.elements.appendSource.fire('input');
  await first.window.fire('pagehide');

  let copied;
  const next = setup({}, { bulk: true, values: first.values, session,
    navigator: { clipboard: { writeText(text) { copied = text; } } } });
  const ui = next.elements;
  await ui.bulkButton.fire('click');
  assert.equal(ui.appendSource.value, '下午补充内容');
  assert.match(ui.summary.textContent, /当天已保存 2 条/);
  assert.equal(ui.saveCopy.disabled, true);
  assert.equal(ui.appendPendingMark.hidden, false);
  ui.appendSource.value = '';
  await ui.appendSource.fire('input');
  assert.equal(ui.saveCopy.disabled, false);
  await ui.saveCopy.fire('click');
  assert.equal(copied, C.buildReport(date, next.saved().reports[date]));
});

test('copying after editing a saved entry includes the correction with its original identity', async () => {
  let copied;
  const app = editor({ navigator: { clipboard: { writeText(text) { copied = text; } } } });
  await preview(app);
  const ui = app.elements;
  ui.name.value = '同事';
  await ui.name.fire('input');
  ui.confirm.checked = true;
  await ui.confirm.fire('change');
  await ui.save.fire('click');
  assert.equal(ui.name.value, '高翔');
  const id = app.saved().reports[date].entries[1].id;
  ui.bulkDialog.close();
  await action(app, 1, '编辑').fire('click');
  await enter(app, '查看锦园2号楼电梯');
  await ui.entryForm.fire('submit');
  await ui.bulkButton.fire('click');
  await ui.saveCopy.fire('click');
  const records = app.saved().reports[date];
  assert.equal(records.entries.length, 2);
  assert.equal(records.entries[1].id, id);
  assert.match(copied, /查看锦园2号楼电梯/);
  assert.equal(copied, C.buildReport(date, records));
});
