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
// ===== fe17: 表示同期（refreshDeviceViews）=====
// 実害: 画面ロック / URL規制を実行したとき、児童一覧の行と上部の集計カードは
//       楽観更新で即座に変わるのに、クラスチップの🔒／🛡バッジだけが
//       次回の全件再取得（1.5秒遅延 + GAS 応答待ち）まで古いまま残っていた。
// 原因: 楽観更新の各所が renderDevices(); updateStatistics(); しか呼んでおらず、
//       クラスチップを描く updateClassFilterOptions() を呼んでいなかった（配線漏れ）。
// 対策: refreshDeviceViews() = renderDevices + updateStatistics + updateClassFilterOptions
//       を作り、楽観更新の10箇所すべてをこれに置き換える。
// ここでは
//   ① 静的: ヘルパーの存在・中身・10箇所の置換漏れゼロ
//   ② 動的: ロック実行時 / 解除時にチップのバッジが即時更新されること
//   ③ 動的: 再描画しても選択中のクラス（チェック状態）が崩れないこと
// を実挙動で固定する。
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
// 「apply:」「revert:」ブロックの中身を取り出す（楽観更新の配線検査用）
function blockAfter(src, key){
  const at = src.indexOf(key);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(open, end + 1);
}

// 名前付きクロージャ（const x = (…) => {…} 形式）のソースを取り出す。
//   executeBulkLock は apply / revert を applyOptimisticLock / revertOptimisticLock
//   という名前付きクロージャに切り出しているため、インラインのブロックだけを見ると
//   「配線されていない」と誤判定してしまう（テスト側のバグ）。
function namedFnSrc(name){
  const declared = fnSrc(name);
  if (declared) return declared;
  const at = code.search(new RegExp('const\\s+' + name + '\\s*='));
  if (at < 0) return '';
  const open = code.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0, end = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return code.slice(at, end + 1);
}

