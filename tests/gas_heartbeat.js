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
// Focused test: processHeartbeat must not create duplicate rows for the same student
const fs = require('fs');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  return src.slice(start, end + 1);
}
const DEVICE_COLUMNS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];
function makeSheet(cols, rows) {
  return {
    _cols: cols.slice(), _rows: rows.map(r => r.slice()),
    _writes: 0, _wroteAt: [], // 書き込み回数と、書き込んだ行番号（事故検証用）
    getLastColumn() { return this._cols.length; },
    getLastRow() { return this._rows.length; },
    getRange(r, c, nr, nc) { const self = this; this._rangeReads = (this._rangeReads || 0) + 1;
      if (nr === undefined) nr = 1; if (nc === undefined) nc = 1;
      return { getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); } return out; },
        setValue(v) { self._writes++; self._wroteAt.push(r); if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues(vals) { self._writes++; self._wroteAt.push(r); vals.forEach((rowArr, i) => rowArr.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; } }; },
    _dataReads: 0,
    getDataRange() { const self = this; this._dataReads = (this._dataReads || 0) + 1;
      return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._writes++; this._wroteAt.push(this._rows.length + 1); this._rows.push(row.slice()); }
  };
}
const sheet = makeSheet(DEVICE_COLUMNS, [DEVICE_COLUMNS]);
let lockDepth = 0, maxLockDepth = 0;
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error,
  CONFIG: {
    DEVICE_COLUMNS, DEVICE_SHEET_NAME: '端末一覧',
    SCHOOL_LIST: ['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校',
      '第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校',
      '勝田中学校','美作中学校','樸学園']
  },
  LockService: { getScriptLock() { return { waitLock() { lockDepth++; if (lockDepth > maxLockDepth) maxLockDepth = lockDepth; }, releaseLock() { lockDepth--; } }; } },
  getTargetSheet() { return sheet; },
  Utilities: { formatDate() { return '2026/01/01 00:00:00'; } },
  CacheService: (function () {
    const store = {};
    return { getScriptCache() { return {
      get(k) { return k in store ? store[k] : null; },
      put(k, v) { store[k] = v; }
    }; } };
  })(),
  Logger: { log(msg) { logLines.push(String(msg)); } }
};
const logLines = [];
// const 宣言（SCHOOL_ALIASES 等）は extract() が関数専用のため、専用に切り出す
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found const: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 2) + ';';
}
const vm = require('vm');
let code = '';
[
  'getHeaderMap','withWriteLock','parseBoolean','parseUrlList','shouldWriteSyncTime',
  // 児童IDの照合を正規化する（processHeartbeat / hbRegisterDevice が無条件に呼ぶ）
  'normalizeIdKey',
  // 学校名の解決に必要なヘルパー群（processHeartbeat が school_name を検証するため）
  'normalizeSchoolName','resolveCanonicalSchool','canonicalizeIncomingSchool',
  // ---- 行解決（行番号キャッシュは廃止。毎回シートから引き直す） ----
  'hbLog','hbResolveRowByStudentId',
  //  §2 応答組み立て・AI監視・新規登録（processHeartbeat から切り出した関数）
  'buildHeartbeatResponse','hbApplyMonitor','hbRegisterDevice',
  //  §3 本体
  'processHeartbeat'
].forEach(n => { code += extract(n) + '\n'; });
code += extractConst('SCHOOL_ALIASES') + '\n';
// 実測ログの定数（本番と同じ値をそのまま使う。テスト側で再宣言すると const 重複になる）
function extractLineConst(name) {
  const m = src.match(new RegExp('^const ' + name + '\\s*=[^;]*;', 'm'));
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}
code += extractLineConst('HB_DEBUG_LOG') + '\n';
code += extractLineConst('HB_LOG_PREFIX') + '\n';
vm.createContext(ctx);
vm.runInContext(code, ctx);
// 書き込み版（dev_v）の参照・更新をテストから行えるようにする。
// withWriteLock の invalidateDevicesCache と同じく、教員の書き込み＝版が進む を再現する。
vm.runInContext(
  '__devVer=function(){return String((CacheService.getScriptCache().get("dev_v")||"0"));};' +
  '__bumpDevVer=function(){var c=CacheService.getScriptCache();' +
  'var v=Number(c.get("dev_v")||"0");c.put("dev_v",String(v+1));};',
  ctx);

let pass = 0, fail = 0;
function check(n, c, e) { if (c) { console.log('PASS', n, e ? '=> ' + JSON.stringify(e) : ''); pass++; } else { console.log('FAIL', n, e ? '=> ' + JSON.stringify(e) : ''); fail++; } }

