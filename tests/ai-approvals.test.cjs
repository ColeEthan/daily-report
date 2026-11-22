const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { setup } = require('./helpers.cjs');

const origin = 'https://coleethan.github.io';
const adminCode = 'test-admin-for-ai-device-approvals';
const regularCode = 'test-regular-only-ai-access-code';
const report = { entries: [{ start: '08:00', end: '12:00', nextDay: false, content: '测试巡检。' }] };

async function fixture(t) {
  const { default: worker, AiApprovals } = await import('../ai-worker/worker.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = { exec(query, ...values) {
    const statement = db.prepare(query);
    if (!/^\s*SELECT/i.test(query)) {
      statement.run(...values);
      return;
    }
    return { one: () => statement.get(...values), toArray: () => statement.all(...values) };
  } };
  const store = new AiApprovals({ storage: { sql } });
  const env = {
    APP_ORIGIN: origin, AI_ACCESS_TOKEN: regularCode, AI_ADMIN_TOKEN: adminCode,
    DEEPSEEK_API_KEY: 'synthetic-key', AI_RATE_LIMIT: { limit: async () => ({ success: true }) },
    AI_APPROVALS: {
      idFromName: () => 'test-store',
      get: () => ({ fetch: (url, options) => store.fetch(new Request(url, options)) })
    }
  };
  const send = (path, body = {}, token = '', source = origin) => worker.fetch(new Request('https://worker.example' + path, {
    method: 'POST', headers: {
      Origin: source, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify(body)
  }), env);
  return { db, env, send };
}

test('only the administrator can approve and only the requesting browser can generate', async t => {
  const { db, send } = await fixture(t);
  const model = t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{
    finish_reason: 'stop',
    message: { content: JSON.stringify({ items: [{ content: '测试巡检。' }] }) }
  }] }));
  assert.equal((await send('/approval/request', {}, '', 'https://elsewhere.example')).status, 403);
  const created = await send('/approval/request');
  assert.equal(created.headers.get('Access-Control-Allow-Origin'), origin);
  const { id, credential } = await created.json();
  const stored = db.prepare('SELECT * FROM approvals WHERE id=?').get(id);
  assert.equal(stored.claim_hash.length, 64);
  assert.ok(!Object.values(stored).includes(credential.split('.')[3]));
  assert.equal((await send('/generate', { note: '测试' }, credential)).status, 401);
  assert.equal((await send('/approval/manage', { action: 'approve', id }, regularCode)).status, 401);
  const approved = await send('/approval/manage', { action: 'approve', id }, adminCode);
  const record = await approved.json();
  assert.equal(record.state, 'approved');
  assert.ok(!Object.hasOwn(record, 'credential') && !Object.hasOwn(record, 'claimHash'));
  const otherBrowser = 'colleague.v1.' + id + '.' + 'a'.repeat(43);
  assert.equal((await send('/approval/status', {}, otherBrowser)).status, 404);
  assert.equal((await send('/generate', { note: '测试' }, otherBrowser)).status, 401);
  assert.equal((await (await send('/approval/status', {}, credential)).json()).state, 'approved');
  const generated = await send('/generate', { note: '测试', rememberDevice: true }, credential);
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).deviceToken, undefined);
  assert.equal((await (await send('/approval/manage', { action: 'list' }, adminCode)).json()).records.length, 1);
  await send('/approval/manage', { action: 'revoke', id }, adminCode);
  assert.equal((await send('/generate', { note: '测试' }, credential)).status, 401);
  assert.equal((await (await send('/approval/manage', { action: 'approve', id }, adminCode)).json()).state, 'revoked');
  assert.equal(model.mock.callCount(), 1);
});

