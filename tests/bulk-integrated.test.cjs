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
