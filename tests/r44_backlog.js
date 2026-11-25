// =====================================================================
// Request L — 本番前バックログ3項目の回帰テスト
//
//   1. shardCoalescePending が schedules を脱落させないこと
//      （統合元にあって統合先に無い場合は保持／両方にあれば by_student を合流）
//   2. shard_ka_ts が解除（ka_active=false）時に確実にクリアされること
//   3. doGet の api === 'list' が管理画面と同じ集約経路を通ること
// =====================================================================
const fs = require('fs'), vm = require('vm');
const PREFIX = '/home/user/webapp/';
function rd(p) { return fs.readFileSync(PREFIX + p, 'utf8'); }

const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const bg = rd('extension/background.js');
const manifest = JSON.parse(rd('extension/manifest.json'));

function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  if (end < 0) throw new Error('unbalanced: ' + name);
  return s.slice(st, end + 1);
}
const countDefs = (s, n) =>
  (s.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}
function ok(n, c) { check(n, c === true, undefined); }

// =====================================================================
// A. schedules の脱落防止（静的構造）
// =====================================================================
console.log('--- A. shardCoalescePending の schedules 保持（静的） ---');

ok('A1 shardMergeSchedulesForCoalesce が1回だけ定義',
  countDefs(src, 'shardMergeSchedulesForCoalesce') === 1);
ok('A1 shardCoalescePending が1回だけ定義',
  countDefs(src, 'shardCoalescePending') === 1);

const coalesceBody = extract(src, 'shardCoalescePending');
ok('A2 schedules を保持する器 schedulesByUrl がある',
  coalesceBody.indexOf('schedulesByUrl') >= 0);
ok('A2 schedulesByUrl は初期化される', /const\s+schedulesByUrl\s*=\s*\{\s*\}/.test(coalesceBody));
ok('A3 body.schedules を取り込んでいる',
  /body\.schedules\s*!==\s*undefined/.test(coalesceBody));
ok('A3 既存があればマージ関数に委譲する',
  coalesceBody.indexOf('shardMergeSchedulesForCoalesce(') >= 0);
ok('A3 既存が無ければそのまま採用する（三項演算子の分岐）',
  /schedulesByUrl\[url\]\s*===\s*undefined/.test(coalesceBody));
ok('A4 統合後の payload に schedules を載せている',
  /outBody\.schedules\s*=\s*schedulesByUrl\[url\]/.test(coalesceBody));
ok('A4 schedules が無い URL では payload に載せない（条件付き）',
  /if\s*\(\s*schedulesByUrl\[url\]\s*!==\s*undefined\s*\)/.test(coalesceBody));
ok('A5 従来の patch 合流ロジックが残っている',
  /prev\.patch\[pk\[k\]\]\s*=\s*patch\[pk\[k\]\]/.test(coalesceBody));
ok('A5 従来の false（解除）上書き仕様が残っている',
  /patch\[pk\[k\]\]\s*===\s*undefined/.test(coalesceBody));

const mergeBody = extract(src, 'shardMergeSchedulesForCoalesce');
ok('A6 next が無ければ prev を返す',
  /if\s*\(\s*next\s*===\s*undefined\s*\|\|\s*next\s*===\s*null\s*\)\s*return\s+prev/.test(mergeBody));
ok('A6 prev が無ければ next を返す',
  /if\s*\(\s*prev\s*===\s*undefined\s*\|\|\s*prev\s*===\s*null\s*\)\s*return\s+next/.test(mergeBody));
ok('A6 by_student を児童単位でマージする',
  mergeBody.indexOf("key === 'by_student'") >= 0);
ok('A6 文字列（JSON）でも解釈できる', mergeBody.indexOf('JSON.parse') >= 0);
ok('A6 壊れた入力を弾く（isObj 判定）', mergeBody.indexOf('isObj') >= 0);

// =====================================================================
// B. schedules 保持（実行）
// =====================================================================
console.log('--- B. schedules 保持の実挙動（実行） ---');

