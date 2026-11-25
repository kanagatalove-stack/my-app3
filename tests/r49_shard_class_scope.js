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
// r49: R41 傳播バグ — 担当子GASを持たないクラスへ送らない／子に行を作らせない
//
//  実機症状
//    SHARD_MAP_V1 に「5年1組」の子GASだけを登録した状態で、子シートから
//    3年1組の行（test04-002）を削除し、親コンソールから 画面ロック を実行すると
//    子シートに
//      未設定 / 未登録児童 (test04-002@city-mimasaka.ed.jp) / 3年1組
//    の行が復活した。
//
//  原因（二重）
//    [親] 宛先解決が `idx[cls] || emptyDef || defUrl || singleChildUrl` で、
//         既知クラス（3年1組）が SHARD_MAP_V1 に無くても「唯一の子GAS」へ流れた。
//         さらに予約同封ループが同じ連鎖を再計算していたため、
//         ポリシーを送らなくても予約だけが届く抜け道があった。
//    [子] shardEnsureDeviceRows が受け取ったIDを無条件に行作成していた。
//
//  確定仕様（今回のルール）
//    ・子GASを持たないクラスは「親GASのみで運用」＝送らない・行も作らせない
//    ・singleChildUrl フォールバックは“クラスが未取得・不明”の児童だけ
//    ・既存行あり＋class_map になし → 許可（コマンドは適用される）
//      禁止するのは「未登録児童」行の【新規作成】だけ
//    ・ハートビート登録（resolveShardForHeartbeat）は変更しない
//    ・静かな脱落（無言の成功）は禁止＝理由を戻り値とログに残す
//
//  検証対象
//    A. 親側: 宛先解決（実機シナリオの再現・既定URLの適用範囲・無言の成功の禁止）
//    B. 子側: 所有権ガード（新規作成の抑止・既存行の許可・ID表記ゆれ）
//    C. 二重防御: 旧仕様の漏れた指示が届いても子が行を作らない
// ============================================================================
const fs = require('fs'), vm = require('vm');
const gasSrc = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

function extract(src, name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
function lineConst(src, name) {
  const re = new RegExp('^const ' + name + '\\s*=[^;]*;', 'm');
  const m = src.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// ---- 端末一覧の列（shard_mode.js のハーネスと同一） ----
const COLS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];
function headerMapOf(cols) { const m = {}; cols.forEach((c, i) => { m[c] = i + 1; }); return m; }
const HMAP = headerMapOf(COLS);

function rowOf(id, cls, school) {
  const r = new Array(COLS.length).fill('');
  r[HMAP['児童ID'] - 1] = id;
  r[HMAP['学校名'] - 1] = school || '第一小学校';
  r[HMAP['クラス'] - 1] = cls;
  return r;
}

// ============================================================================
// A. 親側: shardPropagatePolicy の宛先解決
//    依存（設定・索引・送信）はスタブにし、本体だけを実物で動かす。
// ============================================================================
const P = {
  console: { log: function () {} },
  JSON: JSON, Date: Date, Math: Math, String: String, Number: Number,
  Array: Array, Object: Object, Boolean: Boolean, Set: Set, Map: Map, RegExp: RegExp,
  isNaN: isNaN, parseInt: parseInt,
  Logger: { log: function () {} },
  __sent: [], __warns: [], __entries: [], __cfg: { map: {}, sec: 'sk_test12345678', def: '' }
};
P.CONFIG = { DEVICE_COLUMNS: COLS, DEVICE_SHEET_NAME: '端末一覧' };
P.isShardParent = function () { return true; };
P.shardConfigCached = function () { return P.__cfg; };
P.shardDeviceEntries = function () { return P.__entries; };
P.shardWarnOnce = function (k, m) { P.__warns.push(String(m)); };
P.bulkTraceMark = function () {};
P.getTargetSheet = function () { return { getDataRange: function () { return { getValues: function () { return [COLS]; } }; } }; };
P.getHeaderMap = function () { return HMAP; };
P.shardFetchMany = function (reqs) {
  const list = Array.isArray(reqs) ? reqs : [];
  for (let i = 0; i < list.length; i++) {
    let body = {};
    try { body = JSON.parse(String((list[i] && list[i].payload) || '{}')); } catch (e) { body = {}; }
    P.__sent.push({ url: list[i].url, body: body });
  }
  return list.map(function () {
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"success":true}'; } };
  });
};