test('access expires 180 days after approval and repeat approval does not extend it', async t => {
  const day = 24 * 60 * 60 * 1000;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { send } = await fixture(t);
  const first = await (await send('/approval/request')).json();
  const approve = id => send('/approval/manage', { action: 'approve', id }, adminCode);
  now += day;
  assert.equal((await approve(first.id)).status, 404);
  const second = await (await send('/approval/request')).json();
  now += day / 2;
  const approved = await (await approve(second.id)).json();
  assert.equal(approved.expiresAt, now + 180 * day);
  now += 1000;
  assert.equal((await (await approve(second.id)).json()).expiresAt, approved.expiresAt);
  now = approved.expiresAt - 1;
  assert.equal((await (await send('/approval/status', {}, second.credential)).json()).state, 'approved');
  now = approved.expiresAt;
  assert.equal((await send('/approval/status', {}, second.credential)).status, 404);
});

test('a shared approval link opens the admin panel without carrying the colleague token', async () => {
  const id = 'b'.repeat(22);
  const credential = 'colleague.v1.' + id + '.' + 'a'.repeat(43);
  let approved = false;
  const aiFetch = async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/approval/request') return Response.json({ id, credential });
    if (pathname === '/approval/manage') {
      assert.equal(options.headers.Authorization, 'Bearer ' + adminCode);
      assert.deepEqual(JSON.parse(options.body), { action: 'approve', id });
      approved = true;
      return Response.json({ state: 'approved', createdAt: 1798000000000, expiresAt: 1800000000000 });
    }
    if (pathname === '/approval/status') {
      assert.equal(options.headers.Authorization, 'Bearer ' + credential);
      return Response.json({ state: approved ? 'approved' : 'pending' });
    }
    assert.equal(pathname, '/generate');
    assert.equal(options.headers.Authorization, 'Bearer ' + credential);
    return Response.json(report);
  };
  const colleague = setup({}, { bulk: true, approvals: true, aiFetch });
  await colleague.elements.aiRequestAccess.fire('click');
  await colleague.elements.aiCopyApprovalLink.fire('click');
  const link = colleague.elements.aiApprovalShareLink.value;
  assert.equal(link, origin + '/daily-report/#approve=' + id);
  assert.ok(!link.includes(credential));
  const admin = setup({}, { bulk: true, approvals: true, aiFetch, location: link });
  assert.equal(admin.elements.aiApprovalDialog.open, true);
  admin.elements.aiApprovalAdminToken.value = adminCode;
  await admin.elements.aiApproveDevice.fire('click');
  assert.match(admin.elements.aiApprovalAdminStatus.textContent, /已批准/);
  await colleague.elements.aiCheckApproval.fire('click');
  assert.match(colleague.elements.aiApprovalStatus.textContent, /已开通/);
  colleague.elements.source.value = '测试巡检';
  await colleague.elements.intake.fire('click');
  assert.equal(colleague.elements.preview.hidden, false);
  assert.equal(colleague.elements.aiToken.value, '');
});

test('a new Worker hostname keeps pending and approved browser credentials', async () => {
  const pendingKey = 'daily_report_ai_pending_v1:https://worker.example/generate';
  const deviceKey = 'daily_report_ai_device_v1:https://worker.example/generate';
  const credential = 'colleague.v1.' + 'b'.repeat(22) + '.' + 'a'.repeat(43);
  const values = new Map([[pendingKey, credential]]);
  const requests = [];
  const aiFetch = async (url, options) => {
    const target = new URL(url);
    assert.equal(target.hostname, 'daily-report-api.9006064.xyz');
    assert.equal(options.headers.Authorization, 'Bearer ' + credential);
    requests.push(target.pathname);
    return Response.json(target.pathname === '/approval/status' ? { state: 'approved' } : report);
  };
  const options = {
    bulk: true, approvals: true, aiFetch, values,
    aiSettings: {
      endpoint: 'https://daily-report-api.9006064.xyz/generate',
      credentialScope: 'https://worker.example/generate'
    }
  };
  const colleague = setup({}, options);
  await colleague.elements.aiCheckApproval.fire('click');
  assert.equal(values.has(pendingKey), false);
  assert.equal(values.get(deviceKey), credential);

  const reopened = setup({}, options);
  reopened.elements.source.value = '测试巡检';
  await reopened.elements.intake.fire('click');
  assert.equal(reopened.elements.preview.hidden, false);
  assert.deepEqual(requests, ['/approval/status', '/generate']);
});
