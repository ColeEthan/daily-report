const pendingLifetime = 24 * 60 * 60 * 1000;
const accessLifetime = 180 * pendingLifetime;
const idPattern = /^[A-Za-z0-9_-]{22}$/;
const claimPattern = /^Bearer colleague\.v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();
const paths = new Set(['/approval/request', '/approval/status', '/approval/manage']);

export function isApprovalPath(path) {
  return paths.has(path);
}
export function isColleagueAuthorization(authorization) {
  return claimPattern.test(authorization);
}

function randomPart(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashClaim(claim) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(claim)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function callStore(binding, operation) {
  const object = binding.get(binding.idFromName('colleague-approvals'));
  return object.fetch('https://approval-store.internal/', {
    method: 'POST',
    body: JSON.stringify(operation)
  });
}

async function checkClaim(authorization, binding) {
  const match = claimPattern.exec(authorization);
  if (!match) return Response.json({ error: '浏览器授权不存在或已失效。' }, { status: 401 });
  return callStore(binding, { action: 'status', id: match[1], claimHash: await hashClaim(match[2]) });
}

export async function colleagueMayGenerate(authorization, binding) {
  if (!binding) return false;
  const response = await checkClaim(authorization, binding);
  return response.ok && (await response.json()).state === 'approved';
}

export async function handleApproval(path, request, env, matchesToken, readJson) {
  const unavailable = () => Response.json({ error: '设备审批尚未开通。' }, { status: 503 });
  if (!env.AI_APPROVALS || !/^[A-Za-z0-9_-]{24,128}$/.test(env.AI_ADMIN_TOKEN || '') ||
      env.AI_ADMIN_TOKEN === env.AI_ACCESS_TOKEN || !env.AI_RATE_LIMIT) return unavailable();
  const authorization = request.headers.get('Authorization') || '';
  const client = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (path === '/approval/status') return checkClaim(authorization, env.AI_APPROVALS);
  const category = path === '/approval/manage' ? 'approval-management' : 'approval-request';
  const { success } = await env.AI_RATE_LIMIT.limit({ key: category + ':' + client });
  if (!success) return Response.json({ error: '操作太频繁，请稍后再试。' }, { status: 429 });

  if (path === '/approval/request') {
    const id = randomPart(16);
    const claim = randomPart(32);
    const response = await callStore(env.AI_APPROVALS, { action: 'request', id, claimHash: await hashClaim(claim) });
    if (!response.ok) return response;
    return Response.json({ ...await response.json(), credential: 'colleague.v1.' + id + '.' + claim });
  }

  if (!await matchesToken(authorization, env.AI_ADMIN_TOKEN)) {
    return Response.json({ error: '请输入正确的管理员口令。' }, { status: 401 });
  }
  const data = await readJson(request, 1000).catch(() => null);
  const action = data?.action;
  if (action === 'list') return callStore(env.AI_APPROVALS, { action });
  if (!['inspect', 'approve', 'revoke'].includes(action) || typeof data.id !== 'string' || !idPattern.test(data.id)) {
    return Response.json({ error: '无效的审批请求。' }, { status: 400 });
  }
  return callStore(env.AI_APPROVALS, { action, id: data.id });
}

export class AiApprovals {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, claim_hash TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS approvals_expiry ON approvals (expires_at)');
  }

  async fetch(request) {
    const { action, id, claimHash } = await request.json();
    const now = Date.now();
    const columns = 'id, state, created_at AS createdAt, expires_at AS expiresAt';
    if (action === 'request') {
      this.sql.exec('DELETE FROM approvals WHERE expires_at <= ?', now);
      const { count } = this.sql.exec("SELECT count(*) AS count FROM approvals WHERE state <> 'revoked'").one();
      if (count >= 200) return Response.json({ error: '待处理和有效授权已达上限，请联系管理员。' }, { status: 429 });
      const expiresAt = now + pendingLifetime;
      this.sql.exec("INSERT INTO approvals VALUES (?, ?, 'pending', ?, ?)", id, claimHash, now, expiresAt);
      return Response.json({ id, state: 'pending', createdAt: now, expiresAt });
    }
    if (action === 'list') {
      return Response.json({ records: this.sql.exec(
        "SELECT " + columns + " FROM approvals WHERE expires_at > ? AND state <> 'revoked' ORDER BY created_at DESC", now
      ).toArray() });
    }
    if (action === 'approve') {
      this.sql.exec("UPDATE approvals SET state = 'approved', expires_at = ? WHERE id = ? AND state = 'pending' AND expires_at > ?",
        now + accessLifetime, id, now);
    } else if (action === 'revoke') {
      this.sql.exec("UPDATE approvals SET state = 'revoked', expires_at = ? WHERE id = ? AND state <> 'revoked' AND expires_at > ?",
        now + pendingLifetime, id, now);
    }
    const rows = action === 'status'
      ? this.sql.exec('SELECT ' + columns + ' FROM approvals WHERE id = ? AND claim_hash = ?', id, claimHash).toArray()
      : this.sql.exec('SELECT ' + columns + ' FROM approvals WHERE id = ?', id).toArray();
    if (!rows.length || rows[0].expiresAt <= now) {
      return Response.json({ error: '申请不存在或已到期。' }, { status: 404 });
    }
    return Response.json(rows[0]);
  }
}