// 予約同封の経路（readScheduleRows_）は定義しない。
//   ⇒ shardPropagatePolicy 内の typeof ガードで同封処理が丸ごと省かれ、
//     「ポリシーだけが宛先解決の対象」という今回の論点に絞れる。
let pBundle = '';
pBundle += extract(gasSrc, 'normalizeShardClass') + '\n';
pBundle += extract(gasSrc, 'shardMapIndexFromMap') + '\n';
pBundle += extract(gasSrc, 'shardMapDefaultFromEmptyKey') + '\n';
pBundle += extract(gasSrc, 'shardPropagatePolicy') + '\n';
vm.createContext(P);
vm.runInContext(pBundle, P);

function runProp(options) {
  const o = options || {};
  P.__sent = []; P.__warns = [];
  const map = o.map || {};
  P.__cfg = { map: map, sec: 'sk_test12345678', def: o.def || '' };
  P.__entries = o.entries || [];
  return P.shardPropagatePolicy(o.ids === undefined ? 'ALL' : o.ids, o.patch || { screen_lock: true }, true);
}

console.log('===== A. 親側: 担当子GASを持たないクラスへ送らない =====');

// --- A-1 実機シナリオの再現: 5年1組の子GASしか無い状態で 3年1組 を画面ロック ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    entries: [
      ['1607002', '第一小学校', '5年1組'],
      ['test04-002@city-mimasaka.ed.jp', '第一小学校', '3年1組']
    ],
    ids: ['test04-002@city-mimasaka.ed.jp']
  });
  check('A1 担当子GASを持たないクラスの児童は子GASへ送られない',
    P.__sent.length === 0, P.__sent);
  check('A2 宛先ゼロを無言の成功にしない（reason を返す）',
    !!res && res.skipped === true && res.reason === 'no_assigned_child', res);
  check('A3 理由に「未割当」件数が入る',
    !!res && res.unassigned === 1, res && res.unassigned);
  check('A4 送らなかった事実をログに残す（親GASのみで運用）',
    P.__warns.some(function (m) { return /SHARD_MAP_V1/.test(m) && /親GASのみで運用/.test(m); }),
    P.__warns);
  check('A5 クラス不明の脱落（no_route）と混同しない',
    !!res && res.reason !== 'no_route', res && res.reason);
})();

// --- A-2 担当クラスの児童は従来どおり送られる（機能を落としていない） ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    entries: [
      ['1607002', '第一小学校', '5年1組'],
      ['test04-002@city-mimasaka.ed.jp', '第一小学校', '3年1組']
    ],
    ids: ['1607002']
  });
  check('A6 担当クラスの児童は子GASへ送られる', P.__sent.length === 1, P.__sent.length);
  check('A7 宛先はそのクラスの子GAS',
    P.__sent.length === 1 && P.__sent[0].url === 'https://child-a/exec',
    P.__sent[0] && P.__sent[0].url);
  check('A8 student_ids に担当児童が入る',
    P.__sent.length === 1 && P.__sent[0].body.student_ids.length === 1 &&
    P.__sent[0].body.student_ids[0] === '1607002',
    P.__sent[0] && P.__sent[0].body.student_ids);
  check('A9 class_map が子の行作成用に添えられる',
    P.__sent.length === 1 && !!P.__sent[0].body.class_map &&
    P.__sent[0].body.class_map['1607002'] === '5年1組',
    P.__sent[0] && P.__sent[0].body.class_map);
  check('A10 送信できたときは skipped を返さない',
    !!res && res.skipped !== true && Array.isArray(res.sent), res && res.skipped);
})();

