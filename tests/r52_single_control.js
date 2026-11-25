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
// r52: 個別操作（単体トグル）の CacheService 先行反映と子GAS即時同期転送
//
//  実機症状（R41分散構成: 親GAS 1 ＋ 子GAS 6）
//    「画面一斉ロック／一斉解除」は全端末 4〜6 秒で正常に効く。
//    しかし児童一覧の個別行にある「画面ロック」を1人ずつ手動で切り替えると、
//    管理画面だけ「ロック中」になり対象端末がロックされない。
//
//  原因（二重の欠落）
//    [1] 一括操作（bulkUpdate*）には CacheService 先行反映（hbPrimeControlState_）が
//        あるが、個別更新（updateSingleDevice）には無かった。
//        → 先行返却が効かず、端末はシート書き込み完了まで古い状態を受け取る。
//    [2] 個別操作の子GAS転送は shardPropagatePolicy を forceSync 無しで呼んでいたため、
//        SHARD_ASYNC_ENABLED 時に保留キューへ積まれ deferred: true で即返していた。
//        → 子GASは 15秒周期の console_touch 回収まで指示を受け取らない。
//
//  確定方針（順序も固定・gas/Code.gs のみ・extension/ は v1.6.5 のまま無変更）
//    applySingleControl_ に集約し、必ず次の順で実行する。
//      ① 親キャッシュへ先行反映（シートI/Oなし）
//      ② 子GASへ即時同期転送（forceSync=true / deferred は禁止）
//      ③ シートへ永続化（最後）
//    api_updateSingle（google.script.run）と doPost の update_single（直送）の
//    両方がこの経路を通る。
//
//  検証対象
//    A. applySingleControl_ の実行順序（cache → shard → sheet）
//    B. 個別ロック ON/OFF
//    C. 連続2人・3人の個別操作で取り違え・上書き漏れが無いこと
//    D. 個別URL規制（モード・許可・規制リスト）
//    E. 個別一斉表示の実行IDは1回だけ採番し、キャッシュとシートが一致する
//    F. 配線（api_updateSingle / doPost update_single が統一経路を通る）
//    G. deferred 禁止（forceSync=true を通す）の保証
//    H. 不変条件（1.5秒・14校・v1.6.5・DEFAULT_GAS_URL=''・shardFetchMany無変更）
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
function lineVar(name) {
  const m = src.match(new RegExp('^var ' + name + '\\s*=[^;]*;', 'm'));
  if (!m) throw new Error('not found var: ' + name);
  return m[0];
}

// 端末一覧の13列（本番 CONFIG.DEVICE_COLUMNS と同じ並び）
const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック',
  'URL規制モード', '許可URLリスト', '規制URLリスト',
  '一斉表示URL', '一斉表示実行ID', '現在開いているURL', '最終同期日時', '備考'];
const headerMap = {};
DEVICE_COLUMNS.forEach(function (c, i) { headerMap[c] = i + 1; });

function mkRow(over) {
  const r = DEVICE_COLUMNS.map(function () { return ''; });
  Object.keys(over || {}).forEach(function (k) { r[headerMap[k] - 1] = over[k]; });
  return r;
}

// --- 観測: キャッシュ操作 / 子GAS転送 / シート書き込みの「順序」を記録する ---
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

// 子GAS転送のスパイ（forceSync 第3引数を必ず記録する）
const shardCalls = [];
function shardPropagatePolicySpy(studentIds, patch, forceSync) {
  events.push('shard');
  shardCalls.push({ ids: (studentIds || []).slice(), patch: patch, forceSync: forceSync });
  // 実物と同じく、forceSync が真なら保留に積まず即時送信した体で返す。
  if (forceSync) return { sent: [{ url: 'https://child-51/exec', count: 1, status: 200 }] };
  return { sent: [{ url: 'https://child-51/exec', count: 1, queued: true }], deferred: true };
}
function resetObservers() { events.length = 0; shardCalls.length = 0; }

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

