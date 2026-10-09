// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== Round 14 frontend sim: 自動更新の既定OFF（手動更新メイン）＋画面一覧タブ配線 =====
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('/home/user/webapp/gas/index.html','utf8');
const re=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))!==null){ if(/\bsrc\s*=/.test(m[0].split('>')[0]))continue; code+=m[1]+'\n'; }
code+='\n__switchMainView=(v)=>switchMainView(v);\n__setupAuto=()=>setupAutoRefresh();\n__isScreen=()=>typeof requestScreenInfo==="function"&&typeof loadScreens==="function";\n__target=()=>updateScreenTargetCount();\n';
const store={};
const classState={};
function mkEl(id){ if(classState[id])return classState[id]; const set=new Set();
  const el={id,value:'',checked:false,innerHTML:'',textContent:'',dataset:{},options:[],files:[],disabled:false,className:'',
    style:{setProperty(){},removeProperty(){}},parentNode:null,
    classList:{add(c){set.add(c);},remove(c){set.delete(c);},toggle(c,f){if(f===undefined){set.has(c)?set.delete(c):set.add(c);}else if(f){set.add(c);}else{set.delete(c);}},contains(c){return set.has(c);}},
    appendChild(){},removeChild(){},querySelectorAll(){return[];},addEventListener(){},setAttribute(){},removeAttribute(){},getAttribute(){return null;},cloneNode(){return mkEl(id);}};
  classState[id]=el; return el; }
const timers=[];
const ctx={console,JSON,Date,Math,String,Number,Array,Object,Boolean,isNaN,parseFloat,parseInt,Set,Map,URL,Promise,RegExp,
  window:{addEventListener(){},removeEventListener(){},location:{href:''},open(){return{ document:{write(){},close(){}} };}},
  setTimeout:(fn)=>{if(typeof fn==='function')fn();return 0;},clearTimeout(){},setInterval:(fn,ms)=>{timers.push(ms);return {ms};},clearInterval(){},
  selectedStudentIds:new Set(),selectedClasses:new Set(),devicesData:[],currentTeacher:{role:'ADMIN',school:'全校管理'},
  schoolFilter:null,
  localStorage:{getItem(k){return k in store?store[k]:null;},setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
  document:{getElementById(id){return mkEl(id);},createElement(){return mkEl('tmp'+Math.random());},querySelectorAll(){return[];}},
  alert(){},confirm(){return true;}};
vm.createContext(ctx);vm.runInContext(code,ctx);
let pass=0,fail=0;
function check(n,c,e){if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;}else{console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;}}

console.log('===== 自動更新の既定OFF（手動更新メイン） =====');
// 既定（保存なし）→ オフ
mkEl('autoRefreshToggle').checked=false;
ctx.__setupAuto();
check('保存なしの既定はオフ', mkEl('autoRefreshToggle').checked===false);
check('オフ時はタイマーを開始しない', timers.length===0, timers);
// オンにしたら保存され、タイマー(5秒)が動く
mkEl('autoRefreshToggle').checked=true;
store['edu_auto_refresh']='1';
ctx.__setupAuto();
check('保存がオン(1)なら復元時にオン', mkEl('autoRefreshToggle').checked===true);
check('オン時は5秒間隔のタイマーを開始', timers.indexOf(5000)!==-1, timers);

console.log('===== 画面一覧タブの配線 =====');
check('画面一覧の関数が存在（requestScreenInfo/loadScreens）', ctx.__isScreen()===true);
ctx.__switchMainView('screens');
check('画面一覧タブで screensView を表示', !mkEl('screensView').classList.contains('hidden'));
check('画面一覧タブで devicesView を非表示', mkEl('devicesView').classList.contains('hidden'));
ctx.__switchMainView('devices');
check('端末一覧タブで devicesView を表示', !mkEl('devicesView').classList.contains('hidden'));
check('画面情報取得ボタンがある', /id="screenFetchBtn"[^>]*onclick="requestScreenInfo\(\)"/.test(html));
check('取得済み表示ボタンがある', /onclick="loadScreens\(\)"/.test(html));
check('画面一覧グリッドがある', /id="screenGrid"/.test(html));
check('端末一覧/画面一覧の切替タブがある', /id="tabDevicesViewBtn"/.test(html)&&/id="tabScreensViewBtn"/.test(html));
check('自動更新トグルのHTMLに checked が付いていない（既定OFF）', !/id="autoRefreshToggle"[^>]*checked/.test(html));
check('apiRequest に request_screens/get_screens 経路がある', /act === 'request_screens'/.test(html)&&/act === 'get_screens'/.test(html));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