console.log('===== 児童の新規自動登録の重複防止（同時/連続アクセス） =====');
const r1 = ctx.processHeartbeat('newkid@school.ed.jp', 'https://example.com/1');
const rowsAfter1 = sheet._rows.length - 1;
const r2 = ctx.processHeartbeat('newkid@school.ed.jp', 'https://example.com/2');
const rowsAfter2 = sheet._rows.length - 1;
const r3 = ctx.processHeartbeat('newkid@school.ed.jp', 'https://example.com/3');
const rowsAfter3 = sheet._rows.length - 1;

check('1回目のアクセスで1行だけ登録される', rowsAfter1 === 1, { rows: rowsAfter1 });
check('同一児童の2回目のアクセスで重複行が作られない', rowsAfter2 === 1, { rows: rowsAfter2 });
check('3回目も重複しない', rowsAfter3 === 1, { rows: rowsAfter3 });
check('新規登録は書き込みロック内で実行される（入れ子なし）', maxLockDepth === 1, { maxLockDepth });
check('2回目以降は既存レコードを返す（氏名が保持される）', r2.student_name === r1.student_name && r2.student_name.includes('newkid'), { r1: r1.student_name, r2: r2.student_name });
check('2回目以降も現在URL/最終同期が更新される', sheet._rows[1][10] === 'https://example.com/3', { currentUrl: sheet._rows[1][10] });

// 既存児童（登録済み）は新規登録しない
const before = sheet._rows.length;
ctx.processHeartbeat('newkid@school.ed.jp', 'https://example.com/4');
check('登録済み児童は新規行を追加しない', sheet._rows.length === before, { before, after: sheet._rows.length });

// ============================================================
console.log('\n===== 学校名の自動反映（管理ポリシーの school_name） =====');
// シートの学校名列（DEVICE_COLUMNS の 2 列目）を引く
const SCHOOL_COL = DEVICE_COLUMNS.indexOf('学校名');
function findRow(id) {
  for (let i = 1; i < sheet._rows.length; i++) {
    if (String(sheet._rows[i][0] || '').trim() === id) return sheet._rows[i];
  }
  return null;
}

// 1) 新規登録時に端末の学校名がシートへ入る
const rA = ctx.processHeartbeat('kidA@school.ed.jp', 'https://e/1', '英田小学校');
check('新規登録時に端末の学校名がシートへ入る',
  findRow('kidA@school.ed.jp')[SCHOOL_COL] === '英田小学校',
  { row: findRow('kidA@school.ed.jp')[SCHOOL_COL] });
check('応答にも学校名が入る（端末側の表示用）', rA.school_name === '英田小学校', { school_name: rA.school_name });

// 2) 表記ゆれは正式名称へ寄せる
const rB = ctx.processHeartbeat('kidB@school.ed.jp', 'https://e/1', '美作市立大原小学校');
check('表記ゆれ（美作市立〜）を正式名称へ正規化',
  findRow('kidB@school.ed.jp')[SCHOOL_COL] === '大原小学校', { row: findRow('kidB@school.ed.jp')[SCHOOL_COL] });
check('略称（大原小）も正式名称へ解決', rB.school_name === '大原小学校', { school_name: rB.school_name });

// 3) 未知の学校名は書き込まない（学校スコープの詐称を防ぐ）
const rC = ctx.processHeartbeat('kidC@school.ed.jp', 'https://e/1', '存在しない学校');
check('未知の学校名は未設定のまま（スコープ詐称を防ぐ）',
  findRow('kidC@school.ed.jp')[SCHOOL_COL] === '未設定',
  { row: findRow('kidC@school.ed.jp')[SCHOOL_COL] });

// 4) 既存行の「未設定」は補完し、行は増やさない
const rowsBeforeFix = sheet._rows.length;
ctx.processHeartbeat('kidC@school.ed.jp', 'https://e/2', '第一小学校');
check('既存行の未設定は端末の学校名で補完される',
  findRow('kidC@school.ed.jp')[SCHOOL_COL] === '第一小学校',
  { row: findRow('kidC@school.ed.jp')[SCHOOL_COL] });
check('補完時に新しい行を増やさない', sheet._rows.length === rowsBeforeFix, { rows: sheet._rows.length });

// 5) 手動で設定済みの学校名は上書きしない（管理者の設定を優先）
ctx.processHeartbeat('kidA@school.ed.jp', 'https://e/3', '大原小学校');
check('手動設定済みの学校名は上書きしない',
  findRow('kidA@school.ed.jp')[SCHOOL_COL] === '英田小学校',
  { row: findRow('kidA@school.ed.jp')[SCHOOL_COL] });

