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
// ===== fe19: 「画面情報取得」1回目で古い画像が出る症状（Request G）=====
// 実機で 100% 確認できた事実（『画面情報』シートと管理画面の同時録画）:
//   00:00 シート更新日時 2026/11/12 16:38:07（古い画像）
//   00:01 1回目押下 → 「取得中...」
//   00:10 端末アップロード完了。シート更新日時 → 16:39:32（新しい画像）※GAS/拡張は成功
//   00:15 管理画面「取得済み」だが 16:38:07 の古い画像を描いて停止
//   00:19〜 2回目押下でようやく 16:39:32 の画像が出る
//
// 原因は2つ（どちらか一方だけ直しても症状は消えない）:
//   Bug A: loadScreens の metaOnly 併合が「古い Base64」を「新しい更新日時」に貼り付けていた。
//   Bug B: renderScreens の署名(sig) に画像の同一性が無く、
//          正しく Base64 を取り直しても sig が一致して DOM 再構築が握り潰されていた。
//
// 本テストは以下を実挙動で固定する（要件1/2/3）:
//   要件1 … 押下時刻(screenRequestAfterTs)より古い更新日時は「未取得」。
//            hasFresh=true にせず、画像も描かない（needs_image）。
//   要件2 … 新しい更新日時を検知したら必ず本体をフル取得して Base64 を差し替えて描く。
//   要件3 … 上記2点の回帰テスト（本ファイル）。
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, code = '';
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; code += m[1] + '\n'; }

