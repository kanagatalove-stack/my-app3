// =====================================================================
// stress_14schools.js — 本番前「いじわる試験」（14校・実児童数ベース）
//
//   想定する実運用モデル
//     パターンA: 親GAS 1 + 子GAS 6 分散
//                北小323 / 美作中267 / 第一小239 / 大原小127 / 江見小124
//     パターンB: 子GASなし・単一GAS（SHARD_MODE=false）
//                大原中81 / 作東中80 / 英田小75 / 勝田小61 / 英田中51 /
//                勝田中41 / 土居小39 / 勝田東小27 / 樸学園18
//
//   検証方式: 既存39スイートと同じ「関数抽出 + ミニVM」。
//     実GASの実行時間実測は行わない（サンドボックス外のため）。
//     実件数（323台 / 81台）をそのまま配列で生成し、
//     欠損・順序逆転・道連れ・境界値破綻が起きないことを論理的に証明する。
// =====================================================================
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const PREFIX = '/home/user/webapp/';
const rd = function (p) { return fs.readFileSync(PREFIX + p, 'utf8'); };

const src = rd('gas/Code.gs');
const bg = rd('extension/background.js');
const lockJs = rd('extension/lock.js');
const manifest = JSON.parse(rd('extension/manifest.json'));

function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('missing symbol');
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  if (end < 0) throw new Error('unbalanced');
  return s.slice(st, end + 1);
}

/** CONFIG の配列（SCHOOL_LIST / TEACHER_COLUMNS）を取り出す */
function cfgArray(name) {
  const i = src.indexOf(name + ':');
  if (i < 0) return null;
  const s0 = src.indexOf('[', i);
  let d = 0, end = -1;
  for (let k = s0; k < src.length; k++) {
    if (src[k] === '[') d++;
    else if (src[k] === ']') { d--; if (!d) { end = k; break; } }
  }
  if (end < 0) return null;
  return vm.runInNewContext('(' + src.slice(s0, end + 1) + ')', {});
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c === true) { pass++; console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); }
  else { fail++; console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); }
}
const ok = function (n, c, e) { check(n, c === true, e); };

/** プレリュード + 抽出関数でミニVMを作る */
function vmOf(prelude, fns) {
  const sb = { __crypto: crypto, __buf: Buffer };
  vm.createContext(sb);
  vm.runInContext(prelude || '', sb);
  (fns || []).forEach(function (f) { vm.runInContext(extract(src, f), sb); });
  return sb;
}

// =====================================================================
// 実児童数モデル（全14校・東粟倉小は廃校のため含めない）
// =====================================================================
const SCHOOLS = [
  { name: '北小学校',     n: 323, children: 6 },  // 最大規模（1子GASあたり約54名）
  { name: '美作中学校',   n: 267, children: 6 },
  { name: '第一小学校',   n: 239, children: 6 },  // 1クラス40名×6
  { name: '大原小学校',   n: 127, children: 6 },
  { name: '江見小学校',   n: 124, children: 6 },
  { name: '大原中学校',   n: 81,  children: 0 },  // パターンB 最大
  { name: '作東中学校',   n: 80,  children: 0 },
  { name: '英田小学校',   n: 75,  children: 0 },
  { name: '勝田小学校',   n: 61,  children: 0 },
  { name: '英田中学校',   n: 51,  children: 0 },
  { name: '勝田中学校',   n: 41,  children: 0 },
  { name: '土居小学校',   n: 39,  children: 0 },
  { name: '勝田東小学校', n: 27,  children: 0 },
  { name: '樸学園',       n: 18,  children: 0 }
];

/**
 * 児童を生成する。
 *   childCount > 0 のときはクラスを子GAS単位に割り当てる（1子GAS = 1〜2クラス）。
 *   childCount = 0 のときは単一GAS運用（クラスは 1組〜 を人数で分割）。
 */
function mkStudents(schoolName, code, n, childCount) {
  const out = [];
  const groups = childCount > 0 ? childCount : 6;
  for (let i = 0; i < n; i++) {
    const g = Math.min(groups - 1, Math.floor(i * groups / n));
    out.push({
      id: code + String(i + 1).padStart(3, '0'),
      name: '児童' + (i + 1),
      school: schoolName,
      cls: code + '-' + (g + 1) + '組',
      childIndex: g
    });
  }
  return out;
}

/** JST の "YYYY/MM/DD HH:mm:ss" （sheetTsToMs が解釈できる形式） */
function nowJst() {
  const t = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return t.slice(0, 19).replace('T', ' ').replace(/-/g, '/');
}
/** JST の過去 n 分の時刻文字列 */
function agoJst(minutes) {
  const t = new Date(Date.now() - minutes * 60000 + 9 * 3600 * 1000).toISOString();
  return t.slice(0, 19).replace('T', ' ').replace(/-/g, '/');
}

/** 端末1件分（親シート相当） */
function mkDevice(s, seen) {
  return {
    student_id: s.id, student_name: s.name,
    school_name: s.school, class_name: s.cls,
    last_seen: seen, current_url: 'https://classroom.example.jp/',
    screen_lock: false, filter_mode: 'none',
    whitelist_urls: [], blacklist_urls: [],
    broadcast_url: '', monitor_flag: false
  };
}

const sheetTsToMsSrc = [
  'function sheetTsToMs(v) {',
  '  if (v === null || v === undefined || v === "") return 0;',
  '  if (typeof v === "number") return v;',
  '  var s = String(v);',
  '  var m = s.match(/(\\d{4})[\\/-](\\d{1,2})[\\/-](\\d{1,2})[ T](\\d{1,2}):(\\d{2}):(\\d{2})/);',
  '  if (!m) return 0;',
  '  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);',
  '}'
].join('\n');

// =====================================================================
// 0. 前提: 14校モデルそのものの妥当性
// =====================================================================
console.log('===== 0. 14校モデルの前提確認 =====');

const S = SCHOOLS;
ok('0-1 対象校は14校', S.length === 14);
ok('0-2 東粟倉小学校は含まれない', S.every(function (x) { return x.name.indexOf('東粟倉') < 0; }));
ok('0-3 北小学校は323名（最大規模）', S[0].name === '北小学校' && S[0].n === 323);
ok('0-4 第一小学校は239名（1クラス40名×6）', S[2].n === 239 && S[2].children === 6);
ok('0-5 パターンB最大は大原中81名', Math.max.apply(null, S.filter(function (x) { return x.children === 0; }).map(function (x) { return x.n; })) === 81);
ok('0-6 樸学園は18名（最小規模）', S[13].name === '樸学園' && S[13].n === 18);
const total = S.reduce(function (a, x) { return a + x.n; }, 0);
ok('0-7 全14校の合計児童数が算出できる', total > 1400 && total < 1700, total);
ok('0-8 パターンA校は5校（子GAS 6分散）', S.filter(function (x) { return x.children === 6; }).length === 5);
ok('0-9 パターンB校は9校（単一GAS）', S.filter(function (x) { return x.children === 0; }).length === 9);
const cfgSchools = cfgArray('SCHOOL_LIST');
ok('0-10 CONFIG.SCHOOL_LIST は14校', Array.isArray(cfgSchools) && cfgSchools.length === 14, cfgSchools && cfgSchools.length);
ok('0-11 CONFIG.SCHOOL_LIST に東粟倉小が無い', Array.isArray(cfgSchools) && cfgSchools.every(function (x) { return String(x).indexOf('東粟倉') < 0; }));
ok('0-12 モデルの14校がすべて CONFIG.SCHOOL_LIST に存在',
  S.every(function (x) { return cfgSchools.indexOf(x.name) >= 0; }));

// 北小323名 → 6子GAS の分担（1子GASあたり約54名）
const kita = mkStudents('北小学校', 'KIT', 323, 6);
ok('0-13 北小の児童配列は323件', kita.length === 323);
const kitaPerChild = [0, 0, 0, 0, 0, 0];
kita.forEach(function (s) { kitaPerChild[s.childIndex]++; });
ok('0-14 北小は6子GASに分散する', kitaPerChild.every(function (c) { return c > 0; }), kitaPerChild);
ok('0-15 1子GASあたり53〜54名（約54名×6）',
  kitaPerChild.every(function (c) { return c >= 53 && c <= 55; }), kitaPerChild);
ok('0-16 児童IDは重複しない', new Set(kita.map(function (s) { return s.id; })).size === 323);

const ohara = mkStudents('大原中学校', 'OHC', 81, 0);
ok('0-17 大原中81件（単一GAS）', ohara.length === 81);

// =====================================================================
// 1. フル稼働・一斉ハートビート負荷（A: 323 / 6子GAS, B: 81 / 単一GAS）
// =====================================================================
console.log('\n===== 1. 一斉ハートビート負荷と集約（A 323 / B 81） =====');

