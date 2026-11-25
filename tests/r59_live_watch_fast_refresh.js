// =============================================================================
// R59: ライブ視聴の画像切り替わり高速化（約6秒 → 1.5〜2.5秒）
//
//  実機症状:
//    拡張機能は 1.5 秒で撮影・送信しているのに、管理画面のライブ視聴の画像が
//    切り替わるまで約 6 秒かかっていた。
//
//  原因（調査結果）:
//    ① 管理画面の live_watch_frames だけが google.script.run の callback ポーリング
//       経路（実測 3.6〜7.1 秒）を通っていた。R55 で get_all は /exec 直送にしたが、
//       ライブ視聴フレームはその対象外のままだった。
//    ② 端末側は「次の 1.5 秒ハートビート周期」を待ってから 1 枚目を撮っていたため、
//       開始直後に最大 1.5 秒＋往復待ちの空白があった。
//    ③ 1 枚が 25〜30KB あり、転送とデコードに時間がかかっていた。
//
//  本テストで固定する仕様:
//    A. live_watch_frames は /exec 直送が優先経路（認証切れ以外の失敗時のみ
//       google.script.run へ退避する）
//    B. ポーリングは 1.2〜1.5 秒。開始直後の 6 秒間だけ 0.8〜1.0 秒
//    C. in-flight 排他と「古い応答の破棄」が機能する
//    D. 拡張機能は live_watch の false → true 遷移で即座に 1 枚目を撮る
//    E. 拡張機能は独立ループ（1.0〜1.5 秒）で撮影し、1 枚 12〜18KB に収める
//    F. 親GAS は毎回 子GAS から最新フレームを並列取得する（古い画像を溜めない）
//    G. 出荷物は v1.6.10（固定仕様は維持）
// =============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'gas/index.html'), 'utf8');
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- ブレース対応の関数抽出（明示リスト方式） ----
function extract(src, name) {
  const re = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found fn: ' + name);
  let i = src.indexOf('{', m.index), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(m.index, end + 1);
}

// ---- 数値定数の取り出し ----
function constNum(src, name) {
  const m = new RegExp('^[ \\t]*const ' + name + '\\s*=\\s*([0-9]+)', 'm').exec(src);
  if (!m) throw new Error('const not found: ' + name);
  return Number(m[1]);
}

