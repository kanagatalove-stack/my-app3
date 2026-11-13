// =====================================================================
// Request H 回帰テスト: 一斉URL配信で同じページが2枚開く事故の再発防止
//
//  要件1: 押下時に採番した 1 つの broadcast_id が
//         「親GAS(doPost/api)」「ブラウザ→子GAS直接POST」「親の保留キューflush」
//         「子GASの shard_apply」の全経路で同一のまま引き継がれ、
//         別IDへ書き換わらないこと。
//  要件2: 拡張機能側で、直近30秒以内に同じURLを自動オープン済みなら、
//         broadcast_id が違っても2枚目のタブを開かないこと
//         （別URL・時間経過後は正常に開く／空URLは対象外）。
// =====================================================================
const fs = require('fs'), vm = require('vm');
const PREFIX = '/home/user/webapp/';
function rd(p) { return fs.readFileSync(PREFIX + p, 'utf8'); }
const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const bg = rd('extension/background.js');
const manifest = JSON.parse(rd('extension/manifest.json'));

// index.html は 4 スペース字下げ、Code.gs / background.js は column 0。
function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  if (end < 0) throw new Error('unbalanced: ' + name);
  return s.slice(st, end + 1);
}
const countDefs = (s, name) => (s.match(new RegExp('function\\s+' + name + '\\s*\\(', 'g')) || []).length;

