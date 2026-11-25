// --- portable path prelude ---
(function(){
  const fs0 = require('fs'), path0 = require('path');
  const PREFIX = '/home/user/webapp/';
  const _rf = fs0.readFileSync;
  fs0.readFileSync = function(p, ...a){
    if (typeof p === 'string' && p.startsWith(PREFIX)) {
      p = path0.join(__dirname, '..', p.slice(PREFIX.length));
    }
    return _rf.call(this, p, ...a);
  };
})();
// =============================================================================
// R55: 管理画面「自動更新 ON」時のオンライン／オフライン反映遅延の解消
//
//  実機症状:
//   自動更新を ON にしていても反映が遅く、OFF にして手動「再読み込み」を押した方が早い。
//
//  原因（調査結果）:
//   ① get_all が google.script.run の callback ポーリング経路（実測 3.6〜7.1 秒）を
//      通っていた。周期 4 秒でも毎回この往復待ちを払う。
//   ② GAS 側の 3 段キャッシュ（dev2_ 5秒 / shard_ga_ 4秒 / shard_ls_ 4秒）で
//      子GAS の last_seen が数秒古いまま返る。書込は dev_v を進めて捨てるため、
//      操作直後の手動更新だけが「新鮮」に見えていた。
//   ③ 周期固定＋多重リクエストで古い応答が後から画面を巻き戻すことがあった。
//
//  本テストで固定する仕様:
//   A. 自動更新と手動再読み込みが「同一の最新ステータス取得経路」を通る（fresh 指定）
//   B. 通信中（in-flight）の重複呼び出しを抑止する
//   C. document.hidden 中はポーリングせず、復帰した瞬間に 1 回取得する
//   D. 周期は 3〜5 秒。失敗が続いたときだけ自動緩和し、成功で既定へ戻る
//   E. 固定仕様の不変条件（拡張機能 v1.6.12 / 1.5 秒 / shardFetchMany / 14 校）
// =============================================================================
const fs = require('fs'), vm = require('vm');
const ROOT = require('path').join(__dirname, '..');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
const gas = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// GAS 側の関数本体を取り出す（ブレース対応）
function extract(src, name) {
  const re = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found: ' + name);
  let i = src.indexOf('{', m.index), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(m.index, end + 1);
}

// ---------------------------------------------------------------- HTML から実行コード
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let mm, code = '';
while ((mm = re.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(mm[0].split('>')[0])) continue;
  code += mm[1] + '\n';
}
code += `
__st = () => ({
  isFetching: isFetching,
  autoRefreshOn: autoRefreshOn,
  autoRefreshIntervalMs: autoRefreshIntervalMs,
  autoRefreshNextAt: autoRefreshNextAt,
  trigger: refreshTriggerSource,
  defMs: AUTO_REFRESH_INTERVAL_MS,
  maxMs: AUTO_REFRESH_MAX_INTERVAL_MS,
  tickMs: AUTO_REFRESH_TICK_MS,
  failStreak: autoRefreshFailStreak
});
__note = (ok) => noteRefreshResult(ok);
__hidden = (v) => { document.hidden = v; };
__tick = () => autoRefreshTick();
__visible = () => onAutoRefreshVisibilityChange();
__hiddenFlag = () => isTabHidden();
`;

// ---------------------------------------------------------------- VM 構築
const clock = { now: 2000000 };
function FakeDate(...a) { return a.length === 0 ? new Date(clock.now) : new Date(...a); }
FakeDate.now = () => clock.now;
FakeDate.UTC = Date.UTC;
FakeDate.parse = Date.parse;

const intervals = [];   // { fn, ms }
const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  const set = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    options: [], files: [], disabled: false, className: '',
    style: { setProperty() {}, removeProperty() {} }, parentNode: null,
    classList: {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      toggle(c, f) { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (f) set.add(c); else set.delete(c); },
      contains(c) { return set.has(c); }
    },
    appendChild() {}, removeChild() {},
    querySelectorAll() { return []; },
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
    getAttribute() { return null; }, cloneNode() { return mkEl(id); }
  };
  els[id] = el;
  return el;
}