const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean,
  isNaN, isFinite, parseInt, parseFloat, Set, Map, RegExp,
  Logger: { log() {} },
  CacheService: { getScriptCache() { return cacheApi; } },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  CONFIG: { DEVICE_SHEET_NAME: '端末一覧', DEVICE_COLUMNS: DEVICE_COLUMNS.slice() },
  getTargetSheet() { return ctx.__SHEET; },
  // 子GAS転送はスパイ（forceSync を観測する）
  shardPropagatePolicy: shardPropagatePolicySpy
};
vm.createContext(ctx);

let code = '';
[
  'getHeaderMap', 'withWriteLock', 'generateBroadcastId',
  'parseBoolean', 'parseUrlList', 'normalizeHostListToArray_', 'hostListToSheetString_',
  // ① 先行反映
  'hbStateCacheKey_', 'hbWriteStateCache_', 'hbReadStateCache_',
  'hbPrimeStateCacheMany_', 'hbPrimeControlState_',
  // 本体
  'applySingleControl_', 'updateSingleDevice'
].forEach(function (n) { code += extract(n) + '\n'; });
['HB_STATE_CACHE_PREFIX', 'HB_STATE_CACHE_SEC', 'HB_STATE_CACHE_CHUNK']
  .forEach(function (n) { code += lineVar(n) + '\n'; });
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// 端末一覧を用意（3人。個別操作の連続実行を検証する）
function resetSheet() {
  ctx.__SHEET = makeSheet(DEVICE_COLUMNS, [
    DEVICE_COLUMNS.slice(),
    mkRow({ '児童ID': 's1', '学校名': '第一小学校', '氏名': '第一 一郎', 'クラス': '5年1組',
      '画面ロック': false, 'URL規制モード': 'OFF' }),
    mkRow({ '児童ID': 's2', '学校名': '第一小学校', '氏名': '第一 二郎', 'クラス': '5年1組',
      '画面ロック': false, 'URL規制モード': 'OFF' }),
    mkRow({ '児童ID': 's3', '学校名': '第一小学校', '氏名': '第一 三郎', 'クラス': '5年2組',
      '画面ロック': false, 'URL規制モード': 'OFF' })
  ]);
  store.clear();
  resetObservers();
}
function cached(id) {
  const raw = store.get(ctx.hbStateCacheKey_(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function rowOf(id) {
  const rows = ctx.__SHEET._rows;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === id) return rows[i];
  return null;
}

// ============================================================================
// A. 実行順序（cache → shard → sheet）
// ============================================================================
console.log('\n===== A. 個別操作の実行順序（先行反映 → 転送 → 永続化） =====');

resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
const iCache = events.indexOf('cache');
const iShard = events.indexOf('shard');
const iWrite = events.indexOf('setValues');
check('A1 キャッシュ先行反映が最初に実行される', iCache === 0, { events: events });
check('A2 子GAS転送はキャッシュ反映の後', iShard > iCache, { cache: iCache, shard: iShard });
check('A3 シート書き込みは転送の後（最後）', iWrite > iShard, { shard: iShard, write: iWrite });

// ============================================================================
// B. 個別ロック ON / OFF
// ============================================================================
console.log('\n===== B. 個別ロック（単体トグル） =====');

resetSheet();
const rOn = ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
check('B1 個別ロックON でキャッシュに true が入る',
  !!cached('s1') && cached('s1').screen_lock === true, cached('s1'));
check('B2 個別ロックON でシートにも true が書かれる（永続化）',
  rowOf('s1')[headerMap['画面ロック'] - 1] === true,
  rowOf('s1')[headerMap['画面ロック'] - 1]);
check('B3 個別ロックON が子GASへ伝わる', shardCalls.length === 1 &&
  shardCalls[0].patch.screen_lock === true, shardCalls);
check('B4 個別ロックON は forceSync=true（保留キューに積ませない）',
  shardCalls[0].forceSync === true, shardCalls[0] && shardCalls[0].forceSync);
check('B5 個別ロックON の応答は deferred ではない',
  !!rOn && !!rOn.shard && rOn.shard.deferred !== true, rOn && rOn.shard);

resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
resetObservers();
const rOff = ctx.applySingleControl_('s1', { screen_lock: false }, { screen_lock: false });
check('B6 個別解除 でキャッシュが false に戻る',
  !!cached('s1') && cached('s1').screen_lock === false, cached('s1'));
check('B7 個別解除 も子GASへ false を送る',
  shardCalls.length === 1 && shardCalls[0].patch.screen_lock === false, shardCalls);
check('B8 個別解除 も forceSync=true',
  shardCalls[0].forceSync === true, shardCalls[0] && shardCalls[0].forceSync);
check('B9 個別解除 の応答も deferred ではない',
  !!rOff && !!rOff.shard && rOff.shard.deferred !== true, rOff && rOff.shard);

// ============================================================================
// C. 連続2人・3人の個別操作（取り違え・上書き漏れが無いこと）
// ============================================================================
console.log('\n===== C. 連続した個別操作（競合・上書き漏れの検証） =====');

resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
ctx.applySingleControl_('s2', { screen_lock: true }, { screen_lock: true });
check('C1 連続2人ロックで2人ともキャッシュに入る',
  cached('s1').screen_lock === true && cached('s2').screen_lock === true,
  { s1: cached('s1'), s2: cached('s2') });
check('C2 連続2人ロックで子GAS転送も2回（1人ずつ独立）',
  shardCalls.length === 2 &&
  shardCalls[0].ids[0] === 's1' && shardCalls[1].ids[0] === 's2',
  shardCalls.map(function (c) { return c.ids[0]; }));
check('C3 連続2人ロックでシートも2人とも true',
  rowOf('s1')[headerMap['画面ロック'] - 1] === true &&
  rowOf('s2')[headerMap['画面ロック'] - 1] === true);

// 1人だけ解除しても、もう1人はロックのまま（上書き漏れが無い）
resetObservers();
ctx.applySingleControl_('s1', { screen_lock: false }, { screen_lock: false });
check('C4 1人だけ解除しても他児童のキャッシュは壊れない',
  cached('s1').screen_lock === false && cached('s2').screen_lock === true,
  { s1: cached('s1'), s2: cached('s2') });
check('C5 1人だけ解除しても他児童のシート値は変わらない',
  rowOf('s2')[headerMap['画面ロック'] - 1] === true);
check('C6 解除の転送対象はその児童だけ',
  shardCalls.length === 1 && shardCalls[0].ids.length === 1 &&
  shardCalls[0].ids[0] === 's1', shardCalls);

// 3人連続
resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
ctx.applySingleControl_('s2', { screen_lock: true }, { screen_lock: true });
ctx.applySingleControl_('s3', { screen_lock: true }, { screen_lock: true });
check('C7 3人連続でも全員が独立してキャッシュに載る',
  cached('s1').screen_lock === true && cached('s2').screen_lock === true &&
  cached('s3').screen_lock === true);
check('C8 3人連続でも転送は3回（deferred に落ちない）',
  shardCalls.length === 3 && shardCalls.every(function (c) { return c.forceSync === true; }),
  shardCalls.map(function (c) { return c.forceSync; }));
check('C9 3人連続でもシートは全員 true',
  rowOf('s1')[headerMap['画面ロック'] - 1] === true &&
  rowOf('s2')[headerMap['画面ロック'] - 1] === true &&
  rowOf('s3')[headerMap['画面ロック'] - 1] === true);

// ロック→解除→ロック の連打でも最終状態が勝つ
resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
ctx.applySingleControl_('s1', { screen_lock: false }, { screen_lock: false });
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
check('C10 連打しても最終状態（ロック中）がキャッシュに残る',
  cached('s1').screen_lock === true, cached('s1'));
check('C11 連打しても最終状態がシートに残る',
  rowOf('s1')[headerMap['画面ロック'] - 1] === true);
check('C12 連打の転送も3回すべて forceSync（最後が勝つ）',
  shardCalls.length === 3 &&
  shardCalls[2].patch.screen_lock === true &&
  shardCalls.every(function (c) { return c.forceSync === true; }));

// ============================================================================
// D. 個別URL規制
// ============================================================================
console.log('\n===== D. 個別URL規制（モード・許可・規制リスト） =====');

resetSheet();
ctx.applySingleControl_('s1',
  { filter_mode: 'WHITELIST', whitelist_urls: ['nhk.or.jp'], blacklist_urls: ['youtube.com'] },
  { filter_mode: 'WHITELIST', whitelist_urls: ['nhk.or.jp'], blacklist_urls: ['youtube.com'] });
const fc = cached('s1');
check('D1 個別URL規制でモードがキャッシュに入る',
  !!fc && fc.filter_mode === 'WHITELIST', fc);
check('D2 個別URL規制で許可リストがキャッシュに入る',
  !!fc && Array.isArray(fc.whitelist_urls) && fc.whitelist_urls.indexOf('nhk.or.jp') >= 0,
  fc && fc.whitelist_urls);
check('D3 個別URL規制で規制リストがキャッシュに入る',
  !!fc && Array.isArray(fc.blacklist_urls) && fc.blacklist_urls.indexOf('youtube.com') >= 0,
  fc && fc.blacklist_urls);
check('D4 個別URL規制も子GASへ伝わる',
  shardCalls.length === 1 && shardCalls[0].patch.filter_mode === 'WHITELIST', shardCalls);
check('D5 個別URL規制も forceSync=true',
  shardCalls[0].forceSync === true, shardCalls[0] && shardCalls[0].forceSync);
check('D6 個別URL規制がシートへ文字列で永続化される（配列をそのまま書かない）',
  rowOf('s1')[headerMap['URL規制モード'] - 1] === 'WHITELIST' &&
  rowOf('s1')[headerMap['許可URLリスト'] - 1] === 'nhk.or.jp',
  { mode: rowOf('s1')[headerMap['URL規制モード'] - 1],
    white: rowOf('s1')[headerMap['許可URLリスト'] - 1] });

// ロックとURL規制は別項目なので、片方が消えない
resetSheet();
ctx.applySingleControl_('s1', { screen_lock: true }, { screen_lock: true });
ctx.applySingleControl_('s1', { filter_mode: 'BLACKLIST', blacklist_urls: ['game.example'] },
  { filter_mode: 'BLACKLIST', blacklist_urls: ['game.example'] });
const both = cached('s1');
check('D7 個別操作を項目違いで続けても両方残る（マージ）',
  !!both && both.screen_lock === true && both.filter_mode === 'BLACKLIST', both);

// ============================================================================
// E. 個別一斉表示の実行IDは1回だけ採番し、キャッシュとシートが一致する
// ============================================================================
console.log('\n===== E. 個別一斉表示の実行ID（1回採番・一致保証） =====');

resetSheet();
const rBc = ctx.applySingleControl_('s1',
  { broadcast_url: 'https://www.mext.go.jp/', broadcast_id: 'bc_1762500000000_ab12c' },
  { broadcast_url: 'https://www.mext.go.jp/' });
check('E1 指定された実行IDがそのままキャッシュに入る',
  !!cached('s1') && cached('s1').broadcast_id === 'bc_1762500000000_ab12c',
  cached('s1') && cached('s1').broadcast_id);
check('E2 シートの実行IDがキャッシュと一致する（2枚開きの防止）',
  rowOf('s1')[headerMap['一斉表示実行ID'] - 1] === 'bc_1762500000000_ab12c',
  rowOf('s1')[headerMap['一斉表示実行ID'] - 1]);
check('E3 応答にも同じ実行IDが載る',
  !!rBc && rBc.broadcast_id === 'bc_1762500000000_ab12c', rBc && rBc.broadcast_id);
check('E4 個別一斉表示も forceSync=true',
  shardCalls.length === 1 && shardCalls[0].forceSync === true);

// ID未指定なら1回だけ採番し、キャッシュとシートが同じ値になる
//   ※ 差し替えは vm 側のソースとして行う（Node 側のクロージャを toString すると
//     vm 内で mintedList が見えずに ReferenceError になるため）。
resetSheet();
const MINT_BASE = 1762500000000;
const MINT_SRC = [
  'var __mintList = [];',
  'generateBroadcastId = function () {',
  '  var v = "bc_" + (' + MINT_BASE + ' + __mintList.length) + "_mint" + __mintList.length;',
  '  __mintList.push(v);',
  '  return v;',
  '};'
].join('\n');
vm.runInContext(MINT_SRC, ctx);
const rMint = ctx.applySingleControl_('s1', { broadcast_url: 'https://example.com/' },
  { broadcast_url: 'https://example.com/' });
const mintList = ctx.__mintList;
check('E5 実行ID未指定でもキャッシュに入る（採番される）',
  !!cached('s1') && !!cached('s1').broadcast_id, cached('s1'));
check('E6 キャッシュとシートの実行IDが一致する（採番は実質1回）',
  cached('s1').broadcast_id === rowOf('s1')[headerMap['一斉表示実行ID'] - 1],
  { cache: cached('s1').broadcast_id,
    sheet: rowOf('s1')[headerMap['一斉表示実行ID'] - 1] });
check('E7 採番は1回だけ（キャッシュ・シート・応答が同一ID）',
  mintList.length === 1 &&
  cached('s1').broadcast_id === mintList[0] &&
  rowOf('s1')[headerMap['一斉表示実行ID'] - 1] === mintList[0] &&
  !!rMint && rMint.broadcast_id === mintList[0],
  { minted: mintList, cache: cached('s1').broadcast_id });

// ============================================================================
// F. 配線（両入口が統一経路を通る）
// ============================================================================
console.log('\n===== F. 配線（api_updateSingle / doPost update_single） =====');

const fnApi = extract('api_updateSingle');
const dopostStart = src.indexOf('function doPost(');
const dopostHead = src.slice(dopostStart, src.indexOf('\nfunction ', dopostStart + 10));

check('F1 api_updateSingle が applySingleControl_ を通る',
  /applySingleControl_\(/.test(fnApi), (fnApi.match(/applySingleControl_\(/g) || []).length);
check('F2 api_updateSingle が updateSingleDevice を直接呼ばない（統一経路のみ）',
  !/updateSingleDevice\(/.test(fnApi));
check('F3 api_updateSingle が shardPropagatePolicy を直接呼ばない（forceSync漏れ防止）',
  !/shardPropagatePolicy\(/.test(fnApi));
// ※ update_single 分岐は「スコープ検証 → patch 組み立て → 統一経路」と長いため、
//   探索窓は余裕を持たせる（窓が狭いと配線そのものは正しくても検出できない）。
check('F4 doPost の update_single が applySingleControl_ を通る',
  /action === 'update_single'[\s\S]{0,2500}?applySingleControl_\(/.test(dopostHead));
check('F5 doPost の update_single が updateSingleDevice を直接呼ばない',
  !/action === 'update_single'[\s\S]{0,2500}?updateSingleDevice\(/.test(dopostHead));
check('F6 個別経路でも broadcast_id を patch に載せている（2枚開き防止）',
  /if \(single\.broadcast_id\) shardPatch\.broadcast_id/.test(fnApi) &&
  /if \(single\.broadcast_id\) shardPatch\.broadcast_id/.test(dopostHead));
check('F7 応答に broadcast_id を返す（画面が実行IDを保持できる）',
  /broadcast_id: singleRes\.broadcast_id \|\| ''/.test(fnApi) &&
  /broadcast_id: singleRes\.broadcast_id \|\| ''/.test(dopostHead));

// ============================================================================
// G. deferred 禁止の保証
// ============================================================================
console.log('\n===== G. deferred 禁止（個別操作は即時同期転送） =====');

const fnSingle = extract('applySingleControl_');
check('G1 applySingleControl_ は forceSync=true で転送する',
  /shardPropagatePolicy\(\s*\[studentId\]\s*,\s*patch\s*,\s*true\s*\)/.test(fnSingle));
check('G2 applySingleControl_ に opts オブジェクト渡しが無い（位置引数のまま）',
  !/shardPropagatePolicy\([^)]*\{\s*opts\s*:/.test(fnSingle));

const fnProp = extract('shardPropagatePolicy');
check('G3 実物の shardPropagatePolicy は forceSync では保留に積まない',
  /!scheduleAttached && !forceSync/.test(fnProp));
check('G4 保留へ積むのは forceSync でないときだけ（deferred はフォールバックのみ）',
  /return\s*\{\s*sent:\s*queuedResults\s*,\s*deferred:\s*true\s*\}/.test(fnProp));

// 実物で「forceSync=true なら deferred にならない」ことを確認する
console.log('\n----- G5 実物 shardPropagatePolicy で forceSync の挙動を確認 -----');
(function () {
  const p2 = {
    console: { log() {} }, JSON, Date, Math, String, Number, Array, Object, Boolean,
    isNaN, isFinite, parseInt, parseFloat, Set, Map, RegExp, Error,
    __SHEETS: {}, __PROPS: {}, __CACHE: {}
  };
  // 保留キューが「積めた」と嘘をつく環境を作る（forceSync で積まないことを見る）
  vm.createContext(p2);
  let pcode = '';
  ['shardReadPending', 'shardQueuePending', 'shardDropPending', 'shardCoalescePending',
   'shardFlushPending', 'shardPropagatePolicy'].forEach(function (n) {
    try { pcode += extract(n) + '\n'; } catch (e) { /* 無い関数は飛ばす */ }
  });
  pcode += 'var SHARD_ASYNC_ENABLED = true;\n';
  pcode += 'function isShardParent(){ return true; }\n';
  pcode += 'function shardConfigCached(){ return { map: { "5年1組": "https://child-51/exec" }, def: "", sec: "s" }; }\n';
  pcode += 'function shardMapIndexFromMap(m){ var o={}; Object.keys(m||{}).forEach(function(k){ o[k]=m[k]; }); return o; }\n';
  pcode += 'function shardMapDefaultFromEmptyKey(){ return ""; }\n';
  pcode += 'function shardDeviceEntries(){ return [["s1","第一小学校","5年1組"]]; }\n';
  pcode += 'function normalizeShardClass(v){ return String(v||"").trim(); }\n';
  pcode += 'function shardWarnOnce(){}\n';
  pcode += 'function readScheduleRows_(){ return []; }\n';
  pcode += 'function shardBuildScheduleByStudent_(){ return {}; }\n';
  pcode += 'function bulkTraceMark(){}\n';
  // カウンタは vm 側に置く（Node 側の let は vm から参照できない）
  pcode += 'var __queuedCalls = 0;\n';
  pcode += 'function shardQueuePending(reqs){ __queuedCalls++; return true; }\n';
  pcode += 'function shardFetchMany(reqs){ return (reqs||[]).map(function(){ return { getResponseCode: function(){ return 200; }, getContentText: function(){ return "{}"; } }; }); }\n';
  pcode += 'function __queued(){ return __queuedCalls; }\n';
  try {
    vm.runInContext(pcode, p2);
    const resForced = p2.shardPropagatePolicy(['s1'], { screen_lock: true }, true);
    check('G5 forceSync=true なら保留に積まず即時送信（deferred にならない）',
      !!resForced && resForced.deferred !== true && p2.__queued() === 0,
      { deferred: resForced && resForced.deferred, queued: p2.__queued() });
  } catch (e) {
    check('G5 forceSync=true なら保留に積まず即時送信（deferred にならない）', false, String(e));
  }
})();

// ============================================================================
// H. 不変条件（固定仕様の非改変）
// ============================================================================
console.log('\n===== H. 不変条件 =====');

check('H1 ACTIVE_SYNC_INTERVAL_SEC は 1.5 のまま',
  /^const ACTIVE_SYNC_INTERVAL_SEC = 1\.5;/m.test(src));
check('H2 14校（東粟倉小は廃校のため含めない）',
  !/東粟倉/.test(src));
check('H3 shardFetchMany は無変更（UrlFetchApp.fetchAll・個別操作でも同じ送信器）',
  /function shardFetchMany\(/.test(src) && /UrlFetchApp\.fetchAll\(/.test(extract('shardFetchMany')));
check('H4 拡張機能の manifest は v1.6.13 のまま',
  JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8'))
    .version === '1.6.13');
check('H5 拡張機能の DEFAULT_GAS_URL は空文字のまま',
  /const DEFAULT_GAS_URL = '';/.test(
    fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8')));
check('H6 applySingleControl_ はテレメトリ書き戻しをしない（シート読取もしない）',
  !/getDataRange|openById|SpreadsheetApp/.test(extract('applySingleControl_')));
check('H7 MONITOR_SETTINGS_V1 のキー名を維持', /MONITOR_SETTINGS_V1/.test(src));
check('H8 DIAG 計装は残っている（[SHARD-DIAG] / [BULK-TRACE]）',
  /\[SHARD-DIAG\]/.test(src) && /\[BULK-TRACE\]/.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
