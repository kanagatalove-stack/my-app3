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
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, code = '';
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; code += m[1] + '\n'; }

code += `
currentTeacher = { role:'TEACHER', school:'英田小学校', target_class:'英田小学校5年1組' };
devicesData = [
  { student_id:'s1', school_name:'英田小学校', class_name:'英田小学校5年1組', screen_lock:true,  filter_mode:'WHITELIST' },
  { student_id:'s2', school_name:'英田小学校', class_name:'英田小学校5年1組', screen_lock:false, filter_mode:'OFF' },
  { student_id:'s3', school_name:'英田小学校', class_name:'英田小学校5年2組', screen_lock:true,  filter_mode:'OFF' },
  { student_id:'s4', school_name:'英田小学校', class_name:'英田小学校5年2組', screen_lock:false, filter_mode:'BLACKLIST' },
  { student_id:'s5', school_name:'大原小学校', class_name:'大原小学校4年1組', screen_lock:true,  filter_mode:'WHITELIST' },
  { student_id:'s6', school_name:'未設定',     class_name:'', screen_lock:false, filter_mode:'OFF' }
];
__classes = (op, name) => { if(op==='clear') return selectedClasses.clear(); if(op==='add') return selectedClasses.add(name); if(op==='del') return selectedClasses.delete(name); return Array.from(selectedClasses); };
__students = (op, id) => { if(op==='clear') return selectedStudentIds.clear(); if(op==='add') return selectedStudentIds.add(id); return Array.from(selectedStudentIds); };
__filtered = () => getFilteredDevices().map(d=>d.student_id);
// 競合対策の内部状態
__setSeq = (v) => { loadSeq = v; };
__getSeq = () => loadSeq;
__setSuppress = (v) => { refreshSuppressedUntil = v; };
// apiRequest を差し替え可能にする（テスト用に保留 Promise を返す）
__setApi = (fn) => { apiRequest = fn; };
__devices = () => devicesData.map(d => d.student_id);
`;

const store = {};
function mkEl() { return { value:'', checked:false, innerHTML:'', textContent:'', dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, style:{setProperty(){},removeProperty(){}}, appendChild(){}, querySelectorAll(){return[];}, addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute(){return null;} }; }
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseFloat, parseInt, Set, Map, URL, Promise,
  window:{ addEventListener(){}, removeEventListener(){}, location:{href:''} },
  setTimeout:(fn)=>{ if(typeof fn==='function') fn(); return 0; }, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  selectedStudentIds:new Set(),
  localStorage:{getItem(){return null;},setItem(){}},
  document:{ getElementById(id){ return store[id]||(store[id]=mkEl()); }, createElement(){ return mkEl(); }, querySelectorAll(){return[];} },
  alert(){}, confirm(){return true;}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass=0, fail=0;
function run(name, fn){ try{ const r=fn(); console.log('PASS', name, '=>', JSON.stringify(r)); pass++; }catch(e){ console.log('FAIL', name, ':', e.message); fail++; } }
function runAsync(name, fn){ return fn().then(r=>{ console.log('PASS', name, '=>', JSON.stringify(r)); pass++; }).catch(e=>{ console.log('FAIL', name, ':', e.message); fail++; }); }

