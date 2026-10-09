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
// ===== Round 13 frontend sim: CSV/Excel 解析 + ADMIN専用インポート/年次更新UI + 3タブ =====
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, code = '';
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; code += m[1] + '\n'; }
code += `\n__setTeacher=(t)=>{currentTeacher=t;};\n__parse=(f)=>parseImportFile(f);\n__hmap=(h)=>buildImportHeaderMap(h);\n__isAdmin=()=>isAdminUser();\n__setDevices=(a)=>{devicesData=a;};\n`;
const ctx = { console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseFloat, parseInt, Set, Map, URL, Promise,
  window:{ addEventListener(){}, removeEventListener(){}, location:{href:''} },
  setTimeout:(fn)=>{if(typeof fn==='function')fn();return 0;}, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  selectedStudentIds:new Set(), localStorage:{getItem(){return null;},setItem(){}},
  document:{ getElementById(id){ return mkEl(id); }, createElement(){ return mkEl('tmp'+Math.random()); }, querySelectorAll(){return[];} },
  alert(){}, confirm(){return true;} };
const classState={};
function mkEl(id){ if(classState[id])return classState[id]; const set=new Set();
  const el={ id, value:'', checked:false, innerHTML:'', textContent:'', dataset:{}, options:[], files:[], disabled:false, className:'',
    style:{setProperty(){},removeProperty(){}}, classList:{add(c){set.add(c);},remove(c){set.delete(c);},toggle(c,f){if(f===undefined){set.has(c)?set.delete(c):set.add(c);}else if(f){set.add(c);}else{set.delete(c);}},contains(c){return set.has(c);}},
    appendChild(){}, removeChild(){}, querySelectorAll(){return[];}, addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute(){return null;} };
  classState[id]=el; return el; }
vm.createContext(ctx); vm.runInContext(code, ctx);

let pass=0,fail=0;
function check(n,c,e){ if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;} else {console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;} }

