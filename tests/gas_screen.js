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
// ===== Round 14 backend sim: 画面一覧（スクリーンショット）＋ 読み取りキャッシュ（同時接続対策） =====
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

const DEVICE_COLUMNS = ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考','画面情報要求日時','画面情報更新日時'];
const SCREENSHOT_COLUMNS = ['児童ID','更新日時','MIMEタイプ','画像データ(Base64)'];
const TEACHER_COLUMNS = ['教員ID(メールアドレス)','パスワード','氏名','所属学校','権限','対象クラス','登録URL情報','個別ホワイトリスト','個別ブラックリスト','最終ログイン日時'];

function makeSheet(cols, rows){
  return { _cols: cols.slice(), _rows: rows.map(r=>r.slice()),
    getLastColumn(){return this._cols.length;}, getLastRow(){return this._rows.length;},
    getRange(r,c,nr,nc){ const self=this; if(nr===undefined)nr=1; if(nc===undefined)nc=1;
      return {
        getValues(){ const out=[]; for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push((self._rows[r-1+i]||[])[c-1+j]);out.push(row);} return out; },
        setValue(v){ if(!self._rows[r-1])self._rows[r-1]=[]; self._rows[r-1][c-1]=v; return this; },
        setValues(vals){ vals.forEach((rr,i)=>rr.forEach((v,j)=>{ if(!self._rows[r-1+i])self._rows[r-1+i]=[]; self._rows[r-1+i][c-1+j]=v; })); return this; },
        setBackground(){return this;}, setFontColor(){return this;}, setFontWeight(){return this;}
      };
    },
    getDataRange(){ const self=this; return { getValues(){ return self._rows.map(r=>r.slice()); } }; },
    appendRow(row){ this._rows.push(row.slice()); },
    insertSheet(){ return this; }, setFrozenRows(){}, getSheetName(){ return 'sheet'; }
  };
}

function devRow(id,school,cls){ const r=new Array(DEVICE_COLUMNS.length).fill(''); r[0]=id;r[1]=school;r[2]=id+' 名前';r[3]=cls;r[4]=false;r[5]='OFF';r[10]='https://example.com/'+id;r[11]='2026/01/01 00:00:00'; return r; }

const deviceSheet = makeSheet(DEVICE_COLUMNS, [DEVICE_COLUMNS,
  devRow('s1','英田小学校','英田小学校5年1組'),
  devRow('s2','英田小学校','英田小学校5年2組'),
  devRow('b1','大原小学校','大原小学校4年1組')
]);
const shotSheet = makeSheet(SCREENSHOT_COLUMNS, [SCREENSHOT_COLUMNS]);
const teacherSheet = makeSheet(TEACHER_COLUMNS, [TEACHER_COLUMNS]);

const CONFIG = { DEVICE_SHEET_NAME:'端末一覧', TEACHER_SHEET_NAME:'教員マスタ', ARCHIVE_SHEET_NAME:'卒業生',
  SCREENSHOT_SHEET_NAME:'画面情報', DEVICE_COLUMNS, SCREENSHOT_COLUMNS, TEACHER_COLUMNS,
  SCHOOL_LIST:['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校','第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校','勝田中学校','美作中学校','樸学園'] };

const cacheStore = {};
const ctx = { console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise, CONFIG,
  getTargetSheet(name){ return name===CONFIG.DEVICE_SHEET_NAME?deviceSheet:(name===CONFIG.SCREENSHOT_SHEET_NAME?shotSheet:teacherSheet); },
  Utilities:{ formatDate(){ return '2026/05/01 12:00:00'; } },
  LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
  Logger:{ log(){} },
  CacheService:{ getScriptCache(){ return { get(k){ return k in cacheStore?cacheStore[k]:null; }, put(k,v){ cacheStore[k]=v; } }; } }
};
let code = 'const SCHOOL_ALIASES = ' + JSON.stringify({ '英田小':'英田小学校','大原小':'大原小学校' }) + ';\n';
code += 'const SCREENSHOT_MAX_BYTES = 400000;\n';
['getHeaderMap','normalizeSchoolName','schoolNamesMatch','resolveCanonicalSchool','getTeacherScopeInfo','isAllSchoolsName','normalizeClassName','getTeacherTargetClasses','isClassInTeacherScope','isAdminTeacher','scopeStudentIdsForTeacher','withWriteLock','parseBoolean','getAllDevices','invalidateDevicesCache','requestScreenCapture','processScreenshotUpload','getScreenshots','getScreenStatus'].forEach(n=>{ code += extract(n)+'\n'; });
vm.createContext(ctx); vm.runInContext(code, ctx);

const admin = { email:'admin@x.jp', role:'ADMIN', school:'全校管理', target_class:'' };
const teacher = { email:'t1@x.jp', role:'TEACHER', school:'英田小学校', target_class:'' };

