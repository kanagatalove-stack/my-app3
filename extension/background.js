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
  } else if (alarm.name === 'wakeAlarm') {
    // 非稼働中でも「先生が復帰したか」だけを軽く確認する（シート非接触の短い応答）。
    probeWake();
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
  const newIntervalMs = (active && isFinite(intervalSec) && intervalSec > 0)
    ? Math.round(intervalSec * 1000) : 1500;
  // 非稼働の猶予期限は「一度決めたら延長しない」。GAS は毎応答で now+猶予 を返すため、
  // 毎回上書きすると猶予が終わらず（＝停止しない）・ストレージ書込みが増える。
  // さらに端末と GAS の時計ずれで猶予が不当に延びないよう、猶予は最大 60 秒に丸める
  // （＝「全教員ログアウト後、遅くとも約 60 秒以内に完全停止」を保証する）。
  const IDLE_DRIFT_MAX_MS = 60000;
  const driftCandidate = (idleDriftUntil > Date.now())
    ? idleDriftUntil
    : (driftUntil || (Date.now() + 30000));
  const newDriftUntil = active
    ? 0
    : Math.min(driftCandidate, Date.now() + IDLE_DRIFT_MAX_MS);

  const activeChanged = (active !== keepaliveActive);
  const intervalChanged = (newIntervalMs !== activeIntervalMs);
  const driftChanged = (newDriftUntil !== idleDriftUntil);

  // 状態が変わっていなければ storage 書込み・アラーム再登録を行わない。
  // 稼働中は約 1.5 秒ごとに ka_active=true が返るため、毎回書き込むと無駄な I/O と
  // アラーム再設定が発生し、反映速度のゆらぎ・ログ肥大の原因になる。
  if (!activeChanged && !intervalChanged && !driftChanged) return;

  keepaliveActive = active;
  activeIntervalMs = newIntervalMs;
  idleDriftUntil = newDriftUntil;

  try {
    chrome.storage.local.set({
      keepalive_active: active,
      keepalive_interval_sec: active ? (activeIntervalMs / 1000) : 0,
      keepalive_drift_until: idleDriftUntil
    });
  } catch (e) {}

  if (active) {
    // 稼働中のバックストップ（30 秒アラーム）を確保し、猶予用アラームは不要なので止める。
    if (activeChanged) {
      lastSyncMs = 0;          // 稼働へ切替時は次回 ping で即同期し、素早く反映する
      ensureSyncLoop();        // 稼働中のみアラームを登録（状態遷移時だけ）
      clearIdleDriftAlarm();
    }
    // 稼働中は起こしプローブ不要（通常同期が走っているため）。止めて通信を増やさない。
    clearWakeProbe();
  } else if (activeChanged || driftChanged) {
    // 非稼働: 30 秒アラームを止めて無駄な起床を止める。猶予期間だけ再開を確認する。
    stopSyncLoop();
    scheduleIdleDrift();
    // 猶予が尽きた後も「先生が復帰したか」だけは拾えるようにする。
    // 間隔は時間帯で切り替える（平日日中=1分固定／夜間・土日祝=10分）。
    ensureWakeProbe();
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

// ==================== 非稼働時の「起こしプローブ」 ====================
// 課題: 非稼働になると端末は同期を完全に止めるため、先生が再ログインしても
//       端末が眠ったままでオンラインにならず、ロック・URL配信も届かなかった。
//       「蓋を閉じて開いただけ」では onStartup もタブ生成も起きないため復帰できない。
// 方針: 通信負荷を増やさないことを最優先に、二段構えで復帰させる。
//   ① イベント起床（通信ゼロ）… 蓋を開けた/操作再開（chrome.idle）で 1 回だけ同期。
//   ② 時間帯で間隔を変えるプローブ … ①で拾えない場合に備え、シートに触らない
//      軽量な wake_check だけを送る。間隔は「学校の稼働時間」に合わせて切り替える。
//       ・平日 08:00〜17:00 … 1 分固定（バックオフしない＝ログイン後すぐ復帰）
//       ・上記以外（17:00以降・土日・祝日）… 10 分（バッテリー保護・ログ削減）
//      先生が復帰していれば（ka_active か wake_epoch の変化）即座に通常同期へ戻る。
//
// ※ 13 校は校ごとに Google アカウント／スプレッドシート／GAS を独立分離しているため、
//    1 アカウントあたりの負荷余裕は大きい。日中の 1 分固定はその前提に基づく。
const WAKE_ALARM_NAME = 'wakeAlarm';

// ---- 時間帯の定義（日本時間で判定する。端末のタイムゾーン設定に依存させない）----
const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9
const PROBE_DAY_START_HOUR = 8;   // 平日の開始時刻（この時刻から日中扱い）
const PROBE_DAY_END_HOUR = 17;    // 平日の終了時刻（この時刻から夜間扱い）
const PROBE_DAY_MIN = 1;          // 平日日中：1 分固定
const PROBE_NIGHT_MIN = 10;       // 夜間・土日祝：10 分（0 にすると停止）

/** その月の第 n 曜日の日付を返す（nth は 1 始まり）。 */
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  return 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
}

/** 春分／秋分の日（近似式。1948〜2150 年で有効）。 */
function equinoxDay(year, isSpring) {
  const base = isSpring ? 20.8431 : 23.2488;
  const v = base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4);
  return Math.floor(v);
}

