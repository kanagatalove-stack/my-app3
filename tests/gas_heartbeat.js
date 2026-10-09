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
  CONFIG: { DEVICE_COLUMNS, DEVICE_SHEET_NAME: '端末一覧' },
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
const vm = require('vm');
let code = '';
['getHeaderMap','withWriteLock','parseBoolean','parseUrlList','shouldWriteSyncTime','processHeartbeat'].forEach(n => { code += extract(n) + '\n'; });
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

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