// 6) 曖昧な入力は「一致なし」にする（学校スコープの詐称防止）
//    resolveCanonicalSchool の部分一致は「学校」「小」等を先頭校に寄せてしまうため、
//    認証不要の heartbeat では完全一致＋明示エイリアスのみを受け付ける。
const ambiguous = ['小学校', '中学校', '小', '学校', '県', '校'];
const leaked = [];
for (let i = 0; i < ambiguous.length; i++) {
  const got = ctx.canonicalizeIncomingSchool(ambiguous[i]);
  if (got) leaked.push({ input: ambiguous[i], resolvedTo: got });
}
check('曖昧な学校名（「小学校」「小」等）は解決しない', leaked.length === 0, { leaked });

// 7) 正式名称・明示エイリアス・接頭辞つきは解決する
check('正式名称はそのまま解決', ctx.canonicalizeIncomingSchool('英田小学校') === '英田小学校',
  { got: ctx.canonicalizeIncomingSchool('英田小学校') });
check('明示エイリアス（英田小）は解決', ctx.canonicalizeIncomingSchool('英田小') === '英田小学校',
  { got: ctx.canonicalizeIncomingSchool('英田小') });
check('接頭辞つき（美作市立〜）は解決', ctx.canonicalizeIncomingSchool('美作市立第一小学校') === '第一小学校',
  { got: ctx.canonicalizeIncomingSchool('美作市立第一小学校') });

// 8) 学校名を送らない端末（旧バージョン）でも壊れない
const rD = ctx.processHeartbeat('kidD@school.ed.jp', 'https://e/1');
check('学校名が未指定でも従来どおり未設定で登録（後方互換）',
  findRow('kidD@school.ed.jp')[SCHOOL_COL] === '未設定', { row: findRow('kidD@school.ed.jp')[SCHOOL_COL] });

// ============================================================
console.log('\n===== 行番号の解決（行番号キャッシュの廃止） =====');
// 実機事故の再現:
//   シート上で行を整理（削除・挿入）すると、旧実装は最大6時間キャッシュした
//   行番号を信じ続け、2行目の児童のハートビートを3行目の空行へ書き込んだ。
//   A〜D列が空のまま K列/L列 だけが更新され、getLastRow() が 3 になった。
//   行番号を毎回引き直すことで、この事故が起きないことを確認する。

const HV = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト',
  '規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];

// (a) 解決関数そのもの: 正しい行番号と、残骸行（児童IDが空）の位置を返す
const shA = makeSheet(HV, [
  HV,
  ['1607002@city-mimasaka.ed.jp','第一小学校','本名 太郎','5年1組',false,'OFF','','','','','','',''],
  ['','','','','','','','','','','','',''],           // 3行目: 事故で残った空の行
  ['1607003@city-mimasaka.ed.jp','第一小学校','別 児童','5年2組',false,'OFF','','','','','','','']
]);
const hmA = ctx.getHeaderMap(shA);
const rA2 = ctx.hbResolveRowByStudentId(shA, hmA, '1607002@city-mimasaka.ed.jp');
check('解決関数は児童の実在行（2行目）を返す', rA2.rowNum === 2, { rowNum: rA2.rowNum });
check('解決関数は空行（残骸）の位置も返す（3行目）', rA2.orphanRowNum === 3, { orphan: rA2.orphanRowNum });
const rA3 = ctx.hbResolveRowByStudentId(shA, hmA, '1607003@city-mimasaka.ed.jp');
check('空行を挟んでも後続の児童は正しい行（4行目）を返す', rA3.rowNum === 4, { rowNum: rA3.rowNum });
check('大文字・空白の揺れでも同じ行に解決する',
  ctx.hbResolveRowByStudentId(shA, hmA, '  1607002@CITY-MIMASAKA.ed.jp  ').rowNum === 2);
check('存在しない児童は -1（新規登録へ回す）',
  ctx.hbResolveRowByStudentId(shA, hmA, 'nobody@x.ed.jp').rowNum === -1);

// (b) 事故の再現と修正確認: シート上で行を削除しても、次の同期は正しい行へ書く
const shB = makeSheet(HV, [
  HV,
  ['other@x.ed.jp','第一小学校','他の 児童','6年1組',false,'OFF','','','','','','',''],
  ['1607002@city-mimasaka.ed.jp','第一小学校','本名 太郎','5年1組',false,'OFF','','','','','','','']
]);
ctx.getTargetSheet = function () { return shB; };
ctx.processHeartbeat('1607002@city-mimasaka.ed.jp', 'https://a.example/');
check('初回は児童の実在行（3行目）へ書き込む',
  shB._wroteAt.length > 0 && shB._wroteAt[shB._wroteAt.length - 1] === 3, { wroteAt: shB._wroteAt });

// ここでシートを整理する（1つ上の児童の行が削除され、対象児童が2行目へ移動）。
// 旧実装はキャッシュした r=3 を信じ続けたため、この後も3行目へ書き続けた。
shB._rows.splice(1, 1);
shB._wroteAt.length = 0;
ctx.processHeartbeat('1607002@city-mimasaka.ed.jp', 'https://b.example/');
check('行が削除されても、次の同期は新しい正しい行（2行目）へ書く',
  shB._wroteAt.length > 0 && shB._wroteAt[shB._wroteAt.length - 1] === 2, { wroteAt: shB._wroteAt });
