// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== Round 15 frontend sim: 4課題修正の検証 =====
//  ① 画面情報取得で「送信待ちのまま何も出ない」→ 要求後に必ず一覧表示
//  ② シートが増える → 1シート管理（バックエンドの SCREENSHOT_SHEET_NAME 定義）
//  ③ 取得中止ボタン
//  ④ ログインで拡張起動 / ログアウトで停止（全アカウント）
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('/home/user/webapp/gas/index.html','utf8');
const codeGs=fs.readFileSync('/home/user/webapp/gas/Code.gs','utf8');
const bgJs=fs.readFileSync('/home/user/webapp/extension/background.js','utf8');
const contentJs=fs.readFileSync('/home/user/webapp/extension/content.js','utf8');

const re=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))!==null){ if(/\bsrc\s*=/.test(m[0].split('>')[0]))continue; code+=m[1]+'\n'; }
code+='\n__startKA=()=>startExtensionKeepalive();\n'
    + '__stopKA=()=>stopExtensionKeepalive();\n'
    + '__kaId=()=>eduKeepaliveSessionId;\n'
    + '__cancel=()=>cancelScreenFetch();\n'
    + '__pollMax=()=>SCREEN_POLL_MAX;\n'
    + '__fetchActive=()=>screenFetchActive;\n'
    + '__isPolling=()=>screenPollTimer!==null;\n';
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
  window:{addEventListener(){},removeEventListener(){},location:{href:''},postMessage(){},open(){return{ document:{write(){},close(){}} };}},
  setTimeout:(fn)=>{if(typeof fn==='function')fn();return 0;},clearTimeout(){},setInterval:(fn,ms)=>{timers.push(ms);return {ms};},clearInterval(){},
  selectedStudentIds:new Set(),selectedClasses:new Set(),devicesData:[],currentTeacher:{role:'ADMIN',school:'全校管理'},
  schoolFilter:null,
  localStorage:{getItem(k){return k in store?store[k]:null;},setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
  document:{getElementById(id){return mkEl(id);},createElement(){return mkEl('tmp'+Math.random());},querySelectorAll(){return[];}},
  alert(){},confirm(){return true;}};
vm.createContext(ctx);vm.runInContext(code,ctx);
let pass=0,fail=0;
function check(n,c,e){if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;}else{console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;}}

