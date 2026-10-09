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
// ===== Round 11 backend sim: 対象クラス権限境界 (getAllDevices / scopeStudentIdsForTeacher / isDeviceInTeacherScope) =====
const fs = require('fs');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); pass++; }
  else { console.log('FAIL', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); fail++; }
}

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
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); } return out; },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; }
      };
    },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._rows.push(row.slice()); },
    getSheetName() { return 'sheet'; }
  };
}

const DEVICE_COLUMNS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];
const TEACHER_COLUMNS = ['教員ID(メールアドレス)','パスワード','氏名','所属学校','権限','対象クラス','登録URL情報','個別ホワイトリスト','個別ブラックリスト','最終ログイン日時'];

function deviceRow(id, school, cls, lock, mode) {
  const r = new Array(DEVICE_COLUMNS.length).fill('');
  r[0]=id; r[1]=school; r[2]=id+' 名前'; r[3]=cls; r[4]=lock; r[5]=mode;
  return r;
}

const deviceSheet = makeSheet(DEVICE_COLUMNS, [
  DEVICE_COLUMNS,
  deviceRow('a1','英田小学校','英田小学校5年1組',false,'OFF'),
  deviceRow('a2','英田小学校','英田小学校5年1組',false,'OFF'),
  deviceRow('a3','英田小学校','英田小学校5年2組',false,'OFF'),
  deviceRow('a4','英田小学校','英田小学校6年1組',false,'OFF'),
  deviceRow('b1','大原小学校','大原小学校4年1組',false,'OFF'),
  deviceRow('u1','未設定','',false,'OFF'),
  deviceRow('u2','','',false,'OFF'),
]);
const teacherSheet = makeSheet(TEACHER_COLUMNS, [TEACHER_COLUMNS]);

const CONFIG = { DEVICE_SHEET_NAME:'端末一覧', TEACHER_SHEET_NAME:'教員マスタ', DEVICE_COLUMNS, TEACHER_COLUMNS,
  SCHOOL_LIST:['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校','第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校','勝田中学校','美作中学校','樸学園'], SPREADSHEET_ID:'SS' };

const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise,
  CONFIG,
  getTargetSheet(name){ return name === CONFIG.DEVICE_SHEET_NAME ? deviceSheet : teacherSheet; },
  Logger: { log(){} }
};

const names = ['getHeaderMap','normalizeSchoolName','schoolNamesMatch','resolveCanonicalSchool','getTeacherScopeInfo','isAllSchoolsName','normalizeClassName','getTeacherTargetClasses','isClassInTeacherScope','isDeviceInTeacherScope','isAdminTeacher','scopeStudentIdsForTeacher','getAllDevices','parseBoolean'];
let code = '';
code += 'const SCHOOL_ALIASES = ' + JSON.stringify({
  '第一小':'第一小学校','英田小':'英田小学校','大原小':'大原小学校','江見小':'江見小学校','勝田小':'勝田小学校','勝田東小':'勝田東小学校','北小':'北小学校','土居小':'土居小学校','英田中':'英田中学校','大原中':'大原中学校','作東中':'作東中学校','勝田中':'勝田中学校','美作中':'美作中学校'
}) + ';\n';
names.forEach(n => { code += extract(n) + '\n'; });
const vm = require('vm');
vm.createContext(ctx);
vm.runInContext(code, ctx);

const tNone = { email:'t.none@x.jp', school:'英田小学校', role:'TEACHER', target_class:'' };
const t1   = { email:'t.1@x.jp',    school:'英田小学校', role:'TEACHER', target_class:'英田小学校5年1組' };
const t12  = { email:'t.12@x.jp',   school:'英田小学校', role:'TEACHER', target_class:'英田小学校5年1組, 英田小学校5年2組' };
const admin = { email:'admin@x.jp', school:'全校管理', role:'ADMIN', target_class:'5年1組' };

const ids = (arr) => arr.map(d => d.student_id).sort().join(',');

console.log('===== isDeviceInTeacherScope（学校＋クラス境界） =====');
check('対象クラス=5年1組: 5年1組のみ true',
  ctx.isDeviceInTeacherScope('英田小学校','英田小学校5年1組'==='x'?null:t1,'英田小学校5年1組')===true &&
  ctx.isDeviceInTeacherScope('英田小学校',t1,'英田小学校5年2組')===false &&
  ctx.isDeviceInTeacherScope('英田小学校',t1,'英田小学校6年1組')===false, null);
check('対象クラス=5年1組: 未設定クラスは true（紐付け前）', ctx.isDeviceInTeacherScope('英田小学校',t1,'')===true && ctx.isDeviceInTeacherScope('英田小学校',t1,'未設定')===true);
check('対象クラス=5年1組: 他校は学校境界で false', ctx.isDeviceInTeacherScope('大原小学校',t1,'英田小学校5年1組')===false);
check('複数対象クラス: 5年1組・5年2組 true / 6年1組 false',
  ctx.isDeviceInTeacherScope('英田小学校',t12,'英田小学校5年1組')===true &&
  ctx.isDeviceInTeacherScope('英田小学校',t12,'英田小学校5年2組')===true &&
  ctx.isDeviceInTeacherScope('英田小学校',t12,'英田小学校6年1組')===false);
