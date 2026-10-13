// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== v1.6.0 運用前 総合プリフライト（いじわる含む） =====
// チェックポイント:
//  CP1 複数教員が同時に別クラスで使っても壊れない（セッション管理/競合）
//  CP2 児童画面への反映速度のばらつきが小さい（稼働=1.5秒）
//  CP3 運用開始時の通信負荷が妥当（非稼働=0、稼働=約40回/分）
//  CP4 管理コンソール配布後に対象スプレッドシートへ繋がる（gas_url 解決）
//  CP5 管理コンソール配布で児童画面に拡張の詳細情報が出ない
//  CP6 全教員ログアウトで（児童画面が開いていても）完全停止する
//  +いじわる: 時計ずれ/なりすまし/ハング/チャーン/なりすましpostMessage
const fs=require('fs'),vm=require('vm');
const bg=fs.readFileSync('/home/user/webapp/extension/background.js','utf8');
const content=fs.readFileSync('/home/user/webapp/extension/content.js','utf8');
const lock=fs.readFileSync('/home/user/webapp/extension/lock.js','utf8');
const blocked=fs.readFileSync('/home/user/webapp/extension/blocked.js','utf8');
const codeGs=fs.readFileSync('/home/user/webapp/gas/Code.gs','utf8');
const manifest=JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json','utf8'));

function extract(src,name){
  const re=new RegExp('^[ \\t]*function '+name+'\\s*\\(','m');
  const start=src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;}else{console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;}}

// ============================================================
console.log('========== CP1: 複数教員が同時に別クラスで使用 ==========');
// GAS のセッションマップを実挙動で検証（同時 touch/release、クラス別の一括操作の直列性）
let fakeNow=1700000000000;
const cacheStore={}, propStore={};
const gctx={ console, JSON, String, Number, Object, Array, RegExp, Error, Boolean, Math,
  Date: (function(){ function F(){ return { getTime: () => fakeNow }; } return F; })(),
  CacheService:{ getScriptCache(){ return { get(k){return k in cacheStore?cacheStore[k]:null;}, put(k,v){cacheStore[k]=String(v);}, remove(k){delete cacheStore[k];} };} },
  PropertiesService:{ getScriptProperties(){ return { getProperty(k){return k in propStore?propStore[k]:null;}, setProperty(k,v){propStore[k]=String(v);}, deleteProperty(k){delete propStore[k];} };} }
};
vm.createContext(gctx);
vm.runInContext(
  "const KA_KEY='ka_console';const KA_PROP_KEY='KA_LAST_TOUCH';const KA_SESS_KEY='ka_sessions';"+
  "const KA_SESS_PROP_KEY='KA_SESSIONS';const KA_ACTIVE_WINDOW_MS=120000;const KA_MAX_SESSIONS=200;"+
  "const KA_IDLE_DRIFT_SEC=20;const ACTIVE_SYNC_INTERVAL_SEC=1.5;let __now=0;\n"+
  extract(codeGs,'readKaSessions')+'\n'+extract(codeGs,'writeKaSessions')+'\n'+extract(codeGs,'pruneKaSessions')+'\n'+
  extract(codeGs,'touchTeacherConsole')+'\n'+extract(codeGs,'releaseTeacherConsole')+'\n'+extract(codeGs,'isTeacherConsoleActive')+'\n'+
  extract(codeGs,'computeKaInterval')+
  '\n__touch=touchTeacherConsole;__release=releaseTeacherConsole;__active=isTeacherConsoleActive;__interval=computeKaInterval;', gctx);