// 行頭の // コメントだけを落とす（"https://" などを壊さないため行単位で判定する）。
//   「関数本体にその名前が“出てくる”」ではなく「呼んでいるか」を見たいときに使う。
function stripLineComments(s) {
  return s.split('\n').map(l => /^\s*\/\//.test(l) ? '' : l).join('\n');
}
// 指定位置の '{' から対応する '}' までを返す。
function blockAt(s, openIdx) {
  let d = 0;
  for (let i = s.indexOf('{', openIdx); i >= 0 && i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}') { d--; if (d === 0) return s.slice(openIdx, i + 1); }
  }
  return '';
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// =====================================================================
// A) 親GAS: 届いた broadcast_id を採番し直さず伝播する（要件1）
// =====================================================================
console.log('===== [A] 親GAS: broadcast_id をそのまま使う =====');

const fnBc = extract(src, 'api_bulkBroadcast');
check('api_bulkBroadcast は broadcastId を第4引数に取る',
  /function\s+api_bulkBroadcast\s*\(\s*token\s*,\s*studentIds\s*,\s*url\s*,\s*broadcastId\s*\)/.test(fnBc),
  fnBc.split('\n')[0]);
check('受領IDを trim して bulkUpdateBroadcastUrl へ渡す',
  /bulkUpdateBroadcastUrl\(\s*scoped\.ids\s*,\s*url\s*,\s*String\(\s*broadcastId\s*\|\|\s*''\s*\)\.trim\(\)\s*\)/.test(fnBc));
check('子GASへの patch に broadcast_id（実採番値 bcId）を載せる',
  /shardPropagatePolicy\(\s*scoped\.ids\s*,\s*\{[^}]*broadcast_id:\s*bcId/.test(fnBc));
check('patch のIDは受領値ではなく「実際に書いた値」bcId（空送信時のフォールバックも一致）',
  !/shardPropagatePolicy\(\s*scoped\.ids\s*,\s*\{[^}]*broadcast_id:\s*broadcastId[^I]/.test(fnBc));
check('api_bulkBroadcast は自前で generateBroadcastId しない（採番は1箇所）',
  fnBc.indexOf('generateBroadcastId') < 0);
check('応答に broadcast_id を返す', /broadcast_id:\s*bcId/.test(fnBc));

// doPost（/exec 経路）
const iDoPost = src.indexOf('function doPost(');
const dopostHead = src.slice(iDoPost, src.indexOf('\nfunction ', iDoPost + 10));
check('doPost に bulk_broadcast 分岐がある', /action\s*===\s*'bulk_broadcast'/.test(dopostHead));
check('doPost は payload.broadcast_id を読む', /payload\.broadcast_id/.test(dopostHead));
check('doPost は受領IDを渡して書き込む（reqBcId）',
  /bulkUpdateBroadcastUrl\(\s*scoped\.ids\s*,\s*targetUrl\s*,\s*reqBcId\s*\)/.test(dopostHead));
check('doPost の子GAS patch にも broadcast_id: broadcastId',
  /shardPropagatePolicy\(\s*scoped\.ids\s*,\s*\{[^}]*broadcast_id:\s*broadcastId/.test(dopostHead));
check('doPost の bulk_broadcast 分岐は generateBroadcastId を呼ばない',
  dopostHead.indexOf('generateBroadcastId') < 0);

// 子GAS: 受領IDを verbatim 使用
const fnChild = extract(src, 'shardApplyFromParent');
check('子GAS は patch.broadcast_id を第3引数に渡す',
  /bulkUpdateBroadcastUrl\(\s*idList\s*,\s*String\(\s*patch\.broadcast_url\s*\)\s*,\s*String\(\s*patch\.broadcast_id\s*\|\|\s*''\s*\)\s*\)/.test(fnChild));
check('子GAS は自前で generateBroadcastId しない（呼び出しが無い）',
  stripLineComments(fnChild).indexOf('generateBroadcastId') < 0);
check('配信解除（空文字URL）も undefined 判定で落とさない',
  /patch\.broadcast_url\s*!==\s*undefined\s*&&\s*patch\.broadcast_url\s*!==\s*null/.test(fnChild));

// フォールバックは 1 箇所だけ（後方互換）
const fnBulk = extract(src, 'bulkUpdateBroadcastUrl');
check('第3引数 broadcastId を受け取る',
  /function\s+bulkUpdateBroadcastUrl\s*\(\s*studentIds\s*,\s*targetUrl\s*,\s*broadcastId\s*\)/.test(fnBulk));
check('空のときだけ generateBroadcastId でフォールバックする',
  /const\s+bcId\s*=\s*broadcastId\s*\|\|\s*generateBroadcastId\(\)/.test(fnBulk));

// フロントエンド: 押下時に1つだけ採番して全経路へ載せる
check('mintBroadcastId が1つだけ定義されている', countDefs(html, 'mintBroadcastId') === 1);
const fnMint = extract(html, 'mintBroadcastId');
check('採番は時刻＋乱数（同時押下でも衝突しない）',
  /bc_[\s\S]*getTime\(\)[\s\S]*Math\.random\(\)/.test(fnMint));
check('直送 patch に broadcast_id を載せる',
  /patch\.broadcast_id\s*=\s*String\(src\.broadcast_id\)/.test(extract(html, 'shardPatchFromPayload')));
check('個別更新（update_single）の patch にも broadcast_id を載せる',
  /patch\.broadcast_id\s*=\s*String\(d\.broadcast_id\)/.test(extract(html, 'shardPatchFromPayload')));
check('runner は payload.broadcast_id を第4引数で渡す',
  /api_bulkBroadcast\(authToken,\s*payload\.student_ids,\s*payload\.url,\s*payload\.broadcast_id\s*\|\|\s*''\)/.test(html));
check('一斉配信（executeBroadcastSubmit）は採番して payload に載せる',
  /const\s+bcId\s*=\s*mintBroadcastId\(\);[\s\S]{0,400}?broadcast_id:\s*bcId/.test(extract(html, 'executeBroadcastSubmit')));
check('個別マイURL配信も採番する',
  /const\s+bcIdQuick\s*=\s*mintBroadcastId\(\);[\s\S]{0,400}?broadcast_id:\s*bcIdQuick/.test(extract(html, 'quickBroadcastUrl')));

// =====================================================================
// B) 実行時: 親GAS api_bulkBroadcast（要件1）
// =====================================================================
console.log('\n===== [B] 実行時: api_bulkBroadcast の伝播 =====');

function mkBcCtx(over) {
  const cap = { bulk: [], patches: [] };
  const ctx = {
    console, JSON, String, Number, Object, Array, Boolean, Error, Set,
    verifyToken: () => ({ valid: true, teacher: 't@x' }),
    resolveCurrentTeacher: () => ({ email: 't@x' }),
    scopeStudentIdsForTeacher: (ids) => ({ ids: Array.isArray(ids) ? ids.slice() : [] }),
    bulkUpdateBroadcastUrl: (ids, u, bid) => { cap.bulk.push({ ids: ids, u: u, bid: bid }); return bid || 'minted_fallback'; },
    shardPropagatePolicy: (ids, patch) => { cap.patches.push({ ids: ids, patch: patch }); return { sent: [] }; }
  };
  Object.keys(over || {}).forEach(k => { ctx[k] = over[k]; });
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'api_bulkBroadcast'), ctx);
  return { api: ctx.api_bulkBroadcast, cap: cap };
}

(function () {
  const { api, cap } = mkBcCtx();
  const r = api('tok', ['s1@x.ed.jp'], 'https://bc.ed.jp/a', 'bc_HAND1');
  check('受領IDがそのまま書き込まれる', cap.bulk.length === 1 && cap.bulk[0].bid === 'bc_HAND1', cap.bulk);
  check('子GASへも同じIDが渡る', cap.patches[0] && cap.patches[0].patch.broadcast_id === 'bc_HAND1', cap.patches[0]);
  check('応答の broadcast_id も受領IDと一致', r.success === true && r.broadcast_id === 'bc_HAND1', r.broadcast_id);
  check('URLと対象児童が欠けない',
    cap.bulk[0].u === 'https://bc.ed.jp/a' && cap.bulk[0].ids[0] === 's1@x.ed.jp', cap.bulk[0]);
})();

(function () {
  const { api, cap } = mkBcCtx();
  const r = api('tok', ['s1@x.ed.jp'], 'https://bc.ed.jp/b', '  bc_TRIM  ');
  check('前後の空白は trim される', cap.bulk[0].bid === 'bc_TRIM', cap.bulk[0].bid);
  check('空白入りでも親/子で同一ID（別IDにならない）',
    cap.patches[0].patch.broadcast_id === 'bc_TRIM' && r.broadcast_id === 'bc_TRIM', r.broadcast_id);
})();

(function () {
  const { api, cap } = mkBcCtx();
  const r = api('tok', ['s1@x.ed.jp'], 'https://bc.ed.jp/c');
  check('ID未指定（旧クライアント）でも従来どおり動く', r.success === true, r.success);
  check('ID未指定時は空文字を渡し、採番は書き込み側に任せる', cap.bulk[0].bid === '', cap.bulk[0].bid);
  check('ID未指定時も子GASへは「実際に書いたID」を伝える（親子で不一致にしない）',
    cap.patches[0].patch.broadcast_id === 'minted_fallback' && r.broadcast_id === 'minted_fallback',
    cap.patches[0].patch.broadcast_id);
})();

(function () {
  const { api, cap } = mkBcCtx();
  const r = api('tok', ['s1@x.ed.jp'], '', 'bc_X');
  check('URLが空なら失敗を返す（配信しない）', r.success === false && cap.bulk.length === 0, r);
})();

(function () {
  const { api } = mkBcCtx({ verifyToken: () => ({ valid: false }) });
  const r = api('tok', ['s1@x.ed.jp'], 'https://bc.ed.jp/d', 'bc_X');
  check('認証が無効なら need_auth を返し配信しない', r.success === false && r.need_auth === true, r);
})();

// =====================================================================
// C) 実行時: 子GAS shard_apply（直接POST・キューflush の受け側）
// =====================================================================
console.log('\n===== [C] 実行時: 子GAS shard_apply の受け取り =====');

function mkChildCtx() {
  const cap = { bulk: [], lock: [], filter: [] };
  const ctx = {
    console, JSON, String, Number, Object, Array, Boolean, Error, Set,
    isShardChild: () => true,
    isShardParent: () => false,
    shardSecretMatches: () => true,
    touchTeacherConsole: () => {},
    releaseTeacherConsole: () => {},
    propBool: () => false,
    PROP_SHARD_MODE: 'SHARD_MODE',
    PropertiesService: { getScriptProperties: () => ({ setProperty() {}, getProperty() { return null; } }) },
    Logger: { log() {} },
    parseBoolean: (v) => v === true || String(v).toLowerCase() === 'true',
    shardEnsureDeviceRows: () => 0,
    shardSaveScheduleCache_: () => ({ saved: 0 }),
    bulkUpdateScreenLock: (ids, v) => { cap.lock.push({ ids: ids, v: v }); },
    bulkUpdateFilterMode: (ids, m) => { cap.filter.push({ ids: ids, m: m }); },
    bulkUpdateBroadcastUrl: (ids, u, bid) => { cap.bulk.push({ ids: ids, u: u, bid: bid }); }
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'shardApplyFromParent'), ctx);
  return { apply: ctx.shardApplyFromParent, cap: cap };
}

(function () {
  const { apply, cap } = mkChildCtx();
  const r = apply({ shard_secret: 'S', student_ids: ['s1@x.ed.jp'],
                    patch: { broadcast_url: 'https://bc.ed.jp/q', broadcast_id: 'bc_HAND2' } });
  check('子は受領した broadcast_id をそのまま使う（再採番しない）',
    cap.bulk.length === 1 && cap.bulk[0].bid === 'bc_HAND2', cap.bulk);
  check('子の適用結果は success / applied を返す',
    r.success === true && r.applied === 1, [r.success, r.applied]);
})();

(function () {
  const { apply, cap } = mkChildCtx();
  apply({ shard_secret: 'S', student_ids: ['s1@x.ed.jp'],
          patch: { broadcast_url: 'https://bc.ed.jp/r' } });
  check('IDが無い（旧形式）ときは空文字を渡し、フォールバック発番に委ねる',
    cap.bulk.length === 1 && cap.bulk[0].bid === '', cap.bulk);
})();

(function () {
  const { apply, cap } = mkChildCtx();
  apply({ shard_secret: 'S', student_ids: ['s1@x.ed.jp'],
          patch: { broadcast_url: '', broadcast_id: 'bc_HAND3' } });
  check('配信解除（空URL）でもIDを保持したまま適用する',
    cap.bulk.length === 1 && cap.bulk[0].u === '' && cap.bulk[0].bid === 'bc_HAND3', cap.bulk);
})();

(function () {
  const { apply, cap } = mkChildCtx();
  apply({ shard_secret: 'S', student_ids: ['s1@x.ed.jp'], patch: { screen_lock: true } });
  check('配信を含まない patch では配信を書かない（誤配信の防止）', cap.bulk.length === 0, cap.bulk);
  check('同時にロックは適用される', cap.lock.length === 1 && cap.lock[0].v === true, cap.lock);
})();

// =====================================================================
// D) 実行時: 保留キュー（15秒flush）経由でもIDが書き換わらない
// =====================================================================
console.log('\n===== [D] 実行時: 保留キューの畳み込みでIDが変わらない =====');

const coalesceCtx = { console, JSON, String, Number, Object, Array, Boolean };
vm.createContext(coalesceCtx);
vm.runInContext(extract(src, 'shardCoalescePending'), coalesceCtx);
const coalesce = coalesceCtx.shardCoalescePending;

function mkReq(sids, patch, url) {
  return {
    url: url || 'https://child-a/exec',
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ action: 'shard_apply', shard_secret: 'S',
                              student_ids: sids, class_map: {}, patch: patch }),
    muteHttpExceptions: true
  };
}
const patchOf = (req) => JSON.parse(req.payload).patch;

