/**
 * Chromebook 児童端末管理クライアント - Background Service Worker (Manifest V3)
 * ・児童Googleアカウントの自動検出 & 自動同期
 * ・管理コンソール (Managed Storage) ポリシー対応
 * ・Google検索画面 & 特殊タブの確実なロック
 * ・ロック解除の全タブ高速反映
 */

// デフォルト設定
const DEFAULT_CONFIG = {
  student_id: '',
  gas_url: '', // 管理コンソールまたはpopupまたは教員画面で指定
  screen_lock: false,
  filter_mode: 'OFF', // 'OFF' | 'WHITELIST' | 'BLACKLIST'
  whitelist_urls: ['nhk.or.jp', 'scratch.mit.edu', 'google.com'],
  blacklist_urls: ['youtube.com', 'twitter.com', 'tiktok.com', 'instagram.com'],
  last_broadcast_id: '',
  last_sync_time: null
};

// 拡張機能インストール時の初期化 & 即時同期
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[EduAgent] 拡張機能がインストール/更新されました:', details.reason);
  await initializeClient();
});

// ブラウザ起動時の初期化 & 即時同期
chrome.runtime.onStartup.addListener(async () => {
  console.log('[EduAgent] ブラウザが起動しました');
  await initializeClient();
});

// 定期アラームの受信
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncAlarm') {
    syncWithGas();
  }
});

// 高速定期タイマー（アクティブ時のハートビート）
// ※ 教員による画面ロック/ロック解除/URL規制の指示を児童端末へ素早く反映するため短周期化
let syncInterval = 1500;
setInterval(() => {
  syncWithGas();
}, syncInterval);

// 管理コンソールからのポリシー変更検知 (chrome.storage.managed の動的更新)
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'managed') {
      console.log('[EduAgent] 管理コンソールからのポリシー更新を受信しました');
      await initializeClient();
    }
  });
}

/**
 * 端末クライアントの初期化処理
 * Googleアカウントの自動検出・Managedポリシー適用・即時自動同期
 */
async function initializeClient() {
  try {
    const stored = await chrome.storage.local.get(null);
    const managed = await getManagedPolicy();
    const googleAccount = await getStudentIdentity();

    // 児童IDの決定優先度:
    // 1. 管理コンソールポリシー指定（${USER_EMAIL} マクロ または 直接指定）
    // 2. Chromebookログイン中のGoogleアカウント（chrome.identity）
    // 3. 既存の保存ID
    // 4. ランダム生成ID
    let studentId = stored.student_id || '';
    if (managed.student_id && managed.student_id.trim() && managed.student_id.trim() !== '${USER_EMAIL}') {
      studentId = managed.student_id.trim();
    } else if (googleAccount) {
      studentId = googleAccount;
    } else if (!studentId) {
      studentId = 'student_' + Math.random().toString(36).substring(2, 8);
    }

    // GAS WebアプリURLの決定優先度:
    // 1. 管理コンソールポリシー指定
    // 2. 既存の保存URL
    let gasUrl = stored.gas_url || '';
    if (managed.gas_url && managed.gas_url.trim()) {
      gasUrl = managed.gas_url.trim();
    }

    const initialData = {
      ...DEFAULT_CONFIG,
      ...stored,
      student_id: studentId,
      gas_url: gasUrl,
      google_account: googleAccount || ''
    };

    if (managed.school_name && !initialData.school_name) {
      initialData.school_name = managed.school_name;
    }

    await chrome.storage.local.set(initialData);

    // 定期アラームの登録
    chrome.alarms.create('syncAlarm', { periodInMinutes: 0.16 }); // 約10秒

    console.log(`[EduAgent] 児童端末セットアップ完了 (児童ID: ${studentId})`);

    // GAS URLが設定されていれば即座に自動同期を実行！
    if (gasUrl) {
      await syncWithGas();
    }
  } catch (err) {
    console.error('[EduAgent] 初期化エラー:', err);
  }
}

/**
 * Google アカウントの自動取得 (chrome.identity)
 */
async function getStudentIdentity() {
  return new Promise((resolve) => {
    if (chrome.identity && chrome.identity.getProfileUserInfo) {
      chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
        if (chrome.runtime.lastError || !userInfo || !userInfo.email) {
          resolve(null);
        } else {
          resolve(userInfo.email.trim().toLowerCase());
        }
      });
    } else {
      resolve(null);
    }
  });
}

/**
 * Google 管理コンソールからの配布ポリシー取得 (chrome.storage.managed)
 */
async function getManagedPolicy() {
  return new Promise((resolve) => {
    if (chrome.storage && chrome.storage.managed) {
      chrome.storage.managed.get(null, (items) => {
        if (chrome.runtime.lastError || !items) {
          resolve({});
        } else {
          resolve(items);
        }
      });
    } else {
      resolve({});
    }
  });
}

