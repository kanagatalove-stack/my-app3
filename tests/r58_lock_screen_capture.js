// ============================================================================
// r58_lock_screen_capture.js — 画面ロック中・URL規制中のキャプチャ継続と
//                              状態フレームのフォールバック（v1.6.9 / R58）
//
//  【実機で分かったこと（R57 までの状態）】
//    ロック画面（lock.html）・規制画面（blocked.html）を表示している間は
//    自拡張のページ（chrome-extension://）であることを理由にキャプチャを
//    スキップしていた。また chrome:// 等の保護ページでは captureVisibleTab が
//    失敗し、管理画面は「端末の送信を待っています…」のまま放置されていた。
//    そのため教員は「ロック・規制が本当に効いているか」を画面上で確認できなかった。
//
//  【R58 の要件】
//    ① ロック中・規制中でもライブ視聴（live_frame）／通常スクリーンショットの
//       撮影・送信をスキップしない（自拡張のロック画面・規制画面は撮影できる）。
//    ② 撮影できない場合でも、ロック／規制が有効なら「🔒 画面ロック中」
//       「🚫 アクセス制限中」＋対象URL＋現在時刻を描いた JPEG を生成して送る。
//       ※ ロック中・規制中でない通常時の失敗は従来どおり（ダミーを生成しない）。
//    ③ 拡張機能は v1.6.9（新規権限の追加なし）。
//
//  明示リスト方式: 必要な関数・定数だけを列挙して読み込む。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- 明示リスト方式の共通部品（background.js から関数・定数を切り出す） ----
function extract(name) {
  const re = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\s*\\(', 'm');
  const m = re.exec(bgSrc);
  if (!m) throw new Error('not found fn: ' + name);
  const start = m.index;
  let i = bgSrc.indexOf('{', start), depth = 0, end = -1;
  for (; i < bgSrc.length; i++) {
    if (bgSrc[i] === '{') depth++;
    else if (bgSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return bgSrc.slice(start, end + 1);
}
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const m = re.exec(bgSrc);
  if (!m) throw new Error('const not found: ' + name);
  const start = m.index;
  let i = bgSrc.indexOf('=', start), depth = 0, end = -1;
  let quote = '';        // 文字列リテラル内の ; や括弧では終端判定しない
  for (; i < bgSrc.length; i++) {
    const ch = bgSrc[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }   // エスケープは次文字ごと読み飛ばす
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  return bgSrc.slice(start, end + 1);
}

const CONSTS = [
  'DEFAULT_GAS_URL',
  // 画面一覧（スクリーンショット）
  'SCREENSHOT_MAX_B64', 'SCREENSHOT_WIDTHS', 'SCREENSHOT_QUALITIES',
  // ライブ視聴（軽量キャプチャ）
  'LIVE_WATCH_MAX_B64', 'LIVE_WATCH_TARGET_MAX_B64', 'LIVE_WATCH_TARGET_MIN_B64',
  'LIVE_WATCH_TARGET_WIDTH', 'LIVE_WATCH_MIN_WIDTH',
  'LIVE_WATCH_QUALITIES', 'LIVE_WATCH_CAPTURE_QUALITY', 'LIVE_WATCH_FALLBACK_QUALITIES',
  // 【R59】独立ループの周期（applyLiveWatchFlag が参照する）
  'LIVE_WATCH_LOOP_MS',
  // 【R58】状態フレーム（ロック中・規制中の代替画像）
  'RESTRICTION_FRAME_WIDTHS', 'RESTRICTION_FRAME_QUALITIES', 'RESTRICTION_FRAME_STATIC',
  // 【R60】新しいタブ（Google トップ画面）の仮想プレビュー
  'NEW_TAB_PAGE_PREFIXES', 'NEW_TAB_FRAME_WIDTHS', 'NEW_TAB_FRAME_QUALITIES'
];

const FNS = [
  // 【R58】状態フレーム生成
  'truncateFrameText_', 'bufferToBase64_', 'buildRestrictionFrameMeta_',
  'drawRestrictionFrame_', 'renderRestrictionStateFrame_', 'restrictionStateForTab_',
  // 【R60】新しいタブ判定（restrictionStateForTab_ が参照する）
  'isNewTabPageUrl_',
  // 既存の判定・縮小
  'evaluateUrlRestriction', 'downscaleForLiveWatch', 'downscaleForSheet',
  'captureLightweightLiveFrame_', 'applyLiveWatchFlag',
  // 撮影・送信の本体
  'liveWatchCaptureOnce', 'notifyScreenshotBlocked', 'postScreenshotPayload_',
  'captureAndUploadScreenshot'
];

let BUNDLE = '';
BUNDLE += 'let liveWatchActive = false;\n';
BUNDLE += 'let liveWatchInFlight = false;\n';
BUNDLE += 'let liveWatchLastSentMs = 0;\n';
CONSTS.forEach(function (n) { BUNDLE += extractConst(n) + '\n'; });
FNS.forEach(function (n) { BUNDLE += extract(n) + '\n'; });

// ============================================================================
// vm 環境（chrome.* / fetch / OffscreenCanvas をスタブ）
// ============================================================================
const SELF_PREFIX = 'chrome-extension://kjhgfdsapoiuytrewqlkjhgfdsaqwert/';

// 上限内に収まる「撮影できた」画像（Base64 1,000 文字）
const SMALL_JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

/**
 * OffscreenCanvas のスタブ。factor を大きくすると出力が膨らみ、
 * 上限に収まらない状況（＝静的プレースホルダへのフォールバック）を再現できる。
 */
function canvasStub(factor) {
  return function OffscreenCanvas(w, h) {
    return {
      getContext: function () {
        return {
          fillStyle: '', font: '', textAlign: '', textBaseline: '',
          imageSmoothingEnabled: false, imageSmoothingQuality: '',
          fillRect: function () {}, fillText: function () {}, drawImage: function () {},
          arc: function () {}, closePath: function () {}, fill: function () {}
        };
      },
      convertToBlob: async function () {
        const n = Math.max(4, Math.round(w * h * factor));
        const arr = new Uint8Array(n);
        arr[0] = 0xFF; arr[1] = 0xD8; arr[2] = 0xFF; arr[3] = 0xE0; // JPEG の目印
        return { arrayBuffer: async function () { return arr.buffer; } };
      }
    };
  };
}

/**
 * background.js の一部を評価した vm 環境を作る。
 *   opts.tab            アクティブタブ
 *   opts.storageData    chrome.storage.local.get(null) が返す値
 *   opts.captureThrows  captureVisibleTab を失敗させる
 *   opts.captureReturns captureVisibleTab の戻り値（省略時は SMALL_JPEG）
 *   opts.OffscreenCanvas / opts.createImageBitmap は存在すれば注入
 */
function makeEnv(opts) {
  const o = opts || {};
  const store = o.storageData || {};
  const fetched = [];
  const captured = [];
  const blocks = [];

  const ctx = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    JSON: JSON, Math: Math, String: String, Number: Number, Array: Array,
    Object: Object, Boolean: Boolean, RegExp: RegExp, Error: Error,
    Set: Set, Map: Map, Uint8Array: Uint8Array, Date: Date, URL: URL,
    isFinite: isFinite, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    fetch: async function (url, init) {
      let body = null;
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
      fetched.push({ url: url, body: body });
      return { ok: true, status: 200, json: async function () { return { success: true, accepted: true }; } };
    },
    // 本テストの焦点は「撮影フローがスキップされないこと」なので、
    // GAS URL 解決はテスト用に単純化する（resolveGasUrl 自体は他スイートで検証済み）。
    resolveGasUrl: function (d) { return (d && d.gas_url) ? String(d.gas_url) : ''; },
    chrome: {
      runtime: { getURL: function (p) { return SELF_PREFIX + (p || ''); } },
      storage: {
        local: {
          get: async function () { return JSON.parse(JSON.stringify(store)); },
          set: async function () { return; }
        }
      },
      tabs: {
        query: async function () { return o.tab ? [o.tab] : []; },
        captureVisibleTab: async function (winId, opt) {
          captured.push({ winId: winId, opt: opt });
          if (o.captureThrows) throw new Error('capture failed');
          return (o.captureReturns !== undefined) ? o.captureReturns : SMALL_JPEG;
        }
      }
    }
  };
  if (o.OffscreenCanvas) ctx.OffscreenCanvas = o.OffscreenCanvas;
  if (o.createImageBitmap !== undefined) ctx.createImageBitmap = o.createImageBitmap;

  vm.createContext(ctx);
  vm.runInContext(BUNDLE, ctx);

  return { ctx: ctx, fetched: fetched, captured: captured, blocks: blocks, store: store };
}

function call(env, name, args) {
  const fn = vm.runInContext(name, env.ctx);
  return fn.apply(null, args || []);
}
function setVar(env, name, v) { vm.runInContext(name + ' = ' + JSON.stringify(v) + ';', env.ctx); }

// CommonJS + トップレベル await は併用できないため、検証本体は async 関数に包む。
async function main() {

// ============================================================================
// A. ロック中・規制中の判定（restrictionStateForTab_）
// ============================================================================
console.log('\n===== A. ロック中・規制中の判定 =====');

const envA = makeEnv({});
const fnState = vm.runInContext('restrictionStateForTab_', envA.ctx);

// A1: 自拡張のロック画面を表示中 → ロック中（元URLを復元する）
const a1 = fnState({}, SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/watch?v=abc'));
check('A1 lock.html を表示中ならロック中と判定し元URLを拾う',
  a1.active === true && a1.kind === 'lock' && a1.url === 'https://www.youtube.com/watch?v=abc', a1);

// A2: 自拡張の規制画面を表示中 → 規制中（対象URL・規制モードを復元する）
const a2 = fnState({}, SELF_PREFIX + 'blocked.html?url=' + encodeURIComponent('https://game.example.com/') + '&mode=blacklist');
check('A2 blocked.html を表示中なら規制中と判定し対象URL・モードを拾う',
  a2.active === true && a2.kind === 'block' && a2.url === 'https://game.example.com/' && a2.mode === 'BLACKLIST', a2);

// A3: ストレージの screen_lock（＝全タブ差し替え直前の隙間も拾う）
const a3 = fnState({ screen_lock: true }, 'https://www.google.com/');
check('A3 screen_lock が有効ならロック中と判定する',
  a3.active === true && a3.kind === 'lock' && a3.url === 'https://www.google.com/', a3);

// A4: ブラックリスト規制に該当
const a4 = fnState({ filter_mode: 'BLACKLIST', blacklist_urls: ['example.com'] }, 'https://game.example.com/play');
check('A4 規制リストに該当するURLは規制中と判定する',
  a4.active === true && a4.kind === 'block' && a4.mode === 'BLACKLIST', a4);

// A5: 規制OFFの通常ページ → 対象外
const a5 = fnState({ filter_mode: 'OFF' }, 'https://www.google.com/');
check('A5 規制OFFの通常ページはロック中・規制中のどちらでもない',
  a5.active === false && a5.kind === '', a5);

// A6: ポリシー未設定の通常ページ → 対象外
const a6 = fnState({}, 'https://www.google.com/');
check('A6 ポリシー未設定の通常ページは対象外（通常時の失敗はダミー生成しない前提）',
  a6.active === false && a6.kind === '', a6);

// ============================================================================
// B. 状態フレームの内容と生成（buildRestrictionFrameMeta_ / renderRestrictionStateFrame_）
// ============================================================================
console.log('\n===== B. 状態フレームの内容と生成 =====');

const envB = makeEnv({ OffscreenCanvas: canvasStub(0.05) });
const fnMeta = vm.runInContext('buildRestrictionFrameMeta_', envB.ctx);
const fnRender = vm.runInContext('renderRestrictionStateFrame_', envB.ctx);

// B1: ロック用の見出し（🔒・赤）
const m1 = fnMeta({ kind: 'lock', url: 'https://www.youtube.com/watch?v=abc', mode: '' });
check('B1 ロック中の見出しは 🔒 画面ロック中（赤系アクセント）',
  m1.glyph === '🔒' && m1.title === '画面ロック中' && m1.accent === '#ef4444' && m1.isBlock === false,
  { glyph: m1.glyph, title: m1.title, accent: m1.accent });

// B2: 規制用の見出し（🚫・橙）＋規制モードの説明
const m2 = fnMeta({ kind: 'block', url: 'https://game.example.com/', mode: 'BLACKLIST' });
check('B2 規制中の見出しは 🚫 アクセス制限中（橙系アクセント）',
  m2.glyph === '🚫' && m2.title === 'アクセス制限中' && m2.accent === '#f59e0b' && m2.isBlock === true,
  { glyph: m2.glyph, title: m2.title, accent: m2.accent });
check('B3 規制モード（禁止リスト）が説明文に含まれる',
  /禁止リスト/.test(m2.modeLabel), m2.modeLabel);

// B4: 現在時刻が「YYYY/MM/DD HH:mm:ss」で入る
check('B4 現在時刻が YYYY/MM/DD HH:mm:ss 形式で描画内容に含まれる',
  /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(m1.timeText), m1.timeText);

// B5: 長いURLは切り詰める（サムネイルでのはみ出し防止）
const m5 = fnMeta({ kind: 'block', url: 'https://' + 'a'.repeat(200) + '.example.com/' , mode: 'WHITELIST' });
check('B5 長いURLは切り詰めて「…」を付ける',
  m5.urlText.length <= 58 && /…$/.test(m5.urlText),
  { len: m5.urlText.length });

// B6: OffscreenCanvas がある環境では JPEG を生成できる
const b6 = await fnRender({ kind: 'lock', url: 'https://www.youtube.com/', mode: '' }, 30000);
check('B6 ロック中の状態フレームを JPEG として生成できる',
  typeof b6 === 'string' && /^data:image\/jpeg;base64,\/9j\//.test(b6), b6 ? b6.slice(0, 34) : b6);
check('B7 生成した状態フレームはライブ視聴の上限（30,000文字）以内',
  !!b6 && String(b6).replace(/^data:image\/[a-z]+;base64,/i, '').length <= 30000,
  b6 ? String(b6).replace(/^data:image\/[a-z]+;base64,/i, '').length : null);

// B8: OffscreenCanvas が無い環境でも必ず画像（静的プレースホルダ）を返す
const envB2 = makeEnv({});
const fnRender2 = vm.runInContext('renderRestrictionStateFrame_', envB2.ctx);
const staticFrame = vm.runInContext('RESTRICTION_FRAME_STATIC', envB2.ctx);
const b8 = await fnRender2({ kind: 'block', url: 'https://x.example.com/', mode: 'WHITELIST' }, 30000);
check('B8 OffscreenCanvas が無くても状態フレーム（静的JPEG）を返す',
  b8 === staticFrame && /^data:image\/jpeg;base64,/.test(b8), b8 ? b8.slice(0, 30) : b8);

// B9: どの横幅でも上限に収まらない場合は静的プレースホルダへ落とす
const envB3 = makeEnv({ OffscreenCanvas: canvasStub(1.0) });
const fnRender3 = vm.runInContext('renderRestrictionStateFrame_', envB3.ctx);
const staticFrame3 = vm.runInContext('RESTRICTION_FRAME_STATIC', envB3.ctx);
const b9 = await fnRender3({ kind: 'lock', url: 'https://x.example.com/', mode: '' }, 30000);
check('B9 上限に収まらない場合は静的プレースホルダへフォールバックする（送信ゼロにしない）',
  b9 === staticFrame3, b9 === staticFrame3 ? 'static' : 'other');

// ============================================================================
// C. ライブ視聴（live_frame）がロック中・規制中でも送信される
// ============================================================================
console.log('\n===== C. ライブ視聴のロック中・規制中キャプチャ =====');

const LIVE_BASE = { student_id: 'S100', gas_url: 'https://gas.example.com/exec' };

// C1: ロック画面（lock.html）を表示中でも撮影・送信する（R58 の中核）
const envC1 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 1, url: SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/') },
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC1, 'liveWatchActive', true);
const c1 = await call(envC1, 'liveWatchCaptureOnce');
check('C1 ロック画面（lock.html）でもライブ視聴の撮影をスキップしない',
  envC1.captured.length === 1 && c1 === true, { captured: envC1.captured.length, ret: c1 });
check('C2 ロック画面の撮影結果が live_frame として送信される',
  envC1.fetched.length === 1 && envC1.fetched[0].body.action === 'live_frame' &&
  /^data:image\//.test(envC1.fetched[0].body.image_data),
  envC1.fetched.length ? envC1.fetched[0].body.action : null);

// C3: 規制画面（blocked.html）を表示中でも撮影・送信する
const envC3 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { filter_mode: 'BLACKLIST', blacklist_urls: ['example.com'] }),
  tab: { windowId: 2, url: SELF_PREFIX + 'blocked.html?url=' + encodeURIComponent('https://game.example.com/') + '&mode=BLACKLIST' },
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC3, 'liveWatchActive', true);
const c3 = await call(envC3, 'liveWatchCaptureOnce');
check('C3 規制画面（blocked.html）でもライブ視聴の撮影をスキップしない',
  envC3.captured.length === 1 && c3 === true, { captured: envC3.captured.length, ret: c3 });
check('C4 規制画面の撮影結果が live_frame として送信される',
  envC3.fetched.length === 1 && envC3.fetched[0].body.action === 'live_frame',
  envC3.fetched.length ? envC3.fetched[0].body.action : null);

// C5: chrome:// で撮影できない＋ロック中 → 状態フレームで送信する
const envC5 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 3, url: 'chrome://newtab/' },
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC5, 'liveWatchActive', true);
const c5 = await call(envC5, 'liveWatchCaptureOnce');
check('C5 撮影できない保護ページでもロック中なら状態フレームを送信する',
  envC5.captured.length === 0 && c5 === true && envC5.fetched.length === 1 &&
  envC5.fetched[0].body.action === 'live_frame',
  { captured: envC5.captured.length, fetched: envC5.fetched.length, ret: c5 });
