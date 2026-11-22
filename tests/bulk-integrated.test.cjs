const test = require('node:test'), assert = require('node:assert/strict');
const {setup,enter,C,fakeLocks} = require('./helpers.cjs');
async function preview(a) {
  await a.elements.bulkButton.fire('click');
  a.elements.source.value='日期：2026-09-05\n08:00—10:00\n批量维修\n10:00—12:00\n批量巡查';
  await a.elements.source.fire('input'); await a.elements.parse.fire('click');
}
test('embedded bulk shares one writer, preserves the main draft and allows subsequent manual entry',async()=>{
  const locks=fakeLocks(); let requests=0;
  const a=setup({}, {bulk:true,locks:{request(...args){requests++;return locks.request(...args);}}});
  await enter(a,'手动填写中的草稿');
  await preview(a); assert.equal(a.elements.bulkDialog.open,true); assert.equal(requests,1);
  assert.equal(a.elements.save.disabled,false); await a.elements.save.fire('click');
  assert.equal(a.saved().reports['2026-09-05'].entries.length,2);
  assert.equal(a.saved().drafts['2026-09-05'].content,'手动填写中的草稿');
  assert.equal(a.elements.workContent.value,'手动填写中的草稿');
  await a.elements.entryForm.fire('submit');
  assert.equal(a.saved().reports['2026-09-05'].entries.length,3);
  assert.equal(a.saved().reports['2026-09-05'].entries[2].content,'手动填写中的草稿');
  await preview(a); assert.equal(a.elements.save.disabled,true); assert.match(a.elements.summary.textContent,/跳过重复 2 条/);
});
test('embedded bulk failure and stale state never erase existing records or the draft',async()=>{
  const a=setup({}, {bulk:true}); await enter(a,'原草稿'); await preview(a);
  const before=a.values.get(C.STORAGE_KEY); a.options.failWrites=true;
  await a.elements.save.fire('click'); assert.equal(a.values.get(C.STORAGE_KEY),before); assert.match(a.elements.saveResult.textContent,/空间不足/);
  a.options.failWrites=false; await a.elements.save.fire('click'); assert.equal(a.saved().reports['2026-09-05'].entries.length,2);
  await preview(a); a.elements.source.value='日期：2026-09-05\n13:30—17:30\n另一条'; await a.elements.source.fire('input'); await a.elements.parse.fire('click');
  const changed=JSON.stringify(C.emptyState('外部变化')); a.values.set(C.STORAGE_KEY,changed);
  await a.elements.save.fire('click'); assert.equal(a.values.get(C.STORAGE_KEY),changed); assert.match(a.elements.saveResult.textContent,/已有变化/);
});
test('embedded bulk remains read only without locks or with corrupt storage',async()=>{
  for(const a of [setup({}, {bulk:true,locks:undefined}),setup({[C.STORAGE_KEY]:'{bad'}, {bulk:true})]) {
    await preview(a); assert.equal(a.elements.save.disabled,true);
  }
});

test('reload restores every edited preview row while an incomplete row prevents saving', async () => {
  const options = { bulk: true, session: new Map(), values: new Map() };
  const first = setup({}, options);
  await preview(first);
  const content = (ui, index) => ui.rows.children[index].children[3].children[0];
  const start = (ui, index) => ui.rows.children[index].children[1].children[0].children[0];
  async function input(field, value) {
    field.value = value;
    await field.fire('input');
  }
  await input(content(first.elements, 0), '门禁故障，待厂家回复');
  await input(content(first.elements, 1), '');
  await input(start(first.elements, 1), '');
  await first.window.fire('pagehide');
  const reopened = setup({}, options);
  const ui = reopened.elements;
  await ui.bulkButton.fire('click');
  assert.equal(ui.preview.hidden, false);
  assert.equal(content(ui, 0).value, '门禁故障，待厂家回复');
  assert.equal(content(ui, 1).value, '');
  assert.equal(start(ui, 1).value, '');
  assert.equal(ui.save.disabled, true);
  await input(content(ui, 1), '检查录像');
  assert.equal(ui.save.disabled, true);
  await input(start(ui, 1), '10:00');
  assert.equal(ui.save.disabled, false);
  await ui.save.fire('click');
  assert.deepEqual(reopened.saved().reports['2026-09-05'].entries.map(e => e.content),
    ['门禁故障，待厂家回复', '检查录像']);
});

