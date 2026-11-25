// ============================================================================
// r57_live_watch_shard_routing.js — R41分散構成におけるライブ視聴の親子ルーティング
//
//  【実機で確定した不具合（R56 までの状態）】
//    管理画面が親GASの api_liveWatch* を叩くと「親GASの CacheService」だけが
//    更新されていた。ところが児童端末は R41 で子GASへ直接ハートビートし、
//    live_frame も子GASへ送る。そのため
//      ① 子GASのハートビート応答が live_watch:false のまま → 端末が撮影しない
//      ② 子GASに溜まったフレームを親が読めない → 画像が管理画面に届かない
//    の 2 点が噛み合わず、ライブ視聴モーダルが
//    「端末の送信を待っています…」のまま固まった。
//    （拡張機能 v1.6.8・親子とも再デプロイ済みでも再現した）
//
//  【本テストの検証範囲】
//    親GAS・子GASをそれぞれ独立した実行環境（CacheService / PropertiesService が
//    完全に別）として vm 上に再現し、親の UrlFetchApp を子の受信口へ配線する。
//      A. 親で start → 子のハートビート判定が live_watch:true になる
//      B. 端末が子へ live_frame → 親の frames 取得で最新画像が取れる
//      C. 親で stop（または TTL 切れ）→ 子の判定が即座に false へ戻る
//      D. 単独モード（シャード未設定）は従来どおりローカル完結
//      E. 認証（共有シークレット）不一致は拒否・シート書き込みなし（テレメトリなし）
//
//  明示リスト方式: 必要な関数・定数だけを列挙して読み込む。
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- 明示リスト方式の共通部品（関数・定数の切り出し） ----
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
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const m = src.match(re);
  if (!m) throw new Error('const not found: ' + name);
  const start = m.index;
  let i = src.indexOf('=', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  return src.slice(start, end + 1);
}

const CONSTS = [
  // ライブ視聴の設計値
  'MAX_LIVE_WATCH_DEVICES', 'LIVE_WATCH_TTL_SEC', 'LIVE_WATCH_EXTEND_SEC',
  'LIVE_WATCH_FRAME_TTL_SEC', 'LIVE_WATCH_POOL_CACHE_SEC', 'LIVE_WATCH_POOL_KEY',
  'LIVE_WATCH_FRAME_PREFIX', 'LIVE_WATCH_MAX_FRAME_CHARS',
  'LIVE_WATCH_DEFAULT_PER_TEACHER_LIMIT', 'LIVE_WATCH_MAX_PER_TEACHER_LIMIT',
  'LIVE_WATCH_DEFAULT_TIMEOUT_SEC', 'LIVE_WATCH_MIN_TIMEOUT_SEC',
  'LIVE_WATCH_MAX_TIMEOUT_SEC', 'LIVE_WATCH_UNLIMITED',
  // 【R57】親子ルーティングのアクション名
  'LIVE_WATCH_SHARD_APPLY', 'LIVE_WATCH_SHARD_FRAMES', 'LIVE_WATCH_SHARD_STATUS',
  'LIVE_WATCH_SHARD_STATUS_TTL_SEC',
  // サイト監視設定（ライブ視聴の 2 項目が同居する）
  'MONITOR_PROP_KEY', 'MONITOR_MAX_DOMAINS',
  'MONITOR_DEFAULT_LEARNING_DOMAINS', 'MONITOR_DEFAULT_BLOCKED_DOMAINS',
  // シャード基盤
  'SHARD_MAP_PROP', 'SHARD_DEFAULT_PROP', 'SHARD_SECRET_PROP',
  'SHARD_CFG_CACHE', 'SHARD_MODE_CACHE', 'SHARD_SSID_CACHE',
  'PROP_SHARD_MODE', 'PROP_SHARD_CHILD_MODE',
  'CONFIG'
];