check('C6 状態フレームは JPEG（data:image/jpeg;base64）として送信される',
  envC5.fetched.length === 1 && /^data:image\/jpeg;base64,\/9j\//.test(envC5.fetched[0].body.image_data),
  envC5.fetched.length ? String(envC5.fetched[0].body.image_data).slice(0, 34) : null);

// C7: captureVisibleTab が例外＋ロック中 → 状態フレームで送信する
const envC7 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 4, url: SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/') },
  captureThrows: true,
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC7, 'liveWatchActive', true);
const c7 = await call(envC7, 'liveWatchCaptureOnce');
check('C7 撮影が例外でもロック中なら状態フレームで送信を継続する（黒画面のまま放置しない）',
  c7 === true && envC7.fetched.length === 1 && envC7.fetched[0].body.action === 'live_frame',
  { fetched: envC7.fetched.length, ret: c7 });

// C8: ロック中・規制中でない通常時の失敗は従来どおり送信しない（ダミーを作らない）
const envC8 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: false, filter_mode: 'OFF' }),
  tab: { windowId: 5, url: 'chrome://settings/' },
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC8, 'liveWatchActive', true);
const c8 = await call(envC8, 'liveWatchCaptureOnce');
check('C8 通常時（非ロック・非規制）の撮影失敗は従来どおり送信しない',
  c8 === false && envC8.fetched.length === 0, { fetched: envC8.fetched.length, ret: c8 });

