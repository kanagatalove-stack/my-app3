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
    getLastColumn() { return this._cols.length; }, getLastRow() { return this._rows.length + 1; },
    getRange(r, c, nr, nc) { const self = this; if (nr === undefined) nr = 1; if (nc === undefined) nc = 1;
      return { getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); } return out; },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues(vals) { vals.forEach((rowArr, i) => rowArr.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; } }; },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._rows.push(row.slice()); }
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
  Logger: { log(){} }
};
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
  // 学校名の解決に必要なヘルパー群（processHeartbeat が school_name を検証するため）
  'normalizeSchoolName','resolveCanonicalSchool','canonicalizeIncomingSchool','processHeartbeat'
].forEach(n => { code += extract(n) + '\n'; });
code += extractConst('SCHOOL_ALIASES') + '\n';
vm.createContext(ctx);
vm.runInContext(code, ctx);

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

// 6) 学校名を送らない端末（旧バージョン）でも壊れない
const rD = ctx.processHeartbeat('kidD@school.ed.jp', 'https://e/1');
check('学校名が未指定でも従来どおり未設定で登録（後方互換）',
  findRow('kidD@school.ed.jp')[SCHOOL_COL] === '未設定', { row: findRow('kidD@school.ed.jp')[SCHOOL_COL] });

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
