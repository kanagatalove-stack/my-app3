// --- portable path prelude: 絶対パス(/home/user/webapp/...)を tests からの相対へ解決 ---
(function(){
  const fs0 = require('fs'); const path0 = require('path');
  const PREFIX = '/home/user/webapp/';
  const _rf = fs0.readFileSync;
  fs0.readFileSync = function(p, ...a){
    if (typeof p === 'string' && p.startsWith(PREFIX)) {
      p = path0.join(__dirname, '..', p.slice(PREFIX.length));
    }
    return _rf.call(this, p, ...a);
  };
})();
// ============================================================================
// r51: 性能・負荷アーキテクチャ（3点）の回帰テスト
//
//  実機症状
//    親GAS 1 + 子GAS 6 の構成で、端末接続直後の「最初の1回だけ」ロック操作が
//    26〜30 秒かかり、一度反映された後の2回目以降は 5〜6 秒で全校に揃う。
//
//  確定方針（3点・gas/Code.gs のみ・既存 shardFetchMany() は無変更）
//    [1] CacheService 先行返却
//        教員の制御操作（ロック／解除／一斉表示／URL規制）を受けた時点で
//        状態を CacheService へ即時反映し、buildHeartbeatResponse は
//        シートの読み書き完了を待たずに最新状態を返す。
//    [2] 過負荷時の動的バックオフ
//        通常は ACTIVE_SYNC_INTERVAL_SEC = 1.5 秒のまま。同時実行やシート遅延が
//        閾値を超えたときだけ sync_interval_sec を一時的に緩和（4秒）し、
//        負荷が下がれば即 1.5 秒へ戻す（Service invoked too many times の予防）。
//    [3] 初回接続・経路切替時のアイドル排除
//        初回応答で ka_active=true / sync_interval_sec=1.5 と最新の制御状態を返し、
//        端末が 20〜30 秒のアイドル（同期停止）へ入らないようにする。
//
//  検証対象
//    A. CacheService 先行キャッシュ（書込・読取・マージ・削除・一括先行反映）
//    B. buildHeartbeatResponse がキャッシュを最優先する（無ければシート値）
//    C. 過負荷時のみ緩和し、負荷が下がれば即 1.5 秒へ戻る
//    D. 初回接続で稼働周期（1.5秒）と最新状態を返す
//    E. 制御操作がシート書き込み「前」に先行反映する（順序の検証）
//    F. 不変条件（1.5秒維持・固定仕様の非改変・シート書込ゼロ）
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

// --- 関数を波括弧の対応を数えて切り出す ---
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found fn: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
// --- `var NAME = ...;` の1行定義を切り出す ---
function lineVar(name) {
  const m = src.match(new RegExp('^var ' + name + '\\s*=[^;]*;', 'm'));
  if (!m) throw new Error('not found var: ' + name);
  return m[0];
}

// 端末一覧の13列（本番 CONFIG.DEVICE_COLUMNS と同じ並び）
const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック',
  'URL規制モード', '許可URLリスト', '規制URLリスト',
  '一斉表示URL', '一斉表示実行ID', '現在開いているURL', '最終同期日時', '備考'];

const NOW = 1762500000000;

// --- 観測用: キャッシュ操作とシート書き込みの「順序」を記録する ---
const events = [];
const store = new Map();
const cacheApi = {
  get(k) { return store.has(k) ? store.get(k) : null; },
  put(k, v) { events.push('cache'); store.set(k, String(v)); },
  remove(k) { store.delete(k); },
  getAll(keys) {
    const o = {};
    (keys || []).forEach(function (k) { if (store.has(k)) o[k] = store.get(k); });
    return o;
  },
  putAll(obj) {
    events.push('cache');
    Object.keys(obj || {}).forEach(function (k) { store.set(k, String(obj[k])); });
  }
};