const PRELUDE_AB = [
  extract(src, 'shardMergeSchedulesForCoalesce'),
  extract(src, 'shardCoalescePending')
].join('\n');

function mkCoalesceVm() {
  const sandbox = {
    console: { log: function () {} },
    JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean
  };
  vm.createContext(sandbox);
  vm.runInContext(PRELUDE_AB, sandbox);
  return sandbox;
}
function mkReq(url, body) {
  return { url: url, method: 'post', contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true };
}
function planOf(sb, reqs) { return sb.shardCoalescePending(reqs); }
function payloadsOf(plan) {
  return (plan.requests || []).map(function (r) {
    try { return JSON.parse(String(r.payload)); } catch (e) { return null; }
  });
}

{
  // 統合元に schedules があり、統合先に無い → 保持される
  const sb = mkCoalesceVm();
  const url = 'https://child1/exec';
  const S1 = { by_student: { '1607002': { active: [{ start_ms: 1, end_ms: 2 }] } } };
  const plan = planOf(sb, [
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['1607002'],
      patch: { screen_lock: true }, schedules: S1 }),
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['1607002'],
      patch: { screen_lock: false } })
  ]);
  const bodies = payloadsOf(plan);
  ok('B1 統合されて1リクエストになる', bodies.length === 1);
  ok('B1 統合後も schedules が残っている', !!bodies[0] && !!bodies[0].schedules);
  ok('B1 schedules の中身が一致する',
    !!bodies[0] && !!bodies[0].schedules && !!bodies[0].schedules.by_student &&
    !!bodies[0].schedules.by_student['1607002']);
  ok('B1 後から来た patch が勝つ（解除）',
    !!bodies[0] && bodies[0].patch.screen_lock === false);
  ok('B1 元の保留2件とも送信元として記録される',
    (plan.sources[0] || []).length === 2);
}
{
  // 両方に schedules がある → by_student が合流する（別児童が脱落しない）
  const sb = mkCoalesceVm();
  const url = 'https://child1/exec';
  const plan = planOf(sb, [
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'],
      patch: { screen_lock: true },
      schedules: { by_student: { A: { active: [{ start_ms: 10, end_ms: 20 }] } } } }),
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['B'],
      patch: { screen_lock: true },
      schedules: { by_student: { B: { active: [{ start_ms: 30, end_ms: 40 }] } } } })
  ]);
  const bodies = payloadsOf(plan);
  const allSched = bodies.map(function (b) { return b && b.schedules; }).filter(Boolean);
  ok('B2 schedules 付きの送信が存在する', allSched.length >= 1);
  const merged = allSched[0].by_student || {};
  ok('B2 児童Aの予約が残っている', !!merged.A);
  ok('B2 児童Bの予約が残っている', !!merged.B);
}
{
  // 同じ児童の schedules は後続が勝つ
  const sb = mkCoalesceVm();
  const url = 'https://child1/exec';
  const plan = planOf(sb, [
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'],
      patch: { screen_lock: true },
      schedules: { by_student: { A: { tag: 'OLD' } } } }),
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'],
      patch: { screen_lock: false },
      schedules: { by_student: { A: { tag: 'NEW' } } } })
  ]);
  const bodies = payloadsOf(plan);
  const withSched = bodies.filter(function (b) { return b && b.schedules; });
  ok('B3 schedules が1件に統合される', withSched.length === 1);
  ok('B3 同じ児童は後続の値が勝つ',
    !!withSched[0].schedules.by_student.A &&
    withSched[0].schedules.by_student.A.tag === 'NEW');
}
{
  // schedules が全く無い従来経路は壊れない
  const sb = mkCoalesceVm();
  const url = 'https://child1/exec';
  const plan = planOf(sb, [
    mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'], patch: { screen_lock: true } })
  ]);
  const bodies = payloadsOf(plan);
  ok('B4 schedules 無しでも送信できる', bodies.length === 1);
  ok('B4 schedules キーを勝手に生やさない',
    bodies[0].schedules === undefined);
  ok('B4 patch は維持される', bodies[0].patch.screen_lock === true);
}
{
  // 空 schedules / null schedules でも落ちない
  const sb = mkCoalesceVm();
  const url = 'https://child1/exec';
  let threw = false;
  let plan = null;
  try {
    plan = planOf(sb, [
      mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'],
        patch: { screen_lock: true }, schedules: null }),
      mkReq(url, { action: 'shard_apply', shard_secret: 's', student_ids: ['A'],
        patch: { screen_lock: false } })
    ]);
  } catch (e) { threw = true; }
  ok('B5 schedules:null でも例外を投げない', threw === false);
  ok('B5 null は schedules として載せない',
    payloadsOf(plan || { requests: [] }).every(function (b) { return !b || b.schedules === undefined; }));
}
{
  // 文字列で渡ってきた schedules も解釈する
  const sb = mkCoalesceVm();
  const merged = sb.shardMergeSchedulesForCoalesce(
    JSON.stringify({ by_student: { A: 1 } }),
    JSON.stringify({ by_student: { B: 2 } })
  );
  ok('B6 文字列 schedules をマージできる',
    !!merged && !!merged.by_student && merged.by_student.A === 1 && merged.by_student.B === 2);
  const broken = sb.shardMergeSchedulesForCoalesce('{not json', { by_student: { C: 3 } });
  ok('B6 壊れた文字列では相手側を採る',
    !!broken && !!broken.by_student && broken.by_student.C === 3);
}

