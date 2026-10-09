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
// ===== GAS backend adversarial simulation (multi-teacher concurrency) =====
// Code.gs は GAS 依存のため、検証に必要な関数だけを抽出しモック環境で評価する。
const fs = require('fs');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  // brace matching
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS', name, extra ? '=> ' + JSON.stringify(extra) : ''); pass++; }
  else { console.log('FAIL', name, extra ? '=> ' + JSON.stringify(extra) : ''); fail++; }
}

// ---- Mock LockService: serialize with a queue; detect overlap ----
let lockBusy = false;
let overlapDetected = false;
const LockService = {
  getScriptLock() {
    return {
      waitLock(ms) {
        if (lockBusy) { overlapDetected = true; }
        lockBusy = true;
      },
      releaseLock() { lockBusy = false; }
    };
  }
};

// ---- Mock Spreadsheet sheet (in-memory) ----
function makeSheet(cols, rows) {
  return {
    _cols: cols.slice(),
    _rows: rows.map(r => r.slice()),
    getLastColumn() { return this._cols.length; },
    getLastRow() { return this._rows.length + 1; },
    getRange(r, c, nr, nc) {
      const self = this;
      if (nr === undefined) nr = 1; if (nc === undefined) nc = 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]);
            out.push(row);
          }
          return out;
        },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; },
        setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; }
      };
    },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._rows.push(row.slice()); },
    setFrozenRows() {}, getSheetName() { return 'sheet'; }
  };
}

const DEVICE_COLUMNS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];
const TEACHER_COLUMNS = ['教員ID(メールアドレス)','パスワード','氏名','所属学校','権限','対象クラス','登録URL情報','個別ホワイトリスト','個別ブラックリスト','最終ログイン日時'];

function deviceRow(id, school, cls, lock, mode) {
  const r = new Array(DEVICE_COLUMNS.length).fill('');
  r[0]=id; r[1]=school; r[2]=id+' 名前'; r[3]=cls; r[4]=lock; r[5]=mode; r[6]='nhk.or.jp'; r[7]='youtube.com';
  return r;
}

let deviceSheet = makeSheet(DEVICE_COLUMNS, [
  DEVICE_COLUMNS,
  deviceRow('a1','英田小学校','5年1組',false,'OFF'),
  deviceRow('a2','英田小学校','5年1組',false,'OFF'),
  deviceRow('a3','英田小学校','5年2組',false,'OFF'),
  deviceRow('b1','大原小学校','4年1組',false,'OFF'),
]);
let teacherSheet = makeSheet(TEACHER_COLUMNS, [
  TEACHER_COLUMNS,
  ['t.aida@x.jp','pw','英田 教員','英田小学校','TEACHER','5年1組','[]','nhk.or.jp','youtube.com',''],
  ['t.aida2@x.jp','pw','英田 教員2','英田小学校','TEACHER','5年2組','[]','nhk.or.jp','youtube.com',''],
  ['admin@x.jp','pw','管理者','全校管理','ADMIN','全クラス','[]','nhk.or.jp','youtube.com',''],
]);

const CONFIG = { DEVICE_SHEET_NAME:'端末一覧', TEACHER_SHEET_NAME:'教員マスタ', DEVICE_COLUMNS, TEACHER_COLUMNS,
  SCHOOL_LIST:['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校','第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校','勝田中学校','美作中学校','樸学園'], SPREADSHEET_ID:'SS' };

const scope = {};
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise,
  CONFIG, LockService,
  getTargetSheet(name){ return name === CONFIG.DEVICE_SHEET_NAME ? deviceSheet : teacherSheet; },
  Utilities: { formatDate(){ return '2026/01/01 00:00:00'; }, base64EncodeWebSafe(){ return 'x'; }, computeHmacSha256Signature(){ return []; }, newBlob(){ return { getDataAsString(){ return '{}'; } }; }, base64DecodeWebSafe(){ return []; } },
  Logger: { log(){} }
};
// load needed functions
const names = ['getHeaderMap','normalizeSchoolName','schoolNamesMatch','resolveCanonicalSchool','resolveTeacherScopeSchoolName','getTeacherScopeInfo','isAllSchoolsName','normalizeClassName','getTeacherTargetClasses','isClassInTeacherScope','isDeviceInTeacherScope','isAdminTeacher','scopeStudentIdsForTeacher','withWriteLock','generateBroadcastId','bulkUpdateScreenLock','bulkUpdateBroadcastUrl','bulkUpdateFilterMode','updateSingleDevice','parseBoolean'];
let code = '';
// constants used by functions
code += 'const SCHOOL_ALIASES = ' + JSON.stringify({
  '第一小':'第一小学校','英田小':'英田小学校','大原小':'大原小学校','江見小':'江見小学校','勝田小':'勝田小学校','勝田東小':'勝田東小学校','北小':'北小学校','土居小':'土居小学校','英田中':'英田中学校','大原中':'大原中学校','作東中':'作東中学校','勝田中':'勝田中学校','美作中':'美作中学校'
}) + ';\n';
names.forEach(n => { code += extract(n) + '\n'; });
const vm = require('vm');
vm.createContext(ctx);
vm.runInContext(code, ctx);