const envC9 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: false, filter_mode: 'OFF' }),
  tab: { windowId: 6, url: 'https://www.google.com/' },
  captureThrows: true,
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC9, 'liveWatchActive', true);
const c9 = await call(envC9, 'liveWatchCaptureOnce');
check('C9 通常時の撮影例外もダミー画像を生成しない（エラー処理を維持）',
  c9 === false && envC9.fetched.length === 0, { fetched: envC9.fetched.length, ret: c9 });

// C10: live_watch が false なら撮影すらしない（既存仕様の維持）
const envC10 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 7, url: SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/') },
  OffscreenCanvas: canvasStub(0.05)
});
setVar(envC10, 'liveWatchActive', false);
const c10 = await call(envC10, 'liveWatchCaptureOnce');
check('C10 live_watch=false の端末はロック中でも撮影しない（既存仕様の維持）',
  c10 === false && envC10.captured.length === 0 && envC10.fetched.length === 0,
  { captured: envC10.captured.length, ret: c10 });

// ============================================================================
// D. 画面一覧（screenshot）がロック中・規制中でも送信される
// ============================================================================
console.log('\n===== D. 画面一覧のロック中・規制中キャプチャ =====');

// D1: ロック画面を表示中＋撮影成功 → ロック画面そのものを screenshot として送る
const envD1 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 11, url: SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/') },
  OffscreenCanvas: canvasStub(0.05)
});
await call(envD1, 'captureAndUploadScreenshot');
check('D1 ロック画面を表示中でも screenshot の撮影をスキップしない',
  envD1.captured.length === 1, { captured: envD1.captured.length });