// --- A-3 全校一括（ALL）でも担当外クラスは混ざらない ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    entries: [
      ['1607002', '第一小学校', '5年1組'],
      ['test04-002@city-mimasaka.ed.jp', '第一小学校', '3年1組'],
      ['1607003', '第一小学校', '5年1組']
    ],
    ids: 'ALL'
  });
  check('A11 ALL でも送信先は担当クラスの子GASだけ', P.__sent.length === 1, P.__sent.length);
  const ids = P.__sent.length === 1 ? P.__sent[0].body.student_ids : [];
  check('A12 ALL の student_ids に担当外児童が混ざらない',
    ids.indexOf('test04-002@city-mimasaka.ed.jp') < 0, ids);
  check('A13 ALL の student_ids に担当児童は全員入る',
    ids.indexOf('1607002') >= 0 && ids.indexOf('1607003') >= 0 && ids.length === 2, ids);
  check('A14 ALL でも class_map は担当児童ぶんだけ',
    P.__sent.length === 1 && Object.keys(P.__sent[0].body.class_map).length === 2,
    P.__sent[0] && P.__sent[0].body.class_map);
})();

// --- A-4 既定URLがあっても「既知クラス未割当」には効かない ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    def: 'https://def.example/exec',
    entries: [['test04-002@city-mimasaka.ed.jp', '第一小学校', '3年1組']],
    ids: ['test04-002@city-mimasaka.ed.jp']
  });
  check('A15 既知クラス未割当は既定URLがあっても送らない',
    P.__sent.length === 0, P.__sent);
  check('A16 そのときも理由を返す（無言の成功にしない）',
    !!res && res.skipped === true && res.reason === 'no_assigned_child', res);
})();

// --- A-5 既定URLは「クラス未取得・不明」の児童には従来どおり効く ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    def: 'https://def.example/exec',
    entries: [['u1@x.ed.jp', '第一小学校', '未設定']],
    ids: ['u1@x.ed.jp']
  });
  check('A17 クラス不明（未設定）の児童は既定URLへ送る',
    P.__sent.length === 1 && P.__sent[0].url === 'https://def.example/exec',
    P.__sent[0] && P.__sent[0].url);
  check('A18 クラス不明のフォールバックは skipped にしない',
    !!res && res.skipped !== true, res && res.skipped);
})();

// --- A-6 SHARD_MAP_V1 の空キー既定も「クラス不明」にだけ効く ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec', '': 'https://empty.example/exec' },
    entries: [['u2@x.ed.jp', '第一小学校', '']],
    ids: ['u2@x.ed.jp']
  });
  check('A19 クラス未取得の児童は空キー既定へ送る',
    P.__sent.length === 1 && P.__sent[0].url === 'https://empty.example/exec',
    P.__sent[0] && P.__sent[0].url);

  const res2 = runProp({
    map: { '5年1組': 'https://child-a/exec', '': 'https://empty.example/exec' },
    entries: [['test04-002@city-mimasaka.ed.jp', '第一小学校', '3年1組']],
    ids: ['test04-002@city-mimasaka.ed.jp']
  });
  check('A20 既知クラス未割当は空キー既定へも流さない',
    P.__sent.length === 0 && !!res2 && res2.reason === 'no_assigned_child', res2);
})();

// --- A-7 クラス不明かつ既定URLなし → no_route（既存の静かな脱落ガード維持） ---
//   注意: 子GASが 1 つだけのときは singleChildUrl がクラス不明児童の
//   フォールバックとして正しく効くため（確定仕様）、no_route にはならない。
//   no_route を検証するには子GASを 2 つにして singleChildUrl を空にする。
(function () {
  const res = runProp({
    map: { '1年1組': 'https://child-a/exec', '2年1組': 'https://child-b/exec' },
    entries: [['u3@x.ed.jp', '第一小学校', '']],
    ids: ['u3@x.ed.jp']
  });
  check('A21 宛先が決まらない児童は no_route を返す',
    !!res && res.skipped === true && res.reason === 'no_route' && res.dropped === 1, res);
  check('A22 no_route のときも子GASへは何も送らない', P.__sent.length === 0, P.__sent.length);
})();

// --- A-7b 子GASが 1 つだけならクラス不明児童はその子へ送る（確定仕様の維持） ---
(function () {
  const res = runProp({
    map: { '5年1組': 'https://child-a/exec' },
    entries: [['u4@x.ed.jp', '第一小学校', '']],
    ids: ['u4@x.ed.jp']
  });
  check('A22b 唯一の子GASは“クラス不明”の児童にだけフォールバックする',
    P.__sent.length === 1 && P.__sent[0].url === 'https://child-a/exec', P.__sent);
})();

