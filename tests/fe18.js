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
// ===== fe18: 楽観更新保護（ロールバックバウンス / 先祖返り）=====
//
// 実害（実機動画のタイムライン）:
//   00:12 ロック解除をクリック → 行「解除中」・チップの🔒消滅（楽観更新・正常）
//   00:18 約5秒後、操作していないのに「ロック中」へ先祖返りし 🔒1 が再出現
//   00:33 さらに約15秒後、ようやく「解除中」に戻って落ち着く
//
// 原因:
//   ・操作直後も 5 秒間隔の自動更新（loadDevices(true)）が止まらない
//   ・loadSeq は「新しい取得が始まったら古い応答を捨てる」だけで、
//     「その応答が【操作より前】に発行されたか」を見ていない
//   ・GAS の /exec は 3.8 秒かかるため、操作前発行の取得が操作後に結果を返し、
//     devicesData を丸ごと差し替えて楽観更新を消す
//   ・refreshSuppressedUntil という抑止の器はあったが未来時刻で武装された箇所が
//     1つも無く、実質デッドコードだった
//
// 対策（二段構え）:
//   ① optimisticGuard … 児童ID×フィールドで「期待値」と「保護期限」を持ち、
//      期限内に古い値が来たら上書きをスキップ（値を守る）
//   ② loadSeq++（世代飛ばし）… 操作開始時に世代を進め、操作前に発行された
//      取得の応答そのものを破棄（到着を遮断）
//
// ここでは「古い応答が後から届いても先祖返りしないこと」を実挙動で固定する。
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, code = '';
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue; code += m[1] + '\n'; }

let pass = 0, fail = 0;
function check(name, cond, extra){
  if (cond) { console.log('PASS', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); pass++; }
  else { console.log('FAIL', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); fail++; }
}

// 関数ソース抽出（波括弧の対応を数えて切り出す）
function fnSrc(name){
  const start = code.search(new RegExp('function\\s+' + name + '\\s*\\('));
  if (start < 0) return '';
  let i = code.indexOf('{', start), depth = 0, end = -1;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return code.slice(start, end + 1);
}

// ================= A. 静的検査 =================
console.log('===== A. 保護レジストリと世代管理の配線 =====');

const armSrc = fnSrc('armOptimisticGuard');
const clearSrc = fnSrc('clearOptimisticGuard');
const recSrc = fnSrc('reconcileOptimisticGuard');
const loadSrc = fnSrc('loadDevices');
const runSrc = fnSrc('runMutation');

check('A1 armOptimisticGuard が定義されている', armSrc !== '');
check('A2 clearOptimisticGuard が定義されている', clearSrc !== '');
check('A3 reconcileOptimisticGuard が定義されている', recSrc !== '');

// 保護期間は要件1の 10〜15 秒の範囲内であること
const msMatch = code.match(/const\s+OPTIMISTIC_GUARD_MS\s*=\s*(\d+)/);
const guardMs = msMatch ? Number(msMatch[1]) : -1;
check('A4 保護期間が 10〜15 秒（要件1の範囲）', guardMs >= 10000 && guardMs <= 15000, guardMs);

check('A5 保護レジストリ optimisticGuard が宣言されている',
  /let\s+optimisticGuard\s*=\s*\{\s*\}/.test(code));

// loadDevices は採用前に突き合わせ、そのうえで devicesData を差し替える
const reconcileAt = loadSrc.indexOf('reconcileOptimisticGuard');
const assignAt = loadSrc.indexOf('devicesData = ');
check('A6 loadDevices が devicesData 差し替えより前に reconcile する',
  reconcileAt !== -1 && assignAt !== -1 && reconcileAt < assignAt,
  { reconcileAt, assignAt });

check('A7 runMutation が操作開始時に loadSeq を進める（世代飛ばし・要件2）',
  /loadSeq\+\+/.test(runSrc));

