/**
 * Chromebook 児童端末管理クライアント - 専用ロック画面スクリプト
 * 拡張機能の Manifest V3 CSP（'self' のみ許可）に対応するため外部JS化。
 * ・児童アカウント表示
 * ・ロック解除の自動検知 → 元画面へ自動復帰（リロード不要）
 * ・右クリック / 左クリック / キー操作の完全無効化
 */

(function () {
  'use strict';

  // ==================== 児童アカウント表示 ====================
  try {
    chrome.storage.local.get(['student_id', 'student_name'], (data) => {
      const label = document.getElementById('accountLabel');
      if (!label) return;
      if (data && data.student_id) {
        label.textContent = `${data.student_name ? data.student_name + ' | ' : ''}${data.student_id}`;
      } else {
        label.textContent = '児童アカウント連携中...';
      }
    });
  } catch (e) {}

  // ==================== ロック解除の自動検知 ====================
  // background.js が全タブを lock.html へ差し替える際、元のURLを ?url= に保持している。
  // 解除時は元のURLへ確実に復帰させる（保持がない場合は履歴を戻す）。
  const params = new URLSearchParams(window.location.search);
  const originalUrl = params.get('url') || '';

  let restored = false;

  function restoreScreen() {
    if (restored) return;
    restored = true;
    if (originalUrl && /^https?:\/\//i.test(originalUrl)) {
      window.location.replace(originalUrl);
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  }

  // 1. ストレージ変更の監視（ロックが解除されたら自動で閉じる/戻る）
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'screen_lock' in changes) {
        if (!changes.screen_lock.newValue) {
          restoreScreen();
        }
      }
    });
  } catch (e) {}

  // 2. バックグラウンドからの直接通知
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'SET_LOCK_STATE' && !message.locked) {
        restoreScreen();
      }
      if (sendResponse) sendResponse({ status: 'ok' });
    });
  } catch (e) {}

  // 3. フェイルセーフ定期チェック（イベント取りこぼし対策）
  setInterval(async () => {
    try {
      const data = await chrome.storage.local.get(['screen_lock']);
      if (!data.screen_lock) {
        restoreScreen();
      }
    } catch (e) {}
  }, 1500);

  // 4. Service Worker キープアライブ
  //    ロック画面を表示している間も SW を起こし続け、ロック解除の指示を数秒以内に受け取る。
  //    ※ 教員コンソールにログイン中（keepalive_active=true）のときだけ送信する。
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }, () => { void chrome.runtime.lastError; });
    } catch (e) {}
  }, 1500);

  // 初回チェック
  (async () => {
    try {
      const data = await chrome.storage.local.get(['screen_lock']);
      if (!data.screen_lock) restoreScreen();
    } catch (e) {}
  })();

  // ==================== 入力の完全遮断（右クリック・左クリック含む） ====================
  const BLOCK_EVENTS = [
    'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
    'pointerdown', 'pointerup', 'pointermove',
    'touchstart', 'touchend', 'touchmove',
    'keydown', 'keyup', 'keypress',
    'wheel', 'dragstart', 'selectstart'
  ];

  function blockEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  BLOCK_EVENTS.forEach(ev => {
    window.addEventListener(ev, blockEvent, true);
    document.addEventListener(ev, blockEvent, true);
  });

  // ドラッグ・コピー・選択の抑止
  document.addEventListener('copy', blockEvent, true);
  document.addEventListener('cut', blockEvent, true);
  document.addEventListener('dragstart', blockEvent, true);
})();