check('D2 ロック画面そのものが screenshot として送信される',
  envD1.fetched.length === 1 && envD1.fetched[0].body.action === 'screenshot' &&
  /^data:image\//.test(envD1.fetched[0].body.image_data),
  envD1.fetched.length ? envD1.fetched[0].body.action : null);

// D3: ロック中＋撮影例外 → 状態フレームを screenshot として送る
const envD3 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 12, url: SELF_PREFIX + 'lock.html?url=' + encodeURIComponent('https://www.youtube.com/') },
  captureThrows: true,
  OffscreenCanvas: canvasStub(0.05)
});
await call(envD3, 'captureAndUploadScreenshot');
check('D3 ロック中の撮影例外は screenshot_blocked ではなく状態フレームを送る',
  envD3.fetched.length === 1 && envD3.fetched[0].body.action === 'screenshot' &&
  /^data:image\/jpeg;base64,\/9j\//.test(envD3.fetched[0].body.image_data),
  envD3.fetched.length ? envD3.fetched[0].body.action : null);

// D4: chrome:// ＋規制中 → 状態フレームを screenshot として送る
const envD4 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { filter_mode: 'BLACKLIST', blacklist_urls: ['game.example.com'] }),
  tab: { windowId: 13, url: 'chrome://settings/' },
  OffscreenCanvas: canvasStub(0.05)
});
await call(envD4, 'captureAndUploadScreenshot');
check('D4 撮影できない保護ページでも規制中なら状態フレームを送る',
  envD4.captured.length === 0 && envD4.fetched.length === 1 &&
  envD4.fetched[0].body.action === 'screenshot',
  { captured: envD4.captured.length, fetched: envD4.fetched.length });

