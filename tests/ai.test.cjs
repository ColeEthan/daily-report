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
    method: 'POST', body: JSON.stringify({ note: options.note ?? note, rememberDevice: options.remember }), headers
  }), { ...env, ...options.env });
}

test('Worker sends only the current description to DeepSeek and returns a valid schedule', async t => {
  const call = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fake-upstream-key');
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-ai/DeepSeek-V4.1-Flash');
    assert.equal(body.enable_thinking, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
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

test('AI polishes terse work descriptions and keeps specific details and results', async t => {
  const descriptions = [
    '查看锦园监控。', '查看商云', '远程看福源监控系统。', '陪同市标检查。',
    '查看锦园监控录像，发现一处画面异常。', '查看商云系统日志。', '维修单元门磁吸锁，待配件。'
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{
    finish_reason: 'stop',
    message: { content: JSON.stringify({ items: descriptions.map(content => item(content, 'morning')) }) }
  }] }));
  const response = await requestWorker({ note: descriptions.join('；') });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries.map(row => row.content), [
    '查看锦园监控运行情况。', '查看商云运行。', '远程查看福源监控系统运行情况。', '陪同市标检查，配合现场检查工作。',
    ...descriptions.slice(4)
  ]);
});

test('remembering a device requires the access code and issues a limited 30-day credential', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const upstream = JSON.parse(options.body);
    assert.deepEqual(upstream.messages[1], { role: 'user', content: note });
    return Response.json({ choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ items: [item('测试巡检。', 'morning')] }) }
    }] });
  });
  const ordinary = await requestWorker();
  assert.equal((await ordinary.json()).deviceToken, undefined);
  const first = await requestWorker({ remember: true });
  const { deviceToken } = await first.json();
  assert.match(deviceToken, /^device\.v1\./);
  assert.equal(Number(deviceToken.split('.')[2]), Math.floor(now / 1000) + 30 * 86400);
  const returning = { headers: { Authorization: 'Bearer ' + deviceToken }, remember: true };
  const next = await requestWorker(returning);
  assert.equal(next.status, 200);
  assert.equal((await next.json()).deviceToken, undefined);
  const forged = deviceToken.replace(/\.([A-Za-z0-9_-])([A-Za-z0-9_-]{42})$/, (_match, first, rest) => '.' + (first === 'A' ? 'B' : 'A') + rest);
  assert.equal((await requestWorker({ headers: { Authorization: 'Bearer ' + forged } })).status, 401);
  assert.equal((await requestWorker({ ...returning, env: { AI_ACCESS_TOKEN: 'another-long-test-passphrase' } })).status, 401);
  now += 30 * 86400 * 1000;
  assert.equal((await requestWorker(returning)).status, 401);
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
  const incomplete = await requestWorker();
  assert.equal(incomplete.status, 502);
  assert.equal((await incomplete.json()).code, 'provider_output_invalid');
  fetch.mock.mockImplementation(async () => { throw new DOMException('aborted', 'TimeoutError'); });
  assert.equal((await requestWorker()).status, 504);
});

test('sparse model output remains usable and standalone leave is recovered from the description', async t => {
  let period = 'afternoon_off';
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ items: [{ content: '查看商云系统日志。', period }] }) }
    }]
  }));
  for (period of ['afternoon_off', 'afternoon']) {
    const response = await requestWorker({ note: '查看系统日志。下午休班。' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.entries.map(({ content, start, end }) => [content, start, end]), [
      ['查看商云系统日志。', '08:00', '12:00'], ['下午休班。', '', '']
    ]);
  }
});

test('normalizes valid clock variants and lets the user review a malformed time without dropping the work', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const result = scheduleReport([
    { content: '维修测试门禁。', start: '9：00', end: '11:17' },
    { content: '检查电梯。', start: '时间未知', end: '15:00' }
  ]);
  assert.equal(result.needsTimeReview, true);
  assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [['09:00', '11:17'], ['', '']]);
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

test('a lower bound and a fixed meeting at the same clock stay with their own tasks', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  for (const task of [
    { ...item('整理资料', 'afternoon'), notBefore: '14:30' },
    item('整理资料', 'afternoon', '14:30')
  ]) {
    const result = scheduleReport([task, item('开会', 'afternoon', '14:30')],
      '14:30以后整理资料，14:30开始开会');
    assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [['', ''], ['14:30', '']]);
  }
});