function makeSheet(cols, rows) {
  const s = { _cols: cols.slice(), _rows: rows.map(function (r) { return r.slice(); }), _writes: 0 };
  s.getLastColumn = function () { return s._cols.length; };
  s.getDataRange = function () {
    return { getValues: function () { return s._rows.map(function (r) { return r.slice(); }); } };
  };
  s.getRange = function (r, c, nr, nc) {
    const h = nr || 1, w = nc || 1;
    return {
      getValues: function () {
        const out = [];
        for (let i = 0; i < h; i++) out.push(s._rows[r - 1 + i].slice(c - 1, c - 1 + w));
        return out;
      },
      setValues: function (vals) {
        events.push('setValues'); s._writes++;
        for (let i = 0; i < vals.length; i++) {
          for (let j = 0; j < vals[i].length; j++) s._rows[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      },
      setValue: function (v) {
        events.push('setValues'); s._writes++;
        s._rows[r - 1][c - 1] = v;
      }
    };
  };
  return s;
}

const headerMap = {};
DEVICE_COLUMNS.forEach(function (c, i) { headerMap[c] = i + 1; });

function mkRow(over) {
  const r = DEVICE_COLUMNS.map(function () { return ''; });
  Object.keys(over || {}).forEach(function (k) { r[headerMap[k] - 1] = over[k]; });
  return r;
}

let logLines = [];
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean,
  isNaN, isFinite, parseInt, parseFloat, Set, Map, RegExp,
  Logger: { log(msg) { logLines.push(String(msg)); } },
  CacheService: { getScriptCache() { return cacheApi; } },
  LockService: {
    getScriptLock() {
      return { waitLock() {}, releaseLock() {} };
    }
  },
  getTargetSheet() { return ctx.__SHEET; },
  // bulkUpdate* は CONFIG.DEVICE_SHEET_NAME と見出し列を使う
  CONFIG: { DEVICE_SHEET_NAME: '端末一覧', DEVICE_COLUMNS: DEVICE_COLUMNS.slice() },
  // server_time_ms を固定するため、シート日時解釈はスタブ化する
  sheetTsToMs() { return NOW; },
  // 予約配信はこのテストの対象外（空ペイロード）
  resolveSchedulePayloadForDevice_() {
    return { active: [], upcoming: [], overridden_ids: [] };
  }
};
vm.createContext(ctx);

let code = '';
[
  'normalizeIdKey', 'parseBoolean', 'parseUrlList',
  'normalizeHostListToArray_', 'hostListToSheetString_',
  // A. 先行キャッシュ
  'hbStateCacheKey_', 'hbWriteStateCache_', 'hbReadStateCache_', 'hbClearStateCache_',
  'hbPrimeStateCacheMany_', 'hbPrimeControlState_',
  // C. 負荷バックオフ
  'hbReadLoad_', 'hbWriteLoad_', 'hbRecordLoad_', 'hbIsBackoffActive_', 'hbThrottleIntervalSec_',
  // D. 初回接続
  'hbFirstContactKey_', 'hbIsFirstContact_', 'hbActiveIntervalSec_', 'hbFinishHeartbeat_',
  // B. 応答組み立て（TTL マスク経由）
  'broadcastTtlMs_', 'parseBroadcastIssuedMs_', 'maskStaleBroadcast_', 'buildHeartbeatResponse',
  // E. 制御操作（先行反映の配線）
  'getHeaderMap', 'withWriteLock', 'generateBroadcastId',
  'bulkUpdateScreenLock', 'bulkUpdateBroadcastUrl', 'bulkUpdateFilterMode'
].forEach(function (n) { code += extract(n) + '\n'; });

// 定数（本番と同じ値をそのまま使う）
['BROADCAST_TTL_MIN_MS', 'HB_STATE_CACHE_PREFIX', 'HB_STATE_CACHE_SEC', 'HB_STATE_CACHE_CHUNK',
 'HB_FIRST_CONTACT_PREFIX', 'HB_FIRST_CONTACT_SEC',
 'HB_LOAD_CACHE_KEY', 'HB_LOAD_WINDOW_MS', 'HB_LOAD_SLOW_MS', 'HB_LOAD_SLOW_RATIO',
 'HB_LOAD_ERR_RATIO', 'HB_BACKOFF_SEC', 'HB_BACKOFF_HOLD_MS'
].forEach(function (n) { code += lineVar(n) + '\n'; });
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e ? '=> ' + JSON.stringify(e) : ''); fail++; }
}
function resetObservers() { events.length = 0; }

