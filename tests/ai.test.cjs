const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, C, enter } = require('./helpers.cjs');

const origin = 'https://coleethan.github.io';
const token = 'test-token-with-at-least-24-characters';
const note = '上午福源修门禁和刷卡，下午锦园看电梯';
const env = {
  APP_ORIGIN: origin,
  AI_ACCESS_TOKEN: token,
  SILICONFLOW_API_KEY: 'fake-upstream-key',
  AI_RATE_LIMIT: { limit: async () => ({ success: true }) }
};

function item(content, period, start = null, end = null, nextDay = false) {
  return { content, period, start, end, nextDay };
}

async function requestWorker(options = {}) {
  const { default: worker } = await import('../ai-worker/worker.mjs');
  const headers = { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...options.headers };
  return worker.fetch(new Request('https://worker.example/generate', {
    method: 'POST', body: JSON.stringify({ note: options.note ?? note }), headers
  }), { ...env, ...options.env });
}

test('Worker routes only the current description to the fixed free model and returns a valid schedule', async t => {
  const call = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fake-upstream-key');
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'Qwen/Qwen2.5-7B-Instruct');
    assert.match(body.messages[0].content, /不使用“开展”/);
    assert.match(body.messages[0].content, /景园或颈园→锦园/);
    assert.equal(body.messages[1].content, note);
    return Response.json({ choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ items: [
        item('检修福源门禁及刷卡设备。', 'morning'),
        item('查看锦园电梯运行情况。', 'afternoon')
      ] }) }
    }] });
  });
  const response = await requestWorker();
  assert.equal(call.mock.callCount(), 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  const result = await response.json();
  assert.equal(result.estimated, true);
  assert.deepEqual(result.entries.map(row => [row.start, row.end]), [['08:00', '12:00'], ['13:30', '17:30']]);
});

test('Worker rejects unconfigured, unauthenticated, throttled and excessive requests before calling the model', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected upstream call'));
  assert.equal((await requestWorker({ headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await requestWorker({ headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await requestWorker({ env: { SILICONFLOW_API_KEY: '' } })).status, 503);
  assert.equal((await requestWorker({ note: '长'.repeat(1801) })).status, 400);
  assert.equal((await requestWorker({ env: { AI_RATE_LIMIT: { limit: async () => ({ success: false }) } } })).status, 429);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Worker handles provider failures and incomplete model output without returning a partial draft', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 429 }));
  assert.equal((await requestWorker()).status, 429);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  const invalidKey = await requestWorker();
  assert.equal(invalidKey.status, 502);
  assert.equal((await invalidKey.json()).code, 'provider_key_invalid');
  fetch.mock.mockImplementation(async () => Response.redirect('https://example.com'));
  assert.equal((await requestWorker()).status, 502);
  fetch.mock.mockImplementation(async () => Response.json({ choices: [{ finish_reason: 'length' }] }));
  assert.equal((await requestWorker()).status, 502);
});

test('schedule preserves explicit and overnight times and reserves the stated half-day off', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const result = scheduleReport([
    item('巡检', 'morning'),
    item('维修', 'morning', '10:00', '11:00'),
    item('整理记录', 'morning'),
    item('下午休班', 'afternoon_off'),
    item('夜间外勤', 'afternoon', '22:00', '01:30', true)
  ]);
  assert.deepEqual(result.entries.map(({ start, end, nextDay }) => [start, end, nextDay]), [
    ['08:00', '10:00', false], ['10:00', '11:00', false], ['11:00', '12:00', false], ['', '', false], ['22:00', '01:30', true]
  ]);
});

test('estimates use half-hours, give longer work more time and honor an afternoon lower bound', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const result = scheduleReport([
    { ...item('维修门禁', 'morning'), effort: 'long' },
    { ...item('查看监控', 'morning'), effort: 'short' },
    { ...item('查看电梯', 'afternoon'), notBefore: '14:30', effort: 'short' }
  ]);
  assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [
    ['08:00', '11:00'], ['11:00', '12:00'], ['14:30', '17:30']
  ]);
});