test('reconciles a stated time range in mixed prose before estimating other work', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const mixed = '上午修门禁，下午 14： 30–16：00 去锦园看电梯';
  const generated = [item('维修门禁。', 'morning'), item('查看锦园电梯。', 'afternoon', '14:00', '17:00')];
  const result = scheduleReport(generated, mixed);
  assert.deepEqual(result.entries.map(({ start, end }) => [start, end]), [['08:00', '12:00'], ['14:30', '16:00']]);
  assert.equal(result.needsTimeReview, false);
  const uncertain = scheduleReport([item('整理其他资料。', 'afternoon')], mixed);
  assert.equal(uncertain.needsTimeReview, true);
});

test('swapped source times flag the affected preview rows, including after reload', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const source = '检修门禁08:00-09:00，备份录像10:00-11:00，整理资料13:30-14:30';
  const items = [
    item('检修门禁', 'morning', '10:00', '11:00'),
    item('备份录像', 'morning', '08:00', '09:00'),
    item('整理资料', 'afternoon', '13:30', '14:30')
  ];
  const result = scheduleReport(items, source);
  assert.equal(result.needsTimeReview, true);
  assert.deepEqual(result.entries.map(e => !!e.needsTimeReview), [true, true, false]);
  const options = { bulk: true, aiFetch: async () => Response.json(result), session: new Map() };
  const first = setup({}, options).elements;
  first.source.value = source;
  await first.source.fire('input');
  first.aiToken.value = token;
  await first.intake.fire('click');
  for (const ui of [first, setup({}, options).elements]) {
    assert.equal(ui.preview.hidden, false);
    assert.equal(ui.aiTimeReview.hidden, false);
    assert.deepEqual(ui.rows.children.map(row => row.children[0].children.some(
      node => node.textContent === '请核对本条时间')), [true, true, false]);
  }
});

test('enumeration commas keep each source time range attached to its description', async () => {
  const { scheduleReport } = await import('../ai-worker/schedule.mjs');
  const note = '检修门禁08:00-09:00、备份录像10:00-11:00、整理资料13:30-14:30';
  const third = item('整理资料', 'afternoon', '13:30', '14:30');
  const swapped = scheduleReport([
    item('检修门禁', 'morning', '10:00', '11:00'), item('备份录像', 'morning', '08:00', '09:00'), third
  ], note);
  assert.equal(swapped.needsTimeReview, true);
  assert.deepEqual(swapped.entries.map(entry => !!entry.needsTimeReview), [true, true, false]);
  const correct = scheduleReport([
    item('检修门禁', 'morning', '08:00', '09:00'), item('备份录像', 'morning', '10:00', '11:00'), third
  ], note);
  assert.equal(correct.needsTimeReview, false);
});

test('the same input previews complete reports locally and asks before processing untimed items', async () => {
  let modelCalls = 0;
  const { elements: el } = setup({}, { bulk: true, aiFetch: async (_url, options) => {
    modelCalls++;
    assert.match(JSON.parse(options.body).note, /检查门禁/);
    return Response.json({ entries: [{ start: '08:00', end: '11:00', nextDay: false, content: '检查门禁。' }] });
  } });
  const time = (row, column) => el.rows.children[row].children[1].children[column].children[0].value;
  await el.bulkButton.fire('click');
  el.source.value = '2026年11月19日\n测试员工作汇报\n1、8： 00-11： 00：检查门禁。';
  await el.source.fire('input');
  await el.intake.fire('click');
  assert.equal(el.preview.hidden, false);
  assert.equal(el.date.value, '2026-11-19');
  assert.equal(el.name.value, '测试员');
  assert.deepEqual([time(0, 0), time(0, 1)], ['08:00', '11:00']);
  assert.equal(modelCalls, 0);

  el.source.value += '\n2、整理资料。';
  await el.source.fire('input');
  await el.intake.fire('click');
  assert.equal(el.intake.hidden, true);
  assert.equal(el.parse.hidden, false);
  assert.equal(el.aiGenerate.hidden, false);
  assert.equal(el.preview.hidden, true);
  await el.parse.fire('click');
  assert.equal(el.rows.children.length, 2);
  assert.deepEqual([time(1, 0), time(1, 1)], ['', '']);
  assert.equal(modelCalls, 0);
  el.aiToken.value = token;
  await el.aiGenerate.fire('click');
  assert.equal(modelCalls, 1);
  assert.equal(el.date.value, '2026-11-19');
  assert.equal(el.name.value, '测试员');
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
  el.source.value = note;
  await el.source.fire('input');
  el.aiToken.value = token;
  await el.intake.fire('click');
  assert.equal(el.preview.hidden, false);
  assert.equal(el.save.disabled, false);
  assert.equal(el.aiEstimate.hidden, false);
  assert.equal(app.values.get(C.STORAGE_KEY), original);
  await el.save.fire('click');
  assert.equal(app.saved().reports['2026-09-05'].entries.length, 1);
  assert.equal(app.saved().drafts['2026-09-05'].content, '手动草稿');
});