(function () {
  const plan = coalesce([mkReq(['s1', 's2'], { broadcast_url: 'https://bc.ed.jp/z', broadcast_id: 'bc_Q1' })]);
  check('畳み込み後も1リクエストにまとまる', plan.requests.length === 1, plan.requests.length);
  check('同一IDが保持される（再採番されない）',
    patchOf(plan.requests[0]).broadcast_id === 'bc_Q1', patchOf(plan.requests[0]));
  check('対象児童2名が保持される', JSON.parse(plan.requests[0].payload).student_ids.length === 2);
})();

(function () {
  const plan = coalesce([mkReq(['s1'], { broadcast_url: 'https://bc.ed.jp/z', broadcast_id: 'bc_Q1' }),
                         mkReq(['s2'], { broadcast_url: 'https://bc.ed.jp/z', broadcast_id: 'bc_Q1' })]);
  check('同じIDの別リクエストは1つに畳まれる', plan.requests.length === 1, plan.requests.length);
  check('畳んでもIDは同一', patchOf(plan.requests[0]).broadcast_id === 'bc_Q1');
})();

(function () {
  const plan = coalesce([mkReq(['s1'], { broadcast_url: 'https://bc.ed.jp/z', broadcast_id: 'bc_Q1' }),
                         mkReq(['s2'], { broadcast_url: 'https://bc.ed.jp/z', broadcast_id: 'bc_Q2' })]);
  check('IDが異なれば別リクエストになる（取り違えない）', plan.requests.length === 2, plan.requests.length);
  const ids = plan.requests.map(r => patchOf(r).broadcast_id).sort();
  check('各リクエストが自分自身のIDを保つ', ids[0] === 'bc_Q1' && ids[1] === 'bc_Q2', ids);
})();

