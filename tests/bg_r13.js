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
// ===== Round 13 background/content sim: SW keepalive で指示を3秒以内に反映 =====
// v1.6.0: 「管理アプリ（教員コンソール）を起動していないときは通信しない」を検証する。
//   稼働中（ka_active=true）のみ 1.5 秒同期。非稼働は同期しない（doPost=0）。
//   ただし稼働→非稼働になった直後の猶予期間だけ 1 秒上限で再確認する。
const fs = require('fs'), vm = require('vm');
const bg = fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8');
const content = fs.readFileSync('/home/user/webapp/extension/content.js', 'utf8');
const lock = fs.readFileSync('/home/user/webapp/extension/lock.js', 'utf8');
const blocked = fs.readFileSync('/home/user/webapp/extension/blocked.js', 'utf8');

function extract(name, src){
  src = src || bg;
  const re = new RegExp('^function '+name+'\\s*\\(','m');
  const start = src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){ if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;} else {console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;} }

// ---- maybeSync（レート制御）の実挙動を vm 上で検証 ----
// 稼働中=1.5秒／非稼働=停止（同期しない）／猶予期間=1秒上限。
console.log('===== maybeSync: 稼働中=1.5秒／非稼働=停止／猶予=1秒 のレート制御 =====');
let t = 1000000;
const calls = [];
const ctx = {
  console, JSON, String, Object, Array, RegExp, Error, Number, Math,
  Date: { now: () => t },
  chrome: { alarms: {
    create:(name,opt)=>calls.push({name,opt}),
    clear:(name)=>{ calls.push({clear:name}); return Promise.resolve(true); },
    clearAll(){}
  } },
  syncWithGas: () => { calls.push({sync:true}); return Promise.resolve(); }
};
const syncCount = () => calls.filter(c=>c.sync).length;
vm.createContext(ctx);
vm.runInContext(
  'const ACTIVE_SYNC_MS = 1500;\nconst IDLE_SYNC_MS = 0;\nconst IDLE_DRIFT_MS = 1000;\nconst IDLE_DRIFT_ALARM_MIN = 5/60;\n' +
  'let keepaliveActive = true;\nlet activeIntervalMs = 1500;\nlet idleDriftUntil = 0;\nlet lastSyncMs = 0;\n' +
  extract('maybeSync') + '\n' + extract('ensureSyncLoop') + '\n' + extract('stopSyncLoop') +
  '\n' + extract('scheduleIdleDrift') + '\n' + extract('clearIdleDriftAlarm') +
  '\n__sync=maybeSync; __ensure=ensureSyncLoop; __stop=stopSyncLoop;' +
  '\n__setActive=(v)=>{keepaliveActive=v;}; __setDrift=(u)=>{idleDriftUntil=u;};', ctx);

ctx.__sync();
check('稼働中: 初回の maybeSync で同期する', syncCount() === 1, syncCount());
ctx.__sync();
check('稼働中: 直後の再呼び出しは 1.5 秒未満なのでスキップ（doPost を抑える）', syncCount() === 1, syncCount());
t += 1600;
ctx.__sync();
check('稼働中: 1.5 秒経過後は同期する（3秒以内反映の要）', syncCount() === 2, syncCount());

// 非稼働（猶予なし）: 一切同期しない＝管理アプリ未起動時の通信負荷ゼロ
ctx.__setActive(false);
ctx.__setDrift(0);
const beforeIdle = syncCount();
t += 60000;
ctx.__sync();
ctx.__sync();
check('非稼働（猶予なし）: 60 秒経過しても同期しない（管理アプリ未使用=通信なし）', syncCount() === beforeIdle, syncCount());

// 非稼働（猶予内）: 1 秒上限で再確認する（管理アプリの再起動を拾う）
ctx.__setActive(false);
ctx.__setDrift(t + 20000);
t += 1000;
ctx.__sync();
check('非稼働（猶予内）: 1 秒経過で再確認する', syncCount() === beforeIdle + 1, syncCount());
ctx.__sync();
check('非稼働（猶予内）: 直後（1秒未満）は再確認しない', syncCount() === beforeIdle + 1, syncCount());