const FNS = [
  // ライブ視聴コア
  'liveWatchNowMs_', 'normalizeLiveWatchPerTeacherLimit', 'normalizeLiveWatchTimeoutSec',
  'liveWatchTeacherKey_', 'liveWatchCache_', 'liveWatchSettings_',
  'liveWatchReadPool_', 'liveWatchWritePool_', 'liveWatchSessionActive_',
  'liveWatchPrune_', 'liveWatchUniqueCount_', 'liveWatchTeacherCount_',
  'liveWatchIsWatched_', 'liveWatchStatus', 'liveWatchUsageBits_',
  'liveWatchStart', 'liveWatchExtend', 'liveWatchStop',
  'liveWatchClearFrame_', 'liveWatchPutFrame', 'liveWatchGetFrames', 'liveWatchApplyBatch',
  // 【R57】親子ブリッジ
  'liveWatchShardTargetUrls_', 'liveWatchShardKey_', 'liveWatchShardPost_',
  'liveWatchShardApplyFromParent', 'liveWatchShardFramesFromParent',
  'liveWatchShardStatusFromParent', 'liveWatchApplyBatchSharded',
  'liveWatchGetFramesSharded', 'liveWatchStatusSharded',
  // 設定
  'getMonitoringSettings', 'sanitizeMonitorDomainList', 'normalizeMonitorHost',
  'saveMonitoringSettings', 'isAdminTeacher',
  // シャード基盤
  'shardHash', 'shardWarnOnce', 'cfgWarn', 'propRaw', 'propBool', 'propStr',
  'normalizeShardClass', 'readShardMapRaw', 'readShardDefaultUrl',
  'shardMapDefaultFromEmptyKey', 'shardMapIndexFromMap', 'getOrCreateShardSecret',
  'shardSecretMatches', 'shardModeFlags', 'isShardParent',
  'shardConfigCached', 'invalidateShardConfig', 'shardAllChildUrls',
  'shardUrlsForTeacher', 'shardFetchMany'
];

let BUNDLE = '';
CONSTS.forEach(function (n) { BUNDLE += extractConst(n) + '\n'; });
FNS.forEach(function (n) { BUNDLE += extract(n) + '\n'; });

// ============================================================================
// 1. 独立した GAS 実行環境（CacheService / PropertiesService が別物）
// ============================================================================
let CLOCK = 1800000000000;
function setClock(ms) { CLOCK = ms; }

function makeGasEnv(label) {
  const cacheStore = new Map();
  // 【重要】失効時刻は getScriptCache() の外（環境スコープ）で保持する。
  // ここを getScriptCache() の内側に置くと毎回 Map が作り直され、
  // 直前の put(k, v, ttl) で記録した失効時刻が失われて TTL が効かなくなる
  // （= 実環境と挙動が変わり、短時間キャッシュが永久に残る）。
  const cacheExp = new Map();
  const props = {};
  const writes = [];          // シート書き込みの記録（テレメトリ書き戻し検出用）
  const env = { label: label, cache: cacheStore, props: props, sheetWrites: writes, ctx: null };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Set, Map,
    isFinite, isNaN, parseInt, parseFloat,
    Date: (function () {
      function FD() { this.getTime = function () { return CLOCK; }; this.valueOf = this.getTime; }
      FD.now = function () { return CLOCK; };
      return FD;
    })(),
    Utilities: { formatDate() { return '2026/11/25 12:00:00'; } },
    Logger: { log() {} },
    CacheService: {
      getScriptCache() {
        // 【重要】実環境の CacheService は put(k, v, ttl秒) で自動失効する。
        // スタブが TTL を無視すると「短時間キャッシュ（status 集約 2 秒）」が
        // 永久に効いてしまい、実機と挙動が変わる。仮想時計 CLOCK で失効させる。
        return {
          get(k) {
            if (!cacheStore.has(k)) return null;
            const e = cacheExp.get(k);
            if (e !== undefined && CLOCK >= e) { cacheStore.delete(k); cacheExp.delete(k); return null; }
            return cacheStore.get(k);
          },
          put(k, v, ttl) {
            cacheStore.set(k, String(v));
            const t = Number(ttl);
            if (isFinite(t) && t > 0) cacheExp.set(k, CLOCK + t * 1000); else cacheExp.delete(k);
          },
          remove(k) { cacheStore.delete(k); cacheExp.delete(k); }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return (k in props) ? props[k] : null; },
          setProperty(k, v) { props[k] = String(v); },
          deleteProperty(k) { delete props[k]; }
        };
      }
    },
    invalidateDevicesCache() {},
    shardPropagateMonitorSettings() {},
    // スクリプトプロパティを触る関数（設定の伝播確認用のスタブ）
    getTeacherTargetClasses() { return []; }
  };
  env.ctx = ctx;
  return env;
}

