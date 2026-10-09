/**
 * Chromebook 児童端末管理クライアント - URL規制ブロック画面スクリプト
 * 拡張機能の Manifest V3 CSP（'self' のみ許可）に対応するため外部JS化。
 * ・ブロック対象URL / 規制モードの表示
 * ・規制が解除されたら元の画面へ自動復帰（リロード不要）
 * ・右クリック / 左クリック / キー操作の完全無効化
 */

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const originalUrl = params.get('url') || '';
  const mode = (params.get('mode') || 'RESTRICTED').toUpperCase();

  // ==================== ブロック情報の表示 ====================
  const urlEl = document.getElementById('blockedUrl');
  if (urlEl) {
    urlEl.textContent = originalUrl || 'URL情報なし';
    urlEl.title = originalUrl;
  }

  let modeText = 'URL制限';
  if (mode === 'WHITELIST') modeText = '許可リスト制限（指定外Webサイト）';
  if (mode === 'BLACKLIST') modeText = '規制リスト制限（禁止Webサイト）';
  const modeEl = document.getElementById('filterMode');
  if (modeEl) modeEl.textContent = modeText;

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

  // ==================== 規制判定（background.js と同一ロジック） ====================
  function evaluateUrlRestriction(rawUrl, mode, whitelist, blacklist) {
    if (!rawUrl) return false;
    if (rawUrl.startsWith('chrome://') ||
        rawUrl.startsWith('chrome-extension://') ||
        rawUrl.startsWith('about:') ||
        rawUrl.includes('script.google.com') ||
        rawUrl.includes('accounts.google.com')) {
      return false;
    }

    let hostname = '';
    try {
      hostname = new URL(rawUrl).hostname.toLowerCase();
    } catch (e) {
      return false;
    }

    if (mode === 'WHITELIST') {
      if (!whitelist || whitelist.length === 0) return true;
      const isAllowed = whitelist.some(item => {
        const target = String(item).trim().toLowerCase();
        if (!target) return false;
        return hostname === target || hostname.endsWith('.' + target) || rawUrl.toLowerCase().includes(target);
      });
      return !isAllowed;
    }

    if (mode === 'BLACKLIST') {
      if (!blacklist || blacklist.length === 0) return false;
      const isDenied = blacklist.some(item => {
        const target = String(item).trim().toLowerCase();
        if (!target) return false;
        return hostname === target || hostname.endsWith('.' + target) || rawUrl.toLowerCase().includes(target);
      });
      return isDenied;
    }

    return false;
  }

  // ==================== 自動復帰 ====================
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

  async function checkAndRestore() {
    try {
      const data = await chrome.storage.local.get(['filter_mode', 'whitelist_urls', 'blacklist_urls']);
      const curMode = String(data.filter_mode || 'OFF').toUpperCase();

      // 1. 規制モードが OFF になったら即座に復帰
      if (curMode === 'OFF') {
        restoreScreen();
        return;
      }

      // 2. ブロック対象URLが現行の規制対象から外れたら復帰
      if (originalUrl) {
        const stillBlocked = evaluateUrlRestriction(
          originalUrl,
          curMode,
          Array.isArray(data.whitelist_urls) ? data.whitelist_urls : [],
          Array.isArray(data.blacklist_urls) ? data.blacklist_urls : []
        );
        if (!stillBlocked) {
          restoreScreen();
        }
      }
    } catch (e) {}
  }

  // ストレージ変更（規制モード・リスト変更）を検知して即時復帰
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' &&
          ('filter_mode' in changes || 'whitelist_urls' in changes || 'blacklist_urls' in changes)) {
        checkAndRestore();
      }
    });
  } catch (e) {}

  // フェイルセーフ定期チェック
  setInterval(checkAndRestore, 1500);
  checkAndRestore();

  // Service Worker キープアライブ
  //  ブロック画面を表示している間も SW を起こし続け、規制解除の指示を数秒以内に受け取る。
  //  ※ 教員コンソールにログイン中（keepalive_active=true）のときだけ送信する。
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }, () => { void chrome.runtime.lastError; });
    } catch (e) {}
  }, 1500);

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

  document.addEventListener('copy', blockEvent, true);
  document.addEventListener('cut', blockEvent, true);
})();