console.log('===== CSV パーサ / ヘッダー正規化 =====');
(async () => {
  // CSV ファイル（File ライクなオブジェクト）
  const csvText = '児童ID,氏名,学校名,クラス\ns01@x.ed.jp,山田 太郎,英田小学校,英田小学校1年1組\ns02@x.ed.jp,佐藤 花子,大原小学校,大原小学校2年1組\n';
  const csvFile = { name:'students.csv', text: async () => csvText };
  const parsed = await ctx.__parse(csvFile);
  check('CSV: 2件を解析', parsed.rows.length===2, parsed.rows.length);
  check('CSV: ヘッダーから student_id/school_name/class_name を認識', parsed.headers.includes('student_id') && parsed.headers.includes('school_name') && parsed.headers.includes('class_name'), parsed.headers);
  check('CSV: 1行目の値が正しくマップされる', parsed.rows[0].student_id==='s01@x.ed.jp' && parsed.rows[0].school_name==='英田小学校' && parsed.rows[0].class_name==='英田小学校1年1組', parsed.rows[0]);

  // 別名ヘッダー（メール / 名前 / 学校 / 組）
  const csv2 = 'メール,名前,学校,組\na@b.ed.jp,テスト,江見小学校,江見小学校3年2組\n';
  const parsed2 = await ctx.__parse({ name:'alt.csv', text: async () => csv2 });
  check('CSV: 別名ヘッダー（メール/名前/学校/組）を吸収', parsed2.rows[0].student_id==='a@b.ed.jp' && parsed2.rows[0].student_name==='テスト' && parsed2.rows[0].class_name==='江見小学校3年2組', parsed2.rows[0]);

  // ダブルクォート内のカンマ
  const csv3 = '児童ID,氏名,学校名,クラス\nq1@x,"英田小, 太郎",陸田小学校,陸田小学校1年1組\n';
  const parsed3 = await ctx.__parse({ name:'q.csv', text: async () => csv3 });
  check('CSV: 引用符内のカンマを正しく処理', parsed3.rows[0].student_name==='英田小, 太郎' && parsed3.rows[0].school_name==='陸田小学校', parsed3.rows[0]);

  console.log('===== Excel(.xlsx) 解析（SheetJS 経由・XLSX をモック） =====');
  const xlsxMock = {
    read(){ return { SheetNames:['Sheet1'], Sheets:{ Sheet1:{} } }; },
    utils:{ sheet_to_json(){ return [
      ['児童ID','氏名','学校名','クラス'],
      ['e1@x.ed.jp','エクセル太郎','北小学校','北小学校4年1組']
    ]; } }
  };
  ctx.XLSX = xlsxMock; ctx.window.XLSX = xlsxMock;
  const parsedX = await ctx.__parse({ name:'students.xlsx', arrayBuffer: async () => new ArrayBuffer(0) });
  check('Excel: .xlsx を SheetJS で解析', parsedX.rows.length===1 && parsedX.rows[0].student_id==='e1@x.ed.jp', parsedX.rows[0]);

  console.log('===== ヘッダー別名マップ =====');
  const hm = ctx.__hmap(['児童ID','氏名','学校名','クラス']);
  check('ヘッダーマップ: 4列すべて認識', hm.student_id!==undefined && hm.student_name!==undefined && hm.school_name!==undefined && hm.class_name!==undefined, hm);
  const hm2 = ctx.__hmap(['教員ID','パスワード','氏名','所属学校','権限','対象クラス']);
  check('教員ヘッダー: email/password/role/target_class を認識', hm2.email!==undefined && hm2.password!==undefined && hm2.role!==undefined && hm2.target_class!==undefined, hm2);

  console.log('===== 3タブ切替（年次更新タブ） =====');
  ctx.__setTeacher({ role:'ADMIN', school:'全校管理' });
  ctx.switchAccountTab('annual');
  check('年次更新タブ選択で annualPane が表示', !mkEl('accountAnnualPane').classList.contains('hidden'));
  check('年次更新タブ選択で teachersPane は非表示', mkEl('accountTeachersPane').classList.contains('hidden'));
  ctx.switchAccountTab('students');
  check('児童タブ選択で studentsPane が表示', !mkEl('accountStudentsPane').classList.contains('hidden'));

  console.log('===== 年次更新 UI のプレビュー（年齢/学年で抽出） =====');
  ctx.__setDevices([
    { student_id:'g1', school_name:'英田小学校', class_name:'英田小学校6年1組', student_name:'六年A' },
    { student_id:'g2', school_name:'英田小学校', class_name:'英田小学校6年2組', student_name:'六年B' },
    { student_id:'y1', school_name:'英田小学校', class_name:'英田小学校5年1組', student_name:'五年C' }
  ]);
  mkEl('annualSchool').value = '英田小学校';
  mkEl('annualGrade').value = '6';
  ctx.previewAnnualRollover();
  const boxHtml = mkEl('annualPreviewBox').innerHTML;
  check('プレビュー: 6年2件を抽出と表示', /対象: 2 件/.test(boxHtml) && /六年A/.test(boxHtml) && /六年B/.test(boxHtml) && !/五年C/.test(boxHtml), boxHtml.slice(0,80));

  console.log('===== HTML マークアップ確認 =====');
  check('SheetJS CDN を読み込む', /xlsx@0\.18\.5/.test(html));
  check('児童インポートのファイル入力がある', /id="studentImportFile"[^>]*accept="\.xlsx,\.xls,\.csv"/.test(html));
  check('教員インポートのファイル入力がある', /id="teacherImportFile"[^>]*accept="\.xlsx,\.xls,\.csv"/.test(html));
  check('年次更新タブボタンがある', /id="tabAnnualBtn"/.test(html));
  check('年次更新実行ボタンがある', /id="annualRunBtn"[^>]*onclick="runAnnualRolloverSubmit\(\)"/.test(html));
  check('卒業生アーカイブ読み込みボタンがある', /onclick="loadArchivedStudents\(\)"/.test(html));

  console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
  process.exit(fail?1:0);
})();