/**
 * GASとのハートビート・ポリシー同期
 */
async function syncWithGas() {
  try {
    const data = await chrome.storage.local.get(null);
    const gasUrl = data.gas_url;
    let studentId = data.student_id;

    // もし student_id が未設定の場合、Googleアカウントの再検出を試みる
    if (!studentId) {
      const email = await getStudentIdentity();
      if (email) {
        studentId = email;
        await chrome.storage.local.set({ student_id: email });
      }
    }

    // もし gas_url が未設定の場合、managed storage を再確認
    let effectiveGasUrl = gasUrl;
    if (!effectiveGasUrl) {
      const managed = await getManagedPolicy();
      if (managed.gas_url) {
        effectiveGasUrl = managed.gas_url;
        await chrome.storage.local.set({ gas_url: effectiveGasUrl });
      }
    }

    if (!effectiveGasUrl || !studentId) {
      // GAS URL または 児童ID が未設定の場合は同期不可
      return;
    }

    // 現在のアクティブタブのURLを取得
    const currentUrl = await getActiveTabUrl();

    // GASへPOSTリクエスト
    const payload = {
      action: 'heartbeat',
      student_id: studentId,
      current_url: currentUrl
    };

    const response = await fetch(effectiveGasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // GAS Web App のCORS制約対策
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    if (!response.ok) {
      console.warn('[EduAgent] GASレスポンスエラー:', response.status);
      return;
    }

    const resJson = await response.json();
    if (!resJson.success) {
      console.warn('[EduAgent] 同期エラー:', resJson.error);
      return;
    }

    // 最新ポリシーの反映
    await applyPolicies(resJson, data);

  } catch (err) {
    console.error('[EduAgent] 通信エラー:', err);
  }
}

/**
 * 取得したポリシーの適用
 */
async function applyPolicies(newPolicy, oldStorage) {
  const updates = {
    last_sync_time: new Date().toLocaleTimeString(),
    school_name: newPolicy.school_name || oldStorage.school_name || '未設定',
    student_name: newPolicy.student_name || oldStorage.student_name || '',
    class_name: newPolicy.class_name || oldStorage.class_name || '',
    screen_lock: Boolean(newPolicy.screen_lock),
    filter_mode: (newPolicy.filter_mode || 'OFF').toUpperCase(),
    whitelist_urls: Array.isArray(newPolicy.whitelist_urls) ? newPolicy.whitelist_urls : oldStorage.whitelist_urls,
    blacklist_urls: Array.isArray(newPolicy.blacklist_urls) ? newPolicy.blacklist_urls : oldStorage.blacklist_urls
  };

  // 1. 画面ロック状態の適用
  // ストレージ保存（content.js の chrome.storage.onChanged が全タブで自動発火しリロード不要で即解除）
  await chrome.storage.local.set(updates);

  // 直接メッセージでも念のため全タブに通知
  notifyAllTabsLockState(updates.screen_lock);

  // 2. 一斉表示URL（Broadcast）の検査
  const newBcId = newPolicy.broadcast_id || '';
  const newBcUrl = (newPolicy.broadcast_url || '').trim();

  if (newBcId && newBcId !== oldStorage.last_broadcast_id && newBcUrl) {
    console.log('[EduAgent] 新しい一斉表示URLを検出:', newBcUrl);
    await chrome.storage.local.set({ last_broadcast_id: newBcId });
    openBroadcastUrl(newBcUrl);
  }

  // 3. 現在開いているタブのURL規制チェック
  //    規制がOFFに戻った場合でも、ブロック画面のタブを自動復帰させるため常に再検証する
  checkAllTabsFiltering(updates.filter_mode, updates.whitelist_urls, updates.blacklist_urls);

  // 4. 画面ロックの全タブ適用 / 解除時の復帰
  //    すでに開いている通常ページ（スプレッドシート・YouTube・Gmail等のSPA）も、
  //    ページ種別・CSPに依存せず確実にロック画面へ統一表示する（白画面化を防止）。
  const wasLocked = Boolean(oldStorage.screen_lock);
  if (updates.screen_lock) {
    checkSpecialTabsForLock();
  } else if (wasLocked) {
    releaseLockedTabs();
  }
}

/**
 * 全タブに対して画面ロック状態を通知
 * ※ ロック画面/規制画面（chrome-extension://）にも通知し、
 *    ロック解除時にリロードなしで即座に元画面へ復帰させる。
 */
async function notifyAllTabsLockState(locked) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, {
        type: 'SET_LOCK_STATE',
        locked: locked
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[EduAgent] タブへの通知エラー:', err);
  }
}