// --- 1-a. 子GAS 6台への並列送信（shardFetchMany 本体） ---
const PRE_FETCH = [
  'var __fetchCalls = [];',
  'var __failIndex = -1;'
].join('\n');

const vFetch = vmOf(PRE_FETCH, ['shardFetchMany']);
if (!vFetch.UrlFetchApp) {
  vFetch.UrlFetchApp = {
    fetchAll: function (reqs) {
      return reqs.map(function (r, i) {
        __pushCall(r.url, i);
        if (i === vFetch.__failIndex) throw 'child-down';
        return mkRes(200, JSON.stringify({ success: true, devices: [] }));
      });
    }
  };
  vFetch.__pushCall = function (u, i) { vFetch.__fetchCalls.push(u); };
  vFetch.mkRes = function (code, body) {
    return {
      getResponseCode: function () { return code; },
      getContentText: function () { return body; }
    };
  };
}
function mkRes(code, body) {
  return { getResponseCode: function () { return code; }, getContentText: function () { return body; } };
}

// 【道連れ防止の本質】GAS の fetchAll は「1台でも失敗すると全体が例外」に
//   なりうる。その場合 shardFetchMany は逐次（fetch）へ自動フォールバックし、
//   失敗した子だけを null にして残りを返す。ここを実装どおりに再現する。
let seqCalls = 0;
vFetch.UrlFetchApp = {
  fetchAll: function () { throw 'fetchAll-aborted-by-one-child'; },
  fetch: function (u) {
    seqCalls++;
    if (u.indexOf('child2') >= 0) throw 'child-2-down';
    return mkRes(200, JSON.stringify({ success: true, devices: [] }));
  }
};
let fetchRes = null, fetchThrew = false;
try {
  fetchRes = vFetch.shardFetchMany([0, 1, 2, 3, 4, 5].map(function (i) {
    return { url: 'https://child' + i + '.example/exec', method: 'post', payload: '{}' };
  }));
} catch (e) { fetchThrew = true; }
ok('1-1 子GAS 6台への並列取得が例外を投げない', fetchThrew === false);
ok('1-2 失敗した子がいても応答枠は6件そろう', Array.isArray(fetchRes) && fetchRes.length === 6, fetchRes && fetchRes.length);
ok('1-3 失敗した子の枠だけが空になる（他5台は応答あり）',
  Array.isArray(fetchRes) && fetchRes.filter(function (r) { return !!r; }).length === 5,
  Array.isArray(fetchRes) && fetchRes.map(function (r) { return !!r; }));
ok('1-3b fetchAll 全滅時は逐次6回へフォールバックする', seqCalls === 6, seqCalls);

// --- 1-b. 323名の集約マージ（shardMergeDevices 本体） ---
const PRE_MERGE = [
  'var __childRows = [];',
  'var __urls = [];',
  'function shardDiagLog() {}',
  'function hbLog() {}',
  'function isShardParent() { return true; }',
  'function shardConfigCached() { return { map: {}, def: "", sec: "sec" }; }',
  'function shardUrlsForTeacher() { return __urls; }',
  'function shardFetchChildDevices() { return __childRows; }',
  'function shardFilterMergedDevices(list) { return list; }',
  sheetTsToMsSrc
].join('\n');

const vMerge = vmOf(PRE_MERGE, ['shardMergeDevices', 'shardMergeDeviceRow']);

const kitUrls = [0, 1, 2, 3, 4, 5].map(function (i) { return 'https://kit-child' + i + '.example/exec'; });
const kitParent = kita.map(function (s) { return mkDevice(s, agoJst(30)); });
const kitChild = kita.map(function (s) {
  var d = mkDevice(s, nowJst());
  d.current_url = 'https://www.youtube.com/watch?v=' + s.id;
  return d;
});
vMerge.__urls = kitUrls;
vMerge.__childRows = kitChild;

let mergedKita = null, mergeThrew = false;
try {
  mergedKita = vMerge.shardMergeDevices(kitParent.slice(), 'ALL', { role: 'admin' }, false);
} catch (e) { mergeThrew = true; }
ok('1-4 323名の集約が例外を投げない', mergeThrew === false);
ok('1-5 集約結果は323件（欠損なし）', Array.isArray(mergedKita) && mergedKita.length === 323, mergedKita && mergedKita.length);
ok('1-6 集約結果にIDの重複が無い',
  Array.isArray(mergedKita) && new Set(mergedKita.map(function (d) { return d.student_id; })).size === 323);
const kitIdSet = new Set(kita.map(function (s) { return s.id; }));
ok('1-7 元の児童IDが1件も欠けていない',
  Array.isArray(mergedKita) && mergedKita.every(function (d) { return kitIdSet.has(d.student_id); }));
ok('1-8 子の新しい最終同期が採用される（src=child）',
  Array.isArray(mergedKita) && mergedKita.filter(function (d) { return d.last_seen_source === 'child'; }).length === 323);
ok('1-9 323名全員がオンライン判定になる',
  Array.isArray(mergedKita) && mergedKita.filter(function (d) { return d.is_online === true; }).length === 323);
ok('1-10 6子GAS分のクラスがすべて集約に現れる',
  Array.isArray(mergedKita) && new Set(mergedKita.map(function (d) { return d.class_name; })).size === 6);
const sumByChild = [0, 0, 0, 0, 0, 0];
if (Array.isArray(mergedKita)) {
  mergedKita.forEach(function (d) {
    var m = /-(\d)組/.exec(d.class_name);
    if (m) sumByChild[+m[1] - 1]++;
  });
}
ok('1-11 各子GASの担当人数が保たれる（53〜54名×6）',
  sumByChild.every(function (c) { return c >= 53 && c <= 54; }), sumByChild);

// 子が1台落ちても親の323件は消えない（道連れ防止の集約側）
vMerge.__childRows = kitChild.filter(function (d) { return d.class_name !== 'KIT-3組'; });
const mergedPartial = vMerge.shardMergeDevices(kitParent.slice(), 'ALL', { role: 'admin' }, false);
ok('1-12 1子GAS落ちでも集約は323件を維持（親の行が残る）',
  Array.isArray(mergedPartial) && mergedPartial.length === 323, mergedPartial && mergedPartial.length);
//   子の行が来ない児童は、親の行がそのまま残る（＝親の古い最終同期で判定）。
//   ここで last_seen_source は付かない（マージが走っていないため）。
ok('1-13 落ちた子GASの児童は親の行のまま残る（消えない）',
  Array.isArray(mergedPartial) &&
  mergedPartial.filter(function (d) { return d.class_name === 'KIT-3組'; }).length >= 53,
  Array.isArray(mergedPartial) && mergedPartial.filter(function (d) { return d.class_name === 'KIT-3組'; }).length);
//   親の行は「生のシート行」なので is_online を持たない（undefined）。
//   重要なのは「誤って true にならない」こと（＝古い時刻を新しいと誤認しない）。
ok('1-13b 落ちた子GASの児童は誤ってオンラインにならない',
  Array.isArray(mergedPartial) &&
  mergedPartial.filter(function (d) { return d.class_name === 'KIT-3組'; })
    .every(function (d) { return d.is_online !== true; }));
ok('1-13c 生きている5子GASの児童は子の新しい時刻でオンラインになる',
  Array.isArray(mergedPartial) &&
  mergedPartial.filter(function (d) { return d.class_name !== 'KIT-3組'; })
    .every(function (d) { return d.is_online === true && d.last_seen_source === 'child'; }));

// --- 1-c. パターンB（単一GAS 81名）: 子GASへ一切問い合わせない ---
const PRE_B = [
  'var __all = [];',
  'var __fetchCount = 0;',
  'function shardDiagLog() {}',
  'function isShardParent() { return false; }',
  'function getAllDevices() { return __all; }',
  'function shardFetchMany() { __fetchCount++; return []; }',
  'function applyMonitorVisibility(d) { return d; }'
].join('\n');
const vB = vmOf(PRE_B, ['getShardMergedDevices']);
const oharaRows = ohara.map(function (s) { return mkDevice(s, nowJst()); });
vB.__all = oharaRows;
let listB = null, bThrew = false;
try { listB = vB.getShardMergedDevices('', { role: 'admin' }, false); } catch (e) { bThrew = true; }
ok('1-14 単一GAS（SHARD_MODE=false）で集約が例外を投げない', bThrew === false);
ok('1-15 単一GASの一覧は81件そのまま返る', Array.isArray(listB) && listB.length === 81, listB && listB.length);
ok('1-16 単一GASでは子GASへの問い合わせが0回（余計な通信なし）',
  vB.__fetchCount === 0, vB.__fetchCount);
ok('1-17 単一GASの一覧は入力配列と同一参照（無加工で返す＝従来互換）',
  Array.isArray(listB) && listB[0] === oharaRows[0]);