let pass = 0, fail = 0;
function check(name, cond, extra){
  if (cond) { console.log('PASS', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); pass++; }
  else { console.log('FAIL', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); fail++; }
}
// async function も切り出せる抽出器（波括弧の対応を数える）
function extractFn(name){
  const pat = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(');
  const mm = pat.exec(code);
  if (!mm) return '';
  const start = mm.index;
  let i = code.indexOf('{', start), depth = 0, end = -1;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return code.slice(start, end + 1);
}

// ================= A. 静的: 実装が入っていること =================
console.log('\n===== [FE] A. 実装の静的検査（Request G）=====');

check('A1 screenImageSig が定義されている', /function\s+screenImageSig\s*\(/.test(code));
const sigFn = extractFn('screenImageSig');
check('A2 screenImageSig は「長さ＋末尾16文字」で Base64 を区別する',
  /\.length\s*\+\s*':'/.test(sigFn) && /slice\(\s*-16\s*\)/.test(sigFn), sigFn.length);

const renderSrc = extractFn('renderScreens');
check('A3 renderScreens の署名 sig が画像の同一性を含む（Bug B）',
  /const sig = screensData\.map[\s\S]*?screenImageSig\(d\)/.test(renderSrc));
check('A4 sig が needs_image も含む（本体到着で必ず作り直させる）',
  /const sig = screensData\.map[\s\S]*?d\.needs_image \? 1 : 0/.test(renderSrc));
check('A5 needs_image の間は画像(<img>)を描かない',
  /if \(d\.has_image && !d\.needs_image\)/.test(renderSrc));
check('A6 needs_image 用の「取得中」表示分岐がある',
  /\} else if \(d\.needs_image\) \{/.test(renderSrc) && /取得中（最新の画面を待っています）/.test(renderSrc));
check('A7 「取得済」集計が needs_image を除外する',
  /const ready = screensData\.filter\(d => d\.has_image && !d\.needs_image\)/.test(renderSrc));
check('A7b 既存の「取得待ち」文言を壊していない（fe15 互換）', /取得待ち/.test(renderSrc));

const mergeSrc = extractFn('mergeScreenRows');
check('A8 mergeScreenRows に押下時刻の厳格な下限(strictFloorMs)がある',
  /const strictFloorMs = /.test(mergeSrc) && /screenRequestAfterTs/.test(mergeSrc));
check('A9 下限未満は belowFloor として新着判定から除外する',
  /const belowFloor = /.test(mergeSrc) && /const isFresh = !belowFloor &&/.test(mergeSrc));
check('A10 stale_before_request を立てる（押下前＝前回画像）',
  /r\.stale_before_request = !!belowFloor/.test(mergeSrc));
check('A11 needs_image を mergeScreenRows が立てる',
  /r\.needs_image = !!\(belowFloor \|\|/.test(mergeSrc));
check('A12 既存の browser 時計(screenReqTs)は判定に混ぜていない（R43.1 互換）',
  !/screenReqTs/.test(mergeSrc));

const loadSrc = extractFn('loadScreens');
check('A13 hasFresh が stale_before_request を弾く（要件1）',
  /if \(d\.stale_before_request === true\) return false;/.test(loadSrc));
check('A14 hasFresh に押下時刻フォールバックの下限がある',
  /const __floor = /.test(loadSrc) && /if \(__floor > 0 && ms > 0 && ms < __floor\) return false;/.test(loadSrc));
check('A15 hasFresh のフォールバックが押下基準より前の日時を完了扱いしない',
  /screenRequestAfterTs/.test(loadSrc));
check('A16 metaOnly 併合が「日時と画像」を対で扱う（sameShot）',
  /const sameShot = String\(prev\.screenshot_at/.test(loadSrc));
check('A17 新しい更新日時で本体未取得なら needs_image を立てる（Bug A）',
  /d\.needs_image = true;/.test(loadSrc));
check('A18 metaOnly 併合に「古い Base64 を新しい日時に貼る」旧分岐が残っていない',
  !/if \(!d\.pending_new && prev\.has_image && !d\.image_data_url\) \{/.test(loadSrc));

const stopSrc = extractFn('stopScreenPolling');
check('A19 ポーリング終了時に screenRequestAfterTs を 0 に戻す（仕様b）',
  /screenRequestAfterTs = 0;/.test(stopSrc));
check('A20 ポーリング終了時に needs_image / stale を解除する',
  /if \(d\.needs_image\) \{ d\.needs_image = false; dirty = true; \}/.test(stopSrc) &&
  /if \(d\.stale_before_request\) \{ d\.stale_before_request = false; dirty = true; \}/.test(stopSrc));

check('A21 screenPendingFreshCount が定義されている（仕様c）', /function\s+screenPendingFreshCount\s*\(/.test(code));
const tickSrc = extractFn('scheduleScreenPollTick');
check('A22 全員そろった時点(0台)で即停止する',
  /if \(screenPendingFreshCount\(\) === 0\) \{[\s\S]*?stopScreenPolling\(\);/.test(tickSrc));
check('A23 changed 分岐で即停止しない（他の児童の到着を待つ）',
  /if \(changed\) \{[\s\S]{0,600}?\}[\s\S]*?screenPendingFreshCount/.test(tickSrc) &&
  !/if \(changed\) \{[\s\S]{0,400}?stopScreenPolling\(\);/.test(tickSrc));
check('A24 最大30秒(SCREEN_POLL_MAX)は安全上限として残っている',
  /if \(screenPollTries >= SCREEN_POLL_MAX\)/.test(tickSrc));
check('A25 収集待ちの判定は capture_blocked を待たない（R43.3）', (function(){
  const f = extractFn('screenPendingFreshCount');
  return /if \(d\.capture_blocked\) return;/.test(f);
})());

// ================= 動的ハーネス =================
const classState = {};
function mkEl(id){
  if (classState[id]) return classState[id];
  const set = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    style: { setProperty(){}, removeProperty(){} },
    classList: {
      add(c){ set.add(c); }, remove(c){ set.delete(c); },
      toggle(c, force){
        if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
        else if (force) { set.add(c); } else { set.delete(c); }
      },
      contains(c){ return set.has(c); }
    },
    appendChild(){}, addEventListener(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    // updateScreenCardStates が再帰しないよう、カード1枚を返す（実DOMの代役）
    querySelectorAll(){ return [{ getAttribute(){ return 's1'; }, querySelector(){ return null; } }]; },
    querySelector(){ return null; }
  };
  classState[id] = el;
  return el;
}

const sandbox = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN,
  parseFloat, parseInt, Set, Map, Promise,
  setTimeout: function (){ return 0; }, clearTimeout(){},
  setInterval: function (){ return 0; }, clearInterval(){},
  localStorage: { getItem(){ return null; }, setItem(){} },
  document: {
    getElementById(id){ return mkEl(id); },
    createElement(){ return mkEl('tmp' + Math.random()); },
    querySelectorAll(){ return []; }
  },
  alert(){}, confirm(){ return true; }
};
vm.createContext(sandbox);

// 前提: 使う関数だけを名前で切り出して VM へ入れる（未定義参照は prelude で補う）
const prelude = [
  'var SCREEN_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;',
  'var SCREEN_CLOCK_SKEW_MS = 5000;',
  'var SCREEN_PENDING_TTL_MS = 45000;',
  'var SCREEN_POLL_MAX = 30;',
  'var screensData = [];',
  'var screenFetchActive = false;',
  'var screenPendingSince = 0;',
  'var screenBaseMs = 0;',
  'var screenBaseById = {};',
  'var screenRequestAfterTs = 0;',
  'var screenReqTs = 0;',
  'var screenRenderedSig = "";',
  'var screenRevealTime = {};',
  'var screenPollTimer = null;',
  'var screenPollGen = 0;',
  'var screenPollTries = 0;',
  'var __toastCount = 0;',
  'function slog(){}',
  'function showToast(){ __toastCount++; }',
  'function getTeacherScopeSchool(){ return null; }',
  'function resolveBulkTargetIds(){ return { ids: [] }; }',
  'function fetchShardScreensParallel(){ return Promise.resolve([]); }',
  'var __apiData = [];',
  'function apiRequest(){ return Promise.resolve({ data: __apiData }); }',
  'function updateScreenFetchButton(){}',
  'function openScreenPreview(){}'
].join('\n');

const tail = `
__setScreens = function(a){ screensData = a; };
__screens = function(){ return screensData; };
__setAfter = function(v){ screenRequestAfterTs = v; };
__after = function(){ return screenRequestAfterTs; };
__setActive = function(v){ screenFetchActive = v; };
__setPendSince = function(v){ screenPendingSince = v; };
__setBaseById = function(o){ screenBaseById = o || {}; };
__setBaseMs = function(v){ screenBaseMs = v; };
__setApiData = function(a){ __apiData = a; };
__resetSig = function(){ screenRenderedSig = ''; };
__sig = function(){ return screenRenderedSig; };
__grid = function(){ return document.getElementById('screenGrid').innerHTML; };
__bar = function(){ return document.getElementById('screenStatusBar').innerHTML; };
__pendingCount = function(){ return screenPendingFreshCount(); };
`;

const parts = ['screenTsToMs', 'formatStampJst', 'screenImageSig', 'escapeHtml', 'onlineBadgeHtml',
  'updateScreenCardStates', 'renderScreens', 'mergeScreenRows', 'screenPendingFreshCount',
  'scheduleScreenPollTick', 'stopScreenPolling', 'loadScreens'];
let src = prelude + '\n';
parts.forEach(function (n) {
  const f = extractFn(n);
  if (f) src += f + '\n';
});
src += tail;
vm.runInContext(src, sandbox);

// 押下時刻（ブラウザ時計）とシート更新日時の関係を実機どおりに作る
const OLD_JST = '2026/11/12 16:38:07';   // 押下前から存在した古い画像
const NEW_JST = '2026/11/12 16:39:32';   // 押下後に端末がアップロードした新しい画像
const OLD_MS = sandbox.screenTsToMs(OLD_JST);
const NEW_MS = sandbox.screenTsToMs(NEW_JST);
const PRESS_MS = sandbox.screenTsToMs('2026/11/12 16:39:20');  // 00:01 の押下
const OLD_B64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA EUUAAQAE';
const NEW_B64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA BQAQ==';

// ================= B. mergeScreenRows: 押下前の日時を弾く（要件1）=================
console.log('\n===== [FE] B. mergeScreenRows の下限ゲート（要件1）=====');

sandbox.__setActive(true);
sandbox.__setAfter(PRESS_MS);
sandbox.__setBaseById({});
sandbox.__setBaseMs(0);

// B1-B4: 押下前の更新日時（16:38:07）＋画像あり
const mOld = sandbox.mergeScreenRows([
  { student_id: 's1', has_image: true, image_data_url: OLD_B64, screenshot_at: OLD_JST, screenshot_ms: OLD_MS }
], []);
check('B1 押下前の日時は「新着」にしない（shot_is_fresh=false）', mOld[0].shot_is_fresh === false, mOld[0].shot_is_fresh);
check('B2 押下前の日時は stale_before_request=true', mOld[0].stale_before_request === true, mOld[0].stale_before_request);
check('B3 押下前の日時は needs_image=true（古い画像を描かせない）', mOld[0].needs_image === true, mOld[0].needs_image);
check('B4 押下前の日時は稼働中なら pending_new=true（更新待ち）', mOld[0].pending_new === true, mOld[0].pending_new);

// B5-B6: 押下後の更新日時（16:39:32）＋画像あり
const mNew = sandbox.mergeScreenRows([
  { student_id: 's1', has_image: true, image_data_url: NEW_B64, screenshot_at: NEW_JST, screenshot_ms: NEW_MS }
], []);
check('B5 押下後の日時は「新着」（shot_is_fresh=true）', mNew[0].shot_is_fresh === true, mNew[0].shot_is_fresh);
check('B6 押下後の日時は stale=false / needs_image=false',
  mNew[0].stale_before_request === false && mNew[0].needs_image === false,
  { stale: mNew[0].stale_before_request, needs: mNew[0].needs_image });
check('B6b 押下後の日時は pending_new=false（更新待ちにしない）', mNew[0].pending_new === false, mNew[0].pending_new);

// B7: 押下していない（screenRequestAfterTs=0）ときは下限を課さない＝従来表示を壊さない
sandbox.__setAfter(0);
const mNoPress = sandbox.mergeScreenRows([
  { student_id: 's1', has_image: true, image_data_url: OLD_B64, screenshot_at: OLD_JST, screenshot_ms: OLD_MS }
], []);
check('B7 未押下なら下限を課さない（既存の取得済表示を壊さない）',
  mNoPress[0].stale_before_request === false && mNoPress[0].needs_image === false,
  { stale: mNoPress[0].stale_before_request, needs: mNoPress[0].needs_image });

// B8: シート要求日時が空でも押下時刻で弾ける（仕様c）
sandbox.__setAfter(PRESS_MS);
const mNoSheetReq = sandbox.mergeScreenRows([
  { student_id: 's2', has_image: true, image_data_url: OLD_B64,
    screenshot_at: OLD_JST, screenshot_ms: OLD_MS, screen_request_at: '', screen_request_ms: 0 }
], []);
check('B8 シートの要求日時が空でも押下時刻の下限で弾く（仕様c）',
  mNoSheetReq[0].shot_is_fresh === false && mNoSheetReq[0].needs_image === true,
  { fresh: mNoSheetReq[0].shot_is_fresh, needs: mNoSheetReq[0].needs_image });

// B9: screenshot_from='device' でも同じ下限で弾く（仕様c のフォールバック経路）
const mDevice = sandbox.mergeScreenRows([
  { student_id: 's3', has_image: true, image_data_url: OLD_B64, screenshot_from: 'device',
    screenshot_at: OLD_JST, screenshot_ms: OLD_MS }
], []);
check('B9 screenshot_from=device の古い日時も弾く（統一ゲート）',
  mDevice[0].shot_is_fresh === false && mDevice[0].stale_before_request === true,
  { fresh: mDevice[0].shot_is_fresh, stale: mDevice[0].stale_before_request });

// ================= C. loadScreens: hasFresh と Base64 の対（要件1/2）=================
console.log('\n===== [FE] C. loadScreens: 完了判定と Base64 の対（要件1/2）=====');

(async function () {
  sandbox.__setActive(true);
  sandbox.__setAfter(PRESS_MS);
  sandbox.__setPendSince(Date.now());
  sandbox.__setBaseById({});

  // 既に手元に「16:38:07 の古い画像」がある状態から押す（実機 00:01 と同じ）
  sandbox.__setScreens([
    { student_id: 's1', has_image: true, image_data_url: OLD_B64,
      screenshot_at: OLD_JST, screenshot_ms: OLD_MS, screenshot_from: 'sheet' }
  ]);
  sandbox.__resetSig();

  // C1/C2: 1回目のメタ取得が「押下前の古い行」を返す（00:15 の実機そのもの）
  sandbox.__setApiData([
    { student_id: 's1', has_image: true, image_data_url: '', screenshot_at: OLD_JST, screenshot_ms: OLD_MS }
  ]);
  const hasFreshOld = await sandbox.loadScreens({ silent: true, metaOnly: true });
  check('C1 押下前の更新日時しか無ければ「取得完了」にしない（hasFresh=false）',
    hasFreshOld === false, hasFreshOld);
  const s1Old = sandbox.__screens().find(function (d) { return d.student_id === 's1'; });
  check('C2 押下前の行は needs_image=true（画像を出す対象から外す）', s1Old.needs_image === true, s1Old.needs_image);
  check('C2b 押下前の行は stale_before_request=true', s1Old.stale_before_request === true, s1Old.stale_before_request);

  // C3/C4: 2回目のメタ取得で「押下後の新しい更新日時」が届く（本体はまだ無い）
  sandbox.__setApiData([
    { student_id: 's1', has_image: true, image_data_url: '', screenshot_at: NEW_JST, screenshot_ms: NEW_MS }
  ]);
  const hasFreshNew = await sandbox.loadScreens({ silent: true, metaOnly: true });
  check('C3 押下後の更新日時が届いたら「取得完了」と判定する（要件1）', hasFreshNew === true, hasFreshNew);
  const s1New = sandbox.__screens().find(function (d) { return d.student_id === 's1'; });
  check('C4 新しい日時に古い Base64 を貼らない（Bug A）', s1New.screenshot_at === OLD_JST, s1New.screenshot_at);
  check('C4b 本体未取得なので needs_image=true（古い画像を見せない）', s1New.needs_image === true, s1New.needs_image);
  check('C4c 新しい日時そのものは失われない（取得の手掛かりを保持）',
    String(hasFreshNew) === 'true');

  // C5: フル取得（metaOnly:false）で新しい Base64 が届く（要件2）
  sandbox.__setApiData([
    { student_id: 's1', has_image: true, image_data_url: NEW_B64, screenshot_at: NEW_JST, screenshot_ms: NEW_MS }
  ]);
  const hasFreshFull = await sandbox.loadScreens({ silent: true, wantImages: true });
  const s1Full = sandbox.__screens().find(function (d) { return d.student_id === 's1'; });
  check('C5 フル取得で新しい Base64 に入れ替わる（要件2）',
    s1Full.image_data_url === NEW_B64, s1Full.image_data_url.slice(-12));
  check('C5b フル取得後は needs_image=false（取得済へ遷移）', s1Full.needs_image === false, s1Full.needs_image);
  check('C5c フル取得後は古い Base64 が残っていない', s1Full.image_data_url.indexOf('EUUAAQAE') < 0);
  check('C5d フル取得後は hasFresh=true', hasFreshFull === true, hasFreshFull);

  // ================= D. renderScreens: 描画の実挙動（要件1/2/Bug B）=================
  console.log('\n===== [FE] D. renderScreens の描画（要件1/2/Bug B）=====');

  // D1-D3: needs_image の行は画像も「取得済」も出さない
  sandbox.__resetSig();
  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: OLD_B64,
      screenshot_at: OLD_JST, screenshot_ms: OLD_MS, needs_image: true,
      screen_request_at: '2026/11/12 16:39:20|sr_x', is_online: true }
  ]);
  sandbox.renderScreens({ light: false });
  const htmlNeeds = sandbox.__grid();
  check('D1 needs_image の間は <img> を描かない（古い画面の誤認防止）', htmlNeeds.indexOf('<img') < 0);
  check('D2 needs_image の間は「取得中」を表示する', /取得中（最新の画面を待っています）/.test(htmlNeeds));
  check('D3 needs_image の間は「取得済」と表示しない', htmlNeeds.indexOf('取得済<') < 0 && htmlNeeds.indexOf('>取得済<') < 0);
  check('D3b needs_image を「取得済」に数えない（集計）', /取得済 <span[^>]*>0<\/span>/.test(sandbox.__bar()), sandbox.__bar().slice(0, 120));

  // D4: 本体到着後は新しい画像で描画する
  sandbox.__resetSig();
  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: NEW_B64,
      screenshot_at: NEW_JST, screenshot_ms: NEW_MS, needs_image: false, is_online: true }
  ]);
  sandbox.renderScreens({ light: false });
  const htmlNew = sandbox.__grid();
  check('D4 本体到着後は新しい Base64 を <img> に描く', htmlNeeds.indexOf('<img') < 0 && htmlNeeds !== '' && htmlNew.indexOf('BQAQ==') >= 0);
  check('D3c 古い Base64 は描画に残っていない', htmlNeeds.indexOf('EUUAAQAE') < 0);

  // D5: 同じ撮影日時のまま Base64 だけ差し替わったら必ず描き直す（Bug B の本丸）
  sandbox.__resetSig();
  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: OLD_B64,
      screenshot_at: NEW_JST, screenshot_ms: NEW_MS, needs_image: false, is_online: true }
  ]);
  sandbox.renderScreens({ light: false });
  const sigA = sandbox.__sig();
  const htmlA = sandbox.__grid();
  check('D5 前提: 同一日時の旧 Base64 を描ける', htmlA.indexOf('EUUAAQAE') >= 0);

  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: NEW_B64,
      screenshot_at: NEW_JST, screenshot_ms: NEW_MS, needs_image: false, is_online: true }
  ]);
  sandbox.renderScreens({ light: false });   // light:false の再描画（実機 00:11 の経路）
  const sigB = sandbox.__sig();
  const htmlB = sandbox.__grid();
  check('D6 同一日時でも Base64 が変われば署名が変わる（Bug B 修正）', sigA !== sigB);
  check('D7 同一日時でも新しい Base64 で DOM を作り直す（2回目押下なしで反映）',
    htmlB.indexOf('BQAQ==') >= 0 && htmlB.indexOf('EUUAAQAE') < 0);

  // D8: needs_image の有無も署名に入る（本体到着で必ず作り直す）
  sandbox.__resetSig();
  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: NEW_B64,
      screenshot_at: NEW_JST, screenshot_ms: NEW_MS, needs_image: true, is_online: true }
  ]);
  sandbox.renderScreens({ light: false });
  const sigNeeds = sandbox.__sig();
  check('D8 needs_image の有無で署名が変わる', sigA !== sigB && sigB !== sigNeeds);

  // ================= E. screenPendingFreshCount（仕様c）=================
  console.log('\n===== [FE] E. 全員そろったかの判定（仕様c）=====');

  sandbox.__setScreens([
    { student_id: 's1', has_image: true, needs_image: true },
    { student_id: 's2', has_image: false, screen_request_at: '2026/11/12 16:39:20|sr_x' }
  ]);
  check('E1 本体待ち＋初回待ちの2台を数える', sandbox.__pendingCount() === 2, sandbox.__pendingCount());

  sandbox.__setScreens([
    { student_id: 's1', has_image: true, needs_image: true, capture_blocked: true }
  ]);
  check('D9b 保護ページ（撮影不可）は待たない＝数えない', sandbox.__pendingCount() === 0, sandbox.__pendingCount());

  sandbox.__setScreens([
    { student_id: 's1', student_name: '児童1', has_image: true, image_data_url: NEW_B64,
      screenshot_at: NEW_JST, needs_image: false, is_online: true }
  ]);
  check('E2 全員そろえば 0 台（＝即停止して取得済へ）', sandbox.__pendingCount() === 0, sandbox.__pendingCount());

  const cntSrc = extractFn('screenPendingFreshCount');
  check('E3 待ち判定に pending_new を使っていない（旧画像の更新待ちは即停止対象外）',
    !/pending_new/.test(cntSrc));

  // ================= F. stopScreenPolling: 基準の解除（仕様b）=================
  console.log('\n===== [FE] F. ポーリング終了時の後片付け（仕様b）=====');

  sandbox.__setActive(true);
  sandbox.__setAfter(PRESS_MS);
  sandbox.__setScreens([
    { student_id: 's1', has_image: true, image_data_url: OLD_B64,
      screenshot_at: OLD_JST, needs_image: true, stale_before_request: true, pending_new: true }
  ]);
  sandbox.__resetSig();
  sandbox.stopScreenPolling();
  check('F1 終了時に screenRequestAfterTs を 0 に戻す', sandbox.__after() === 0, sandbox.__after());
  const sAfter = sandbox.__screens()[0];
  check('F2 終了時に needs_image を解除する', sAfter.needs_image === false, sAfter.needs_image);
  check('F3 終了時に stale_before_request を解除する', sAfter.stale_before_request === false, sAfter.stale_before_request);
  check('F4 終了時に pending_new を解除する（R43 の固着防止）', sAfter.pending_new === false, sAfter.pending_new);
  check('F5 終了後は旧画像を「取得済（前回の画像）」として再表示できる',
    sandbox.__grid().indexOf('EUUAAQAE') >= 0 && sandbox.__grid().indexOf('<img') >= 0);

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})();