check('対象クラス未設定: 自校全クラス true / 他校 false',
  ctx.isDeviceInTeacherScope('英田小学校',tNone,'英田小学校6年1組')===true &&
  ctx.isDeviceInTeacherScope('大原小学校',tNone,'大原小学校4年1組')===false);
check('ADMIN: 対象クラス設定があっても全 true',
  ctx.isDeviceInTeacherScope('大原小学校',admin,'大原小学校4年1組')===true &&
  ctx.isDeviceInTeacherScope('英田小学校',admin,'英田小学校6年1組')===true);
check('表記ゆれ（全角数字）を吸収', ctx.isDeviceInTeacherScope('英田小学校',t1,'英田小学校５年１組')===true);

console.log('===== getAllDevices（一覧のクラス境界） =====');
check('対象クラス=5年1組: a1,a2,u1,u2 のみ返る',
  ids(ctx.getAllDevices('ALL', t1, false))==='a1,a2,u1,u2', ctx.getAllDevices('ALL',t1,false).map(d=>d.student_id));
check('複数対象クラス=5年1組+5年2組: a1,a2,a3,u1,u2',
  ids(ctx.getAllDevices('ALL', t12, false))==='a1,a2,a3,u1,u2', ctx.getAllDevices('ALL',t12,false).map(d=>d.student_id));
check('対象クラス未設定: 自校(a1..a4)+未設定(u1,u2)（他校b1は除外）',
  ids(ctx.getAllDevices('ALL', tNone, false))==='a1,a2,a3,a4,u1,u2', ctx.getAllDevices('ALL',tNone,false).map(d=>d.student_id));
check('ADMIN: 全校（b1含む）',
  ids(ctx.getAllDevices('ALL', admin, false))==='a1,a2,a3,a4,b1,u1,u2', ctx.getAllDevices('ALL',admin,false).map(d=>d.student_id));

console.log('===== scopeStudentIdsForTeacher（一括操作のクラス境界） =====');
const sc1 = ctx.scopeStudentIdsForTeacher(['a1','a2','a3','a4','b1'], t1);
check('対象クラス=5年1組: a1,a2 のみ許可 / a3,a4,b1 拒否', ids(sc1.ids.map(x=>({student_id:x})))==='a1,a2' && sc1.denied===3, sc1);
const sc12 = ctx.scopeStudentIdsForTeacher(['a1','a2','a3','a4'], t12);
check('複数対象クラス: a1,a2,a3 許可 / a4 拒否', ids(sc12.ids.map(x=>({student_id:x})))==='a1,a2,a3' && sc12.denied===1, sc12);
const scAll1 = ctx.scopeStudentIdsForTeacher('ALL', t1);
check("対象クラス=5年1組 の 'ALL' は自校+対象クラスに展開（a1,a2,u1,u2）", ids(scAll1.ids.map(x=>({student_id:x})))==='a1,a2,u1,u2', scAll1.ids);
const scAllNone = ctx.scopeStudentIdsForTeacher('ALL', tNone);
check("対象クラス未設定 の 'ALL' は自校(a1..a4)+未設定(u1,u2)", ids(scAllNone.ids.map(x=>({student_id:x})))==='a1,a2,a3,a4,u1,u2', scAllNone.ids);
const scAdmin = ctx.scopeStudentIdsForTeacher('ALL', admin);
check("ADMIN の 'ALL' はそのまま 'ALL'", scAdmin.ids==='ALL', scAdmin);
const scAdminIds = ctx.scopeStudentIdsForTeacher(['a1','b1'], admin);
check('ADMIN の ID 指定はフィルタされない', scAdminIds.ids.length===2 && scAdminIds.denied===0, scAdminIds);

console.log('===== ADMIN 判定（設定変更ゲートの前提） =====');
check('ADMIN/TEACHER 判定', ctx.isAdminTeacher(admin)===true && ctx.isAdminTeacher(t1)===false && ctx.isAdminTeacher(null)===false);
check('SUPERADMIN/SYSTEM_ADMIN も管理者扱い', ctx.isAdminTeacher({role:'superadmin'})===true && ctx.isAdminTeacher({role:' system_admin '})===true);

console.log('===== getTeacherTargetClasses の区切り・特殊値 =====');
check('カンマ/読点/スラッシュ/中黒区切り', ctx.getTeacherTargetClasses({role:'TEACHER',target_class:'A、B／C・D'}).length===4, ctx.getTeacherTargetClasses({role:'TEACHER',target_class:'A、B／C・D'}));
check('「全クラス」等は空配列（制限なし）', ctx.getTeacherTargetClasses({role:'TEACHER',target_class:'全クラス'}).length===0 && ctx.getTeacherTargetClasses({role:'TEACHER',target_class:'ALL'}).length===0);
check('ADMIN は常に空配列', ctx.getTeacherTargetClasses(admin).length===0);

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail ? 1 : 0);
