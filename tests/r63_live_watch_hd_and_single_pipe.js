// ============================================================================
// r63_live_watch_hd_and_single_pipe.js — R63 / v1.6.14
//
//  【実機（v1.6.13）で確定した課題】
//    ① 表示の解像度が粗く文字が潰れて読めない（R61 で 320px / 品質25% / 8KB に削ったため）。
//       実測では通信時間を支配しているのは「ペイロードサイズ」ではなく
//       google.script.run の往復回数そのもの。画質を落としても速度メリットが無く、
//       画質だけが劣化していた。
//    ② タブ切り替えから反映まで 5〜10 秒。フレーム取得とは別に走る live_watch_status が
//       RPC キューを奪い、待機ギャップ（300ms）が往復を競合させていた。
//
//  【本テストの検証範囲】
//    A. 拡張機能: 640px / 品質55% / 26,000 文字（上限30,000内）/ ループ700ms /
//       タブ切り替え150ms の高画質・高速設定になっている。
//    B. 親GAS: api_liveWatchFrames が映像と使用枠ステータスを 1 応答で返す。
//       liveWatchStatusLite_ は SpreadsheetApp を一切触らない（シートレス）。
//    C. 管理画面: 視聴中は live_watch_status の別通信を抑止し、50ms ギャップで
//       連続パイプライン動作する。640px 画像を鮮明表示（拡大表示つき）。
//    D. 配布物: v1.6.14 の dist が再生成され、固定仕様が維持されている。
//
//  明示リスト方式（必要な関数・定数だけを列挙して読み込む）。
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'gas/index.html'), 'utf8');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

function extract(text, name) {
  const re = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\s*\\(', 'm');
  const start = text.search(re);
  if (start < 0) throw new Error('not found fn: ' + name);
  let i = text.indexOf('{', start), depth = 0, end = -1;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return text.slice(start, end + 1);
}
function constNum(text, name) {
  // 先頭のインデントを許容する（index.html の定数は 4 スペース字下げ）。
  const m = new RegExp('^[ \\t]*const ' + name + '\\s*=\\s*(-?[0-9.]+)', 'm').exec(text);
  if (!m) throw new Error('const not found: ' + name);
  return Number(m[1]);
}

// ============================================================================
// A. 拡張機能: 高解像度・高画質・高速設定
// ============================================================================
console.log('===== A. 拡張機能の画質・速度設定（v1.6.14） =====');

const W = constNum(bgSrc, 'LIVE_WATCH_TARGET_WIDTH');
const Q = constNum(bgSrc, 'LIVE_WATCH_CAPTURE_QUALITY');
const MAXB = constNum(bgSrc, 'LIVE_WATCH_MAX_B64');
const TMAX = constNum(bgSrc, 'LIVE_WATCH_TARGET_MAX_B64');
const TMIN = constNum(bgSrc, 'LIVE_WATCH_TARGET_MIN_B64');
const LOOP = constNum(bgSrc, 'LIVE_WATCH_LOOP_MS');
const DEB = constNum(bgSrc, 'LIVE_WATCH_TAB_HOOK_DEBOUNCE_MS');

check('A1 LIVE_WATCH_TARGET_WIDTH === 640（2 倍解像度で文字が読める）', W === 640, W);
check('A2 LIVE_WATCH_CAPTURE_QUALITY === 55（55% 品質）', Q === 55, Q);
check('A3 LIVE_WATCH_TARGET_MAX_B64 === 26000', TMAX === 26000, TMAX);
check('A4 LIVE_WATCH_TARGET_MIN_B64 === 16000', TMIN === 16000, TMIN);
check('A5 送信上限 LIVE_WATCH_MAX_B64 === 30000 は不変（固定仕様）', MAXB === 30000, MAXB);
check('A6 目標上限は送信上限の内側（26000 <= 30000）', TMAX <= MAXB, [TMAX, MAXB]);
check('A7 目標下限 < 目標上限（レンジが成立）', TMIN < TMAX, [TMIN, TMAX]);
check('A8 LIVE_WATCH_LOOP_MS === 700（0.7 秒間隔）', LOOP === 700, LOOP);
check('A9 タブ切り替えデバウンス === 150ms', DEB === 150, DEB);

const qualities = (function () {
  const m = /const LIVE_WATCH_QUALITIES = \[([^\]]+)\]/.exec(bgSrc);
  if (!m) throw new Error('LIVE_WATCH_QUALITIES not found');
  return m[1].split(',').map(function (s) { return Number(s.trim()); });
})();
check('A10 縮小品質ラダーは高画質側から始まる（0.55 起点）',
  Math.abs(qualities[0] - 0.55) < 1e-9, qualities);