ctx.__ensure();
check('ensureSyncLoop が 30 秒アラーム(syncAlarm)を登録', calls.some(c => c.name === 'syncAlarm' && c.opt.periodInMinutes === 0.5), calls.filter(c=>c.name).map(c=>c.name));
ctx.__stop();
check('stopSyncLoop が syncAlarm を解除する（非稼働時は起床しない）', calls.some(c => c.clear === 'syncAlarm'), calls.filter(c=>c.clear).map(c=>c.clear));

// ---- ソース静的チェック ----
console.log('===== background.js: レート制御の配線 =====');
check('alarm ハンドラが syncAlarm/keepAliveAlarm を処理', /alarm\.name === 'syncAlarm' \|\| alarm\.name === 'keepAliveAlarm'/.test(bg));
check('alarm 受信時に maybeSync() を呼ぶ', /onAlarm[\s\S]{0,500}?maybeSync\(\)/.test(bg));
check('初期化時に常時アラームを登録しない（稼働時のみ applyRemoteKeepalive が登録）',
  !/async function initializeClient\(\)[\s\S]*?ensureSyncLoop\(\);/.test(bg));
check('ACTIVE_SYNC_MS = 1500', /const ACTIVE_SYNC_MS = 1500;/.test(bg));
check('IDLE_SYNC_MS = 0（非稼働時は定期ポーリングしない）', /const IDLE_SYNC_MS = 0;/.test(bg));
check('applyRemoteKeepalive が keepalive_active を storage に保存', /chrome\.storage\.local\.set\(\{[\s\S]{0,80}?keepalive_active:/.test(bg));
check('非稼働時は syncAlarm を止める（stopSyncLoop）', /function stopSyncLoop[\s\S]*?clear\('syncAlarm'\)/.test(bg));
check('猶予期間の再確認アラーム（scheduleIdleDrift/idleDriftAlarm）がある', /function scheduleIdleDrift/.test(bg) && /idleDriftAlarm/.test(bg));
check('停止後もコンソール検知で復帰（resumeFromConsoleTab）', /function resumeFromConsoleTab[\s\S]*?script\.google\.com/.test(bg));
check('KEEPALIVE_PING ハンドラが存在', /message\.type === 'KEEPALIVE_PING'/.test(bg));
check('KEEPALIVE_PING ハンドラが maybeSync を呼ぶ', /message\.type === 'KEEPALIVE_PING'[\s\S]*?maybeSync\(\)/.test(bg));

console.log('===== 送信側: content/lock/blocked が稼働中のみ 1500ms で ping =====');
function senderOk(src, label){
  const hasPing = /type:\s*'KEEPALIVE_PING'/.test(src);
  // ping 送信ブロックが 1500ms 間隔であること
  const intervalOk = /setInterval\(\(\)\s*=>\s*\{[\s\S]{0,260}?KEEPALIVE_PING[\s\S]{0,260}?\}\s*,\s*1500\s*\)/.test(src);
  // 非稼働時（keepalive_active=false）は送信しないゲートがあること
  const gateOk = /if \(!kaActiveCache\) return;/.test(src) && /keepalive_active/.test(src);
  check(label+': KEEPALIVE_PING を送信', hasPing);
  check(label+': 1500ms 間隔', intervalOk);
  check(label+': 非稼働時は送信しない（keepalive_active ゲート）', gateOk);
}
senderOk(content, 'content.js');
senderOk(lock, 'lock.js');
senderOk(blocked, 'blocked.js');
check('content.js: トップフレームのみ ping（iframe 暴発防止）', /window\.top === window[\s\S]{0,1400}?KEEPALIVE_PING/.test(content));
check('blocked.js: 既存の checkAndRestore(1500) を保持', /setInterval\(checkAndRestore,\s*1500\)/.test(blocked));

console.log('===== 教員アカウント限定: コンソール信号のオリジン検証（なりすまし防止） =====');
// 稼働判定は「教員コンソール（管理アプリ）が使われているか」のみ。児童が開く任意ページからの
// EDU_KEEPALIVE_START 偽装で稼働状態にできないよう、content.js は送信元オリジンを検証する。
check('content.js: コンソール信号のオリジン検証関数がある', /function isTeacherConsoleOrigin\(/.test(content));
check('content.js: script.google.com / *.googleusercontent.com を許可',
  /script\\\.google\\\.com/.test(content) && /googleusercontent\\\.com/.test(content));
check('content.js: 検証に通らない信号は無視する（なりすまし防止）',
  /if \(!isTeacherConsoleOrigin\(ev\)\) return;/.test(content));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
