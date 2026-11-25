// ============================================================================
// r62_live_watch_no_queue_jam.js — R62 / v1.6.13
//
//  【実機で確定した症状】
//    ライブ視聴の更新時刻が「15:40:41 → 15:41:09 → 15:41:27」＝ 18 秒間隔。
//  真因は 2 点:
//    ① 管理画面右上の「自動更新(get_all)」と live_watch_frames が並行して
//       google.script.run を叩き、GAS の同時実行枠＋ブラウザ RPC キューが渋滞。
//    ② 親GAS の api_liveWatch* が認証・スコープ解決で SpreadsheetApp を開いていた。
//
//  【本テストの検証範囲】
//    A. ライブ視聴中（視聴タイル 1 件以上）は get_all 自動更新を「実通信ごと」
//       スキップし、全タイル停止後に自動再開する（gas/index.html）。
//    B. api_liveWatchStart / api_liveWatchFrames が SpreadsheetApp.openById を
//       1 回も呼ばずに子GASへ転送し応答を返す（gas/Code.gs・vm 実行）。
//    C. v1.6.13 の配布物（dist/*.zip, update.xml）が再生成され、固定仕様
//       （default_popup なし / DEFAULT_GAS_URL = '' / 新規権限なし）が維持される。
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

// ============================================================================
// A. ライブ視聴中の get_all 自動更新スキップ（gas/index.html）
// ============================================================================
console.log('===== A. 管理画面: ライブ視聴中の get_all ポーリング休止 =====');