// ============================================================================
// A. CacheService 先行キャッシュ
// ============================================================================
console.log('\n===== A. 制御状態のメモリ先行キャッシュ（CacheService） =====');

store.clear();
check('A1 状態キャッシュのキーは児童IDから決まる（接頭辞 hb_state:）',
  ctx.hbStateCacheKey_('s1') === 'hb_state:s1', ctx.hbStateCacheKey_('s1'));
check('A2 児童IDが空ならキーを作らない（書き込まない）',
  ctx.hbStateCacheKey_('') === '' && ctx.hbStateCacheKey_(null) === '');
check('A3 児童IDは正規化される（前後空白・大文字を同一視）',
  ctx.hbStateCacheKey_('  ABCD@x.JP ') === ctx.hbStateCacheKey_('abcd@x.jp'));

check('A4 状態を書き込める', ctx.hbWriteStateCache_('s1', { screen_lock: true }) === true);
const c1 = ctx.hbReadStateCache_('s1');
check('A5 書き込んだ状態を読み戻せる（ロック=true）',
  !!c1 && c1.screen_lock === true, c1);
check('A6 書込時刻 __at が付く（鮮度判定用）',
  !!c1 && typeof c1.__at === 'number' && c1.__at > 0);

ctx.hbWriteStateCache_('s1', { filter_mode: 'BLACKLIST' });
const c2 = ctx.hbReadStateCache_('s1');
check('A7 項目単位でマージされる（ロックを消さずに規制モードを足す）',
  !!c2 && c2.screen_lock === true && c2.filter_mode === 'BLACKLIST', c2);
check('A8 未設定の項目は書き込まない（undefined は無視）',
  !('blacklist_urls' in (c2 || {})));
check('A9 キャッシュが無い児童は null（＝シート値へフォールバック）',
  ctx.hbReadStateCache_('nobody') === null);
store.set(ctx.hbStateCacheKey_('broken'), '{壊れたJSON');
check('A10 壊れたJSONは null（安全側に倒す）',
  ctx.hbReadStateCache_('broken') === null);
check('A11 削除できる', ctx.hbClearStateCache_('s1') === true && ctx.hbReadStateCache_('s1') === null);

store.clear();
check('A12 複数児童へ一括で先行反映できる（1,600台でも呼び出しは数回）',
  ctx.hbPrimeStateCacheMany_(['a1', 'a2', 'a3'], { screen_lock: true }) === 3);
check('A13 一括反映した全員が同じ状態になる',
  ctx.hbReadStateCache_('a1').screen_lock === true &&
  ctx.hbReadStateCache_('a2').screen_lock === true &&
  ctx.hbReadStateCache_('a3').screen_lock === true);
check('A14 一括反映は既存項目を壊さない（マージ）',
  (function () {
    store.set(ctx.hbStateCacheKey_('a1'), JSON.stringify({ filter_mode: 'WHITELIST' }));
    ctx.hbPrimeStateCacheMany_(['a1'], { screen_lock: false });
    const o = ctx.hbReadStateCache_('a1');
    return o.screen_lock === false && o.filter_mode === 'WHITELIST';
  })());

store.clear();
const CHUNK = 90;
(function () {
  const ids = [];
  for (let i = 0; i < CHUNK * 2 + 20; i++) ids.push('bulk' + i);
  resetObservers();
  ctx.hbPrimeStateCacheMany_(ids, { screen_lock: true });
  const cacheOps = events.filter(function (e) { return e === 'cache'; }).length;
  check('A15 大量の児童でも一括API（putAll）でまとめて書く（1台ずつ書かない）',
    cacheOps === 3, { putAllCalls: cacheOps, ids: ids.length });
  check('A16 大量反映でも全員に反映される',
    ctx.hbReadStateCache_('bulk0').screen_lock === true &&
    ctx.hbReadStateCache_('bulk' + (CHUNK * 2 + 19)).screen_lock === true);
})();