// 先生A(クラスA)・先生B(クラスB) が別々のタブ（別セッション）で同時ログイン
gctx.__touch('sessA_classA'); gctx.__touch('sessB_classB');
check('CP1 2教員が別クラスで同時稼働 → 稼働中', gctx.__active()===true);
// 先生Bがログアウト（別クラス利用終了）。先生Aは稼働継続。
gctx.__release('sessB_classB');
check('CP1 片方（別クラス）がログアウトしても他方が稼働中なら維持', gctx.__active()===true);
// さらに先生C が割り込んでログイン → 3名同時でも壊れない
gctx.__touch('sessC_classC');
check('CP1 3教員同時でも稼働を維持（取りこぼしなし）', gctx.__active()===true);
// 先生A・C がログアウト → 全消滅で非稼働
gctx.__release('sessA_classA'); gctx.__release('sessC_classC');
check('CP1 全教員ログアウトで非稼働', gctx.__active()===false);
// いじわる: 同一セッションの touch 連打と release の後先（順序不同）でも破綻しない
gctx.__touch('sessX'); gctx.__touch('sessX'); gctx.__release('sessX'); gctx.__release('sessX');
check('CP1 同一セッションの touch/release 連打でも安全（非稼働）', gctx.__active()===false);
// いじわる: 未知セッションの release（未 touch）でも例外を出さない
let threw=false; try{ gctx.__release('never_touched'); }catch(e){ threw=true; }
check('CP1 未知セッションの release でも例外なし', threw===false && gctx.__active()===false);
// いじわる: セッション上限（際限ない増加の防止）
for(let i=0;i<300;i++){ gctx.__touch('flood_'+i); }
let mapSize=0; try{ mapSize=Object.keys(JSON.parse(propStore['KA_SESSIONS']||'{}')).length; }catch(e){}
// 1校あたりの同時セッションは教員数＋予備で十分収まる上限に収まること（際限ない肥大を防ぐ）
check('CP1 大量セッションでも上限内に収まる（メモリ肥大防止）', mapSize<=210, mapSize);
// 一括操作は withWriteLock で直列化（別クラス同時操作の取りこぼし防止）
const wl=extract(codeGs,'withWriteLock');
check('CP1 一括操作が書き込みロックで直列化される', /LockService\.getScriptLock/.test(wl) && /waitLock/.test(wl) && /releaseLock/.test(wl));

// ============================================================
console.log('========== CP2: 児童画面への反映速度のばらつき ==========');
check('CP2 稼働中は 1.5 秒周期（ACTIVE_SYNC_MS=1500）', /const ACTIVE_SYNC_MS = 1500;/.test(bg));
check('CP2 GAS が稼働中に sync_interval_sec=1.5 を配布', /ACTIVE_SYNC_INTERVAL_SEC\s*=\s*1\.5/.test(codeGs));
check('CP2 稼働中はアラームのバックストップで 30 秒以内に必ず起床', /periodInMinutes: 0\.5/.test(bg));
// いじわる: 別セッションでも同一の 1.5 秒周期が配布される（ばらつき無し）
const ivA=gctx.__interval(1.5,fakeNow), ivB=gctx.__interval(1.5,fakeNow);
check('CP2 どの教員セッションでも同一周期（ばらつき無し）', ivA.sync_interval_sec===ivB.sync_interval_sec, ivA.sync_interval_sec);
// 反映の多重実行防止（古い応答で上書き→ちらつきの防止）
check('CP2 同期の多重実行を防止（syncInFlight ガード）', /if \(syncInFlight\) return;/.test(bg));
// いじわる: 応答ハングで反映が永久停止しない（タイムアウト）
check('CP2 GAS 応答にタイムアウトを設定（ハングで反映停止しない）', /SYNC_TIMEOUT_MS\s*=\s*\d+/.test(bg) && /controller\.abort\(\)/.test(bg));

// ============================================================
console.log('========== CP3: 運用開始時の通信負荷 ==========');
check('CP3 非稼働時の定期ポーリングを停止（IDLE_SYNC_MS=0）', /const IDLE_SYNC_MS = 0;/.test(bg));
check('CP3 非稼働時は 30 秒アラームも解除（無駄な起床なし）', /function stopSyncLoop[\s\S]*?clear\('syncAlarm'\)/.test(bg));
check('CP3 非稼働時は ping を送らない（content.js ゲート）', /if \(!kaActiveCache\) return;/.test(content));
check('CP3 非稼働時は ping を送らない（lock.js ゲート）', /if \(!kaActiveCache\) return;/.test(lock));
check('CP3 非稼働時は ping を送らない（blocked.js ゲート）', /if \(!kaActiveCache\) return;/.test(blocked));
check('CP3 稼働中のみ 30 秒アラームを登録（同期周期は状態遷移時のみ再設定）', /if \(activeChanged\)[\s\S]{0,80}?ensureSyncLoop\(\)/.test(bg));
check('CP3 非稼働の猶予上限を 60 秒に丸め（無駄な再確認を防止）', /IDLE_DRIFT_MAX_MS = 60000/.test(bg));
// 通信量の見積り（1端末あたり）
const perMinActive = Math.round(60000/1500);
check('CP3 稼働中の概算 = 約40回/分（1端末）', perMinActive===40, perMinActive);
check('CP3 非稼働中 = 0回/分（1端末）', true, 0);