console.log('===== クラス選択チェックボックス UI =====');
run('buildClassChip: チェックボックスがクラス名の上にある', ()=>{
  const h = ctx.buildClassChip('英田小学校5年1組');
  const iTop = h.indexOf('class-chip-top');
  const iMain = h.indexOf('class-chip-main');
  const iCheckbox = h.indexOf('type="checkbox"');
  const mainBlock = h.slice(iMain);
  const nameInMain = mainBlock.indexOf('英田小学校5年1組');
  return { hasCheckbox:iCheckbox!==-1, topBeforeMain:iTop!==-1 && iMain!==-1 && iTop<iMain, nameInMainBlock:nameInMain!==-1, usesSetClassSelected:h.includes("setClassSelected(") };
});
run('未選択時: チェックボックスはOFF', ()=>{ ctx.__classes('clear'); const h=ctx.buildClassChip('英田小学校5年1組'); return { unchecked: !/checked/.test(h) }; });
run('選択時: チェックボックスはON + is-selected', ()=>{ ctx.__classes('clear'); ctx.__classes('add','英田小学校5年1組'); const h=ctx.buildClassChip('英田小学校5年1組'); ctx.__classes('clear'); return { checked:/\schecked/.test(h), isSelected:h.includes('is-selected') }; });
run('setClassSelected(true) で選択に追加', ()=>{ ctx.__classes('clear'); ctx.setClassSelected('英田小学校5年1組', true); return { sel: ctx.__classes('list'), filtered: ctx.__filtered() }; });
run('setClassSelected(false) で選択から除外', ()=>{ ctx.setClassSelected('英田小学校5年1組', false); return { sel: ctx.__classes('list') }; });
run('複数クラス選択 => 両クラスの児童のみ表示', ()=>{ ctx.__classes('clear'); ctx.setClassSelected('英田小学校5年1組', true); ctx.setClassSelected('英田小学校5年2組', true); const r={ sel:ctx.__classes('list'), filtered:ctx.__filtered() }; ctx.__classes('clear'); return r; });
run('renderClassChips: ★担当 はチェックボックス付き', ()=>{ ctx.__classes('clear'); ctx.renderClassChips(); const h=store['classChipList'].innerHTML; return { hasTargetCb: h.includes('setTeacherTargetClasses(this.checked)'), hasStar: h.includes('★ 担当'), hasAll: h.includes('すべてのクラス') }; });
run('setTeacherTargetClasses(true) => 担当クラス選択', ()=>{ ctx.__classes('clear'); ctx.setTeacherTargetClasses(true); const r={ sel:ctx.__classes('list'), filtered:ctx.__filtered() }; ctx.__classes('clear'); return r; });
run('setTeacherTargetClasses(false) => 担当クラス解除', ()=>{ ctx.__classes('clear'); ctx.setTeacherTargetClasses(true); ctx.setTeacherTargetClasses(false); return { sel: ctx.__classes('list') }; });
run('スコープ外クラスは選択しても児童0件', ()=>{ ctx.__classes('clear'); ctx.setClassSelected('大原小学校4年1組', true); const r={ sel:ctx.__classes('list'), filtered:ctx.__filtered() }; ctx.__classes('clear'); return r; });
run('指示状況バッジ: ロック+規制クラス', ()=>{ const h=ctx.buildClassChip('英田小学校5年1組'); return { lock:/🔒1/.test(h), filter:/🛡1/.test(h) }; });

console.log('===== 競合対策: 古い応答の破棄（stale-response guard） =====');
let apiCalls = 0;
const deferred = () => { let r; const p = new Promise(res=>{ r=res; }); return { p, resolve:r }; };
const dA = deferred(), dB = deferred();
ctx.__setApi(()=>{ apiCalls++; return (apiCalls===1 ? dA.p : dB.p); });
const pA = ctx.loadDevices(true);
const pB = ctx.loadDevices(true);
// B（新しい方）を先に解決 → devicesData は dataB になる
dB.resolve({ success:true, data:[{student_id:'NEW_B', class_name:'英田小学校5年1組', school_name:'英田小学校'}] });
// その後 A（古い方）を解決 → 破棄され、NEW_B のままであること
setTimeout(()=>{ dA.resolve({ success:true, data:[{student_id:'OLD_A', class_name:'英田小学校5年1組', school_name:'英田小学校'}] }); }, 0);

runAsync('新しい応答の後に届いた古い応答は無視される', ()=>Promise.all([pA,pB]).then(()=>{
  return { finalIds: ctx.__devices(), apiCalls };
}));

run('自動更新の抑止（refreshSuppressedUntil）中は静かな更新をスキップ', ()=>{
  let calls = 0; ctx.__setApi(()=>{ calls++; return Promise.resolve({success:true,data:[]}); });
  ctx.__setSuppress(Date.now()+5000);
  ctx.loadDevices(true);
  const skipped = calls === 0;
  ctx.__setSuppress(0);
  return { suppressed:calls===0, skipped };
});

setTimeout(()=>{ console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`); process.exit(fail?1:0); }, 50);