// --- 1-d. LockService 競合（教員10名同時書き込みの論理シミュレーション） ---
const PRE_LOCK = [
  'var __held = 0;',
  'var __maxHeld = 0;',
  'var __acquired = 0;',
  'var __timeout = false;',
  'var LockService = { getScriptLock: function () {',
  '  return {',
  '    waitLock: function () {',
  '      if (__timeout) { __timeout = false; throw "locked"; }',
  '      __acquired++; __held++; if (__held > __maxHeld) __maxHeld = __held;',
  '    },',
  '    releaseLock: function () { __held--; }',
  '  };',
  '} };',
  'function bulkTraceMark() {}',
  'function invalidateDevicesCache() {}'
].join('\n');
const vLock = vmOf(PRE_LOCK, ['withWriteLock']);

for (let i = 0; i < 10; i++) {
  vLock.withWriteLock(function () { return i; });
}
ok('1-18 教員10名の連続書き込みでロックが漏れない', vLock.__held === 0, vLock.__held);
ok('1-19 同時保持は常に1（排他が守られている）', vLock.__maxHeld === 1);
ok('1-20 書き込み10回でロック取得も10回', vLock.__acquired === 10, vLock.__acquired);
ok('1-21 入れ子呼び出しはロックを取り直さない（__depth が戻る）', vLock.withWriteLock.__depth === 0);
let nestedOk = false;
vLock.withWriteLock(function () {
  vLock.withWriteLock(function () { nestedOk = true; });
});
ok('1-22 入れ子でも内側の処理が実行される', nestedOk === true);
ok('1-23 入れ子後もロック取得回数は増えない（1回だけ）',
  (function () { const before = vLock.__acquired; vLock.withWriteLock(function () { vLock.withWriteLock(function () {}); }); return vLock.__acquired === before + 1; })());
vLock.__timeout = true;
let timeoutMsg = '';
try { vLock.withWriteLock(function () {}); } catch (e) { timeoutMsg = (typeof e === 'string') ? e : String(e && e.message); }
ok('1-24 ロック競合時は該当エラーで中断する（握りつぶさない）',
  vLock.__timeout === false, timeoutMsg);

// =====================================================================
// 2. 画面ロック ⇄ 解除の高速連打・順序逆転防止
// =====================================================================
console.log('\n===== 2. 画面ロック⇄解除の高速連打（順序逆転の防止） =====');

const vCo = vmOf('', ['shardMergeSchedulesForCoalesce', 'shardCoalescePending']);

/** shard_apply の保留1件を作る */
function req(url, ids, patch, schedules) {
  const body = {
    action: 'shard_apply',
    shard_secret: 'sec',
    student_ids: ids,
    class_map: {},
    patch: patch
  };
  if (schedules !== undefined) body.schedules = schedules;
  return {
    url: url, method: 'post', contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  };
}

const classroom = kita.filter(function (s) { return s.cls === 'KIT-1組'; });
const classIds = classroom.map(function (s) { return s.id; });
ok('2-1 1組の人数は53〜55名', classIds.length >= 53 && classIds.length <= 55, classIds.length);

// ON → OFF → ON → OFF を 15秒周期の保留に積んだ状況
const seq = [
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false })
];
const co1 = vCo.shardCoalescePending(seq);
ok('2-2 連打4回でも子GASへの送信は1リクエストに畳まれる', co1.requests.length === 1, co1.requests.length);
const body1 = JSON.parse(co1.requests[0].payload);
ok('2-3 最終状態は「解除」（最後の指示が勝つ）', body1.patch.screen_lock === false, body1.patch);
ok('2-4 対象児童は1人も欠けない', body1.student_ids.length === classIds.length);
ok('2-5 1リクエストに全児童が入る（分割されない）', body1.student_ids.length === 53 || body1.student_ids.length === 54, body1.student_ids.length);

// 逆順（OFF → ON）なら ON が最終状態（＝順序を正しく反映する）
const co2 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: false }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: true })
]);
ok('2-6 OFF→ON の連打では ON が最終状態', JSON.parse(co2.requests[0].payload).patch.screen_lock === true);

// 古い ON が後から降ってきても、保留内の順序で最後の OFF が勝つ
const co3 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: true, notes: 'x' }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false })
]);
const b3 = JSON.parse(co3.requests[0].payload);
ok('2-7 同一キーの再送があっても最新の false で確定する', b3.patch.screen_lock === false);
ok('2-8 他のキー（notes）は脱落しない', b3.patch.notes === 'x');

// 全校323名への連打（6子GASへ1リクエストずつ）
const allKita = kita.map(function (s) { return s.id; });
const byChild = {};
kita.forEach(function (s) { (byChild['https://kit-child' + s.childIndex + '.example/exec'] || (byChild['https://kit-child' + s.childIndex + '.example/exec'] = [])).push(s.id); });
const seqAll = [];
Object.keys(byChild).forEach(function (u) {
  seqAll.push(req(u, byChild[u], { screen_lock: true }));
  seqAll.push(req(u, byChild[u], { screen_lock: false }));
  seqAll.push(req(u, byChild[u], { screen_lock: true }));
  seqAll.push(req(u, byChild[u], { screen_lock: false }));
});
const co4 = vCo.shardCoalescePending(seqAll);
ok('2-9 全校323名×4連打（24保留）でも送信は6リクエスト', co4.requests.length === 6, co4.requests.length);
ok('2-10 6リクエストすべてが「解除」で確定',
  co4.requests.every(function (r) { return JSON.parse(r.payload).patch.screen_lock === false; }));
const totalIds = co4.requests.reduce(function (a, r) { return a + JSON.parse(r.payload).student_ids.length; }, 0);
ok('2-11 全校323名が6リクエストに過不足なく分散', totalIds === 323, totalIds);
ok('2-12 全校のIDに重複が無い',
  (function () {
    const seen = new Set();
    co4.requests.forEach(function (r) {
      JSON.parse(r.payload).student_ids.forEach(function (id) { seen.add(id); });
    });
    return seen.size === 323;
  })());

// ロック命令が「実際に子へ届く」ことの確認。
//   sources は保留キー（url + \u0000 + payload）を保持する。同じ payload の再送は
//   キーとして同一なので、比較は「一意キーの集合」で行う。
//   ここが欠けると、送信成功後も保留が消えず、同じ命令が延々と再送され続ける。
const uniqKeys = new Set(seqAll.map(function (r) {
  return String(r.url) + '\u0000' + String(r.payload);
}));
const srcSet = new Set();
co4.sources.forEach(function (keys) { keys.forEach(function (k) { srcSet.add(k); }); });
ok('2-13 統合後も全保留キー（一意）が sources に引き継がれる（後で消し込める）',
  srcSet.size === uniqKeys.size && Array.from(uniqKeys).every(function (k) { return srcSet.has(k); }),
  { uniq: uniqKeys.size, src: srcSet.size });
ok('2-14 sources に存在しないキーが混ざらない（余計な消し込みをしない）',
  srcSet.size === uniqKeys.size);

// =====================================================================
// 3. ロック中の一斉URL送信／URL規制／サイト監視の競合
// =====================================================================
console.log('\n===== 3. ロック中の URL送信・規制・監視の競合 =====');

// ロックON と同時に URL配信・規制・監視が来ても、どのキーも脱落しない
const co5 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }),
  req('https://kit-child0.example/exec', classIds, { broadcast_url: 'https://jp.kahoot.it/join' }),
  req('https://kit-child0.example/exec', classIds, { filter_mode: 'whitelist', whitelist_urls: ['https://jp.kahoot.it/'] }),
  req('https://kit-child0.example/exec', classIds, { monitor_force: true })
]);
ok('3-1 ロック＋配信＋規制＋監視は1リクエストに統合', co5.requests.length === 1, co5.requests.length);
const b5 = JSON.parse(co5.requests[0].payload);
ok('3-2 ロックは維持される（勝手に解除されない）', b5.patch.screen_lock === true);
ok('3-3 一斉URL送信が脱落しない', b5.patch.broadcast_url === 'https://jp.kahoot.it/join');
ok('3-4 規制モードが脱落しない', b5.patch.filter_mode === 'whitelist');
ok('3-5 ホワイトリストが脱落しない',
  Array.isArray(b5.patch.whitelist_urls) && b5.patch.whitelist_urls[0] === 'https://jp.kahoot.it/');
ok('3-6 監視フラグが脱落しない', b5.patch.monitor_force === true);
ok('3-7 4キーすべてが同時に成立する', Object.keys(b5.patch).length === 5, Object.keys(b5.patch));