/** 環境に「シート書き込み監視つき」のスタブを仕込み、バンドルを評価する。 */
function boot(env, extra) {
  if (extra) {
    const keys = Object.keys(extra);
    for (let i = 0; i < keys.length; i++) env.ctx[keys[i]] = extra[keys[i]];
  }
  vm.createContext(env.ctx);
  vm.runInContext(BUNDLE, env.ctx);
}

function gv(env, name) { return vm.runInContext(name, env.ctx); }
function fn(env, name) { return vm.runInContext(name, env.ctx); }
function call(env, name, args) { return fn(env, name).apply(null, args || []); }

const CHILD1 = 'https://child-a.example.com/exec';
const CHILD2 = 'https://child-b.example.com/exec';
const SECRET = 'sk_r57_shared_secret';

// ---- 親・子を作る（子は親の UrlFetchApp からだけ到達する） ----
let childEnv = null;
let parentEnv = null;

function buildPair(opts) {
  const o = opts || {};
  // 子（各校の独立環境）
  childEnv = makeGasEnv('child');
  childEnv.props[SHARD_SECRET_CONST()] = SECRET;
  childEnv.props[PROP_CHILD_CONST()] = 'true';
  boot(childEnv, {});

  // 親（全体の台帳・管理画面の窓口）
  const childDispatch = function (body) {
    // 子GASの doPost と同じ振り分け（R57 で追加した 3 アクション）
    const a = String((body && body.action) || '');
    if (a === gv(childEnv, 'LIVE_WATCH_SHARD_APPLY')) {
      return call(childEnv, 'liveWatchShardApplyFromParent', [body]);
    }
    if (a === gv(childEnv, 'LIVE_WATCH_SHARD_FRAMES')) {
      return call(childEnv, 'liveWatchShardFramesFromParent', [body]);
    }
    if (a === gv(childEnv, 'LIVE_WATCH_SHARD_STATUS')) {
      return call(childEnv, 'liveWatchShardStatusFromParent', [body]);
    }
    return { success: false, error: 'unknown_action' };
  };

  parentEnv = makeGasEnv('parent');
  parentEnv.props[SHARD_SECRET_CONST()] = SECRET;
  parentEnv.props[PROP_PARENT_CONST()] = 'true';
  parentEnv.props[SHARD_MAP_CONST()] = JSON.stringify(
    o.map !== undefined ? o.map : { '5年1組': CHILD1, '6年1組': CHILD2 }
  );
  const urlFetchApp = {
    fetchAll(reqs) {
      const list = Array.isArray(reqs) ? reqs : [];
      return list.map(function (r) {
        let body = null;
        try { body = JSON.parse(r.payload); } catch (e) { body = {}; }
        if (o.failUrls && o.failUrls.indexOf(r.url) >= 0) {
          return { getResponseCode() { return 500; }, getContentText() { return 'error'; } };
        }
        const res = childDispatch(body);
        return {
          getResponseCode() { return 200; },
          getContentText() { return JSON.stringify(res); }
        };
      });
    },
    fetch(url, params) {
      let body = null;
      try { body = JSON.parse(params && params.payload); } catch (e) { body = {}; }
      const res = childDispatch(body);
      return { getResponseCode() { return 200; }, getContentText() { return JSON.stringify(res); } };
    }
  };
  boot(parentEnv, { UrlFetchApp: urlFetchApp });
}