console.log('===== requestScreenCapture（押下時のみ要求を書き込む） =====');
const rq = ctx.requestScreenCapture(['s1','b1'], teacher);
check('スコープ内(s1)のみ要求される（他校b1は除外）', rq.requested===1 && rq.ids.join(',')==='s1', rq);
check('要求IDが発行される', /^sr_/.test(rq.request_id||''), rq.request_id);
const s1row = deviceSheet._rows.find(r=>r[0]==='s1');
check('画面情報要求日時 に「日時|要求ID」が書き込まれる', /2026\/05\/01 12:00:00\|sr_/.test(String(s1row[13]||'')), s1row[13]);
const b1row = deviceSheet._rows.find(r=>r[0]==='b1');
check('対象外の児童(b1)には要求が入らない', String(b1row[13]||'')==='', b1row[13]);
check('要求の書き込みでキャッシュが無効化される（dev_v が進む）', Number(cacheStore['dev_v']||0) >= 1, cacheStore['dev_v']);

console.log('===== processScreenshotUpload（画像を 画面情報 シートへ保存） =====');
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const up1 = ctx.processScreenshotUpload('s1', img, 'image/png');
check('アップロード成功', up1.success===true, up1);
check('画面情報シートに1行追加される', shotSheet._rows.length-1===1, shotSheet._rows.length-1);
check('児童ID・MIME・base64 が保存される', shotSheet._rows[1][0]==='s1' && shotSheet._rows[1][2]==='image/png' && String(shotSheet._rows[1][3]).indexOf('iVBORw0KGgo')===0, shotSheet._rows[1][2]);
check('端末一覧の 画面情報更新日時 が更新される', String(deviceSheet._rows.find(r=>r[0]==='s1')[14]||'').indexOf('2026/05/01')===0, deviceSheet._rows.find(r=>r[0]==='s1')[14]);

const up2 = ctx.processScreenshotUpload('s1', img, 'image/jpeg');
check('同一児童の再送は行を増やさず上書き（重複行を作らない）', shotSheet._rows.length-1===1, shotSheet._rows.length-1);
check('大きすぎる画像は拒否', ctx.processScreenshotUpload('s1', 'data:image/png;base64,'+'A'.repeat(400001), 'image/png').success===false);
check('不正な画像データは拒否', ctx.processScreenshotUpload('s1', 'not-an-image!!', 'image/png').success===false);

console.log('===== getScreenshots（画像付き一覧・スコープ適用） =====');
const all = ctx.getScreenshots('ALL', admin, false, 'all', null);
check('管理者は全児童を取得', all.length===3, all.map(d=>d.student_id));
const s1shot = all.find(d=>d.student_id==='s1');
check('取得済み児童は has_image=true', s1shot.has_image===true);
check('image_data_url が data:image で組み立てられる', /^data:image\/(png|jpeg);base64,/.test(s1shot.image_data_url), s1shot.image_data_url.slice(0,30));
const scoped = ctx.getScreenshots('ALL', teacher, false, 'all', ['s1','b1']);
check('一般教員＋ID指定はスコープ内(s1)のみ', scoped.length===1 && scoped[0].student_id==='s1', scoped.map(d=>d.student_id));
const readyOnly = ctx.getScreenshots('ALL', admin, false, 'ready', null);
check('status=ready は画像ありのみ', readyOnly.every(d=>d.has_image) && readyOnly.length===1, readyOnly.length);
const st = ctx.getScreenStatus('ALL', admin, false, null);
check('ステータス集計（ready/pending/none）', st.ready===1 && st.none===2, st);

console.log('===== 読み取りキャッシュ（同時接続時のシート読み取り削減） =====');
const first = ctx.getAllDevices('ALL', admin, false);
check('初回はシートから取得', first.length===3, first.length);
// シートを直接書き換えても、キャッシュ有効中は古い結果が返る（＝読み取り回数が減っている）
deviceSheet._rows.find(r=>r[0]==='s1')[2] = '変更後の名前';
const cached = ctx.getAllDevices('ALL', admin, false);
check('キャッシュ有効中は同一結果（シート再読込なし）', cached.find(d=>d.student_id==='s1').student_name==='s1 名前');
ctx.invalidateDevicesCache();
const fresh = ctx.getAllDevices('ALL', admin, false);
check('invalidate 後は最新を取得', fresh.find(d=>d.student_id==='s1').student_name==='変更後の名前');

console.log('===== 配線（doPost / api_* / withWriteLock） =====');
check('doPost に screenshot アップロード経路がある', /action === 'screenshot' \|\| action === 'upload_screenshot'/.test(src));
check('doPost に request_screens 経路がある', /action === 'request_screens'/.test(src));
check('doPost に get_screens 経路がある', /action === 'get_screens'/.test(src));
check('api_requestScreens / api_getScreens がある', /function api_requestScreens/.test(src) && /function api_getScreens/.test(src));
check('withWriteLock が invalidateDevicesCache を呼ぶ', /withWriteLock[\s\S]*?invalidateDevicesCache/.test(src));
check('画面情報シート名が CONFIG にある', /SCREENSHOT_SHEET_NAME/.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
