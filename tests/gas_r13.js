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
// ===== Round 13 backend sim: importStudents / importTeachers / runAnnualRollover (ADMIN only) =====
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
function extract(name){
  const re = new RegExp('^function '+name+'\\s*\\(','m');
  const start = src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){ if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;} else {console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;} }

const DEVICE_COLUMNS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'];
const TEACHER_COLUMNS = ['教員ID(メールアドレス)','パスワード','氏名','所属学校','権限','対象クラス','登録URL情報','個別ホワイトリスト','個別ブラックリスト','最終ログイン日時'];

function makeSheet(cols, rows){
  return { _cols: cols.slice(), _rows: rows.map(r=>r.slice()),
    getLastColumn(){return this._cols.length;}, getLastRow(){return this._rows.length;},
    getRange(r,c,nr,nc){ const self=this; if(nr===undefined)nr=1; if(nc===undefined)nc=1;
      return {
        getValues(){ const out=[]; for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push((self._rows[r-1+i]||[])[c-1+j]);out.push(row);} return out; },
        setValue(v){ if(!self._rows[r-1])self._rows[r-1]=[]; self._rows[r-1][c-1]=v; return this; },
        setValues(vals){ vals.forEach((rr,i)=>rr.forEach((v,j)=>{ if(!self._rows[r-1+i])self._rows[r-1+i]=[]; self._rows[r-1+i][c-1+j]=v; })); return this; },
        clearContent(){ for(let i=0;i<nr;i++){ if(self._rows[r-1+i]) self._rows[r-1+i]=new Array(self._cols.length).fill(''); } return this; }
      };
    },
    getDataRange(){ const self=this; return { getValues(){ return self._rows.map(r=>r.slice()); } }; },
    appendRow(row){ this._rows.push(row.slice()); },
    deleteRow(r){ this._rows.splice(r-1,1); }
  };
}

function devRow(id,school,cls){ const r=new Array(DEVICE_COLUMNS.length).fill(''); r[0]=id;r[1]=school;r[2]=id+' 名前';r[3]=cls;r[4]=false;r[5]='OFF'; return r; }
const deviceSheet = makeSheet(DEVICE_COLUMNS, [DEVICE_COLUMNS, devRow('s1','英田小学校','英田小学校6年1組'), devRow('s2','英田小学校','英田小学校6年2組'), devRow('s3','英田小学校','英田小学校5年1組'), devRow('m1','英田中学校','英田中学校3年1組'), devRow('m2','英田中学校','英田中学校2年1組')]);
const teacherSheet = makeSheet(TEACHER_COLUMNS, [TEACHER_COLUMNS, ['t1@x.jp','p1','教員1','英田小学校','TEACHER','','','','','']]);
const archiveSheet = makeSheet(DEVICE_COLUMNS, [DEVICE_COLUMNS]);

const CONFIG = { DEVICE_SHEET_NAME:'端末一覧', TEACHER_SHEET_NAME:'教員マスタ', ARCHIVE_SHEET_NAME:'卒業生', DEVICE_COLUMNS, TEACHER_COLUMNS,
  SCHOOL_LIST:['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校','第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校','勝田中学校','美作中学校','樸学園'] };

const ctx = { console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise, CONFIG,
  getTargetSheet(name){ return name===CONFIG.DEVICE_SHEET_NAME?deviceSheet:(name===CONFIG.TEACHER_SHEET_NAME?teacherSheet:archiveSheet); },
  Utilities:{ formatDate(){ return '2026/04/01 00:00:00'; } },
  LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
  Logger:{ log(){} }, SCHOOL_ALIASES: { '英田小':'英田小学校','英田中':'英田中学校' } };
vm.createContext(ctx);
let code = 'const SCHOOL_ALIASES = ' + JSON.stringify(ctx.SCHOOL_ALIASES) + ';\n';
['getHeaderMap','isAdminTeacher','normalizeSchoolName','schoolNamesMatch','resolveCanonicalSchool','withWriteLock','normalizeDigits','importStudents','importTeachers','runAnnualRollover','getArchivedStudents'].forEach(n=>{ code += extract(n)+'\n'; });
vm.runInContext(code, ctx);

const admin = { email:'admin@x.jp', role:'ADMIN', school:'全校管理' };
const teacher = { email:'t1@x.jp', role:'TEACHER', school:'英田小学校' };

console.log('===== 児童インポート: ADMINのみ / 権限ゲート =====');
let threw=false; try{ ctx.importStudents(teacher,{rows:[{student_id:'x'}]}); }catch(e){ threw=/管理者のみ/.test(e.message); }
check('TEACHER は児童インポート不可（管理者のみ）', threw);

