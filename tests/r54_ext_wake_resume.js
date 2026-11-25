// ============================================================================
// r54_ext_wake_resume.js — 拡張機能 v1.6.8: スリープ復帰（蓋を開けた直後）の即時オンライン復帰
//
//  実機症状（v1.6.6 で反映速度は安定した後の残課題）
//    Chromebook の蓋を閉じてスリープ → 再度開けて Wi-Fi が繋がっても、
//    次の setTimeout / chrome.alarms まで待たされるため、
//    管理画面の「オンライン状態」へ戻るのに時間がかかる。
//
//  v1.6.8 の設計（既存構造の精密化。独立ループは増やさない）
//    ① 復帰イベント … chrome.idle.onStateChanged('active') /
//                     chrome.windows.onFocusChanged / self 'online'
//                     → handleWakeResume() が「その瞬間」に 1 回だけ即時送信する
//    ② クールダウン … 前回の【成功】送信から 5 秒未満なら捨てる（＋ syncInFlight 併用）
//                     → 稼働中の通常のウィンドウ切替（1.5 秒ごとに成功）では通信ゼロ
//    ③ 短い再試行 … 復帰直後の通信失敗（Wi-Fi 再接続待ち）は 2 秒後に最大 2 回だけ
//                     再試行する。長いエラーバックオフ（30 秒〜）へは入らない
//
//  検証は extension/background.js の実関数を vm へ切り出して行う（明示リスト方式）。
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- 関数を波括弧の対応を数えて切り出す（明示リスト方式の共通部品） ----
function extract(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\s*\\(', 'm');
  const start = bgSrc.search(re);
  if (start < 0) throw new Error('not found fn: ' + name);
  let i = bgSrc.indexOf('{', start), depth = 0, end = -1;
  for (; i < bgSrc.length; i++) {
    if (bgSrc[i] === '{') depth++;
    else if (bgSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return bgSrc.slice(start, end + 1);
}
function decl(name) {
  const m = bgSrc.match(new RegExp('^(?:let|const|var) ' + name + '\\s*=[^;\\n]*;', 'm'));
  if (!m) throw new Error('not found decl: ' + name);
  return m[0];
}

// ============================================================================
// 1. 仮想タイマー／仮想時計つきの実行環境（handleWakeResume まわり）
// ============================================================================
function makeHarness() {
  let clock = 1000000;
  let seq = 1;
  const timers = new Map();     // id -> { at, fn, ms }
  const syncCalls = [];

  const h = {
    clock: () => clock,
    setClock: (v) => { clock = v; },
    advance: (ms) => {
      const target = clock + ms;
      for (;;) {
        let pick = null;
        timers.forEach((t, id) => {
          if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && id < pick.id))) {
            pick = { id: id, t: t };
          }
        });
        if (!pick) break;
        clock = pick.t.at;
        timers.delete(pick.id);
        pick.t.fn();
      }
      clock = target;
    },
    pendingCount: () => timers.size,
    pendingDelays: () => Array.from(timers.values()).map(t => t.at - clock).sort((a, b) => a - b),
    pendingDelaysAll: () => Array.from(timers.values()).map(t => t.ms),
    // const 宣言はサンドボックスのプロパティにならないため vm 経由で読む（明示リスト方式）
    konst: (n) => vm.runInContext(n, ctx),
    syncCalls: syncCalls,
    ctx: null,
    __v: null
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object,
    Boolean: Boolean, Set: Set, Map: Map, RegExp: RegExp, Error: Error,
    isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { const id = seq++; timers.set(id, { at: clock + (ms || 0), fn: fn, ms: ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    // 実 syncWithGas の代わり（本テストの対象は「いつ呼ばれるか」なので送信は記録だけ）。
    //   ※ 実物は通信成功時に lastHeartbeatOkMs を更新する。これを再現しないと
    //     「稼働中は 1.5 秒ごとに成功し続けるので復帰通知は常にクールダウン内」を検証できない。
    syncWithGas: function () {
      syncCalls.push(clock);
      try { vm.runInContext('lastHeartbeatOkMs = ' + clock + ';', ctx); } catch (e) {}
      return Promise.resolve();
    }
  };
  vm.createContext(ctx);

  // 明示リスト: 定数 → 状態宣言 → 実関数
  let code = '';
  ['WAKE_RESUME_COOLDOWN_MS', 'WAKE_RETRY_DELAY_MS', 'WAKE_RETRY_MAX', 'WAKE_RESUME_MIN_GAP_MS']
    .forEach(function (n) { code += decl(n) + '\n'; });
  ['lastHeartbeatOkMs', 'lastWakeResumeMs', 'lastWakeResumeReason', 'wakeRetryBudget',
   'wakeRetryTimer', 'syncInFlight', 'lastSyncMs']
    .forEach(function (n) { code += decl(n) + '\n'; });
  ['clearWakeRetry', 'scheduleWakeRetry', 'handleWakeResume']
    .forEach(function (n) { code += extract(n) + '\n'; });
  code += '\n__v = {' +
    '\n  resume: function (r) { return handleWakeResume(r); },' +
    '\n  scheduleRetry: function () { return scheduleWakeRetry(); },' +
    '\n  okMs: function () { return lastHeartbeatOkMs; },' +
    '\n  budget: function () { return wakeRetryBudget; },' +
    '\n  reason: function () { return lastWakeResumeReason; },' +
    '\n  setOk: function (v) { lastHeartbeatOkMs = v; },' +
    '\n  setFlight: function (v) { syncInFlight = v; },' +
    '\n  setLastSync: function (v) { lastSyncMs = v; },' +
    '\n  getLastSync: function () { return lastSyncMs; }' +
    '\n};';
  vm.runInContext(code, ctx);
  h.ctx = ctx;
  h.__v = ctx.__v;
  return h;
}

// ============================================================================
// 2. 復帰イベント（idle→active / ウィンドウ復帰）で即時同期が発火する
// ============================================================================
console.log('\n===== A. 復帰イベントの即時同期（クールダウン 5 秒） =====');

let H = makeHarness();
check('A1 クールダウンは 5 秒（WAKE_RESUME_COOLDOWN_MS = 5000）',
  H.konst('WAKE_RESUME_COOLDOWN_MS') === 5000, H.konst('WAKE_RESUME_COOLDOWN_MS'));

// 起動直後（成功実績なし = lastHeartbeatOkMs 0）は必ず 1 回送る
let fired = H.__v.resume('idle');
check('A2 成功実績なしの復帰は即時同期する（タイマーを待たない）',
  fired === true && H.syncCalls.length === 1, { fired: fired, calls: H.syncCalls.length });
check('A3 復帰理由を診断用に保持する（idle）', H.__v.reason() === 'idle', H.__v.reason());

// 直後に再発火しても連打防止（MIN_GAP 1000ms 未満 & クールダウン内）
H.__v.resume('focus');
check('A4 直前の復帰直後の再発火は捨てる（連打防止）', H.syncCalls.length === 1, H.syncCalls.length);

// 前回成功から 10 秒経過 → 復帰で送る
H = makeHarness();
H.__v.setOk(1000000 - 10000);
H.advance(0);
fired = H.__v.resume('focus');
check('A5 前回成功から 10 秒経過していれば即時同期する',
  fired === true && H.syncCalls.length === 1, { fired: fired, calls: H.syncCalls.length });
check('A6 復帰理由を保持する（focus）', H.__v.reason() === 'focus', H.__v.reason());

// 前回成功から 3 秒（クールダウン内） → 送らない
H = makeHarness();
H.__v.setOk(1000000 - 3000);
check('A7 前回成功から 3 秒（5 秒未満）の復帰は送らない（クールダウンガード）',
  H.__v.resume('idle') === false && H.syncCalls.length === 0, H.syncCalls.length);

// ちょうど 5 秒 → 送る（境界は「以上」）
H = makeHarness();
H.__v.setOk(1000000 - 5000);
check('A8 ちょうど 5 秒経過なら送る（5 秒以上で発火）',
  H.__v.resume('idle') === true && H.syncCalls.length === 1, H.syncCalls.length);

// クールダウン判定は「成功時刻」であり「送信開始(lastSyncMs)」ではない
H = makeHarness();
H.__v.setLastSync(1000000);          // たった今送った（成功はまだ）
H.__v.setOk(1000000 - 8000);         // 最後の成功は 8 秒前
check('A9 クールダウンは成功時刻で判定する（lastSyncMs ではない）',
  H.__v.resume('online') === true && H.syncCalls.length === 1,
  { okMs: H.__v.okMs(), lastSync: H.__v.getLastSync(), calls: H.syncCalls.length });

// ============================================================================
// 3. 稼働中（1.5 秒ごとに成功）のウィンドウ切替では通信が増えない
// ============================================================================
console.log('\n===== B. クールダウン下では無駄な通信が発生しない =====');

H = makeHarness();
H.__v.setOk(1000000);                // たった今成功した
const base = H.syncCalls.length;
let firedCount = 0;
// 4 秒間で 10 回フォーカスが切り替わる（すべて 5 秒未満）
for (let i = 0; i < 10; i++) { H.advance(400); if (H.__v.resume('focus') === true) firedCount++; }
check('B1 5 秒未満の頻繁なフォーカス切替では 1 回も送らない',
  firedCount === 0 && H.syncCalls.length === base,
  { fired: firedCount, calls: H.syncCalls.length });

// 5 秒を跨いだ最初の切替だけ送る
H.advance(1100);                     // 合計 4.0 + 1.1 = 5.1 秒
const before = H.syncCalls.length;
H.__v.resume('focus');
check('B2 5 秒を跨いだ最初のフォーカス切替では 1 回だけ送る',
  H.syncCalls.length === before + 1, { before: before, after: H.syncCalls.length });
H.__v.resume('focus');
check('B3 その後すぐの切替は再びクールダウンで捨てる',
  H.syncCalls.length === before + 1, H.syncCalls.length);

// 稼働中の 1.5 秒周期チェーンと共存しても増えない
//   （1.5 秒ごとに syncWithGas が成功して lastHeartbeatOkMs が更新される状況を再現する）
H = makeHarness();
H.__v.setOk(1000000);
let chainFired = 0;
const chainCalls = H.syncCalls.length;
for (let i = 0; i < 6; i++) {
  H.advance(1500);
  H.ctx.syncWithGas();                 // 稼働中チェーン（1.5 秒）＝成功して okMs 更新
  if (H.__v.resume('focus') === true) chainFired++;
}
check('B4 1.5 秒ごとに成功し続ける稼働中はフォーカス切替で通信ゼロ',
  chainFired === 0 && H.syncCalls.length === chainCalls + 6,
  { fired: chainFired, calls: H.syncCalls.length - chainCalls });

// in-flight（通信中）の復帰通知は捨てる
H = makeHarness();
H.__v.setOk(1000000 - 60000);
H.__v.setFlight(true);
check('B5 通信中（syncInFlight）の復帰通知は捨てる（多重送信しない）',
  H.__v.resume('idle') === false && H.syncCalls.length === 0, H.syncCalls.length);
H.__v.setFlight(false);
check('B6 通信が終われば復帰通知を受け付ける',
  H.__v.resume('idle') === true && H.syncCalls.length === 1, H.syncCalls.length);

// ============================================================================
// 4. 復帰直後の失敗 → 短い再試行（2 秒 × 最大 2 回）。長いバックオフに入らない
// ============================================================================
console.log('\n===== C. 短い再試行（Wi-Fi 再接続待ち） =====');

H = makeHarness();
check('C1 再試行間隔は 2 秒（WAKE_RETRY_DELAY_MS = 2000）',
  H.konst('WAKE_RETRY_DELAY_MS') === 2000, H.konst('WAKE_RETRY_DELAY_MS'));
check('C2 再試行回数は最大 2 回（WAKE_RETRY_MAX = 2）',
  H.konst('WAKE_RETRY_MAX') === 2, H.konst('WAKE_RETRY_MAX'));

// 復帰した瞬間に再試行予算が立つ
H.__v.setOk(0);
H.__v.resume('idle');
check('C3 復帰の瞬間に再試行予算（2）が立つ', H.__v.budget() === 2, H.__v.budget());
check('C4 復帰では即時送信し、まだ再試行タイマーは張らない',
  H.syncCalls.length === 1 && H.pendingCount() === 0,
  { calls: H.syncCalls.length, pending: H.pendingCount() });

// 失敗 → 2 秒後の再試行が予約される
const scheduled = H.__v.scheduleRetry();
check('C5 失敗すると 2 秒後の再試行が 1 本だけ予約される',
  scheduled === true && H.pendingCount() === 1 && H.pendingDelays()[0] === 2000,
  { scheduled: scheduled, delays: H.pendingDelays() });
check('C6 予算は 1 に減る', H.__v.budget() === 1, H.__v.budget());

H.advance(2000);
check('C7 2 秒後に自動で再送信する', H.syncCalls.length === 2, H.syncCalls.length);

// 2 回目の再試行
check('C8 もう一度失敗すると再度 2 秒後を予約する',
  H.__v.scheduleRetry() === true && H.pendingDelays()[0] === 2000, H.pendingDelays());
check('C9 予算は 0 になる', H.__v.budget() === 0, H.__v.budget());
H.advance(2000);
check('C10 2 回目の再試行も実行される', H.syncCalls.length === 3, H.syncCalls.length);

// 予算切れ → それ以上は張らない（無限リトライしない）
check('C11 予算切れ（2 回使い切り）後は再試行しない',
  H.__v.scheduleRetry() === false && H.pendingCount() === 0, H.pendingCount());

// 通常運用（復帰ではない）では予算が立たない＝無駄な再試行ゼロ
H = makeHarness();
check('C12 復帰以外（通常のエラー）では再試行予算が立たない（通信を増やさない）',
  H.__v.scheduleRetry() === false && H.pendingCount() === 0, H.__v.budget());

// 再試行の発火時に通信中なら二重送信しない
H = makeHarness();
H.__v.setOk(0);
H.__v.resume('idle');
H.__v.scheduleRetry();
H.__v.setFlight(true);
const beforeFlight = H.syncCalls.length;
H.advance(2000);
check('C13 再試行の発火時に通信中なら二重送信しない',
  H.syncCalls.length === beforeFlight, { before: beforeFlight, after: H.syncCalls.length });
H.__v.setFlight(false);

// ============================================================================
// 5. 実 syncWithGas で「復帰直後の失敗 → 2 秒リトライ → 成功」を実挙動で固定する
// ============================================================================
console.log('\n===== D. 実 syncWithGas の失敗経路（長いバックオフに入らない） =====');

function buildSync(o) {
  o = o || {};
  let clock = 5000000;
  let seq = 1;
  const timers = new Map();
  const fetches = [];
  const diag = [];
  let failRemaining = (o.failCount === undefined) ? 1 : o.failCount;
  const store = {
    school_name: '英田小学校',
    student_id: '1607002@city-mimasaka.ed.jp',
    gas_url: 'https://parent.example/exec'
  };
  const sandbox = {
    console: { log() {}, warn() {}, error: function () {} },
    JSON: JSON, String: String, Object: Object, Array: Array, Number: Number,
    Boolean: Boolean, Math: Math, RegExp: RegExp, Error: Error, Promise: Promise,
    isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    Date: { now: function () { return clock; } },
    setTimeout: function (fn, ms) {
      const id = seq++;
      timers.set(id, { at: clock + (ms || 0), fn: fn, ms: ms });
      return id;
    },
    clearTimeout: function (id) { timers.delete(id); },
    AbortController: function () { this.signal = {}; this.abort = function () {}; },
    fetch: function (url) {
      fetches.push(String(url));
      if (failRemaining > 0) {
        failRemaining--;
        return Promise.reject(new Error('Failed to fetch'));
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({ success: true, ka_active: false }); }
      });
    },
    chrome: { storage: { local: {
      get: function () { return Promise.resolve(Object.assign({}, store)); },
      set: function (p) { Object.assign(store, p); return Promise.resolve(); }
    } } },
    getStudentIdentity: function () { return Promise.resolve(''); },
    getActiveTabUrl: function () { return Promise.resolve('https://www.example.jp/'); },
    getManagedPolicy: function () { return Promise.resolve({}); },
    pickMeaningfulSchoolName: function (a, b) { return a || b || ''; },
    applyPolicies: function () { return Promise.resolve(); },
    applyRemoteKeepalive: function () {},
    recordSyncDiag: function (ok, code) {
      diag.push({ ok: !!ok, code: String(code || '') });
      return Promise.resolve();
    }
  };
  vm.createContext(sandbox);

  let pre = '';
  pre += 'const DEFAULT_GAS_URL = "";\n';
  pre += 'const SYNC_TIMEOUT_MS = 12000;\n';
  pre += 'const SHARD_RECHECK_MS = 6 * 60 * 60 * 1000;\n';
  pre += 'const SHARD_FAIL_LIMIT = 3;\n';
  pre += 'const SHARD_COOLDOWN_MS = 30 * 60 * 1000;\n';
  pre += decl('WAKE_RESUME_COOLDOWN_MS') + '\n';
  pre += decl('WAKE_RETRY_DELAY_MS') + '\n';
  pre += decl('WAKE_RETRY_MAX') + '\n';
  pre += decl('WAKE_RESUME_MIN_GAP_MS') + '\n';
  pre += 'let syncInFlight = false;\n';
  pre += 'let shardHandoffPending = false;\n';
  pre += 'let shardAssignedCache = "";\n';
  pre += 'let shardFailCount = 0;\n';
  pre += 'let lastHeartbeatSentMs = 0;\n';
  pre += 'let lastHeartbeatStartMs = 0;\n';
  pre += decl('lastHeartbeatOkMs') + '\n';
  pre += decl('lastWakeResumeMs') + '\n';
  pre += decl('lastWakeResumeReason') + '\n';
  pre += decl('wakeRetryBudget') + '\n';
  pre += decl('wakeRetryTimer') + '\n';
  pre += decl('lastSyncMs') + '\n';

  const body = ['normalizeSchoolKey', 'resolveGasUrl', 'shardAssignedUrl', 'shardSyncMemory',
    'applyShardAssignment', 'syncWithGas', 'clearWakeRetry', 'scheduleWakeRetry', 'handleWakeResume']
    .map(extract).join('\n');

  vm.runInContext(pre + body +
    '\nvar __pending = [];' +
    '\nsyncWithGas = (function (orig) {' +
    '\n  return function () {' +
    '\n    var p = orig.apply(null, arguments);' +
    '\n    __pending.push(p);' +
    '\n    return p;' +
    '\n  };' +
    '\n})(syncWithGas);' +
    '\n__v2 = {' +
    '\n  resume: function (r) { return handleWakeResume(r); },' +
    '\n  pending: function () { return __pending; },' +
    '\n  okMs: function () { return lastHeartbeatOkMs; },' +
    '\n  budget: function () { return wakeRetryBudget; },' +
    '\n  inFlight: function () { return syncInFlight; },' +
    '\n  retryTimerArmed: function () { return wakeRetryTimer !== null; }' +
    '\n};', sandbox);

  const h = {
    clock: function () { return clock; },
    fetches: fetches,
    diag: diag,
    pendingDelays: function () {
      return Array.from(timers.values()).map(function (t) { return t.ms; }).sort(function (a, b) { return a - b; });
    },
    pendingCount: function () { return timers.size; },
    async drain() {
      let guard = 0;
      while (guard++ < 20) {
        const pend = sandbox.__v2.pending();
        if (pend.length) { const batch = pend.splice(0, pend.length); await Promise.all(batch); continue; }
        break;
      }
    },
    async advance(ms) {
      const target = clock + ms;
      for (;;) {
        let pick = null;
        timers.forEach(function (t, id) {
          if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && id < pick.id))) {
            pick = { id: id, t: t };
          }
        });
        if (!pick) break;
        clock = pick.t.at;
        timers.delete(pick.id);
        const r = pick.t.fn();
        if (r && typeof r.then === 'function') await r;
        await h.drain();
      }
      clock = target;
    },
    __v: sandbox.__v2
  };
  return h;
}