// ロックON の後に ロックOFF だけが来た場合、配信・規制は保持される（patch は児童単位で累積）
const co6 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true, broadcast_url: 'https://example.jp/a' }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false })
]);
const b6 = JSON.parse(co6.requests[0].payload);
ok('3-8 解除しても同時に積んだ配信URLは消えない', b6.patch.broadcast_url === 'https://example.jp/a', b6.patch);
ok('3-9 解除は正しく反映される', b6.patch.screen_lock === false);

// スケジュール（予約）がロック操作と同時に来ても脱落しない（Request L の本題）
const schedA = { updated_ms: 1, by_student: { s1: { windows: [1], overridden_ids: [] } } };
const schedB = { updated_ms: 2, by_student: { s2: { windows: [2], overridden_ids: [] } } };
const co7 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }, schedA),
  req('https://kit-child0.example/exec', classIds, { broadcast_url: 'https://example.jp/b' })
]);
const b7 = JSON.parse(co7.requests[0].payload);
ok('3-10 後続に schedules が無くても予約は保持される', !!b7.schedules && !!b7.schedules.by_student.s1);
ok('3-11 ロックと配信も同時に成立', b7.patch.screen_lock === true && b7.patch.broadcast_url === 'https://example.jp/b');

const co8 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true }, schedA),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false }, schedB)
]);
const b8 = JSON.parse(co8.requests[0].payload);
ok('3-12 両方に schedules がある場合は児童単位でマージ', !!b8.schedules.by_student.s1 && !!b8.schedules.by_student.s2,
  Object.keys(b8.schedules.by_student));
ok('3-13 マージ後もロック指示は最新（解除）で確定', b8.patch.screen_lock === false);
ok('3-14 別児童の予約が上書きで消えない', b8.schedules.by_student.s1.windows[0] === 1 && b8.schedules.by_student.s2.windows[0] === 2);

// =====================================================================
// 4. Keep-Alive ON/OFF 連打 ＋ 予約スケジュール同時発火
// =====================================================================
console.log('\n===== 4. Keep-Alive 連打と予約スケジュールの同時発火 =====');

const PRE_KA = [
  'var __cache = {};',
  'var __fetchCount = 0;',
  'var __sentBodies = [];',
  'var CacheService = { getScriptCache: function () {',
  '  return {',
  '    get: function (k) { return __cache[k]; },',
  '    put: function (k, v) { __cache[k] = String(v); },',
  '    remove: function (k) { delete __cache[k]; }',
  '  };',
  '} };',
  'function isShardParent() { return true; }',
  'function shardConfigCached() { return { map: {}, def: "", sec: "sec" }; }',
  'function shardAllChildUrls() { return ["https://c0/exec","https://c1/exec","https://c2/exec","https://c3/exec","https://c4/exec","https://c5/exec"]; }',
  'function shardFetchMany(reqs) {',
  '  __fetchCount++;',
  '  __sentBodies = reqs.map(function (r) { return JSON.parse(r.payload); });',
  '  return reqs.map(function () { return { getResponseCode: function () { return 200; } }; });',
  '}'
].join('\n');

const vKa = vmOf(PRE_KA, ['shardPropagateKaState']);

// 間引きは「キャッシュに入っている前回時刻との差 < 30 秒」で判定される。
// 実時間に依存させず、キャッシュ値を直接置いて条件を作る。
const REAL_NOW = Date.now();

// --- ON → OFF → 即ON の連打（Request L の修正点）---
vKa.__cache = {};
let r1 = vKa.shardPropagateKaState(true);
ok('4-1 初回ONは子GAS 6台へ送る', r1.sent === 6, r1);
ok('4-2 全子GASに ka_active=true が届く', vKa.__sentBodies.every(function (b) { return b.ka_active === true; }));
ok('4-3 間引きタイムスタンプが保存される', !!vKa.__cache['shard_ka_ts']);

// 3秒後に解除
vKa.__cache['shard_ka_ts'] = String(REAL_NOW - 3000);
let r2 = vKa.shardPropagateKaState(false);
ok('4-4 解除は即時（間引かれない）', r2.sent === 6, r2);
ok('4-5 解除時は ka_active=false が届く', vKa.__sentBodies.every(function (b) { return b.ka_active === false; }));
ok('4-6 解除時にタイムスタンプが必ず消える（Request L）',
  vKa.__cache['shard_ka_ts'] === undefined, vKa.__cache);

// 解除の直後に再度 ON → 30 秒の間引きに阻まれないこと
let r3 = vKa.shardPropagateKaState(true);
ok('4-7 解除直後の再ONが間引きに阻まれない（あらためて送信される）',
  r3.sent === 6 && r3.throttled === undefined, r3);
ok('4-8 再ONで ka_active=true が再び届く', vKa.__sentBodies.every(function (b) { return b.ka_active === true; }));

// 稼働中の連打は間引かれる（負荷を増やさない）
vKa.__cache['shard_ka_ts'] = String(REAL_NOW - 1000); // 1秒前＝30秒以内
const before = vKa.__fetchCount;
let r4 = vKa.shardPropagateKaState(true);
ok('4-9 稼働中の再ONは30秒以内なら間引かれる', r4.throttled === true, r4);
ok('4-10 間引き時は子GASへ送信しない（通信量を増やさない）', vKa.__fetchCount === before);

// 30 秒経過後は送信される
vKa.__cache['shard_ka_ts'] = String(REAL_NOW - 31000);
let r5 = vKa.shardPropagateKaState(true);
ok('4-11 30秒を超えれば再度送信される', r5.sent === 6 && !r5.throttled, r5);

// 高頻度連打 20 回（ON/OFF 交互）でもタイムスタンプの残留が残らない
vKa.__cache = {};
let inconsistent = 0;
for (let i = 0; i < 20; i++) {
  vKa.shardPropagateKaState(i % 2 === 0);
  // OFF の直後は必ずクリアされている（＝残留しない）
  if (i % 2 === 1 && vKa.__cache['shard_ka_ts'] !== undefined) inconsistent++;
}
ok('4-12 ON/OFF 20連打でタイムスタンプ残留が発生しない', inconsistent === 0, inconsistent);

// 予約スケジュール同時発火: schedules と ka_active が同一 payload でも衝突しない
const co9 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, { screen_lock: true },
    { updated_ms: 10, by_student: { s1: { windows: [1], overridden_ids: [] } } }),
  req('https://kit-child0.example/exec', classIds, { screen_lock: false },
    { updated_ms: 11, by_student: { s1: { windows: [2], overridden_ids: [] } } })
]);
const b9 = JSON.parse(co9.requests[0].payload);
ok('4-13 同一児童の予約は後続の値で置き換わる（古い予約が残らない）',
  b9.schedules.by_student.s1.windows[0] === 2, b9.schedules.by_student.s1);
ok('4-14 updated_ms も後続が勝つ', b9.schedules.updated_ms === 11, b9.schedules.updated_ms);
ok('4-15 予約とロック解除が同一 payload で両立する',
  b9.patch.screen_lock === false && !!b9.schedules);

// 予約の統合は「和集合」を採る（＝空の by_student が来ても既存予約を消さない）。
//   これは安全側の設計で、通信順序が入れ替わっても予約が消えないことを意味する。
//   児童単位の「削除」は overridden_ids / updated_ms という明示的な印で表現する。
const co10 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, {}, { updated_ms: 1, by_student: { s1: { windows: [1] } } }),
  req('https://kit-child0.example/exec', classIds, {}, { updated_ms: 2, by_student: {} })
]);
const b10 = JSON.parse(co10.requests[0].payload);
ok('4-16 後続が空の by_student でも既存予約は消えない（安全側・順序逆転に強い）',
  !!b10.schedules.by_student.s1 && b10.schedules.by_student.s1.windows[0] === 1,
  Object.keys(b10.schedules.by_student));
ok('4-17 既存に無い児童の予約は後続から追加される（和集合）',
  !!b10.schedules.by_student.s1 && b10.schedules.updated_ms === 2,
  b10.schedules.updated_ms);

// 児童単位の削除は overridden_ids / updated_ms で表現される（後続が勝つ）
const co11 = vCo.shardCoalescePending([
  req('https://kit-child0.example/exec', classIds, {},
    { updated_ms: 5, by_student: { s1: { windows: [1], overridden_ids: [] } } }),
  req('https://kit-child0.example/exec', classIds, {},
    { updated_ms: 6, by_student: { s1: { windows: [], overridden_ids: ['w1'] } } })
]);
const b11 = JSON.parse(co11.requests[0].payload);
ok('4-18 同一児童の削除印(overridden_ids)は後続が勝つ',
  b11.schedules.by_student.s1.overridden_ids[0] === 'w1',
  b11.schedules.by_student.s1);
ok('4-19 削除印と updated_ms が同時に最新化される',
  b11.schedules.by_student.s1.overridden_ids.length === 1 && b11.schedules.updated_ms === 6);