console.log('===== 児童インポート: merge(追加＋更新) =====');
let r = ctx.importStudents(admin, { mode:'merge', rows:[
  { student_id:'new1', school_name:'大原小学校', student_name:'新入生A', class_name:'大原小学校1年1組' },
  { student_id:'s1', school_name:'英田小学校', student_name:'更新太郎', class_name:'英田小学校6年1組' }
]});
check('新規1件を追加', r.added===1, r);
check('既存1件を更新', r.updated===1, r);
check('新規行がシートに追記された', deviceSheet._rows.some(row=>row[0]==='new1'));
check('既存児童の氏名が更新された', deviceSheet._rows.find(row=>row[0]==='s1')[2]==='更新太郎');
check('新規行の規制モードはOFF', deviceSheet._rows.find(row=>row[0]==='new1')[5]==='OFF');

console.log('===== 児童インポート: add(新規のみ) =====');
r = ctx.importStudents(admin, { mode:'add', rows:[
  { student_id:'new1', school_name:'大原小学校', student_name:'重複', class_name:'X' },
  { student_id:'new2', school_name:'江見小学校', student_name:'新2', class_name:'江見小学校2年1組' }
]});
check('既存 new1 はスキップ', r.skipped===1 && r.updated===0, r);
check('新規 new2 は追加', r.added===1, r);

console.log('===== 児童インポート: 空IDはスキップ＋エラー収集 =====');
r = ctx.importStudents(admin, { mode:'merge', rows:[ { student_id:'', student_name:'x' }, { student_id:'ok1', school_name:'北小学校', student_name:'OK', class_name:'北小学校3年1組' } ]});
check('空IDはスキップされエラーに記録', r.skipped===1 && r.errors.length===1 && r.added===1, r);

console.log('===== 教員インポート: ADMINのみ / merge =====');
threw=false; try{ ctx.importTeachers(teacher,{rows:[{email:'a@b.jp'}]}); }catch(e){ threw=/管理者のみ/.test(e.message); }
check('TEACHER は教員インポート不可', threw);
r = ctx.importTeachers(admin, { mode:'merge', rows:[
  { email:'t1@x.jp', password:'', name:'教員1更新', school:'英田小学校', role:'TEACHER', target_class:'5年1組' },
  { email:'t2@x.jp', password:'p2', name:'教員2', school:'大原小学校', role:'TEACHER' }
]});
check('教員: 既存1件更新・新規1件追加', r.updated===1 && r.added===1, r);
check('教員: 空パスワードは既存を変更しない', teacherSheet._rows.find(row=>row[0]==='t1@x.jp')[1]==='p1');
check('教員: 対象クラスが更新される', teacherSheet._rows.find(row=>row[0]==='t1@x.jp')[5]==='5年1組');
check('教員: 権限不正値はTEACHERに矯正', (function(){ ctx.importTeachers(admin,{mode:'merge',rows:[{email:'t3@x.jp',password:'p',name:'x',role:'HACKER'}]}); return teacherSheet._rows.find(row=>row[0]==='t3@x.jp')[4]==='TEACHER'; })());

console.log('===== 年次更新: ADMINのみ / 卒業生を卒業生シートへ退避し削除 =====');
threw=false; try{ ctx.runAnnualRollover(teacher,{}); }catch(e){ threw=/管理者のみ/.test(e.message); }
check('TEACHER は年次更新不可', threw);

const beforeDevices = deviceSheet._rows.length - 1;
let ar = ctx.runAnnualRollover(admin, { school_name:'英田小学校', graduation_grade:'6' });
check('英田小の6年（s1,s2）だけ卒業処理', ar.graduated===2, ar);
check('端末一覧から卒業生が削除された', !deviceSheet._rows.some(row=>row[0]==='s1') && !deviceSheet._rows.some(row=>row[0]==='s2'));
check('卒業生シートへ退避された', archiveSheet._rows.some(row=>row[0]==='s1') && archiveSheet._rows.some(row=>row[0]==='s2'));
check('5年生(s3)は残る', deviceSheet._rows.some(row=>row[0]==='s3'));
check('卒業生一覧APIで取得できる', ctx.getArchivedStudents(admin).length===2);

console.log('===== 年次更新: 中学校の卒業学年(3) =====');
ar = ctx.runAnnualRollover(admin, { school_name:'英田中学校', graduation_grade:'3' });
check('英田中の3年(m1)のみ卒業', ar.graduated===1 && !deviceSheet._rows.some(row=>row[0]==='m1'), ar);
check('英田中の2年(m2)は残る', deviceSheet._rows.some(row=>row[0]==='m2'));

console.log('===== 年次更新: 学校のみ指定（学年なし）で全児童対象 =====');
ar = ctx.runAnnualRollover(admin, { school_name:'英田中学校' });
check('学校のみ指定でその学校の残り全児童が卒業', ar.graduated===1 && !deviceSheet._rows.some(row=>row[0]==='m2'), ar);

console.log('===== 卒業生アーカイブ: TEACHERは閲覧不可 =====');
threw=false; try{ ctx.getArchivedStudents(teacher); }catch(e){ threw=/管理者のみ/.test(e.message); }
check('TEACHER は卒業生一覧を閲覧不可', threw);

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
