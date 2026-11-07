/**
 * 直接読み込み版（検証用）ポップアップ
 *
 * 役割:
 *   chrome://extensions が使えない環境で、この画面が唯一の「設定」と「診断」の窓口になる。
 *   ・GAS WebアプリURLを直接入力して保存 → 手動同期
 *   ・疎通確認（URL・公開範囲の切り分け）
 *   ・直近の同期結果（失敗理由）の表示
 *   ・通信の稼働状態（教員コンソール稼働／同期周期／起こし確認の時間帯）の表示
 *
 * 管理ポリシー（Managed Storage）が配布されている場合は、そちらを優先表示する。
 */

// 学校一覧は gas/Code.gs の CONFIG.SCHOOL_LIST と一致させる（東粟倉小学校は廃校のため含めない）。
const SCHOOL_LIST = [
  '英田小学校',
  '大原小学校',
  '江見小学校',
  '勝田小学校',
  '勝田東小学校',
  '第一小学校',
  '北小学校',
  '土居小学校',
  '英田中学校',
  '大原中学校',
  '作東中学校',
  '勝田中学校',
  '美作中学校',
  '樸学園'
];

document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById(id);

  const gasUrlInput = el('gasUrlInput');
  const studentIdInput = el('studentIdInput');
  const schoolNameSelect = el('schoolNameSelect');
  const saveBtn = el('saveBtn');
  const testBtn = el('testBtn');
  const syncBtn = el('syncBtn');
  const clearDiagBtn = el('clearDiagBtn');
  const msgBox = el('msgBox');

  // 学校の選択肢を生成
  SCHOOL_LIST.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    schoolNameSelect.appendChild(opt);
  });

  init();

  async function init() {
    const data = await chrome.storage.local.get(null);

    if (data.gas_url) gasUrlInput.value = data.gas_url;
    if (data.student_id && String(data.student_id).indexOf('@') !== -1) {
      studentIdInput.value = data.student_id;
    }
    if (data.school_name && SCHOOL_LIST.indexOf(data.school_name) !== -1) {
      schoolNameSelect.value = data.school_name;
    }

    renderManagedState(data);
    renderStatus(data);
    renderDiag(data);
    await renderCommState();

    // バックグラウンドから最新の診断を取得（サービスワーカーが保持している値）
    try {
      const r = await chrome.runtime.sendMessage({ type: 'GET_SYNC_DIAG' });
      if (r && r.diag) renderDiag({ sync_diag_ok: r.diag.ok, sync_diag_code: r.diag.code,
        sync_diag_message: r.diag.message, sync_diag_at: r.diag.at });
    } catch (e) { /* サービスワーカー未起動時は無視 */ }
  }

  // ---------------- 設定の保存 ----------------
  saveBtn.addEventListener('click', async () => {
    const gasUrl = gasUrlInput.value.trim();
    const studentId = studentIdInput.value.trim();
    const schoolName = schoolNameSelect.value;

    if (!gasUrl) {
      showMessage('GAS WebアプリURLを入力してください', 'text-rose-600');
      gasUrlInput.focus();
      return;
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/.test(gasUrl)) {
      showMessage('URLの形式が違います（…/exec で終わるURLを貼り付け）', 'text-rose-600');
      return;
    }

    const patch = { gas_url: gasUrl };
    if (studentId) patch.student_id = studentId;
    if (schoolName) patch.school_name = schoolName;

    await chrome.storage.local.set(patch);
    showMessage('保存しました。同期中…', 'text-emerald-600');

    await runSync();
  });

  // ---------------- 疎通確認 ----------------
  testBtn.addEventListener('click', async () => {
    const url = gasUrlInput.value.trim();
    setDiag('info', '疎通確認中…', 'GET ' + (url || '(保存済みURL)') + '?api=wake_check');
    testBtn.disabled = true;

    try {
      const r = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', url: url || '' });
      if (!r) {
        setDiag('ng', '疎通確認に失敗しました', 'バックグラウンドから応答がありません（拡張を読み込み直してください）');
      } else if (r.ok) {
        setDiag('ok', '疎通OK（' + r.ms + 'ms / HTTP ' + r.status + '）',
          'URLと公開範囲は正しいです。\n\n応答: ' + JSON.stringify(r.json || r.head, null, 2));
      } else {
        const detail = [];
        if (r.status) detail.push('HTTP ' + r.status);
        if (r.ms) detail.push(r.ms + 'ms');
        if (r.error) detail.push(r.error);
        detail.push('');
        detail.push('確認ポイント:');
        detail.push('・URLが「/exec」で終わっているか（「/dev」は不可）');
        detail.push('・GAS の「デプロイ」→「アクセスできるユーザー」が');
        detail.push('   「全員」または「全員（匿名ユーザーを含む）」か');
        detail.push('・組織の Google アカウントでログインしているか');
        if (r.head) { detail.push(''); detail.push('応答の先頭: ' + r.head); }
        setDiag('ng', '疎通NG', detail.join('\n'));
      }
    } catch (e) {
      setDiag('ng', '疎通確認に失敗しました', String(e));
    } finally {
      testBtn.disabled = false;
    }
  });

  // ---------------- 手動同期のみ ----------------
  syncBtn.addEventListener('click', async () => {
    showMessage('同期中…', 'text-indigo-700');
    await runSync();
  });

  // ---------------- 診断クリア ----------------
  clearDiagBtn.addEventListener('click', () => {
    setDiag('info', 'まだ同期していません。', '-');
  });

  async function runSync() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' });
      const data = await chrome.storage.local.get(null);
      renderStatus(data);
      await renderCommState();

      const d = (r && r.diag) ? r.diag : {
        ok: data.sync_diag_ok, code: data.sync_diag_code,
        message: data.sync_diag_message, at: data.sync_diag_at
      };

      if (d && d.ok === true) {
        setDiag('ok', '同期に成功しました（' + (d.at || '') + '）',
          '最終同期: ' + (data.last_sync_time || '-') + '\n' + buildSnapshot(data));
        showMessage('同期が完了しました', 'text-emerald-600');
      } else if (d && d.ok === false) {
        setDiag('ng', '同期に失敗しました（' + (d.code || '') + '）',
          (d.message || '') + '\n\n' + buildSnapshot(data));
        showMessage('同期に失敗しました', 'text-rose-600');
      } else {
        setDiag('warn', '同期結果が不明です',
          '失敗理由が記録されていません。「疎通確認」を実行して切り分けてください。\n\n' + buildSnapshot(data));
      }
    } catch (e) {
      setDiag('ng', '同期の呼び出しに失敗しました', String(e));
      showMessage('同期に失敗しました', 'text-rose-600');
    }
  }

  // ---------------- 描画 ----------------
  function renderManagedState(data) {
    // 管理ポリシーが配布されている場合は、その旨をはっきり出す。
    // （直接読み込み版でも、ポリシーが入っていればそちらが優先される）
    try {
      if (chrome.storage && chrome.storage.managed) {
        chrome.storage.managed.get(null, (items) => {
          if (chrome.runtime.lastError || !items) return;
          const hasManaged = !!(
            (items.gas_url && String(items.gas_url).trim()) ||
            (items.gas_url_map && Object.keys(items.gas_url_map || {}).length) ||
            (items.school_name && String(items.school_name).trim())
          );
          if (hasManaged) {
            const box = document.querySelector('.banner.warn');
            if (box) {
              box.className = 'banner ok';
              box.innerHTML = 'この端末には<b>管理ポリシーが配布済み</b>です。' +
                'ポリシーの値が優先されます（下の入力は上書き用）。';
            }
          }
        });
      }
    } catch (e) { /* managed 非対応時は無視 */ }
  }

  function renderStatus(data) {
    el('statusSchool').textContent = data.school_name || '未設定';
    el('statusId').textContent = data.student_id || '(自動取得)';
    el('statusName').textContent = data.student_name
      ? data.student_name + (data.class_name ? ' (' + data.class_name + ')' : '')
      : '-';

    const lock = el('statusLock');
    if (data.screen_lock) {
      lock.textContent = 'ロック中';
      lock.className = 'v text-rose-600';
    } else {
      lock.textContent = '解除';
      lock.className = 'v text-emerald-600';
    }

    const filter = el('statusFilter');
    const mode = (data.filter_mode || 'OFF').toUpperCase();
    filter.textContent = mode;
    filter.className = 'v' + (mode === 'WHITELIST' ? ' text-indigo-700'
      : mode === 'BLACKLIST' ? ' text-amber-700' : '');

    el('statusLastSync').textContent = data.last_sync_time || '未同期';
    el('statusGasUrl').textContent = data.gas_url || '未設定';
    el('statusGasUrl').title = data.gas_url || '';

    const badge = el('connectionBadge');
    if (data.gas_url && data.last_sync_time) {
      badge.textContent = '接続済み';
      badge.className = 'text-10 px-2 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700';
    } else {
      badge.textContent = '未接続';
      badge.className = 'text-10 px-2 py-1 rounded-full font-semibold bg-slate-200 text-slate-600';
    }
  }

  async function renderCommState() {
    // バックグラウンドの実状態（教員コンソール稼働・同期周期・起こし確認の時間帯）を表示する。
    try {
      const r = await chrome.runtime.sendMessage({ type: 'GET_STATUS_FULL' });
      if (!r || !r.ok) throw new Error('no response');
      const s = r.status || {};

      el('statusKa').textContent = s.ka_active ? '稼働中' : '停止中（児童のみ）';
      el('statusKa').className = 'v' + (s.ka_active ? ' text-emerald-600' : ' text-slate-600');

      el('statusInterval').textContent = s.ka_active
        ? (s.sync_interval_sec ? s.sync_interval_sec + ' 秒' : '-')
        : '停止（猶予 ' + Math.max(0, Math.round((s.idle_drift_until - Date.now()) / 1000)) + ' 秒）';

      if (s.probe && s.probe.minutes > 0) {
        el('statusProbe').textContent =
          (s.probe.inDay ? '日中 1 分' : (s.probe.weekend ? '週末 10 分' : (s.probe.holiday ? '祝日 10 分' : '夜間 10 分')));
      } else if (s.ka_active) {
        el('statusProbe').textContent = '不要（稼働中）';
      } else {
        el('statusProbe').textContent = '停止';
      }
    } catch (e) {
      el('statusKa').textContent = '取得できません';
      el('statusInterval').textContent = '-';
      el('statusProbe').textContent = '-';
    }
  }

  function renderDiag(data) {
    const okVal = data.sync_diag_ok;
    if (okVal === true) {
      setDiag('ok', '直近の同期: 成功（' + (data.sync_diag_at || '') + '）',
        '最終同期: ' + (data.last_sync_time || '-') + '\n' + buildSnapshot(data));
    } else if (okVal === false) {
      setDiag('ng', '直近の同期: 失敗（' + (data.sync_diag_code || '') + '）',
        (data.sync_diag_message || '') + '\n\n' + buildSnapshot(data));
    } else {
      setDiag('info', 'まだ同期していません。',
        'GAS WebアプリURLを入力して「保存して同期」を押してください。\n\n' + buildSnapshot(data));
    }
  }

  function buildSnapshot(data) {
    return [
      '--- 端末の状態 ---',
      'GAS URL   : ' + (data.gas_url || '(未設定)'),
      '児童ID    : ' + (data.student_id || '(未設定)'),
      '学校名    : ' + (data.school_name || '(未設定)'),
      '最終同期  : ' + (data.last_sync_time || '(未同期)'),
      '画面ロック: ' + (data.screen_lock ? 'ON' : 'OFF'),
      'URL規制   : ' + ((data.filter_mode || 'OFF') + ''),
      '教員稼働  : ' + (data.keepalive_active ? 'ON' : 'OFF'),
      '同期周期  : ' + (data.keepalive_interval_sec ? data.keepalive_interval_sec + '秒' : '停止')
    ].join('\n');
  }

  function setDiag(kind, title, detail) {
    const badge = el('diagBadge');
    const pre = el('diagDetail');
    badge.className = 'banner ' + (kind === 'ok' ? 'ok' : kind === 'ng' ? 'ng' : 'info');
    badge.textContent = title;
    pre.textContent = detail || '-';
  }

  function showMessage(text, colorClass) {
    msgBox.textContent = text;
    msgBox.className = 'text-center text-11 font-semibold ' + colorClass;
    msgBox.classList.remove('hidden');
    setTimeout(() => { msgBox.classList.add('hidden'); }, 3000);
  }
});
