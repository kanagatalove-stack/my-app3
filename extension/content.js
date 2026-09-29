/**
 * Chromebook 児童端末管理クライアント - Content Script
 * 画面ロックの制御・キーボード/マウス入力の完全無効化
 * Google検索画面・動的SPAサイトの完全カバー & 自動解除対応
 */

(() => {
  let isLocked = false;
  let lockOverlayElement = null;
  let domObserver = null;
  let pollIntervalId = null;

  // 1. 初期化：バックグラウンドへ現在のロック状態を問い合わせ
  chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.screen_lock) {
      applyLockState(true);
    }
  });

  // 2. ストレージ直接監視（更新を押さなくても自動で瞬時に反映）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'screen_lock' in changes) {
      const newLocked = Boolean(changes.screen_lock.newValue);
      applyLockState(newLocked);
    }
  });

  // 3. バックグラウンドからのダイレクト通知受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SET_LOCK_STATE') {
      applyLockState(Boolean(message.locked));
      sendResponse({ status: 'ok' });
    }
  });

  /**
   * ロック状態の適用・解除
   */
  function applyLockState(lock) {
    if (isLocked === lock && document.getElementById('edu-screen-lock-overlay') === !!lock) {
      return;
    }
    isLocked = lock;

    if (lock) {
      showLockOverlay();
      attachInputBlockers();
      startDomProtection();
      startPollSafetyCheck();
    } else {
      hideLockOverlay();
      detachInputBlockers();
      stopDomProtection();
      stopPollSafetyCheck();
    }
  }

  /**
   * ロック用オーバーレイ要素の生成および最前面表示
   * ※ Google検索画面等での body 再置換対策のため document.documentElement に追加
   */
  function showLockOverlay() {
    let overlay = document.getElementById('edu-screen-lock-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'edu-screen-lock-overlay';
      overlay.className = 'edu-lock-overlay';
      overlay.innerHTML = `
        <div class="edu-lock-card">
          <div class="edu-lock-icon-wrap">
            <svg class="edu-lock-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 class="edu-lock-title">画面ロック中</h1>
          <p class="edu-lock-subtitle">先生の話をよく聞きましょう</p>
          <div class="edu-lock-bar"></div>
          <p class="edu-lock-notice">※ 授業の指示があるまで端末の操作はできません</p>
        </div>
      `;
    }

    // Google検索画面などでの body 置換に影響されないよう、最上位の documentElement に直接アタッチ
    const mountTarget = document.documentElement || document.body;
    if (mountTarget && overlay.parentNode !== mountTarget) {
      mountTarget.appendChild(overlay);
    }

    overlay.style.display = 'flex';
    lockOverlayElement = overlay;

    if (document.documentElement) {
      document.documentElement.classList.add('edu-lock-no-scroll');
    }
    if (document.body) {
      document.body.classList.add('edu-lock-no-scroll');
    }

    // Google検索窓などのフォーカスを強制解除
    blurActiveElement();
  }

  /**
   * ロック用オーバーレイの完全消去・画面復帰（リロード不要）
   */
  function hideLockOverlay() {
    const overlays = document.querySelectorAll('#edu-screen-lock-overlay');
    overlays.forEach(el => {
      try { el.remove(); } catch(e) { el.style.display = 'none'; }
    });
    lockOverlayElement = null;

    if (document.documentElement) {
      document.documentElement.classList.remove('edu-lock-no-scroll');
    }
    if (document.body) {
      document.body.classList.remove('edu-lock-no-scroll');
    }
  }

  /**
   * Google検索などの入力欄からフォーカスを奪還
   */
  function blurActiveElement() {
    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    } catch(e) {}
  }

  /**
   * DOM保護：Google検索のSPA遷移やDOM変更でオーバーレイが消去されたら即座に再挿入
   */
  function startDomProtection() {
    stopDomProtection();
    const root = document.documentElement || document.body;
    if (!root) return;

    domObserver = new MutationObserver(() => {
      if (isLocked) {
        const overlay = document.getElementById('edu-screen-lock-overlay');
        const target = document.documentElement || document.body;
        if (!overlay && target) {
          showLockOverlay();
        }
      }
    });

    try {
      domObserver.observe(root, { childList: true, subtree: true });
    } catch(e) {}
  }

  function stopDomProtection() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
  }

  /**
   * セーフティ定期チェック：万一イベントを取りこぼしても、数秒以内に自動で画面が元に戻る
   */
  function startPollSafetyCheck() {
    stopPollSafetyCheck();
    pollIntervalId = setInterval(async () => {
      if (!isLocked) {
        stopPollSafetyCheck();
        return;
      }
      try {
        const data = await chrome.storage.local.get(['screen_lock']);
        if (!data.screen_lock) {
          applyLockState(false);
        }
      } catch(e) {}
    }, 2500);
  }

  function stopPollSafetyCheck() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  /**
   * 入力遮断イベントハンドラ（Google検索・キー入力・クリック等の完全遮断）
   */
  function blockEvent(e) {
    if (!isLocked) return;
    blurActiveElement();
    e.stopImmediatePropagation();
    e.preventDefault();
    return false;
  }

  const BLOCK_EVENTS = [
    'keydown', 'keyup', 'keypress',
    'mousedown', 'mouseup', 'click', 'dblclick',
    'pointerdown', 'pointerup',
    'touchstart', 'touchend',
    'contextmenu', 'wheel'
  ];

  function attachInputBlockers() {
    BLOCK_EVENTS.forEach(ev => {
      window.addEventListener(ev, blockEvent, true);
    });
  }

  function detachInputBlockers() {
    BLOCK_EVENTS.forEach(ev => {
      window.removeEventListener(ev, blockEvent, true);
    });
  }

})();