// --- A-8 実装不変条件（将来の改修でフォールバック連鎖が復活しないように） ---
(function () {
  const body = extract(gasSrc, 'shardPropagatePolicy');
  check('A23 既知クラス未割当は unassignedCount を数えて continue する',
    /else if \(cls\) \{[\s\S]*?unassignedCount\+\+[\s\S]*?continue;/.test(body));
  check('A24 唯一の子GASフォールバックはクラス不明の分岐にだけ残る',
    /else \{[\s\S]*?emptyDef \|\| defUrl \|\| singleChildUrl/.test(body));
  // 予約同封ループは解決済み宛先（urlById）を再利用し、旧連鎖を再計算しない
  const loopStart = body.indexOf('entriesByUrl = {}');
  const loopEnd = body.indexOf('const schNowMs');
  const loopSrc = (loopStart >= 0 && loopEnd > loopStart) ? body.slice(loopStart, loopEnd) : '';
  check('A25 予約同封ループは解決済みの宛先を使う', /urlById\[sid0\]/.test(loopSrc), loopStart >= 0 && loopEnd > 0);
  check('A26 予約同封ループに旧フォールバック連鎖が残っていない',
    loopSrc.length > 0 && !/singleChildUrl/.test(loopSrc) && !/emptyDef/.test(loopSrc) && !/idx\[/.test(loopSrc));
})();

// ============================================================================
// B. 子側: shardEnsureDeviceRows の所有権ガード
//    shard_mode.js のハーネス（makeProps / makeSheet / gstate / headerMapOf）を流用。
// ============================================================================
function makeProps(init) {
  const store = Object.assign({}, init || {});
  return {
    getScriptProperties() {
      return {
        getProperty(k) { return (k in store) ? store[k] : null; },
        setProperty(k, v) { store[k] = String(v); }
      };
    }
  };
}
function makeCache() {
  const store = {};
  return {
    getScriptCache() {
      return {
        get(k) { return (k in store) ? store[k] : null; },
        put(k, v) { store[k] = String(v); },
        remove(k) { delete store[k]; }
      };
    }
  };
}
function makeSheet(cols, rows) {
  return {
    _cols: cols.slice(), _rows: rows.map(function (r) { return r.slice(); }),
    getLastColumn() { return this._cols.length; },
    getLastRow() { return this._rows.length; },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(function (r) { return r.slice(); }); } }; },
    getRange(r, c, nr, nc) {
      const self = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); }
          return out;
        },
        setValues(vals) { vals.forEach(function (rr, i) { rr.forEach(function (v, j) { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; }); }); return this; },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; }
      };
    },
    appendRow(row) { this._rows.push(row.slice()); }
  };
}

const touchLog = [];
const warnLog = [];
const gstate = { props: makeProps({}), cache: makeCache(), sheet: null, headerMap: null };

