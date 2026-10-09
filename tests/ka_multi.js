// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== v1.6.0: 複数アカウント（複数教員）での稼働判定 & 同期周期配布の検証 =====
//  ・複数セッションのうち 1 つが終了しても、他が稼働中なら非稼働にしない。
//  ・全セッションが消えたときだけ非稼働。失効窓（120 秒）も検証。
//  ・GAS が児童端末へ配布する同期周期（稼働=1.5秒／非稼働=0）を検証。
const fs=require('fs'),vm=require('vm');
const codeGs=fs.readFileSync('/home/user/webapp/gas/Code.gs','utf8');
function extract(src,name){
  const re=new RegExp('^function '+name+'\\s*\\(','m');
  const start=src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;}else{console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;}}

let fakeNow=1700000000000;
function FakeDate(){ return { getTime: () => fakeNow }; }
const cacheStore={}, propStore={};
const gctx={
  console, JSON, String, Number, Object, Array, RegExp, Error, Boolean, Math,
  Date: FakeDate,
  CacheService:{ getScriptCache(){ return {
    get(k){ return k in cacheStore ? cacheStore[k] : null; },
    put(k,v){ cacheStore[k]=String(v); },
    remove(k){ delete cacheStore[k]; } }; } },
  PropertiesService:{ getScriptProperties(){ return {
    getProperty(k){ return k in propStore ? propStore[k] : null; },
    setProperty(k,v){ propStore[k]=String(v); },
    deleteProperty(k){ delete propStore[k]; } }; } }
};
vm.createContext(gctx);
vm.runInContext(
  "const KA_KEY='ka_console';const KA_PROP_KEY='KA_LAST_TOUCH';const KA_SESS_KEY='ka_sessions';"+
  "const KA_SESS_PROP_KEY='KA_SESSIONS';const KA_ACTIVE_WINDOW_MS=120000;const KA_MAX_SESSIONS=200;"+
  "const KA_IDLE_DRIFT_SEC=20;const ACTIVE_SYNC_INTERVAL_SEC=1.5;\n"+
  extract(codeGs,'readKaSessions')+'\n'+extract(codeGs,'writeKaSessions')+'\n'+extract(codeGs,'pruneKaSessions')+'\n'+
  extract(codeGs,'touchTeacherConsole')+'\n'+extract(codeGs,'releaseTeacherConsole')+'\n'+extract(codeGs,'isTeacherConsoleActive')+'\n'+
  extract(codeGs,'computeKaInterval')+
  '\n__touch=touchTeacherConsole;__release=releaseTeacherConsole;__active=isTeacherConsoleActive;__interval=computeKaInterval;', gctx);

console.log('===== 複数アカウント: 1つの終了で他が止まらない =====');
check('初期は非稼働', gctx.__active()===false);
gctx.__touch('sessA@teacher1');
gctx.__touch('sessB@teacher2');
check('2アカウントがログイン中は稼働中', gctx.__active()===true);
gctx.__release('sessA@teacher1');
check('1アカウントがログアウトしても、他が稼働中なら稼働を維持（重要）', gctx.__active()===true);
gctx.__release('sessB@teacher2');
check('全アカウントがログアウトしたら非稼働', gctx.__active()===false);

console.log('===== 失効窓（120秒） =====');
gctx.__touch('sessA');
check('touch で稼働中', gctx.__active()===true);
fakeNow += 60000;
check('60秒ではまだ稼働中', gctx.__active()===true);
fakeNow += 61000; // 合計121秒
check('120秒を超えたらそのセッションは失効し非稼働', gctx.__active()===false);

console.log('===== 全解除（session_id 無しの後方互換） =====');
gctx.__touch('sessX'); gctx.__touch('sessY');
check('2セッション稼働中', gctx.__active()===true);
gctx.__release('');
check('release(空) は全セッションを解除する', gctx.__active()===false);

console.log('===== 児童端末へ配布する同期周期 =====');
const ivActive = gctx.__interval(1.5, fakeNow);
check('稼働中: ka_active=true, 周期=1.5秒, 猶予なし',
  ivActive.ka_active===true && ivActive.sync_interval_sec===1.5 && ivActive.idle_drift_until===0, ivActive);
const ivIdle = gctx.__interval(0, fakeNow);
check('非稼働: ka_active=false, 周期=0（同期しない）',
  ivIdle.ka_active===false && ivIdle.sync_interval_sec===0, ivIdle);
check('非稼働: 再確認の猶予（idle_drift_until）が未来に設定される',
  ivIdle.idle_drift_until > fakeNow, ivIdle.idle_drift_until - fakeNow);

console.log('===== ソース静的チェック（複数セッション対応の配線） =====');
check('touch/release/isActive がセッションマップ（KA_SESS）を使う', /KA_SESS_KEY/.test(codeGs) && /function readKaSessions/.test(codeGs));
check('doPost が session_id を渡す', /touchTeacherConsole\(payload\.session_id\)/.test(codeGs) && /releaseTeacherConsole\(payload\.session_id\)/.test(codeGs));
check('api_consoleTouch/Release が sessionId を受け取る',
  /function api_consoleTouch\(sessionId\)/.test(codeGs) && /function api_consoleRelease\(sessionId\)/.test(codeGs));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
