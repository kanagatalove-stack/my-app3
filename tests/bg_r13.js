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
// 稼働中=1.5秒／非稼働=15秒。ping は常時届くが、doPost はこのレートで抑える。
console.log('===== maybeSync: 稼働中=1.5秒／非稼働=15秒 のレート制御 =====');
let t = 1000000;
const calls = [];
const ctx = {
  console, JSON, String, Object, Array, RegExp, Error, Number, Math,
  Date: { now: () => t },
  chrome: { alarms: { create:(name,opt)=>calls.push({name,opt}), clear(){}, clearAll(){} } },
  syncWithGas: () => { calls.push({sync:true}); return Promise.resolve(); }
};
const syncCount = () => calls.filter(c=>c.sync).length;
vm.createContext(ctx);
vm.runInContext(
  'const ACTIVE_SYNC_MS = 1500;\nconst IDLE_SYNC_MS = 15000;\nlet lastSyncMs = 0;\nlet keepaliveActive = true;\n' +
  extract('maybeSync') + '\n' + extract('ensureSyncLoop') +
  '\n__sync=maybeSync; __ensure=ensureSyncLoop; __setActive=(v)=>{keepaliveActive=v;};', ctx);

ctx.__sync();
check('稼働中: 初回の maybeSync で同期する', syncCount() === 1, syncCount());
ctx.__sync();
check('稼働中: 直後の再呼び出しは 1.5 秒未満なのでスキップ（doPost を抑える）', syncCount() === 1, syncCount());
t += 1600;
ctx.__sync();
check('稼働中: 1.5 秒経過後は同期する（3秒以内反映の要）', syncCount() === 2, syncCount());

ctx.__setActive(false);
const beforeIdle = syncCount();
t += 1000;
ctx.__sync();
check('非稼働: 1 秒では同期しない（15秒レートで負荷削減）', syncCount() === beforeIdle, syncCount());
t += 15000;
ctx.__sync();
check('非稼働: 15 秒経過で省電力同期する', syncCount() === beforeIdle + 1, syncCount());

ctx.__ensure();
check('ensureSyncLoop が 30 秒アラーム(syncAlarm)を登録', calls.some(c => c.name === 'syncAlarm' && c.opt.periodInMinutes === 0.5), calls.filter(c=>c.name).map(c=>c.name));

// ---- ソース静的チェック ----
console.log('===== background.js: レート制御の配線 =====');
check('alarm ハンドラが syncAlarm/keepAliveAlarm を処理', /alarm\.name === 'syncAlarm' \|\| alarm\.name === 'keepAliveAlarm'/.test(bg));
check('alarm 受信時に maybeSync() を呼ぶ', /onAlarm[\s\S]{0,400}?maybeSync\(\)/.test(bg));
check('initializeClient が ensureSyncLoop() を呼ぶ', /async function initializeClient\(\)[\s\S]*?ensureSyncLoop\(\);/.test(bg));
check('ACTIVE_SYNC_MS = 1500 / IDLE_SYNC_MS = 15000', /const ACTIVE_SYNC_MS = 1500;/.test(bg) && /const IDLE_SYNC_MS = 15000;/.test(bg));
check('KEEPALIVE_PING ハンドラが存在', /message\.type === 'KEEPALIVE_PING'/.test(bg));
check('KEEPALIVE_PING ハンドラが maybeSync を呼ぶ', /message\.type === 'KEEPALIVE_PING'[\s\S]*?maybeSync\(\)/.test(bg));

console.log('===== 送信側: content/lock/blocked が 1500ms で ping =====');
function senderOk(src, label){
  const hasPing = /type:\s*'KEEPALIVE_PING'/.test(src);
  // ping 送信ブロックが 1500ms 間隔であること
  const intervalOk = /setInterval\(\(\)\s*=>\s*\{[\s\S]{0,200}?KEEPALIVE_PING[\s\S]{0,200}?\}\s*,\s*1500\s*\)/.test(src);
  check(label+': KEEPALIVE_PING を送信', hasPing);
  check(label+': 1500ms 間隔', intervalOk);
}
senderOk(content, 'content.js');
senderOk(lock, 'lock.js');
senderOk(blocked, 'blocked.js');
check('content.js: トップフレームのみ ping（iframe 暴発防止）', /window\.top === window[\s\S]{0,400}?KEEPALIVE_PING/.test(content));
check('blocked.js: 既存の checkAndRestore(1500) を保持', /setInterval\(checkAndRestore,\s*1500\)/.test(blocked));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
