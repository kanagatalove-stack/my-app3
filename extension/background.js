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
  // 学校名 → GAS WebアプリURL のマッピング。
  // 13校それぞれのGAS（スプレッドシート）に、1つの拡張機能から振り分けるためのルーティング表。
  // 管理コンソールの Managed Storage ポリシー（gas_url_map）で配布する。
  gas_url_map: {},
  screen_lock: false,
  filter_mode: 'OFF', // 'OFF' | 'WHITELIST' | 'BLACKLIST'
  whitelist_urls: ['nhk.or.jp', 'scratch.mit.edu', 'google.com'],
  blacklist_urls: ['youtube.com', 'twitter.com', 'tiktok.com', 'instagram.com'],
  last_broadcast_id: '',
  last_screen_request: '', // 画面一覧: 最後に処理した画面情報要求ID（押下時のみ撮影するための二重実行防止）
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
//  ・syncAlarm      … 稼働中のバックストップ（30 秒）。教員コンソール稼働中のみ登録する。
//  ・keepAliveAlarm … 旧名（後方互換）。
//  ・idleDriftAlarm … 稼働→非稼働へ切り替わった直後の猶予期間だけ、再開を確認するための低頻度起床。
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncAlarm' || alarm.name === 'keepAliveAlarm') {
    maybeSync();
  } else if (alarm.name === 'idleDriftAlarm') {
    maybeSync();
  }
});

// ==================== 教員コンソールの稼働に連動する同期周期 ====================
// 課題: 児童端末が常時 1.5 秒間隔でハートビート（doPost）し、管理アプリを開いていなくても
//       GAS 実行が数秒おきに走り続ける（通信負荷）。
// v1.6.0: 「管理アプリを誰も起動していないときは通信しない」を徹底する。
//   ・稼働中（ka_active=true）: 1.5 秒間隔で速く反映（＋30 秒アラームのバックストップ）。
//   ・非稼働（ka_active=false）: **定期ポーリングを行わない（doPost = 0）**。
//       ただし「稼働→非稼働」に切り替わった直後の猶予期間（GAS の idle_drift_until）だけ、
//       管理アプリがすぐ再度開かれるケースに備えて低頻度（1 秒上限）で再確認する。
//       猶予が尽きたらアラームを止め、完全に通信を停止する（＝無駄な通信ゼロ）。
//   ・停止後に管理アプリが再度開かれた場合は、新しいタブの作成/更新（＝コンソールURL）を
//     検知して即座に通常同期へ復帰する（resumeFromConsoleTab）。
//   ※ 児童端末は GAS としか通信できないため、稼働判定は GAS（ka_active）を介する。
let keepaliveActive = false; // GAS のハートビート応答 ka_active を反映
let activeIntervalMs = 1500; // 稼働中の同期周期（GAS の sync_interval_sec で上書きされる）
let idleDriftUntil = 0;      // 非稼働時、この時刻までは低頻度で再確認する（0=猶予なし）

// GAS の応答（ka_active / sync_interval_sec / idle_drift_until）を storage と同期ループへ反映する。
// 旧形式（真偽値のみ）でも受け付ける（後方互換）。
function applyRemoteKeepalive(payload) {
  let active, intervalSec, driftUntil;
  if (payload && typeof payload === 'object') {
    active = !!payload.ka_active;
    intervalSec = Number(payload.sync_interval_sec);
    driftUntil = Number(payload.idle_drift_until) || 0;
  } else {
    active = !!payload;
    intervalSec = active ? 1.5 : 0;
    driftUntil = active ? 0 : (Date.now() + 30000);
  }
  const changed = (active !== keepaliveActive);
  keepaliveActive = active;
  activeIntervalMs = (active && isFinite(intervalSec) && intervalSec > 0)
    ? Math.round(intervalSec * 1000) : 1500;
  idleDriftUntil = active ? 0 : (driftUntil || (Date.now() + 30000));

  try {
    chrome.storage.local.set({
      keepalive_active: active,
      keepalive_interval_sec: active ? (activeIntervalMs / 1000) : 0,
      keepalive_drift_until: idleDriftUntil
    });
  } catch (e) {}

  if (active) {
    // 稼働中のバックストップ（30 秒アラーム）を確保し、猶予用アラームは不要なので止める。
    if (changed) lastSyncMs = 0; // 稼働へ切替時は次回 ping で即同期し、素早く反映する
    ensureSyncLoop();
    clearIdleDriftAlarm();
  } else {
    // 非稼働: 30 秒アラームを止めて無駄な起床を止める。猶予期間だけ再開を確認する。
    stopSyncLoop();
    scheduleIdleDrift();
  }
}