// 失敗（revert）時は保護を解除する（残すと以後の正当な更新まで拒む）
const clearCalls = (runSrc.match(/clearOptimisticGuard\(/g) || []).length;
check('A8 runMutation が失敗時に保護を解除する（同期/非同期の2経路）',
  clearCalls >= 2, clearCalls);
check('A9 保護解除は revert と同じ経路にある',
  /catch\s*\(eStart\)[\s\S]*?clearOptimisticGuard/.test(runSrc) &&
  /\.catch\(function\s*\(err\)[\s\S]*?clearOptimisticGuard/.test(runSrc));

// 5つの操作すべてが「保護の装着」と「失敗時の解除対象(guardIds)」を持つ
const ops = [
  ['executeBulkLock (一括ロック)', 'executeBulkLock'],
  ['toggleSingleLock (個別ロック)', 'toggleSingleLock'],
  ['executeBroadcastSubmit (一斉配信)', 'executeBroadcastSubmit'],
  ['executeFilterSubmit (URL規制)', 'executeFilterSubmit'],
  ['quickBroadcastUrl (マイURL配信)', 'quickBroadcastUrl']
];
ops.forEach(function (pair, idx) {
  const body = fnSrc(pair[1]);
  check('A' + (10 + idx) + ' ' + pair[0] + ': 操作前に対象児童の期待値を記録する',
    /armOptimisticGuard\(/.test(body));
  check('A' + (15 + idx) + ' ' + pair[0] + ': 失敗時に保護を解除できる（guardIds）',
    /guardIds\s*:/.test(body));
});

// 装着はちょうど5箇所（関数定義1 + 呼び出し5 = 6 出現）
const armCalls = (code.match(/armOptimisticGuard\(/g) || []).length;
check('A20 保護の装着はちょうど5箇所（定義を除く）', armCalls === 6, armCalls);

// ================= 動的ハーネス =================
const classState = {};
function mkEl(id){
  if (classState[id]) return classState[id];
  const set = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    style: { setProperty(){}, removeProperty(){} },
    classList: {
      add(c){ set.add(c); }, remove(c){ set.delete(c); },
      toggle(c, force){
        if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
        else if (force) { set.add(c); } else { set.delete(c); }
      },
      contains(c){ return set.has(c); }
    },
    appendChild(){}, querySelectorAll(){ return []; }, addEventListener(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; }
  };
  classState[id] = el;
  return el;
}

// 端末フィクスチャ: 5年1組の2台がロック中、4年1組の1台は非ロック
const DEV = [
  { student_id:'a1', student_name:'テスト太郎', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', broadcast_url:'', is_online:true },
  { student_id:'a2', student_name:'テスト花子', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', broadcast_url:'', is_online:true },
  { student_id:'a3', student_name:'テスト次郎', school_name:'第一小学校',
    class_name:'第一小学校4年1組', screen_lock:false, filter_mode:'OFF', broadcast_url:'', is_online:false }
];
const clone = (o) => JSON.parse(JSON.stringify(o));

const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN,
  parseFloat, parseInt, Set, Map, URL, Promise,
  window: { addEventListener(){}, removeEventListener(){}, location: { href: '' } },
  // このVMでは setTimeout を「記録するだけ」にする。
  //   runMutation の成功後 loadDevices が勝手に走ると、保留 Promise の
  //   順番がずれて検証したい経路を外してしまうため。
  setTimeout: function (fn) { pendingTimers.push(fn); return 0; },
  clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  localStorage: { getItem(){ return null; }, setItem(){} },
  document: {
    getElementById(id){ return mkEl(id); },
    createElement(){ return mkEl('tmp' + Math.random()); },
    querySelectorAll(){ return []; }
  },
  alert(){}, confirm(){ return true; }
};
const pendingTimers = [];
vm.createContext(ctx);

// VM 内の状態を外から操作する入口（let 宣言はグローバルに載らないため同スクリプト内で公開）
code += `
currentTeacher = { role:'ADMIN', school:'全校管理', target_class:'' };
devicesData = [];
__setDev = (arr) => { devicesData = arr; };
__dev = () => devicesData;
__lockOf = (id) => { const d = devicesData.find(x => x.student_id === id); return d ? !!d.screen_lock : null; };
__filterOf = (id) => { const d = devicesData.find(x => x.student_id === id); return d ? String(d.filter_mode || '') : null; };
__guard = () => optimisticGuard;
__resetGuard = () => { optimisticGuard = {}; };
__expireGuard = (ids) => { (ids||[]).forEach(id => { const g = optimisticGuard[id]; if (!g) return; Object.keys(g).forEach(f => { g[f].until = Date.now() - 1; }); }); };
__setSeq = (v) => { loadSeq = v; };
__getSeq = () => loadSeq;
__setSuppress = (v) => { refreshSuppressedUntil = v; };
__setFilter = (w, b) => { filterModalState = { white: w || [], black: b || [] }; };
__chip = () => (document.getElementById('classChipList') || {}).innerHTML || '';
__stat = (id) => document.getElementById(id).textContent;
__runTimers = () => { const t = pendingTimers.splice(0); t.forEach(f => { try { f(); } catch (e) {} }); };
`;
vm.runInContext(code, ctx);

// 通信は「保留 Promise」にして、応答の到着順をテストから制御する
const apiQueue = [];
ctx.apiRequest = function (payload) {
  return new Promise(function (res, rej) { apiQueue.push({ res: res, rej: rej, payload: payload }); });
};
ctx.fireShardApplyParallel = function(){ return null; };
ctx.setBulkActionBusy = function(){};
ctx.showToast = function(){};
ctx.showAlertModal = function(){};
ctx.closeModal = function(){};
ctx.setBulkActionBusy = function(){};
ctx.resolveBulkTargetIds = function(){ return { ids: ['a1','a2'], from: 'selected' }; };

// Node 側の setTimeout（VM のスタブとは別物）で 1 tick 待つ
const tick = () => new Promise(function (r) { setTimeout(r, 0); });

// 各セクションの前提を毎回作り直す
function resetAll(devs, ids) {
  apiQueue.length = 0;
  pendingTimers.length = 0;
  ctx.__resetGuard();
  ctx.__setDev(clone(devs));
  ctx.__setSeq(0);
  ctx.__setSuppress(0);
  ctx.resolveBulkTargetIds = function(){ return { ids: ids || ['a1','a2'], from: 'selected' }; };
}
const lastReq = () => apiQueue[apiQueue.length - 1];

const OLD_LOCKED = [
  { student_id:'a1', student_name:'テスト太郎', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', broadcast_url:'', is_online:true },
  { student_id:'a2', student_name:'テスト花子', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', broadcast_url:'', is_online:true },
  { student_id:'a3', student_name:'テスト次郎', school_name:'第一小学校',
    class_name:'第一小学校4年1組', screen_lock:false, filter_mode:'OFF', broadcast_url:'', is_online:false }
];

(async function () {

  // ============ B. ロック解除直後に古い応答が届いても先祖返りしない ============
  console.log('===== B. ロック解除 → 古い応答が後から到着（本丸） =====');
  resetAll(DEV, ['a1','a2']);
  await ctx.executeBulkLock(false);
  await tick();

  check('B1 楽観更新で即座に解除される（押下直後）', ctx.__lockOf('a1') === false, ctx.__lockOf('a1'));

  // 操作後に発行された取得（＝操作前のデータを返すサーバー応答）を後から解決する
  const pB = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(OLD_LOCKED) });
  await pB;
  await tick();

  check('B2 古い応答が届いても先祖返りしない（screen_lock=false のまま）',
    ctx.__lockOf('a1') === false && ctx.__lockOf('a2') === false,
    [ctx.__lockOf('a1'), ctx.__lockOf('a2')]);

  const chipB = ctx.__chip();
  check('B3 古い応答が届いてもチップに 🔒 が再出現しない',
    chipB.indexOf('🔒') === -1, chipB.indexOf('🔒'));

  check('B4 集計カードのロック数も 0 のまま', ctx.__stat('statLocked') === 0, ctx.__stat('statLocked'));

  // ============ C. サーバーが期待値を返したら保護を解除する ============
  console.log('===== C. サーバーが追いついたら保護を解除（永久に固まらない） =====');
  resetAll(DEV, ['a1','a2']);
  await ctx.executeBulkLock(false);
  await tick();
  check('C0 前提: 保護が装着されている', !!ctx.__guard()['a1'], Object.keys(ctx.__guard()));

  const pC1 = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(DEV).map(function (d) { d.screen_lock = false; return d; }) });
  await pC1;
  await tick();
  check('C1 サーバーが期待値（解除）を返したら保護を解除する', !ctx.__guard()['a1'], Object.keys(ctx.__guard()));

  // 保護が外れたので、以後はサーバーの値に素直に従う（＝新しい真実を受け入れる）
  const pC2 = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(OLD_LOCKED) });
  await pC2;
  await tick();
  check('C2 保護解除後はサーバー値に従う（以後の正当な更新を拒まない）',
    ctx.__lockOf('a1') === true, ctx.__lockOf('a1'));

  // ============ D. 期限切れと世代管理 ============
  console.log('===== D. 保護期限の失効と世代飛ばし（要件2） =====');
  resetAll(DEV, ['a1','a2']);
  await ctx.executeBulkLock(false);
  await tick();
  ctx.__expireGuard(['a1','a2']);
  const pD1 = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(OLD_LOCKED) });
  await pD1;
  await tick();
  check('D1 保護期限を過ぎたらサーバー値に従う（画面が永久に固まらない）',
    ctx.__lockOf('a1') === true, ctx.__lockOf('a1'));

  // 操作【前】に発行された取得の応答は、後から届いても破棄される
  resetAll(DEV, ['a1','a2']);
  const preOp = ctx.loadDevices(true);   // ← 操作より前に発行（mySeq=1）
  await tick();
  await ctx.executeBulkLock(false);      // ← ここで loadSeq が進む
  await tick();

  const seqAfterOp = ctx.__getSeq();
  lastReq(); // 参照のみ
  apiQueue[0].res({ success: true, data: clone(OLD_LOCKED) });  // 操作前発行の応答を解決
  await preOp;
  await tick();

  check('D2 操作開始時に世代が進む（loadSeq++／要件2）', seqAfterOp >= 2, seqAfterOp);
  check('D3 操作前に発行された取得の応答は破棄され、画面が変化しない',
    ctx.__lockOf('a1') === false, ctx.__lockOf('a1'));

  // ============ E. URL規制の実行・解除でも同じ ============
  console.log('===== E. URL規制の実行／解除でも先祖返りしない =====');
  resetAll(DEV, ['a1','a2']);
  ctx.__setFilter([], []);
  mkEl('modalFilterMode').value = 'BLACKLIST';
  await ctx.executeFilterSubmit();
  await tick();
  check('E1 規制実行が即時反映される', ctx.__filterOf('a1') === 'BLACKLIST', ctx.__filterOf('a1'));

  const pE2 = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(OLD_LOCKED) });   // 規制 OFF の古いデータ
  await pE2;
  await tick();
  check('E2 古い応答が届いても規制状態が先祖返りしない',
    ctx.__filterOf('a1') === 'BLACKLIST', ctx.__filterOf('a1'));

  // 解除（OFF）でも同じく先祖返りしない
  resetAll(DEV, ['a1','a2']);
  ctx.__setDev(clone(DEV).map(function (d) { d.filter_mode = 'BLACKLIST'; return d; }));
  ctx.__setFilter([], []);
  mkEl('modalFilterMode').value = 'OFF';
  await ctx.executeFilterSubmit();
  await tick();
  check('E3a 規制解除が即時反映される', ctx.__filterOf('a1') === 'OFF', ctx.__filterOf('a1'));

  const pE3 = ctx.loadDevices(true);
  await tick();
  lastReq().res({ success: true, data: clone(DEV).map(function (d) { d.filter_mode = 'BLACKLIST'; return d; }) });
  await pE3;
  await tick();
  check('E3 解除（OFF）でも古い応答で規制中に戻らない',
    ctx.__filterOf('a1') === 'OFF', ctx.__filterOf('a1'));

  // ============ F. 通信失敗（revert）時は保護も解除する ============
  console.log('===== F. 通信失敗で巻き戻したら保護も解除する =====');
  resetAll(DEV, ['a1','a2']);
  await ctx.executeBulkLock(false);
  await tick();
  check('F0 前提: 保護が装着され、画面は解除済み',
    !!ctx.__guard()['a1'] && ctx.__lockOf('a1') === false,
    { guard: Object.keys(ctx.__guard()), lock: ctx.__lockOf('a1') });

  lastReq().rej(new Error('network down'));
  await tick(); await tick();
  await tick();

  check('F1 通信失敗で revert したら保護も解除される', !ctx.__guard()['a1'], Object.keys(ctx.__guard()));
  check('F2 失敗時は操作前の状態（ロック中）に戻る', ctx.__lockOf('a1') === true, ctx.__lockOf('a1'));

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL fe18 の実行に失敗しました => ' + String((e && e.message) || e));
  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + (fail + 1) + ' =====');
  process.exit(1);
});