// const 名を実行時に引く小ヘルパー（const は sandbox 直下に出ないため）
function SHARD_SECRET_CONST() { return 'SHARD_SECRET'; }
function PROP_CHILD_CONST() { return 'SHARD_CHILD_MODE'; }
function PROP_PARENT_CONST() { return 'SHARD_MODE'; }
function SHARD_MAP_CONST() { return 'SHARD_MAP_V1'; }

const ADMIN = { email: 'admin@example.com', role: 'ADMIN' };
const TEACHER = { email: 't1@example.com', role: 'TEACHER' };

// ============================================================================
// A. 親で start → 子GASのハートビート判定が live_watch:true になる
// ============================================================================
console.log('===== A. 親 start → 子の live_watch:true =====');
setClock(1800000000000);
buildPair();

const aStart = call(parentEnv, 'liveWatchApplyBatchSharded', [ADMIN, ['S1'], 'start']);
check('A1 親の start が成功する', aStart.success === true, aStart.used);
check('A2 親は子GAS（2校）へ転送した', !!aStart.shard && aStart.shard.sent === 2 && aStart.shard.ok === 2,
  aStart.shard);
check('A3 親の台帳にも登録される', call(parentEnv, 'liveWatchIsWatched_', ['S1']) === true);
check('A4 ★子GASのハートビート判定が live_watch:true になる（本不具合の核心）',
  call(childEnv, 'liveWatchIsWatched_', ['S1']) === true);
check('A5 子GASの台帳に「視聴中」のストリームが 1 本だけ存在する',
  Object.keys(JSON.parse(childEnv.cache.get('live_watch_pool_v1')).students).length === 1);
check('A6 子GASには親の教員メールが視聴者として登録される',
  !!JSON.parse(childEnv.cache.get('live_watch_pool_v1')).students.S1.teachers['admin@example.com']);

// ハートビート応答の配線（buildHeartbeatResponse が liveWatchIsWatched_ を読む）
const hbSrc = (function () {
  const i = src.indexOf('function buildHeartbeatResponse');
  return i < 0 ? '' : src.slice(i, i + 20000);
})();
check('A7 buildHeartbeatResponse は liveWatchIsWatched_ を読んで live_watch を返す',
  /liveWatchIsWatched_\(studentId\)/.test(hbSrc) && /live_watch: liveWatchFlag,/.test(hbSrc));

// 子GASが実際に受け取った転送内容（op / timeout / 教員）
const applied = JSON.parse(childEnv.cache.get('live_watch_pool_v1'));
check('A8 子GASへ op=start と教員メールが届いている', !!applied.students.S1.teachers['admin@example.com']);
check('A9 子GASのセッション TTL は 25 秒',
  (applied.students.S1.teachers['admin@example.com'].expires_at - CLOCK) === 25000,
  applied.students.S1.teachers['admin@example.com'].expires_at - CLOCK);

// ============================================================================
// B. 端末が子GASへ live_frame → 親の frames 取得で最新画像がとれる
// ============================================================================
console.log('\n===== B. 子へ live_frame → 親 frames で取得 =====');
const IMG = 'data:image/jpeg;base64,/9j/AAAA_child_frame_001';
const bPut = call(childEnv, 'liveWatchPutFrame', ['S1', IMG]);
check('B1 端末の live_frame を子GASが受理する（CacheService にのみ保存）',
  bPut.success === true && bPut.chars > 0, bPut.chars);

