const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, C } = require('./helpers.cjs');

async function search(ui, query) {
  ui.historySearch.value = query;
  await ui.historySearch.fire('input');
  return ui.historyList.children;
}

test('history search shows a matching excerpt from legacy records and opens the selected day', async () => {
  const source = {
    '2026-09-01': [{ time: '巡查时', content: '东区'.repeat(35) + 'NVR[1]检查接口' + '正常'.repeat(35) }],
    '2026-09-02': [{ time: '', content: '更换门禁按钮' }]
  };
  const app = setup({ [C.LEGACY_KEY]: JSON.stringify(source) }, { locks: undefined });
  const ui = app.elements;
  await ui.historyButton.fire('click');
  const [row] = await search(ui, ' nvr[1] ');
  assert.equal(ui.historyList.children.length, 1);
  assert.match(row.children[0].textContent, /2026-09-01/);
  assert.match(row.children[2].textContent, /^….+NVR\[1\]检查接口.+…$/);
  await row.children[1].children[0].fire('click');
  assert.match(ui.previewText.textContent, /2026年9月1日/);
  await ui.historyButton.fire('click');
  await ui.historyList.children[0].children[1].children[1].fire('click');
  assert.equal(ui.reportDate.value, '2026-09-01');
  assert.equal(app.values.has(C.STORAGE_KEY), false);
});

test('empty history search restores all dates including drafts and preserves their order', async () => {
  const state = C.emptyState();
  state.reports['2026-09-01'] = { name: '', entries: [C.makeEntry({ start: '', end: '', content: '维修门禁' })] };
  state.drafts['2026-09-03'] = { entryId: null, start: '', end: '', nextDay: false, content: '未提交录像维修', legacyTime: '' };
  const raw = JSON.stringify(state);
  const app = setup({ [C.STORAGE_KEY]: raw });
  const ui = app.elements;
  await ui.historyButton.fire('click');
  assert.match((await search(ui, '录像'))[0].textContent, /没有找到/);
  const all = await search(ui, '  ');
  assert.deepEqual(all.map(row => row.children[0].textContent), ['2026-09-03（0 条，有草稿）', '2026-09-01（1 条）']);
  assert.equal(app.values.get(C.STORAGE_KEY), raw);
});
