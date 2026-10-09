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
// ===== Round 11 frontend VM sim: 対象クラス権限境界 + ADMIN限定設定 =====
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, code = '';
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; code += m[1] + '\n'; }

code += `
// ---- テスト用データ（英田小 教員・対象クラス=5年1組） ----
devicesData = [
  { student_id:'a1', school_name:'英田小学校', class_name:'英田小学校5年1組', screen_lock:false, filter_mode:'OFF' },
  { student_id:'a2', school_name:'英田小学校', class_name:'英田小学校5年1組', screen_lock:false, filter_mode:'OFF' },
  { student_id:'a3', school_name:'英田小学校', class_name:'英田小学校5年2組', screen_lock:false, filter_mode:'OFF' },
  { student_id:'b1', school_name:'大原小学校', class_name:'大原小学校4年1組', screen_lock:false, filter_mode:'OFF' },
  { student_id:'u1', school_name:'未設定',     class_name:'',               screen_lock:false, filter_mode:'OFF' }
];
__setTeacher = (t) => { currentTeacher = t; };
__dev = (i) => devicesData[i];
__devAll = () => devicesData;
__scope = (dev) => isDeviceInScope(dev);
__targets = () => getTeacherTargetClasses();
__classScope = (c) => isClassInTeacherScope(c);
__classes = () => Array.from(collectRegisteredClasses()).sort();
__filtered = () => getFilteredDevices().map(d=>d.student_id);
__norm = (c) => normalizeClassName(c);
__isAdmin = () => isAdminUser();
`;

let alertCalls = [];
const classState = {};
function mkEl(id) {
  if (classState[id]) return classState[id];
  const set = new Set();
  const el = {
    id, value:'', checked:false, innerHTML:'', textContent:'', dataset:{},
    style:{ setProperty(){}, removeProperty(){} },
    classList:{
      add(c){ set.add(c); }, remove(c){ set.delete(c); },
      toggle(c, force){ if(force===undefined){ set.has(c)?set.delete(c):set.add(c); } else if(force){ set.add(c); } else { set.delete(c); } },
      contains(c){ return set.has(c); }
    },
    appendChild(){}, querySelectorAll(){return[];}, addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute(){return null;}
  };
  classState[id] = el;
  return el;
}
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseFloat, parseInt, Set, Map, URL, Promise,
  window:{ addEventListener(){}, removeEventListener(){}, location:{href:''} },
  setTimeout:(fn)=>{ if(typeof fn==='function') fn(); return 0; }, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  selectedStudentIds:new Set(),
  localStorage:{getItem(){return null;},setItem(){}},
  document:{ getElementById(id){ return mkEl(id); }, createElement(){ return mkEl('tmp'+Math.random()); }, querySelectorAll(){return[];} },
  alert(){}, confirm(){return true;}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// showAlertModal をスパイに差し替え（ADMINガードの検証用）
ctx.showAlertModal = function(title, message){ alertCalls.push({title, message}); };

let pass=0, fail=0;
function run(name, fn){ try{ const r=fn(); console.log('PASS', name, '=>', JSON.stringify(r)); pass++; }catch(e){ console.log('FAIL', name, ':', e.message); fail++; } }
function check(name, cond, extra){ if(cond){ console.log('PASS', name, extra!==undefined?'=> '+JSON.stringify(extra):''); pass++; } else { console.log('FAIL', name, extra!==undefined?'=> '+JSON.stringify(extra):''); fail++; } }

console.log('===== 対象クラス = 権限の境界 =====');
// 1) 対象クラス=5年1組 → 5年1組の児童のみ true
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組' });
run('対象クラス(5年1組)のみが true', ()=>({
  a1: ctx.__scope(ctx.__dev(0)), a2: ctx.__scope(ctx.__dev(1)),
  a3: ctx.__scope(ctx.__dev(2)), b1: ctx.__scope(ctx.__dev(3)), u1: ctx.__scope(ctx.__dev(4))
}));
check('対象クラス内 a1/a2 は表示', ctx.__scope(ctx.__dev(0))===true && ctx.__scope(ctx.__dev(1))===true);
check('他クラス a3 は除外', ctx.__scope(ctx.__dev(2))===false);
check('他校 b1 は除外', ctx.__scope(ctx.__dev(3))===false);
check('学校未設定 u1 は表示（紐付け前）', ctx.__scope(ctx.__dev(4))===true);

// 2) 複数クラス（カンマ区切り）
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組, 英田小学校5年2組' });
run('複数クラス選択で両方表示', ()=>({ targets: ctx.__targets(), a1: ctx.__scope(ctx.__dev(0)), a3: ctx.__scope(ctx.__dev(2)), b1: ctx.__scope(ctx.__dev(3)) }));
check('複数対象クラス: 5年1組+5年2組が true', ctx.__scope(ctx.__dev(0))===true && ctx.__scope(ctx.__dev(2))===true);
check('複数対象クラス: 他校 b1 は除外', ctx.__scope(ctx.__dev(3))===false);

// 3) 読点・スラッシュ・中黒区切り
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'5年1組、5年2組' });
check('読点区切りも複数クラスとして認識', ctx.__targets().length===2, ctx.__targets());

// 4) 表記ゆれ（全角スペース・前後空白）
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'  英田小学校5年1組  ' });
check('前後空白を吸収して一致', ctx.__classScope('英田小学校5年1組')===true);
check('全角数字を半角化して一致', ctx.__classScope('英田小学校5年１組')===true, ctx.__norm('英田小学校5年１組'));