test('regenerating with AI saves the new rows under the date and name edited in preview', async () => {
  let calls = 0;
  const app = setup({}, { bulk: true, aiFetch: async () => {
    calls++;
    const content = calls === 1 ? '查门禁' : '检查门禁';
    return Response.json({ entries: [{ start: '08:00', end: '09:00', nextDay: false, content }] });
  } });
  const ui = app.elements;
  await ui.bulkButton.fire('click');
  ui.source.value = '上午查门禁';
  await ui.source.fire('input');
  ui.aiToken.value = 'local-test-token-for-regeneration';
  await ui.intake.fire('click');
  assert.equal(ui.preview.hidden, false);
  ui.date.value = '2026-09-03';
  await ui.date.fire('change');
  ui.name.value = '补录人';
  await ui.name.fire('input');
  await ui.intake.fire('click');
  assert.equal(calls, 2);
  assert.equal(ui.save.disabled, false);
  await ui.save.fire('click');
  const { reports } = app.saved();
  assert.deepEqual(Object.keys(reports), ['2026-09-03']);
  assert.equal(reports['2026-09-03'].name, '补录人');
  assert.deepEqual(reports['2026-09-03'].entries.map(row => row.content), ['检查门禁']);
});

test('reparsing the same pasted report retains manual metadata while a new report uses its own headers', async () => {
  const options = { bulk: true, session: new Map(), values: new Map() };
  const app = setup({}, options);
  const ui = app.elements;
  await ui.bulkButton.fire('click');
  ui.source.value = '日期：2026-09-02\n姓名：原姓名\n08:00—09:00 巡查门禁';
  await ui.source.fire('input');
  await ui.parse.fire('click');
  assert.deepEqual([ui.date.value, ui.name.value], ['2026-09-02', '原姓名']);
  ui.date.value = '2026-09-01';
  await ui.date.fire('change');
  ui.name.value = '手动姓名';
  await ui.name.fire('input');
  ui.source.value += '设备';
  await ui.source.fire('input');
  await ui.parse.fire('click');
  assert.deepEqual([ui.date.value, ui.name.value], ['2026-09-01', '手动姓名']);
  ui.name.value = '';
  await ui.name.fire('input');
  await app.window.fire('pagehide');
  const restored = setup({}, options).elements;
  await restored.bulkButton.fire('click');
  await restored.parse.fire('click');
  assert.deepEqual([restored.date.value, restored.name.value], ['2026-09-01', '']);
  restored.source.value = '日期：2026-09-04\n姓名：新姓名\n13:30—15:00 核对图纸';
  await restored.source.fire('input');
  await restored.parse.fire('click');
  assert.deepEqual([restored.date.value, restored.name.value], ['2026-09-04', '新姓名']);
});

test('older preview drafts retain their selected target until a fresh report is started', async () => {
  const row = { start: '08:00', end: '09:00', nextDay: false, content: '巡查门禁' };
  const source = '日期：2026-09-02\n姓名：原姓名\n08:00—09:00 巡查门禁';
  const session = new Map([['daily_report_bulk_draft_v1', JSON.stringify({
    source, date: '2026-09-01', name: '', entries: [row], preview: true
  })]]);
  const app = setup({}, { bulk: true, session });
  const ui = app.elements;
  await ui.parse.fire('click');
  assert.deepEqual([ui.date.value, ui.name.value], ['2026-09-01', '']);
  ui.source.value = '';
  await ui.source.fire('input');
  ui.source.value = '13:30—14:00 检查监控';
  await ui.source.fire('input');
  await ui.parse.fire('click');
  assert.equal(ui.date.value, ui.reportDate.value);
});