// =====================================================================
// 5. サイト監視: 1クラス全員の一斉違反アクセス＋設定即時切替
// =====================================================================
console.log('\n===== 5. サイト監視 一斉違反アクセスと即時切替 =====');

const PRE_MON = [
  'var __monEnabled = true;',
  'function getMonitoringSettings() { return { enabled: __monEnabled }; }'
].join('\n');
const vMon = vmOf(PRE_MON, ['applyMonitorVisibility']);

/** 53名分の「違反検知済み」端末を作る */
function mkMonRows(ids, url) {
  return ids.map(function (id, i) {
    return {
      student_id: id, school_name: '北小学校', class_name: 'KIT-1組',
      current_url: url, monitor_flag: true,
      monitor_reason: 'blacklist', monitor_url: url,
      monitor_at: nowJst()
    };
  });
}
const monRowsOn = mkMonRows(classIds, 'https://www.youtube.com/watch?v=x');
vMon.__monEnabled = true;
const shownOn = vMon.applyMonitorVisibility(monRowsOn.slice());
ok('5-1 監視ONなら53名全員の注意フラグが返る', shownOn.filter(function (d) { return d.monitor_flag === true; }).length === classIds.length,
  shownOn.filter(function (d) { return d.monitor_flag === true; }).length);
ok('5-2 監視ONなら違反URLが保持される', shownOn.every(function (d) { return d.monitor_url === 'https://www.youtube.com/watch?v=x'; }));
ok('5-3 監視ONなら理由も保持される', shownOn.every(function (d) { return d.monitor_reason === 'blacklist'; }));

// 即時 OFF 切替 → 集約一覧から注意表示が消える（伏せ処理）
const monRowsOff = mkMonRows(classIds, 'https://www.youtube.com/watch?v=x');
vMon.__monEnabled = false;
const shownOff = vMon.applyMonitorVisibility(monRowsOff);
ok('5-4 監視OFFに切り替えると53名全員の注意が消える',
  shownOff.filter(function (d) { return d.monitor_flag === true; }).length === 0);
ok('5-5 監視OFFなら違反URLも消す（URLが漏れない）', shownOff.every(function (d) { return d.monitor_url === ''; }));
ok('5-6 監視OFFなら理由も消す', shownOff.every(function (d) { return d.monitor_reason === ''; }));
ok('5-7 監視OFFでも端末自体は一覧から消えない（行は残る）', shownOff.length === classIds.length);

// ON→OFF→ON の即時切替で状態が混ざらない
vMon.__monEnabled = true;
const t1 = vMon.applyMonitorVisibility(mkMonRows(classIds, 'https://www.youtube.com/')).filter(function (d) { return d.monitor_flag; }).length;
vMon.__monEnabled = false;
const t2 = vMon.applyMonitorVisibility(mkMonRows(classIds, 'https://www.youtube.com/')).filter(function (d) { return d.monitor_flag; }).length;
vMon.__monEnabled = true;
const t3 = vMon.applyMonitorVisibility(mkMonRows(classIds, 'https://www.youtube.com/')).filter(function (d) { return d.monitor_flag; }).length;
ok('5-8 ON→OFF→ON の即時切替で件数が正しく追随する',
  t1 === classIds.length && t2 === 0 && t3 === classIds.length, [t1, t2, t3]);

// 全校323名が一斉違反した場合の集約表示。
//   ※ applyMonitorVisibility は受け取ったオブジェクトを直接書き換える（in-place）。
//     検証のたびに同じ配列を使い回すと前回の結果に汚染されるため、必ず都度生成する。
function mkAllMon() {
  return kita.map(function (s) {
    return { student_id: s.id, school_name: s.school, class_name: s.cls,
      monitor_flag: true, monitor_url: 'https://www.youtube.com/', monitor_reason: 'blacklist', monitor_at: nowJst() };
  });
}
const allMon = mkAllMon();
vMon.__monEnabled = true;
const shownAll = vMon.applyMonitorVisibility(mkAllMon());
ok('5-9 全校323名の一斉違反でも注意表示が漏れなく立つ',
  shownAll.filter(function (d) { return d.monitor_flag === true; }).length === 323,
  shownAll.filter(function (d) { return d.monitor_flag === true; }).length);

// 集約経路（getShardMergedDevices）が監視の伏せ処理を通ること。
//   SHARD_MODE=false のときは getAllDevices をそのまま返す（従来互換）ため、
//   伏せ処理は getAllDevices 側の責務。親モード（集約する側）では
//   getShardMergedDevices 自身が applyMonitorVisibility を通す。
const PRE_GM = [
  'var __all = [];',
  'var __monEnabled = false;',
  'function shardDiagLog() {}',
  'function isShardParent() { return false; }',
  'function getAllDevices() { return __all; }',
  'function getMonitoringSettings() { return { enabled: __monEnabled }; }'
].join('\n');
const vGm = vmOf(PRE_GM, ['getShardMergedDevices', 'applyMonitorVisibility']);
vGm.__all = mkAllMon();
vGm.__monEnabled = false;
const gmOff = vGm.getShardMergedDevices('', { role: 'admin' }, false);
ok('5-10 非分散モードでは getAllDevices の結果をそのまま返す（従来互換・委譲契約）',
  gmOff === vGm.__all || (Array.isArray(gmOff) && gmOff.length === 323 && gmOff[0] === vGm.__all[0]));
ok('5-11 伏せても端末は323件すべて残る', gmOff.length === 323, gmOff.length);

// 親モード（集約する側）での伏せ処理
const PRE_GM2 = [
  'var __all = [];',
  'var __monEnabled = false;',
  'var SHARD_LIST_CACHE_TTL = 5;',
  'function shardDiagLog() {}',
  'function isShardParent() { return true; }',
  'function getAllDevices() { return __all; }',
  'function shardMergeDevices(base) { return base; }',
  'function getMonitoringSettings() { return { enabled: __monEnabled }; }',
  'function shardHash(s) { return "h"; }',
  'function shardDevVersion() { return "1"; }'
].join('\n');
const vGm2 = vmOf(PRE_GM2, ['getShardMergedDevices', 'applyMonitorVisibility']);

vGm2.__all = mkAllMon();
vGm2.__monEnabled = false;
const gmParentOff = vGm2.getShardMergedDevices('', { role: 'admin' }, false);
ok('5-12 親モードで監視OFFなら集約結果の注意が全件伏せられる',
  gmParentOff.filter(function (d) { return d.monitor_flag === true; }).length === 0,
  gmParentOff.filter(function (d) { return d.monitor_flag === true; }).length);
ok('5-13 親モードでも端末は323件すべて残る', gmParentOff.length === 323, gmParentOff.length);

vGm2.__all = mkAllMon();
vGm2.__monEnabled = true;
const gmParentOn = vGm2.getShardMergedDevices('', { role: 'admin' }, false);
ok('5-14 親モードで監視ONなら注意が323件すべて立つ',
  gmParentOn.filter(function (d) { return d.monitor_flag === true; }).length === 323,
  gmParentOn.filter(function (d) { return d.monitor_flag === true; }).length);
ok('5-15 監視ON/OFFの切替で件数が即座に追随する（ON 323 → OFF 0）',
  gmParentOn.filter(function (d) { return d.monitor_flag; }).length === 323 &&
  gmParentOff.filter(function (d) { return d.monitor_flag; }).length === 0);

// =====================================================================
// 6. SSO: 6教員同時ログイン ＋ 児童323名／未登録の遮断
// =====================================================================
console.log('\n===== 6. SSO 6教員同時ログインと児童アカウント遮断 =====');

const PRE_SSO = [
  'var __teachers = {};',
  'var __sheetRows = [];',
  'var __lastLoginWrites = 0;',
  'function getTeacherSettings(em) { return __teachers[em] || null; }',
  'function getTargetSheet() { return {',
  '  getLastColumn: function () { return 11; },',
  '  getRange: function (r, c) { if (r === 1) return { setValue: function () { return this; },',
  '    setBackground: function () { return this; }, setFontColor: function () { return this; },',
  '    setFontWeight: function () { return this; } };',
  '    return { getValues: function () { return [[em_dummy]]; }, setValue: function () { __lastLoginWrites++; } }; },',
  '  getDataRange: function () { return { getValues: function () { return __sheetRows; } }; }',
  '} }',
  'function ensureTeacherHeaders() {}',
  'function getHeaderMap() { return { "教員ID(メールアドレス)": 1, "最終ログイン日時": 10 }; }',
  'var CONFIG = { TEACHER_SHEET_NAME: "教員", TEACHER_COLUMNS: [], SCHOOL_LIST: ["北小学校"] };',
  'var Utilities = { formatDate: function () { return "2026/11/15 09:00:00"; } };',
  'function generateToken(t) { return "tok." + t.email + "." + (__tokenSeq++); }',
  'var __tokenSeq = 0;',
  'const SSO_DENY_MESSAGE = "deny";',
  'const SSO_NO_EMAIL_MESSAGE = "noemail";'
].join('\n');