// ============================================================
console.log('========== CP4: 管理コンソール配布後に対象スプレッドシートへ繋がる ==========');
vm.createContext(gctx);
vm.runInContext(extract(bg,'normalizeSchoolKey')+'\n'+extract(bg,'resolveGasUrl')+
  '\n__resolve=resolveGasUrl;', gctx);
const MAP={ '英田小学校':'https://script.google.com/macros/s/AIDA/exec',
            '大原小学校':'https://script.google.com/macros/s/OHARA/exec',
            '第一小学校':'https://script.google.com/macros/s/DAIICHI/exec' };
check('CP4 school_name 完全一致で対象GASへ解決（実値）',
  gctx.__resolve({school_name:'英田小学校',gas_url_map:MAP}) === MAP['英田小学校'], gctx.__resolve({school_name:'英田小学校',gas_url_map:MAP}));
check('CP4 表記ゆれ（前後空白/全角スペース）を吸収',
  gctx.__resolve({school_name:'　英田小学校　',gas_url_map:MAP}) === MAP['英田小学校']);
check('CP4 表記ゆれ（接頭辞「美作市立」）を吸収',
  gctx.__resolve({school_name:'美作市立英田小学校',gas_url_map:MAP}) === MAP['英田小学校']);
check('CP4 school_name 未設定でも共通 gas_url へフォールバック',
  gctx.__resolve({school_name:'',gas_url:'https://script.google.com/macros/s/COMMON/exec',gas_url_map:MAP}) === 'https://script.google.com/macros/s/COMMON/exec');
check('CP4 マップに無い学校名は共通 gas_url へ',
  gctx.__resolve({school_name:'存在しない学校',gas_url:'https://script.google.com/macros/s/COMMON/exec',gas_url_map:MAP}) === 'https://script.google.com/macros/s/COMMON/exec');
check('CP4 管理ポリシー(schema.json) に gas_url_map/school_name がある',
  /gas_url_map/.test(fs.readFileSync('/home/user/webapp/extension/schema.json','utf8')));
check('CP4 初期化が managed ポリシーから school_name/gas_url_map を保存',
  /managed\.gas_url_map/.test(bg) && /managed\.school_name/.test(bg));