/**
 * 画面ロック中、すべてのタブを専用ロック画面（lock.html）へ統一表示する。
 * ・SPA（スプレッドシート・YouTube・Gmail等）はDOM上書きでは内容が透けて白画面化するため、
 *   ページ自体をロック画面へ差し替える（＝重いページをアンロードする）。
 * ・元のURLは lock.html の url パラメータに保持し、解除時に background 側で自動復帰させる。
 * ・Webサイト側のCSP・リソース状況に依存せず、全ページ種別で同一デザインを保証する。
 */
async function checkSpecialTabsForLock() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      const url = tab.url || '';
      if (isLockableUrl(url)) {
        redirectTabToLock(tab.id, url);
      }
    }
  } catch (e) {}
}

/**
 * ロック画面へ差し替えるべきタブのURLかどうかを判定する。
 * ・自分自身の拡張機能ページ（lock.html / blocked.html / popup等）は対象外
 * ・chrome:// 系の内部ページは chrome.tabs.update で遷移できないため対象外
 * ・新規タブ・空白ページ・通常のWebページ（http/https）は対象
 */
function isLockableUrl(url) {
  if (!url) return true; // URL未確定の新規タブはロック画面へ
  const self = chrome.runtime.getURL('');
  if (url.startsWith(self)) return false;              // 拡張機能自身のページ
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('chrome://') && !url.startsWith('chrome://newtab')) return false;
  if (url.startsWith('about:') && url !== 'about:blank') return false;
  return true;
}

/**
 * タブをロック画面へ転送（元URLをクエリに保持して解除時に復帰できるようにする）
 */
function redirectTabToLock(tabId, originalUrl) {
  const lockUrl = chrome.runtime.getURL('lock.html') +
    `?url=${encodeURIComponent(originalUrl || '')}`;
  chrome.tabs.update(tabId, { url: lockUrl });
}

/**
 * 画面ロック解除時：ロック画面へ差し替えたタブを元のURLへ自動復帰させる
 */
async function releaseLockedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const lockBase = chrome.runtime.getURL('lock.html');
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !tab.url.startsWith(lockBase)) continue;
      let originalUrl = '';
      try {
        originalUrl = new URL(tab.url).searchParams.get('url') || '';
      } catch (e) {}
      if (originalUrl && /^https?:\/\//i.test(originalUrl)) {
        chrome.tabs.update(tab.id, { url: originalUrl });
      } else {
        // 元URLが保持されていない場合は新規タブ画面へ戻す
        chrome.tabs.update(tab.id, { url: 'chrome://newtab' });
      }
    }
  } catch (e) {}
}

/**
 * 一斉表示URLを新しいタブで開く
 * ※ 教員の「一斉URL配信」は、児童の現在の作業を中断させないよう
 *    必ず新しいタブで開く（既存タブを上書きしない）。
 */
async function openBroadcastUrl(url) {
  try {
    let validUrl = url;
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl;
    }

    await chrome.tabs.create({ url: validUrl, active: true });
  } catch (err) {
    console.error('[EduAgent] 一斉URL表示エラー:', err);
  }
}

/**
 * 現在のアクティブタブのURL取得
 */
async function getActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab && tab.url ? tab.url : '';
  } catch (e) {
    return '';
  }
}

/**
 * タブ作成イベントの監視（ロック中の新規タブをロック画面へ誘導）
 */
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id) return;
  const data = await chrome.storage.local.get(['screen_lock']);
  if (!data.screen_lock) return;
  const url = tab.url || '';
  // 拡張機能自身のページ（lock.html等）は対象外。
  if (url.startsWith(chrome.runtime.getURL(''))) return;

  // ロック中は新しいタブを増やさない：
  //  ・アクティブなロック画面(lock.html)を持つタブが既にあれば、開かれた新規タブは即座に閉じる
  //  ・無ければ（＝全タブがロック画面でない特殊状況）新規タブをロック画面へ誘導する
  try {
    const lockBase = chrome.runtime.getURL('lock.html');
    const tabs = await chrome.tabs.query({});
    const existingLockTab = tabs.find(t => t.id !== tab.id && (t.url || '').startsWith(lockBase));
    if (existingLockTab && existingLockTab.id) {
      // 既にロック画面が開いているので、新しいタブは開かせない（増やさない）
      chrome.tabs.remove(tab.id).catch(() => {});
      if (existingLockTab.windowId != null) {
        chrome.windows.update(existingLockTab.windowId, { focused: true }).catch(() => {});
      }
      chrome.tabs.update(existingLockTab.id, { active: true }).catch(() => {});
      return;
    }
  } catch (e) {}

  redirectTabToLock(tab.id, /^https?:\/\//i.test(url) ? url : '');
});

