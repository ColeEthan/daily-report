const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, enter, add, action, C, fakeLocks } = require('./helpers.cjs');
const date = '2026-09-05';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('two pages cannot both write; a closed writer releases ownership and stale data is reloaded', async () => {
  const locks = fakeLocks(), values = new Map();
  const first = setup({}, { locks, values });
  const second = setup({}, { locks, values });
  assert.equal(first.elements.saveEntryButton.disabled, false);
  assert.equal(second.elements.saveEntryButton.disabled, true);
  assert.match(second.elements.notice.textContent, /只读/);
  await add(first, '第一页面的记录');
  const before = values.get(C.STORAGE_KEY);
  await second.elements.entryForm.fire('submit');
  assert.equal(values.get(C.STORAGE_KEY), before);
  await second.window.fire('storage', { key: C.STORAGE_KEY });
  assert.equal(second.elements.entryCount.textContent, '1 条');
  assert.equal(second.elements.saveEntryButton.disabled, true);
  await first.window.fire('pagehide');
  await flush();
  await second.window.fire('pageshow', { persisted: true });
  assert.equal(second.elements.saveEntryButton.disabled, false);
  await add(second, '第二页面的记录');
  assert.deepEqual(second.saved().reports[date].entries.map(entry => entry.content), ['第一页面的记录', '第二页面的记录']);
});

test('unsupported or rejected locks remain read-only, including corruption recovery', async () => {
  for (const locks of [undefined, { request() { return Promise.reject(new Error('lock denied')); } }]) {
    for (const original of [null, '{corrupt']) {
      const app = setup(original ? { [C.STORAGE_KEY]: original } : {}, { locks });
      await flush();
      assert.equal(app.elements.saveEntryButton.disabled, true);
      assert.equal(app.elements.importFile.disabled, true);
      await app.elements.backupButton.fire('click');
      await app.elements.confirmImportButton.fire('click');
      assert.equal(app.values.get(C.STORAGE_KEY) ?? null, original);
    }
  }
});

test('late lock acquisition after pagehide cannot re-enable writes', async () => {
  let grant;
  const writer = C.createWriter({ request: (_, options, callback) => new Promise(resolve => { grant = () => resolve(callback({})); }) });
  const statuses = [];
  const pending = writer.acquire(status => statuses.push(status));
  writer.release();
  grant();
  await pending;
  assert.equal(writer.active, false);
  assert.deepEqual(statuses, []);
  assert.throws(() => C.save({ getItem: () => null }, C.emptyState(), null, writer), /只读/);
});

async function fullStorage() {
  const app = setup();
  await add(app, '历史工作'.repeat(200));
  const before = app.values.get(C.STORAGE_KEY), limit = before.length + 10;
  app.storage.setItem = (key, value) => {
    if (value.length > limit) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    app.values.set(key, value);
  };
  await enter(app, '本次需要保护的输入');
  assert.match(app.elements.notice.textContent, /保存空间不足/);
  return { app, before };
}

test('quota cleanup commits the smaller final state and keeps the pending draft', async () => {
  for (const mode of ['one', 'all']) {
    const { app } = await fullStorage();
    await app.elements.historyButton.fire('click');
    assert.equal(app.elements.historyDialog.open, true);
    app.elements.historyDialog.close();
    if (mode === 'one') await action(app, 0, '删除').fire('click');
    else await app.elements.clearButton.fire('click');
    assert.equal(app.saved().reports[date].entries.length, 0);
    assert.equal(app.saved().drafts[date].content, '本次需要保护的输入');
    assert.equal(app.elements.workContent.value, '本次需要保护的输入');
  }
});

test('quota cleanup that still cannot fit preserves original records and current input', async () => {
  const { app, before } = await fullStorage();
  app.options.failWrites = true;
  app.storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  await action(app, 0, '删除').fire('click');
  assert.equal(app.values.get(C.STORAGE_KEY), before);
  assert.equal(app.elements.workContent.value, '本次需要保护的输入');
});