const teacherA = { email:'t.aida@x.jp', school:'英田小学校', role:'TEACHER' };
const teacherB = { email:'t.aida2@x.jp', school:'英田小学校', role:'TEACHER' };
const admin = { email:'admin@x.jp', school:'全校管理', role:'ADMIN' };

console.log('===== 複数教員・同一学校・同時操作（いじわる検証） =====');
// 1) 教員A(5年1組)と教員B(5年2組)が同時にロック
const scopedA = ctx.scopeStudentIdsForTeacher(['a1','a2'], teacherA);
const scopedB = ctx.scopeStudentIdsForTeacher(['a3'], teacherB);
ctx.bulkUpdateScreenLock(scopedA.ids, true);
ctx.bulkUpdateScreenLock(scopedB.ids, true);
check('教員A/Bの同時ロックが両方反映される（取りこぼしなし）',
  deviceSheet._rows[1][4] === true && deviceSheet._rows[2][4] === true && deviceSheet._rows[3][4] === true,
  { a1: deviceSheet._rows[1][4], a2: deviceSheet._rows[2][4], a3: deviceSheet._rows[3][4] });

// 2) 教員Aが解除 → 5年1組だけ解除、5年2組(教員B)は維持
ctx.bulkUpdateScreenLock(scopedA.ids, false);
check('教員Aの解除が他クラス(教員B担当)に影響しない',
  deviceSheet._rows[1][4] === false && deviceSheet._rows[2][4] === false && deviceSheet._rows[3][4] === true,
  { a1: deviceSheet._rows[1][4], a3: deviceSheet._rows[3][4] });

// 3) 同時配信の broadcast_id 衝突しないこと（旧実装はミリ秒のみで衝突）
const ids = ctx.generateBroadcastId();
const id2 = ctx.generateBroadcastId();
check('同時に生成した broadcast_id が衝突しない', ids !== id2, { ids, id2 });

// 4) 同一ミリ秒で2教員が配信 → 別IDが付与される（児童端末が両方検知できる）
const realNow = Date.now;
Date.now = () => 1700000000000; // 時刻を固定して衝突を誘発
const bc1 = ctx.bulkUpdateBroadcastUrl(scopedA.ids, 'https://scratch.mit.edu', '');
const bc2 = ctx.bulkUpdateBroadcastUrl(scopedB.ids, 'https://nhk.or.jp', '');
Date.now = realNow;
check('同一時刻でも配信IDが別物になる（同時配信の取りこぼし防止）', bc1 !== bc2, { bc1, bc2 });
check('各クラスにそれぞれの配信URL/IDが設定される',
  deviceSheet._rows[1][8] === 'https://scratch.mit.edu' && deviceSheet._rows[1][9] === bc1 &&
  deviceSheet._rows[3][8] === 'https://nhk.or.jp' && deviceSheet._rows[3][9] === bc2,
  { a1Url: deviceSheet._rows[1][8], a3Url: deviceSheet._rows[3][8] });

// 5) 教員Aが他校(b1)の児童IDを混ぜても自校分のみ操作（スコープ外は拒否）
const scopedMix = ctx.scopeStudentIdsForTeacher(['a1','b1'], teacherA);
check('他校の児童IDを混ぜても自校分のみ許可', scopedMix.ids.length === 1 && scopedMix.ids[0] === 'a1' && scopedMix.denied === 1, scopedMix);

// 6) ロック直列化が機能（同時書き込みで重ならない）
lockBusy = false; overlapDetected = false;
// 疑似的に「ロック中に別の書き込みが来る」状況を再現: withWriteLock の中で再度 withWriteLock
ctx.withWriteLock(() => { ctx.withWriteLock(() => {}); });
check('書き込みロックが入れ子でも解放される（デッドロックしない）', lockBusy === false, { lockBusy });

// 7) 例外発生時もロックが解放される
lockBusy = false;
try { ctx.withWriteLock(() => { throw new Error('boom'); }); } catch (e) {}
check('書き込み中に例外が起きてもロックが解放される', lockBusy === false, { lockBusy });

// 8) 一括規制: 教員Aが5年1組のみ WHITELIST に → 他クラスは変化しない
ctx.bulkUpdateFilterMode(scopedA.ids, 'WHITELIST', 'nhk.or.jp', 'youtube.com');
check('一括規制が対象クラス限定で適用される',
  deviceSheet._rows[1][5] === 'WHITELIST' && deviceSheet._rows[2][5] === 'WHITELIST' && deviceSheet._rows[3][5] === 'OFF',
  { a1: deviceSheet._rows[1][5], a3: deviceSheet._rows[3][5] });

// 9) 管理者は全校を対象にできる（'ALL'）
const adminAll = ctx.scopeStudentIdsForTeacher('ALL', admin);
check('管理者の ALL は全校のまま', adminAll.ids === 'ALL', adminAll);

// 10) 一般教員の 'ALL' は自校のみに展開される
const tAll = ctx.scopeStudentIdsForTeacher('ALL', teacherA);
check('一般教員の ALL は自校のみに展開', Array.isArray(tAll.ids) && tAll.ids.sort().join(',') === 'a1,a2,a3', tAll);

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