check('A17 配列でない指定（ALL / null）は先行反映しない（対象が確定できないため）',
  ctx.hbPrimeControlState_('ALL', { screen_lock: true }) === 0 &&
  ctx.hbPrimeControlState_(null, { screen_lock: true }) === 0);

// ============================================================================
// B. buildHeartbeatResponse はキャッシュを最優先する
// ============================================================================
console.log('\n===== B. 応答組み立てはキャッシュを最優先（シート完了を待たない） =====');

function hbReq(rowOverride, kaInfo, cacheState) {
  store.clear();
  const row = mkRow(Object.assign({
    '児童ID': 's1', '学校名': '第一小学校', '氏名': '第一 一郎', 'クラス': '5年1組',
    '画面ロック': false, 'URL規制モード': 'OFF', '許可URLリスト': '', '規制URLリスト': ''
  }, rowOverride || {}));
  if (cacheState) store.set(ctx.hbStateCacheKey_('s1'), JSON.stringify(cacheState));
  return ctx.buildHeartbeatResponse(row, headerMap, 's1', true,
    kaInfo || { sync_interval_sec: 1.5, idle_drift_until: 0 }, '2026/11/07 10:00:00');
}

const rNoCache = hbReq({});
check('B1 キャッシュが無ければ従来どおりシート値を返す（退行なし）',
  rNoCache.screen_lock === false && rNoCache.filter_mode === 'OFF', {
    lock: rNoCache.screen_lock, filter: rNoCache.filter_mode
  });

const rCacheLock = hbReq({ '画面ロック': false }, null, { screen_lock: true });
check('B2 シートが false でもキャッシュが true ならロック済みで返す（先行返却）',
  rCacheLock.screen_lock === true);

const rCacheFilter = hbReq({ 'URL規制モード': 'OFF' }, null,
  { filter_mode: 'BLACKLIST', blacklist_urls: ['youtube.com'] });
check('B3 URL規制モードもキャッシュ優先で返す',
  rCacheFilter.filter_mode === 'BLACKLIST');
check('B4 規制URLリストもキャッシュ優先で返す',
  Array.isArray(rCacheFilter.blacklist_urls) &&
  rCacheFilter.blacklist_urls.indexOf('youtube.com') >= 0, rCacheFilter.blacklist_urls);

const rCacheWhite = hbReq({}, null, { filter_mode: 'WHITELIST', whitelist_urls: ['nhk.or.jp'] });
check('B5 許可URLリストもキャッシュ優先で返す',
  Array.isArray(rCacheWhite.whitelist_urls) &&
  rCacheWhite.whitelist_urls.indexOf('nhk.or.jp') >= 0);

const rPartial = hbReq({ '画面ロック': true }, null, { filter_mode: 'BLACKLIST' });
check('B6 キャッシュに一部の項目しか無い場合は、残りをシート値で補う',
  rPartial.screen_lock === true && rPartial.filter_mode === 'BLACKLIST');

check('B7 通常時は同期周期が 1.5 秒のまま（緩和しない）',
  hbReq({}).sync_interval_sec === 1.5, hbReq({}).sync_interval_sec);
check('B8 非稼働（0）なら 0 のまま（眠っている端末を起こさない）',
  hbReq({}, { sync_interval_sec: 0, idle_drift_until: NOW + 20000 }).sync_interval_sec === 0);
check('B9 応答の他項目（氏名・クラス・ka_active）は壊れない',
  (function () {
    const r = hbReq({});
    return r.student_id === 's1' && r.student_name === '第一 一郎' &&
      r.class_name === '5年1組' && r.ka_active === true;
  })());