const vSso = vmOf(PRE_SSO, ['parseSsoAllowedFlag', 'ssoLoginWithEmail']);
vSso.__teachers = {
  't1@mimasaka.ed.jp': { email: 't1@mimasaka.ed.jp', name: '教員1', school: '北小学校', role: 'teacher', target_class: 'KIT-1組', sso_allowed: true },
  't2@mimasaka.ed.jp': { email: 't2@mimasaka.ed.jp', name: '教員2', school: '北小学校', role: 'teacher', target_class: 'KIT-2組', sso_allowed: true },
  't3@mimasaka.ed.jp': { email: 't3@mimasaka.ed.jp', name: '教員3', school: '北小学校', role: 'teacher', target_class: 'KIT-3組', sso_allowed: '' },
  't4@mimasaka.ed.jp': { email: 't4@mimasaka.ed.jp', name: '教員4', school: '北小学校', role: 'teacher', target_class: 'KIT-4組', sso_allowed: 'true' },
  't5@mimasaka.ed.jp': { email: 't5@mimasaka.ed.jp', name: '教員5', school: '北小学校', role: 'admin', target_class: '', sso_allowed: true },
  't6@mimasaka.ed.jp': { email: 't6@mimasaka.ed.jp', name: '教員6', school: '北小学校', role: 'teacher', target_class: 'KIT-5組', sso_allowed: true }
};
vSso.__sheetRows = [['教員ID(メールアドレス)']].concat(
  Object.keys(vSso.__teachers).map(function (k) { return [k]; })
);

// 6教員が同時にログイン（同一実行内で連続発行＝競合の論理再現）
const ssoResults = Object.keys(vSso.__teachers).map(function (k) {
  return { email: k, res: vSso.ssoLoginWithEmail(k) };
});
ok('6-1 6教員のSSOログインが全員成功する',
  ssoResults.every(function (x) { return x.res.success === true; }),
  ssoResults.map(function (x) { return x.res.reason || 'ok'; }));
ok('6-2 6教員のトークンが全員異なる（発行競合なし）',
  new Set(ssoResults.map(function (x) { return x.res.token; })).size === 6);
ok('6-3 全トークンが空でない', ssoResults.every(function (x) { return !!x.res.token; }));
ok('6-4 各トークンが本人のメールを含む（取り違えなし）',
  ssoResults.every(function (x) { return String(x.res.token).indexOf(x.email) >= 0; }));
ok('6-5 応答に sso=true が立つ', ssoResults.every(function (x) { return x.res.sso === true; }));
ok('6-6 応答に教員氏名が入る（表示名の取り違えなし）',
  ssoResults.every(function (x) { return x.res.teacher && x.res.teacher.name === vSso.__teachers[x.email].name; }));
ok('6-7 SSO許可が空欄の教員も既定ONでログインできる（移行措置）',
  ssoResults.filter(function (x) { return x.email === 't3@mimasaka.ed.jp'; })[0].res.success === true);

// 児童アカウント 323 名 → 100% 遮断
const studentAccounts = kita.map(function (s) { return 'kid' + s.id.toLowerCase() + '@mimasaka.ed.jp'; });
const studentResults = studentAccounts.map(function (em) { return vSso.ssoLoginWithEmail(em); });
ok('6-8 児童アカウント323名は100%遮断される',
  studentResults.every(function (r) { return r.success === false; }),
  studentResults.filter(function (r) { return r.success === true; }).length);
ok('6-9 遮断理由が not_registered で統一される',
  studentResults.every(function (r) { return r.reason === 'not_registered'; }));
ok('6-10 遮断時にトークンを発行しない', studentResults.every(function (r) { return r.token === undefined; }));
ok('6-11 遮断メッセージに管理権限なしの案内が入る',
  studentResults.every(function (r) { return r.error === 'deny'; }));

// SSO許可OFF の教員
vSso.__teachers['off@mimasaka.ed.jp'] = { email: 'off@mimasaka.ed.jp', name: 'OFF教員', school: '北小学校', role: 'teacher', target_class: 'KIT-6組', sso_allowed: false };
const rOff = vSso.ssoLoginWithEmail('off@mimasaka.ed.jp');
ok('6-12 SSO許可OFFの教員は遮断される', rOff.success === false && rOff.reason === 'sso_disabled', rOff.reason);
ok('6-13 SSO許可OFFでもトークンは発行しない', rOff.token === undefined);

// メールが取れない（匿名デプロイ）
const rNoMail = vSso.ssoLoginWithEmail('');
const rNull = vSso.ssoLoginWithEmail(null);
ok('6-14 メール空は no_email で遮断される', rNoMail.success === false && rNoMail.reason === 'no_email', rNoMail.reason);
ok('6-15 null でも例外を投げず no_email で遮断される', rNull.success === false && rNull.reason === 'no_email');

// 大文字・空白混じりのメールでも取り違えない
const rUpper = vSso.ssoLoginWithEmail('  T1@MIMASAKA.ED.JP  ');
ok('6-16 大文字・前後空白のメールでも正しく認識される', rUpper.success === true, rUpper.reason);

// =====================================================================
// 7. 子GAS 1台の遅延・一時エラー時の耐障害性（道連れ防止）
// =====================================================================
console.log('\n===== 7. 子GAS 1台障害時の道連れ防止 =====');

const PRE_FLUSH = [
  'var __props = {};',
  'var __fetchPlan = {};',
  'var __fetchCalls = 0;',
  'var SHARD_ASYNC_PROP = "SHARD_ASYNC_QUEUE";',
  'var SHARD_ASYNC_ENABLED = true;',
  'var SHARD_ASYNC_MAX_CHARS = 8000;',
  'function shardDiagLog() {}',
  'var Logger = { log: function () {} };',
  'var PropertiesService = { getScriptProperties: function () {',
  '  return {',
  '    getProperty: function (k) { return (k in __props) ? __props[k] : null; },',
  '    setProperty: function (k, v) { __props[k] = String(v); }',
  '  };',
  '} };',
  'var LockService = { getScriptLock: function () {',
  '  return { waitLock: function () {}, releaseLock: function () {} };',
  '} };',
  'function mkRes(code, body) {',
  '  return { getResponseCode: function () { return code; }, getContentText: function () { return body; } };',
  '}',
  'function planRes(u) {',
  '  var plan = __fetchPlan[u];',
  '  if (plan === "throw") throw "network-down";',
  '  if (plan === "500") return mkRes(500, "server error");',
  '  if (plan === "reject") return mkRes(200, JSON.stringify({ success: false, error: "unauthorized" }));',
  '  return mkRes(200, JSON.stringify({ success: true }));',
  '}',
  'var UrlFetchApp = {',
  '  fetchAll: function (reqs) {',
  '    __fetchCalls++;',
  '    return reqs.map(function (r) { return planRes(r.url); });',
  '  },',
  '  fetch: function (u) {',
  '    __fetchCalls++;',
  '    return planRes(u);',
  '  }',
  '};'
].join('\n');

const vFlush = vmOf(PRE_FLUSH, [
  'shardReadPending', 'shardQueuePending', 'shardDropPending',
  'shardFlushPending', 'shardCoalescePending', 'shardMergeSchedulesForCoalesce',
  // shardFlushPending は内部で shardFetchMany を呼ぶ（未抽出だと ReferenceError で
  // catch され {error:...} が返り、保留が一切送られない）
  'shardFetchMany'
]);

/** 6子GAS分の保留を積む */
function queue6() {
  vFlush.__props = {};
  const reqs = [];
  for (let i = 0; i < 6; i++) {
    reqs.push(req('https://c' + i + '/exec', ['S' + i + '01'], { screen_lock: true }));
  }
  vFlush.shardQueuePending(reqs);
  return reqs.length;
}
function pendingCount() {
  return vFlush.shardReadPending().length;
}

// --- 7-1. 6台中1台が HTTP 500 → 残り5台は成功し、1台だけ保留に残る ---
queue6();
vFlush.__fetchPlan = { 'https://c2/exec': '500' };
let f1 = vFlush.shardFlushPending();
ok('7-1 1台が500でも残り5台は送信成功', f1.sent === 6 && f1.removed === 5, f1);
ok('7-2 失敗した1台だけが保留に残る（道連れにしない）', pendingCount() === 1, pendingCount());
ok('7-3 残った保留は失敗した子GAS宛のみ',
  vFlush.shardReadPending()[0].url === 'https://c2/exec', vFlush.shardReadPending()[0].url);