// ==================== 同期のレート制御 ====================
//  ・稼働中（管理アプリが稼働中）      : 1.5 秒 … 指示を 3 秒以内に反映
//  ・非稼働・猶予期間内               : 1 秒上限の低頻度で再確認（管理アプリの再起動を拾う）
//  ・非稼働・猶予期間外               : 同期しない（doPost を出さない＝通信負荷ゼロ）
const ACTIVE_SYNC_MS = 1500;
const IDLE_SYNC_MS = 0;         // 非稼働時は定期ポーリングをしない（0＝常にスキップ）
const IDLE_DRIFT_MS = 1000;     // 猶予期間中の再確認レート上限（1 秒）
const IDLE_DRIFT_ALARM_MIN = 5 / 60; // 猶予期間中の再確認アラーム周期（5 秒）
let lastSyncMs = 0;

function maybeSync() {
  const now = Date.now();
  let interval;
  if (keepaliveActive) {
    interval = activeIntervalMs > 0 ? activeIntervalMs : ACTIVE_SYNC_MS;
  } else if (idleDriftUntil && now < idleDriftUntil) {
    interval = IDLE_DRIFT_MS; // 猶予期間のみ低頻度で再確認する
  } else {
    // 非稼働かつ猶予終了 → 同期しない。猶予用アラームが残っていれば止める。
    clearIdleDriftAlarm();
    return;
  }
  if (now - lastSyncMs < interval) return;
  lastSyncMs = now;
  syncWithGas();
}

/**
 * 稼働中のバックストップ（30 秒アラーム）を登録する。
 * ・稼働中のみ登録する（非稼働時は登録しない＝無駄な起床・doPost を防ぐ）。
 * ・内容スクリプトが無い場合（全タブ閉じ等）でも、これによって同期が継続する。
 */
function ensureSyncLoop() {
  try {
    chrome.alarms.create('syncAlarm', { periodInMinutes: 0.5 }); // 30秒（MV3の最小値）
  } catch (e) {}
}

/** 稼働が終わったらバックストップ（30 秒アラーム）を止める。 */
function stopSyncLoop() {
  try { chrome.alarms.clear('syncAlarm'); } catch (e) {}
}

/**
 * 稼働→非稼働へ切り替わった直後の「猶予期間」だけ、低頻度で再開を確認するアラームを登録する。
 * 猶予（GAS が idle_drift_until で指定）を過ぎたら自動的に止まるため、無駄な通信は残らない。
 */
function scheduleIdleDrift() {
  const remaining = idleDriftUntil - Date.now();
  if (remaining <= 0) { clearIdleDriftAlarm(); return; }
  const periodMin = IDLE_DRIFT_ALARM_MIN;
  try {
    chrome.alarms.create('idleDriftAlarm', {
      delayInMinutes: Math.min(periodMin, remaining / 60000),
      periodInMinutes: periodMin
    });
  } catch (e) {}
}

/** 猶予期間用の再確認アラームを止める。 */
function clearIdleDriftAlarm() {
  try { chrome.alarms.clear('idleDriftAlarm'); } catch (e) {}
}

/**
 * 停止後に管理アプリ（教員コンソール）が再度開かれた場合の復帰。
 * コンソールは GAS の Web アプリ（script.google.com/macros/...）で開かれるため、
 * そのタブ作成/更新を検知して一度だけ通常同期を走らせ、ka_active=true を確認できれば
 * 稼働中の速い同期へ復帰する。＝停止中でもコンソールを開けば数秒以内に拡張が再稼働する。
 */