/**
 * その年の日本の祝日（振替休日・国民の休日を含む）を "月-日" の集合で返す。
 * 祝日判定は端末内で完結させる（外部通信しない＝通信負荷ゼロ）。
 */
function japaneseHolidaySet(year) {
  const set = {};
  const add = (m, d) => { if (d >= 1 && d <= 31) set[m + '-' + d] = true; };

  add(1, 1);                                            // 元日
  add(1, nthWeekdayOfMonth(year, 1, 1, 2));             // 成人の日（第2月曜）
  add(2, 11);                                           // 建国記念の日
  add(2, 23);                                           // 天皇誕生日
  add(3, equinoxDay(year, true));                       // 春分の日
  add(4, 29);                                           // 昭和の日
  add(5, 3); add(5, 4); add(5, 5);                      // 憲法記念日／みどりの日／こどもの日
  add(7, nthWeekdayOfMonth(year, 7, 1, 3));             // 海の日（第3月曜）
  add(8, 11);                                           // 山の日
  add(9, nthWeekdayOfMonth(year, 9, 1, 3));             // 敬老の日（第3月曜）
  add(9, equinoxDay(year, false));                      // 秋分の日
  add(10, nthWeekdayOfMonth(year, 10, 1, 2));           // スポーツの日（第2月曜）
  add(11, 3);                                           // 文化の日
  add(11, 23);                                          // 勤労感謝の日

  // 振替休日: 日曜に当たる祝日は、翌日以降で最初の「祝日でない日」が休日になる。
  const base = {};
  Object.keys(set).forEach(k => { base[k] = true; });
  Object.keys(base).forEach(k => {
    const p = k.split('-');
    const m = Number(p[0]), d = Number(p[1]);
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() !== 0) return;
    let cur = new Date(Date.UTC(year, m - 1, d));
    for (let i = 0; i < 10; i++) {
      cur = new Date(cur.getTime() + 86400000);
      const key = (cur.getUTCMonth() + 1) + '-' + cur.getUTCDate();
      if (!base[key]) { set[key] = true; break; }
    }
  });

  // 国民の休日: 祝日に挟まれた 1 日（例: 敬老の日と秋分の日に挟まれた 9/22）。
  Object.keys(base).forEach(k => {
    const p = k.split('-');
    const m = Number(p[0]), d = Number(p[1]);
    const mid = m + '-' + (d + 1);
    const nxt = m + '-' + (d + 2);
    if (base[mid] || set[mid]) return;
    if (base[nxt] && d + 2 <= 31) set[mid] = true;
  });

  return set;
}

// 年の祝日集合は使い回す（毎回作り直すと無駄）。
let holidayCacheYear = 0;
let holidayCacheSet = null;

