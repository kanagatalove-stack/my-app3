/**
 * 拡張機能 ポップアップ設定スクリプト
 */

document.addEventListener('DOMContentLoaded', async () => {
  const studentIdInput = document.getElementById('studentIdInput');
  const gasUrlInput = document.getElementById('gasUrlInput');
  const saveBtn = document.getElementById('saveBtn');
  const syncBtn = document.getElementById('syncBtn');
  const msgBox = document.getElementById('msgBox');

  // ストレージから現在の設定を読み出し
  const data = await chrome.storage.local.get([
    'student_id',
    'gas_url',
    'screen_lock',
    'filter_mode',
    'last_sync_time',
    'school_name',
    'student_name',
    'class_name',
    'google_account'
  ]);

  if (data.student_id) studentIdInput.value = data.student_id;
  if (data.gas_url) gasUrlInput.value = data.gas_url;

  // 管理ポリシー（Managed Storage）が配布されているか確認し、
  // 配布済み＝児童は設定不要であることを明示する。
  await reflectManagedState();

  updateStatusUI(data);

  // 保存ボタン
  saveBtn.addEventListener('click', async () => {
    const studentId = studentIdInput.value.trim();
    const gasUrl = gasUrlInput.value.trim();

    if (!studentId) {
      showMessage('児童IDを入力してください', 'text-rose-600');
      return;
    }

    await chrome.storage.local.set({
      student_id: studentId,
      gas_url: gasUrl
    });

    showMessage('設定を保存しました。同期中...', 'text-emerald-600');

    // 保存後に即時同期トリガー
    await triggerSync();
  });

  // 手動同期ボタン
  syncBtn.addEventListener('click', async () => {
    showMessage('同期中...', 'text-indigo-600');
    await triggerSync();
  });

  /**
   * 管理ポリシー（Managed Storage）の適用状況をUIへ反映する。
   * ポリシーが配布済み（gas_url / gas_url_map / school_name のいずれか）なら、
   * 「児童は設定不要（自動構成）」であることをバナーで明示し、手動設定は折りたたむ。
   */
  async function reflectManagedState() {
    const banner = document.getElementById('autoBanner');
    const details = document.getElementById('manualSettings');
    let managed = {};
    try {
      if (chrome.storage && chrome.storage.managed) {
        managed = await new Promise((resolve) => {
          chrome.storage.managed.get(null, (items) => {
            if (chrome.runtime.lastError || !items) resolve({});
            else resolve(items);
          });
        });
      }
    } catch (e) {
      managed = {};
    }

    const hasManaged = !!(managed && (
      (managed.gas_url && String(managed.gas_url).trim()) ||
      (managed.gas_url_map && Object.keys(managed.gas_url_map || {}).length) ||
      (managed.school_name && String(managed.school_name).trim())
    ));

    if (banner) {
      if (hasManaged) {
        banner.className = 'banner ok';
        banner.innerHTML = '✅ この端末は管理者の設定により<b>自動構成</b>されています。児童の操作は不要です。';
      } else {
        banner.className = 'banner info';
        banner.innerHTML = 'ℹ️ 管理ポリシーが未配布です。通常は管理者が配布します（手動設定は下記）。';
      }
    }

    // ポリシー配布済みなら手動設定は閉じておく（児童の誤操作防止）
    if (details && hasManaged) details.open = false;
  }

  // ステータス表示の更新
  function updateStatusUI(info) {
    const statusSchool = document.getElementById('statusSchool');
    const statusId = document.getElementById('statusId');
    const statusName = document.getElementById('statusName');
    const statusLock = document.getElementById('statusLock');
    const statusFilter = document.getElementById('statusFilter');
    const statusLastSync = document.getElementById('statusLastSync');
    const connectionBadge = document.getElementById('connectionBadge');
    const autoBadge = document.getElementById('autoDetectedBadge');

    if (statusSchool) statusSchool.textContent = info.school_name || '未設定';
    if (statusId) statusId.textContent = info.student_id || '-';
    if (statusName) statusName.textContent = info.student_name ? `${info.student_name} (${info.class_name || ''})` : '-';

    if (autoBadge && info.student_id && info.student_id.includes('@')) {
      autoBadge.classList.remove('hidden');
    }

    if (info.screen_lock) {
      statusLock.textContent = '🔒 ロック中';
      statusLock.className = 'font-bold text-rose-600';
    } else {
      statusLock.textContent = '🔓 解除中';
      statusLock.className = 'font-bold text-emerald-600';
    }

    statusFilter.textContent = info.filter_mode || 'OFF';
    if (info.filter_mode === 'WHITELIST') {
      statusFilter.className = 'font-bold text-blue-600';
    } else if (info.filter_mode === 'BLACKLIST') {
      statusFilter.className = 'font-bold text-amber-600';
    } else {
      statusFilter.className = 'font-bold text-slate-600';
    }

    statusLastSync.textContent = info.last_sync_time || '未同期';

    if (info.gas_url && info.last_sync_time) {
      connectionBadge.textContent = '接続済み';
      connectionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700';
    } else {
      connectionBadge.textContent = '未接続';
      connectionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-200 text-slate-600';
    }
  }

  // 同期トリガー
  async function triggerSync() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' });
      // ストレージの最新状態を取得してUIを更新
      const updated = await chrome.storage.local.get(null);
      updateStatusUI(updated);
      showMessage('同期が完了しました', 'text-emerald-600');
    } catch (e) {
      const updated = await chrome.storage.local.get(null);
      updateStatusUI(updated);
      showMessage('同期トリガー送信完了', 'text-indigo-600');
    }
  }

  function showMessage(text, colorClass) {
    msgBox.textContent = text;
    msgBox.className = `text-center text-[11px] font-semibold ${colorClass}`;
    msgBox.classList.remove('hidden');
    setTimeout(() => {
      msgBox.classList.add('hidden');
    }, 3000);
  }
});