function resumeFromConsoleTab(url) {
  if (keepaliveActive) return; // 既に稼働中なら何もしない
  const u = String(url || '');
  if (!/^https?:\/\/script\.google\.com\//i.test(u)) return;
  lastSyncMs = 0;
  syncWithGas();
}


/**
 * 教員コンソールの稼働を GAS に通知する（ログイン中に 30 秒ごとに呼ばれる）。
 * 児童端末はハートビート応答の ka_active で稼働を検知し、同期周期を切り替える。
 */
async function consoleTouch() {
  try {
    const data = await chrome.storage.local.get(null);
    const gasUrl = resolveGasUrl(data);
    if (!gasUrl) return false;
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'console_touch' }),
      redirect: 'follow'
    });
    return res.ok;
  } catch (e) { return false; }
}

/** 教員コンソールの稼働を解除する（ログアウト時）。 */
async function consoleRelease() {
  try {
    const data = await chrome.storage.local.get(null);
    const gasUrl = resolveGasUrl(data);
    if (!gasUrl) return false;
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'console_release' }),
      redirect: 'follow'
    });
    return res.ok;
  } catch (e) { return false; }
}

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

    // 学校名 → GAS URL のマッピング（1つの拡張機能で13校のGASへ振り分け）。
    // 管理コンソールポリシー（gas_url_map）を優先し、無ければ保存済みを使う。
    let gasUrlMap = (stored.gas_url_map && typeof stored.gas_url_map === 'object') ? stored.gas_url_map : {};
    if (managed.gas_url_map && typeof managed.gas_url_map === 'object') {
      gasUrlMap = managed.gas_url_map;
    }

    const initialData = {
      ...DEFAULT_CONFIG,
      ...stored,
      student_id: studentId,
      gas_url: gasUrl,
      gas_url_map: gasUrlMap,
      google_account: googleAccount || ''
    };

    if (managed.school_name && !initialData.school_name) {
      initialData.school_name = managed.school_name;
    }

    await chrome.storage.local.set(initialData);

    // 学校に対応するGAS URLを解決（マッピング優先、無ければ gas_url）
    const initialGasUrl = resolveGasUrl(initialData);

    // 稼働判定は GAS 応答（ka_active）で行う。初期同期を 1 回実行し、稼働中なら
    // applyRemoteKeepalive が 30 秒アラームのバックストップを登録する
    // （非稼働ならアラームを登録しない＝無駄な起床・doPost を防ぐ）。
    console.log(`[EduAgent] 児童端末セットアップ完了 (児童ID: ${studentId})`);

    // GAS URLが設定されていれば即座に自動同期を実行！
    if (initialGasUrl) {
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
 * 学校名の表記ゆれ（前後空白・全角スペース・市立等の接頭辞・全角英数字）を吸収する正規化。
 * gas_url_map のキー照合に使用する。
 */
function normalizeSchoolKey(name) {
  return String(name || '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .toUpperCase()
    .replace(/^美作市立/, '').replace(/^美作市/, '').replace(/^市立/, '').replace(/^公立/, '')
    .trim();
}

/**
 * 1つの拡張機能で複数校（13校）のGASへ振り分けるためのGAS URL解決。
 * 優先度:
 *   1. gas_url_map[学校名]  … 学校ごとに別のGAS（スプレッドシート）を使う場合（推奨）
 *      ※ 表記ゆれ（「英田小」「美作市立英田小学校」等）を吸収して照合する
 *   2. gas_url              … 単一校／共通のGASを使う場合（後方互換）
 *   3. ''                   … 未設定
 * 学校名が未確定（未設定）の場合は gas_url にフォールバックする。
 */
function resolveGasUrl(data) {
  const map = (data && data.gas_url_map && typeof data.gas_url_map === 'object') ? data.gas_url_map : {};
  const school = String((data && data.school_name) || '').trim();
  const direct = String((data && data.gas_url) || '').trim();

  if (school && school !== '未設定') {
    // 完全一致
    if (map[school] && String(map[school]).trim()) return String(map[school]).trim();
    // 表記ゆれを吸収した一致
    const norm = normalizeSchoolKey(school);
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
      if (normalizeSchoolKey(keys[i]) === norm && String(map[keys[i]]).trim()) {
        return String(map[keys[i]]).trim();
      }
    }
  }
  return direct;
}

// 同期の多重実行ガード。
// ・syncInterval(1.5秒)より GAS 応答が遅い場合、複数の同期が重なって走る。
// ・古いリクエストの応答が新しい応答の後に到着すると、古い状態（例: ロック解除前）で
//   上書きされ、ロック画面が「消えたり出たり」するちらつきの原因になる。
// ・実行中はスキップし、常に1本だけ直列で走らせる。
let syncInFlight = false;

/**
 * GASとのハートビート・ポリシー同期
 */
async function syncWithGas() {
  if (syncInFlight) return; // 前回の同期が未完了ならスキップ（多重実行防止）
  syncInFlight = true;
  try {
    const data = await chrome.storage.local.get(null);
    let studentId = data.student_id;

    // もし student_id が未設定の場合、Googleアカウントの再検出を試みる
    if (!studentId) {
      const email = await getStudentIdentity();
      if (email) {
        studentId = email;
        await chrome.storage.local.set({ student_id: email });
      }
    }

    // 学校名 → GAS URL を解決（1つの拡張機能で13校のGASへ振り分け）。
    // まず保存済みの school_name / gas_url_map から解決する。
    let effectiveGasUrl = resolveGasUrl(data);

    // 解決できない場合（学校未確定・マップ未取得）は managed storage を再確認する。
    if (!effectiveGasUrl || !data.school_name || data.school_name === '未設定') {
      const managed = await getManagedPolicy();
      const merged = {
        school_name: data.school_name || managed.school_name || '',
        gas_url_map: (data.gas_url_map && Object.keys(data.gas_url_map).length)
          ? data.gas_url_map
          : (managed.gas_url_map || {}),
        gas_url: data.gas_url || managed.gas_url || ''
      };
      const managedGasUrl = resolveGasUrl(merged);
      if (managedGasUrl) effectiveGasUrl = managedGasUrl;

      // ポリシー由来の値が保存されていなければ補完保存する
      const persist = {};
      if (merged.gas_url_map && Object.keys(merged.gas_url_map).length &&
          (!data.gas_url_map || !Object.keys(data.gas_url_map).length)) {
        persist.gas_url_map = merged.gas_url_map;
      }
      if (merged.school_name && merged.school_name !== data.school_name) {
        persist.school_name = merged.school_name;
      }
      if (merged.gas_url && merged.gas_url !== data.gas_url) {
        persist.gas_url = merged.gas_url;
      }
      if (Object.keys(persist).length) await chrome.storage.local.set(persist);
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

    // GAS が返す「教員コンソール稼働中か（ka_active）／同期周期（sync_interval_sec）／
    // 非稼働時の再確認猶予（idle_drift_until）」を反映し、同期周期を切り替える。
    //  ・稼働中        : 1.5 秒の速い同期
    //  ・非稼働        : 定期ポーリングを停止（猶予期間のみ低頻度で再確認）
    applyRemoteKeepalive({
      ka_active: resJson.ka_active,
      sync_interval_sec: resJson.sync_interval_sec,
      idle_drift_until: resJson.idle_drift_until
    });

  } catch (err) {
    console.error('[EduAgent] 通信エラー:', err);
  } finally {
    syncInFlight = false;
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
    openBroadcastUrl(newBcUrl, newBcId);
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

  // 5. 画面一覧（スクリーンショット）要求の検査
  //    教員が「画面情報取得」を押した児童だけに要求日時が入る。
  //    要求ID（日時|reqId）が前回と変わったときだけ撮影・送信する（押下時のみ通信）。
  const newScreenReq = (newPolicy.screen_request_at || '').trim();
  if (newScreenReq && newScreenReq !== (oldStorage.last_screen_request || '')) {
    // 先に記録してから撮影を開始する（多重撮影防止）
    await chrome.storage.local.set({ last_screen_request: newScreenReq });
    captureAndUploadScreenshot();
  }
}

/**
 * 画面一覧用: 現在のアクティブタブをキャプチャして GAS へアップロードする。
 * ・教員の「画面情報取得」押下（＝screen_request_at の変化）を検知したときだけ実行する。
 * ・通常は見られない chrome://・chrome-extension:// 画面はキャプチャ不可のためスキップする。
 * ・★重要: Google スプレッドシートの 1 セルは 50,000 文字が上限のため、
 *   撮影した JPEG をそのまま送ると保存に失敗して画面が表示されない（＝送信待ちのまま）。
 *   そこで OffscreenCanvas で「Base64 が上限未満に収まるまで」段階的に縮小してから送る。
 */
const SCREENSHOT_MAX_B64 = 42000;                            // 送信する Base64 の上限（セル上限50kに余裕を持たせる）
const SCREENSHOT_WIDTHS = [1024, 800, 640, 480, 360, 280];   // 縮小候補（広い順に試す）
const SCREENSHOT_QUALITIES = [0.7, 0.55, 0.4];               // JPEG 品質候補

// data URL(JPEG) を OffscreenCanvas で縮小し、Base64 が上限未満に収まる最小構成を返す。
async function downscaleForSheet(dataUrl) {
  // まずは原寸の Base64 長を確認（既に十分小さければそのまま使う）
  const originalB64 = String(dataUrl).replace(/^data:image\/[a-z]+;base64,/i, '');
  if (originalB64.length <= SCREENSHOT_MAX_B64) return dataUrl;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;

  let bitmap;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    bitmap = await createImageBitmap(blob);
  } catch (e) { return null; }

  try {
    for (const w of SCREENSHOT_WIDTHS) {
      if (w > bitmap.width) continue; // 原寸より拡大はしない
      const h = Math.round((bitmap.height * w) / bitmap.width);
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const q of SCREENSHOT_QUALITIES) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
        const buf = await blob.arrayBuffer();
        // ArrayBuffer → Base64（SW には btoa がある）
        let bin = '';
        const bytes = new Uint8Array(buf);
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        const b64 = btoa(bin);
        if (b64.length <= SCREENSHOT_MAX_B64) {
          return 'data:image/jpeg;base64,' + b64;
        }
      }
    }
  } catch (e) {
    return null;
  } finally {
    try { bitmap.close(); } catch (e) {}
  }
  return null; // どの組み合わせでも上限に収まらなかった
}

