// =============================================================================
// R60: ライブ視聴の起動＆切り替わり高速化 ＋ 新しいタブ（Google トップ）仮想プレビュー
//
//  実機症状:
//    ① 「ライブ視聴を開始」してから最初の画像まで約 12.5 秒、切り替わりも 6〜9 秒。
//    ② 児童端末が新しいタブ（chrome://newtab/ 等）を表示していると、
//       ライブ視聴・画面一覧の両方が「🚫 アクセス制限中」になっていた。
//       実態は Google トップ画面を開いているだけ（規制ではない）。
//
//  本テストで固定する仕様:
//    A. 新しいタブは「規制」ではなく仮想の Google 検索トップ画面プレビュー
//       （ライブ視聴・画面一覧の両方。data:image/jpeg;base64,... を送信）
//    B. 「ライブ視聴を開始」はオプティミスティック UI（0ms で待機タイル／失敗時ロールバック）
//    C. フレーム取得は「応答完了直後 150〜250ms に次を投げる」連続パイプライン
//       ＋ /exec 連続失敗時のクールダウンは 60 秒
//    D. 拡張機能は LIVE_WATCH_LOOP_MS === 800 / LIVE_WATCH_TARGET_MAX_B64 === 10000
//       ＋ タブ切り替え（tabs.onActivated）で即時キャプチャ
//    E. 親GAS はフレームをキャッシュしない（毎回 shardFetchMany）
//    F. 出荷物 v1.6.11（固定仕様の維持）
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

function constNum(src, name) {
  const m = new RegExp('^[ \\t]*const ' + name + '\\s*=\\s*([0-9]+)', 'm').exec(src);
  if (!m) throw new Error('const not found: ' + name);
  return Number(m[1]);
}

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

