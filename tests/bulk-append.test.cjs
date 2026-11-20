const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers.cjs');
const { planAppend } = require('../bulk-core.js');

async function input(field, value) {
  field.value = value;
  await field.fire('input');
}
async function preview(ui) {
  await ui.bulkButton.fire('click');
  await input(ui.source, '2026年9月4日\n高翔工作汇报\n08:00—12:00 查看监控');
  await ui.parse.fire('click');
}
const content = (ui, index) => ui.rows.children[index].children[3].children[0];
const time = (ui, index, end = false) => ui.rows.children[index].children[1].children[Number(end)].children[0];

test('a mixed AI supplement keeps possibly explicit spoken or shorthand clock ranges intact', () => {
  const previous = { content: '已有上午记录', start: '08:00', end: '12:00' };
  const incoming = { content: '查看电梯', start: '09:00', end: '11:00' };
  for (const note of ['９－１１查看电梯，再开会', '九到十一查看电梯，再开会', '早九点到十一点查看电梯，再开会']) {
    const result = planAppend([previous], [incoming], note, true);
    assert.deepEqual(result.added, [incoming]);
    assert.equal(result.cleared, 0);
  }
});

test('supplements preserve edited fields and date, reject other dates, and skip exact duplicates', async () => {
  const app = setup({}, { bulk: true });
  const ui = app.elements;
  await preview(ui);
  await input(content(ui, 0), '查看锦园监控画面');
  await input(time(ui, 0, true), '11:30');
  await input(ui.name, '李师傅');
  await input(ui.appendSource, '2026年9月5日\n13:30—15:00 检查电梯');
  assert.equal(ui.save.disabled, true);
  assert.equal(ui.saveCopy.disabled, true);
  await ui.appendSubmit.fire('click');
  assert.match(ui.appendStatus.textContent, /日期/);
  assert.equal(ui.rows.children.length, 1);
  assert.match(ui.appendSource.value, /9月5日/);
  const extra = '13:30—15:00 检查电梯';
  await input(ui.appendSource, extra);
  await ui.appendSubmit.fire('click');
  assert.equal(ui.appendSource.value, '');
  assert.equal(ui.save.disabled, false);
  await input(ui.appendSource, extra);
  await ui.appendSubmit.fire('click');
  assert.match(ui.appendStatus.textContent, /跳过 1 条/);
  assert.equal(ui.rows.children.length, 2);
  assert.equal(ui.date.value, '2026-09-04');
  assert.equal(ui.name.value, '李师傅');
  assert.equal(time(ui, 0, true).value, '11:30');
  assert.equal(content(ui, 0).value, '查看锦园监控画面');
  await ui.save.fire('click');
  assert.deepEqual(app.saved().reports[ui.date.value].entries.map(e => e.content), ['查看锦园监控画面', '检查电梯']);
});

test('pending supplements survive source edits and reload and require confirmation to move dates', async () => {
  const options = { bulk: true, session: new Map(), values: new Map(), confirm: false };
  const first = setup({}, options);
  await preview(first.elements);
  await input(content(first.elements, 0), '门禁待厂家处理');
  await input(first.elements.appendSource, '下午查看电梯');
  const second = setup({}, options).elements;
  assert.equal(second.appendPanel.open, true);
  assert.equal(second.appendSource.value, '下午查看电梯');
  assert.equal(content(second, 0).value, '门禁待厂家处理');
  assert.equal(second.save.disabled, true);
  await input(second.source, '2026年9月6日\n09:00—10:00 参加会议');
  assert.equal(second.preview.hidden, true);
  const reopened = setup({}, options).elements;
  assert.equal(reopened.appendSource.value, '下午查看电梯');
  await reopened.parse.fire('click');
  assert.equal(reopened.preview.hidden, false);
  assert.equal(reopened.appendPanel.open, true);
  assert.equal(content(reopened, 0).value, '参加会议');
  await reopened.appendSubmit.fire('click');
  assert.equal(reopened.appendSource.value, '下午查看电梯');
  assert.equal(reopened.rows.children.length, 1);
  options.confirm = true;
  await reopened.appendSubmit.fire('click');
  assert.equal(reopened.appendSource.value, '');
  assert.equal(content(reopened, 1).value, '下午查看电梯');
});

test('AI can rebuild a hidden preview while retaining a pending supplement on the same day', async () => {
  const ui = setup({}, { bulk: true, aiFetch: async () => Response.json({ entries: [
    { content: '维修门禁。', start: '08:00', end: '12:00', nextDay: false }
  ] }) }).elements;
  await input(ui.source, '08:00—12:00 维修门禁');
  await ui.parse.fire('click');
  await input(ui.appendSource, '13:30—14:30 检查电梯');
  await input(ui.source, '上午维修门禁');
  ui.aiToken.value = 'test';
  await ui.intake.fire('click');
  assert.equal(ui.preview.hidden, false);
  assert.equal(ui.appendSource.value, '13:30—14:30 检查电梯');
  assert.equal(ui.saveCopy.disabled, true);
  await ui.appendSubmit.fire('click');
  assert.deepEqual([content(ui, 0).value, content(ui, 1).value], ['维修门禁。', '检查电梯']);
});

