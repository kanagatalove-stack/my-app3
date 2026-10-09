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
// ===== Round 11 adversarial: 権限境界の脱出防止 + frontend/backend 一致 =====
const fs = require('fs'), vm = require('vm');

// ---- backend: Code.gs から必要関数を抽出 ----
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  return src.slice(start, end + 1);
}
const be = { console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise };
be.CONFIG = { SCHOOL_LIST: ['英田小学校','大原小学校','江見小学校','勝田小学校','勝田東小学校','第一小学校','北小学校','土居小学校','英田中学校','大原中学校','作東中学校','勝田中学校','美作中学校','樸学園'] };
be.SCHOOL_ALIASES = { '第一小':'第一小学校','英田小':'英田小学校','大原小':'大原小学校','江見小':'江見小学校','勝田小':'勝田小学校','勝田東小':'勝田東小学校','北小':'北小学校','土居小':'土居小学校','英田中':'英田中学校','大原中':'大原中学校','作東中':'作東中学校','勝田中':'勝田中学校','美作中':'美作中学校' };
let beCode = 'const SCHOOL_ALIASES = ' + JSON.stringify(be.SCHOOL_ALIASES) + ';\n';
['normalizeSchoolName','schoolNamesMatch','resolveCanonicalSchool','getTeacherScopeInfo','isAllSchoolsName','normalizeClassName','getTeacherTargetClasses','isClassInTeacherScope','isDeviceInTeacherScope','isAdminTeacher'].forEach(n => { beCode += extract(n) + '\n'; });
vm.createContext(be); vm.runInContext(beCode, be);

