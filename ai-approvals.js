(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const proofPattern = /^colleague\.v1\.([A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/;
  const idPattern = /^[A-Za-z0-9_-]{22}$/;

  function setup({ endpoint, credentialScope, readDevice, saveDevice, onApproved }) {
    const key = 'daily_report_ai_pending_v1:' + credentialScope;
    const status = $('aiApprovalStatus');
    const manager = $('aiApprovalDialog');
    const adminStatus = $('aiApprovalAdminStatus');
    let pending = '';
    let selected = '';
    let checking = false;
    let creating = false;
    let managing = false;
    try { pending = localStorage.getItem(key) || ''; } catch { /* Use the current page when storage is blocked. */ }
    if (!proofPattern.test(pending)) pending = '';
    if (pending) status.textContent = '已提交申请，等待管理员批准。';
    if (/MicroMessenger/i.test(navigator.userAgent || '')) {
      $('aiApprovalBrowserHint').textContent = '如果平时用 Safari 或 Chrome 写日报，请先从微信菜单选择在浏览器打开，再发起申请。';
    }

    async function call(path, body, token = '') {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetch(new URL('/approval/' + path, endpoint), {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers,
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || '审批服务暂未响应，请稍后重试。');
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function setPending(value) {
      pending = value;
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
        return true;
      } catch { return false; }
    }

    function refresh() {
      const approved = !!readDevice();
      $('aiRequestAccess').hidden = approved || !!pending;
      $('aiPendingActions').hidden = approved || !pending;
      if (approved || !pending) $('aiApprovalShareLink').hidden = true;
    }

    async function checkPending(quiet = false) {
      if (!pending || checking || readDevice()) return;
      const proof = pending;
      checking = true;
      try {
        const result = await call('status', {}, proof);
        if (pending !== proof) return;
        if (result.state === 'approved') {
          if (!saveDevice(proof)) {
            status.textContent = '已批准，但浏览器无法保存授权。请允许网站存储，再检查审批结果。';
            return;
          }
          setPending('');
          onApproved();
          status.textContent = 'AI 权限已开通，可以直接生成。';
        } else if (result.state === 'revoked') {
          setPending('');
          status.textContent = '申请已撤销，可重新申请。';
        } else if (!quiet) {
          status.textContent = '还在等待管理员批准。';
        }
      } catch (error) {
        if (pending !== proof) return;
        if (error.status === 401 || error.status === 404) {
          setPending('');
          status.textContent = '申请已失效，请重新申请。';
        } else if (!quiet) {
          status.textContent = error.status ? error.message : '暂时无法查询结果，请稍后重试。';
        }
      } finally {
        checking = false;
        refresh();
      }
    }

    $('aiRequestAccess').addEventListener('click', async () => {
      if (creating || pending || readDevice()) return;
      creating = true;
      $('aiRequestAccess').disabled = true;
      status.textContent = '正在提交申请…';
      try {
        const result = await call('request', {});
        if (!proofPattern.test(result.credential || '')) throw new Error('审批申请格式无效。');
        const stored = setPending(result.credential);
        status.textContent = stored ? '已提交。请复制审批链接发给管理员。' :
          '已提交。浏览器无法保存申请，请保持此页打开直到批准。';
      } catch (error) {
        status.textContent = error.status ? error.message : '暂时无法提交申请，请稍后重试。';
      } finally {
        creating = false;
        $('aiRequestAccess').disabled = false;
        refresh();
      }
    });
    $('aiCopyApprovalLink').addEventListener('click', async () => {
      const match = proofPattern.exec(pending);
      if (!match) return;
      const link = new URL('./', location.href);
      link.hash = 'approve=' + match[1];
      try {
        await navigator.clipboard.writeText(link.href);
        status.textContent = '已复制审批链接，可以通过微信发给管理员。';
      } catch {
        const fallback = $('aiApprovalShareLink');
        fallback.value = link.href;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        status.textContent = '请手动复制下面的审批链接。';
      }
    });
    $('aiCheckApproval').addEventListener('click', () => checkPending());
    $('bulkButton').addEventListener('click', () => {
      refresh();
      checkPending(true);
    });
    setInterval(() => {
      if ($('bulkDialog').open && document.visibilityState !== 'hidden') checkPending(true);
    }, 5000);

    function dateLabel(value) {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(value);
    }

    function setSelection(id, record) {
      selected = id;
      $('aiApprovalAdminList').replaceChildren();
      $('aiApprovalAdminIntro').textContent = id ? '已打开同事的审批申请。' : '查看最近的申请和有效授权。';
      $('aiApproveDevice').hidden = !id || (record && record.state !== 'pending');
      $('aiRevokeDevice').hidden = !id || (record && record.state === 'revoked');
      adminStatus.textContent = '';
      if (!record) return;
      if (record.state === 'approved') adminStatus.textContent = '已批准，有效至 ' + dateLabel(record.expiresAt) + '。';
      else if (record.state === 'revoked') adminStatus.textContent = '已撤销。';
      else if (record.state === 'pending') adminStatus.textContent = dateLabel(record.createdAt) + ' 提交，等待批准。';
    }

    function openManager(id = '') {
      if (managing) return;
      setSelection(id);
      if (!manager.open) manager.showModal();
    }

    async function manage(action) {
      if (managing) return;
      const keyInput = $('aiApprovalAdminToken');
      const token = keyInput.value.trim();
      if (!token) {
        adminStatus.textContent = '请输入管理员口令。';
        keyInput.focus();
        return;
      }
      managing = true;
      const buttons = [$('aiListApprovals'), $('aiApproveDevice'), $('aiRevokeDevice')];
      buttons.forEach(button => { button.disabled = true; });
      adminStatus.textContent = '正在处理…';
      try {
        const result = await call('manage', { action, id: selected }, token);
        if (action !== 'list') {
          setSelection(selected, result);
          return;
        }
        setSelection('');
        adminStatus.textContent = result.records.length ? '选一条申请或授权查看。' : '暂时没有待审批或有效授权。';
        for (const record of result.records) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = (record.state === 'pending' ? '待审批' : '已批准') + ' · ' + dateLabel(record.createdAt);
          button.addEventListener('click', () => setSelection(record.id, record));
          $('aiApprovalAdminList').append(button);
        }
      } catch (error) {
        adminStatus.textContent = error.status ? error.message : '暂时无法审批，请稍后重试。';
      } finally {
        managing = false;
        buttons.forEach(button => { button.disabled = false; });
      }
    }

    $('aiManageApprovals').addEventListener('click', () => openManager());
    $('aiListApprovals').addEventListener('click', () => manage('list'));
    $('aiApproveDevice').addEventListener('click', () => manage('approve'));
    $('aiRevokeDevice').addEventListener('click', () => manage('revoke'));
    $('aiCloseApprovalAdmin').addEventListener('click', () => manager.close());
    manager.addEventListener('close', () => {
      if (idPattern.test(new URLSearchParams(location.hash.slice(1)).get('approve') || '')) {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
    });
    function checkLink() {
      const id = new URLSearchParams(location.hash.slice(1)).get('approve');
      if (!idPattern.test(id || '')) return;
      openManager(id);
    }
    window.addEventListener('hashchange', checkLink);
    checkLink();
    refresh();
    return { refresh, hasPending: () => !!pending };
  }

  window.DailyReportApprovals = { setup, proofPattern };
})();