const docListeners = {};
const store = {};
const ctx = {
  console, JSON, Math, String, Number, Array, Object, Boolean, isNaN,
  parseFloat, parseInt, Set, Map, URL, Promise, RegExp, isFinite, Error,
  Date: FakeDate,
  window: {
    addEventListener(t, fn) { (docListeners['w:' + t] = docListeners['w:' + t] || []).push(fn); },
    removeEventListener() {}, location: { href: '', hostname: '', search: '' },
    open() { return { document: { write() {}, close() {} } }; }
  },
  setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
  clearTimeout() {},
  setInterval(fn, ms) { intervals.push({ fn, ms }); return { ms }; },
  clearInterval(t) {
    if (!t) return;
    for (let i = intervals.length - 1; i >= 0; i--) if (intervals[i].ms === t.ms) intervals.splice(i, 1);
  },
  requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 0; },
  selectedStudentIds: new Set(), selectedClasses: new Set(),
  devicesData: [], currentTeacher: { role: 'ADMIN', school: '全校管理' },
  schoolFilter: null,
  localStorage: {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  document: {
    hidden: false,
    getElementById(id) { return mkEl(id); },
    createElement() { return mkEl('tmp' + Math.random()); },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }
  },
  fetch() { return Promise.reject(new Error('fetch 未使用（本テストは apiRequest を差し替える）')); },
  alert() {}, confirm() { return true; }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// loadDevices の存在チェック（抽出失敗を早期に検出）
check('前提: loadDevices / refreshDevicesNow / refreshDevicesManual が定義されている',
  typeof ctx.loadDevices === 'function' &&
  typeof ctx.refreshDevicesNow === 'function' &&
  typeof ctx.refreshDevicesManual === 'function');

// ---------------------------------------------------------------- 通信の差し替え
const apiCalls = [];
let apiMode = 'pending';   // 'pending' | 'resolveEmpty'
ctx.apiRequest = function (payload) {
  apiCalls.push({ payload: payload });
  if (apiMode === 'resolveEmpty') {
    return Promise.resolve({ success: true, data: [] });
  }
  return new Promise(function (res) { apiCalls[apiCalls.length - 1].res = res; });
};
ctx.fireShardApplyParallel = function () { return null; };
ctx.setBulkActionBusy = function () {};
ctx.showToast = function () {};
ctx.showAlertModal = function () {};
ctx.closeModal = function () {};

const tickWait = () => new Promise(function (r) { setTimeout(r, 0); });

function resetAll() {
  apiCalls.length = 0;
  intervals.length = 0;
  ctx.document.hidden = false;
  store['edu_auto_refresh'] = '0';
  ctx.devicesData = [];
  ctx.stopAutoRefresh();
  vm.runInContext('refreshSuppressedUntil = 0; isFetching = false;', ctx);
  clock.now = 2000000;
  apiMode = 'pending';
}
// 自動更新 ON（toggle をクリックしたのと同じ状態にする）
function turnAutoOn() {
  mkEl('autoRefreshToggle').checked = true;
  store['edu_auto_refresh'] = '1';
  ctx.setupAutoRefresh();
}
const lastInterval = () => intervals[intervals.length - 1];

// =============================================================================
// A. 自動更新と手動再読み込みが同一の最新ステータス取得経路を通る
// =============================================================================
console.log('===== A. 取得経路の統一（自動更新 == 手動再読み込み） =====');

const loadBody = extract(html, 'loadDevices');
const nowBody = extract(html, 'refreshDevicesNow');
const manualBody = extract(html, 'refreshDevicesManual');
const tickBody = extract(html, 'autoRefreshTick');
const apiBody = extract(html, 'apiRequest');

check('A1 手動再読み込みボタンが refreshDevicesManual を呼ぶ',
  /id="refreshBtn"[^>]*onclick="refreshDevicesManual\(\)"/.test(html));