// D5: 通常時＋撮影例外 → 従来どおり screenshot_blocked（ダミーを作らない）
const envD5 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: false, filter_mode: 'OFF' }),
  tab: { windowId: 14, url: 'https://www.google.com/' },
  captureThrows: true,
  OffscreenCanvas: canvasStub(0.05)
});
await call(envD5, 'captureAndUploadScreenshot');
check('D5 通常時の撮影例外は従来どおり screenshot_blocked を通知する',
  envD5.fetched.length === 1 && envD5.fetched[0].body.action === 'screenshot_blocked',
  envD5.fetched.length ? envD5.fetched[0].body.action : null);

// D6: 通常時＋chrome:// → 従来どおり chrome_protected
const envD6 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: false, filter_mode: 'OFF' }),
  tab: { windowId: 15, url: 'chrome://settings/' },
  OffscreenCanvas: canvasStub(0.05)
});
await call(envD6, 'captureAndUploadScreenshot');
check('D6 通常時の保護ページは従来どおり chrome_protected を通知する',
  envD6.fetched.length === 1 && envD6.fetched[0].body.action === 'screenshot_blocked' &&
  envD6.fetched[0].body.reason === 'chrome_protected',
  envD6.fetched.length ? envD6.fetched[0].body.reason : null);

// D7: ロック中＋縮小不可（上限超過・OffscreenCanvasなし）→ 状態フレームで代替
const envD7 = makeEnv({
  storageData: Object.assign({}, LIVE_BASE, { screen_lock: true }),
  tab: { windowId: 16, url: 'https://www.youtube.com/' },
  captureReturns: 'data:image/jpeg;base64,' + 'B'.repeat(50000),
  OffscreenCanvas: canvasStub(0.05)
  // createImageBitmap を注入しない → downscaleForSheet が null を返す状況
});
await call(envD7, 'captureAndUploadScreenshot');
check('D7 ロック中に縮小できなくても状態フレームで送信する（送信ゼロにしない）',
  envD7.fetched.length === 1 && envD7.fetched[0].body.action === 'screenshot' &&
  /^data:image\/jpeg;base64,\/9j\//.test(envD7.fetched[0].body.image_data),
  envD7.fetched.length ? envD7.fetched[0].body.action : null);