test('historical deletion frees space while preserving another date’s pending draft', async () => {
  const app = setup();
  app.elements.reportDate.value = '2026-09-04';
  await app.elements.reportDate.fire('change');
  await add(app, '旧工作'.repeat(300));
  await app.elements.todayButton.fire('click');
  const limit = app.values.get(C.STORAGE_KEY).length + 10;
  app.storage.setItem = (key, value) => {
    if (value.length > limit) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    app.values.set(key, value);
  };
  await enter(app, '今天的新输入');
  await app.elements.historyButton.fire('click');
  const row = app.elements.historyList.children.find(row => row.children[0]?.textContent.startsWith('2026-09-04'));
  await row.children[1].children.find(button => button.textContent === '删除').fire('click');
  assert.equal(app.saved().reports['2026-09-04'], undefined);
  assert.equal(app.saved().drafts[date].content, '今天的新输入');
  assert.equal(app.elements.workContent.value, '今天的新输入');
});

test('deleting an entry while editing keeps the latest unsaved edit as a new draft', async () => {
  const app = setup();
  await add(app, '原记录');
  await action(app, 0, '编辑').fire('click');
  app.options.failWrites = true;
  await enter(app, '未保存的修改');
  app.options.failWrites = false;
  await action(app, 0, '删除').fire('click');
  assert.equal(app.saved().reports[date].entries.length, 0);
  assert.equal(app.saved().drafts[date].entryId, null);
  assert.equal(app.saved().drafts[date].content, '未保存的修改');
});

test('invalid committed ranges are rejected by import before preview or storage changes', async () => {
  for (const range of [
    { start: '18:00', end: '08:00', nextDay: false },
    { start: '08:00', end: '08:00', nextDay: false },
    { start: '', end: '09:00', nextDay: false },
    { start: '', end: '', nextDay: true }
  ]) {
    const incoming = C.emptyState();
    incoming.reports[date] = { name: '', entries: [{ id: 'invalid', content: '备份记录', legacyTime: '', ...range }] };
    const app = setup();
    await add(app, '本机记录');
    await app.elements.backupButton.fire('click');
    const before = app.values.get(C.STORAGE_KEY);
    const backup = JSON.stringify(incoming);
    app.elements.importFile.files = [{ size: Buffer.byteLength(backup), text: async () => backup }];
    await app.elements.importFile.fire('change');
    assert.equal(app.elements.importPreview.hidden, true);
    assert.match(app.elements.backupError.textContent, /时间不正确/);
    await app.elements.confirmImportButton.fire('click');
    assert.equal(app.values.get(C.STORAGE_KEY), before);
  }
});

test('preexisting invalid ranges remain readable, exportable and explicitly repairable', async () => {
  const state = C.emptyState();
  state.reports[date] = { name: '', entries: [{ id: 'old', content: '原有内容', start: '', end: '09:00', nextDay: true, legacyTime: '' }] };
  const original = JSON.stringify(state);
  const app = setup({ [C.STORAGE_KEY]: original });
  assert.equal(app.values.get(C.STORAGE_KEY), original);
  assert.equal(app.elements.saveEntryButton.disabled, false);
  assert.match(app.elements.notice.textContent, /需要核对/);
  const loaded = C.load(app.storage);
  assert.match(loaded.state.reports[date].entries[0].legacyTime, /开始 未填，结束 次日 09:00/);
  assert.doesNotThrow(() => C.parseBackup(C.exportBackup(loaded.state)));
  await action(app, 0, '编辑').fire('click');
  app.elements.timeStart.value = '08:00';
  await app.elements.timeStart.fire('input');
  await app.elements.duration60.fire('click');
  await app.elements.entryForm.fire('submit');
  const repaired = app.saved().reports[date].entries[0];
  assert.equal(repaired.id, 'old');
  assert.equal(repaired.content, '原有内容');
  assert.equal(repaired.end, '09:00');
  assert.equal(repaired.legacyTime, '');
});

test('incomplete drafts and legitimate overnight records still round-trip', () => {
  const state = C.emptyState();
  state.reports[date] = { name: '', entries: [C.makeEntry({ start: '18:00', end: '08:00', nextDay: true, content: '夜间工作' })] };
  state.drafts[date] = { entryId: null, start: '', end: '09:00', nextDay: true, content: '尚未填完', legacyTime: '' };
  assert.deepEqual(C.parseBackup(C.exportBackup(state)), state);
});