test('an explicitly named supplement must match both the preview and the saved report', async () => {
  const app = setup({}, { bulk: true, aiFetch: async () => assert.fail('structured input should stay local') });
  const ui = app.elements;
  await preview(ui);
  const extra = '姓名：同事\n13:30—15:00 检查电梯';
  await input(ui.appendSource, extra);
  await ui.appendSubmit.fire('click');
  assert.match(ui.appendStatus.textContent, /同事.*高翔/);
  assert.equal(ui.appendSource.value, extra);
  assert.equal(ui.rows.children.length, 1);
  await input(ui.appendSource, '');
  await ui.save.fire('click');
  await input(ui.name, '同事');
  await input(ui.appendSource, extra);
  await ui.appendSubmit.fire('click');
  assert.match(ui.appendStatus.textContent, /同事.*高翔/);
  assert.equal(ui.appendSource.value, extra);
  assert.equal(ui.rows.children.length, 0);
  assert.equal(app.saved().reports[ui.date.value].entries.length, 1);
});

test('AI receives only the extra note and a conflicting estimated time is left for review', async () => {
  const note = '再去锦园查看电梯';
  const ui = setup({}, { bulk: true, aiFetch: async (_url, req) => {
    assert.deepEqual(JSON.parse(req.body), { note });
    return Response.json({ estimated: true, entries: [
      { start: '08:00', end: '12:00', content: '查看锦园电梯。', nextDay: false }
    ] });
  } }).elements;
  await preview(ui);
  await ui.save.fire('click');
  ui.aiToken.value = 'test';
  await input(ui.appendSource, note);
  await ui.appendSubmit.fire('click');
  assert.equal(ui.rows.children.length, 1);
  assert.equal(content(ui, 0).value, '查看锦园电梯。');
  assert.equal(time(ui, 0).value, '');
  assert.equal(time(ui, 0, true).value, '');
  assert.match(ui.appendStatus.textContent, /估排时间已被占用/);
  assert.equal(ui.aiTimeReview.hidden, false);
  await input(ui.appendSource, '08:00—12:00 福源处理门禁故障');
  await ui.appendSubmit.fire('click');
  assert.equal(time(ui, 1).value, '08:00');
  assert.equal(time(ui, 1, true).value, '12:00');
  assert.equal(ui.warnings.hidden, false);
});

test('AI failure and slow responses after an edit keep the edited preview and allow offline append', async () => {
  let respond;
  const ui = setup({}, { bulk: true, aiFetch: () => new Promise(resolve => { respond = resolve; }) }).elements;
  await preview(ui);
  ui.aiToken.value = 'test';
  await input(ui.appendSource, '下午去锦园看电梯');
  const pending = ui.appendSubmit.fire('click');
  await input(content(ui, 0), '上午的修改');
  respond(Response.json({ entries: [{ content: '过期的结果', start: '', end: '', nextDay: false }] }));
  await pending;
  assert.equal(ui.rows.children.length, 1);
  assert.equal(content(ui, 0).value, '上午的修改');
  assert.match(ui.appendStatus.textContent, /预览已修改/);
  const retry = ui.appendSubmit.fire('click');
  respond(new Response('', { status: 503 }));
  await retry;
  assert.equal(ui.appendSource.value, '下午去锦园看电梯');
  assert.equal(ui.appendLocal.hidden, false);
  await ui.appendLocal.fire('click');
  assert.equal(content(ui, 1).value, '下午去锦园看电梯');
  assert.equal(ui.appendSource.value, '');
});

test('typing a supplement cancels an in-flight regeneration of the original preview', async () => {
  let respond;
  let calls = 0;
  const generated = content => Response.json({ entries: [{ content, start: '', end: '', nextDay: false }] });
  const ui = setup({}, { bulk: true, aiFetch: () => ++calls === 1
    ? Promise.resolve(generated('上午查看监控。'))
    : new Promise(resolve => { respond = resolve; })
  }).elements;
  await ui.bulkButton.fire('click');
  ui.aiToken.value = 'test';
  await input(ui.source, '上午查看监控');
  await ui.intake.fire('click');
  await input(content(ui, 0), '上午查看锦园监控。');
  const pending = ui.intake.fire('click');
  await input(ui.appendSource, '下午查看电梯');
  respond(generated('过期的整份结果'));
  await pending;
  assert.equal(content(ui, 0).value, '上午查看锦园监控。');
  assert.equal(ui.appendSource.value, '下午查看电梯');
  assert.equal(ui.appendSubmit.disabled, false);
  assert.equal(ui.save.disabled, true);
});