test('provider failure keeps the current preview and the description', async () => {
  let response = Response.json({ entries: [{ start: '08:00', end: '12:00', nextDay: false, content: '原有预览' }] });
  const { elements: el } = setup({}, { bulk: true, aiFetch: async () => response });
  await el.bulkButton.fire('click');
  el.source.value = note;
  await el.source.fire('input');
  el.aiToken.value = token;
  await el.intake.fire('click');
  assert.equal(el.preview.hidden, false);
  const original = el.rows.children;
  response = new Response(null, { status: 429 });
  await el.intake.fire('click');
  assert.equal(el.source.value, note);
  assert.equal(el.rows.children, original);
  assert.match(el.aiStatus.textContent, /请求过多.*简述已保留/);
  response = Response.json({ code: 'provider_key_invalid' }, { status: 502 });
  await el.intake.fire('click');
  assert.match(el.aiStatus.textContent, /SILICONFLOW_API_KEY/);
  assert.equal(el.rows.children, original);
});

test('the unified input is restored when a failed or unfinished draft is reopened', async () => {
  const session = new Map();
  const aiFetch = async () => new Response(null, { status: 429 });
  const first = setup({}, { bulk: true, aiFetch, session });
  first.elements.source.value = note;
  await first.elements.source.fire('input');
  first.elements.aiToken.value = token;
  await first.elements.intake.fire('click');
  const reopened = setup({}, { bulk: true, aiFetch, session });
  assert.equal(reopened.elements.source.value, note);
  assert.equal(reopened.elements.preview.hidden, true);
});

test('the browser stores only the device credential, reuses it after reopening, and can forget it', async () => {
  const values = new Map();
  const fakeDevice = 'device.v1.1798000000.' + 'a'.repeat(16) + '.' + 'a'.repeat(43);
  const received = [];
  const aiFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    received.push([options.headers.Authorization, body]);
    return Response.json({
      ...(body.rememberDevice ? { deviceToken: fakeDevice } : {}),
      entries: [{ start: '08:00', end: '12:00', nextDay: false, content: '测试巡检。' }]
    });
  };
  const first = setup({}, { bulk: true, aiFetch, values });
  first.elements.source.value = note;
  first.elements.aiToken.value = token;
  first.elements.aiRememberDevice.checked = true;
  await first.elements.intake.fire('click');
  assert.deepEqual(received[0], ['Bearer ' + token, { note, rememberDevice: true }]);
  assert.deepEqual([...values.values()], [fakeDevice]);
  assert.equal(first.elements.aiToken.value, '');
  const next = setup({}, { bulk: true, aiFetch, values });
  next.elements.source.value = note;
  await next.elements.intake.fire('click');
  assert.deepEqual(received[1], ['Bearer ' + fakeDevice, { note }]);
  await next.elements.aiForgetDevice.fire('click');
  assert.equal(values.size, 0);
  await next.elements.intake.fire('click');
  assert.equal(received.length, 2);
  assert.match(next.elements.aiStatus.textContent, /请输入 AI 访问口令/);
});

test('local file directs users to the online site without sending AI requests', async () => {
  const { elements: el } = setup({}, {
    bulk: true, location: 'file:///reports/index.html',
    aiFetch: async () => assert.fail('local file requested the AI API')
  });
  await el.bulkButton.fire('click');
  assert.equal(el.aiSection.hidden, true);
  assert.equal(el.intake.hidden, true);
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
  el.source.value = note;
  el.aiToken.value = token;
  const pending = el.intake.fire('click');
  el.source.value = '08:00—12:00\n刚粘贴的预览';
  await el.source.fire('input');
  await el.intake.fire('click');
  const original = el.rows.children;
  complete(Response.json({ entries: [{ start: '08:00', end: '12:00', nextDay: false, content: '延迟返回的结果' }] }));
  await pending;
  assert.equal(el.rows.children, original);
  assert.equal(el.aiStatus.textContent, '');
});
