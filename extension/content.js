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

  // 4. Service Worker キープアライブ（教員の指示を3秒以内に反映するための要）
  //    MV3 の Service Worker は約30秒の無操作で停止し、その間は教員の指示
  //    （画面ロック／ロック解除／URL規制／一斉配信）を受け取れない。
  //    各タブの最上位フレームから短周期で ping を送り、SW を起こして同期させることで、
  //    指示が「数十秒後」ではなく「数秒以内」に確実に反映される。
  //    ※ 教員コンソールにログイン中（keepalive_active=true）のときだけ送信する。
  //      ログアウト後は ping を止め、SW を無駄に起動しない（通信負担の低減）。
  if (window.top === window) {
    // ※ ping はローカルIPC（ネットワーク通信ではない）ため常時送る。
    //    ネットワーク同期（doPost）の間隔は SW 側の maybeSync が
    //    「稼働中=1.5秒／非稼働=15秒」で制御する（非稼働時は doPost しない）。
    //    常時 ping にすることで、教員ログイン直後でも約1.5秒で稼働を検知できる。
    setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }, () => { void chrome.runtime.lastError; });
      } catch (e) {}
    }, 1500);
  }

  // 5. 教員コンソール（GAS管理画面）からのセッション通知を SW へ中継する。
  //    コンソールは拡張APIを直接呼べないため window.postMessage → content script → SW と中継する。
  try {
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'EDU_KEEPALIVE_START') {
        try { chrome.runtime.sendMessage({ type: 'KEEPALIVE_START', session_id: d.session_id || '' }, () => { void chrome.runtime.lastError; }); } catch (e) {}
      } else if (d.type === 'EDU_KEEPALIVE_STOP') {
        try { chrome.runtime.sendMessage({ type: 'KEEPALIVE_STOP', session_id: d.session_id || '' }, () => { void chrome.runtime.lastError; }); } catch (e) {}
      }
    });
  } catch (e) {}

  /**
   * ロック状態の適用・解除
   */
  function applyLockState(lock) {
    // 専用ロック画面(lock.html)自身にはオーバーレイを重ねない。
    // ・background がタブを lock.html へ差し替える方式と、content.js がオーバーレイを
    //   重ねる方式が同時に走ると、ロック画面とオーバーレイが交互に表示されて
    //   「消えたり出たり」するちらつきの原因になるため、ロック画面では常に無効化する。
    if (isDedicatedLockPage()) {
      if (isLocked) {
        isLocked = false;
        hideLockOverlay();
        detachInputBlockers();
        stopDomProtection();
        stopGeminiProtection();
        stopPollSafetyCheck();
      }
      return;
    }

    // 状態が変わっていない場合は多重実行しない。
    //  （onChanged と SET_LOCK_STATE メッセージがほぼ同時に届くため、
    //    ここで弾かないと入力遮断リスナが二重登録され、オーバーレイ予約も都度リセットされる）
    if (isLocked === lock) {
      // ロック中にオーバーレイが何らかの理由で消えている場合のみ再表示を予約する。
      if (lock && !document.getElementById('edu-screen-lock-overlay')) {
        scheduleLockOverlay();
      }
      return;
    }
    isLocked = lock;

    if (lock) {
      // 入力遮断・Gemini抑止は即時（操作させない）
      attachInputBlockers();
      startGeminiProtection();
      startPollSafetyCheck();
      // オーバーレイ表示は「最後の保険」としてのみ、十分な猶予後に表示する。
      //  background がタブを専用ロック画面(lock.html)へ差し替えるのが通常経路であり、
      //  ローカルの拡張機能リソースへの差し替えは通常 100ms 未満で完了するため、
      //  猶予内に差し替わればオーバーレイは一切表示されない（＝ロック画面のちらつきを防止）。
      //  差し替えが何らかの理由で完了しない場合にのみ、猶予後にオーバーレイを表示する。
      scheduleLockOverlay();
    } else {
      clearLockOverlayTimer();
      hideLockOverlay();
      detachInputBlockers();
      stopDomProtection();
      stopGeminiProtection();
      stopPollSafetyCheck();
    }
  }

  // オーバーレイ表示までの猶予（ミリ秒）。background のロック画面差し替えを優先する。
  // ローカルの拡張機能リソース(lock.html)への差し替えは通常 1秒以内に完了するため、
  // 猶予内に差し替わればオーバーレイは一切描画されない（＝ちらつきゼロ）。
  // 差し替えが間に合わない場合のみ、この猶予後にオーバーレイを「保険」として表示する。
  const LOCK_OVERLAY_GRACE_MS = 1500;
  let lockOverlayTimer = null;

  function scheduleLockOverlay() {
    clearLockOverlayTimer();
    if (document.getElementById('edu-screen-lock-overlay')) {
      startDomProtection();
      return;
    }
    lockOverlayTimer = setTimeout(() => {
      lockOverlayTimer = null;
      if (!isLocked || isDedicatedLockPage()) return;
      showLockOverlay();
      startDomProtection();
    }, LOCK_OVERLAY_GRACE_MS);
  }

  // ページ離脱（ロック画面への差し替え等）が始まったら、予約中のオーバーレイ表示を必ず取り消す。
  // これにより「通常ページにオーバーレイが一瞬出る → 直後にロック画面へ差し替わる」
  // というチラつき（消えたり出たりする現象）を根本的に防止する。
  window.addEventListener('pagehide', clearLockOverlayTimer, true);
  window.addEventListener('beforeunload', clearLockOverlayTimer, true);

  function clearLockOverlayTimer() {
    if (lockOverlayTimer) {
      clearTimeout(lockOverlayTimer);
      lockOverlayTimer = null;
    }
  }

  /**
   * 拡張機能の専用ロック画面(lock.html)上かどうかを判定する。
   * この画面自体がロック演出を描画するため、オーバーレイ/入力遮断は不要。
   */
  function isDedicatedLockPage() {
    try {
      const url = location.href || '';
      if (url.indexOf('lock.html') !== -1) return true;
      // ロック画面はロックカード（.lock-card）を持つことで識別できる
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const lockUrl = chrome.runtime.getURL('lock.html');
        if (url.indexOf(lockUrl) === 0) return true;
      }
    } catch (e) {}
    return false;
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
          <p class="edu-lock-notice">※ 授業の指示があるまで、端末の操作はできません。</p>
          <div class="edu-lock-instructions">
            <div class="edu-lock-instructions-title">先生からの指示</div>
            <ul>
              <li>先生の話を最後まで静かに聞きましょう。</li>
              <li>キーボード・マウス・タッチ操作はできません。</li>
              <li>先生がロックを解除すると、この画面は自動的に消えます。</li>
            </ul>
          </div>
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
   * Gemini保護：
   *  ロック中は「Geminiに相談」ボタンや「Gemini in Chrome」等のGoogle生成AI関連UIを
   *  完全に無効化（非表示＋操作不可）する。表示されてもクリック・キー操作は遮断される。
   *  - documentElement に edu-lock-no-gemini クラスを付与しCSSで非表示化
   *  - マウスが近づいてもクリックできないよう pointer-events を無効化
   *  - MutationObserver でSPA再描画後も再適用
   */
  let geminiObserver = null;
  let geminiIntervalId = null;

  // Gemini関連UIを検出するための複合セレクタ（属性ベースのみ）。
  // ※ 全DOMを走査して textContent を読む方式は重いSPA（スプレッドシート等）を
  //    ハングさせる恐れがあるため採用しない。属性セレクタの一括問い合わせに限定する。
  const GEMINI_MATCH_SELECTOR = [
    '[data-test-id*="gemini" i]',
    '[data-testid*="gemini" i]',
    '[id*="gemini" i]',
    '[class*="gemini" i]',
    '[aria-label*="gemini" i]',
    '[aria-label*="ジェミニ"]',
    '[aria-label*="AI モード"]',
    '[aria-label*="AIモード"]',
    '[title*="gemini" i]',
    '[jsname*="gemini" i]',
    '[jsname*="aimode" i]',
    '[data-test-id*="ai-mode" i]',
    '[data-testid*="ai-mode" i]',
    'gemini-app',
    'ai-mode-button'
  ].join(',');

  // 抑止対象の追跡（解除時に元へ戻すため）
  let suppressedNodes = new Set();
  let applyingGemini = false;
  // クリック遮断ガードの多重登録防止
  let geminiClickGuardAttached = false;

  // 要素の属性値（クラス・aria-label等）に Gemini / AIモード 関連語が含まれるか
  // ※ textContent は読まない（重いSPAをハングさせる原因になるため）。属性のみで判定。
  function isGeminiNode(el) {
    if (!el || el.nodeType !== 1) return false;
    // ロックオーバーレイ自身とその内部は対象外
    if (el.id === 'edu-screen-lock-overlay') return false;
    if (el.closest && el.closest('#edu-screen-lock-overlay')) return false;

    // 複合属性セレクタで一括判定（高速）
    try {
      if (el.matches && el.matches(GEMINI_MATCH_SELECTOR)) return true;
    } catch (e) {}

    // 祖先の aria-label / title などにキーワードが含まれるボタンを検出
    const attr = [
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-test-id'),
      el.getAttribute && el.getAttribute('data-testid'),
      el.getAttribute && el.getAttribute('jsname')
    ].filter(Boolean).join(' ').toLowerCase();
    if (attr) {
      if (attr.includes('gemini') || attr.includes('ジェミニ') ||
          attr.includes('ai-mode') || attr.includes('ai_mode') || attr.includes('aimode') ||
          attr.includes('ai モード') || attr.includes('aiモード')) {
        return true;
      }
    }
    return false;
  }

  function suppressElement(el) {
    if (!el || el.nodeType !== 1) return;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('tabindex', '-1');
    suppressedNodes.add(el);
  }

  function applyGeminiSuppression() {
    if (!isLocked || applyingGemini) return;
    applyingGemini = true;
    try {
      // 1. CSSクラスによる一括非表示（宣言済み content.css のルールが効く）
      if (document.documentElement) {
        document.documentElement.classList.add('edu-lock-no-gemini');
      }
      if (document.body) {
        document.body.classList.add('edu-lock-no-gemini');
      }

      // 2. 属性ベースの複合セレクタで一括検出（全DOM走査しないため高速）
      let nodes = [];
      try { nodes = document.querySelectorAll(GEMINI_MATCH_SELECTOR); } catch (e) { nodes = []; }
      nodes.forEach(suppressElement);

      // 3. 限定的な属性スキャン（難読化対策）：クリック可能要素のみを対象に、
      //    各要素の属性だけを見る（textContent は読まない）。
      let candidates = [];
      try {
        candidates = document.querySelectorAll(
          'button, a[role="button"], [role="button"], [role="tab"], [role="menuitem"], gemini-app, ai-mode-button'
        );
      } catch (e) { candidates = []; }
      candidates.forEach(el => {
        if (isGeminiNode(el)) suppressElement(el);
      });

      blurActiveElement();
    } finally {
      applyingGemini = false;
    }
  }

  /**
   * ロック中に Gemini / AIモード 関連の要素がクリックされた場合、
   * キャプチャ段階でその操作を完全に遮断する（閉じたshadow DOM内のボタン対策）。
   */
  function geminiClickGuard(e) {
    if (!isLocked) return;
    const path = (e.composedPath && e.composedPath()) || [];
    for (const node of path) {
      if (node === document || node === window) continue;
      if (node.nodeType === 1 && isGeminiNode(node)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return false;
      }
    }
  }

  function attachGeminiClickGuard() {
    if (geminiClickGuardAttached) return;
    geminiClickGuardAttached = true;
    ['click', 'mousedown', 'pointerdown', 'keydown'].forEach(ev => {
      document.addEventListener(ev, geminiClickGuard, true);
    });
  }

  function detachGeminiClickGuard() {
    if (!geminiClickGuardAttached) return;
    geminiClickGuardAttached = false;
    ['click', 'mousedown', 'pointerdown', 'keydown'].forEach(ev => {
      document.removeEventListener(ev, geminiClickGuard, true);
    });
  }

  // MutationObserver からの多重スキャンを防ぐデバウンス
  let geminiDebounceTimer = null;
  function scheduleGeminiScan() {
    if (!isLocked) return;
    if (geminiDebounceTimer) return;
    geminiDebounceTimer = setTimeout(() => {
      geminiDebounceTimer = null;
      applyGeminiSuppression();
    }, 150);
  }

  function startGeminiProtection() {
    stopGeminiProtection();
    applyGeminiSuppression();
    attachGeminiClickGuard();

    // SPAの再描画でGeminiボタンが復活しても再抑止（デバウンス付き）
    const root = document.documentElement || document.body;
    if (root) {
      geminiObserver = new MutationObserver(() => {
        if (isLocked) scheduleGeminiScan();
      });
      try {
        geminiObserver.observe(root, { childList: true, subtree: true });
      } catch (e) {}
    }

    // フェイルセーフ定期チェック
    geminiIntervalId = setInterval(() => {
      if (!isLocked) {
        stopGeminiProtection();
        return;
      }
      applyGeminiSuppression();
    }, 2000);
  }

  function stopGeminiProtection() {
    if (geminiObserver) {
      geminiObserver.disconnect();
      geminiObserver = null;
    }
    if (geminiIntervalId) {
      clearInterval(geminiIntervalId);
      geminiIntervalId = null;
    }
    if (geminiDebounceTimer) {
      clearTimeout(geminiDebounceTimer);
      geminiDebounceTimer = null;
    }
    detachGeminiClickGuard();
    if (document.documentElement) {
      document.documentElement.classList.remove('edu-lock-no-gemini');
    }
    if (document.body) {
      document.body.classList.remove('edu-lock-no-gemini');
    }
    // 直接適用したインラインスタイルをすべて解除（追跡済みノード＋複合セレクタ）
    suppressedNodes.forEach(el => {
      if (!el || !el.style) return;
      try {
        el.style.removeProperty('display');
        el.style.removeProperty('visibility');
        el.style.removeProperty('pointer-events');
        el.removeAttribute('aria-hidden');
        el.removeAttribute('tabindex');
      } catch (e) {}
    });
    suppressedNodes.clear();

    let nodes = [];
    try { nodes = document.querySelectorAll(GEMINI_MATCH_SELECTOR); } catch (e) { nodes = []; }
    nodes.forEach(el => {
      if (!el || !el.style) return;
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('pointer-events');
      el.removeAttribute('aria-hidden');
      el.removeAttribute('tabindex');
    });
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
   * 入力遮断イベントハンドラ（Google検索・キー入力・左/右クリック等の完全遮断）
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
    'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
    'pointerdown', 'pointerup',
    'touchstart', 'touchend',
    'contextmenu', 'wheel', 'dragstart', 'dragend', 'dragover', 'drop',
    'selectstart', 'copy', 'cut', 'paste'
  ];

  // スタイル経由でも選択・ドラッグ・タッチ操作を禁止（イベントをすり抜けた場合の保険）
  let guardStyleEl = null;
  function applyInputGuardStyles() {
    if (!guardStyleEl) {
      guardStyleEl = document.createElement('style');
      guardStyleEl.id = 'edu-lock-input-guard';
      guardStyleEl.textContent = `
        html.edu-lock-no-scroll *, html.edu-lock-no-scroll *::before, html.edu-lock-no-scroll *::after {
          -webkit-user-drag: none !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          touch-action: none !important;
          -webkit-touch-callout: none !important;
        }
      `;
    }
    const root = document.documentElement || document.body;
    if (root && !document.getElementById('edu-lock-input-guard')) {
      root.appendChild(guardStyleEl);
    }
  }

  function removeInputGuardStyles() {
    const el = document.getElementById('edu-lock-input-guard');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function attachInputBlockers() {
    BLOCK_EVENTS.forEach(ev => {
      window.addEventListener(ev, blockEvent, true);
      document.addEventListener(ev, blockEvent, true);
    });
    applyInputGuardStyles();
  }

  function detachInputBlockers() {
    BLOCK_EVENTS.forEach(ev => {
      window.removeEventListener(ev, blockEvent, true);
      document.removeEventListener(ev, blockEvent, true);
    });
    removeInputGuardStyles();
  }

})();