/** 指定日が日本の祝日かどうか。 */
function isJapaneseHoliday(year, month, day) {
  if (holidayCacheYear !== year || !holidayCacheSet) {
    holidayCacheSet = japaneseHolidaySet(year);
    holidayCacheYear = year;
  }
  return !!holidayCacheSet[month + '-' + day];
}

/** 指定時刻（エポックms）が「日中（平日8:00-17:00）か」を日本時間で判定する。 */
function probeBandState(nowMs) {
  const j = new Date(nowMs + JST_OFFSET_MS);
  const y = j.getUTCFullYear();
  const mo = j.getUTCMonth() + 1;
  const d = j.getUTCDate();
  const h = j.getUTCHours();
  const dow = j.getUTCDay();
  const holiday = isJapaneseHoliday(y, mo, d);
  const weekend = (dow === 0 || dow === 6);
  const dayTime = (h >= PROBE_DAY_START_HOUR) && (h < PROBE_DAY_END_HOUR);
  return { inDay: (!weekend && !holiday && dayTime), weekend: weekend, holiday: holiday };
}

/**
 * 現在の時間帯から「プローブ間隔（分）」と「次の時間帯境界までの分」を求める。
 * 戻り値: { inDay, weekend, holiday, minutes, minutesUntilChange }
 */
function getProbeBand(nowMs) {
  const t = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
  const cur = probeBandState(t);

  // 次の境界（inDay が反転する時刻）を 1 分刻みで探す。
  // 日本には夏時間が無いため、1 分 = 60000ms で厳密に数えられる。
  const MAX_STEPS = 60 * 24 * 8;
  let step = 0;
  while (step < MAX_STEPS) {
    step++;
    if (probeBandState(t + step * 60000).inDay !== cur.inDay) break;
  }

  return {
    inDay: cur.inDay,
    weekend: cur.weekend,
    holiday: cur.holiday,
    minutes: cur.inDay ? PROBE_DAY_MIN : PROBE_NIGHT_MIN,
    minutesUntilChange: Math.max(0.5, step)
  };
}

/**
 * 起こしプローブを「現在の時間帯」の間隔で登録する。
 * 次の時間帯境界が来る前に一度起きるよう delay を短くするので、
 * 8:00 や 17:00 の切り替わりに最大でも境界時刻ちょうどで間隔が更新される。
 */
function ensureWakeProbe() {
  const band = getProbeBand(Date.now());
  if (!band.minutes || band.minutes <= 0) { clearWakeProbe(); return; } // 0 = 停止
  const delay = Math.min(band.minutes, band.minutesUntilChange);
  try {
    chrome.alarms.create(WAKE_ALARM_NAME, {
      delayInMinutes: delay,
      periodInMinutes: band.minutes
    });
  } catch (e) {}
}

/** 起こしプローブを止める（稼働中は不要なため）。 */
function clearWakeProbe() {
  try { chrome.alarms.clear(WAKE_ALARM_NAME); } catch (e) {}
}

/**
 * 「先生が復帰したか」だけを軽く確認する。
 * シートに触らない wake_check を使うため、GAS 側の実行はごく短時間で終わる。
 * 復帰を検知したら、その場で通常のハートビート（＝詳細なオンライン通知）を送り、
 * 端末一覧に即座にオンラインとして現れるようにする。
 */
