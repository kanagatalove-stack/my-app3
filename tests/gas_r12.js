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
// ===== Round 12 backend sim: sanitizeTeacherSettingsForSave（TEACHERは対象クラス不可・URLは可） =====
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

const ctx = { console, JSON, String, Object, Array, RegExp, Error };
vm.createContext(ctx);
vm.runInContext(extract('isAdminTeacher')+'\n'+extract('sanitizeTeacherSettingsForSave')+'\n__san=sanitizeTeacherSettingsForSave; __isAdmin=isAdminTeacher;', ctx);

const teacher = { role:'TEACHER', school:'英田小学校' };
const admin = { role:'ADMIN', school:'全校管理' };
const incoming = { target_class:'大原小学校4年1組', filter_whitelist:'nhk.or.jp, scratch.mit.edu', filter_blacklist:'youtube.com', urls:[{title:'学習',address:'https://scratch.mit.edu'}] };

console.log('===== 一般教員(TEACHER) =====');
const t = ctx.__san(incoming, teacher);
check('target_class は出力に含まれない', t.target_class===undefined && !('target_class' in t));
check('filter_whitelist は保存対象', t.filter_whitelist==='nhk.or.jp, scratch.mit.edu');
check('filter_blacklist は保存対象', t.filter_blacklist==='youtube.com');
check('urls（マイURL）は保存対象', JSON.stringify(t.urls)===JSON.stringify(incoming.urls));

console.log('===== 管理者(ADMIN) =====');
const a = ctx.__san(incoming, admin);
check('target_class は反映される', a.target_class==='大原小学校4年1組');
check('URL・規制リストも反映される', a.filter_whitelist===incoming.filter_whitelist && JSON.stringify(a.urls)===JSON.stringify(incoming.urls));

console.log('===== エッジケース =====');
const empty = ctx.__san({}, teacher);
check('空入力でもクラッシュしない（undefined のまま＝部分更新で維持）', empty.target_class===undefined && empty.urls===undefined);
const nullIn = ctx.__san(null, teacher);
check('null 入力でもクラッシュしない', typeof nullIn==='object');
const aNull = ctx.__san(null, admin);
check('null 入力 + ADMIN でもクラッシュしない', typeof aNull==='object');
// target_class を明示的に空文字で渡しても、TEACHER には出ない（上書き不可）
const clear = ctx.__san({ target_class:'' }, teacher);
check('TEACHER が target_class を空にしても除外される', !('target_class' in clear));
// ADMIN が空文字を渡した場合は反映（解除可能）
const aClear = ctx.__san({ target_class:'' }, admin);
check('ADMIN が空文字を渡すと反映（解除可能）', aClear.target_class==='');

console.log('===== 経路の確認（doPost / api_* が sanitize を通す） =====');
check('doPost の save_teacher_settings が sanitize を経由', /action === 'save_teacher_settings'[\s\S]{0,300}?sanitizeTeacherSettingsForSave\(/.test(src));
check('api_saveTeacherSettings が sanitize を経由', /function api_saveTeacherSettings[\s\S]{0,500}?sanitizeTeacherSettingsForSave\(/.test(src));
check('生 settings を直接 saveTeacherSettings に渡していない', !/saveTeacherSettings\(currentTeacher\.email,\s*(payload\.settings|settings)\s*\|\|/.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