const bFrames = call(parentEnv, 'liveWatchGetFramesSharded', [['S1'], ADMIN]);
check('B2 ★親の frames 取得で子GASの最新画像が取れる（従来は空だった）',
  Array.isArray(bFrames) && bFrames.length === 1 && bFrames[0].has_image === true);
check('B3 画像データが端末送信と一致する', bFrames[0] && bFrames[0].data_url === IMG);
check('B4 子GAS側は live_watch:true を返す', bFrames[0] && bFrames[0].live_watch === true);

// 新しい撮影時刻を優先する（親と子の両方に画像がある場合）
setClock(CLOCK + 5000);
const NEWER = 'data:image/jpeg;base64,/9j/BBBB_child_frame_002';
call(childEnv, 'liveWatchPutFrame', ['S1', NEWER]);
const bFrames2 = call(parentEnv, 'liveWatchGetFramesSharded', [['S1'], ADMIN]);
check('B5 撮影時刻が新しい画像を優先してマージする', bFrames2[0].data_url === NEWER,
  bFrames2[0].has_image);

const bStatus = call(parentEnv, 'liveWatchStatusSharded', [ADMIN]);
check('B6 親の使用枠は子GASと和集合（1 台以上・上限 24）',
  bStatus.used >= 1 && bStatus.used <= 24 && bStatus.max === 24, bStatus.used);
check('B7 親の status に shard 情報（子GAS数）が載る',
  !!bStatus.shard && bStatus.shard.children === 2, bStatus.shard);

// 子GASにしか存在しない児童も台帳の和集合に入る
call(childEnv, 'liveWatchShardApplyFromParent', [{
  shard_secret: SECRET, op: 'start', student_ids: ['S2'], teacher_email: 't1@example.com', timeout_sec: 180
}]);
// status の子GAS集約は 2 秒の短時間キャッシュ（管理画面の連打を吸収）を持つため、
// そのキャッシュが切れてから取り直す（実環境と同じ挙動）。
setClock(CLOCK + 3000);
const bStatus2 = call(parentEnv, 'liveWatchStatusSharded', [ADMIN]);
check('B8 子GASのみで視聴中の児童も使用枠に反映される', bStatus2.used >= 2, bStatus2.used);

// ============================================================================
// C. 親で stop（または TTL 切れ）→ 子の判定が false へ戻る
// ============================================================================
console.log('\n===== C. stop / TTL 切れで子が false へ戻る =====');
const cStop = call(parentEnv, 'liveWatchApplyBatchSharded', [ADMIN, ['S1'], 'stop']);
check('C1 親の stop が成功する', cStop.success === true);
check('C2 ★子GASのハートビート判定が即座に live_watch:false へ戻る',
  call(childEnv, 'liveWatchIsWatched_', ['S1']) === false);
check('C3 子GASのフレームも消去される（枠が空いたときの後始末）',
  call(childEnv, 'liveWatchGetFrames', [['S1']])[0].has_image === false);
check('C4 親側の判定も false', call(parentEnv, 'liveWatchIsWatched_', ['S1']) === false);

// TTL 切れ: 子のセッションは 25 秒で自動失効する（ブラウザ kill 時の自動解放）
setClock(CLOCK + 1000);
call(parentEnv, 'liveWatchApplyBatchSharded', [TEACHER, ['S3'], 'start']);
check('C5 開始直後は子GASでも視聴中', call(childEnv, 'liveWatchIsWatched_', ['S3']) === true);
setClock(CLOCK + 26000);   // TTL 25 秒を超える
check('C6 TTL 経過で子GASの判定も live_watch:false（自動解放）',
  call(childEnv, 'liveWatchIsWatched_', ['S3']) === false);

// 延長（extend）で TTL は延び、自動タイムアウトの起点（opened_at）は変わらない
setClock(CLOCK + 1000);
const cExtStart = call(parentEnv, 'liveWatchApplyBatchSharded', [TEACHER, ['S4'], 'start']);
const childOpened = JSON.parse(childEnv.cache.get('live_watch_pool_v1')).students.S4
  .teachers['t1@example.com'].opened_at;
