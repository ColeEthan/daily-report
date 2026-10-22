const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, enter, add, action, C } = require('./helpers.cjs');
const date = '2026-09-05';

async function choose(app, value) {
  app.elements.reportDate.value = value;
  await app.elements.reportDate.fire('change');
}

test('browsing a historical date no longer writes its name back to the global preference', async () => {
  const app = setup();
  await add(app, '9月5日未填姓名');
  await choose(app, '2026-09-04');
  app.elements.userName.value = '张三';
  await app.elements.userName.fire('input');
  await add(app, '9月4日张三');
  assert.equal(app.saved().preferredName, '张三');

  await choose(app, date);
  assert.equal(app.elements.userName.value, '');
  await choose(app, '2026-09-03');
  assert.equal(app.saved().preferredName, '张三');
  assert.equal(app.elements.userName.value, '张三');
  assert.equal(app.saved().reports['2026-09-03'], undefined);
  assert.equal(app.saved().reports[date].name, '');
});

test('viewing a date with a different name does not change the global preference', async () => {
  const app = setup();
  app.elements.userName.value = '张三';
  await app.elements.userName.fire('input');
  await add(app, '9月5日');
  await choose(app, '2026-09-04');
  app.elements.userName.value = '李四';
  await app.elements.userName.fire('input');
  await add(app, '9月4日');
  assert.equal(app.saved().preferredName, '李四');

  await choose(app, date);
  assert.equal(app.elements.userName.value, '张三');
  await choose(app, '2026-09-03');
  assert.equal(app.saved().preferredName, '李四');
  assert.equal(app.elements.userName.value, '李四');
});

test('a name-only edit on a fresh date creates no empty report', async () => {
  const app = setup();
  app.elements.userName.value = '张三';
  await app.elements.userName.fire('input');
  assert.equal(app.saved().preferredName, '张三');
  await choose(app, '2026-09-04');
  await choose(app, date);
  assert.equal(app.saved().reports['2026-09-04'], undefined);
  assert.equal(app.saved().reports[date], undefined);
  assert.equal(app.saved().preferredName, '张三');
});

test('clearing the default start is labeled and survives reload as a cleared state', async () => {
  const app = setup();
  await app.elements.clearTimeButton.fire('click');
  await app.elements.historyButton.fire('click');
  assert.deepEqual(
    app.elements.historyList.children.map(row => row.children[0].textContent),
    [`${date}（0 条，已清空开始时间）`]
  );
  const restored = setup(Object.fromEntries(app.values));
  assert.equal(restored.elements.timeStart.value, '');
  assert.equal(restored.elements.saveStatus.textContent, '开始时间已清空');
});

test('an empty local draft no longer blocks a real backup draft for the same date', async () => {
  const app = setup();
  await app.elements.clearTimeButton.fire('click');
  const incoming = C.emptyState();
  incoming.drafts[date] = { entryId: null, start: '09:00', end: '10:00', nextDay: false, content: '备份草稿', legacyTime: '' };
  const backup = JSON.stringify({ format: 'daily-report-backup', version: 2, data: incoming });
  await app.elements.backupButton.fire('click');
  app.elements.importFile.files = [{ size: Buffer.byteLength(backup), text: async () => backup }];
  await app.elements.importFile.fire('change');
  assert.equal(app.elements.importPreview.hidden, false);
  assert.doesNotMatch(app.elements.importSummary.textContent, /草稿有冲突/);
  await app.elements.confirmImportButton.fire('click');
  assert.equal(app.saved().drafts[date].content, '备份草稿');
});

test('editing confirms a user time draft but silently replaces an automatic continuation', async () => {
  let app = setup({}, { confirm: false });
  await add(app, '已有记录');
  app.elements.timeStart.value = '10:00';
  await app.elements.timeStart.fire('input');
  app.elements.timeEnd.value = '11:00';
  await app.elements.timeEnd.fire('input');
  await action(app, 0, '编辑').fire('click');
  assert.equal(app.saved().drafts[date].start, '10:00');
  assert.equal(app.saved().drafts[date].entryId, null);

  app = setup({}, { confirm: false });
  app.elements.timeStart.value = '09:00';
  await app.elements.duration60.fire('click');
  await add(app, '第一项');
  assert.equal(app.saved().drafts[date].continuation, true);
  await action(app, 0, '编辑').fire('click');
  assert.ok(app.saved().drafts[date].entryId);
});