// =====================================================================
// C. shard_ka_ts のクリア漏れ（静的構造）
// =====================================================================
console.log('--- C. shard_ka_ts のクリア（静的） ---');

const kaBody = extract(src, 'shardPropagateKaState');
ok('C1 active 時は 30 秒間引きのタイムスタンプを書く',
  /cache\.put\(\s*k\s*,/.test(kaBody) || /cache\.put\('shard_ka_ts'/.test(kaBody));
ok('C1 間引き判定が残っている', kaBody.indexOf('30000') >= 0);
ok('C2 解除（false）側の分岐がある', /\}\s*else\s*\{/.test(kaBody));
ok('C2 解除時に shard_ka_ts を remove している',
  /remove\(\s*'shard_ka_ts'\s*\)/.test(kaBody) ||
  /remove\(\s*k\s*\)/.test(kaBody));
ok('C2 remove はキャッシュ不可でも落ちない（try/catch）',
  /try\s*\{[\s\S]{0,200}remove\(/.test(kaBody));
ok('C3 ka_active を payload に載せている',
  /ka_active:\s*!!active/.test(kaBody));
ok('C3 false でも送信を続行する（早期 return しない）',
  kaBody.indexOf('return { skipped: true, active: false }') < 0);

// =====================================================================
// D. shard_ka_ts のクリア（実行）
// =====================================================================
console.log('--- D. shard_ka_ts のクリア（実行） ---');

const PRELUDE_C = extract(src, 'shardPropagateKaState');

function mkKaVm(opts) {
  opts = opts || {};
  const calls = { put: [], remove: [], sends: [] };
  const store = {};
  const cache = {
    get: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    put: function (k, v) { calls.put.push(k); store[k] = String(v); },
    remove: function (k) { calls.remove.push(k); delete store[k]; }
  };
  const sandbox = {
    console: { log: function () {} },
    JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean,
    Date: Date,
    isShardParent: function () { return opts.parent !== false; },
    shardConfigCached: function () { return { sec: 'SEC', map: {}, def: '' }; },
    shardAllChildUrls: function () { return opts.urls || ['https://child1/exec']; },
    shardFetchMany: function (reqs) {
      calls.sends.push(reqs.map(function (r) { return r.payload; }));
      return (reqs || []).map(function () { return { getResponseCode: function () { return 200; } }; });
    },
    CacheService: { getScriptCache: function () { return cache; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(PRELUDE_C, sandbox);
  sandbox.__calls = calls;
  sandbox.__store = store;
  return sandbox;
}
{
  const sb = mkKaVm();
  sb.shardPropagateKaState(true);
  ok('D1 active=true でタイムスタンプが保存される', sb.__calls.put.indexOf('shard_ka_ts') >= 0);
  ok('D1 active=true では remove しない', sb.__calls.remove.length === 0);
  ok('D1 active=true の payload は ka_active:true',
    JSON.parse(sb.__calls.sends[0][0]).ka_active === true);
}
{
  // 解除 → shard_ka_ts が確実に消える
  const sb = mkKaVm();
  sb.shardPropagateKaState(true);                       // まず稼働（ts が入る）
  ok('D2 事前にタイムスタンプが入っている', !!sb.__store['shard_ka_ts']);
  sb.shardPropagateKaState(false);                      // 解除
  ok('D2 解除でタイムスタンプが削除される', !sb.__store['shard_ka_ts']);
  ok('D2 解除で remove が呼ばれる', sb.__calls.remove.indexOf('shard_ka_ts') >= 0);
  const last = sb.__calls.sends[sb.__calls.sends.length - 1][0];
  ok('D2 解除の payload は ka_active:false', JSON.parse(last).ka_active === false);
}
{
  // 解除直後の再稼働が間引きに阻まれない（＝クリアされている証拠）
  const sb = mkKaVm();
  sb.shardPropagateKaState(true);
  sb.shardPropagateKaState(false);
  const before = sb.__calls.sends.length;
  const r = sb.shardPropagateKaState(true);
  ok('D3 解除直後の再稼働は間引きされない', !(r && r.throttled === true));
  ok('D3 再稼働が子GASへ送信される', sb.__calls.sends.length === before + 1);
}
{
  // 稼働中は 30 秒間引きが効く（クリアで緩めていないことの確認）
  const sb = mkKaVm();
  sb.shardPropagateKaState(true);
  const before = sb.__calls.sends.length;
  const r = sb.shardPropagateKaState(true);
  ok('D4 稼働中の連続 touch は間引かれる', !!(r && r.throttled === true));
  ok('D4 間引き時は送信しない', sb.__calls.sends.length === before);
}
{
  // 親GASでないときは何もしない（従来挙動の維持）
  const sb = mkKaVm({ parent: false });
  const r = sb.shardPropagateKaState(false);
  ok('D5 非親GASでは skipped', !!(r && r.skipped === true));
  ok('D5 非親GASでは remove も送信もしない',
    sb.__calls.remove.length === 0 && sb.__calls.sends.length === 0);
}

// =====================================================================
// E. doGet api === 'list' の集約統一（静的構造）
// =====================================================================
console.log('--- E. doGet api=list の集約統一（静的） ---');

const doGetBody = extract(src, 'doGet');
const listIdx = doGetBody.indexOf("api === 'list'");
const nextIdx = doGetBody.indexOf("api === 'schools'", listIdx);
ok('E1 doGet に api === \'list\' の分岐がある', listIdx >= 0);
ok('E1 後続の schools 分岐を特定できる', nextIdx > listIdx);

const listBranch = (listIdx >= 0 && nextIdx > listIdx)
  ? doGetBody.slice(listIdx, nextIdx) : '';
ok('E2 list 分岐が getShardMergedDevices を呼ぶ',
  listBranch.indexOf('getShardMergedDevices(') >= 0);
ok('E2 list 分岐が resolveCurrentTeacher を通す',
  listBranch.indexOf('resolveCurrentTeacher(') >= 0);
ok('E2 list 分岐が getAllDevices を直接呼んでいない',
  listBranch.indexOf('getAllDevices(') < 0);
ok('E3 認証トークンの検証は維持されている',
  listBranch.indexOf('verifyToken(') < 0 ? doGetBody.slice(listIdx - 400, nextIdx).indexOf('verifyToken(') >= 0 : true);
ok('E3 未認証時は need_auth を返す（従来どおり）',
  listBranch.indexOf('need_auth: true') >= 0);
ok('E3 include_unassigned を渡している',
  listBranch.indexOf('parseBoolean(params.include_unassigned)') >= 0);
ok('E4 応答形状は従来どおり（success/data/teacher）',
  listBranch.indexOf('success: true') >= 0 &&
  listBranch.indexOf('data: data') >= 0 &&
  listBranch.indexOf('teacher: auth.teacher') >= 0);

// 管理画面経路（api_getAllDevices）と同一関数を使っていること
const apiGetAll = extract(src, 'api_getAllDevices');
ok('E5 管理画面経路も getShardMergedDevices を使う',
  apiGetAll.indexOf('getShardMergedDevices(') >= 0);
ok('E5 doGet と管理画面が同じ集約関数で揃っている',
  listBranch.indexOf('getShardMergedDevices(') >= 0 &&
  apiGetAll.indexOf('getShardMergedDevices(') >= 0);
ok('E5 getShardMergedDevices は非親時に getAllDevices へ委譲する',
  extract(src, 'getShardMergedDevices').indexOf('return getAllDevices(') >= 0);
ok('E6 getShardMergedDevices は applyMonitorVisibility を通す',
  extract(src, 'getShardMergedDevices').indexOf('applyMonitorVisibility(') >= 0);

// =====================================================================
// F. 固定仕様の不変条件
// =====================================================================
console.log('--- F. 固定仕様の不変条件 ---');

ok('F1 manifest の version は 1.6.12', manifest.version === '1.6.12');
ok('F1 manifest に default_popup が無い',
  !(manifest.action && manifest.action.default_popup) &&
  !(manifest.browser_action && manifest.browser_action.default_popup));
ok('F1 manifest の permissions は変更されていない',
  JSON.stringify(manifest.permissions) ===
  JSON.stringify(['storage', 'alarms', 'idle', 'tabs', 'identity', 'identity.email']));

ok('F2 DEFAULT_GAS_URL は空文字のまま', /const\s+DEFAULT_GAS_URL\s*=\s*''\s*;/.test(bg));
ok('F2 DEFAULT_GAS_URL を実URLへ書き換えていない',
  !/const\s+DEFAULT_GAS_URL\s*=\s*'https?:/.test(bg));

ok('F3 東粟倉小学校が学校リストに含まれていない', html.indexOf('東粟倉小学校') < 0);
const schoolsBlock = (function () {
  const i = html.indexOf('const SCHOOLS = [');
  if (i < 0) throw new Error('schools block not found');
  const j = html.indexOf('];', i);
  return html.slice(i, j + 2);
})();
ok('F3 学校リストは 14 校', (schoolsBlock.match(/'/g) || []).length === 28);
ok('F3 樸学園が含まれる（14校の最終要素）', schoolsBlock.indexOf('樸学園') >= 0);

ok('F4 MONITOR_SETTINGS_V1 キーが維持されている',
  src.indexOf("const MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1'") >= 0);
ok('F4 DIAG 計装が維持されている', src.indexOf('[SHARD-DIAG]') >= 0);
ok('F4 bulkTrace 計装が維持されている', src.indexOf('bulkTrace') >= 0);
ok('F4 SHARD_ASYNC_PROP（保留キュー）が維持されている',
  src.indexOf('SHARD_ASYNC_PROP') >= 0);

ok('F5 通信経路は google.script.run（index.html に残存）',
  html.indexOf('google.script.run') >= 0);
ok('F5 伝播は PropertiesService のみ（shardFlushPending が SpreadsheetApp を使わない）',
  extract(src, 'shardFlushPending').indexOf('SpreadsheetApp') < 0);
ok('F5 テレメトリ書き戻し用の新規シート書込が無い（coalesce は純関数）',
  coalesceBody.indexOf('SpreadsheetApp') < 0 && mergeBody.indexOf('SpreadsheetApp') < 0);

// =====================================================================
console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