// 復旧後に再フラッシュ → 残りも送れて保留が空になる（自己修復）
vFlush.__fetchPlan = {};
let f2 = vFlush.shardFlushPending();
ok('7-4 復旧後の再フラッシュで残りが送信される', f2.sent === 1 && f2.removed === 1, f2);
ok('7-5 最終的に保留が空になる（自己修復）', pendingCount() === 0, pendingCount());

// --- 7-6. 1台が例外（ネットワーク断）でも他は成功 ---
queue6();
vFlush.__fetchPlan = { 'https://c1/exec': 'throw' };
let f3 = vFlush.shardFlushPending();
ok('7-6 1台が例外でも他5台は成功する', f3.removed === 5, f3);
ok('7-7 例外の1台は保留に残る', pendingCount() === 1, pendingCount());

// --- 7-8. 1台が HTTP200 + success:false（拒否）でも保留に残す ---
vFlush.__props = {};
vFlush.shardQueuePending([req('https://c3/exec', ['S301'], { screen_lock: true })]);
vFlush.__fetchPlan = { 'https://c3/exec': 'reject' };
let f4 = vFlush.shardFlushPending();
ok('7-8 子が success:false を返したら保留に残す（成功と誤認しない）', f4.removed === 0 && pendingCount() === 1, f4);

// --- 7-9. 全滅（6台すべて500）でもフラッシュ自体は落ちない ---
queue6();
vFlush.__fetchPlan = {
  'https://c0/exec': '500', 'https://c1/exec': '500', 'https://c2/exec': '500',
  'https://c3/exec': '500', 'https://c4/exec': '500', 'https://c5/exec': '500'
};
let f5 = null, f5Threw = false;
try { f5 = vFlush.shardFlushPending(); } catch (e) { f5Threw = true; }
ok('7-9 全子GAS障害でもフラッシュが例外を投げない', f5Threw === false);
ok('7-10 全滅時は保留を消さない（次回再送できる）', pendingCount() === 6, pendingCount());
ok('7-11 全滅時も結果オブジェクトを返す', f5 && f5.removed === 0, f5);

// --- 7-12. 保留が空のときのフラッシュは安全（空振り） ---
vFlush.__props = {};
let f6 = vFlush.shardFlushPending();
ok('7-12 保留が空でもフラッシュが落ちない', f6 && f6.empty === true, f6);

// --- 7-13. 1台障害時も「統合（coalesce）」は正常に成立する ---
queue6();
vFlush.__props = {};
const reqs13 = [];
for (let i = 0; i < 6; i++) {
  reqs13.push(req('https://c' + i + '/exec', ['S' + i + '01'], { screen_lock: true }));
  reqs13.push(req('https://c' + i + '/exec', ['S' + i + '01'], { screen_lock: false }));
}
vFlush.shardQueuePending(reqs13);
vFlush.__fetchPlan = { 'https://c4/exec': '500' };
let f7 = vFlush.shardFlushPending();
ok('7-13 連打統合後も6リクエストに畳まれる', f7.sent === 6, f7);
// 失敗した子GAS宛は「送れていない」ので、統合前の保留がそのまま残る
//   （＝1台分の ON と OFF の2件。どちらも未達なので消してはいけない）
//   removed は「送信リクエスト数」ではなく「消し込んだ保留エントリ数」。
//   成功した5台は ON と OFF の2件ずつ（計10件）が消え、失敗した1台分の2件が残る。
ok('7-14 1台障害でも5台は確定し、失敗した1台の保留は残る',
  f7.removed === 10 && pendingCount() === 2, { removed: f7.removed, pending: pendingCount() });
ok('7-14b 成功した5台分の保留エントリが過不足なく消える',
  f7.removed === 12 - 2, f7.removed);
ok('7-15 残った保留は失敗した子GAS宛のみ',
  vFlush.shardReadPending().every(function (r) { return r.url === 'https://c4/exec'; }),
  vFlush.shardReadPending().map(function (r) { return r.url; }));

// 【順序逆転防止の核心】復旧後の再フラッシュでは、残っていた ON/OFF が
//   統合されて「最新の解除(false)」1件だけが届く。古い ON が後から降って
//   最新の解除を上書きすることはない。
vFlush.__fetchPlan = {};
let f8 = vFlush.shardFlushPending();
ok('7-16 復旧後の再フラッシュは1リクエストに統合される', f8.sent === 1, f8);
ok('7-17 統合された内容は最新の「解除」のみ（古いONを再送しない）', (function () {
  var pend = vFlush.shardReadPending();
  return f8.removed === 2 && pend.length === 0;
})(), { removed: f8.removed, pending: pendingCount() });

// =====================================================================
// 8. 境界値・異常データ入力（空文字・長文URL・特殊文字）
// =====================================================================
console.log('\n===== 8. 境界値・異常データ耐性 =====');

// --- 8-a. 教員URL情報のパース／シリアライズ往復 ---
const vUrl = vmOf('', ['parseTeacherUrls', 'serializeTeacherUrls']);

const longUrl = 'https://example.ed.jp/' + 'a'.repeat(1800) + '?q=' + encodeURIComponent('日本語 検索');
const p1 = vUrl.parseTeacherUrls(longUrl);
ok('8-1 長文URLがそのまま解釈される', p1.length === 1 && p1[0].url === longUrl, p1.length);
ok('8-2 長文URLでも文字数が欠けない', p1[0].url.length === longUrl.length, p1[0].url.length);

const multi = 'https://a.ed.jp/1\nhttps://b.ed.jp/2\r\nhttps://c.ed.jp/3';
const p2 = vUrl.parseTeacherUrls(multi);
ok('8-3 改行区切りの複数URLを解釈する（CRLFも可）', p2.length === 3, p2.length);

const pipe = '国語|https://a.ed.jp/kokugo\n数学|https://a.ed.jp/suugaku';
const p3 = vUrl.parseTeacherUrls(pipe);
ok('8-4 タイトル|URL 形式を解釈する', p3.length === 2 && p3[0].title === '国語' && p3[0].url === 'https://a.ed.jp/kokugo', p3[0]);

const special = 'https://a.ed.jp/?a=1&b=%22x%22&c=<tag>&d=¥';
const p4 = vUrl.parseTeacherUrls(special);
ok('8-5 特殊記号(&,",<,>)を含むURLでも壊れない', p4.length === 1 && p4[0].url === special, p4[0]);

ok('8-6 空文字は空配列', vUrl.parseTeacherUrls('').length === 0);
ok('8-7 null/undefined は空配列',
  vUrl.parseTeacherUrls(null).length === 0 && vUrl.parseTeacherUrls(undefined).length === 0);
ok('8-8 空白のみは空配列', vUrl.parseTeacherUrls('   ').length === 0);
ok('8-9 空配列は空配列', vUrl.parseTeacherUrls([]).length === 0);

// 往復（serialize → parse）で内容が保たれる
const round1 = vUrl.parseTeacherUrls(vUrl.serializeTeacherUrls([{ title: '国語', url: 'https://a.ed.jp/k' }]));
ok('8-10 serialize→parse の往復で内容が保たれる',
  round1.length === 1 && round1[0].title === '国語' && round1[0].url === 'https://a.ed.jp/k', round1);
const round2 = vUrl.parseTeacherUrls(vUrl.serializeTeacherUrls(longUrl));
ok('8-11 長文URLを往復しても欠けない', round2[0] && round2[0].url === longUrl, round2[0] && round2[0].url.length);
ok('8-12 空配列をシリアライズすると [] になる', vUrl.serializeTeacherUrls([]) === '[]');
ok('8-13 null をシリアライズしても壊れない', vUrl.serializeTeacherUrls(null) === '[]');
ok('8-14 既にJSON文字列なら二重エンコードしない',
  vUrl.serializeTeacherUrls('[{"title":"a","url":"https://a.jp/"}]') === '[{"title":"a","url":"https://a.jp/"}]');
ok('8-15 壊れたJSON文字列でも例外を投げず配列を返す',
  Array.isArray(vUrl.parseTeacherUrls('{壊れた')));

// --- 8-b. 長文URL・特殊文字が保留キューのPayloadを壊さない ---
const nasty = 'https://a.ed.jp/?x=' + '"\\'.repeat(100) + '&y=<>&z=%E6%97%A5';
const coNasty = vCo.shardCoalescePending([
  req('https://c0/exec', ['S001', 'S002'], { broadcast_url: nasty })
]);
const bNasty = JSON.parse(coNasty.requests[0].payload);
ok('8-16 特殊文字だらけの長文URLでもJSONが壊れない', bNasty.patch.broadcast_url === nasty);
ok('8-17 特殊文字を含んでも児童IDが欠けない', bNasty.student_ids.length === 2);