async function captureAndUploadScreenshot() {
  try {
    const data = await chrome.storage.local.get(null);
    const studentId = data.student_id;
    const effectiveGasUrl = resolveGasUrl(data);
    if (!studentId || !effectiveGasUrl) return;

    // アクティブタブ（最後に操作したウィンドウ）を取得
    let tab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs && tabs[0] ? tabs[0] : null;
    } catch (e) {}
    if (!tab) {
      try {
        const all = await chrome.tabs.query({ active: true });
        tab = all && all[0] ? all[0] : null;
      } catch (e) {}
    }
    if (!tab || !tab.windowId) return;

    // キャプチャ不可のページ（内部ページ・拡張機能ページ）はスキップ
    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('about:') || url.startsWith('devtools://')) {
      return;
    }

    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    if (!raw || !/^data:image\//.test(raw)) return;

    // セル上限に収まるよう縮小（収まらなければ送信しない＝壊れたデータを残さない）
    const dataUrl = await downscaleForSheet(raw);
    if (!dataUrl) {
      console.warn('[EduAgent] 画面情報を上限サイズまで縮小できませんでした');
      return;
    }

    await fetch(effectiveGasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'screenshot',
        student_id: studentId,
        image_data: dataUrl,
        mime_type: 'image/jpeg'
      }),
      redirect: 'follow'
    });
    console.log('[EduAgent] 画面情報（スクリーンショット）を送信しました', dataUrl.length);
  } catch (err) {
    // captureVisibleTab はマニフェスト権限が無い/対象外ページで失敗する。
    // 画面一覧は補助機能のため、失敗しても他の同期処理には影響させない。
    console.warn('[EduAgent] 画面キャプチャをスキップ:', err && err.message ? err.message : err);
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
      // 一斉配信直後のタブはロック画面へ差し替えない（新規タブで表示させるため）
      if (isBroadcastGuardedTab(tab.id)) continue;
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
  // ロック解除時の復帰は、まずロック画面自身(lock.js)が即座に実行する。
  // （ロック画面のストレージ変更リスナーが最速で window.location.replace する）
  // ここは「lock.js が何らかの理由で復帰できなかった場合」の保険として機能させる。
  // ・両者が同時に遷移すると二重遷移となり、画面が一瞬ちらつく（消えたり出たりする）ため、
  //   少し待ってから『まだロック画面のままのタブ』に限って復帰させる。
  // ・これにより、lock.js が先に復帰したタブには一切手を出さず、競合を避けられる。
  await new Promise((resolve) => setTimeout(resolve, 700));
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

// 一斉配信直後のタブを、ロック処理（閉じる/ロック画面差し替え/URL規制）から保護する期限。
// （配信はロック中でも確実に新規タブで表示される必要があるため）
let broadcastGuardUntil = 0;
let broadcastTabId = null;
// 同一配信IDの二重オープン防止
let lastBroadcastOpenedId = '';

/**
 * 一斉配信直後に保護すべきタブかどうかを判定する。
 */
function isBroadcastGuardedTab(tabId) {
  if (Date.now() >= broadcastGuardUntil) return false;
  if (broadcastTabId != null && tabId === broadcastTabId) return true;
  return false;
}

/**
 * 一斉表示URLを新しいタブで開く
 * ※ 教員の「一斉URL配信」は、児童の現在の作業を中断させないよう
 *    必ず新しいタブで開く（既存タブを上書きしない）。
 * ※ 画面ロック中であっても配信URLは新規タブで表示する。
 *    直後に走るロック処理（タブ閉じ/ロック画面差し替え/URL規制）から配信タブを保護する。
 */
async function openBroadcastUrl(url, broadcastId) {
  try {
    if (broadcastId && broadcastId === lastBroadcastOpenedId) {
      return; // 同一配信の二重オープン防止
    }
    let validUrl = url;
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl;
    }
    if (broadcastId) lastBroadcastOpenedId = broadcastId;

    // 直後のロック/規制処理から保護する期間を設定
    broadcastGuardUntil = Date.now() + 6000;
    broadcastTabId = null;

    const created = await chrome.tabs.create({ url: validUrl, active: true });
    if (created && created.id) broadcastTabId = created.id;

    // 保護期限後に参照が残らないようクリア
    setTimeout(() => { broadcastTabId = null; }, 7000);
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
  // 停止中に管理アプリ（教員コンソール）が再度開かれたら通常同期へ復帰する。
  resumeFromConsoleTab(tab.url || (tab.pendingUrl || ''));
  // 一斉配信直後はロック中でも配信タブを閉じない/差し替えない（新規タブで表示するため）
  if (Date.now() < broadcastGuardUntil) return;
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

    // 停止中に管理アプリ（教員コンソール）が開かれた/遷移したら通常同期へ復帰する。
    resumeFromConsoleTab(url);

    // 一斉配信直後のタブはロック/規制の対象外（新規タブで配信URLを表示させるため）
    if (isBroadcastGuardedTab(tabId)) return;

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
      // 一斉配信直後のタブはURL規制の対象外（新規タブで配信URLを表示させるため）
      if (isBroadcastGuardedTab(tab.id)) continue;

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
  // 教員コンソールの稼働通知（content script 経由）。GAS に console_touch を送り、
  // 児童端末がハートビート応答で ka_active=true を受け取れるようにする。
  if (message.type === 'CONSOLE_TOUCH' || message.type === 'KEEPALIVE_START') {
    consoleTouch().then(ok => sendResponse({ success: ok })).catch(() => sendResponse({ success: false }));
    return true;
  }
  // 教員コンソールのログアウト通知。GAS に console_release を送る。
  // （全アカウントがログアウトしたら GAS 側の稼働記録も消え、児童端末は省電力へ戻る）
  if (message.type === 'CONSOLE_RELEASE' || message.type === 'KEEPALIVE_STOP') {
    consoleRelease().then(ok => sendResponse({ success: ok })).catch(() => sendResponse({ success: false }));
    return true;
  }
  // 各タブからのハートビート（ローカル IPC・ネットワーク通信ではない）。
  // 稼働中（ka_active=true）は 1.5 秒レートで即時同期する。非稼働時は同期しない
  // （＝doPost を出さない）。猶予期間内のみ maybeSync が低頻度で再確認する。
  if (message.type === 'KEEPALIVE_PING') {
    maybeSync();
    sendResponse({ success: true, active: keepaliveActive });
    return true;
  }
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