// 5) 対象クラス未設定 → 制限なし
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'' });
check('対象クラス未設定: 自校の全クラス表示', ctx.__scope(ctx.__dev(0))===true && ctx.__scope(ctx.__dev(2))===true);
check('対象クラス未設定: 他校は除外', ctx.__scope(ctx.__dev(3))===false);

// 6) 「全クラス」設定 → 制限なし
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'全クラス' });
check('「全クラス」は制限なし扱い', ctx.__targets().length===0 && ctx.__scope(ctx.__dev(2))===true);

// 7) ADMIN → 常に制限なし（対象クラス設定があっても）
ctx.__setTeacher({ role:'ADMIN', school:'全校管理', target_class:'5年1組' });
check('ADMIN は対象クラス設定があっても制限なし', ctx.__scope(ctx.__dev(2))===true && ctx.__scope(ctx.__dev(3))===true, { targets: ctx.__targets() });

console.log('===== collectRegisteredClasses / getFilteredDevices のスコープ反映 =====');
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組' });
run('クラスチップはスコープ内クラスのみ', ()=>ctx.__classes());
check('登録クラスは 5年1組 のみ（他クラス/他校は出ない）', JSON.stringify(ctx.__classes())===JSON.stringify(['英田小学校5年1組']), ctx.__classes());
run('表示児童は対象クラスのみ', ()=>ctx.__filtered());
check('表示は a1/a2/u1（未設定は紐付け前のため表示）', ctx.__filtered().sort().join(',')==='a1,a2,u1', ctx.__filtered());

console.log('===== 教員設定モーダル（Round12: 全教員が開ける／対象クラスはADMINのみ） =====');
// 8) 非ADMIN: モーダルは開く。対象クラス欄は非表示＋無効。警告は出ない。対象クラス値は上書きされない。
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組' });
mkEl('settingTargetClass').value = 'ダミー初期値';
alertCalls = [];
ctx.openTeacherSettingsModal();
check('非ADMIN: 設定モーダルは開く（hidden が外れる）', mkEl('teacherSettingsModal').classList.contains('hidden')===false);
check('非ADMIN: 対象クラス欄は非表示', mkEl('settingTargetClassSection').classList.contains('hidden')===true);
check('非ADMIN: 対象クラス入力は無効化される', mkEl('settingTargetClass').disabled===true);
check('非ADMIN: 対象クラス欄は現在値に更新される（保存時は送らない）', mkEl('settingTargetClass').value==='英田小学校5年1組', { value: mkEl('settingTargetClass').value });
check('非ADMIN: 権限エラーの警告は表示されない', alertCalls.length===0, alertCalls);
check('非ADMIN: タイトルは「マイ設定」', /マイ設定/.test(mkEl('teacherSettingsTitle').textContent), mkEl('teacherSettingsTitle').textContent);

// 9) ADMIN: モーダルが開き、対象クラス欄が表示・編集可、対象クラスが反映
ctx.__setTeacher({ role:'ADMIN', school:'全校管理', target_class:'5年1組' });
alertCalls = [];
ctx.openTeacherSettingsModal();
check('ADMIN: 設定モーダルが開き対象クラスが反映される', mkEl('settingTargetClass').value==='5年1組', { value: mkEl('settingTargetClass').value });
check('ADMIN: 対象クラス欄が表示される', mkEl('settingTargetClassSection').classList.contains('hidden')===false);
check('ADMIN: 対象クラス入力は有効', mkEl('settingTargetClass').disabled===false);
check('ADMIN: 警告は表示されない', alertCalls.length===0);

console.log('===== 設定ボタンの表示制御（Round12: 全教員に表示・ラベル切替） =====');
// 10) 非ADMIN: 3ボタン表示 + ラベルは「URL・規制」
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'5年1組' });
ctx.updateHeaderTeacherInfo();
check('非ADMIN: 3つの設定ボタンが表示される',
  !mkEl('teacherSettingsBtn').classList.contains('hidden') &&
  !mkEl('quickUrlSettingsBtn').classList.contains('hidden') &&
  !mkEl('broadcastSettingsBtn').classList.contains('hidden'));
check('非ADMIN: 設定ボタンラベルは「URL・規制」', /URL・規制/.test(mkEl('teacherSettingsBtnLabel').textContent), mkEl('teacherSettingsBtnLabel').textContent);
// 11) ADMIN: 3ボタン表示 + ラベルは「クラス・URL」
ctx.__setTeacher({ role:'ADMIN', school:'全校管理', target_class:'全クラス' });
ctx.updateHeaderTeacherInfo();
check('ADMIN: 3つの設定ボタンが表示',
  !mkEl('teacherSettingsBtn').classList.contains('hidden') &&
  !mkEl('quickUrlSettingsBtn').classList.contains('hidden') &&
  !mkEl('broadcastSettingsBtn').classList.contains('hidden'));
check('ADMIN: 設定ボタンラベルは「クラス・URL」', /クラス・URL/.test(mkEl('teacherSettingsBtnLabel').textContent), mkEl('teacherSettingsBtnLabel').textContent);

console.log('===== ★担当チップ（ADMINのみ・冗長回避） =====');
ctx.__setTeacher({ role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組' });
ctx.renderClassChips();
let chipHtml = mkEl('classChipList').innerHTML;
check('非ADMIN: ★担当チップは表示されない', chipHtml.indexOf('★ 担当')===-1 && chipHtml.indexOf('setTeacherTargetClasses')===-1);
ctx.__setTeacher({ role:'ADMIN', school:'全校管理', target_class:'5年1組' });
ctx.renderClassChips();
chipHtml = mkEl('classChipList').innerHTML;
check('ADMIN: ★担当チップが表示される', chipHtml.indexOf('★ 担当')!==-1 && chipHtml.indexOf('setTeacherTargetClasses')!==-1);

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