(async function () {
  // D1〜D4: 復帰直後の 1 回失敗 → 2 秒後に成功（長いバックオフに入らない）
  let S = buildSync({ failCount: 1 });
  S.__v.resume('idle');
  await S.drain();
  check('D1 復帰直後の初回通信は失敗する（Wi-Fi 再接続待ちの想定）',
    S.fetches.length === 1 && S.diag.some(function (d) { return d.code === 'network'; }),
    { fetches: S.fetches.length });
  check('D2 失敗しても syncInFlight は解放される（以降の同期が止まらない）',
    S.__v.inFlight() === false);

  const delays = S.pendingDelays();
  check('D3 長いバックオフ（30 秒以上）のタイマーは張られない',
    delays.every(function (d) { return d < 30000; }), delays);
  check('D4 短い再試行が 2 秒後に 1 本だけ予約される',
    S.pendingCount() === 1 && delays[0] === 2000, { pending: S.pendingCount(), delays: delays });

  await S.advance(2000);
  check('D5 2 秒後に自動で再送信し、Wi-Fi 接続完了と同時にオンライン報告できる',
    S.fetches.length === 2, S.fetches.length);
  check('D6 成功したら再試行予算はリセットされ、再試行タイマーも残らない',
    S.__v.budget() === 0 && S.__v.retryTimerArmed() === false && S.pendingCount() === 0,
    { budget: S.__v.budget(), pending: S.pendingCount() });
  check('D7 成功時刻（lastHeartbeatOkMs）が記録される（次回のクールダウン判定用）',
    S.__v.okMs() === S.clock(), { okMs: S.__v.okMs(), now: S.clock() });

  // D8〜D11: ずっと失敗し続けても「短い再試行 2 回」で打ち切る（無限リトライしない）
  S = buildSync({ failCount: 99 });
  S.__v.resume('idle');
  await S.drain();
  await S.advance(2000);   // 再試行 1
  await S.advance(2000);   // 再試行 2
  check('D8 失敗が続いても短い再試行は合計 2 回まで（初回＋2 = 3 通）',
    S.fetches.length === 3, S.fetches.length);
  check('D9 2 回の再試行後はタイマーが残らない（無限リトライしない）',
    S.pendingCount() === 0, S.pendingCount());
  await S.advance(60000);
  check('D10 その後 60 秒待っても勝手に再送しない（長いバックオフへ入っていない）',
    S.fetches.length === 3, S.fetches.length);
  check('D11 全失敗でも syncInFlight は解放されたまま', S.__v.inFlight() === false);

  // ==========================================================================
  // 6. 構造（配線）— 復帰イベントが実装に接続されている
  // ==========================================================================
  console.log('\n===== E. 構造（復帰イベントの配線） =====');

  const fnResume = extract('handleWakeResume');
  const fnRetry = extract('scheduleWakeRetry');

  check('E1 chrome.idle.onStateChanged が active 遷移で handleWakeResume を呼ぶ',
    /chrome\.idle\.onStateChanged\.addListener\([\s\S]{0,240}?state !== 'active'[\s\S]{0,160}?handleWakeResume\('idle'\)/.test(bgSrc));
  check('E2 chrome.windows.onFocusChanged が復帰時に handleWakeResume を呼ぶ',
    /chrome\.windows\.onFocusChanged\.addListener\([\s\S]{0,600}?handleWakeResume\('focus'\)/.test(bgSrc));
  check('E3 フォーカス喪失（WINDOW_ID_NONE）は復帰として扱わない',
    /WINDOW_ID_NONE/.test(bgSrc) && /if \(winId !== undefined && winId === NONE\) return;/.test(bgSrc));
  check('E4 ネットワーク復帰（online イベント）でも handleWakeResume を呼ぶ',
    /addEventListener\('online', function \(\) \{ handleWakeResume\('online'\); \}\)/.test(bgSrc));
  check('E5 復帰トリガーは handleWakeResume に一本化（旧: lastSyncMs=0 → syncWithGas の直書きが無い）',
    !/chrome\.idle\.onStateChanged\.addListener\(\(state\) => \{\s*\n\s*if \(state !== 'active'\) return;\s*\n\s*lastSyncMs = 0;/.test(bgSrc));
  check('E6 handleWakeResume は syncInFlight を最初に弾く（多重送信しない）',
    /function handleWakeResume\(reason\) \{[\s\S]{0,240}?if \(syncInFlight\) return false;/.test(fnResume));
  check('E7 クールダウンは「成功時刻」lastHeartbeatOkMs × 5 秒で判定する',
    /lastHeartbeatOkMs > 0 && \(now - lastHeartbeatOkMs\) < WAKE_RESUME_COOLDOWN_MS/.test(fnResume));
  check('E8 即時発火はレート制限を外して 1 回送る（lastSyncMs = 0）',
    /lastSyncMs = 0;/.test(fnResume) && /syncWithGas\(\);/.test(fnResume));
  check('E9 復帰のたびに短い再試行の予算を立て直す',
    /wakeRetryBudget = WAKE_RETRY_MAX;/.test(fnResume));
  check('E10 再試行は復帰予算があるときだけ張る（通常運用では通信を増やさない）',
    /if \(wakeRetryBudget <= 0\) return false;/.test(fnRetry));
  check('E11 再試行の発火時も in-flight を弾く（二重送信しない）',
    /if \(syncInFlight\) return;/.test(fnRetry));
  check('E12 再試行タイマーは 1 本だけ（独立ループを増やしていない）',
    (bgSrc.match(/wakeRetryTimer = setTimeout\(/g) || []).length === 1);
  check('E13 syncWithGas の catch が短い再試行を呼ぶ（長いバックオフへ入れない）',
    /catch \(err\) \{[\s\S]{0,900}?scheduleWakeRetry\(\)/.test(extract('syncWithGas')));
  check('E14 syncWithGas の成功時に lastHeartbeatOkMs を更新して予算を閉じる',
    /lastHeartbeatOkMs = Date\.now\(\);/.test(extract('syncWithGas')) &&
    /wakeRetryBudget = 0;/.test(extract('syncWithGas')) &&
    /clearWakeRetry\(\)/.test(extract('syncWithGas')));
  check('E15 manifest に idle 権限がある（chrome.idle の前提）',
    (manifest.permissions || []).indexOf('idle') >= 0, manifest.permissions);

  // ==========================================================================
  // 7. 版数と固定仕様
  // ==========================================================================
  console.log('\n===== F. 版数と固定仕様 =====');

  check('F1 manifest.version は 1.6.8', manifest.version === '1.6.8', manifest.version);
  check('F2 default_popup を設けていない（児童のアイコン操作は無反応）',
    !((manifest.action || {}).default_popup));
  check('F3 DEFAULT_GAS_URL は空文字のまま', /const DEFAULT_GAS_URL = '';/.test(bgSrc));
  check('F4 manifest_version は 3 のまま', manifest.manifest_version === 3);

  function zipManifest(file) {
    try {
      const out = execSync('unzip -p ' + JSON.stringify(path.join(ROOT, 'dist', file)) + ' manifest.json',
        { encoding: 'utf8' });
      return JSON.parse(out);
    } catch (e) { return null; }
  }
  const sm = zipManifest('store.zip');
  const dm = zipManifest('direct.zip');
  let xml = '';
  try { xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8'); } catch (e) { xml = ''; }

  check('F5 dist/store.zip の manifest.version は 1.6.8', !!sm && sm.version === '1.6.8', sm && sm.version);
  check('F6 dist/store.zip に default_popup が無い', !!sm && !((sm.action || {}).default_popup));
  check('F7 dist/direct.zip の manifest.version も 1.6.8', !!dm && dm.version === '1.6.8', dm && dm.version);
  check('F8 dist/update.xml の version は 1.6.8', /version='1\.6\.8'/.test(xml));
  check('F9 ストア版 background.js は extension/background.js と一致（旧版混入なし）',
    (function () {
      try {
        const out = execSync('unzip -p ' + JSON.stringify(path.join(ROOT, 'dist', 'store.zip')) +
          ' background.js', { encoding: 'utf8' });
        return out === bgSrc;
      } catch (e) { return false; }
    })());

  check('F10 ACTIVE_SYNC_INTERVAL_SEC = 1.5 を維持（GAS 側）',
    /^const ACTIVE_SYNC_INTERVAL_SEC = 1\.5;/m.test(gasSrc));
  check('F11 拡張側の稼働中周期の既定は 1500ms のまま（v1.6.6 の高精度チェーンを壊さない）',
    /const ACTIVE_SYNC_MS = 1500;/.test(bgSrc));
  check('F12 14校（東粟倉小は廃校のため含めない）', !/東粟倉/.test(gasSrc));
  check('F13 MONITOR_SETTINGS_V1 を維持', /MONITOR_SETTINGS_V1/.test(gasSrc));
  check('F14 DIAG 計装を維持（[SHARD-DIAG] / [BULK-TRACE]）',
    /\[SHARD-DIAG\]/.test(gasSrc) && /\[BULK-TRACE\]/.test(gasSrc));
  check('F15 r53 の高精度チェーン（scheduleFastChain）を維持している',
    /function scheduleFastChain\(\)/.test(bgSrc) && /FAST_MIN_GAP_RATIO = 0\.8/.test(bgSrc));

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})();