// ---- frontend: index.html から ----
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re2 = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, feCode = '';
while ((m = re2.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; feCode += m[1] + '\n'; }
feCode += `
__setTeacher = (t) => { currentTeacher = t; };
__scope = (school, cls) => isDeviceInScope({ school_name: school, class_name: cls });
`;
const feStore = {};
function mkEl(){ const set=new Set(); return { value:'', checked:false, innerHTML:'', textContent:'', dataset:{}, style:{setProperty(){},removeProperty(){}}, classList:{add(c){set.add(c);},remove(c){set.delete(c);},toggle(c,f){},contains(c){return set.has(c);}}, appendChild(){}, querySelectorAll(){return[];}, addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute(){return null;} }; }
const fe = { console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseFloat, parseInt, Set, Map, URL, Promise,
  window:{addEventListener(){},removeEventListener(){},location:{href:''}}, setTimeout:(fn)=>{if(typeof fn==='function')fn();return 0;}, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  selectedStudentIds:new Set(), localStorage:{getItem(){return null;},setItem(){}}, document:{getElementById(id){return feStore[id]||(feStore[id]=mkEl());},createElement(){return mkEl();},querySelectorAll(){return[];}}, alert(){}, confirm(){return true;} };
vm.createContext(fe); vm.runInContext(feCode, fe);

let pass=0, fail=0;
function check(name, cond, extra){ if(cond){console.log('PASS',name,extra!==undefined?'=> '+JSON.stringify(extra):'');pass++;} else {console.log('FAIL',name,extra!==undefined?'=> '+JSON.stringify(extra):'');fail++;} }

console.log('===== 権限境界の脱出防止 =====');
// 1) 対象クラスに他校のクラスを指定しても、学校境界が先に効いて他校は見えない
const evil = { email:'evil@x.jp', school:'英田小学校', role:'TEACHER', target_class:'大原小学校4年1組' };
fe.__setTeacher(evil);
check('対象クラスに他校クラスを指定しても他校は不可視',
  be.isDeviceInTeacherScope('大原小学校', evil, '大原小学校4年1組')===false &&
  fe.__scope('大原小学校','大原小学校4年1組')===false);
check('対象クラスに他校クラスを指定しても自校の対象外クラスは不可視',
  be.isDeviceInTeacherScope('英田小学校', evil, '英田小学校5年1組')===false &&
  fe.__scope('英田小学校','英田小学校5年1組')===false);

// 2) 非ADMIN が対象クラス空にしても他校は見えない
const nosc = { email:'n@x.jp', school:'英田小学校', role:'TEACHER', target_class:'' };
fe.__setTeacher(nosc);
check('対象クラス未設定でも他校は不可視',
  be.isDeviceInTeacherScope('大原小学校', nosc, '大原小学校4年1組')===false &&
  fe.__scope('大原小学校','大原小学校4年1組')===false);

console.log('===== frontend/backend 判定の一致（全パターン） =====');
const teachers = [
  { email:'a', school:'英田小学校', role:'TEACHER', target_class:'' },
  { email:'b', school:'英田小学校', role:'TEACHER', target_class:'英田小学校5年1組' },
  { email:'c', school:'英田小学校', role:'TEACHER', target_class:'英田小学校5年1組, 英田小学校5年2組' },
  { email:'d', school:'英田小学校', role:'TEACHER', target_class:'全クラス' },
  { email:'e', school:'英田小学校', role:'TEACHER', target_class:'大原小学校4年1組' },
  { email:'f', school:'全校管理', role:'ADMIN', target_class:'英田小学校5年1組' },
];
const devices = [
  ['英田小学校','英田小学校5年1組'], ['英田小学校','英田小学校5年2組'], ['英田小学校','英田小学校6年1組'],
  ['大原小学校','大原小学校4年1組'], ['未設定',''], ['','']
];
let mismatch = [];
teachers.forEach(t => {
  be.__t = t; fe.__setTeacher(t);
  devices.forEach(([s,c]) => {
    const b = be.isDeviceInTeacherScope(s, t, c);
    const f = fe.__scope(s, c);
    if (b !== f) mismatch.push({ t:t.email, s, c, backend:b, frontend:f });
  });
});
check('frontend と backend の判定が完全一致（境界の食い違い無し）', mismatch.length===0, mismatch);

console.log('===== 一般教員が対象クラスを書き換えて権限拡大できないこと（Round12: sanitize で target_class を除外） =====');
// バックエンドは「対象クラスは ADMIN のみ反映」する sanitize ヘルパーを通す。
// doPost / api_* の両経路が sanitizeTeacherSettingsForSave を呼び、生の settings を直接 saveTeacherSettings に渡さない。
const hasSanitize = /^function sanitizeTeacherSettingsForSave\s*\(/m.test(src);
check('sanitizeTeacherSettingsForSave が存在する', hasSanitize);
const hasGateDoPost = /action === 'save_teacher_settings'[\s\S]{0,300}?sanitizeTeacherSettingsForSave\(/.test(src);
const hasGateApi = /function api_saveTeacherSettings[\s\S]{0,500}?sanitizeTeacherSettingsForSave\(/.test(src);
check('doPost save_teacher_settings は sanitize を経由する', hasGateDoPost);
check('api_saveTeacherSettings は sanitize を経由する', hasGateApi);
// sanitize 本体が「ADMIN 以外には target_class を渡さない」ことを実際に検証する
const sanitizeFn = extract('sanitizeTeacherSettingsForSave');
const isAdminFn = extract('isAdminTeacher');
const sctx = { console, JSON, String, Object, Array, RegExp, Error };
vm.createContext(sctx); vm.runInContext(isAdminFn + '\n' + sanitizeFn + '\n__isAdmin=isAdminTeacher; __san= sanitizeTeacherSettingsForSave;', sctx);
const teacherIn = { target_class:'大原小学校4年1組', filter_whitelist:'a.com', filter_blacklist:'b.com', urls:[{title:'x',address:'y'}] };
const outT = sctx.__san(teacherIn, { role:'TEACHER', school:'英田小学校' });
check('一般教員: target_class は出力に含まれない（権限拡大不可）', outT.target_class === undefined && !('target_class' in outT));
check('一般教員: マイURL・規制URLは保存される', JSON.stringify(outT.urls)===JSON.stringify(teacherIn.urls) && outT.filter_whitelist==='a.com' && outT.filter_blacklist==='b.com');
const outA = sctx.__san(teacherIn, { role:'ADMIN', school:'全校管理' });
check('管理者: target_class は反映される', outA.target_class==='大原小学校4年1組');
// saveTeacherSettings 関数自体は bulk_filter の自動保存で使うためガードしない（存在することを確認）
check('saveTeacherSettings 関数自体は存在（bulk_filter の自動保存用に維持）', /^function saveTeacherSettings\s*\(/m.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
