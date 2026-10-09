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

// setup INSIDE script scope
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
__st = () => ({ selected: Array.from(selectedClasses), filtered: getFilteredDevices().map(d=>d.student_id) });
__scope = () => getTeacherScopeSchool();
__classes = (op, name) => { if(op==='clear') return selectedClasses.clear(); if(op==='add') return selectedClasses.add(name); if(op==='del') return selectedClasses.delete(name); return Array.from(selectedClasses); };
__students = (op, id) => { if(op==='clear') return selectedStudentIds.clear(); if(op==='add') return selectedStudentIds.add(id); return Array.from(selectedStudentIds); };
`;

const store = {};
function mkEl() { return { value:'', checked:false, innerHTML:'', textContent:'', dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, style:{setProperty(){},removeProperty(){}}, appendChild(){}, querySelectorAll(){return[];}, addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute(){return null;} }; }
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseFloat, parseInt, Set, Map, URL,
  window:{ addEventListener(){}, removeEventListener(){}, location:{href:''} },
  setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  selectedStudentIds:new Set(),
  localStorage:{getItem(){return null;},setItem(){}},
  document:{ getElementById(id){ return store[id]||(store[id]=mkEl()); }, createElement(){ return mkEl(); }, querySelectorAll(){return[];} },
  alert(){}, confirm(){return true;}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
function run(name, fn){ try{ const r=fn(); console.log('PASS', name, '=>', JSON.stringify(r)); }catch(e){ console.log('FAIL', name, ':', e.message); } }

run('scope school resolved to canonical', ()=>ctx.__scope());
run('collectRegisteredClasses (all schools in data)', ()=>Array.from(ctx.collectRegisteredClasses()).sort());
run('initial filtered (no class selection => all in-scope)', ()=>ctx.__st());

// in-scope for TEACHER 英田小学校: s1..s4 (own school) + s6 (unassigned). s5 (大原) out.
run('select class 5年1組 => only s1,s2', ()=>{ ctx.__classes('clear'); ctx.__classes('add','英田小学校5年1組'); return ctx.__st(); });
run('multi-select 5年1組 + 5年2組 => s1..s4', ()=>{ ctx.__classes('clear'); ctx.__classes('add','英田小学校5年1組'); ctx.__classes('add','英田小学校5年2組'); return ctx.__st(); });
run('select other-school class 大原4年1組 => [] (out of scope)', ()=>{ ctx.__classes('clear'); ctx.__classes('add','大原小学校4年1組'); return ctx.__st(); });
run('toggleClassChip removes + clears student selection', ()=>{ ctx.__classes('clear'); ctx.__classes('add','英田小学校5年1組'); ctx.__students('add','s1'); ctx.toggleClassChip('英田小学校5年1組'); return { selected:ctx.__classes('list'), students:ctx.__students('list') }; });
run('selectTeacherTargetClasses selects 5年1組', ()=>{ ctx.__classes('clear'); ctx.selectTeacherTargetClasses(); return ctx.__st(); });
run('selectAllClasses clears selection', ()=>{ ctx.__classes('add','英田小学校5年2組'); ctx.selectAllClasses(); return ctx.__st(); });

// instruction status (color/badge source)
run('status 5年1組: locked=1, filtered=1, total=2', ()=>ctx.getClassInstructionStatus('英田小学校5年1組'));
run('status 5年2組: locked=1, filtered=1, total=2', ()=>ctx.getClassInstructionStatus('英田小学校5年2組'));
run('buildClassChip 5年1組 has rose+amber (both)', ()=>{ const h=ctx.buildClassChip('英田小学校5年1組'); return { rose: h.includes('from-rose-100')&&h.includes('to-amber-100'), lockBadge:/🔒1/.test(h), filterBadge:/🛡1/.test(h) }; });
run('buildClassChip 5年2組 both (lock+blacklist)', ()=>{ const h=ctx.buildClassChip('英田小学校5年2組'); return { lockBadge:/🔒1/.test(h), filterBadge:/🛡1/.test(h) }; });
run('buildClassChip out-of-scope 大原4年1組 => no badge (scope filtered)', ()=>{ const h=ctx.buildClassChip('大原小学校4年1組'); return { hasLock:h.includes('🔒'), hasFilter:h.includes('🛡') }; });
run('renderClassChips produces chips', ()=>{ ctx.__classes('clear'); ctx.updateClassFilterOptions(); const h=store['classChipList'].innerHTML; return { hasAll:h.includes('すべてのクラス'), hasTarget:h.includes('★ 担当'), hasClass1:h.includes('英田小学校5年1組'), count:(h.match(/toggleClassChip/g)||[]).length }; });
run('buildClassChip selected adds ring', ()=>{ ctx.__classes('add','英田小学校5年1組'); const h=ctx.buildClassChip('英田小学校5年1組'); ctx.__classes('clear'); return { ring:h.includes('ring-2 ring-indigo-500') }; });
run('no dangling classFilter element reference', ()=>{ return { htmlHasClassFilterEl: /id="classFilter"/.test(html), jsRefs: (code.match(/classFilter/g)||[]).length }; });