// ============================================================================
// C. 過負荷時のみ緩和し、負荷が下がれば即 1.5 秒へ戻る
// ============================================================================
console.log('\n===== C. 過負荷時の動的バックオフ（通常は 1.5 秒のまま） =====');

store.clear();
const EMPTY_LOAD = ctx.hbReadLoad_();
check('C1 観測が無ければ「重くない」と判定する',
  EMPTY_LOAD.total === 0 && EMPTY_LOAD.until === 0, EMPTY_LOAD);
check('C2 平常時は 1.5 秒をそのまま配る',
  ctx.hbThrottleIntervalSec_(1.5, NOW) === 1.5);
check('C3 非稼働（0）は緩和しない（0 のまま）',
  ctx.hbThrottleIntervalSec_(0, NOW) === 0);
check('C4 不正な周期指定は 0 を返す（端末を暴走させない）',
  ctx.hbThrottleIntervalSec_('abc', NOW) === 0);

store.clear();
ctx.hbRecordLoad_(100, false, NOW);       // 速い
ctx.hbRecordLoad_(100, false, NOW + 1);   // 速い
ctx.hbRecordLoad_(100, false, NOW + 2);   // 速い
check('C5 件数が閾値未満なら閾値超えの遅延があっても緩和しない（判断しない）',
  ctx.hbIsBackoffActive_(NOW + 3) === false);

ckSlow();
function ckSlow() {
  store.clear();
  ctx.hbRecordLoad_(4000, false, NOW);      // 遅い（>2.5秒）
  ctx.hbRecordLoad_(4000, false, NOW + 1);
  ctx.hbRecordLoad_(4000, false, NOW + 2);
  ctx.hbRecordLoad_(4000, false, NOW + 3);
  check('C6 遅い処理が閾値割合を超えると緩和に入る',
    ctx.hbIsBackoffActive_(NOW + 4) === true);
  check('C7 緩和中は 4 秒（3〜5秒の範囲内）へ緩和する',
    ctx.hbThrottleIntervalSec_(1.5, NOW + 4) === 4,
    ctx.hbThrottleIntervalSec_(1.5, NOW + 4));
  check('C8 緩和中でも非稼働（0）は 0 のまま',
    ctx.hbThrottleIntervalSec_(0, NOW + 4) === 0);
}

store.clear();
ctx.hbRecordLoad_(5000, true, NOW);
ctx.hbRecordLoad_(5000, true, NOW + 1);
ctx.hbRecordLoad_(5000, true, NOW + 2);
ctx.hbRecordLoad_(5000, true, NOW + 3);
check('C9 エラー率が閾値を超えても緩和に入る',
  ctx.hbIsBackoffActive_(NOW + 4) === true);

store.clear();
ctx.hbRecordLoad_(4000, false, NOW);
ctx.hbRecordLoad_(4000, false, NOW + 1);
ctx.hbRecordLoad_(4000, false, NOW + 2);
ctx.hbRecordLoad_(4000, false, NOW + 3);
const earlyUntil = ctx.hbReadLoad_().until;
check('C10 緩和は最低 HB_BACKOFF_HOLD_MS 秒続く（ばたつかせない）',
  earlyUntil - (NOW + 3) >= 29000, { holdMs: earlyUntil - (NOW + 3) });
check('C11 緩和期限を過ぎたら即 1.5 秒へ戻る（下げっぱなしにしない）',
  ctx.hbIsBackoffActive_(earlyUntil + 1) === false &&
  ctx.hbThrottleIntervalSec_(1.5, earlyUntil + 1) === 1.5);
check('C12 緩和中にさらに重くなると期限は延びる（短くはならない）',
  (function () {
    const before = ctx.hbReadLoad_().until;
    ctx.hbRecordLoad_(9000, true, earlyUntil - 1000);
    return ctx.hbReadLoad_().until >= before;
  })());