const tickSeg = (html.match(/function autoRefreshTick\(\)[\s\S]*?\n    \}/) || [''])[0];
check('A1 autoRefreshTick を抽出できた', tickSeg.length > 200, tickSeg.length);
check('A2 autoRefreshTick が isLiveWatchStreaming() で休止判定する',
  /if\s*\(\s*isLiveWatchStreaming\(\)\s*\)\s*\{/.test(tickSeg));
check('A3 休止中は refreshDevicesNow を呼ばない（実通信ごとスキップ）',
  tickSeg.indexOf('isLiveWatchStreaming()') < tickSeg.indexOf('refreshDevicesNow(') ||
  tickSeg.indexOf('refreshDevicesNow(') < 0 ||
  (function () {
    const iS = tickSeg.indexOf('isLiveWatchStreaming()');
    const iR = tickSeg.indexOf('refreshDevicesNow(');
    const seg = tickSeg.slice(iS, iR);
    return /return;/.test(seg); // ライブ視聴分岐の中で return している
  })());
check('A4 休止中も次回時刻を進める（復帰時に即発火しない）',
  /if\s*\(\s*isLiveWatchStreaming\(\)\s*\)\s*\{[\s\S]{0,200}?autoRefreshNextAt\s*=\s*Date\.now\(\)\s*\+\s*autoRefreshIntervalMs;/.test(tickSeg));

const streamSeg = (html.match(/function isLiveWatchStreaming\(\)[\s\S]*?\n    \}/) || [''])[0];
check('A5 isLiveWatchStreaming() が定義されている', streamSeg.length > 50, streamSeg.length);
check('A6 視聴タイル配列（liveWatchSlots）の件数で判定する',
  /Array\.isArray\(liveWatchSlots\)\s*&&\s*liveWatchSlots\.length\s*>\s*0/.test(streamSeg));
check('A7 参照できない環境でも例外にしない（try/catch で false）',
  /try\s*\{/.test(streamSeg) && /catch\s*\(/.test(streamSeg) && /return false;/.test(streamSeg));
// 「全タイル停止 → 自動再開」: タイル 0 件になれば isLiveWatchStreaming() が false を返し、
// 次の tick で通常経路（autoRefreshNextAt 判定 → refreshDevicesNow）へ落ちる。
check('A8 タイル 0 件では false を返す（停止後は通常経路へ復帰）',
  /liveWatchSlots\.length\s*>\s*0/.test(streamSeg));
check('A9 ライブ視聴停止時にポーリングを止める既存処理が残っている（stopLiveWatchPolling）',
  /liveWatchSlots\.length === 0\) stopLiveWatchPolling\(\)/.test(html));

// ヘッダーの版数表示（デプロイ反映の目視確認）
check('A10 ヘッダーに v1.6.13 の版数バッジがある', /id="appVersionBadge"[\s\S]{0,200}?v1\.6\.13/.test(html));
check('A11 アセット版数のメタ情報は不変（20261108）',
  /name="app-asset-version"[^>]*content="20261108"/.test(html));

// ============================================================================
// B. 親GAS api_liveWatch* のシートレス・ファストパス（gas/Code.gs・vm 実行）
// ============================================================================
console.log('\n===== B. 親GAS: SpreadsheetApp を一切開かない =====');

const FNS = [
  'api_liveWatchStatus', 'api_liveWatchStart', 'api_liveWatchExtend',
  'api_liveWatchStop', 'api_liveWatchFrames',
  'liveWatchResolveTeacher_', 'liveWatchScopeStudentIds_',
  'isAdminTeacher', 'normalizeSchoolName', 'schoolNamesMatch', 'resolveCanonicalSchool',
  'getTeacherScopeInfo', 'isAllSchoolsName', 'normalizeClassName',
  'getTeacherTargetClasses', 'isClassInTeacherScope',
  '__cacheSafe', '__teacherCacheVersion', '__teacherCacheKey'
];
const CONSTS = ['SCHOOL_ALIASES', 'CONFIG'];
let BUNDLE = '';
CONSTS.forEach(function (n) { BUNDLE += extractConst(n) + '\n'; });
FNS.forEach(function (n) { BUNDLE += extract(n) + '\n'; });

// --- 静的な検証: ライブ視聴経路の各関数にシート API が現れない ---
const PATH_FNS = ['api_liveWatchStatus', 'api_liveWatchStart', 'api_liveWatchExtend',
  'api_liveWatchStop', 'api_liveWatchFrames', 'liveWatchResolveTeacher_', 'liveWatchScopeStudentIds_'];
PATH_FNS.forEach(function (fn) {
  const seg = extract(fn);
  const bad = /SpreadsheetApp|openById\s*\(|getTargetSheet\s*\(|getDataRange\s*\(|getHeaderMap\s*\(/.test(seg);
  check('B0 ' + fn + ' にシート API が無い', !bad, bad ? 'HIT' : 'ok');
});
check('B1 api_liveWatchStart は liveWatchScopeStudentIds_ を使う（索引のみ）',
  /function api_liveWatchStart[\s\S]{0,500}?liveWatchScopeStudentIds_\(/.test(src));
check('B2 api_liveWatchFrames は liveWatchScopeStudentIds_ を使う（索引のみ）',
  /function api_liveWatchFrames[\s\S]{0,500}?liveWatchScopeStudentIds_\(/.test(src));
check('B3 api_liveWatch* は resolveCurrentTeacher（教員マスタ読取）を呼ばない',
  !/function api_liveWatch[A-Za-z]*[\s\S]{0,600}?resolveCurrentTeacher\(/.test(src));
check('B4 liveWatchScopeStudentIds_ は索引コールドでもシートを開かない',
  /function liveWatchScopeStudentIds_[\s\S]{0,2500}?if\s*\(!entries\)\s*return/.test(src));

// --- 動的な検証: SpreadsheetApp へのアクセスを数える ---
let sheetTouches = 0;
let openByIdCalls = 0;
const cacheStore = new Map();
const ctx = {
  console: { log: function () {}, warn: function () {}, error: function () {} },
  JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Set, Map,
  isFinite, isNaN, parseInt, parseFloat, Date,
  Logger: { log: function () {} },
  SpreadsheetApp: {
    openById: function () {
      openByIdCalls++; sheetTouches++;
      throw new Error('SpreadsheetApp.openById must not be called in api_liveWatch*');
    },
    getActiveSpreadsheet: function () { openByIdCalls++; sheetTouches++; throw new Error('no sheet'); }
  },
  PropertiesService: {
    getScriptProperties: function () {
      return { getProperty: function () { return null; }, setProperty: function () {}, deleteProperty: function () {} };
    }
  },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function (k) { return (cacheStore.has(k) ? cacheStore.get(k) : null); },
        put: function (k, v) { cacheStore.set(k, v); },
        remove: function (k) { cacheStore.delete(k); }
      };
    }
  },
  UrlFetchApp: { fetchAll: function () { return []; }, fetch: function () { return null; } },
  Utilities: { formatDate: function () { return ''; } }
};
// 依存関数のスタブ（子GAS転送口を観測する）
const calls = { apply: [], frames: [], resolve: 0 };
const STUBS = [
  // 認証はスタブ（HMAC はこのテストの対象外）
  'function verifyToken(token){ return { valid: true, teacher: { email: "t1@school.ed.jp", name: "教員", school: "第一小学校", role: "TEACHER", target_class: "" } }; }',
  'function liveWatchApplyBatchSharded(teacher, ids, op){ __calls.apply.push({ teacher: teacher, ids: ids, op: op }); return { success: true, op: op, ids: ids }; }',
  'function liveWatchGetFramesSharded(ids, teacher){ __calls.frames.push({ ids: ids, teacher: teacher }); return [{ student_id: ids[0], live_watch: true, at: 1234, has_image: false }]; }',
  'function liveWatchStatusSharded(teacher){ return { success: true, used: 1 }; }',
  'function shardIndexLoad(){ return null; }', // 索引コールド（＝シートへフォールバックしないこと）
  'var __calls = globalThis.__CALLS;'
].join('\n');

ctx.__CALLS = calls;
vm.createContext(ctx);
vm.runInContext(BUNDLE + '\n' + STUBS, ctx, { filename: 'r62_vm.js' });

const TOKEN = 'dummy.payload';

// B5: api_liveWatchStart
const beforeOpen = openByIdCalls;
const rStart = ctx.api_liveWatchStart(TOKEN, ['s1@x.ed.jp', 's2@x.ed.jp']);
check('B5 api_liveWatchStart が成功応答を返す', !!rStart && rStart.success === true, rStart && rStart.success);
check('B6 api_liveWatchStart で SpreadsheetApp.openById は 0 回', openByIdCalls === beforeOpen, openByIdCalls - beforeOpen);
check('B7 api_liveWatchStart が子GAS転送口（liveWatchApplyBatchSharded）へ op=start で渡す',
  calls.apply.length === 1 && calls.apply[0].op === 'start', calls.apply.length);
check('B8 api_liveWatchStart の転送 ID が要求どおり',
  calls.apply.length === 1 && calls.apply[0].ids.length === 2, calls.apply[0] && calls.apply[0].ids);

// B9: api_liveWatchFrames
const beforeOpen2 = openByIdCalls;
const rFrames = ctx.api_liveWatchFrames(TOKEN, ['s1@x.ed.jp']);
check('B9 api_liveWatchFrames が成功応答（data 配列）を返す',
  !!rFrames && rFrames.success === true && Array.isArray(rFrames.data), rFrames && rFrames.success);
check('B10 api_liveWatchFrames で SpreadsheetApp.openById は 0 回', openByIdCalls === beforeOpen2, openByIdCalls - beforeOpen2);
check('B11 api_liveWatchFrames が子GASへ並列取得を委譲する', calls.frames.length === 1, calls.frames.length);
check('B12 転送後に ids を応答へ含める（画面の枠表示用）', !!rFrames && Array.isArray(rFrames.ids), rFrames && rFrames.ids);

// B13-B15: status / extend / stop
const beforeOpen3 = openByIdCalls;
const rStatus = ctx.api_liveWatchStatus(TOKEN);
check('B13 api_liveWatchStatus が成功し openById 0 回',
  !!rStatus && rStatus.success === true && openByIdCalls === beforeOpen3, rStatus && rStatus.success);
const rExtend = ctx.api_liveWatchExtend(TOKEN, ['s1@x.ed.jp']);
check('B14 api_liveWatchExtend が op=extend で転送する',
  !!rExtend && rExtend.success === true && calls.apply[calls.apply.length - 1].op === 'extend', !!rExtend);
const rStop = ctx.api_liveWatchStop(TOKEN, ['s1@x.ed.jp']);
check('B15 api_liveWatchStop が op=stop で転送する',
  !!rStop && rStop.success === true && calls.apply[calls.apply.length - 1].op === 'stop', !!rStop);
check('B16 5 つの API を通して SpreadsheetApp への接触は合計 0 回', sheetTouches === 0, sheetTouches);

// 索引が温まっている場合（スコープ判定が索引だけで完結する）
const warm = new Map(cacheStore);
cacheStore.clear();
cacheStore.set('tv_v', '0');
ctx.shardIndexLoad = function () {
  return [['s1@x.ed.jp', '第一小学校', '5年1組'], ['zz@y.ed.jp', '英田小学校', '5年1組']];
};
const rWarm = ctx.api_liveWatchFrames(TOKEN, ['s1@x.ed.jp', 'zz@y.ed.jp']);
check('B17 索引が温かい場合は他校の児童を落とす（学校境界）',
  !!rWarm && Array.isArray(rWarm.ids) && rWarm.ids.length === 1 && rWarm.ids[0] === 's1@x.ed.jp', rWarm && rWarm.ids);
check('B18 索引経由の判定でも openById は 0 回', sheetTouches === 0, sheetTouches);
cacheStore.clear(); warm.forEach(function (v, k) { cacheStore.set(k, v); });

// ============================================================================
// C. 拡張機能 v1.6.13 の配布物
// ============================================================================
console.log('\n===== C. 配布物（v1.6.13） =====');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
check('C1 extension/manifest.json の version は 1.6.13', manifest.version === '1.6.13', manifest.version);
check('C2 新規権限なし（alarms/identity/identity.email/idle/storage/tabs のみ）',
  JSON.stringify((manifest.permissions || []).slice().sort()) ===
  JSON.stringify(['alarms', 'identity', 'identity.email', 'idle', 'storage', 'tabs']),
  manifest.permissions);
check('C3 default_popup を持たない', !manifest.action || !manifest.action.default_popup);
check('C4 DEFAULT_GAS_URL は空のまま', /const DEFAULT_GAS_URL = '';/.test(bgSrc));
check('C5 ライブ視聴の固定仕様（8000/4000/320/25%）',
  /const LIVE_WATCH_TARGET_MAX_B64 = 8000;/.test(bgSrc) &&
  /const LIVE_WATCH_TARGET_MIN_B64 = 4000;/.test(bgSrc) &&
  /const LIVE_WATCH_TARGET_WIDTH = 320;/.test(bgSrc) &&
  /const LIVE_WATCH_CAPTURE_QUALITY = 25;/.test(bgSrc));

function unzipEntry(zip, entry) {
  try {
    return cp.execSync('unzip -p ' + JSON.stringify(zip) + ' ' + JSON.stringify(entry),
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();
  } catch (e) { return null; }
}

const distStore = path.join(ROOT, 'dist/store.zip');
const distDirect = path.join(ROOT, 'dist/direct.zip');
const distXml = path.join(ROOT, 'dist/update.xml');
const distExt = path.join(ROOT, 'dist/extension.zip');
check('C6 dist/store.zip が存在する', fs.existsSync(distStore));
check('C7 dist/direct.zip が存在する', fs.existsSync(distDirect));
check('C8 dist/extension.zip が存在する', fs.existsSync(distExt));
check('C9 dist/update.xml が存在する', fs.existsSync(distXml));

const sm = unzipEntry(distStore, 'manifest.json');
const dm = unzipEntry(distDirect, 'manifest.json');
const smJ = sm ? JSON.parse(sm) : null;
const dmJ = dm ? JSON.parse(dm) : null;
check('C10 store.zip の manifest.version は 1.6.13', !!smJ && smJ.version === '1.6.13', smJ && smJ.version);
check('C11 direct.zip の manifest.version も 1.6.13', !!dmJ && dmJ.version === '1.6.13', dmJ && dmJ.version);
const xml = fs.existsSync(distXml) ? fs.readFileSync(distXml, 'utf8') : '';
check("C12 update.xml の version は '1.6.13'", /version='1\.6\.13'/.test(xml),
  (xml.match(/version='[^']*'/) || [''])[0]);
check('C13 store.zip に default_popup が無い', !!smJ && (!smJ.action || !smJ.action.default_popup));
check('C14 direct.zip は検証用（default_popup: popup.html）',
  !!dmJ && !!dmJ.action && dmJ.action.default_popup === 'popup.html', dmJ && dmJ.action);
const storeBg = unzipEntry(distStore, 'background.js');
check('C15 store.zip の background.js は extension/background.js と完全一致', storeBg === bgSrc);
check('C16 store.zip の JS に R60 の新しいタブ仮想プレビューが含まれる',
  /drawNewTabPreviewFrame_/.test(storeBg || '') && /isNewTabPageUrl_/.test(storeBg || ''));
check('C17 popup.html に v1.6.13 表記', /v1\.6\.13/.test(unzipEntry(distDirect, 'popup.html') || ''));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