// CommonJS + トップレベル await は併用できないため、検証本体は async 関数に包む。
async function main() {

// =============================================================================
// A. live_watch_frames の /exec 直送（gas/index.html）
// =============================================================================
console.log('===== A. live_watch_frames の /exec 直送 =====');

const apiBody = extract(html, 'apiRequest');
const directLiveBody = extract(html, 'apiRequestDirectLiveFrames');

check('A1 /exec 直送の専用関数 apiRequestDirectLiveFrames がある', !!directLiveBody);
check('A2 直送は /exec へ POST する（text/plain でプリフライトを出さない）',
  /method:\s*'POST'/.test(directLiveBody) &&
  /'Content-Type':\s*'text\/plain;charset=utf-8'/.test(directLiveBody) &&
  /redirect:\s*'follow'/.test(directLiveBody));
check('A3 直送は呼び出し元の payload をそのまま送る（action を書き換えない）',
  /Object\.assign\(\{\},\s*payload\)/.test(directLiveBody) && !/action\s*=/.test(directLiveBody));
check('A4 直送は認証トークンを載せる', /if \(authToken\) body\.token = authToken;/.test(directLiveBody));
check('A5 直送にタイムアウトを課す（GAS 無応答で固まらない）',
  /eduFetchWithTimeout\(/.test(directLiveBody) && /LIVE_FRAME_FETCH_TIMEOUT_MS/.test(directLiveBody));

check('A6 apiRequest に live_watch_frames の直送分岐がある',
  /__liveFramesAction\s*=\s*!!\(payload && payload\.action === 'live_watch_frames'\)/.test(apiBody) &&
  /apiRequestDirectLiveFrames\(payload\)/.test(apiBody));
check('A7 直送が先（google.script.run の分岐より前）に評価される',
  apiBody.indexOf('apiRequestDirectLiveFrames(payload)') >= 0 &&
  apiBody.indexOf('apiRequestDirectLiveFrames(payload)') <
    apiBody.indexOf("act === 'live_watch_frames'"));
check('A8 認証切れ（need_auth）は退避しない（noFallback=true）',
  /if \(data && data\.need_auth\) \{[\s\S]{0,240}?e\.noFallback = true;/.test(directLiveBody));
check('A9 サーバーの明示的な拒否も退避しない（noFallback=true）',
  /if \(data && data\.success === false\) \{[\s\S]{0,200}?e\.noFallback = true;/.test(directLiveBody));
check('A10 非認証の失敗時だけ google.script.run へ退避する',
  /catch \(eLf\) \{[\s\S]{0,300}?if \(\(eLf && eLf\.noFallback\) \|\| !__hasRunner2\) throw eLf;/.test(apiBody));
check('A11 直送が続けて失敗する環境では一定時間だけ従来経路を優先（毎回のタイムアウト待ちを避ける）',
  /liveFramesDirectCooldownUntil = Date\.now\(\) \+ LIVE_FRAME_DIRECT_COOLDOWN_MS;/.test(apiBody) &&
  /Date\.now\(\) >= liveFramesDirectCooldownUntil/.test(apiBody));
check('A12 直送が成功したらクールダウンを解除する',
  /liveFramesDirectCooldownUntil = 0;/.test(apiBody));
check('A13 退避先（google.script.run）に live_watch_frames の分岐が残っている（保険）',
  /act === 'live_watch_frames'[\s\S]{0,120}?runner\.api_liveWatchFrames\(/.test(apiBody));

// =============================================================================
// B. ポーリング周期（1.2〜1.5 秒 / 開始直後 0.8〜1.0 秒）
// =============================================================================
console.log('===== B. ポーリング周期の短縮 =====');

const pollMs = constNum(html, 'LIVE_WATCH_POLL_MS');
const bootMs = constNum(html, 'LIVE_WATCH_BOOT_POLL_MS');
const bootWindowMs = constNum(html, 'LIVE_WATCH_BOOT_MS');

check('B1 通常周期は 1.2〜1.5 秒（1200〜1500ms）', pollMs >= 1200 && pollMs <= 1500, pollMs);
check('B2 開始直後の周期は 0.8〜1.0 秒（800〜1000ms）', bootMs >= 800 && bootMs <= 1000, bootMs);
check('B3 「開始直後」は 6 秒間', bootWindowMs === 6000, bootWindowMs);
check('B4 開始直後は短い周期を返す（getLiveWatchPollMs）',
  /function getLiveWatchPollMs\(\)/.test(html) &&
  /\(Date\.now\(\) - liveWatchStartedAt\) < LIVE_WATCH_BOOT_MS/.test(html));
check('B5 6 秒経過後は自動で通常周期へ切り替わる（tick 内で見直す）',
  /async function liveWatchPollTick\(\)[\s\S]{0,700}?resetLiveWatchPollTimer\(\);/.test(html));
check('B6 周期は「同じなら張り直さない」＝タイマーを増殖させない',
  /if \(liveWatchPollTimer === ms\) return;/.test(html));
check('B7 ポーリングは 1 本だけ（開始時に前のタイマーを必ず破棄する）',
  /function startLiveWatchPolling\(\)[\s\S]{0,900}?stopLiveWatchPolling\(\);/.test(html));

// =============================================================================
// C. in-flight 排他と古い応答の破棄
// =============================================================================
console.log('===== C. in-flight 排他と古い応答の破棄 =====');

check('C1 in-flight 排他が残っている（前の取得中は投げない）',
  /if \(liveWatchFramesFetching\) return;/.test(html) &&
  /liveWatchFramesFetching = true;/.test(html) &&
  /liveWatchFramesFetching = false;/.test(html));
check('C2 取得要求に通し番号を振る', /liveWatchFramesSeq \+= 1;/.test(html));
check('C3 自分より新しい反映が済んでいたら応答を捨てる（巻き戻り防止）',
  /if \(mySeq < liveWatchFramesAppliedSeq\) return;/.test(html));
check('C4 児童ごとに撮影時刻を覚え、古いフレームは捨てる',
  /liveWatchFrameAtById/.test(html) &&
  /if \(at > 0 && seen > 0 && at < seen\) return;/.test(html));
check('C5 開始時に通し番号と撮影時刻の記録をリセットする',
  /liveWatchFramesSeq = 0;[\s\S]{0,200}?liveWatchFramesAppliedSeq = 0;/.test(html) &&
  /liveWatchFrameAtById = \{\};/.test(html));

// ---- 実挙動（gas/index.html のインラインJSを vm で実行して確かめる） ----
const reScript = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let mm, code = '';
while ((mm = reScript.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(mm[0].split('>')[0])) continue;
  code += mm[1] + '\n';
}

const clock = { now: 5000000 };
function FakeDate(...a) { return a.length === 0 ? new Date(clock.now) : new Date(...a); }
FakeDate.now = () => clock.now;
FakeDate.UTC = Date.UTC;
FakeDate.parse = Date.parse;

const intervals = [];
const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  const set = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    options: [], files: [], disabled: false, className: '',
    style: { setProperty() {}, removeProperty() {} }, parentNode: null,
    classList: {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      toggle(c, f) { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (f) set.add(c); else set.delete(c); },
      contains(c) { return set.has(c); }
    },
    appendChild() {}, removeChild() {},
    querySelectorAll() { return []; },
    addEventListener() {}, setAttribute() { this._src = arguments[1]; }, removeAttribute() {},
    getAttribute() { return this._src === undefined ? null : this._src; }, cloneNode() { return mkEl(id); }
  };
  els[id] = el;
  return el;
}

const docListeners = {};
const store = {};
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  JSON, Math, String, Number, Array, Object, Boolean, isNaN,
  parseFloat, parseInt, Set, Map, URL, Promise, RegExp, isFinite, Error,
  Date: FakeDate,
  window: {
    addEventListener(t, fn) { (docListeners['w:' + t] = docListeners['w:' + t] || []).push(fn); },
    removeEventListener() {}, location: { href: '', hostname: '', search: '' },
    open() { return { document: { write() {}, close() {} } }; },
    confirm() { return true; }
  },
  setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
  clearTimeout() {},
  setInterval(fn, ms) { const t = { fn, ms }; intervals.push(t); return t; },
  clearInterval(t) {
    if (!t) return;
    const i = intervals.indexOf(t);
    if (i >= 0) intervals.splice(i, 1);
  },
  requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 0; },
  selectedStudentIds: new Set(), selectedClasses: new Set(),
  devicesData: [], currentTeacher: { role: 'ADMIN', school: '全校管理' },
  schoolFilter: null,
  localStorage: {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  document: {
    hidden: false,
    getElementById(id) { return mkEl(id); },
    createElement() { return mkEl('tmp' + Math.round(Math.random() * 1e9)); },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }
  },
  fetch() { return Promise.reject(new Error('fetch は本テストでは使わない（apiRequest を差し替える）')); },
  navigator: {},
  alert() {}, confirm() { return true; }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const run = (expr) => vm.runInContext(expr, ctx);

check('C6 前提: ライブ視聴の関数群が vm 上に読み込まれている',
  typeof ctx.liveWatchPollTick === 'function' &&
  typeof ctx.getLiveWatchPollMs === 'function' &&
  typeof ctx.updateLiveWatchImages === 'function');

// 取得を「保留」できる apiRequest に差し替える
let apiCalls = [];
ctx.apiRequest = function (payload) {
  const rec = { payload: payload, res: null, rej: null };
  apiCalls.push(rec);
  return new Promise(function (res, rej) { rec.res = res; rec.rej = rej; });
};
let appliedCount = 0;
ctx.updateLiveWatchImages = function () { appliedCount += 1; };
ctx.showToast = function () {};

const settle = () => new Promise(function (r) { setImmediate(r); });

async function pollScenario(appliedSeq, resolveWith) {
  apiCalls = []; appliedCount = 0; intervals.length = 0;
  clock.now = 5000000;
  run("liveWatchSlots = [{ studentId: 'S1', name: 'A', openedAt: " + clock.now + " }];");
  run('liveWatchFramesFetching = false; liveWatchFramesSeq = 0; liveWatchFramesAppliedSeq = ' + appliedSeq + ';');
  run('liveWatchLastExtendAt = ' + clock.now + ';');   // 延長は打たない（画像取得だけを見る）
  run('liveWatchStartedAt = ' + clock.now + ';');

  const p1 = ctx.liveWatchPollTick();      // 1 回目（保留のまま）
  await settle();
  const p2 = ctx.liveWatchPollTick();      // 2 回目（in-flight なので投げないはず）
  await settle();
  const inflightBlocked = (apiCalls.length === 1);

  apiCalls[0].res({ success: true, data: resolveWith });
  await p1; await p2;
  return { inflightBlocked: inflightBlocked, calls: apiCalls.length, applied: appliedCount };
}

const sc1 = await pollScenario(0, [{ student_id: 'S1', data_url: 'data:image/jpeg;base64,AAA', at: 1000, at_text: 'x' }]);
check('C7 取得中に次の tick が来ても二重送信しない（in-flight 排他）',
  sc1.inflightBlocked === true, { calls: sc1.calls });
check('C8 最新の応答（通し番号が新しい）は画面へ反映される', sc1.applied === 1, { applied: sc1.applied });

const sc2 = await pollScenario(5, [{ student_id: 'S1', data_url: 'data:image/jpeg;base64,BBB', at: 1000, at_text: 'y' }]);
check('C9 周回遅れの応答（通し番号が古い）は画面へ反映しない（巻き戻り防止）',
  sc2.applied === 0, { applied: sc2.applied });

// 周期の切り替え（開始直後 → 6 秒後）
intervals.length = 0;
clock.now = 5000000;
run('liveWatchStartedAt = ' + clock.now + '; liveWatchPollTimer = null;');
check('C10 開始直後の周期は 0.8〜1.0 秒',
  ctx.getLiveWatchPollMs() >= 800 && ctx.getLiveWatchPollMs() <= 1000, ctx.getLiveWatchPollMs());
clock.now = 5000000 + 6000;
check('C11 6 秒経過後は 1.2〜1.5 秒へ戻る',
  ctx.getLiveWatchPollMs() >= 1200 && ctx.getLiveWatchPollMs() <= 1500, ctx.getLiveWatchPollMs());
run('liveWatchStartedAt = 0;');

// =============================================================================
// D. 拡張機能: live_watch の false → true で即時キャプチャ
// =============================================================================
console.log('===== D. 拡張機能: false → true の即時キャプチャ =====');

function extractConstBg(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const m = re.exec(bgSrc);
  if (!m) throw new Error('const not found: ' + name);
  let i = bgSrc.indexOf('=', m.index), depth = 0, end = -1, quote = '';
  for (; i < bgSrc.length; i++) {
    const ch = bgSrc[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  return bgSrc.slice(m.index, end + 1);
}

let bgBundle = '';
bgBundle += 'let liveWatchActive = false;\n';
bgBundle += 'let liveWatchInFlight = false;\n';
bgBundle += 'let liveWatchLastSentMs = 0;\n';
bgBundle += 'let liveWatchLoopTimer = null;\n';
bgBundle += extractConstBg('LIVE_WATCH_LOOP_MS') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_TARGET_MAX_B64') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_TARGET_MIN_B64') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_TARGET_WIDTH') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_MIN_WIDTH') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_QUALITIES') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_CAPTURE_QUALITY') + '\n';
bgBundle += extractConstBg('LIVE_WATCH_MAX_B64') + '\n';
bgBundle += extractConstBg('ACTIVE_SYNC_MS') + '\n';
['applyLiveWatchFlag', 'stopLiveWatchLoop', 'scheduleLiveWatchLoop', 'startLiveWatchLoop']
  .forEach(function (n) { bgBundle += extract(bgSrc, n) + '\n'; });

function makeBgEnv() {
  const timers = [];
  let captureCount = 0;
  const c = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp, Error,
    isFinite, isNaN, parseInt, parseFloat, Promise,
    Date: { now: function () { return 6000000; } },
    setTimeout: function (fn, ms) { const t = { fn: fn, ms: ms }; timers.push(t); return t; },
    clearTimeout: function (t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    chrome: { storage: { local: { set: async function () { return; } } } },
    // 撮影本体は「呼ばれた回数」だけを見る（中身は r58 で検証済み）
    liveWatchCaptureOnce: function () { captureCount += 1; return Promise.resolve(true); }
  };
  vm.createContext(c);
  vm.runInContext(bgBundle, c);
  return { ctx: c, timers: timers, captures: function () { return captureCount; } };
}

const envD = makeBgEnv();
check('D1 初期状態は live_watch=false（撮影しない）',
  vm.runInContext('liveWatchActive', envD.ctx) === false && envD.captures() === 0);

await envD.ctx.applyLiveWatchFlag(true);
check('D2 false → true の遷移で即座に 1 枚目を撮る（1.5 秒タイマーを待たない）',
  envD.captures() === 1, { captures: envD.captures() });
check('D3 遷移と同時に独立ループを開始する（タイマーが 1 本張られる）',
  envD.timers.length === 1 && envD.timers[0].ms === vm.runInContext('LIVE_WATCH_LOOP_MS', envD.ctx),
  envD.timers.map(function (t) { return t.ms; }));

// ループを 1 周させると、また撮って次のタイマーを張る
const t0 = envD.timers.shift();
t0.fn();
await settle();
await settle();
check('D4 ループは 1 周ごとに撮影し、次のタイマーを張り直す（常に 1 本）',
  envD.captures() === 2 && envD.timers.length === 1,
  { captures: envD.captures(), timers: envD.timers.length });

// 2 回目の applyLiveWatchFlag(true) は「遷移なし」なので撮らない（多重送信しない）
await envD.ctx.applyLiveWatchFlag(true);
check('D5 true → true（遷移なし）では余計に撮らない',
  envD.captures() === 2, { captures: envD.captures() });

// false にした瞬間に停止し、ループも止まる
await envD.ctx.applyLiveWatchFlag(false);
check('D6 true → false でループを止める（タイマーが残らない）',
  vm.runInContext('liveWatchActive', envD.ctx) === false && envD.timers.length === 0,
  { timers: envD.timers.length });
const beforeStop = envD.captures();
check('D7 停止後にループを回そうとしても撮らない（startLiveWatchLoop は no-op）',
  (function () { envD.ctx.startLiveWatchLoop(); return envD.timers.length === 0 && envD.captures() === beforeStop; })());

// =============================================================================
// E. 拡張機能: 独立ループの周期と画像サイズ（12〜18KB / 420〜480px / 30〜35%）
// =============================================================================
console.log('===== E. 独立ループの周期と画像サイズ =====');

const loopMs = constNum(bgSrc, 'LIVE_WATCH_LOOP_MS');
const targetMax = constNum(bgSrc, 'LIVE_WATCH_TARGET_MAX_B64');
const targetMin = constNum(bgSrc, 'LIVE_WATCH_TARGET_MIN_B64');
const targetWidth = constNum(bgSrc, 'LIVE_WATCH_TARGET_WIDTH');
const maxB64 = constNum(bgSrc, 'LIVE_WATCH_MAX_B64');
const captureQuality = constNum(bgSrc, 'LIVE_WATCH_CAPTURE_QUALITY');
const activeSync = constNum(bgSrc, 'ACTIVE_SYNC_MS');
const qualities = (function () {
  const m = /const LIVE_WATCH_QUALITIES = \[([^\]]+)\]/.exec(bgSrc);
  if (!m) throw new Error('LIVE_WATCH_QUALITIES not found');
  return m[1].split(',').map(function (s) { return Number(s.trim()); });
})();

check('E1 独立ループの周期は 1.0〜1.5 秒（1000〜1500ms）', loopMs >= 1000 && loopMs <= 1500, loopMs);
check('E2 目標サイズの上限は 18,000 文字（約18KB）', targetMax === 18000, targetMax);
check('E3 目標サイズの下限は 12,000 文字（約12KB）', targetMin === 12000, targetMin);
check('E4 目標より小さい画像は「目標レンジ内」として採用する',
  /b64\.length >= LIVE_WATCH_TARGET_MIN_B64 && b64\.length <= LIVE_WATCH_TARGET_MAX_B64/.test(bgSrc));
check('E5 縮小の目標横幅は 420〜480px', targetWidth >= 420 && targetWidth <= 480, targetWidth);
check('E6 撮影品質は 30〜35%', captureQuality >= 30 && captureQuality <= 35, captureQuality);
check('E7 縮小品質の起点は 30〜35%', qualities[0] >= 0.30 && qualities[0] <= 0.35, qualities[0]);
check('E8 送信の上限 30,000 文字は維持（固定仕様）', maxB64 === 30000, maxB64);
check('E9 ACTIVE_SYNC_MS（1.5 秒）は維持（固定仕様）', activeSync === 1500, activeSync);
check('E10 ハートビートの完了を待たない（await せずに追撃する）',
  /if \(liveWatchActive === true\) liveWatchCaptureOnce\(\);/.test(bgSrc) &&
  !/if \(liveWatchActive === true\) await liveWatchCaptureOnce\(\);/.test(bgSrc));
check('E11 1 枚目は applyLiveWatchFlag が撮る（遷移時のみ）',
  /if \(next\) \{[\s\S]{0,220}?liveWatchCaptureOnce\(\);[\s\S]{0,80}?startLiveWatchLoop\(\);/.test(
    extract(bgSrc, 'applyLiveWatchFlag')));
check('E12 in-flight 排他は維持（多重送信しない）',
  /if \(liveWatchInFlight\) return false;/.test(bgSrc) &&
  /liveWatchInFlight = true;/.test(bgSrc) &&
  /liveWatchInFlight = false;/.test(bgSrc));
check('E13 ループは setTimeout チェーン（常に 1 本・多重起動しない）',
  /if \(liveWatchLoopTimer\) return;/.test(bgSrc) &&
  /liveWatchLoopTimer = setTimeout\(/.test(bgSrc));
check('E14 ループは live_watch=false で止まる',
  /if \(!liveWatchActive\) \{ stopLiveWatchLoop\(\); return; \}/.test(bgSrc));

// =============================================================================
// F. 親GAS: 毎回 子GAS から最新フレームを並列取得（古い画像を溜めない）
// =============================================================================
console.log('===== F. 親GAS のフレーム取得（キャッシュしない） =====');

const framesBody = extract(gasSrc, 'liveWatchGetFramesSharded');
check('F1 フレーム取得は毎回 子GAS へ並列取得する（liveWatchShardPost_）',
  /liveWatchShardPost_\(urls, \{[\s\S]{0,200}?action: LIVE_WATCH_SHARD_FRAMES/.test(framesBody));
check('F2 フレーム取得の結果をキャッシュしない（cache.put / setValue を持たない）',
  !/cache\.put/.test(framesBody) && !/SetValue|setValue/.test(framesBody));
check('F3 フレーム取得は既存の並列取得（shardFetchMany）を通す＝維持',
  /shardFetchMany\(requests\)/.test(extract(gasSrc, 'liveWatchShardPost_')) &&
  /UrlFetchApp\.fetchAll\(reqs\)/.test(extract(gasSrc, 'shardFetchMany')));
check('F4 子GAS から来た画像は「新しい撮影時刻」を優先してマージする',
  /if \(hasImg && \(!cur\.has_image \|\| at > cur\.at\)\)/.test(framesBody));
check('F5 status の短時間キャッシュ（2 秒）はフレームに使っていない（画像は常に最新）',
  !/LIVE_WATCH_FRAME_PREFIX/.test(extract(gasSrc, 'liveWatchStatusSharded')));
check('F6 単独モード（シャード未設定）は従来どおりローカル完結',
  /if \(!urls\.length\) return local;/.test(framesBody));

// =============================================================================
// G. 出荷物 v1.6.10（固定仕様の維持）
// =============================================================================
console.log('===== G. v1.6.10 出荷物と固定仕様 =====');

function zipEntry(zipPath, entry) {
  return execSync(
    "python3 -c \"import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode('utf-8'))\" " +
      JSON.stringify(zipPath) + ' ' + JSON.stringify(entry),
    { cwd: ROOT, encoding: 'utf8' }
  );
}
function zipNames(zipPath) {
  return execSync(
    "python3 -c \"import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))\" " +
      JSON.stringify(zipPath),
    { cwd: ROOT, encoding: 'utf8' }
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
check('G1 extension/manifest.json の version は 1.6.10', manifest.version === '1.6.10', manifest.version);
check('G2 default_popup を持たない', !manifest.action || !manifest.action.default_popup);
const perms = (manifest.permissions || []).slice().sort().join(',');
check('G3 権限は既存のまま（新規権限の追加なし＝再同意プロンプトを出さない）',
  perms === 'alarms,identity,identity.email,idle,storage,tabs', perms);
check("G4 DEFAULT_GAS_URL は '' のまま", /const DEFAULT_GAS_URL = '';/.test(bgSrc));

const sm = JSON.parse(zipEntry('dist/store.zip', 'manifest.json'));
check('G5 dist/store.zip の manifest.version は 1.6.10', sm.version === '1.6.10', sm.version);
check('G6 dist/store.zip に default_popup が無い', !sm.action || !sm.action.default_popup);
const dm = JSON.parse(zipEntry('dist/direct.zip', 'manifest.json'));
check('G7 dist/direct.zip の manifest.version も 1.6.10', dm.version === '1.6.10', dm.version);
check('G8 dist/direct.zip は検証用（popup.html 同梱）',
  !!dm.action && !!dm.action.default_popup && /(^|\n)popup\.html(\n|$)/.test(zipNames('dist/direct.zip')));

const xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8');
check("G9 dist/update.xml の version は 1.6.10", /version='1\.6\.10'/.test(xml),
  (xml.match(/version='[^']+'/) || [])[0]);

const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/managed_policy.json'), 'utf8'));
const policySchools = Object.keys((policy && policy.gas_url_map && policy.gas_url_map.Value) || {});
check('G10 managed_policy は 14 校（東粟倉小は廃校のため含まない）',
  policySchools.length === 14 &&
  policySchools.indexOf('東粟倉小学校') === -1 &&
  policySchools.indexOf('樸学園') >= 0,
  { count: policySchools.length });

// ストア版 background.js が現物と一致（旧版混入なし）
//   ※ zipEntry は python の print() 経由なので末尾に改行が 1 つ余分に付く。
//     末尾の空白（改行）だけを落として中身を比較する。
const stripEol = function (s) { return String(s).replace(/\s+$/, ''); };
const storeBg = zipEntry('dist/store.zip', 'background.js');
check('G11 ストア版 background.js は extension/background.js と一致（旧版混入なし）',
  stripEol(storeBg) === stripEol(bgSrc),
  { zipLen: stripEol(storeBg).length, srcLen: stripEol(bgSrc).length });
check('G12 ストア版 lock.html / blocked.html も現物と一致（状態帯の撤去が反映されている）',
  stripEol(zipEntry('dist/store.zip', 'lock.html')) ===
    stripEol(fs.readFileSync(path.join(ROOT, 'extension/lock.html'), 'utf8')) &&
  stripEol(zipEntry('dist/store.zip', 'blocked.html')) ===
    stripEol(fs.readFileSync(path.join(ROOT, 'extension/blocked.html'), 'utf8')));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);

}   // main() ここまで

main().catch(function (e) {
  console.error('r59 実行時エラー:', e && e.stack ? e.stack : e);
  process.exit(1);
});