async function probeWake() {
  if (keepaliveActive) { clearWakeProbe(); return; } // 既に稼働中なら何もしない
  try {
    const data = await chrome.storage.local.get(null);
    const gasUrl = resolveGasUrl(data);
    if (!gasUrl) return;

    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, 8000);
    }
    let res;
    try {
      res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'wake_check' }),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !res.ok) return;

    const j = await res.json();
    if (!j || !j.success) return;

    const epoch = Number(j.wake_epoch) || 0;
    const seen = Number(data.wake_epoch_seen) || 0;

    // 「先生がログインしている」または「緊急呼び出しフラグが更新された」→ 起こす
    if (j.ka_active || (epoch && epoch !== seen)) {
      if (epoch) await chrome.storage.local.set({ wake_epoch_seen: epoch });
      // 稼働状態へ切り替える（ensureSyncLoop が 30 秒アラームを張る）
      applyRemoteKeepalive({
        ka_active: !!j.ka_active,
        sync_interval_sec: j.sync_interval_sec,
        idle_drift_until: j.idle_drift_until
      });
      // 詳細なオンライン通知（doPost）。これが「最終同期日時」を更新し、
      // 端末一覧にオンラインとして表示される。
      lastSyncMs = 0;
      syncWithGas();
      return;
    }

    // 復帰していない → その時点の時間帯に応じた間隔で次回を待つ。
    // （平日日中は 1 分、夜間・土日祝は 10 分。境界をまたぐと自動で切り替わる）
    if (epoch) await chrome.storage.local.set({ wake_epoch_seen: epoch });
    ensureWakeProbe();
  } catch (e) {}
}

// ① イベント起床: 蓋を開けた／スリープから復帰して操作を再開した瞬間に 1 回だけ同期する。
//    アラームと違い「実際に人が端末を使ったとき」しか動かないため、通信は増えない。
//    （これが無いと、蓋の開閉だけでは SW が起きず復帰できなかった）
try {
  if (chrome.idle && chrome.idle.onStateChanged) {
    chrome.idle.setDetectionInterval(60);
    chrome.idle.onStateChanged.addListener((state) => {
      if (state !== 'active') return;
      lastSyncMs = 0;      // レート制限を無視して必ず 1 回同期する
      syncWithGas();
    });
  }
} catch (e) {}