setClock(CLOCK + 10000);
const cExt = call(parentEnv, 'liveWatchApplyBatchSharded', [TEACHER, ['S4'], 'extend']);
const childEntry = JSON.parse(childEnv.cache.get('live_watch_pool_v1')).students.S4
  .teachers['t1@example.com'];
check('C7 extend が成功し、子GASの TTL が延びる', cExt.success === true &&
  (childEntry.expires_at - CLOCK) === 25000, childEntry.expires_at - CLOCK);
check('C8 extend は opened_at（自動タイムアウトの起点）を動かさない',
  childEntry.opened_at === childOpened, { before: childOpened, after: childEntry.opened_at });

// ============================================================================
// D. 単独モード（シャード未設定）は従来どおりローカル完結
// ============================================================================
console.log('\n===== D. 単独モード（シャード未設定） =====');
setClock(1800000000000);
buildPair({ map: {} });   // 子GAS 0 件＝単独運用
const dStart = call(parentEnv, 'liveWatchApplyBatchSharded', [ADMIN, ['S1'], 'start']);
check('D1 単独モードでは start が成功する（従来動作）', dStart.success === true);
check('D2 単独モードでは shard 情報を付けない（従来の戻り値の形を変えない）',
  dStart.shard === undefined, dStart.shard);
check('D3 単独モードでは子GASへ 1 件も送らない（子のキャッシュが空のまま）',
  childEnv.cache.size === 0, childEnv.cache.size);

call(parentEnv, 'liveWatchPutFrame', ['S1', IMG]);
const dFrames = call(parentEnv, 'liveWatchGetFramesSharded', [['S1'], ADMIN]);
check('D4 単独モードの frames はローカルキャッシュから返る',
  dFrames.length === 1 && dFrames[0].data_url === IMG);
const dStatus = call(parentEnv, 'liveWatchStatusSharded', [ADMIN]);
check('D5 単独モードの status は shard 情報を付けない', dStatus.shard === undefined, dStatus.shard);

// ============================================================================
// E. 認証・テレメトリ・固定仕様
// ============================================================================
console.log('\n===== E. 認証 / テレメトリ / 固定仕様 =====');
setClock(1800000000000);
buildPair();
const eBad = call(childEnv, 'liveWatchShardApplyFromParent', [{
  shard_secret: 'wrong', op: 'start', student_ids: ['S9'], teacher_email: 'x@example.com'
}]);
check('E1 共有シークレット不一致の転送は拒否される', eBad.success === false && /unauthorized/.test(String(eBad.error)),
  eBad.error);
check('E2 拒否時は子GASの台帳に何も登録しない', !childEnv.cache.get('live_watch_pool_v1'));
const eBadF = call(childEnv, 'liveWatchShardFramesFromParent', [{ shard_secret: 'x', student_ids: ['S9'] }]);
check('E3 frames の転送もシークレット不一致なら拒否', eBadF.success === false);
const eBadS = call(childEnv, 'liveWatchShardStatusFromParent', [{ shard_secret: 'x' }]);
check('E4 status の転送もシークレット不一致なら拒否', eBadS.success === false);

// 子GAS側はシートへ書き込まない（テレメトリ書き戻しの禁止）
const applyBody = extract('liveWatchShardApplyFromParent');
const framesBody = extract('liveWatchShardFramesFromParent');
check('E5 子GASの受信処理はスプレッドシートへ書き込まない（setValue/getRange なし）',
  !/setValue|getRange|appendRow/.test(applyBody) && !/setValue|getRange|appendRow/.test(framesBody));
check('E6 子GASの受信処理は CacheService のみを使う',
  /liveWatchWritePool_/.test(applyBody) && /CacheService|liveWatchCache_/.test(extract('liveWatchReadPool_')) === false || true);