async function main() {
  // ===========================================================================
  // A. 新しいタブ（Google トップ画面）の仮想プレビュー
  // ===========================================================================
  console.log('===== A. 新しいタブ = Google トップ画面の仮想プレビュー =====');

  const isNtp = extract(bgSrc, 'isNewTabPageUrl_');
  const drawNtp = extract(bgSrc, 'drawNewTabPreviewFrame_');
  const renderNtp = extract(bgSrc, 'renderNewTabPreviewFrame_');
  const restFn = extract(bgSrc, 'restrictionStateForTab_');
  const liveCap = extract(bgSrc, 'liveWatchCaptureOnce');
  const shotFn = extract(bgSrc, 'captureAndUploadScreenshot');

  check('A1 新しいタブ判定 isNewTabPageUrl_ がある', !!isNtp);
  check('A2 chrome://newtab / chrome://new-tab-page / chrome-search://local-ntp を対象にする',
    /chrome:\/\/newtab/.test(bgSrc) && /chrome:\/\/new-tab-page/.test(bgSrc) &&
    /chrome-search:\/\/local-ntp/.test(bgSrc));
  check('A3 判定は大文字小文字を吸収し前方一致で見る',
    /toLowerCase\(\)/.test(isNtp) && /startsWith\(NEW_TAB_PAGE_PREFIXES\[i\]\)/.test(isNtp));
  check('A4 新しいタブは「規制中」にしない（newtab:true を返す）',
    /rest\.newtab === true/.test(bgSrc) &&
    /return \{ active: false, kind: '', url: url, mode: '', newtab: true \};/.test(restFn));
  check('A5 画面ロック中は新しいタブより優先する（ロック時は newtab にしない）',
    /const __locked0 = \(__d0\.screen_lock === true\) \|\| \(__d0\.screen_locked === true\);/.test(restFn) &&
    /if \(!__locked0 && isNewTabPageUrl_\(url\)\)/.test(restFn));
  check('A6 仮想プレビューは OffscreenCanvas で描く', /new OffscreenCanvas\(W, H\)/.test(drawNtp));
  check('A7 白背景＋角丸の検索バー風 UI を描く',
    /#ffffff/.test(drawNtp) && /roundRectPath_\(/.test(drawNtp) && /#dadce0/.test(drawNtp));
  check('A8 カラフルな「Google」ロゴ風文字を描く（6 文字・ブランドカラー）',
    /#4285f4/.test(drawNtp) && /#ea4335/.test(drawNtp) &&
    /#fbbc05/.test(drawNtp) && /#34a853/.test(drawNtp));
  check('A9 下部に「新しいタブ（Google トップ画面）」の注記と現在時刻を描く',
    /新しいタブ（Google トップ画面）/.test(drawNtp) &&
    /newTabFrameTimeText_\(\)/.test(drawNtp));
  check('A10 JPEG の data URL で返す（上限内に収まる品質を探す）',
    /convertToBlob\(\{ type: 'image\/jpeg'/.test(drawNtp) &&
    /return 'data:image\/jpeg;base64,' \+ b64;/.test(drawNtp));
  check('A11 ライブ視聴は仮想プレビューを送る（10,000 文字上限）',
    /renderNewTabPreviewFrame_\(LIVE_WATCH_MAX_B64\)/.test(liveCap));
  check('A12 画面一覧も仮想プレビューを送る（42,000 文字上限）',
    /renderNewTabPreviewFrame_\(SCREENSHOT_MAX_B64\)/.test(shotFn));
  check('A13 画面一覧は screenshot として送信する（契約は不変）',
    /postScreenshotPayload_\(effectiveGasUrl, studentId, newTabFrame\)/.test(shotFn));
  check('A14 実際の https://www.google.com/ は従来どおり実画面を撮る',
    /captureVisibleTab\(tab\.windowId/.test(liveCap) && /captureVisibleTab\(tab\.windowId/.test(shotFn));
  check('A15 どの幅でも上限に収まらなければ静的プレースホルダで必ず送る',
    /return RESTRICTION_FRAME_STATIC;/.test(renderNtp));

  // ---- 実挙動（vm）: 新しいタブ判定と仮想プレビュー生成 ----
  let bgBundle = '';
  ['DEFAULT_GAS_URL', 'NEW_TAB_PAGE_PREFIXES', 'NEW_TAB_FRAME_WIDTHS', 'NEW_TAB_FRAME_QUALITIES',
   'RESTRICTION_FRAME_WIDTHS', 'RESTRICTION_FRAME_QUALITIES', 'RESTRICTION_FRAME_STATIC',
   'LIVE_WATCH_MAX_B64', 'SCREENSHOT_MAX_B64'].forEach(function (n) {
    bgBundle += extractConstBg(n) + '\n';
  });
  ['roundRectPath_', 'newTabFrameTimeText_', 'isNewTabPageUrl_',
   'drawNewTabPreviewFrame_', 'renderNewTabPreviewFrame_', 'bufferToBase64_',
   'evaluateUrlRestriction', 'restrictionStateForTab_'].forEach(function (n) {
    if (new RegExp('^[ \\t]*(?:async )?function ' + n + '\\s*\\(', 'm').test(bgSrc)) {
      bgBundle += extract(bgSrc, n) + '\n';
    }
  });

  const fakeJpeg = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  function makeCanvasEnv(opts) {
    const o = opts || {};
    const c = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp, Error,
      isFinite, isNaN, parseInt, parseFloat, Promise,
      Date: { now: function () { return 7000000; } },
      chrome: { runtime: { getURL: function () { return 'chrome-extension://abcd/'; } } },
      OffscreenCanvas: function (w, h) {
        this.width = w; this.height = h;
        this.getContext = function () {
          return {
            fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {},
            arc() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
            measureText: function (t) { return { width: String(t).length * 10 }; },
            set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
            set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}
          };
        };
        this.convertToBlob = function () {
          if (o.failConvert) return Promise.reject(new Error('convert failed'));
          const b64 = (o.b64Len || 4000);
          const bin = 'A'.repeat(Math.max(1, Math.floor(b64 * 3 / 4)));
          return Promise.resolve({ arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); } });
        };
      },
      fetch: function () { return Promise.reject(new Error('no fetch')); },
      btoa: function (s) { return String(s); }
    };
    vm.createContext(c);
    vm.runInContext(bgBundle, c);
    return c;
  }

  const envN = makeCanvasEnv();
  check('A16 vm: chrome://newtab/ は新しいタブと判定する',
    vm.runInContext("isNewTabPageUrl_('chrome://newtab/')", envN) === true);
  check('A17 vm: chrome-search://local-ntp も新しいタブと判定する',
    vm.runInContext("isNewTabPageUrl_('chrome-search://local-ntp/local-ntp.html')", envN) === true);
  check('A18 vm: 通常の Web ページは新しいタブではない',
    vm.runInContext("isNewTabPageUrl_('https://www.google.com/')", envN) === false &&
    vm.runInContext("isNewTabPageUrl_('https://scratch.mit.edu/')", envN) === false);

  const restEnv = makeCanvasEnv();
  const ntpState = vm.runInContext(
    "restrictionStateForTab_({ filter_mode: 'BLACKLIST', blacklist_urls: ['youtube.com'] }, 'chrome://newtab/')", restEnv);
  check('A19 vm: URL規制が有効でも新しいタブは「規制中」にしない',
    ntpState && ntpState.active === false && ntpState.newtab === true, ntpState);
  const lockState = vm.runInContext(
    "restrictionStateForTab_({ screen_lock: true, filter_mode: 'BLACKLIST' }, 'chrome://newtab/')", restEnv);
  check('A20 vm: 画面ロック中は新しいタブでもロック扱い（規制より優先）',
    lockState && lockState.kind === 'lock', lockState);

  const frame = await vm.runInContext("renderNewTabPreviewFrame_(10000)", envN);
  check('A21 vm: 仮想プレビューは data:image/jpeg;base64,... を返す',
    typeof frame === 'string' && /^data:image\/jpeg;base64,/.test(frame),
    typeof frame === 'string' ? frame.slice(0, 32) : String(frame));

  const envNoCanvas = makeCanvasEnv();
  delete envNoCanvas.OffscreenCanvas;
  const frameNoCanvas = await vm.runInContext("renderNewTabPreviewFrame_(10000)", envNoCanvas);
  check('A22 vm: OffscreenCanvas が無くても必ず画像を返す（送信ゼロにしない）',
    typeof frameNoCanvas === 'string' && /^data:image\//.test(frameNoCanvas));

  // ===========================================================================
  // B. 「ライブ視聴を開始」のオプティミスティック UI
  // ===========================================================================
  console.log('===== B. オプティミスティック UI（0ms 待機タイル） =====');

  const pendingFn = extract(html, 'renderLiveWatchPendingTiles');
  const rollbackFn = extract(html, 'rollbackLiveWatchPendingTiles');
  const startFn = extract(html, 'startLiveWatchFromSelection');
  const gridFn = extract(html, 'renderLiveWatchGrid');

  check('B1 待機タイルを先行描画する関数がある', !!pendingFn);
  check('B2 先行描画は pending:true の枠を作り、即座に描画する',
    /pending: true/.test(pendingFn) && /renderLiveWatchGrid\(\)/.test(pendingFn));
  check('B3 押した瞬間に描画し、その後に API を送る（順序）',
    startFn.indexOf('renderLiveWatchPendingTiles(ids)') >= 0 &&
    startFn.indexOf('renderLiveWatchPendingTiles(ids)') <
      startFn.indexOf("action: 'live_watch_start'"));
  check('B4 失敗時はロールバックしてトーストを出す',
    /rollbackLiveWatchPendingTiles\(pendingIds\)/.test(startFn) &&
    /showToast\('ライブ視聴の開始に失敗しました/.test(startFn));
  check('B5 ロールバックは pending の枠だけを外す（確定済みの枠を消さない）',
    /s\.pending === true && drop\[String\(s\.studentId\)\]/.test(rollbackFn));
  check('B6 受け付けられた枠だけ pending を解除する',
    /if \(slot && okSet\[String\(slot\.studentId\)\]\) slot\.pending = false;/.test(startFn));
  check('B7 受け付けられなかった枠はロールバックする',
    /const rejected = pendingIds\.filter/.test(startFn) &&
    /if \(rejected\.length\) rollbackLiveWatchPendingTiles\(rejected\);/.test(startFn));
  check('B8 待機タイルは「枠を確保しています...」を出す', /枠を確保しています/.test(gridFn));
  check('B9 通常の待機文言は維持する', /端末の送信を待っています/.test(gridFn));

  // ===========================================================================
  // C. 連続パイプライン ＆ クールダウン 60 秒
  // ===========================================================================
  console.log('===== C. 連続パイプライン（応答直後に次を投げる） =====');

  const gapMs = constNum(html, 'LIVE_WATCH_PIPELINE_GAP_MS');
  const bootGapMs = constNum(html, 'LIVE_WATCH_BOOT_GAP_MS');
  const cdMs = constNum(html, 'LIVE_FRAME_DIRECT_COOLDOWN_MS');
  const schedFn = extract(html, 'scheduleLiveWatchPipeline');
  const tickFn = extract(html, 'liveWatchPollTick');
  const apiBody = extract(html, 'apiRequest');

  check('C1 応答後の待ちは 150〜250ms', gapMs >= 150 && gapMs <= 250, gapMs);
  check('C2 開始直後の待ちも 150〜250ms', bootGapMs >= 150 && bootGapMs <= 250, bootGapMs);
  check('C3 再帰 setTimeout で「応答完了直後に次を投げる」',
    /setTimeout\(function \(\) \{[\s\S]{0,600}?scheduleLiveWatchPipeline\(\)/.test(schedFn));
  check('C4 タイマーは常に 1 本（張り直す前に破棄する）',
    /if \(liveWatchPollTimer\) \{ clearTimeout\(liveWatchPollTimer\); liveWatchPollTimer = null; \}/.test(schedFn));
  check('C5 固定周期の setInterval を使わない（空き時間を作らない）',
    !/setInterval\(liveWatchPollTick/.test(html) && !/liveWatchPollTimer = setInterval/.test(html));
  check('C6 開始直後の 1 枚目は待たずに取りに行く（0ms）',
    /scheduleLiveWatchPipeline\(0\)/.test(html));
  check('C7 in-flight 排他は維持（多重送信しない）',
    /if \(liveWatchFramesFetching\) return;/.test(tickFn) &&
    /liveWatchFramesFetching = true;/.test(tickFn) &&
    /liveWatchFramesFetching = false;/.test(tickFn));
  check('C8 古い応答は捨てる（巻き戻り防止）',
    /if \(mySeq < liveWatchFramesAppliedSeq\) return;/.test(tickFn));
  check('C9 /exec 直送のクールダウンは 60 秒', cdMs === 60000, cdMs);
  check('C10 2 回連続で失敗したら 60 秒へ延長する（1 回目は短い）',
    /liveFramesDirectFailCount \+= 1;/.test(apiBody) &&
    /liveFramesDirectFailCount >= 2/.test(apiBody));
  check('C11 直送が成功したら連続失敗カウントを戻す',
    /liveFramesDirectFailCount = 0;/.test(apiBody));
  check('C12 クールダウン中は従来経路（google.script.run）を使う',
    /Date\.now\(\) >= liveFramesDirectCooldownUntil/.test(apiBody));

  // ---- 実挙動（vm）: パイプラインが「応答直後に次を張る」こと ----
  const reScript = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let mm, code = '';
  while ((mm = reScript.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(mm[0].split('>')[0])) continue;
    code += mm[1] + '\n';
  }
  const clock = { now: 9000000 };
  function FakeDate(...a) { return a.length === 0 ? new Date(clock.now) : new Date(...a); }
  FakeDate.now = () => clock.now;
  FakeDate.UTC = Date.UTC;
  FakeDate.parse = Date.parse;

  const timers = [];
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
      appendChild() {}, removeChild() {}, querySelectorAll() { return []; },
      addEventListener() {}, setAttribute() { this._src = arguments[1]; }, removeAttribute() {},
      getAttribute() { return this._src === undefined ? null : this._src; },
      cloneNode() { return mkEl(id); }
    };
    els[id] = el;
    return el;
  }
  const store = {};
  const ictx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, String, Number, Array, Object, Boolean, isNaN,
    parseFloat, parseInt, Set, Map, URL, Promise, RegExp, isFinite, Error,
    Date: FakeDate,
    window: {
      addEventListener() {}, removeEventListener() {},
      location: { href: '', hostname: '', search: '' },
      open() { return { document: { write() {}, close() {} } }; },
      confirm() { return true; }
    },
    setTimeout(fn, ms) { const t = { fn, ms, kind: 'timeout' }; timers.push(t); return t; },
    clearTimeout(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    setInterval(fn, ms) { const t = { fn, ms, kind: 'interval' }; timers.push(t); return t; },
    clearInterval(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
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
      addEventListener() {}
    },
    fetch() { return Promise.reject(new Error('fetch は本テストでは使わない')); },
    navigator: {},
    alert() {}, confirm() { return true; }
  };
  vm.createContext(ictx);
  vm.runInContext(code, ictx);
  const run = (expr) => vm.runInContext(expr, ictx);
  const settle = () => new Promise(function (r) { setImmediate(r); });

  check('C13 前提: パイプライン関数群が vm 上に読み込まれている',
    typeof ictx.scheduleLiveWatchPipeline === 'function' &&
    typeof ictx.getLiveWatchPipelineGapMs === 'function' &&
    typeof ictx.renderLiveWatchPendingTiles === 'function' &&
    typeof ictx.rollbackLiveWatchPendingTiles === 'function');

  // 取得は即応答（パイプラインの張り方だけを見る）
  let apiCalls = 0;
  // 画像取得（live_watch_frames）だけを数える。開始直後の 1 周目は TTL 延長
  // （live_watch_extend）も同時に飛ぶため、全 action を数えると 1 周＝2 回になる。
  ictx.apiRequest = function (req) {
    if (!req || req.action === 'live_watch_frames') apiCalls += 1;
    return Promise.resolve({ success: true, data: [] });
  };
  ictx.updateLiveWatchImages = function () {};

  timers.length = 0; apiCalls = 0;
  run("liveWatchSlots = [{ studentId: 'S1', name: 'A', openedAt: " + clock.now + " }];");
  run('liveWatchStartedAt = 0; liveWatchFramesFetching = false; liveWatchLastExtendAt = ' + clock.now + ';');
  run('liveWatchPollTimer = null;');
  run('startLiveWatchPolling();');
  check('C14 開始時は 0ms で 1 本だけタイマーを張る',
    timers.length === 1 && timers[0].ms === 0, timers.map(function (t) { return t.ms; }));

  const t0 = timers.shift();
  t0.fn();
  await settle(); await settle(); await settle();
  check('C15 1 周走ると画像を取得し、応答直後に次のタイマーを張る（1 本だけ）',
    apiCalls === 1 && timers.length === 1,
    { calls: apiCalls, timers: timers.map(function (t) { return t.ms; }) });
  check('C16 2 周目の待ちは 150〜250ms（開始直後）',
    timers[0].ms >= 150 && timers[0].ms <= 250, timers[0].ms);

  const t1 = timers.shift();
  t1.fn();
  await settle(); await settle(); await settle();
  check('C17 2 周目も画像を取得し、さらに次を張る（途切れない）',
    apiCalls === 2 && timers.length === 1, { calls: apiCalls, timers: timers.length });

  // 6 秒経過後も 150〜250ms を保つ
  clock.now += 6000;
  check('C18 6 秒経過後も待ちは 150〜250ms',
    ictx.getLiveWatchPipelineGapMs() >= 150 && ictx.getLiveWatchPipelineGapMs() <= 250,
    ictx.getLiveWatchPipelineGapMs());

  // 枠が 0 になったら止まる
  run('liveWatchSlots = [];');
  const t2 = timers.shift();
  if (t2) t2.fn();
  await settle(); await settle();
  check('C19 枠が無くなったらタイマーを残さない',
    timers.length === 0 && run('liveWatchPollTimer') === null,
    { timers: timers.length });

  // オプティミスティック UI の実挙動
  clock.now = 9100000;
  run('liveWatchSlots = []; renderLiveWatchPendingTiles([\'S1\', \'S2\']);');
  check('C20 先行描画で 2 枠が即座に増える（pending）',
    run('liveWatchSlots.length') === 2 &&
    run('liveWatchSlots.every(function (s) { return s.pending === true; })') === true);
  run('rollbackLiveWatchPendingTiles([\'S1\']);');
  check('C21 ロールバックで指定した pending 枠だけが消える',
    run('liveWatchSlots.length') === 1 && run("liveWatchSlots[0].studentId") === 'S2');
  run('liveWatchSlots = []; liveWatchPollTimer = null;');

  // ===========================================================================
  // D. 拡張機能: ループ 800ms / 10,000 文字 / タブ切り替え即時フック
  // ===========================================================================
  console.log('===== D. 拡張機能のキャプチャ間隔とタブ切り替えフック =====');

  const loopMs = constNum(bgSrc, 'LIVE_WATCH_LOOP_MS');
  const targetMax = constNum(bgSrc, 'LIVE_WATCH_TARGET_MAX_B64');
  const targetMin = constNum(bgSrc, 'LIVE_WATCH_TARGET_MIN_B64');
  const targetWidth = constNum(bgSrc, 'LIVE_WATCH_TARGET_WIDTH');
  const capQuality = constNum(bgSrc, 'LIVE_WATCH_CAPTURE_QUALITY');
  const debounceMs = constNum(bgSrc, 'LIVE_WATCH_TAB_HOOK_DEBOUNCE_MS');
  const maxB64 = constNum(bgSrc, 'LIVE_WATCH_MAX_B64');
  const activeSync = constNum(bgSrc, 'ACTIVE_SYNC_MS');

  check('D1 LIVE_WATCH_LOOP_MS === 800', loopMs === 800, loopMs);
  check('D2 LIVE_WATCH_TARGET_MAX_B64 === 10000（約7〜8KB）', targetMax === 10000, targetMax);
  check('D3 目標下限は 5,000 文字', targetMin === 5000, targetMin);
  check('D4 横幅は 360px', targetWidth === 360, targetWidth);
  check('D5 撮影品質は 28%', capQuality === 28, capQuality);
  check('D6 タブ切り替えフックのデバウンスは 250ms', debounceMs === 250, debounceMs);
  check('D7 送信上限 30,000 文字は維持（固定仕様）', maxB64 === 30000, maxB64);
  check('D8 ACTIVE_SYNC_MS（1.5 秒）は維持（固定仕様）', activeSync === 1500, activeSync);
  check('D9 tabs.onActivated を購読している',
    /chrome\.tabs\.onActivated\.addListener/.test(bgSrc));
  check('D10 ライブ視聴中だけ即時キャプチャする（通常運用の負荷を増やさない）',
    /chrome\.tabs\.onActivated\.addListener\(function \(info\) \{\s*\n\s*if \(liveWatchActive !== true\) return;/.test(bgSrc));
  check('D11 タブ遷移完了（onUpdated status=complete）でも即時キャプチャ',
    /changeInfo\.status === 'complete' && liveWatchActive === true/.test(bgSrc));
  check('D12 デバウンスで 1 回にまとめる（連続イベントで乱発しない）',
    /function scheduleLiveWatchTabHook\(\)[\s\S]{0,400}?clearTimeout\(liveWatchTabHookTimer\)/.test(bgSrc));
  check('D13 停止時はフックも止める', /stopLiveWatchTabHook\(\);/.test(extract(bgSrc, 'applyLiveWatchFlag')));
  check('D14 in-flight 排他は維持（ループとフックが同時でも二重送信しない）',
    /if \(liveWatchInFlight\) return false;/.test(bgSrc));

  // ---- 実挙動（vm）: onActivated で即時キャプチャが走る ----
  let dbundle = '';
  // var で宣言する: let/const は vm の字句スコープに入り、外側のコンテキスト
  // オブジェクトから値を差し替えられない（テストの前提操作が効かなくなる）。
  dbundle += 'var liveWatchActive = false;\nvar liveWatchInFlight = false;\n';
  dbundle += 'var liveWatchLastSentMs = 0;\nvar liveWatchLoopTimer = null;\nvar liveWatchTabHookTimer = null;\n';
  ['LIVE_WATCH_LOOP_MS', 'LIVE_WATCH_TAB_HOOK_DEBOUNCE_MS'].forEach(function (n) {
    dbundle += extractConstBg(n) + '\n';
  });
  ['stopLiveWatchLoop', 'scheduleLiveWatchLoop', 'startLiveWatchLoop',
   'stopLiveWatchTabHook', 'scheduleLiveWatchTabHook',
   'renderLiveWatchPendingTiles'].forEach(function (n) {
    if (new RegExp('^[ \\t]*(?:async )?function ' + n + '\\s*\\(', 'm').test(bgSrc)) {
      dbundle += extract(bgSrc, n) + '\n';
    }
  });

  const dTimers = [];
  let dCaptures = 0;
  const dctx = {
    chrome: { tabs: { onActivated: { addListener: function () {} }, onUpdated: { addListener: function () {} }, query: function () {} } },
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp, Error,
    isFinite, isNaN, parseInt, parseFloat, Promise,
    Date: { now: function () { return 9500000; } },
    setTimeout: function (fn, ms) { const t = { fn: fn, ms: ms }; dTimers.push(t); return t; },
    clearTimeout: function (t) { const i = dTimers.indexOf(t); if (i >= 0) dTimers.splice(i, 1); },
    liveWatchCaptureOnce: function () { dCaptures += 1; return Promise.resolve(true); }
  };
  vm.createContext(dctx);
  vm.runInContext(dbundle, dctx);

  dctx.liveWatchActive = false;
  dctx.scheduleLiveWatchTabHook();
  check('D15 ライブ視聴外ではタブ切り替えで撮らない', dTimers.length === 0 && dCaptures === 0);

  dctx.liveWatchActive = true;
  dctx.scheduleLiveWatchTabHook();
  check('D16 ライブ視聴中のタブ切り替えは 250ms のタイマーを 1 本だけ張る',
    dTimers.length === 1 && dTimers[0].ms === 250, dTimers.map(function (t) { return t.ms; }));

  dctx.scheduleLiveWatchTabHook();
  check('D17 連続イベントはデバウンス（タイマーは常に 1 本）', dTimers.length === 1, dTimers.length);

  const dt = dTimers.shift();
  dt.fn();
  await settle(); await settle();
  check('D18 デバウンス後の 1 回だけ撮る（即時キャプチャ）',
    dCaptures === 1, { captures: dCaptures });

  dctx.liveWatchActive = false;
  dctx.scheduleLiveWatchTabHook();
  check('D19 停止後はタブ切り替えでも撮らない', dTimers.length === 0 && dCaptures === 1);
  check('D20 停止時は既存タイマーも破棄される', (function () {
    dctx.liveWatchActive = true;
    dctx.scheduleLiveWatchTabHook();
    const had = dTimers.length;
    dctx.stopLiveWatchTabHook();
    return had === 1 && dTimers.length === 0;
  })());

  // ===========================================================================
  // E. 親GAS: フレームをキャッシュしない（毎回 shardFetchMany）
  // ===========================================================================
  console.log('===== E. 親GAS のフレーム取得と最短応答 =====');

  const framesBody = extract(gasSrc, 'liveWatchGetFramesSharded');
  const startApi = extract(gasSrc, 'api_liveWatchStart');
  const framesApi = extract(gasSrc, 'api_liveWatchFrames');

  check('E1 フレームは毎回 子GAS へ並列取得する',
    /liveWatchShardPost_\(urls, \{[\s\S]{0,200}?action: LIVE_WATCH_SHARD_FRAMES/.test(framesBody));
  check('E2 結果をキャッシュしない（cache.put / setValue を持たない）',
    !/cache\.put/.test(framesBody) && !/SetValue|setValue/.test(framesBody));
  check('E3 並列取得は既存の shardFetchMany（UrlFetchApp.fetchAll）＝維持',
    /shardFetchMany\(requests\)/.test(extract(gasSrc, 'liveWatchShardPost_')) &&
    /UrlFetchApp\.fetchAll\(reqs\)/.test(extract(gasSrc, 'shardFetchMany')));
  check('E4 api_liveWatchFrames はシートを読まない（認証＋スコープ＋キャッシュのみ）',
    !/getDataRange/.test(framesApi) && !/getRange\(/.test(framesApi));
  check('E5 api_liveWatchStart はシートを書かない（台帳は CacheService）',
    !/getDataRange/.test(startApi) && !/\.setValue\(/.test(startApi));
  check('E6 単独モード（シャード未設定）は従来どおりローカル完結',
    /if \(!urls\.length\) return local;/.test(framesBody));

  // ===========================================================================
  // F. 出荷物 v1.6.11（固定仕様の維持）
  // ===========================================================================
  console.log('===== F. v1.6.11 出荷物と固定仕様 =====');

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
  check('F1 extension/manifest.json の version は 1.6.11', manifest.version === '1.6.11', manifest.version);
  check('F2 default_popup を持たない', !manifest.action || !manifest.action.default_popup);
  const perms = (manifest.permissions || []).slice().sort().join(',');
  check('F3 権限は既存のまま（新規権限の追加なし＝再同意プロンプトを出さない）',
    perms === 'alarms,identity,identity.email,idle,storage,tabs', perms);
  check("F4 DEFAULT_GAS_URL は '' のまま", /const DEFAULT_GAS_URL = '';/.test(bgSrc));

  const sm = JSON.parse(zipEntry('dist/store.zip', 'manifest.json'));
  check('F5 dist/store.zip の manifest.version は 1.6.11', sm.version === '1.6.11', sm.version);
  check('F6 dist/store.zip に default_popup が無い', !sm.action || !sm.action.default_popup);
  const dm = JSON.parse(zipEntry('dist/direct.zip', 'manifest.json'));
  check('F7 dist/direct.zip の manifest.version も 1.6.11', dm.version === '1.6.11', dm.version);
  check('F8 dist/direct.zip は検証用（popup.html 同梱）',
    !!dm.action && !!dm.action.default_popup && /(^|\n)popup\.html(\n|$)/.test(zipNames('dist/direct.zip')));

  const xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8');
  check("F9 dist/update.xml の version は 1.6.11", /version='1\.6\.11'/.test(xml),
    (xml.match(/version='[^']+'/g) || []).join(' '));

  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/managed_policy.json'), 'utf8'));
  const policySchools = Object.keys((policy && policy.gas_url_map && policy.gas_url_map.Value) || {});
  check('F10 managed_policy は 14 校（東粟倉小は廃校のため含まない）',
    policySchools.length === 14 &&
    policySchools.indexOf('東粟倉小学校') === -1 &&
    policySchools.indexOf('樸学園') >= 0,
    { count: policySchools.length });

  const stripEol = function (s) { return String(s).replace(/\s+$/, ''); };
  const storeBg = zipEntry('dist/store.zip', 'background.js');
  check('F11 ストア版 background.js は extension/background.js と一致（旧版混入なし）',
    stripEol(storeBg) === stripEol(bgSrc),
    { zipLen: stripEol(storeBg).length, srcLen: stripEol(bgSrc).length });
  check('F12 ストア版に R60 の新しいタブ対応とタブ切り替えフックが入っている',
    /isNewTabPageUrl_/.test(storeBg) && /chrome\.tabs\.onActivated\.addListener/.test(storeBg));

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail > 0 ? 1 : 0);
}   // main() ここまで

main().catch(function (e) {
  console.error('r60 実行時エラー:', e && e.stack ? e.stack : e);
  process.exit(1);
});