check('A11 品質ラダーは単調減少（高画質から順に探索）',
  qualities.every(function (v, i) { return i === 0 || v < qualities[i - 1]; }), qualities);

// 新しいタブの仮想プレビューも 640px を最優先で描く
check('A12 新しいタブの仮想プレビューは 640px を最優先',
  /const NEW_TAB_FRAME_WIDTHS = \[640,/.test(bgSrc));
check('A13 仮想プレビューの品質も 55% 起点',
  /const NEW_TAB_FRAME_QUALITIES = \[0\.55,/.test(bgSrc));
check('A14 仮想プレビューは指定幅を 320px に丸めない（下限 360 以上）',
  /const W = Math\.max\(360, Math\.round\(Number\(width\)/.test(bgSrc));

// 固定仕様
check('A15 DEFAULT_GAS_URL は空のまま', /const DEFAULT_GAS_URL = '';/.test(bgSrc));
check('A16 ACTIVE_SYNC_MS（1.5 秒）は維持', constNum(bgSrc, 'ACTIVE_SYNC_MS') === 1500);
check('A17 manifest.version === 1.6.14',
  JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version === '1.6.14');

// ============================================================================
// B. 親GAS: frames 応答への使用枠同梱 / ステータスはシートレス
// ============================================================================
console.log('\n===== B. 親GAS: 1 往復での映像＋使用枠返却 =====');

// --- 静的検証 ---
const framesApi = extract(src, 'api_liveWatchFrames');
check('B1 api_liveWatchFrames は liveWatchGetFramesSharded を withStatus=true で呼ぶ',
  /liveWatchGetFramesSharded\(scoped\.ids, currentTeacher, true\)/.test(framesApi));
check('B2 api_liveWatchFrames の応答に status を含める', /\bstatus:/.test(framesApi));
check('B3 api_liveWatchFrames の応答に data（映像配列）を含める', /\bdata:/.test(framesApi));

const wrapper = extract(src, 'liveWatchGetFramesSharded');
check('B4 liveWatchGetFramesSharded は withStatus で {frames,status} を返す分岐を持つ',
  /withStatus === true[\s\S]{0,160}?frames: frames, status: liveWatchStatusLite_\(teacher\)/.test(wrapper));
check('B5 liveWatchGetFramesSharded は従来配列も返せる（後方互換）',
  /return frames;/.test(wrapper));

const lite = extract(src, 'liveWatchStatusLite_');
check('B6 liveWatchStatusLite_ が used を返す', /\bused: used/.test(lite));
check('B7 liveWatchStatusLite_ が students を返す', /\bstudents: students/.test(lite));
check('B8 liveWatchStatusLite_ が teacher_students を返す', /\bteacher_students: teacherStudents/.test(lite));
check('B9 liveWatchStatusLite_ が timeout_sec を返す', /\btimeout_sec: st\.timeout_sec/.test(lite));
check('B10 liveWatchStatusLite_ に SpreadsheetApp / シート API が無い',
  !/SpreadsheetApp|getTargetSheet|getDataRange|getHeaderMap|openById/.test(lite));
check('B11 liveWatchStatusLite_ は子GASへ通信しない（UrlFetchApp を呼ばない）',
  !/UrlFetchApp|shardFetchMany|liveWatchShardPost_/.test(lite));

// --- 動的検証: SpreadsheetApp に触れたら即例外 ---
let sheetTouches = 0;
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Set, Map,
  isFinite, isNaN, parseInt, parseFloat, Date,
  SpreadsheetApp: {
    openById: function () { sheetTouches++; throw new Error('must not open sheet'); },
    getActiveSpreadsheet: function () { sheetTouches++; throw new Error('must not open sheet'); }
  }
};
// ライブ視聴の低レベル関数だけスタブ（台帳は 1 台視聴中を再現）
const pool = { v: 1, students: {} };
pool.students['s1@x.ed.jp'] = { stream_opened_at: 1, teachers: { 't1@school.ed.jp': { opened_at: 1, expires_at: 9e15 } } };
const STUBS = [
  'function liveWatchSettings_(){ return { per_teacher_limit: 3, timeout_sec: 180, unlimited: false, disabled: false }; }',
  'function liveWatchNowMs_(){ return 1000; }',
  'function liveWatchReadPool_(){ return __POOL; }',
  'function liveWatchWritePool_(){ return true; }',
  'function liveWatchTeacherKey_(t){ return String((t && t.email) || "").toLowerCase(); }',
  'function liveWatchUniqueCount_(reg){ return Object.keys(reg.students).length; }',
  'function liveWatchTeacherCount_(reg, email){ var n=0,k=Object.keys(reg.students); for(var i=0;i<k.length;i++){ if(reg.students[k[i]].teachers[email]) n++; } return n; }',
  'function liveWatchSessionActive_(ts, key){ return !!(ts && ts[key]); }',
  'function liveWatchPrune_(reg){ return { reg: reg, changed: false }; }',
  'var MAX_LIVE_WATCH_DEVICES = 24;',
  'var LIVE_WATCH_TTL_SEC = 25;',
  'var LIVE_WATCH_EXTEND_SEC = 10;'
].join('\n');

ctx.__POOL = pool;
vm.createContext(ctx);
vm.runInContext(extract(src, 'liveWatchStatusLite_') + '\n' + STUBS, ctx, { filename: 'r63_lite.js' });

const st = ctx.liveWatchStatusLite_({ email: 't1@school.ed.jp' });
check('B12 liveWatchStatusLite_ が status オブジェクトを返す', !!st && st.success === true);
check('B13 used / max / remaining が数値で揃う',
  typeof st.used === 'number' && typeof st.max === 'number' && typeof st.remaining === 'number',
  [st.used, st.max, st.remaining]);
check('B14 students に視聴中 ID が入る',
  Array.isArray(st.students) && st.students.length === 1 && st.students[0] === 's1@x.ed.jp', st.students);
check('B15 teacher_students に自教員の視聴 ID が入る',
  Array.isArray(st.teacher_students) && st.teacher_students.length === 1, st.teacher_students);
check('B16 timeout_sec を同梱する（管理画面の自動終了表示用）', st.timeout_sec === 180, st.timeout_sec);
check('B17 実行中に SpreadsheetApp へ接触しない（0 回）', sheetTouches === 0, sheetTouches);

// wrapper の 2 形態（withStatus あり / なし）
const wrapCtx = {
  console: { log() {}, warn() {}, error() {} },
  JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Set, Map,
  isFinite, isNaN, parseInt, parseFloat, Promise, Date
};
const wrapStubs = [
  'function liveWatchGetFramesSharded_(ids){ return [{ student_id: ids[0], live_watch: true }]; }',
  'function liveWatchStatusLite_(){ return { success: true, used: 7 }; }'
].join('\n');
vm.createContext(wrapCtx);
vm.runInContext(extract(src, 'liveWatchGetFramesSharded') + '\n' + wrapStubs, wrapCtx, { filename: 'r63_wrap.js' });
const withSt = wrapCtx.liveWatchGetFramesSharded(['a'], {}, true);
check('B18 withStatus=true で {frames, status} を返す',
  !!withSt && Array.isArray(withSt.frames) && !!withSt.status && withSt.status.used === 7, withSt && withSt.status);
const noSt = wrapCtx.liveWatchGetFramesSharded(['a'], {}, false);
check('B19 withStatus 省略時は従来どおり配列を返す', Array.isArray(noSt) && noSt.length === 1, noSt);

// ============================================================================
// C. 管理画面: 通信の一本化と 50ms パイプライン / 高画質表示
// ============================================================================
console.log('\n===== C. 管理画面: 1 本化・50ms パイプライン・鮮明表示 =====');

const GAP = constNum(html, 'LIVE_WATCH_PIPELINE_GAP_MS');
const BOOTGAP = constNum(html, 'LIVE_WATCH_BOOT_GAP_MS');
check('C1 パイプラインの待ちは 50ms', GAP === 50, GAP);
check('C2 開始直後の待ちも 50ms', BOOTGAP === 50, BOOTGAP);

const refreshFn = extract(html, 'refreshLiveWatchStatus');
check('C3 refreshLiveWatchStatus は視聴中に独立 status 通信をスキップする',
  /force !== true && isLiveWatchStreaming\(\)/.test(refreshFn));
check('C4 スキップ時は現在値をそのまま返す（呼び出し側を壊さない）',
  /return liveWatchStatusInfo;/.test(refreshFn));
check('C5 force=true なら視聴中でも取得する（開始時の disabled 判定用）',
  /refreshLiveWatchStatus\(true, true\)/.test(html));

check('C6 applyLiveWatchStatus が同梱ステータスを反映する関数として存在する',
  /function applyLiveWatchStatus\(status\)/.test(html));
const applyFn = extract(html, 'applyLiveWatchStatus');
check('C7 applyLiveWatchStatus が used を取り込む', /used:/.test(applyFn));
check('C8 applyLiveWatchStatus がインジケーターを更新する',
  /updateLiveWatchIndicators\(liveWatchStatusInfo\)/.test(applyFn));

const tickFn = extract(html, 'liveWatchPollTick');
check('C9 フレーム応答の同梱ステータスを反映する（res.status → applyLiveWatchStatus）',
  /if \(res && res\.status\) applyLiveWatchStatus\(res\.status\)/.test(tickFn));
check('C10 延長応答の used もインジケーターへ反映する',
  /applyLiveWatchStatus\(\{[\s\S]{0,200}?used: ext\.used/.test(tickFn));
check('C11 視聴中の get_all 自動更新スキップは維持（R62 の回帰防止）',
  /if \(isLiveWatchStreaming\(\)\) \{/.test(extract(html, 'autoRefreshTick')));

check('C12 プレビュー画像は object-fit: contain で鮮明表示',
  /object-fit:contain;width:100%;height:auto/.test(html));
check('C13 プレビュー画像に image-rendering: auto（補間でぼかさない）',
  /image-rendering:auto/.test(html));
check('C14 タイルの画像クリックで拡大表示できる（zoomLiveFrame）',
  /function zoomLiveFrame\(i\)/.test(html) && /onclick="zoomLiveFrame\(/.test(html));

check('C15 ヘッダーの版数バッジは v1.6.14', /id="appVersionBadge"[\s\S]{0,200}?v1\.6\.14/.test(html));
check('C16 アセット版数のメタ情報は不変（20261108）',
  /name="app-asset-version"[^>]*content="20261108"/.test(html));

// --- 動的検証: 視聴中は live_watch_status を撃たない ---
const htmlCtx = {
  console: { log() {}, warn() {}, error() {} },
  JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Set, Map,
  isFinite, isNaN, parseInt, parseFloat, Promise, Date
};
let apiCalls = 0;
let streaming = true;
const htmlStubs = [
  'var liveWatchStatusInfo = { used: 2 };',
  'function isLiveWatchStreaming(){ return __STREAMING; }',
  'function updateLiveWatchIndicators(){}',
  'function apiRequest(){ __CALLS++; return Promise.resolve({ success: true, used: 5 }); }'
].join('\n');
htmlCtx.__STREAMING = true;
htmlCtx.__CALLS = 0;
vm.createContext(htmlCtx);
vm.runInContext(extract(html, 'refreshLiveWatchStatus') + '\n' + htmlStubs, htmlCtx, { filename: 'r63_console.js' });

ctx.__NOP = null;
(async function () {
  streaming = true;
  htmlCtx.__STREAMING = true;
  const r1 = await htmlCtx.refreshLiveWatchStatus(true);
  check('C17 視聴中は live_watch_status を 1 回も撃たない', htmlCtx.__CALLS === 0, htmlCtx.__CALLS);
  check('C18 視聴中は現在値（used=2）をそのまま返す', !!r1 && r1.used === 2, r1 && r1.used);

  htmlCtx.__STREAMING = false;
  await htmlCtx.refreshLiveWatchStatus(true);
  check('C19 非視聴時は通常どおり 1 回取得する', htmlCtx.__CALLS === 1, htmlCtx.__CALLS);

  htmlCtx.__STREAMING = true;
  await htmlCtx.refreshLiveWatchStatus(true, true);
  check('C20 force=true なら視聴中でも 1 回取得する', htmlCtx.__CALLS === 2, htmlCtx.__CALLS);

  // ==========================================================================
  // D. 配布物（v1.6.14）
  // ==========================================================================
  console.log('\n===== D. 配布物（v1.6.14） =====');

  function unzipEntry(zip, entry) {
    try {
      return cp.execSync('unzip -p ' + JSON.stringify(zip) + ' ' + JSON.stringify(entry),
        { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();
    } catch (e) { return null; }
  }

  const distStore = path.join(ROOT, 'dist/store.zip');
  const distDirect = path.join(ROOT, 'dist/direct.zip');
  const distExt = path.join(ROOT, 'dist/extension.zip');
  const distXml = path.join(ROOT, 'dist/update.xml');
  check('D1 dist/store.zip が存在する', fs.existsSync(distStore));
  check('D2 dist/direct.zip が存在する', fs.existsSync(distDirect));
  check('D3 dist/extension.zip が存在する', fs.existsSync(distExt));
  check('D4 dist/update.xml が存在する', fs.existsSync(distXml));

  const sm = unzipEntry(distStore, 'manifest.json');
  const dm = unzipEntry(distDirect, 'manifest.json');
  const smJ = sm ? JSON.parse(sm) : null;
  const dmJ = dm ? JSON.parse(dm) : null;
  check('D5 store.zip の manifest.version は 1.6.14', !!smJ && smJ.version === '1.6.14', smJ && smJ.version);
  check('D6 direct.zip の manifest.version も 1.6.14', !!dmJ && dmJ.version === '1.6.14', dmJ && dmJ.version);
  const xml = fs.existsSync(distXml) ? fs.readFileSync(distXml, 'utf8') : '';
  check("D7 update.xml の version は '1.6.14'", /version='1\.6\.14'/.test(xml),
    (xml.match(/version='[^']*'/) || [''])[0]);
  check('D8 store.zip に default_popup が無い', !!smJ && (!smJ.action || !smJ.action.default_popup));
  check('D9 direct.zip は検証用（default_popup: popup.html）',
    !!dmJ && !!dmJ.action && dmJ.action.default_popup === 'popup.html', dmJ && dmJ.action);
  check('D10 新規権限は追加されていない',
    JSON.stringify((smJ.permissions || []).slice().sort()) ===
    JSON.stringify(['alarms', 'identity', 'identity.email', 'idle', 'storage', 'tabs']),
    smJ && smJ.permissions);

  const storeBg = unzipEntry(distStore, 'background.js');
  check('D11 store.zip の background.js は extension/background.js と完全一致', storeBg === bgSrc);
  check('D12 store.zip の JS に高画質設定（640px / 品質55%）が入っている',
    /const LIVE_WATCH_TARGET_WIDTH = 640;/.test(storeBg || '') &&
    /const LIVE_WATCH_CAPTURE_QUALITY = 55;/.test(storeBg || ''));
  check('D13 direct.zip の popup.html に v1.6.14 表記',
    /v1\.6\.14/.test(unzipEntry(distDirect, 'popup.html') || ''));

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.log('FAIL harness: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