store.clear();
store.set('hb_load_v1', JSON.stringify({ slow: 10, total: 10, err: 0, since: NOW - 70000, until: 0 }));
const afterWindow = ctx.hbRecordLoad_(0, false, NOW);
check('C13 観測窓（60秒）を過ぎたらカウントをリセットする（古い重さを引きずらない）',
  afterWindow.total === 1 && afterWindow.slow === 0 && afterWindow.since === NOW, afterWindow);
check('C14 リセット後は緩和しない',
  ctx.hbIsBackoffActive_(NOW + 1) === false);

const loadCalls = (extract('hbRecordLoad_').match(/hbWriteLoad_\(/g) || []).length;
check('C15 負荷観測は CacheService のみ（シートへは一切書かない）',
  !/setValue|setValues|getRange|getDataRange/.test(extract('hbRecordLoad_')) && loadCalls === 1);

// ============================================================================
// D. 初回接続で稼働周期（1.5秒）と最新状態を返す
// ============================================================================
console.log('\n===== D. 初回接続・経路切替直後のアイドル排除 =====');

check('D1 稼働中の周期は 1.5 秒（ACTIVE_SYNC_INTERVAL_SEC を維持）',
  ctx.hbActiveIntervalSec_() === 1.5, ctx.hbActiveIntervalSec_());
check('D2 初回判定のキーは児童IDから決まる',
  ctx.hbFirstContactKey_(' x9@Y.JP ') === 'hb_fc:x9@y.jp', ctx.hbFirstContactKey_(' x9@Y.JP '));

store.clear();
const rowFirst = mkRow({ '児童ID': 'n1', '最終同期日時': '' });
check('D3 最終同期日時が空の端末は「初回接続」と判定する',
  ctx.hbIsFirstContact_('n1', rowFirst, headerMap, NOW) === true);
check('D4 初回判定は同一端末につき1回だけ（眠る端末を永久に起こさない）',
  ctx.hbIsFirstContact_('n1', rowFirst, headerMap, NOW + 1) === false);
check('D5 一度同期済みの行は初回扱いしない（通常判定に任せる）',
  ctx.hbIsFirstContact_('n2', mkRow({ '児童ID': 'n2', '最終同期日時': '2026/11/07 09:00:00' }),
    headerMap, NOW) === false);

store.clear();
const rFirst = (function () {
  // processHeartbeat の初回分岐と同じ組み立て（ka_active=true / 1.5秒）
  const kaInfo = { ka_active: true, sync_interval_sec: ctx.hbActiveIntervalSec_(), idle_drift_until: 0 };
  return hbReq({ '児童ID': 'n1', '最終同期日時': '' }, kaInfo, { screen_lock: true });
})();
check('D6 初回応答は ka_active=true / sync_interval_sec=1.5 で返る（端末が眠らない）',
  rFirst.ka_active === true && rFirst.sync_interval_sec === 1.5, {
    ka_active: rFirst.ka_active, sync_interval_sec: rFirst.sync_interval_sec
  });
check('D7 初回応答でも最新の制御状態（ロック済み）を同時に返す',
  rFirst.screen_lock === true);
check('D8 初回応答でアイドル猶予は 0（＝眠らせない）',
  rFirst.idle_drift_until === 0);

const fnHb = extract('processHeartbeat');
check('D9 processHeartbeat が初回接続を判定している（2経路: 既存行・新規登録）',
  (fnHb.match(/hbIsFirstContact_\(/g) || []).length === 2, {
    calls: (fnHb.match(/hbIsFirstContact_\(/g) || []).length
  });
check('D10 初回時は ka_active=true と稼働周期を上書きする',
  /kaInfo = \{ ka_active: true, sync_interval_sec: hbActiveIntervalSec_\(\)/.test(fnHb) ||
  /kaInfo = \{ ka_active: true, sync_interval_sec: fcInterval/.test(fnHb));
check('D11 初回判定は行解決の直後（シート書き込みより前）に行う',
  fnHb.indexOf('hbIsFirstContact_(studentId, resolved.row') > 0 &&
  fnHb.indexOf('hbIsFirstContact_(studentId, resolved.row') < fnHb.indexOf('hbApplyMonitor('));
check('D12 応答は必ず負荷観測を通してから返す（記録漏れなし）',
  (fnHb.match(/hbFinishHeartbeat_\(/g) || []).length === 3, {
    calls: (fnHb.match(/hbFinishHeartbeat_\(/g) || []).length
  });
check('D13 負荷観測は CacheService のみで完結する（シートI/Oゼロ）',
  !/setValue|setValues|getRange|getDataRange/.test(extract('hbFinishHeartbeat_')) &&
  extract('hbFinishHeartbeat_').indexOf('hbRecordLoad_') >= 0);

// ============================================================================
// E. 制御操作はシート書き込み「前」に先行反映する
// ============================================================================
console.log('\n===== E. 先行反映の順序（書き込み完了を待たせない） =====');

(function () {
  store.clear();
  const rows = [
    DEVICE_COLUMNS.slice(),
    mkRow({ '児童ID': 'k1', '画面ロック': false }),
    mkRow({ '児童ID': 'k2', '画面ロック': false })
  ];
  ctx.__SHEET = makeSheet(DEVICE_COLUMNS, rows);
  resetObservers();
  ctx.bulkUpdateScreenLock(['k1', 'k2'], true);
  const iCache = events.indexOf('cache');
  const iWrite = events.indexOf('setValues');
  check('E1 ロック操作はキャッシュ反映がシート書き込みより先',
    iCache >= 0 && iWrite >= 0 && iCache < iWrite, { cache: iCache, write: iWrite });
  check('E2 ロック状態がキャッシュに入る（次のハートビートが即返せる）',
    ctx.hbReadStateCache_('k1').screen_lock === true &&
    ctx.hbReadStateCache_('k2').screen_lock === true);
  check('E3 シートへの永続化も従来どおり行う（正しさは失わない）',
    ctx.__SHEET._writes > 0 && ctx.__SHEET._rows[1][headerMap['画面ロック'] - 1] === true);
})();

(function () {
  store.clear();
  const rows = [
    DEVICE_COLUMNS.slice(),
    mkRow({ '児童ID': 'b1', '一斉表示URL': '', '一斉表示実行ID': '' })
  ];
  ctx.__SHEET = makeSheet(DEVICE_COLUMNS, rows);
  resetObservers();
  const bid = ctx.bulkUpdateBroadcastUrl(['b1'], 'https://www.mext.go.jp/', 'bc_1762500000000_ab12c');
  const iCache = events.indexOf('cache');
  const iWrite = events.indexOf('setValues');
  check('E4 一斉表示は確定済みIDがあるとき先行反映する（新規タブ誤発火の材料を先に配る）',
    iCache >= 0 && iCache < iWrite, { cache: iCache, write: iWrite });
  check('E5 先行反映された一斉表示IDは採番済みIDと一致する',
    ctx.hbReadStateCache_('b1').broadcast_id === bid && bid === 'bc_1762500000000_ab12c');
  check('E6 シートにも従来どおり永続化する',
    ctx.__SHEET._rows[1][headerMap['一斉表示実行ID'] - 1] === bid);
})();

(function () {
  store.clear();
  const rows = [
    DEVICE_COLUMNS.slice(),
    mkRow({ '児童ID': 'f1', 'URL規制モード': 'OFF' })
  ];
  ctx.__SHEET = makeSheet(DEVICE_COLUMNS, rows);
  resetObservers();
  ctx.bulkUpdateFilterMode(['f1'], 'WHITELIST', 'nhk.or.jp', 'youtube.com');
  const iCache = events.indexOf('cache');
  const iWrite = events.indexOf('setValues');
  check('E7 URL規制はモード・許可・規制リストを先行反映する',
    iCache >= 0 && iCache < iWrite, { cache: iCache, write: iWrite });
  const fc = ctx.hbReadStateCache_('f1');
  check('E8 先行反映の内容が正しい（モード・許可・規制）',
    !!fc && fc.filter_mode === 'WHITELIST' &&
    fc.whitelist_urls.indexOf('nhk.or.jp') >= 0 &&
    fc.blacklist_urls.indexOf('youtube.com') >= 0, fc);
})();

check('E9 3つの一括操作すべてが先行反映を通している',
  /hbPrimeControlState_\(/.test(extract('bulkUpdateScreenLock')) &&
  /hbPrimeControlState_\(/.test(extract('bulkUpdateBroadcastUrl')) &&
  /hbPrimeControlState_\(/.test(extract('bulkUpdateFilterMode')));
check('E10 先行反映は排他ロック取得より前（ロック待ち 15 秒に巻き込まれない）',
  extract('bulkUpdateScreenLock').indexOf('hbPrimeControlState_(') <
  extract('bulkUpdateScreenLock').indexOf('return withWriteLock('));
check('E11 子GASの shard_apply も同じ一括操作を通るため子でも先行反映される',
  /bulkUpdateScreenLock\(/.test(extract('shardApplyFromParent')) &&
  /bulkUpdateFilterMode\(/.test(extract('shardApplyFromParent')));

// ============================================================================
// F. 不変条件（固定仕様の非改変）
// ============================================================================
console.log('\n===== F. 不変条件 =====');

check('F1 ACTIVE_SYNC_INTERVAL_SEC は 1.5 のまま',
  /^const ACTIVE_SYNC_INTERVAL_SEC = 1\.5;/m.test(src));
check('F2 14校（東粟倉小は廃校のため含めない）',
  !/東粟倉/.test(src) && (src.match(/小学校'|中学校'|樸学園'/g) || []).length >= 13);
check('F3 既存 shardFetchMany は無変更（UrlFetchApp.fetchAll を使う）',
  /function shardFetchMany\(/.test(src) &&
  /UrlFetchApp\.fetchAll\(/.test(extract('shardFetchMany')));
check('F4 MONITOR_SETTINGS_V1 のキー名を維持',
  /MONITOR_SETTINGS_V1/.test(src));
check('F5 先行キャッシュはシートへ書き込まない（読み書きAPIを一切呼ばない）',
  !/setValue|setValues|getRange|getDataRange/.test(extract('hbWriteStateCache_')) &&
  !/setValue|setValues|getRange|getDataRange/.test(extract('hbReadStateCache_')) &&
  !/setValue|setValues|getRange|getDataRange/.test(extract('hbPrimeStateCacheMany_')));
check('F6 buildHeartbeatResponse は1か所のまま（3経路の重複を作らない）',
  (src.match(/^function buildHeartbeatResponse\s*\(/gm) || []).length === 1);
check('F7 拡張機能の manifest は v1.6.12 のまま',
  JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8'))
    .version === '1.6.12');
check('F8 拡張機能の DEFAULT_GAS_URL は空文字のまま',
  /const DEFAULT_GAS_URL = '';/.test(
    fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8')));
check('F9 テレメトリの親シート書き戻しをしていない（負荷観測は CacheService のみ）',
  // hbRecordLoad_ は hbReadLoad_ / hbWriteLoad_ に委譲し、両者が CacheService だけを使う。
  //   ※ シートAPI（SpreadsheetApp / openById / setValue 等）へは一切触れないこと。
  /hbReadLoad_\(\)/.test(extract('hbRecordLoad_')) &&
  /hbWriteLoad_\(/.test(extract('hbRecordLoad_')) &&
  /CacheService\.getScriptCache\(\)/.test(extract('hbReadLoad_')) &&
  /CacheService\.getScriptCache\(\)/.test(extract('hbWriteLoad_')) &&
  !/SpreadsheetApp|openById/.test(extract('hbRecordLoad_') + extract('hbReadLoad_') +
    extract('hbWriteLoad_')));
check('F10 DIAG 計装（[SHARD-DIAG] / [BULK-TRACE]）は残っている',
  /\[SHARD-DIAG\]/.test(src) && /\[BULK-TRACE\]/.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