// `apply:` / `revert:` が「直接」「インラインブロック」「名前付きクロージャ経由」の
// いずれの形でも refreshDeviceViews に到達することを確かめる。
function wiringOk(src, key){
  const at = src.indexOf(key);
  if (at < 0) return false;
  const nl = src.indexOf('\n', at);
  const line = src.slice(at, nl < 0 ? src.length : nl);
  if (/refreshDeviceViews\(\)/.test(line)) return true;
  // インラインのブロック（apply: () => { … }）は直後の波括弧の中を見る
  if (/\{\s*$/.test(line)) {
    return /refreshDeviceViews\(\)/.test(blockAfter(src, key));
  }
  // 名前付きクロージャ経由（revert: revertOptimisticLock 等）
  const ids = line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  return ids.some(function (id) {
    return namedFnSrc(id).indexOf('refreshDeviceViews()') !== -1;
  });
}

// ================= A. 静的検査 =================
console.log('===== A. refreshDeviceViews の定義と10箇所の置換 =====');

const helper = fnSrc('refreshDeviceViews');
check('A1 refreshDeviceViews が定義されている', helper !== '');
check('A2 端末一覧の行を描き直す（renderDevices）', /renderDevices\(\)/.test(helper));
check('A3 上部の集計カードを描き直す（updateStatistics）', /updateStatistics\(\)/.test(helper));
check('A4 クラスチップを描き直す（updateClassFilterOptions）', /updateClassFilterOptions\(\)/.test(helper));

// 楽観更新の置換漏れチェック（旧パターンが1つも残っていないこと）
const oldPattern = 'try { renderDevices(); updateStatistics(); } catch (e) {}';
const newPattern = 'try { refreshDeviceViews(); } catch (e) {}';
const oldCount = code.split(oldPattern).length - 1;
const newCount = code.split(newPattern).length - 1;
check('A5 旧パターン（renderDevices+updateStatistics のみ）は残っていない', oldCount === 0, oldCount);
check('A6 refreshDeviceViews への置換がちょうど10箇所', newCount === 10, newCount);

// 5つの操作（実行・解除の両方）が apply / revert の双方で共通ヘルパーを通ること
const ops = [
  ['executeBulkLock (一括ロック)', 'executeBulkLock'],
  ['toggleSingleLock (個別ロック)', 'toggleSingleLock'],
  ['executeBroadcastSubmit (一斉配信)', 'executeBroadcastSubmit'],
  ['executeFilterSubmit (URL規制)', 'executeFilterSubmit'],
  ['quickBroadcastUrl (マイURL配信)', 'quickBroadcastUrl']
];
ops.forEach(function (pair, idx) {
  const body = fnSrc(pair[1]);
  // 関数全体で「apply 用」「revert 用」にそれぞれ1回ずつ配線されていることを見る。
  //   executeBulkLock のように名前付きクロージャへ切り出している実装でも
  //   到達できるよう wiringOk でインライン／名前付きの両形式を解決する。
  const total = body.split('refreshDeviceViews()').length - 1;
  check('A' + (7 + idx) + ' ' + pair[0] + ': apply が refreshDeviceViews を通る',
    wiringOk(body, 'apply:'));
  check('A' + (12 + idx) + ' ' + pair[0] + ': revert が refreshDeviceViews を通る',
    wiringOk(body, 'revert:'));
  // apply と revert の両方＝少なくとも2回呼ばれている（片方だけの配線漏れを防ぐ）
  check('A' + (17 + idx) + ' ' + pair[0] + ': apply/revert の両方が配線済み（2回）',
    total >= 2, total);
});

// ================= 動的ハーネス =================
// 全インラインスクリプトを VM で評価し、DOM を最小スタブで用意する。
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

const DEV = [
  { student_id:'a1', student_name:'テスト太郎', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', is_online:true },
  { student_id:'a2', student_name:'テスト花子', school_name:'第一小学校',
    class_name:'第一小学校5年1組', screen_lock:true, filter_mode:'OFF', is_online:true },
  { student_id:'a3', student_name:'テスト次郎', school_name:'第一小学校',
    class_name:'第一小学校4年1組', screen_lock:false, filter_mode:'OFF', is_online:false }
];

const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN,
  parseFloat, parseInt, Set, Map, URL, Promise,
  window: { addEventListener(){}, removeEventListener(){}, location: { href: '' } },
  setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
  clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  localStorage: { getItem(){ return null; }, setItem(){} },
  document: {
    getElementById(id){ return mkEl(id); },
    createElement(){ return mkEl('tmp' + Math.random()); },
    querySelectorAll(){ return []; }
  },
  alert(){}, confirm(){ return true; }
};
vm.createContext(ctx);

// VM 内の状態を外から操作するための入口を追加してから評価する。
//   let 宣言はグローバルに載らないため、同じスクリプト内で公開する。
code += `
currentTeacher = { role:'ADMIN', school:'全校管理', target_class:'' };
devicesData = ${JSON.stringify(DEV)};
__setDev = (arr) => { devicesData = arr; };
__dev = () => devicesData;
__setSel = (arr) => { selectedClasses.clear(); arr.forEach(c => selectedClasses.add(c)); };
__sel = () => Array.from(selectedClasses);
__chip = () => (document.getElementById('classChipList') || {}).innerHTML || '';
__stat = (id) => document.getElementById(id).textContent;
__refresh = () => refreshDeviceViews();
`;
vm.runInContext(code, ctx);

// 通信・トースト等は副作用だけを無効化する（判定には使わない）
ctx.apiRequest = function(){ return Promise.resolve({ success: true }); };
ctx.loadDevices = function(){};
ctx.fireShardApplyParallel = function(){ return null; };
ctx.setBulkActionBusy = function(){};
ctx.showToast = function(){};
ctx.showAlertModal = function(){};
ctx.closeModal = function(){};
ctx.resolveBulkTargetIds = function(){ return { ids: ['a1','a2'], from: 'selected' }; };

(async function () {
  console.log('===== B. ロック実行時にクラスチップの🔒が即時更新される =====');
  ctx.__refresh();
  let chip = ctx.__chip();
  check('B1 初期状態（5年1組が2台ロック中）でチップに 🔒2 が出る',
    chip.indexOf('🔒2') !== -1, chip.indexOf('🔒2'));
  check('B2 4年1組（ロック0台）には🔒バッジが無い',
    (function () {
      const at = chip.indexOf('第一小学校4年1組');
      if (at < 0) return false;
      return chip.slice(at, at + 220).indexOf('🔒') === -1;
    })());

  // 「解除」してから「実行」し直す → どちらも即時にバッジが追随するか
  await ctx.executeBulkLock(false);
  chip = ctx.__chip();
  check('B3 ロック解除の直後に 🔒 バッジが消える（即時反映）',
    chip.indexOf('🔒') === -1, chip.indexOf('🔒'));
  check('B4 集計カードのロック数も 0 になる', ctx.__stat('statLocked') === 0, ctx.__stat('statLocked'));

  await ctx.executeBulkLock(true);
  chip = ctx.__chip();
  check('B5 ロック実行の直後に 🔒2 が再び出る（即時反映）',
    chip.indexOf('🔒2') !== -1, chip.indexOf('🔒2'));
  check('B6 集計カードのロック数も 2 になる', ctx.__stat('statLocked') === 2, ctx.__stat('statLocked'));

  console.log('===== C. URL規制の状態もチップに即時反映される =====');
  // URL規制の実行経路（executeFilterSubmit）も同じヘルパーを通ることは A で静的確認済み。
  // ここでは状態変化そのものがチップへ即時に出ることを実挙動で確かめる。
  const d1 = ctx.__dev().find(d => d.student_id === 'a1');
  d1.filter_mode = 'BLACKLIST';
  ctx.__refresh();
  chip = ctx.__chip();
  check('C1 URL規制中のクラスに 🛡1 が出る', chip.indexOf('🛡1') !== -1, chip.indexOf('🛡1'));
  d1.filter_mode = 'OFF';
  ctx.__refresh();
  chip = ctx.__chip();
  check('C2 規制解除の直後に 🛡 バッジが消える', chip.indexOf('🛡') === -1, chip.indexOf('🛡'));

  console.log('===== D. 再描画してもクラスの選択状態は崩れない =====');
  ctx.__setSel(['第一小学校5年1組']);
  ctx.__refresh();
  chip = ctx.__chip();
  check('D1 選択中のクラスは selectedClasses に保持される',
    ctx.__sel().join(',') === '第一小学校5年1組', ctx.__sel());
  check('D2 選択中チップに is-selected が付く', /class-chip[^"]*is-selected/.test(chip));
  check('D3 選択中チップのチェックボックスが checked になる',
    /checked/.test(chip) && chip.indexOf('setClassSelected') !== -1);
  check('D4 非選択クラスのチップは is-selected にならない',
    (function () {
      const at = chip.indexOf('第一小学校4年1組');
      if (at < 0) return false;
      return chip.slice(Math.max(0, at - 200), at).indexOf('is-selected') === -1;
    })());

  // ロック操作を挟んでも選択は維持される
  await ctx.executeBulkLock(true);
  check('D5 ロック操作の後もクラス選択が維持される（再描画で崩れない）',
    ctx.__sel().join(',') === '第一小学校5年1組', ctx.__sel());

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL fe17 の実行に失敗しました => ' + String((e && e.message) || e));
  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + (fail + 1) + ' =====');
  process.exit(1);
});