test('generating a report warns about a user time draft but not a continuation', async () => {
  let app = setup({}, { confirm: false });
  await add(app, '已有记录');
  app.elements.timeStart.value = '10:00';
  await app.elements.timeStart.fire('input');
  app.elements.timeEnd.value = '11:00';
  await app.elements.timeEnd.fire('input');
  await app.elements.generateButton.fire('click');
  assert.equal(app.elements.previewDialog.open, false);

  app = setup({}, { confirm: false });
  app.elements.timeStart.value = '09:00';
  await app.elements.duration60.fire('click');
  await add(app, '第一项');
  await app.elements.generateButton.fire('click');
  assert.equal(app.elements.previewDialog.open, true);
});

test('midnight moves an empty form to the new day and warns when input exists', async () => {
  let app = setup();
  app.tick('2026-09-06T00:01:00');
  await app.window.fire('focus');
  assert.equal(app.elements.reportDate.value, '2026-09-06');
  assert.equal(app.elements.timeStart.value, '08:00');
  await add(app, '午夜工作');
  assert.equal(app.saved().reports['2026-09-06'].entries[0].start, '08:00');
  assert.equal(app.saved().reports[date], undefined);

  app = setup();
  await enter(app, '未提交草稿');
  app.tick('2026-09-06T00:01:00');
  await app.window.fire('focus');
  assert.equal(app.elements.reportDate.value, date);
  assert.match(app.elements.notice.textContent, /日期已变为2026年9月6日/);
  assert.equal(app.elements.workContent.value, '未提交草稿');
  await app.elements.todayButton.fire('click');
  assert.equal(app.elements.reportDate.value, '2026-09-06');
  assert.equal(app.elements.notice.hidden, true);
  assert.equal(app.saved().drafts[date].content, '未提交草稿');
});

test('empty drafts are distinguishable and do not block backup drafts', () => {
  const empty = { entryId: null, start: '', end: '', nextDay: false, content: '', legacyTime: '' };
  const real = { entryId: null, start: '09:00', end: '10:00', nextDay: false, content: '备份草稿', legacyTime: '' };
  assert.equal(C.isEmptyDraft(empty), true);
  assert.equal(C.isEmptyDraft({ ...empty, content: '  ' }), true);
  assert.equal(C.isEmptyDraft({ ...empty, start: '08:00' }), false);
  assert.equal(C.isEmptyDraft(real), false);

  const local = C.emptyState('张工');
  local.reports[date] = { name: '张工', entries: [] };
  local.drafts[date] = empty;
  const incoming = C.emptyState();
  incoming.drafts[date] = real;
  const merged = C.mergeBackup(local, incoming);
  assert.equal(merged.stats.draftConflicts, 0);
  assert.equal(merged.stats.drafts, 1);
  assert.equal(merged.state.drafts[date].content, '备份草稿');

  const emptyIncoming = C.mergeBackup(local, C.emptyState());
  assert.equal(emptyIncoming.stats.draftConflicts, 0);
  assert.equal(emptyIncoming.state.drafts[date].content, '');

  const realLocal = C.emptyState();
  realLocal.drafts[date] = real;
  const realVsEmpty = C.mergeBackup(realLocal, C.emptyState());
  assert.equal(realVsEmpty.stats.draftConflicts, 0);
  assert.equal(realVsEmpty.state.drafts[date].content, '备份草稿');
});

test('an automatic continuation marker survives backup round-trips', () => {
  const state = C.emptyState();
  state.drafts[date] = { entryId: null, start: '09:30', end: '', nextDay: false, content: '', legacyTime: '', continuation: true };
  const parsed = C.parseBackup(C.exportBackup(state));
  assert.equal(parsed.drafts[date].continuation, true);
  assert.deepEqual(parsed, state);
});