console.log('===== ① 画面情報が表示される（送信待ちのまま何も出ない問題の修正） =====');
check('requestScreenInfo が存在', /function requestScreenInfo/.test(html));
check('要求(await request_screens)の後に loadScreens を呼ぶ（一覧を必ず表示）',
  /await apiRequest\(\{ action: 'request_screens'[\s\S]*?await loadScreens\(/.test(html));
check('取得待ちでも「端末の送信待ち」カードを描画（空表示にしない）', /端末の送信待ち/.test(html));
check('renderScreens が対象/取得済/取得待ち/未取得を集計表示', /取得待ち/.test(html) && /function renderScreens/.test(html));

console.log('===== ② スプレッドシートのシートが増えない（1シート管理） =====');
check('CONFIG に SCREENSHOT_SHEET_NAME が定義されている',
  /SCREENSHOT_SHEET_NAME:\s*'[^']+'/.test(codeGs));
check('getTargetSheet にシート名未定義の安全弁（空シート増殖を防止）がある',
  /シート名が未定義です/.test(codeGs));
check('画面情報シートは児童IDで upsert（1児童=1行）', /function processScreenshotUpload/.test(codeGs) && /getTargetSheet\(CONFIG\.SCREENSHOT_SHEET_NAME\)/.test(codeGs));

console.log('===== ③ 取得中止ボタン =====');
check('HTML に取得中止ボタン(#screenCancelBtn)がある', /id="screenCancelBtn"/.test(html));
check('取得中止ボタンが cancelScreenFetch() を呼ぶ', /id="screenCancelBtn"[^>]*onclick="cancelScreenFetch\(\)"/.test(html));
check('cancelScreenFetch が stopScreenPolling を呼ぶ', /function cancelScreenFetch[\s\S]*?stopScreenPolling\(\)/.test(html));
check('ポーリング上限 SCREEN_POLL_MAX が定義されている', /const SCREEN_POLL_MAX\s*=\s*\d+/.test(html));
check('SCREEN_POLL_MAX は十分長い（>=30 ≒ 60秒以上）', ctx.__pollMax() >= 30, ctx.__pollMax());
check('取得中止ボタンは既定で非表示（hidden）', /id="screenCancelBtn"[^>]*class="hidden/.test(html));

console.log('===== ④ ログインで拡張起動 / ログアウトで停止 =====');
check('コンソールに startExtensionKeepalive / stopExtensionKeepalive がある',
  /function startExtensionKeepalive/.test(html) && /function stopExtensionKeepalive/.test(html));
check('ログイン画面表示(showLoginView)で拡張を停止', /function showLoginView[\s\S]*?stopExtensionKeepalive\(\)/.test(html));
check('ダッシュボード表示(showDashboard)で拡張を起動', /function showDashboard[\s\S]*?startExtensionKeepalive\(\)/.test(html));
check('logout が showLoginView を呼ぶ（＝停止が連鎖）', /function logout[\s\S]*?showLoginView\(\)/.test(html));
check('15秒ごとにコンソール稼働を再送して延命', /setInterval\(\(\)\s*=>\s*\{[\s\S]{0,120}?consoleTouch\(\)[\s\S]{0,120}?\},\s*15000\)/.test(html));
check('EDU_KEEPALIVE_START/STOP を postMessage で中継', /EDU_KEEPALIVE_START/.test(html) && /EDU_KEEPALIVE_STOP/.test(html));
check('pagehide で STOP を送る（タブを閉じても停止）', /addEventListener\('pagehide'[\s\S]{0,80}stopExtensionKeepalive/.test(html));

console.log('===== ④(拡張側) content → SW の中継とセッション管理 =====');
check('content.js が EDU_KEEPALIVE_START/STOP を SW へ転送',
  /EDU_KEEPALIVE_START/.test(contentJs) && /EDU_KEEPALIVE_STOP/.test(contentJs) && /type: 'KEEPALIVE_START'/.test(contentJs));
check('background に KEEPALIVE_START / KEEPALIVE_STOP ハンドラがある',
  /message\.type === 'KEEPALIVE_START'/.test(bgJs) && /message\.type === 'KEEPALIVE_STOP'/.test(bgJs));
check('GAS 連動の稼働フラグ（keepaliveActive）で管理', /keepaliveActive/.test(bgJs));
check('GAS の ka_active を反映して同期周期を切替（applyRemoteKeepalive）', /applyRemoteKeepalive/.test(bgJs));
check('keepalive_active を storage に保存', /chrome\.storage\.local\.set\(\{ keepalive_active/.test(bgJs));
check('非稼働時は 15 秒レートで doPost を削減（IDLE_SYNC_MS）', /IDLE_SYNC_MS\s*=\s*15000/.test(bgJs) && /maybeSync/.test(bgJs));

console.log('===== ④(動的) セッション開始/停止でアクティブが切替わる =====');
check('開始前はセッションIDが無い', ctx.__kaId() === null, ctx.__kaId());
ctx.__startKA();
const sid1 = ctx.__kaId();
check('startExtensionKeepalive でセッションIDが発行される', typeof sid1 === 'string' && sid1.indexOf('sess_') === 0, sid1);
check('15秒タイマーが登録される（コンソール稼働の延命）', timers.indexOf(15000) !== -1, timers);
ctx.__stopKA();
check('stopExtensionKeepalive でセッションIDがクリアされる', ctx.__kaId() === null, ctx.__kaId());

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