// SW が停止状態から復帰したとき（端末が眠ったまま SW だけ再起動した場合）に備え、
// 非稼働なら起こしプローブを張り直す。これが無いとアラームが失われたまま復帰できない。
try {
  chrome.storage.local.get(['keepalive_active'], (d) => {
    if (chrome.runtime.lastError) return;
    if (!(d && d.keepalive_active)) ensureWakeProbe();
  });
} catch (e) {}

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

    // 管理ポリシーの school_name は学校OUごとに配布されるため最優先。
    // 保存済みが「未設定」のままでも、ポリシー値で上書きする。
    const managedSchool = String(managed.school_name || '').trim();
    if (managedSchool && managedSchool !== '未設定') {
      initialData.school_name = managedSchool;
    } else {
      initialData.school_name = pickMeaningfulSchoolName(initialData.school_name);
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
 * 端末に保存・送信する学校名を決める（複数候補から最初の「意味のある値」を採用）。
 *
 * GAS 側のスプレッドシートは、教員が管理画面で紐付けるまで学校名を「未設定」で返す。
 * その「未設定」をそのまま採用すると、管理ポリシーで配布した school_name が
 * 毎回上書きされて失われ、端末から GAS へ学校名を送れなくなる。
 * そのため '' と '未設定' は「値なし」として読み飛ばす。
 */
function pickMeaningfulSchoolName() {
  for (let i = 0; i < arguments.length; i++) {
    const v = String(arguments[i] || '').trim();
    if (v && v !== '未設定') return v;
  }
  return '未設定';
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

  // 子GAS分散（SHARD_MODE）: 親から割り当てられた子GASがあれば、それを最優先で使う。
  // これが無い場合（＝従来運用・SHARD_MODE 無効）は、以下の学校名ベースの解決に進む。
  const assigned = String((data && data.assigned_gas_url) || '').trim();
  if (assigned) return assigned;

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

// ==================== 子GAS分散（SHARD_MODE）: 動的ルーティング ====================
// 1校240台 × 1.5秒周期 ≒ 160 req/秒 を 1 つの GAS で受けると、GAS の
// 「同時実行 30/ユーザー」に達する。そこで親GASが端末のクラスから子GASを割り当て、
// 端末は以後その子GASへ直接ハートビートする（親は割り当ての指示だけを出す）。
//
// 【端末側の状態】
//   assigned_gas_url   … 割り当てられた子GASのURL（空＝親に繋ぐ）
//   assigned_from      … 割り当てを出した親のURL（再確認・切り戻し先）
//   assigned_at        … 割り当てを受けた時刻（エポックms）
//   assigned_class     … 割り当ての根拠になったクラス（表示・診断用）
//   assigned_fail_count… 子GASへの連続失敗回数（閾値で親へ戻す）
const SHARD_RECHECK_MS = 6 * 60 * 60 * 1000; // 6時間ごとに親へ再確認（クラス変更に追従）
const SHARD_FAIL_LIMIT = 3;                  // 子GASへ3回連続で失敗したら親へ戻す
const SHARD_COOLDOWN_MS = 30 * 60 * 1000;    // 切り戻し後30分は再割り当てを受けない（失敗の無限往復を防ぐ）

// 割り当て状態のメモリ上の写し。
//   同期の先頭で storage.local.get(null) を 1 回読んでいるので、その値で初期化する。
//   これにより 1.5 秒ごとの判定で余分なストレージ読み取りを行わない。
let shardAssignedCache = '';
let shardFailCount = 0;

function shardAssignedUrl(data) {
  return String((data && data.assigned_gas_url) || '').trim();
}

/** 同期の先頭で読み込んだ data から、割り当て状態のメモリ写しを作る。 */
function shardSyncMemory(data) {
  shardAssignedCache = shardAssignedUrl(data);
  shardFailCount = Number((data && data.assigned_fail_count) || 0) || 0;
}

/**
 * 親の応答に含まれる assigned_gas_url を保存し、次回以降の通信先を切り替える。
 * 子GASは assigned_gas_url を返さないため、子と通信している間は割り当てが維持される。
 * 親と通信していて assigned_gas_url が返らない場合は、分散が無効化されたとみなして
 * 割り当てを捨てる（子GASを廃止したときに端末が取り残されないようにする）。
 *
 * ※ talkingToParent のときは、値が変わらなくても assigned_at を更新する。
 *   これが無いと「6時間経過」の条件が永久に真になり、以後ずっと親へ送り続けてしまう。
 */
async function applyShardAssignment(resJson, data, usedUrl, talkingToParent) {
  const next = String((resJson && resJson.assigned_gas_url) || '').trim();
  const cur = shardAssignedUrl(data);
  const patch = {};

  if (next) {
    // 切り戻し直後のクールダウン中は再割り当てを受けない。
    const fbAt = Number((data && data.shard_fallback_at) || 0);
    if (!cur && fbAt && (Date.now() - fbAt) < SHARD_COOLDOWN_MS) return;

    if (next !== cur || talkingToParent) {
      patch.assigned_gas_url = next;
      patch.assigned_at = Date.now(); // 変更なしでも再確認時刻を更新（B1 の修正）
      patch.assigned_class = String((resJson && resJson.assigned_class) || '');
      patch.assigned_fail_count = 0;
      if (talkingToParent) patch.assigned_from = String(usedUrl || '');
      else if (!cur) patch.assigned_from = String((data && data.assigned_from) || '');
      if (data && data.shard_fallback) patch.shard_fallback = false;
      if (fbAt) patch.shard_fallback_at = 0;
    }
  } else if (talkingToParent && cur) {
    // 親が割り当てを返さない＝SHARD_MODE 無効／マップ削除。親へ戻す。
    patch.assigned_gas_url = '';
    patch.assigned_at = 0;
    patch.assigned_class = '';
    patch.assigned_from = '';
    patch.assigned_fail_count = 0;
  }

  if (Object.keys(patch).length) {
    try { await chrome.storage.local.set(patch); } catch (e) {}
    shardAssignedCache = String(patch.assigned_gas_url || '');
    shardFailCount = 0;
  }
}

/**
 * 子GASへの同期結果を数え、連続失敗が閾値に達したら割り当てを捨てて親へ戻す。
 * 子GASのURL誤り・デプロイ漏れ・共有シークレット相違などで端末が孤立するのを防ぐ。
 *
 * ※ 未割り当て（従来運用・SHARD_MODE 無効）のときは何もせず、ストレージも読まない。
 */
async function noteShardOutcome(ok) {
  try {
    if (!shardAssignedCache) return;
    if (ok) {
      if (shardFailCount !== 0) {
        shardFailCount = 0;
        await chrome.storage.local.set({ assigned_fail_count: 0 });
      }
      return;
    }
    shardFailCount += 1;
    if (shardFailCount >= SHARD_FAIL_LIMIT) {
      shardAssignedCache = '';
      shardFailCount = 0;
      await chrome.storage.local.set({
        assigned_gas_url: '', assigned_at: 0, assigned_class: '',
        assigned_from: '', assigned_fail_count: 0,
        shard_fallback: true, shard_fallback_at: Date.now()
      });
    } else {
      await chrome.storage.local.set({ assigned_fail_count: shardFailCount });
    }
  } catch (e) {}
}

// 同期の多重実行ガード。
// ・syncInterval(1.5秒)より GAS 応答が遅い場合、複数の同期が重なって走る。
// ・古いリクエストの応答が新しい応答の後に到着すると、古い状態（例: ロック解除前）で
//   上書きされ、ロック画面が「消えたり出たり」するちらつきの原因になる。
// ・実行中はスキップし、常に1本だけ直列で走らせる。
const SYNC_TIMEOUT_MS = 12000; // GAS 応答のタイムアウト。ハングで syncInFlight が立ったまま（＝反映停止）になるのを防ぐ。
let syncInFlight = false;

// 同期結果の診断情報。
//   直接読み込み版（検証用）のポップアップは chrome://extensions が使えない環境で
//   「なぜ同期できないのか」を表示する唯一の窓口になるため、失敗理由を保持する。
//   通信負荷を増やさないため、書き込みは「成功可否・理由が変わったときだけ」に限定する。
let lastSyncDiag = { ok: null, code: '', message: '', at: '' };
async function recordSyncDiag(ok, code, message) {
  const at = new Date().toLocaleTimeString();
  const changed = (lastSyncDiag.ok !== ok) || (lastSyncDiag.code !== code) ||
                  (lastSyncDiag.message !== message);
  lastSyncDiag = { ok: !!ok, code: String(code || ''), message: String(message || ''), at: at };
  // 子GAS分散: 子へ連続失敗したら親へ戻す（変化の有無に関わらず毎回判定する）
  try { await noteShardOutcome(!!ok); } catch (e) {}
  if (!changed) return; // 変化なし＝ストレージ書込みしない（I/O を増やさない）
  try {
    await chrome.storage.local.set({
      sync_diag_ok: lastSyncDiag.ok,
      sync_diag_code: lastSyncDiag.code,
      sync_diag_message: lastSyncDiag.message,
      sync_diag_at: lastSyncDiag.at
    });
  } catch (e) {}
}

// 疎通確認（手動実行のみ・通常運用では呼ばれない）。
//   直接読み込み版の検証で「URL が正しいか」「Web アプリの公開範囲が正しいか」を
//   切り分けるために使う。シートに触らない wake_check（GET）を 1 回だけ叩く。
const TEST_TIMEOUT_MS = 8000;
async function testGasConnection(urlOverride) {
  const data = await chrome.storage.local.get(null);
  const url = String(urlOverride || '').trim() || resolveGasUrl(data);
  if (!url) return { ok: false, error: 'GAS WebアプリURLが未設定です' };
  const started = Date.now();
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  let timer = null;
  if (controller) timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, TEST_TIMEOUT_MS);
  try {
    const sep = (url.indexOf('?') === -1) ? '?' : '&';
    const res = await fetch(url + sep + 'api=wake_check&_t=' + started, {
      method: 'GET', redirect: 'follow', cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    const ok = !!res.ok && !!json && json.success !== false;
    return { ok: ok, status: res.status, ms: ms, json: json, head: text.slice(0, 300), url: url };
  } catch (e) {
    const detail = String((e && e.message) ? e.message : e);
    return { ok: false, ms: Date.now() - started, error: detail, url: url };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GASとのハートビート・ポリシー同期
 */
async function syncWithGas() {
  if (syncInFlight) return; // 前回の同期が未完了ならスキップ（多重実行防止）
  syncInFlight = true;
  try {
    const data = await chrome.storage.local.get(null);
    // 子GAS分散: 割り当て状態をメモリへ写す（以降の判定でストレージを読まない）
    shardSyncMemory(data);
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

    // 子GAS分散（SHARD_MODE）: 割り当て済みなら子GASへ直接送る（resolveGasUrl が最優先で返す）。
    // ただし 6 時間ごとに親へ問い合わせ直し、クラス変更などで割り当てが変わった場合に追従する。
    const assignedFromUrl = String((data && data.assigned_from) || '').trim();
    const assignedAtMs = Number((data && data.assigned_at) || 0);
    let talkingToParent = !shardAssignedUrl(data);
    if (shardAssignedUrl(data) && assignedFromUrl && assignedAtMs &&
        (Date.now() - assignedAtMs) > SHARD_RECHECK_MS) {
      effectiveGasUrl = assignedFromUrl; // 今回は親へ（応答で新しい割り当てが返る）
      talkingToParent = true;
    }

    // 端末の学校名も heartbeat で GAS へ送る。
    // これが無いと GAS 側は端末一覧を「学校名 = 未設定」で登録してしまい、
    // 管理ポリシーで school_name を配布してもシートに反映されない。
    // （教員の学校スコープ判定はシートの学校名を使うため、未設定のままだと全校の教員から見える）
    let schoolNameForGas = String(data.school_name || '').trim();
    if (schoolNameForGas === '未設定') schoolNameForGas = '';

    // 解決できない場合（学校未確定・マップ未取得）は managed storage を再確認する。
    if (!effectiveGasUrl || !data.school_name || data.school_name === '未設定') {
      const managed = await getManagedPolicy();
      const merged = {
        school_name: pickMeaningfulSchoolName(data.school_name, managed.school_name),
        gas_url_map: (data.gas_url_map && Object.keys(data.gas_url_map).length)
          ? data.gas_url_map
          : (managed.gas_url_map || {}),
        gas_url: data.gas_url || managed.gas_url || ''
      };
      const managedGasUrl = resolveGasUrl(merged);
      if (managedGasUrl) effectiveGasUrl = managedGasUrl;

      if (!schoolNameForGas && merged.school_name && merged.school_name !== '未設定') {
        schoolNameForGas = merged.school_name;
      }

      // ポリシー由来の値が保存されていなければ補完保存する
      const persist = {};
      if (merged.gas_url_map && Object.keys(merged.gas_url_map).length &&
          (!data.gas_url_map || !Object.keys(data.gas_url_map).length)) {
        persist.gas_url_map = merged.gas_url_map;
      }
      if (merged.school_name && merged.school_name !== '未設定' &&
          merged.school_name !== data.school_name) {
        persist.school_name = merged.school_name;
      }
      if (merged.gas_url && merged.gas_url !== data.gas_url) {
        persist.gas_url = merged.gas_url;
      }
      if (Object.keys(persist).length) await chrome.storage.local.set(persist);
    }

    if (!effectiveGasUrl || !studentId) {
      // GAS URL または 児童ID が未設定の場合は同期不可
      await recordSyncDiag(false, 'not_configured',
        !effectiveGasUrl ? 'GAS WebアプリURLが未設定です'
                         : '児童ID（Googleアカウント）が未設定です');
      return;
    }

    // 現在のアクティブタブのURLを取得
    const currentUrl = await getActiveTabUrl();

    // GASへPOSTリクエスト
    const payload = {
      action: 'heartbeat',
      student_id: studentId,
      current_url: currentUrl,
      // 端末の学校名（未確定なら空文字）。GAS はこれで端末一覧の学校名を補完する。
      school_name: schoolNameForGas
    };

    // タイムアウト付きで送信する（応答が返らない場合でも syncInFlight を解放し、
    // 以後の同期が永久に止まらないようにする）。
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, SYNC_TIMEOUT_MS);
    }
    let response;
    try {
      response = await fetch(effectiveGasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8' // GAS Web App のCORS制約対策
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      console.warn('[EduAgent] GASレスポンスエラー:', response.status);
      await recordSyncDiag(false, 'http_' + response.status,
        'GASが HTTP ' + response.status + ' を返しました（URLの誤り／デプロイ権限を確認）');
      return;
    }

    let resJson;
    try {
      resJson = await response.json();
    } catch (e) {
      // GAS がログイン画面（HTML）を返した場合などに該当する。
      await recordSyncDiag(false, 'not_json',
        'GASの応答がJSONではありません（Webアプリの「アクセスできるユーザー」を確認）');
      return;
    }
    if (!resJson.success) {
      console.warn('[EduAgent] 同期エラー:', resJson.error);
      await recordSyncDiag(false, 'gas_error',
        'GASがエラーを返しました: ' + String(resJson.error || '(詳細なし)'));
      return;
    }

    // 子GAS分散: 親からの割り当て（assigned_gas_url）を保存し、次回以降の通信先を切り替える。
    // ※ applyPolicies より先に評価するため、data（更新前）と実使用URLを渡す。
    await applyShardAssignment(resJson, data, effectiveGasUrl, talkingToParent);

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

    await recordSyncDiag(true, 'ok', '');

  } catch (err) {
    console.error('[EduAgent] 通信エラー:', err);
    try {
      const detail = String((err && err.message) ? err.message : err);
      await recordSyncDiag(false, 'network',
        'GASへ到達できません（URL・ネットワーク・公開範囲を確認）: ' + detail);
    } catch (e2) {}
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
    // GAS は教員が紐付けるまで「未設定」を返すため、そのまま採用すると
    // 管理ポリシーで配布した学校名が毎回失われる。意味のある値だけを採用する。
    school_name: pickMeaningfulSchoolName(newPolicy.school_name, oldStorage.school_name),
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
 * ウィンドウのフォーカス変化を監視（停止後も教員が端末を操作したら即復帰）。
 * 児童が「ロック画面のみ」を表示している等で他タブが無い場合、教員がコンソールを開いても
 * タブ作成/更新イベントが拾えないことがある。ウィンドウのフォーカス変化（＝人が端末を操作した）
 * で SW が起きるため、ここでアクティブタブを確認して復帰判定する。
 * ※ 稼働中は resumeFromConsoleTab が即 return するため負荷はない。停止中の起床も操作時のみ。
 */
if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.url) resumeFromConsoleTab(tab.url);
    } catch (e) {}
  });
}

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
    // 診断（直接読み込み版のポップアップ表示用）。
    // 同期の多重実行中は syncWithGas が即 return するため、その場合も直前の結果を返す。
    syncWithGas().then(() => {
      chrome.storage.local.get(null).then(data => {
        sendResponse({ success: true, data, diag: lastSyncDiag });
      });
    }).catch(err => {
      sendResponse({ success: false, error: err.toString(), diag: lastSyncDiag });
    });
    return true;
  }
  if (message.type === 'GET_SYNC_DIAG') {
    sendResponse({ success: true, diag: lastSyncDiag });
    return true;
  }
  // 疎通確認（直接読み込み版の設定画面から手動で実行される）。
  if (message.type === 'TEST_CONNECTION') {
    testGasConnection(message.url).then(function (r) { sendResponse(r); })
      .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
    return true;
  }
  // 通信状態の取得（直接読み込み版のポップアップ表示用・通信は発生しない）。
  if (message.type === 'GET_STATUS_FULL') {
    let probe = null;
    try { probe = getProbeBand(Date.now()); } catch (e) { probe = null; }
    sendResponse({
      ok: true,
      status: {
        ka_active: !!keepaliveActive,
        sync_interval_sec: keepaliveActive ? (activeIntervalMs / 1000) : 0,
        idle_drift_until: idleDriftUntil || 0,
        probe: probe
      }
    });
    return true;
  }
});