(function () {
  const plan = coalesce([mkReq(['s1'], { broadcast_url: 'https://bc.ed.jp/z' })]);
  check('ID未指定の旧形式はキーを作らない（キュー層で勝手に採番しない）',
    !Object.prototype.hasOwnProperty.call(patchOf(plan.requests[0]), 'broadcast_id'),
    patchOf(plan.requests[0]));
})();

// =====================================================================
// E) 拡張機能: 同一URL 30秒の二重オープン抑止（要件2）
// =====================================================================
console.log('\n===== [E] 拡張機能: 同一URLの時間窓ガード =====');

const iWin = bg.search(/const BROADCAST_DEDUP_WINDOW_MS\s*=\s*(\d+)\s*;/);
const WIN = iWin >= 0 ? Number(RegExp.$1) : -1;
check('BROADCAST_DEDUP_WINDOW_MS が定義されている', iWin >= 0);
check('窓は 30 秒（30000ms）', WIN === 30000, WIN);
check('BROADCAST_DEDUP_WINDOW_MS の定義は1箇所',
  (bg.match(/const\s+BROADCAST_DEDUP_WINDOW_MS\s*=/g) || []).length === 1,
  (bg.match(/const\s+BROADCAST_DEDUP_WINDOW_MS\s*=/g) || []).length);