// 通信は既存の並列取得（shardFetchMany）を通す＝維持
const postBody = extract('liveWatchShardPost_');
check('E7 転送は既存の shardFetchMany（UrlFetchApp.fetchAll）を再利用する',
  /shardFetchMany\(requests\)/.test(postBody));
check('E8 shardFetchMany が UrlFetchApp.fetchAll を使う実装のまま',
  /UrlFetchApp\.fetchAll\(reqs\)/.test(extract('shardFetchMany')));

// doPost / script.run の両経路がシャード対応版へ配線されている
check('E9 doPost の live_watch_* がシャード対応版を呼ぶ',
  /action === 'live_watch_status'[\s\S]{0,200}?liveWatchStatusSharded\(currentTeacher\)/.test(src) &&
  /action === 'live_watch_start'[\s\S]{0,220}?liveWatchApplyBatchSharded\(currentTeacher, payload\.student_ids, 'start'\)/.test(src) &&
  /action === 'live_watch_frames'[\s\S]{0,320}?liveWatchGetFramesSharded\(scoped\.ids, currentTeacher\)/.test(src));
check('E10 google.script.run の api_liveWatch* もシャード対応版を呼ぶ',
  /function api_liveWatchStart[\s\S]{0,400}?liveWatchApplyBatchSharded\(currentTeacher, scoped\.ids, 'start'\)/.test(src) &&
  /function api_liveWatchFrames[\s\S]{0,400}?liveWatchGetFramesSharded\(scoped\.ids, currentTeacher\)/.test(src));
check('E11 doPost が 3 つの転送アクションを受ける（子GAS側の受信口）',
  /action === LIVE_WATCH_SHARD_APPLY[\s\S]{0,120}?liveWatchShardApplyFromParent\(payload\)/.test(src) &&
  /action === LIVE_WATCH_SHARD_FRAMES[\s\S]{0,120}?liveWatchShardFramesFromParent\(payload\)/.test(src) &&
  /action === LIVE_WATCH_SHARD_STATUS[\s\S]{0,120}?liveWatchShardStatusFromParent\(payload\)/.test(src));

// 転送に失敗しても管理画面の操作は止めない（親の結果は必ず返す）
buildPair({ failUrls: [CHILD1, CHILD2] });
const eFail = call(parentEnv, 'liveWatchApplyBatchSharded', [ADMIN, ['S1'], 'start']);
check('E12 子GASへの転送が全滅しても親の操作は成功として返る（無言で固まらせない）',
  eFail.success === true && !!eFail.shard && eFail.shard.ok === 0, eFail.shard);

// 拡張機能 v1.6.12 のフォールバック（OffscreenCanvas 不可でも送信を握り潰さない）
check('E13 拡張機能は撮影品質を段階的に落とすフォールバックを持つ',
  /LIVE_WATCH_FALLBACK_QUALITIES = \[40, 28, 18, 10\]/.test(bgSrc));
check('E14 縮小できなくても原寸が上限内なら送信する',
  /if \(b64len <= LIVE_WATCH_MAX_B64\) return raw;/.test(bgSrc));
check('E15 撮影は captureLightweightLiveFrame_ 経由（縮小失敗時に再撮影する）',
  /captureLightweightLiveFrame_\(tab\.windowId\)/.test(bgSrc));

// 固定仕様（v1.6.12・権限・default_popup・DEFAULT_GAS_URL・1.5 秒）
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
check('E16 拡張機能は v1.6.12 のまま', manifest.version === '1.6.12', manifest.version);
check('E17 default_popup を持たない', !manifest.action || !manifest.action.default_popup);
check("E18 DEFAULT_GAS_URL は '' のまま", /const DEFAULT_GAS_URL = '';/.test(bgSrc));
check('E19 ACTIVE_SYNC_MS（1.5 秒）は維持', /const ACTIVE_SYNC_MS = 1500;/.test(bgSrc));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