// ============================================================================
// E. 出荷物と固定仕様（v1.6.11）
// ============================================================================
console.log('\n===== E. v1.6.11 出荷物と固定仕様 =====');

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
check('E1 extension/manifest.json の version は 1.6.11', manifest.version === '1.6.11', manifest.version);
check('E2 default_popup を持たない（児童のアイコン操作は無反応）',
  !manifest.action || !manifest.action.default_popup);
const perms = (manifest.permissions || []).slice().sort().join(',');
check('E3 権限は既存のまま（新規権限の追加なし＝再同意プロンプトを出さない）',
  perms === 'alarms,identity,identity.email,idle,storage,tabs', perms);
check("E4 DEFAULT_GAS_URL は '' のまま", /const DEFAULT_GAS_URL = '';/.test(bgSrc));
check('E5 ACTIVE_SYNC_MS（1.5 秒）は維持', /const ACTIVE_SYNC_MS = 1500;/.test(bgSrc));

const sm = JSON.parse(zipEntry('dist/store.zip', 'manifest.json'));
check('E6 dist/store.zip の manifest.version は 1.6.11', sm.version === '1.6.11', sm.version);
check('E7 dist/store.zip に default_popup が無い', !sm.action || !sm.action.default_popup);

const dm = JSON.parse(zipEntry('dist/direct.zip', 'manifest.json'));
check('E8 dist/direct.zip の manifest.version も 1.6.11', dm.version === '1.6.11', dm.version);
check('E9 dist/direct.zip は検証用（popup.html 同梱）',
  !!dm.action && !!dm.action.default_popup && /(^|\n)popup\.html(\n|$)/.test(zipNames('dist/direct.zip')));

const xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8');
check("E10 dist/update.xml の version は 1.6.11", /version='1\.6\.11'/.test(xml),
  (xml.match(/version='[^']+'/) || [])[0]);

// 【R59】ロック画面・規制画面の上部ステータス帯は撤去し、R57 以前の構成へ戻した。
//   状態は「生の画面」ではなく、撮影できない場合の状態フレーム（B/C 節）で伝える。
const lockHtml = fs.readFileSync(path.join(ROOT, 'extension/lock.html'), 'utf8');
const blockedHtml = fs.readFileSync(path.join(ROOT, 'extension/blocked.html'), 'utf8');
check('E11 lock.html から上部ステータス帯を撤去した（.lock-status-bar も CSS も残さない）',
  lockHtml.indexOf('lock-status-bar') === -1 &&
  lockHtml.indexOf('lock-status-emoji') === -1 &&
  lockHtml.indexOf('lock-status-dot') === -1 &&
  !/font-size:\s*26px/.test(lockHtml));
check('E12 blocked.html から上部ステータス帯を撤去した（.lock-status-bar も CSS も残さない）',
  blockedHtml.indexOf('lock-status-bar') === -1 &&
  blockedHtml.indexOf('lock-status-emoji') === -1 &&
  blockedHtml.indexOf('lock-status-dot') === -1 &&
  !/font-size:\s*26px/.test(blockedHtml));
check('E13 両画面の body 余白は状態帯のぶんを確保しない（padding: 24px へ戻した）',
  /padding:\s*24px;/.test(lockHtml) && /padding:\s*24px;/.test(blockedHtml) &&
  lockHtml.indexOf('104px') === -1 && blockedHtml.indexOf('104px') === -1);
check('E13b blocked.html は「アクセスが制限されています」より下の要素を全部削除した',
  blockedHtml.indexOf('lock-subtitle') === -1 &&
  blockedHtml.indexOf('lock-notice') === -1 &&
  blockedHtml.indexOf('lock-detail') === -1 &&
  blockedHtml.indexOf('blockedUrl') === -1 &&
  blockedHtml.indexOf('filterMode') === -1 &&
  blockedHtml.indexOf('accountLabel') === -1 &&
  blockedHtml.indexOf('先生の指示に従って作業を進めましょう') === -1 &&
  blockedHtml.indexOf('ブロック対象URL') === -1);
check('E13c blocked.html のカードは「アイコン＋見出し」だけで閉じている',
  /<h1 class="lock-title">アクセスが制限されています<\/h1>\s*\n\s*<\/div>/.test(blockedHtml) &&
  /<div class="lock-icon-wrap">/.test(blockedHtml));
check('E13d lock.html のカード内容は元のまま（画面ロック中／先生の話をよく聞きましょう／先生からの指示）',
  /<h1 class="lock-title">画面ロック中<\/h1>/.test(lockHtml) &&
  /先生の話をよく聞きましょう/.test(lockHtml) &&
  /先生からの指示/.test(lockHtml) &&
  /<div class="lock-instructions">/.test(lockHtml));
check('E14 ロック画面・規制画面は外部CDNを使わない（オリジナルSVG＋自己完結CSS）',
  !/https?:\/\/(cdn|fonts|ajax)\./i.test(lockHtml) && !/https?:\/\/(cdn|fonts|ajax)\./i.test(blockedHtml));

// 実装の構造（自拡張ページを「保護ページ」から除外している＝撮影対象にしている）
check('E15 liveWatchCaptureOnce は自拡張ページを保護ページ扱いから除外する',
  /const isOwnPage = !!selfBase && url\.startsWith\(selfBase\);/.test(bgSrc) &&
  /const protectedPage = !isOwnPage && \(/.test(bgSrc));
check('E16 状態フレームは live_frame と screenshot の両方から使われる',
  /renderRestrictionStateFrame_\(rest, LIVE_WATCH_MAX_B64\)/.test(bgSrc) &&
  /renderRestrictionStateFrame_\(rest, SCREENSHOT_MAX_B64\)/.test(bgSrc));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);

}   // main() ここまで

main().catch(function (e) {
  console.error('r58 実行時エラー:', e && e.stack ? e.stack : e);
  process.exit(1);
});