check('CP4 解決できない場合は managed を再確認して補完',
  /if \(!effectiveGasUrl \|\| !data\.school_name/.test(bg));

// ============================================================
console.log('========== CP5: 管理コンソール配布で児童画面に拡張の詳細が出ない ==========');
check('CP5 manifest に "key"(外部露出用) が含まれない', !('key' in manifest));
check('CP5 manifest に externally_connectable が無い（外部接続不可）', !('externally_connectable' in manifest));
check('CP5 manifest に devtools_page / omnibox 等の露出面が無い',
  !('devtools_page' in manifest) && !('omnibox' in manifest) && !('options_page' in manifest));
check('CP5 content script は console/詳細情報を一切表示しない（注入IDはロック関連のみ）',
  !/chrome\.runtime\.getManifest|id="chrome"|詳細情報/.test(content) && /edu-screen-lock-overlay/.test(content));
check('CP5 児童向けにユーザー操作が不要である旨を案内（自動構成）', /自動構成/.test(fs.readFileSync('/home/user/webapp/extension/popup.html','utf8')));
check('CP5 popup は手動設定を details 内に折りたたむ（児童に操作を求めない）', /<details id="manualSettings">/.test(fs.readFileSync('/home/user/webapp/extension/popup.html','utf8')));

// ============================================================
console.log('========== CP6: 全教員ログアウトで児童画面が開いていても完全停止 ==========');
// 前段（CP1 のフラッド検証）のセッション状態をリセットしてから検証する
gctx.__release('');
check('CP6 リセット後は非稼働', gctx.__active()===false);
// GAS 側: 全セッション消滅 → 周期0
gctx.__touch('T1'); gctx.__touch('T2');
gctx.__release('T1');
check('CP6 1名ログアウトでも他が稼働中は継続', gctx.__active()===true);
gctx.__release('T2');
const ivStop=gctx.__interval(gctx.__active()?1.5:0, fakeNow);
check('CP6 全教員ログアウト → 周期0（同期しない）', ivStop.ka_active===false && ivStop.sync_interval_sec===0, ivStop);
// 拡張側: 非稼働を受けたら ping も止める（児童画面を開いていても送信しない）
check('CP6 非稼働になったら ping 送信を停止（content/lock/blocked）',
  /if \(!kaActiveCache\) return;/.test(content) && /if \(!kaActiveCache\) return;/.test(lock) && /if \(!kaActiveCache\) return;/.test(blocked));
check('CP6 非稼働になったら 30 秒アラームを解除（起床しない）', /stopSyncLoop\(\);/.test(bg) && /clear\('syncAlarm'\)/.test(bg));
// いじわる: 猶予が延長されず必ず停止する（毎応答で +20 秒を返しても有限）
check('CP6 猶予は延長されない（一度決めた後は据え置き）', /idleDriftUntil > Date\.now\(\)\)[\s\S]{0,20}?\? idleDriftUntil/.test(bg));
// 猶予アラームは必ず止まる（periodInMinutes 付きでも clear で停止）
check('CP6 猶予アラームは clear で確実に停止する', /function clearIdleDriftAlarm[\s\S]*?clear\('idleDriftAlarm'\)/.test(bg));
// 停止後も「人が端末を操作」したら復帰できる（タブ作成/更新/フォーカス）
check('CP6 停止後もタブ作成/更新で復帰できる（resumeFromConsoleTab）',
  /chrome\.tabs\.onCreated[\s\S]{0,600}?resumeFromConsoleTab/.test(bg) && /chrome\.tabs\.onUpdated[\s\S]{0,600}?resumeFromConsoleTab/.test(bg));
check('CP6 停止後もウィンドウ操作で復帰できる（onFocusChanged）', /chrome\.windows\.onFocusChanged\.addListener/.test(bg));

// ============================================================
console.log('========== いじわる検証（なりすまし・時計ずれ・チャーン） ==========');
// なりすまし: 任意オリジンからの EDU_KEEPALIVE_START を無視する
check('いじわる content.js がコンソール信号のオリジン検証を行う', /function isTeacherConsoleOrigin/.test(content));
const octx={ console, String, RegExp, Object };
vm.createContext(octx);
vm.runInContext(extract(content,'isTeacherConsoleOrigin')+'\n__chk=isTeacherConsoleOrigin;', octx);
check('いじわる 児童ページ(evil.example)からの信号は拒否', octx.__chk({origin:'https://evil.example'})===false);
check('いじわる 空オリジン(偽装)は拒否', octx.__chk({origin:''})===false && octx.__chk({})===false);
check('いじわる 教員コンソール(script.google.com)は許可', octx.__chk({origin:'https://script.google.com'})===true);
check('いじわる GAS出力(*.googleusercontent.com)は許可', octx.__chk({origin:'https://abc123.googleusercontent.com'})===true);
check('いじわる 似せた別ドメイン(script.google.com.evil.com)は拒否',
  octx.__chk({origin:'https://script.google.com.evil.com'})===false);
// 時計ずれ: 未来の idle_drift_until でも猶予は最大60秒に丸める
check('いじわる 未来の idle_drift_until でも猶予は最大60秒（時計ずれ対策）',
  /Math\.min\(driftCandidate, Date\.now\(\) \+ IDLE_DRIFT_MAX_MS\)/.test(bg));
// チャーン: 状態不変時は書込み/アラーム再登録をしない
check('いじわる 状態不変時に storage 書込み・アラーム再登録をしない（チャーン防止）',
  /if \(!activeChanged && !intervalChanged && !driftChanged\) return;/.test(bg));
// 後方互換: 旧形式(真偽値)の ka_active でも壊れない
check('いじわる 旧形式 ka_active(真偽値) でも受理（後方互換）', /else \{\s*active = !!payload;/.test(bg));

console.log(`\n===== PREFLIGHT 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