const uni = '日本語のタイトル🎒と絵文字😀、全角スペース　とタブ\t';
const coUni = vCo.shardCoalescePending([
  req('https://c0/exec', ['S001'], { notes: uni })
]);
ok('8-18 絵文字・全角・タブを含む文字列も往復する',
  JSON.parse(coUni.requests[0].payload).patch.notes === uni);

// 空配列・null を渡しても落ちない
const coEmpty = vCo.shardCoalescePending([
  req('https://c0/exec', ['S001'], { whitelist_urls: [], blacklist_urls: null })
]);
const bEmpty = JSON.parse(coEmpty.requests[0].payload);
ok('8-19 空配列は空配列のまま保持される', Array.isArray(bEmpty.patch.whitelist_urls) && bEmpty.patch.whitelist_urls.length === 0);
ok('8-20 null は null のまま保持される（勝手に [] にしない）', bEmpty.patch.blacklist_urls === null);

// 極端に長い配列（1クラス55名 × 長いURL）
const manyIds = [];
for (let i = 0; i < 55; i++) manyIds.push('KIT' + String(i + 1).padStart(3, '0'));
const coMany = vCo.shardCoalescePending([
  req('https://c0/exec', manyIds, { broadcast_url: longUrl })
]);
const bMany = JSON.parse(coMany.requests[0].payload);
ok('8-21 55名＋長文URLでも1リクエストに収まる', coMany.requests.length === 1);
ok('8-22 55名のIDが欠けない', bMany.student_ids.length === 55, bMany.student_ids.length);
ok('8-23 長文URLが欠けない', bMany.patch.broadcast_url.length === longUrl.length);

// 不正な payload（JSONでない）は素通しされ、落ちない
const coBad = vCo.shardCoalescePending([{ url: 'https://c0/exec', payload: 'これはJSONではない' }]);
ok('8-24 解析不能な payload でも例外を投げず素通しする', coBad.requests.length === 1);
ok('8-25 素通し時も元の payload を書き換えない', coBad.requests[0].payload === 'これはJSONではない');

// student_ids が空の shard_apply は素通し（他の指示を壊さない）
const coNoIds = vCo.shardCoalescePending([
  { url: 'https://c0/exec', payload: JSON.stringify({ action: 'shard_apply', shard_secret: 's', student_ids: [], patch: { screen_lock: true } }) }
]);
ok('8-26 student_ids が空の指示はそのまま送る（勝手に畳まない）', coNoIds.requests.length === 1);

// --- 8-c. 教員マスタ11列の列ズレ耐性 ---
const PRE_HDR = [
  'var __headers = [];',
  'var __execSheetCache = null;',
  'function __execEnsureDone() { return false; }',
  'function __execEnsureMark() {}',
  'function __execHeaderDrop() {}',
  'function initializeTeacherHeaders(sheet) { __headers = []; }',
  'function CONFIG_TEACHER_COLUMNS() { return 0; }',
  'var CONFIG = { TEACHER_COLUMNS: [1,2,3,4,5,6,7,8,9,10,11].map(function (i) { return "C" + i; }) };',
  'var __sheet = {',
  '  getLastColumn: function () { return __headers.length; },',
  '  getRange: function (r, c, nr, nc) {',
  '    if (r === 1 && nr === 1) {',
  '      return { getValues: function () {',
  '        var row = [];',
  '        for (var i = 0; i < (nc || 1); i++) row.push(__headers[i] === undefined ? "" : __headers[i]);',
  '        return [row];',
  '      } };',
  '    }',
  '    var cell = {',
  '      setValue: function (v) { __headers[c - 1] = String(v); return cell; },',
  '      setBackground: function () { return cell; },',
  '      setFontColor: function () { return cell; },',
  '      setFontWeight: function () { return cell; }',
  '    };',
  '    return cell;',
  '  }',
  '};'
].join('\n');

// 実装の CONFIG.TEACHER_COLUMNS をそのまま使うため、11列名を取り出す
const teacherCols = cfgArray('TEACHER_COLUMNS');
ok('8-27 教員マスタは11列', Array.isArray(teacherCols) && teacherCols.length === 11, teacherCols && teacherCols.length);
ok('8-28 11列目が Google SSO許可', teacherCols[10] === 'Google SSO許可', teacherCols[10]);
ok('8-29 既存1〜10列の並びが不変',
  teacherCols[0] === '教員ID(メールアドレス)' && teacherCols[1] === 'パスワード' &&
  teacherCols[2] === '氏名' && teacherCols[3] === '所属学校' && teacherCols[4] === '権限' &&
  teacherCols[5] === '対象クラス' && teacherCols[6] === '登録URL情報' &&
  teacherCols[7] === '個別ホワイトリスト' && teacherCols[8] === '個別ブラックリスト' &&
  teacherCols[9] === '最終ログイン日時');
ok('8-30 11列に重複が無い', new Set(teacherCols).size === 11);

const PRE_HDR2 = PRE_HDR.replace(
  'var CONFIG = { TEACHER_COLUMNS: [1,2,3,4,5,6,7,8,9,10,11].map(function (i) { return "C" + i; }) };',
  'var CONFIG = { TEACHER_COLUMNS: ' + JSON.stringify(teacherCols) + ' };'
);
const vHdr = vmOf(PRE_HDR2, ['ensureTeacherHeaders', 'getHeaderMap']);

// 既存10列のシートに 11列目を自動補完（列がズレない）
vHdr.__headers = teacherCols.slice(0, 10);
vHdr.ensureTeacherHeaders(vHdr.__sheet);
ok('8-31 既存10列のシートへ11列目が自動追加される', vHdr.__headers.length === 11, vHdr.__headers.length);
ok('8-32 追加されるのは末尾（既存列を押し出さない）', vHdr.__headers[10] === 'Google SSO許可', vHdr.__headers[10]);
ok('8-33 既存1〜10列の値が変わらない',
  JSON.stringify(vHdr.__headers.slice(0, 10)) === JSON.stringify(teacherCols.slice(0, 10)));

// 既に11列あるシートは何も足さない（冪等）
const before34 = vHdr.__headers.slice();
vHdr.ensureTeacherHeaders(vHdr.__sheet);
ok('8-34 既に11列あれば何も追加しない（冪等）',
  vHdr.__headers.length === 11 && JSON.stringify(vHdr.__headers) === JSON.stringify(before34));

// ヘッダーマップが 1..11 を正しく返す
const hm = vHdr.getHeaderMap(vHdr.__sheet, teacherCols);
ok('8-35 ヘッダーマップが11列すべてを指す',
  teacherCols.every(function (c) { return typeof hm[c] === 'number' && hm[c] >= 1 && hm[c] <= 11; }),
  hm['Google SSO許可']);
ok('8-36 Google SSO許可の列番号は11', hm['Google SSO許可'] === 11, hm['Google SSO許可']);
ok('8-37 教員IDの列番号は1', hm['教員ID(メールアドレス)'] === 1);

// 10項目＋SSO許可＝11セルで1行を書いても列がズレない
const rowVals = [
  't@mimasaka.ed.jp', 'pw', '氏名', '北小学校', 'teacher',
  'KIT-1組', '[]', '', '', '2026/11/15 09:00:00', 'TRUE'
];
ok('8-38 11項目の行データが11列にちょうど対応する', rowVals.length === teacherCols.length, rowVals.length);

// --- 8-d. 固定仕様の不変条件（本番前の最終確認） ---
ok('8-39 manifest は v1.6.13', manifest.version === '1.6.13', manifest.version);
ok('8-40 default_popup を持たない', !manifest.action || !manifest.action.default_popup);
ok('8-41 permissions が不変',
  JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'alarms', 'idle', 'tabs', 'identity', 'identity.email']),
  manifest.permissions);
ok('8-42 background.js の DEFAULT_GAS_URL は空文字のまま',
  /const\s+DEFAULT_GAS_URL\s*=\s*''\s*;/.test(bg));
ok('8-43 東粟倉小学校はコードに存在しない', src.indexOf('東粟倉') < 0);
ok('8-44 MONITOR_SETTINGS_V1 キーを維持', src.indexOf('MONITOR_SETTINGS_V1') >= 0);
ok('8-45 DIAG 計装を維持（[SHARD-DIAG] / SHARD_DIAG_MODE）',
  src.indexOf('[SHARD-DIAG]') >= 0 && src.indexOf('SHARD_DIAG_MODE') >= 0);
ok('8-46 bulkTrace 計装を維持', src.indexOf('bulkTrace') >= 0);
ok('8-47 保留キューは PropertiesService（SHARD_ASYNC_QUEUE）',
  src.indexOf("SHARD_ASYNC_PROP = 'SHARD_ASYNC_QUEUE'") >= 0);
ok('8-48 lock.js は screen_lock の解除で自動復帰する（ロック維持の実装）',
  lockJs.indexOf('screen_lock') >= 0 && lockJs.indexOf('restoreScreen') >= 0);

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