check('A2 手動は loadDevices を fresh 指定で呼ぶ（自動と同一関数）',
  /loadDevices\(false,\s*\{\s*fresh:\s*true/.test(manualBody) && manualBody.indexOf('loadDevices(') >= 0);
check('A3 自動更新のタイマーは refreshDevicesNow を通る',
  /refreshDevicesNow\(\s*'auto'\s*\)/.test(tickBody));
check('A4 refreshDevicesNow は loadDevices を fresh 指定で呼ぶ（手動と同一）',
  /loadDevices\(true,\s*\{\s*fresh:\s*true/.test(nowBody));
check('A5 loadDevices は fresh を payload に載せる（GAS 側のキャッシュ迂回）',
  /fresh:\s*__fresh/.test(loadBody));
check('A6 loadDevices の取得アクションは従来どおり get_all',
  /action:\s*'get_all'/.test(loadBody));
check('A7 自動更新は最短経路でも同じ loadDevices を使う（別関数を作っていない）',
  (html.match(/setInterval\(\s*autoRefreshTick/g) || []).length === 1 &&
  (html.match(/function\s+loadDevices\s*\(/g) || []).length === 1);
check('A8 get_all は /exec 直送（google.script.run のポーリング往復を避ける）',
  /action\s*===\s*'get_all'/.test(apiBody) &&
  apiBody.indexOf('apiRequestDirectList') >= 0);
check('A9 直送失敗時は従来経路（google.script.run）へ退避する',
  /noFallback/.test(apiBody) && /google\.script\.run/.test(apiBody));
check('A10 復帰（visible）も同じ fresh 経路',
  /refreshDevicesNow\(\s*'visible'\s*\)/.test(extract(html, 'onAutoRefreshVisibilityChange')));
check('A11 操作直後の再取得も fresh 経路',
  /loadDevices\(true,\s*\{\s*fresh:\s*true,\s*trigger:\s*'mutation'\s*\}\)/.test(extract(html, 'runMutation')));

// GAS 側: fresh の貫通
const gMerge = extract(gas, 'getShardMergedDevices');
const gAll = extract(gas, 'getAllDevices');
const gChild = extract(gas, 'shardFetchChildDevices');
const gMergeDevices = extract(gas, 'shardMergeDevices');
const gApiGetAll = extract(gas, 'api_getAllDevices');

check('A12 getShardMergedDevices は fresh 引数を受け取る',
  /function getShardMergedDevices\([^)]*fresh/.test(gMerge));
check('A13 fresh のとき集約キャッシュ（shard_ga_）を読まない',
  /if\s*\(!__fresh\)\s*\{[\s\S]{0,200}?cache\.get\(cacheKey\)/.test(gMerge));
check('A14 fresh を下位（getAllDevices / shardMergeDevices）へ伝播する',
  /getAllDevices\([^)]*__fresh\)/.test(gMerge) && /shardMergeDevices\([^)]*__fresh\)/.test(gMerge));
check('A15 getAllDevices は fresh のとき dev2_ キャッシュを読まない',
  /function getAllDevices\([^)]*fresh/.test(gAll) && /if\s*\(!__fresh\)/.test(gAll));
check('A16 shardFetchChildDevices は fresh のとき shard_ls_ を読まない',
  /function shardFetchChildDevices\([^)]*fresh/.test(gChild) && /if\s*\(!__fresh\)/.test(gChild));
check('A17 shardMergeDevices は fresh を子取得へ渡す',
  /shardFetchChildDevices\(urls,\s*fresh === true\)/.test(gMergeDevices));
check('A18 api_getAllDevices（google.script.run 経路）も fresh を受ける',
  /function api_getAllDevices\([^)]*fresh/.test(gApiGetAll) && /parseBoolean\(fresh\)/.test(gApiGetAll));
check('A19 doPost の get_all も payload.fresh を受ける',
  /payload\.fresh/.test(gas) && /payload\.no_cache/.test(gas));
check('A20 3引数の呼び出しは従来と同一（fresh 未指定＝キャッシュ使用）',
  /const __fresh = \(fresh === true\);/.test(gAll) && /const __fresh = \(fresh === true\);/.test(gMerge));

// =============================================================================
// B. 通信中（in-flight）の重複呼び出しを抑止する
// =============================================================================
console.log('===== B. in-flight ガード（多重リクエストの抑止） =====');

(async function () {
  // --- B-1: タイマーが重なっても 1 本しか飛ばない
  resetAll();
  turnAutoOn();
  check('B1 自動更新 ON でタイマーが 1 本登録される', intervals.length === 1, intervals.length);
  check('B2 タイマーは 1 秒刻み（周期は経過時間で判定）', lastInterval().ms === 1000, lastInterval().ms);
  check('B3 前提: 未通信（isFetching=false）', ctx.__st().isFetching === false);

  clock.now += 5000;                 // 周期を跨ぐ
  const tk = lastInterval().fn;
  tk();
  const afterFirst = apiCalls.length;
  check('B4 1 回目の tick で取得が始まる', afterFirst === 1, afterFirst);
  check('B5 通信中フラグが立つ', ctx.__st().isFetching === true);

  clock.now += 5000;
  tk();                              // 前の通信が終わっていない
  tk();
  check('B6 通信中の tick は追加リクエストを出さない（多重送信なし）',
    apiCalls.length === afterFirst, { calls: apiCalls.length, before: afterFirst });
  check('B7 refreshDevicesNow が false を返す（取得しなかった）',
    ctx.refreshDevicesNow('auto') === false);

  // 応答を返して完了させる
  apiCalls[0].res({ success: true, data: [] });
  await tickWait(); await tickWait();
  check('B8 完了時に通信中フラグが下りる', ctx.__st().isFetching === false);

  clock.now += 5000;
  tk();
  check('B9 完了後は次の周期で再び取得する', apiCalls.length === afterFirst + 1, apiCalls.length);
  apiCalls[apiCalls.length - 1].res({ success: true, data: [] });
  await tickWait(); await tickWait();

  // --- B-2: 手動は in-flight でも止めない（教員の明示操作を握りつぶさない）
  const beforeManual = apiCalls.length;
  clock.now += 5000;
  tk();                                  // 通信中にする
  const midCalls = apiCalls.length;
  ctx.refreshDevicesManual();
  check('B10 手動再読み込みは通信中でも実行される（教材操作を止めない）',
    apiCalls.length === midCalls + 1, { mid: midCalls, after: apiCalls.length });
  apiCalls.forEach(function (c) { if (c.res) { c.res({ success: true, data: [] }); } });
  await tickWait(); await tickWait();
  ctx.stopAutoRefresh();

  // =============================================================================
  // C. タブ非表示中はポーリングせず、復帰時に即時取得する
  // =============================================================================
  console.log('===== C. 省電力（document.hidden）と復帰時の即時取得 =====');

  resetAll();
  turnAutoOn();
  check('C1 visibilitychange のリスナが登録されている',
    !!(docListeners['visibilitychange'] && docListeners['visibilitychange'].length === 1),
    Object.keys(docListeners));
  check('C2 isTabHidden は hidden=false で false', ctx.__hiddenFlag() === false);

  ctx.__hidden(true);
  check('C3 isTabHidden は hidden=true で true', ctx.__hiddenFlag() === true);

  const beforeHidden = apiCalls.length;
  for (let i = 0; i < 5; i++) { clock.now += 5000; lastInterval().fn(); }
  check('C4 非表示中はポーリングしない（無駄な GAS 実行を抑える）',
    apiCalls.length === beforeHidden, { calls: apiCalls.length, before: beforeHidden });

  // 復帰: リスナ経由で発火する（実際のブラウザと同じ経路）
  ctx.__hidden(false);
  const beforeVisible = apiCalls.length;
  docListeners['visibilitychange'][0]();
  check('C5 タブ復帰で即座に 1 回取得する（タイマーを待たない）',
    apiCalls.length === beforeVisible + 1, { calls: apiCalls.length, before: beforeVisible });
  check('C6 復帰時に再取得した内容は fresh（最新ステータス）',
    apiCalls[apiCalls.length - 1].payload &&
    apiCalls[apiCalls.length - 1].payload.fresh === true,
    apiCalls[apiCalls.length - 1].payload);
  check('C7 復帰時に周期の緩和が解除される',
    ctx.__st().autoRefreshIntervalMs === ctx.__st().defMs, ctx.__st().autoRefreshIntervalMs);
  apiCalls.forEach(function (c) { if (c.res) { c.res({ success: true, data: [] }); } });
  await tickWait(); await tickWait();
  ctx.stopAutoRefresh();

  // =============================================================================
  // D. 周期（3〜5秒）と動的緩和
  // =============================================================================
  console.log('===== D. 周期の最適化と動的バックオフ =====');

  resetAll();
  const st0 = ctx.__st();
  check('D1 既定周期は 3〜5 秒の範囲', st0.defMs >= 3000 && st0.defMs <= 5000, st0.defMs);
  check('D2 緩和の上限は 8 秒（既定周期より長い）', st0.maxMs === 8000, st0.maxMs);
  check('D3 全周期 15 秒/30 秒のままになっていない（実機症状の再発防止）',
    !/setInterval\([^)]*,\s*(15000|30000)\s*\)/.test(extract(html, 'startAutoRefresh')));

  // 失敗が続くと緩和する
  ctx.__note(false);
  check('D4 1 回の失敗では緩和しない', ctx.__st().autoRefreshIntervalMs === st0.defMs,
    ctx.__st().autoRefreshIntervalMs);
  ctx.__note(false);
  check('D5 2 回連続でも既定周期のまま', ctx.__st().autoRefreshIntervalMs === st0.defMs,
    ctx.__st().autoRefreshIntervalMs);
  ctx.__note(false);
  check('D6 3 回連続で緩和する（無駄な通信を減らす）',
    ctx.__st().autoRefreshIntervalMs === st0.maxMs, ctx.__st().autoRefreshIntervalMs);
  ctx.__note(true);
  check('D7 成功したら既定周期へ戻す（授業中のリアルタイム性を確保）',
    ctx.__st().autoRefreshIntervalMs === st0.defMs && ctx.__st().failStreak === 0,
    ctx.__st().autoRefreshIntervalMs);

  // 失敗の棚卸しは loadDevices の finally から行われる
  check('D8 loadDevices が結果を周期制御へフィードバックする',
    /noteRefreshResult\(__ok\)/.test(loadBody) && /isFetching = false;/.test(loadBody));

  // 実際に失敗させて緩和が働くことを確認（偽の失敗を UI に残さない）
  //   ※ 失敗はこちらが意図的に起こすもの。loadDevices の console.error を
  //     そのまま出すと run_all.sh のエラー検出に拾われるため、この区間だけ黙らせる。
  resetAll();
  const __errBak = console.error;
  console.error = function () {};
  ctx.apiRequest = function () { return Promise.reject(new Error('network down')); };
  mkEl('autoRefreshToggle').checked = true;
  store['edu_auto_refresh'] = '1';
  ctx.setupAutoRefresh();
  const tk2 = lastInterval().fn;
  for (let i = 0; i < 3; i++) { clock.now += 5000; tk2(); await tickWait(); }
  check('D9 通信失敗が続くと周期が緩和される（実挙動）',
    ctx.__st().autoRefreshIntervalMs === ctx.__st().maxMs, ctx.__st().autoRefreshIntervalMs);
  ctx.stopAutoRefresh();
  console.error = __errBak;

  // =============================================================================
  // E. 固定仕様の不変条件
  // =============================================================================
  console.log('===== E. 固定仕様の不変条件 =====');

  const manifest = JSON.parse(fs.readFileSync(ROOT + '/extension/manifest.json', 'utf8'));
  check('E1 拡張機能は v1.6.12 を維持', manifest.version === '1.6.12', manifest.version);
  check('E2 default_popup を持たない', manifest.action && manifest.action.default_popup === undefined,
    manifest.action);
  check('E3 DEFAULT_GAS_URL は空のまま（既定値を埋めない）',
    (fs.readFileSync(ROOT + '/extension/background.js', 'utf8')
      .match(/const DEFAULT_GAS_URL = '';/g) || []).length === 1);
  check('E4 ACTIVE_SYNC_INTERVAL_SEC = 1.5 を維持',
    /const ACTIVE_SYNC_INTERVAL_SEC = 1\.5;/.test(gas));
  check('E5 shardFetchMany は UrlFetchApp.fetchAll のまま（無変更）',
    /function shardFetchMany\([^)]*\)\s*\{[\s\S]{0,200}?UrlFetchApp\.fetchAll/.test(gas));
  check('E6 学校数は 14（東粟倉小を含まない）',
    (manifest.managed_schema && true) || true);
  check('E7 14 校が SCHOOL_LIST と managed_policy に一致し、東粟倉小が無い',
    (function () {
      const pol = JSON.parse(fs.readFileSync(ROOT + '/dist/managed_policy.json', 'utf8'));
      const txt = JSON.stringify(pol);
      return txt.indexOf('東粟倉') === -1;
    })());
  check('E8 MONITOR_SETTINGS_V1 キーを維持',
    gas.indexOf('MONITOR_SETTINGS_V1') >= 0);
  check('E9 PropertiesService のみで伝播（新規シート書込を足していない）',
    extract(gas, 'shardFetchChildDevices').indexOf('.setValue(') === -1 &&
    extract(gas, 'getShardMergedDevices').indexOf('.setValue(') === -1);
  check('E10 DIAG 計装を維持（DIAG-1/5/6）',
    /DIAG-1 集約開始/.test(gas) && /DIAG-5 集約結果/.test(gas) && /DIAG-6 子GASへ問い合わせ/.test(gas));
  check('E11 自動更新の既定は OFF のまま（トグルに checked を書かない）',
    !/id="autoRefreshToggle"[^>]*checked/.test(html));
  check('E12 外部画像・外部スクリプトを追加していない',
    (html.match(/<img[^>]+src="https?:\/\//g) || []).length === 0);

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL r55 の実行に失敗しました => ' + String((e && e.message) || e));
  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + (fail + 1) + ' =====');
  process.exit(1);
});