/**
 * タブ更新イベントの監視（URLフィルタリング & ロック適用）
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    const url = changeInfo.url || tab.url;
    if (!url) return;

    const data = await chrome.storage.local.get(['filter_mode', 'whitelist_urls', 'blacklist_urls', 'screen_lock']);

    // ロック中は、通常のWebページ・新規タブ・空白ページを一律ロック画面へ差し替える。
    // すでにロック画面/規制画面/拡張機能ページのタブは対象外（無限リダイレクト防止）。
    if (data.screen_lock && isLockableUrl(url)) {
      redirectTabToLock(tabId, /^https?:\/\//i.test(url) ? url : '');
      return;
    }

    // URL規制判定
    if (data.filter_mode && data.filter_mode !== 'OFF') {
      const isBlocked = evaluateUrlRestriction(url, data.filter_mode, data.whitelist_urls || [], data.blacklist_urls || []);
      if (isBlocked) {
        redirectToBlockedPage(tabId, url, data.filter_mode);
        return;
      }
    }
  }
});

/**
 * 全タブのURL規制を再検証
 *  - 規制対象のURLを開いているタブはブロック画面へリダイレクト
 *  - すでにブロック画面を表示しているタブは、規制が解除されていれば元のURLへ自動復帰
 */
async function checkAllTabsFiltering(mode, whitelist, blacklist) {
  try {
    const tabs = await chrome.tabs.query({});
    const blockPageBase = chrome.runtime.getURL('blocked.html');
    const effectiveMode = (mode || 'OFF').toUpperCase();

    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      // A. すでにブロック画面を表示中のタブ → 規制解除済みなら元URLへ復帰
      if (tab.url.startsWith(blockPageBase)) {
        try {
          const q = new URL(tab.url).searchParams;
          const originalUrl = q.get('url') || '';
          if (originalUrl) {
            const stillBlocked = evaluateUrlRestriction(originalUrl, effectiveMode, whitelist || [], blacklist || []);
            if (!stillBlocked) {
              console.log('[EduAgent] URL規制が解除されたため元の画面へ復帰:', originalUrl);
              chrome.tabs.update(tab.id, { url: originalUrl });
            }
          }
        } catch (e) {}
        continue;
      }

      // B. 通常のタブ → 規制対象ならブロック画面へ
      if (effectiveMode !== 'OFF') {
        const isBlocked = evaluateUrlRestriction(tab.url, effectiveMode, whitelist, blacklist);
        if (isBlocked) {
          redirectToBlockedPage(tab.id, tab.url, effectiveMode);
        }
      }
    }
  } catch (err) {
    console.error('[EduAgent] URL規制チェックエラー:', err);
  }
}

/**
 * URLが規制対象かどうかの判定
 */
function evaluateUrlRestriction(rawUrl, mode, whitelist, blacklist) {
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

  // 1. ホワイトリストモード（リストに含まれるもの以外すべてブロック）
  if (mode === 'WHITELIST') {
    if (!whitelist || whitelist.length === 0) return true;

    const isAllowed = whitelist.some(item => {
      const target = item.trim().toLowerCase();
      if (!target) return false;
      return hostname === target || hostname.endsWith('.' + target) || rawUrl.toLowerCase().includes(target);
    });

    return !isAllowed;
  }

  // 2. ブラックリストモード（リストに含まれるものをブロック）
  if (mode === 'BLACKLIST') {
    if (!blacklist || blacklist.length === 0) return false;

    const isDenied = blacklist.some(item => {
      const target = item.trim().toLowerCase();
      if (!target) return false;
      return hostname === target || hostname.endsWith('.' + target) || rawUrl.toLowerCase().includes(target);
    });

    return isDenied;
  }

  return false;
}

/**
 * ブロック画面へリダイレクト
 */
function redirectToBlockedPage(tabId, originalUrl, mode) {
  const blockUrl = chrome.runtime.getURL('blocked.html') + 
    `?url=${encodeURIComponent(originalUrl)}&mode=${encodeURIComponent(mode)}`;
  chrome.tabs.update(tabId, { url: blockUrl });
}

/**
 * 外部・Content Script からの問い合わせ受信
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_STATE') {
    chrome.storage.local.get(null).then(data => {
      sendResponse(data);
    });
    return true;
  }
  if (message.type === 'TRIGGER_SYNC') {
    syncWithGas().then(() => {
      chrome.storage.local.get(null).then(data => sendResponse({ success: true, data }));
    }).catch(err => {
      sendResponse({ success: false, error: err.toString() });
    });
    return true;
  }
});