check('窓の判定に使う別名定義を増やしていない（参照のみ）',
  (bg.match(/BROADCAST_DEDUP_WINDOW_MS\s*=(?!=)/g) || []).length === 1,
  (bg.match(/BROADCAST_DEDUP_WINDOW_MS\s*=(?!=)/g) || []).length);
check('normalizeBroadcastUrl が1つだけ定義されている', countDefs(bg, 'normalizeBroadcastUrl') === 1);
check('claimBroadcastUrlOnce が1つだけ定義されている', countDefs(bg, 'claimBroadcastUrlOnce') === 1);
check('タブ生成は 1 箇所だけ（二重オープンはガードでのみ防ぐ）',
  (bg.match(/chrome\.tabs\.create\s*\(/g) || []).length === 1,
  (bg.match(/chrome\.tabs\.create\s*\(/g) || []).length);

const fnOpen = extract(bg, 'openBroadcastUrl');
check('従来の broadcast_id 一致チェックを残している',
  /if\s*\(\s*broadcastId\s*&&\s*broadcastId\s*===\s*lastBroadcastOpenedId\s*\)\s*\{\s*return;/.test(fnOpen));
check('URL正規化の後に claimBroadcastUrlOnce を呼ぶ',
  fnOpen.indexOf("validUrl = 'https://' + validUrl") < fnOpen.indexOf('claimBroadcastUrlOnce(validUrl)'));
check('抑止時はタブを開かずに処理済みIDだけ記録する',
  /if\s*\(\s*!claimBroadcastUrlOnce\(validUrl\)\s*\)\s*\{[\s\S]{0,200}?lastBroadcastOpenedId\s*=\s*broadcastId;[\s\S]{0,120}?return;/.test(fnOpen));
// 抑止ブロックを構造で取り出して検証する（間のコメント行に左右されないようにする）。
(function () {
  const at = fnOpen.indexOf('if (!claimBroadcastUrlOnce(validUrl))');
  check('抑止ブロックが存在する', at >= 0);
  const guard = at >= 0 ? blockAt(fnOpen, at) : '';
  check('抑止ブロックは return で抜ける（タブを開かない）', /\breturn;/.test(guard), guard.length);
  check('抑止ブロック内ではタブを生成しない', guard.indexOf('chrome.tabs.create') < 0);
  check('抑止ブロック内では保護期限を設定しない（ロック処理に影響させない）',
    guard.indexOf('broadcastGuardUntil') < 0);
  // 保護期限の設定は「開く場合」の側＝抑止ブロックより後ろにあること
  const iGuard = at;
  const iGuardUntil = fnOpen.indexOf('broadcastGuardUntil = Date.now()');
  const iCreate = fnOpen.indexOf('chrome.tabs.create');
  check('保護期限の設定は抑止ブロックより後（＝開く経路のみ）',
    iGuardUntil > iGuard && iGuard >= 0, [iGuard, iGuardUntil]);
  check('タブ生成は保護期限の設定より後（保護してから開く）',
    iCreate > iGuardUntil && iGuardUntil >= 0, [iGuardUntil, iCreate]);
})();
check('空URLは対象外（claim が空キーで true を返す）',
  /if\s*\(\s*!key\s*\)\s*return\s+true;/.test(extract(bg, 'claimBroadcastUrlOnce')));
check('applyPolicies の「新しいIDのときだけ」条件は維持',
  /if\s*\(\s*newBcId\s*&&\s*newBcId\s*!==\s*oldStorage\.last_broadcast_id\s*&&\s*newBcUrl\s*\)/.test(extract(bg, 'applyPolicies')));
check('manifest の version は 1.6.4 のまま', manifest.version === '1.6.4', manifest.version);
check('manifest に default_popup を追加していない',
  !JSON.stringify(manifest).includes('default_popup'));

// --- 実行時: URL 正規化
function mkBgCtx() {
  const state = { created: [], logs: [], now: 1000000 };
  const ctx = {
    console: { log: (m) => state.logs.push(String(m)), warn: () => {}, error: (m) => state.logs.push('E:' + String(m)) },
    String, Number, Array, Object, Boolean, RegExp, Math, JSON, URL, Date,
    setTimeout: () => 0,
    chrome: {
      tabs: { create: (o) => { state.created.push(o.url); return Promise.resolve({ id: state.created.length }); } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(
    'const BROADCAST_DEDUP_WINDOW_MS = ' + WIN + ';\n' +
    'var lastBroadcastUrls = [];\n' +
    'var lastBroadcastOpenedId = "";\n' +
    'var broadcastGuardUntil = 0;\n' +
    'var broadcastTabId = null;\n' +
    extract(bg, 'normalizeBroadcastUrl') + '\n' +
    extract(bg, 'claimBroadcastUrlOnce') + '\n' +
    extract(bg, 'openBroadcastUrl'), ctx);
  // Date.now だけ差し替え（時刻を進めて窓の経過を検証する）
  ctx.Date = { now: () => state.now };
  vm.runInContext('', ctx);
  return { ctx, state };
}

(function () {
  const { ctx } = mkBgCtx();
  const n = ctx.normalizeBroadcastUrl;
  check('末尾スラッシュを落とす', n('https://a.ed.jp/p/') === 'https://a.ed.jp/p', n('https://a.ed.jp/p/'));
  check('ホスト名の大文字小文字を吸収する', n('https://A.ED.JP/p') === 'https://a.ed.jp/p', n('https://A.ED.JP/p'));
  check('https の既定ポート :443 を落とす', n('https://a.ed.jp:443/p') === 'https://a.ed.jp/p', n('https://a.ed.jp:443/p'));
  check('http の既定ポート :80 を落とす', n('http://a.ed.jp:80/p') === 'http://a.ed.jp/p', n('http://a.ed.jp:80/p'));
  check('非既定ポートは残す', n('https://a.ed.jp:8443/p') === 'https://a.ed.jp:8443/p', n('https://a.ed.jp:8443/p'));
  check('スキーム省略時は https を補う', n('a.ed.jp/p') === 'https://a.ed.jp/p', n('a.ed.jp/p'));
  check('クエリは比較対象に含める', n('https://a.ed.jp/p?x=1') === 'https://a.ed.jp/p?x=1', n('https://a.ed.jp/p?x=1'));
  check('ルート直下の / は残す', n('https://a.ed.jp/') === 'https://a.ed.jp/', n('https://a.ed.jp/'));
  check('空文字は空文字のまま', n('') === '', n(''));
})();

// --- 実行時: claimBroadcastUrlOnce の時間窓
(function () {
  const { ctx } = mkBgCtx();
  const c = ctx.claimBroadcastUrlOnce;
  check('初回は許可', c('https://dup.ed.jp/page', 0) === true);
  check('1秒後の同一URLは抑止', c('https://dup.ed.jp/page', 1000) === false);
  check('表記ゆれ（大文字・末尾スラッシュ）でも同一と判定', c('https://DUP.ed.jp/page/', 2000) === false);
  check('別URLは許可', c('https://dup.ed.jp/other', 2000) === true);
  check('窓の直前（29999ms）は抑止', c('https://dup.ed.jp/page', 29999) === false);
  check('窓の経過後（30001ms）は許可', c('https://dup.ed.jp/page', 30001) === true);
  check('空URLは常に許可（配信解除は対象外）', c('', 30002) === true && c('', 30003) === true);
  check('空白のみのURLも常に許可', c('   ', 30004) === true);
})();

// --- 実行時: openBroadcastUrl が実際にタブを2枚開かないこと
(async function () {
  const { ctx, state } = mkBgCtx();
  const open = ctx.openBroadcastUrl;
  const URL1 = 'https://dup.ed.jp/page';

  state.now = 1000000;
  await open(URL1, 'bc_A');
  check('1回目はタブを開く', state.created.length === 1, state.created.length);

  state.now = 1004000;   // +4秒（実機の 8秒→14秒 相当）
  await open(URL1, 'bc_B');
  check('IDが違っても30秒以内の同一URLは2枚目を開かない',
    state.created.length === 1, state.created.length);

  state.now = 1006000;
  check('抑止した場合も処理済みIDを記録する',
    vm.runInContext('lastBroadcastOpenedId', ctx) === 'bc_B',
    vm.runInContext('lastBroadcastOpenedId', ctx));
  check('抑止ログが残る（原因を後から追える）',
    state.logs.some(l => l.indexOf('同一URLの二重オープンを抑止') >= 0), state.logs.length);

  state.now = 1008000;
  await open('https://dup.ed.jp/other', 'bc_C');
  check('別URLなら正常に開く', state.created.length === 2, state.created.length);

  state.now = 1009000;
  await open('https://dup.ed.jp/other', 'bc_C');
  check('同一 broadcast_id の再送は従来どおり開かない', state.created.length === 2, state.created.length);

  // 表記ゆれの同一URL（窓内）
  state.now = 1010000;
  await open('https://DUP.ed.jp/page/', 'bc_D');
  check('表記ゆれの同一URLも窓内なら開かない', state.created.length === 2, state.created.length);

  // 窓を超えたら同じURLでも開く
  state.now = 1035000;
  await open(URL1, 'bc_E');
  check('30秒経過後は同じURLでも開く', state.created.length === 3, state.created.length);

  check('開いたタブのURLは正規化前の元URL（表示先が変わらない）',
    state.created[0] === URL1 && state.created[2] === URL1, state.created);

  // まとめ
  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
})();