const C = {
  console: { log: function () {} },
  JSON: JSON, Date: Date, Math: Math, String: String, Number: Number,
  Array: Array, Object: Object, Boolean: Boolean, Set: Set, Map: Map, RegExp: RegExp, Error: Error,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  CONFIG: { DEVICE_COLUMNS: COLS, DEVICE_SHEET_NAME: '端末一覧', SHARD_MODE: false, SHARD_CHILD_MODE: true,
    SHARD_MAP: {}, SHARD_DEFAULT_URL: '', SHARD_SECRET: '', SPREADSHEET_ID: 'SS_TEST' },
  PropertiesService: { getScriptProperties() { return gstate.props.getScriptProperties(); } },
  CacheService: { getScriptCache() { return gstate.cache.getScriptCache(); } },
  UrlFetchApp: {
    fetch(url, opt) {
      return { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
    },
    fetchAll(reqs) {
      const arr = Array.isArray(reqs) ? reqs : [];
      return arr.map(function () {
        return { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
      });
    }
  },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  Utilities: {
    getUuid() { return 'uuid-test-0001'; },
    sleep() {},
    formatDate() { return '2026/01/01 00:00:00'; }
  },
  Logger: { log(m) { warnLog.push(String(m)); } },
  touchTeacherConsole(id) { touchLog.push({ type: 'touch', id: id }); return { success: true }; },
  releaseTeacherConsole(id) { touchLog.push({ type: 'release', id: id }); return { success: true }; },
  bulkUpdateScreenLock(ids, v) { touchLog.push({ type: 'lock', ids: (ids || []).slice(), v: v, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
  bulkUpdateBroadcastUrl(ids, u) { touchLog.push({ type: 'bc', ids: (ids || []).slice(), u: u, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
  bulkUpdateFilterMode(ids, m, w, b) { touchLog.push({ type: 'filter', ids: (ids || []).slice(), m: m, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
  getTargetSheet() { return gstate.sheet; },
  getHeaderMap() { return gstate.headerMap || {}; },
  getTeacherTargetClasses() { return []; },
  getAllDevices() { return []; },
  shardMergeDevices(base) { return Array.isArray(base) ? base.slice() : []; }
};

let cBundle = '';
cBundle += lineConst(gasSrc, 'SHARD_MAP_PROP') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_DEFAULT_PROP') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_SECRET_PROP') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_PARENT_PROP') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_LOOKUP_CACHE_PREFIX') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_CFG_CACHE') + '\n';
cBundle += lineConst(gasSrc, 'PROP_SHARD_MODE') + '\n';
cBundle += lineConst(gasSrc, 'PROP_SHARD_CHILD_MODE') + '\n';
cBundle += lineConst(gasSrc, 'PROP_SPREADSHEET_ID') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_MODE_CACHE') + '\n';
cBundle += lineConst(gasSrc, 'SHARD_SSID_CACHE') + '\n';
[
  'withWriteLock', 'cfgWarn', 'propRaw', 'propBool', 'propStr', 'shardModeFlags', 'shardWarnOnce',
  'shardMapDefaultFromEmptyKey', 'isShardParent', 'isShardChild', 'shardDetectChildByInbox_',
  'normalizeShardClass', 'readShardMapRaw', 'readShardDefaultUrl', 'getOrCreateShardSecret',
  'shardSecretMatches', 'shardConfigCached', 'invalidateShardConfig', 'shardMapIndexFromMap',
  'parseBoolean', 'normalizeIdKey', 'normalizeUserLocalPart_', 'idKeysMatch_',
  'resolveShardForHeartbeat', 'shardEnsureDeviceRows', 'shardApplyFromParent'
].forEach(function (n) { cBundle += extract(gasSrc, n) + '\n'; });
vm.createContext(C);
vm.runInContext(cBundle, C);

function setChild(extra) {
  const init = Object.assign({ SHARD_CHILD_MODE: 'true', SHARD_SECRET: 'sk_test12345678' }, extra || {});
  gstate.props = makeProps(init);
  gstate.cache = makeCache();
  gstate.headerMap = HMAP;
  C.invalidateShardConfig();
  touchLog.length = 0; warnLog.length = 0;
  C.CONFIG.SHARD_MODE = false; C.CONFIG.SHARD_CHILD_MODE = true;
}
function sheetWith(list) { gstate.sheet = makeSheet(COLS, [COLS.slice()].concat(list || [])); }
function idsOf(type) {
  for (let i = 0; i < touchLog.length; i++) if (touchLog[i].type === type) return touchLog[i].ids;
  return null;
}

console.log('===== B. 子側: 担当外クラスの「未登録児童」行を作らない =====');

// --- B-1 実機シナリオ: 担当外クラスのIDだけが届いた（class_map は空） ---
(function () {
  setChild(); sheetWith([]);
  const res = C.shardApplyFromParent({
    shard_secret: 'sk_test12345678',
    student_ids: ['test04-002@city-mimasaka.ed.jp'],
    class_map: {},
    patch: { screen_lock: true }
  });
  check('B1 指示自体は成功として返る（子の処理を壊さない）',
    !!res && res.success === true && res.applied === 1, res);
  check('B2 担当外の児童の行を作らない（未登録児童が復活しない）',
    gstate.sheet._rows.length === 1, { rows: gstate.sheet._rows.length - 1 });
  check('B3 ensure.created は 0',
    !!res && !!res.ensure && res.ensure.created === 0, res && res.ensure);
  check('B4 一括操作自体は呼ばれる（既存行があれば効く仕様を壊さない）',
    !!idsOf('lock'), touchLog.map(function (t) { return t.type; }));
  check('B5 作成しなかった事実をログに残す',
    warnLog.some(function (m) { return /担当外クラス/.test(m); }), warnLog.slice(-2));
})();

// --- B-2 担当児童は従来どおり行が作られる ---
(function () {
  setChild(); sheetWith([]);
  const created = C.shardEnsureDeviceRows(['n1@x.ed.jp', 'n2@x.ed.jp'], { 'n1@x.ed.jp': '5年1組' });
  check('B6 担当児童の行は作る', created === 1, created);
  check('B7 行数は担当児童ぶんだけ増える', gstate.sheet._rows.length === 2, { rows: gstate.sheet._rows.length - 1 });
  check('B8 class_map のクラス名がそのまま入る',
    gstate.sheet._rows[1][HMAP['クラス'] - 1] === '5年1組',
    gstate.sheet._rows[1][HMAP['クラス'] - 1]);
  check('B9 未登録児童の書式は従来のまま',
    /^未登録児童 \(n1@x\.ed\.jp\)$/.test(String(gstate.sheet._rows[1][HMAP['氏名'] - 1])),
    gstate.sheet._rows[1][HMAP['氏名'] - 1]);
  check('B10 担当外 n2 は同じ呼び出しでも作らない',
    gstate.sheet._rows.length === 2 &&
    gstate.sheet._rows.every(function (r, i) { return i === 0 || String(r[HMAP['児童ID'] - 1]) !== 'n2@x.ed.jp'; }),
    gstate.sheet._rows.slice(1).map(function (r) { return r[HMAP['児童ID'] - 1]; }));
})();

// --- B-3 確定仕様: 既存行あり＋class_map になし → 許可（コマンドは適用） ---
(function () {
  setChild(); sheetWith([rowOf('old@x.ed.jp', '3年1組')]);
  const before = gstate.sheet._rows.length;
  const res = C.shardApplyFromParent({
    shard_secret: 'sk_test12345678',
    student_ids: ['old@x.ed.jp'],
    class_map: {},
    patch: { screen_lock: true }
  });
  check('B11 既存行は class_map に無くても行数を変えない', gstate.sheet._rows.length === before,
    { before: before, after: gstate.sheet._rows.length });
  check('B12 既存行の児童にはコマンドが適用される（許可）',
    (idsOf('lock') || []).indexOf('old@x.ed.jp') >= 0, idsOf('lock'));
  check('B13 既存行は ensure.created に数えない',
    !!res && !!res.ensure && res.ensure.created === 0, res && res.ensure);
  check('B14 既存行の内容（クラス名）を書き換えない',
    gstate.sheet._rows[1][HMAP['クラス'] - 1] === '3年1組',
    gstate.sheet._rows[1][HMAP['クラス'] - 1]);
})();

// --- B-4 ID 表記ゆれ（全角・大文字小文字・空白）を吸収して担当判定する ---
(function () {
  setChild(); sheetWith([]);
  const created = C.shardEnsureDeviceRows(
    ['  1607002@City-Mimasaka.ED.jp '],
    { '１６０７００２＠city-mimasaka.ed.jp': '5年1組' }
  );
  check('B15 全角・大小文字・空白の揺れを吸収して担当と判定する', created === 1, created);
  check('B16 行の児童IDは受け取った表記のまま記録する',
    String(gstate.sheet._rows[1][HMAP['児童ID'] - 1]).trim() === '1607002@City-Mimasaka.ED.jp',
    gstate.sheet._rows[1][HMAP['児童ID'] - 1]);
})();

// --- B-5 一斉表示・URL規制でも同じガードが効く ---
(function () {
  setChild(); sheetWith([]);
  const res1 = C.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['x@y.ed.jp'], class_map: {},
    patch: { broadcast_url: 'https://example.com/live' }
  });
  check('B17 一斉表示でも担当外の行を作らない',
    gstate.sheet._rows.length === 1 && !!res1.ensure && res1.ensure.created === 0, res1.ensure);

  setChild(); sheetWith([]);
  const res2 = C.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['z@y.ed.jp'], class_map: {},
    patch: { filter_mode: 'BLACKLIST', whitelist_urls: '', blacklist_urls: 'x.jp' }
  });
  check('B18 URL規制でも担当外の行を作らない',
    gstate.sheet._rows.length === 1 && !!res2.ensure && res2.ensure.created === 0, res2.ensure);

  setChild(); sheetWith([]);
  const n = C.shardEnsureDeviceRows(['q@x.ed.jp'], null);
  check('B19 class_map が null でも行を作らない（担当不明は作らない）', n === 0, n);
})();

// --- B-6 ハートビート登録は変更しない（今回のスコープ外であることの固定） ---
(function () {
  setChild({ SHARD_CHILD_MODE: 'false', SHARD_MODE: 'true' });
  C.CONFIG.SHARD_MODE = true; C.CONFIG.SHARD_CHILD_MODE = false;
  gstate.props = makeProps({
    SHARD_MODE: 'true',
    SHARD_SECRET: 'sk_test12345678',
    SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' }),
    SHARD_DEFAULT_URL: 'https://def.example/exec'
  });
  gstate.cache = makeCache();
  C.invalidateShardConfig();

  const hb1 = C.resolveShardForHeartbeat('undeclared@x.ed.jp', '3年1組');
  check('B20 ハートビートは従来どおり既定URLへ割り当てる（変更なし）',
    !!hb1 && hb1.assigned_gas_url === 'https://def.example/exec', hb1);
  const hb2 = C.resolveShardForHeartbeat('1607002', '5年1組');
  check('B21 ハートビートのクラス一致解決も不変',
    !!hb2 && hb2.assigned_gas_url === 'https://child-a/exec' && hb2.assigned_class === '5-1', hb2);
  const hb3 = C.resolveShardForHeartbeat('1608001', '６年１組');
  check('B22 ハートビートの全角表記の吸収も不変',
    !!hb3 && hb3.assigned_gas_url === 'https://child-b/exec', hb3);
})();

// --- B-7 子側の実装不変条件 ---
(function () {
  const body = extract(gasSrc, 'shardEnsureDeviceRows');
  check('B23 所有権ガードが実装されている', /isOwnedByThisShard/.test(body));
  const iExisting = body.indexOf('existing[id]) continue');
  const iOwned = body.indexOf('isOwnedByThisShard(id)');
  check('B24 既存行の判定が所有権判定より前にある（既存行は許可）',
    iExisting >= 0 && iOwned > iExisting, { existing: iExisting, owned: iOwned });
  check('B25 担当外の作成スキップを数えている', /skippedOutOfScope\+\+/.test(body));
  check('B26 所有権キーは class_map から作る', /Object\.keys\(classMap\)/.test(body));
  check('B27 判定は ID 正規化（normalizeIdKey）を使う', /normalizeIdKey/.test(body));
  check('B28 ID 照合のゆれ吸収（idKeysMatch_）も併用する', /idKeysMatch_/.test(body));
})();

// ============================================================================
// C. 二重防御: 旧仕様の「漏れた指示」が届いても子は行を作らない
// ============================================================================
console.log('===== C. 二重防御（親が漏らしても子が作らない） =====');
(function () {
  setChild(); sheetWith([]);
  const res = C.shardApplyFromParent({
    shard_secret: 'sk_test12345678',
    student_ids: ['test04-002@city-mimasaka.ed.jp'],
    class_map: {},
    patch: { screen_lock: true }
  });
  check('C1 旧仕様相当の指示が届いても子は行を作らない（二重防御）',
    !!res && res.success === true && !!res.ensure && res.ensure.created === 0 &&
    gstate.sheet._rows.length === 1,
    { ensure: res && res.ensure, rows: gstate.sheet._rows.length - 1 });
  check('C2 不正な共有シークレットは従来どおり拒否する（ガードで認証を壊していない）',
    (function () {
      const bad = C.shardApplyFromParent({
        shard_secret: 'WRONG', student_ids: ['a@b.ed.jp'], class_map: {}, patch: { screen_lock: true }
      });
      return !!bad && bad.success === false;
    })(), true);
})();

console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