check('移動後の行に現在URLが入る（別行を汚さない）',
  shB._rows[1][10] === 'https://b.example/', { url: shB._rows[1][10] });
check('行の削除で総行数が水増しされない', shB._rows.length === 2, { rows: shB._rows.length });

// (c) 残骸行（児童IDが空）は新規行を増やさず再利用する
const shC = makeSheet(HV, [
  HV,
  ['1607002@city-mimasaka.ed.jp','第一小学校','本名 太郎','5年1組',false,'OFF','','','','','','',''],
  ['','','','','','','','','','','https://old/','2026/10/29 11:02:48',''] // 事故の残骸
]);
ctx.getTargetSheet = function () { return shC; };
const rNew = ctx.processHeartbeat('NEWKID@city-mimasaka.ed.jp', 'https://n.example/');
check('残骸行があれば新規行を追加しない（総行数が増えない）',
  shC._rows.length === 3, { rows: shC._rows.length });
check('残骸行が新しい児童の行として書き直される',
  String(shC._rows[2][0]).toUpperCase() === 'NEWKID@CITY-MIMASAKA.ED.JP',
  { a: shC._rows[2][0] });
check('残骸行のA〜D列が埋まる（空欄の行を残さない）',
  !!shC._rows[2][0] && !!shC._rows[2][1] && !!shC._rows[2][2] && !!shC._rows[2][3],
  { a: shC._rows[2][0], b: shC._rows[2][1], c: shC._rows[2][2], d: shC._rows[2][3] });
check('再利用した行でも応答は正常', rNew && rNew.student_id === 'NEWKID@city-mimasaka.ed.jp',
  { id: rNew && rNew.student_id });

// (d) 実測ログ: どの行に書いたかが実行ログから分かる
//    hbLog は '[HB] ' を前置するので、前置きを含めて判定する（ログの実物と同じ形）。
const hbLines = logLines.filter(function (l) { return l.indexOf('[HB]') === 0; });
function hbHas(kind, needle) {
  return hbLines.some(function (l) {
    const body = l.replace(/^\[HB\]\s*/, '');
    return body.indexOf(kind + ':') === 0 && (!needle || body.indexOf(needle) >= 0);
  });
}
check('実測ログ hbLog が出力される（HB_DEBUG_LOG=true）', hbLines.length > 0, { lines: hbLines.length });
check('解決ログに一致した行番号が出る（実測用）', hbHas('resolve', 'row=2'),
  hbLines.filter(function (l) { return l.indexOf('resolve:') >= 0; }).slice(0, 3));
check('書き込みログに書き込み先の行番号が出る（実測用）', hbHas('heartbeat', 'row='),
  hbLines.filter(function (l) { return l.indexOf('heartbeat:') >= 0; }).slice(0, 3));
check('新規登録ログに探索結果（再確認・残骸行）が出る（実測用）', hbHas('register'),
  hbLines.filter(function (l) { return l.indexOf('register:') >= 0; }).slice(0, 3));

// 読み取りは増えるが、書き込みは必要なときだけ（毎回書かない）
//   1回目は『最終同期日時』が空なので syncDue=true ＝ 書き込むのが正しい挙動。
//   2回目（同一URL・20秒以内）は「URL変化なし・同期時刻の間引き中」＝書かない。
const shD = makeSheet(HV, [
  HV,
  ['1607002x@city-mimasaka.ed.jp','第一小学校','本名 太郎','5年1組',false,'OFF','','','','','https://same/','','']
]);
ctx.getTargetSheet = function () { return shD; };
ctx.processHeartbeat('1607002x@city-mimasaka.ed.jp', 'https://same/'); // 1回目（ウォームアップ）
const wBefore = shD._writes;
const readsBeforeIdle = shD._dataReads;
const rIdle = ctx.processHeartbeat('1607002x@city-mimasaka.ed.jp', 'https://same/');
check('20秒以内の同一URLは書き込まない（無駄な書き込みをしない）',
  shD._writes === wBefore, { before: wBefore, after: shD._writes });
check('書き込まない場合でも行の特定は毎回行う（キャッシュに頼らない）',
  shD._dataReads > readsBeforeIdle, { before: readsBeforeIdle, after: shD._dataReads });
check('その場合も応答は正しい（ロック/規制/URL）',
  rIdle.student_id === '1607002x@city-mimasaka.ed.jp' &&
  rIdle.current_url === 'https://same/' &&
  rIdle.school_name === '第一小学校',
  { id: rIdle.student_id, url: rIdle.current_url, school: rIdle.school_name });

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