test('preserves exact times and leaves excess items untimed instead of inventing minute-by-minute estimates', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const actual = item('处理故障', 'morning', '09:17', '10:25');
  const result = scheduleReport([
    item('查看监控', 'morning'), actual,
    ...Array.from({ length: 4 }, (_, index) => item('后续事项' + index, 'morning'))
  ]);
  assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [
    ['08:00', '09:00'], ['09:17', '10:25'],
    ['10:30', '11:00'], ['11:00', '11:30'], ['11:30', '12:00'], ['', '']
  ]);
});

test('keeps a start-only meeting open and recovers a spoken lower bound mislabeled by the model', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const result = scheduleReport([
    item('查看电梯', 'afternoon', '14:30'),
    item('田园开会', 'afternoon', '16:30')
  ], '下午两点半以后查看电梯，16:30田园开会。');
  assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [
    ['14:30', '16:30'], ['16:30', '']
  ]);
});

test('embedded AI returns a preview for the selected date and preserves the manual draft on save', async () => {
  const app = setup({}, { bulk: true, aiFetch: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { note });
    return Response.json({ estimated: true, entries: [
      { start: '08:00', end: '12:00', nextDay: false, content: '检修福源门禁及刷卡设备。' }
    ] });
  } });
  const { elements: el } = app;
  await enter(app, '手动草稿');
  const original = app.values.get(C.STORAGE_KEY);
  await el.bulkButton.fire('click');
  el.aiNote.value = note;
  el.aiToken.value = token;
  await el.aiGenerate.fire('click');
  assert.equal(el.preview.hidden, false);
  assert.equal(el.save.disabled, false);
  assert.equal(el.aiEstimate.hidden, false);
  assert.equal(app.values.get(C.STORAGE_KEY), original);
  await el.save.fire('click');
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 1);
  assert.equal(app.saved().drafts['2026-09-05'].content, '手动草稿');
});

test('provider failure keeps the current preview and the description', async () => {
  let response = new Response(null, { status: 429 });
  const { elements: el } = setup({}, { bulk: true, aiFetch: async () => response });
  await el.bulkButton.fire('click');
  el.source.value = '08:00—12:00\n原有预览';
  await el.parse.fire('click');
  const original = el.rows.children;
  el.aiNote.value = note;
  el.aiToken.value = token;
  await el.aiGenerate.fire('click');
  assert.equal(el.aiNote.value, note);
  assert.equal(el.rows.children, original);
  assert.match(el.aiStatus.textContent, /限流/);
  response = Response.json({ code: 'provider_key_invalid' }, { status: 502 });
  await el.aiGenerate.fire('click');
  assert.match(el.aiStatus.textContent, /SILICONFLOW_API_KEY/);
  assert.equal(el.rows.children, original);
});

test('local file directs users to the online site without sending AI requests', async () => {
  const { elements: el } = setup({}, {
    bulk: true, location: 'file:///reports/index.html',
    aiFetch: async () => assert.fail('local file requested the AI API')
  });
  await el.bulkButton.fire('click');
  assert.equal(el.aiForm.hidden, true);
  assert.equal(el.aiLocalNotice.hidden, false);
  await el.aiGenerate.fire('click');
  el.source.value = '08:00—12:00\n手动粘贴测试';
  await el.parse.fire('click');
  assert.equal(el.preview.hidden, false);
});

test('a pending AI response cannot replace a newer pasted preview', async () => {
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  const { elements: el } = setup({}, { bulk: true, aiFetch: () => response });
  await el.bulkButton.fire('click');
  el.aiNote.value = note;
  el.aiToken.value = token;
  const pending = el.aiGenerate.fire('click');
  el.source.value = '08:00—12:00\n刚粘贴的预览';
  await el.source.fire('input');
  await el.parse.fire('click');
  const original = el.rows.children;
  complete(Response.json({ entries: [{ start: '08:00', end: '12:00', nextDay: false, content: '延迟返回的结果' }] }));
  await pending;
  assert.equal(el.rows.children, original);
  assert.match(el.aiStatus.textContent, /已变化/);
});
