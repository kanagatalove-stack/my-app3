// R41: 親GASから同期直送を撤去し、ブラウザから親/子GASへ「並列 POST」する の検証
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');

// index.html の関数は 4 スペース字下げされているため、行頭の空白を許容する。
// （Code.gs は行頭 column 0 なので、どちらにも効く）
function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  return s.slice(st, end + 1);
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// ==================================================================
// 1) GAS: 親から子への同期直送が完全に撤去されていること
// ==================================================================
console.log('===== [GAS] R41: 同期 InlineKick の完全撤去 =====');

check('SHARD_INLINE_KICK 定数は無い', src.indexOf('SHARD_INLINE_KICK') < 0);
check('shardInlineKick 関数は無い', src.indexOf('shardInlineKick') < 0);
check('inlineKick の指定は1箇所も残っていない', src.indexOf('inlineKick') < 0);
check('kickNow の分岐も残っていない', src.indexOf('kickNow') < 0);

// shardPropagatePolicy は 2 引数に戻っていること
check('shardPropagatePolicy は2引数（studentIds, patch）',
  /function\s+shardPropagatePolicy\s*\(\s*studentIds\s*,\s*patch\s*\)/.test(src));

// doPost の 4 経路は opts を渡さない
const dopostStart = src.indexOf('function doPost(');
const dopostHead = src.slice(dopostStart, src.indexOf('\nfunction ', dopostStart + 10));
const callSites = (dopostHead.match(/shardPropagatePolicy\(/g) || []).length;
check('doPost の shardPropagatePolicy 呼び出しは4箇所', callSites === 4, callSites);
check('doPost は第3引数を渡さない',
  !/shardPropagatePolicy\([^;]*\)\s*,\s*\{\s*inlineKick/.test(dopostHead));

// 親は「保留へ積むだけ」で応答を待たない
const fnProp = extract(src, 'shardPropagatePolicy');
check('保留へ積む経路が健在（取りこぼし防止）', fnProp.indexOf('shardQueuePending(') >= 0);
check('積んだら即 return する（子の応答を待たない）', /return\s*\{\s*sent:\s*queuedResults\s*,\s*deferred:\s*true\s*\}/.test(fnProp));
check('保留へ積む直後に子GASへの直送キックをしない', fnProp.indexOf('shardInlineKick') < 0);

// ==================================================================
// 2) GAS: shard_config で子GAS接続情報を配布する
// ==================================================================
console.log('\n===== [GAS] R41: shard_config（ブラウザへの接続情報配布） =====');

check("doPost に action==='shard_config' の分岐がある",
  /action\s*===\s*'shard_config'/.test(src));
check('shard_config は shardClientConfig() を JSON で返す',
  /if\s*\(\s*action\s*===\s*'shard_config'\s*\)\s*\{\s*return\s+jsonResponse\(\s*shardClientConfig\(\)\s*\)/.test(src));

const fnCfg = extract(src, 'shardClientConfig');
check('shardClientConfig がある', !!fnCfg);
['enabled', 'secret', 'classes', 'empty_default', 'default_url'].forEach(k => {
  check('返却に ' + k + ' を含む', new RegExp('\\b' + k + ':').test(fnCfg));
});
check('親でなければ enabled:false（機能を落とさない）',
  /!isShardParent\(\)\s*\)\s*return\s*\{\s*success:\s*true\s*,\s*enabled:\s*false\s*\}/.test(fnCfg));
check('子GAS未設定でも enabled:false を返す', /if\s*\(!classes\.length\s*&&\s*!emptyDefault\s*&&\s*!defUrl\)/.test(fnCfg));
check('例外時も throw せず enabled:false を返す',
  /catch\s*\(e\)\s*\{\s*return\s*\{\s*success:\s*false\s*,\s*enabled:\s*false/.test(fnCfg));

// 実行時: 設定が無い環境では enabled:false
(function () {
  const ctx = {
    console, JSON, String, Number, Array, Object, Boolean, Error,
    isShardParent: () => true,
    shardConfigCached: () => ({ map: {}, def: '', sec: 'SEC' }),
    shardMapIndexFromMap: () => ({}),
    shardMapDefaultFromEmptyKey: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'shardClientConfig'), ctx);
  const r = ctx.shardClientConfig();
  check('実行時: 子GAS未設定なら enabled:false', r.success === true && r.enabled === false, r);
})();

// 実行時: 設定がある環境では URL と secret を配る
(function () {
  const ctx = {
    console, JSON, String, Number, Array, Object, Boolean, Error,
    isShardParent: () => true,
    shardConfigCached: () => ({ map: { '5年1組': 'https://child-a/exec' }, def: '', sec: 'SECRET-X' }),
    shardMapIndexFromMap: m => ({ '5-1': String(m['5年1組']) }),
    shardMapDefaultFromEmptyKey: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'shardClientConfig'), ctx);
  const r = ctx.shardClientConfig();
  check('実行時: enabled:true / secret を返す', r.enabled === true && r.secret === 'SECRET-X', r);
  check('実行時: classes に正規化キーとURLが入る',
    Array.isArray(r.classes) && r.classes[0] && r.classes[0].normalized === '5-1' &&
    r.classes[0].url === 'https://child-a/exec', r.classes);
})();

// 実行時: 子GAS（親でない）では何も配らない
(function () {
  const ctx = {
    console, JSON, String, Number, Array, Object, Boolean, Error,
    isShardParent: () => false,
    shardConfigCached: () => ({ map: { '5年1組': 'https://child-a/exec' }, def: '', sec: 'S' }),
    shardMapIndexFromMap: () => ({}), shardMapDefaultFromEmptyKey: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'shardClientConfig'), ctx);
  const r = ctx.shardClientConfig();
  check('実行時: 子GASでは enabled:false', r.enabled === false && r.secret === undefined, r);
})();

// ==================================================================
// 3) フロントエンド: 並列直送の実装
// ==================================================================
console.log('\n===== [FE] R41: ブラウザから親/子へ並列 POST =====');

const FE = ['normalizeShardClassJs', 'parseBoolJs', 'fetchShardConfigDirect',
            'syncShardClientConfig', 'shardPatchFromPayload', 'shardResolveTargets',
            'fireShardApplyParallel'];
FE.forEach(n => {
  check(n + ' が1つだけ定義されている',
    (html.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length === 1);
});

// --- shard_config の取得
const fnFetchCfg = extract(html, 'fetchShardConfigDirect');
check('設定取得は直接 fetch（google.script.run の runner 表に無い）',
  fnFetchCfg.indexOf('fetch(') >= 0 && fnFetchCfg.indexOf('google.script.run') < 0);
check("action:'shard_config' を送る", /action:\s*'shard_config'/.test(fnFetchCfg));
check('token を添える', /token:\s*authToken/.test(fnFetchCfg));
check('text/plain でプリフライトを起こさない',
  /'Content-Type':\s*'text\/plain;charset=utf-8'/.test(fnFetchCfg));
check('失敗しても enabled:false に落とす（機能を止めない）',
  (fnFetchCfg.match(/enabled:\s*false/g) || []).length >= 2);

const fnSync = extract(html, 'syncShardClientConfig');
check('syncShardClientConfig はメモ化する', fnSync.indexOf('shardClientCfgPromise') >= 0);
check('未ログインなら取得しない', /if\s*\(!authToken\)\s*return/.test(fnSync));

// --- 並列発火
const fnFire = extract(html, 'fireShardApplyParallel');
check('Promise.all で並列送出する', fnFire.indexOf('Promise.all(') >= 0);
check("action:'shard_apply' を送る", /action:\s*'shard_apply'/.test(fnFire));
check('shard_secret を添える', /shard_secret:\s*cfg\.secret/.test(fnFire));
check('student_ids を添える', /student_ids:\s*groups\[u\]\.ids/.test(fnFire));
check('class_map を添える（子が行を作れる）', /class_map:\s*groups\[u\]\.classMap/.test(fnFire));
check('text/plain でプリフライトを起こさない',
  /'Content-Type':\s*'text\/plain;charset=utf-8'/.test(fnFire));
check('送信に失敗しても throw しない（親の書き込みを巻き込まない）',
  fnFire.indexOf('.catch(function () { return null; })') >= 0);
check('並列直送の対象は shard 伝達アクションのみ',
  /isShardFlushAction\(act\)/.test(fnFire));

// --- runMutation が「同じ tick」で撃つ
const fnMut = extract(html, 'runMutation');
check('runMutation が並列直送を呼ぶ', fnMut.indexOf('fireShardApplyParallel(payload.action, payload)') >= 0);
const iPush = fnMut.indexOf('fireShardApplyParallel(');
const iReq = fnMut.indexOf('apiRequest(payload)');
check('直送は apiRequest より先に撃たれる（同一 tick）', iPush >= 0 && iReq > iPush, [iPush, iReq]);
check('直送の戻り値を await しない（画面を待たせない）',
  !/await\s+shardPush/.test(fnMut) && !/await\s+fireShardApplyParallel/.test(fnMut));
check('直送の失敗は握りつぶす', /try\s*\{\s*shardPush\s*=\s*fireShardApplyParallel/.test(fnMut));

// --- 直送が有効な間はビーコンを撃たない（親の UrlFetchApp 経路を復活させない）
const fnSched = extract(html, 'scheduleShardFlushRetries');
check('直送が有効ならビーコンを撃たない',
  /if\s*\(shardClientCfg\s*&&\s*shardClientCfg\.enabled\)\s*return/.test(fnSched));
check("'delayed' 既定は維持（直送が無効な環境の保険）",
  /SHARD_FLUSH_BEACON_AT\s*===\s*'send'/.test(fnSched) && fnSched.indexOf('scheduleShardFlushDelayed') >= 0);

// --- ライフサイクル
check('ログイン成功時に設定を取得する', (html.match(/syncShardClientConfig\(true\)/g) || []).length >= 2,
  (html.match(/syncShardClientConfig\(true\)/g) || []).length);
check('ログアウトで URL と secret を破棄する',
  /shardClientCfg\s*=\s*null;[\s\S]{0,120}?shardClientCfgPromise\s*=\s*null;/.test(html));
check('前回のビーコン多重連射が復活していない',
  html.indexOf('SHARD_FLUSH_RETRY_DELAYS') < 0 && html.indexOf('sendShardFlushProbe') < 0);

// ==================================================================
// 4) クラス名の正規化が GAS と完全一致すること（キーずれ＝未達の原因）
// ==================================================================
console.log('\n===== [PARITY] R41: normalizeShardClass の GAS/ブラウザ一致 =====');

const gasCtx = { String, Number, Object, console };
vm.createContext(gasCtx);
vm.runInContext(extract(src, 'normalizeShardClass'), gasCtx);

const feCtx = { String, Number, Object, console };
vm.createContext(feCtx);
vm.runInContext(extract(html, 'normalizeShardClassJs'), feCtx);

const samples = ['5年1組', '5-1', '５年１組', '5/1', '5ー1', '5 年 1 組', '５組', '5組',
                 '  3年2組  ', '未設定', '', null, undefined, 'ひまわり', '１年１組',
                 '６年３組', '6年3組', 'abc', '4'];
samples.forEach(s => {
  const a = gasCtx.normalizeShardClass(s);
  const b = feCtx.normalizeShardClassJs(s);
  check('一致: ' + JSON.stringify(s === undefined ? 'undefined' : s), a === b, { gas: a, fe: b });
});

// parseBoolJs は "false" を true にしない（R38 の根本原因の再発防止）
const pCtx = { String, Number, Boolean, Object, console };
vm.createContext(pCtx);
vm.runInContext(extract(html, 'parseBoolJs'), pCtx);
check("parseBoolJs('false') は false", pCtx.parseBoolJs('false') === false);
check("parseBoolJs('true') は true", pCtx.parseBoolJs('true') === true);
check('parseBoolJs(false) は false', pCtx.parseBoolJs(false) === false);
check("parseBoolJs('0') は false", pCtx.parseBoolJs('0') === false);
check("parseBoolJs('1') は true", pCtx.parseBoolJs('1') === true);

// ==================================================================
// 5) patch 生成が GAS 側 shardPropagatePolicy と同形であること
// ==================================================================
console.log('\n===== [FE] R41: 子GASへ渡す patch の形 =====');

const patchCtx = { String, Number, Boolean, Object, JSON, console, parseBoolJs: pCtx.parseBoolJs };
vm.createContext(patchCtx);
vm.runInContext(extract(html, 'shardPatchFromPayload'), patchCtx);
const mk = patchCtx.shardPatchFromPayload;

const p1 = mk('bulk_lock', { locked: 'false' });
check('bulk_lock: screen_lock は真偽値（"false"→false）', p1.screen_lock === false, p1);
const p2 = mk('bulk_lock', { locked: true });
check('bulk_lock: ロック時は true', p2.screen_lock === true, p2);
const p3 = mk('bulk_broadcast', { url: 'https://x.ed.jp/a' });
check('bulk_broadcast: broadcast_url', p3.broadcast_url === 'https://x.ed.jp/a', p3);
const p4 = mk('bulk_filter', { filter_mode: 'whitelist', whitelist_urls: 'a\nb', blacklist_urls: '' });
check('bulk_filter: 3項目を渡す',
  p4.filter_mode === 'whitelist' && p4.whitelist_urls === 'a\nb' && p4.blacklist_urls === '', p4);
const p5 = mk('update_single', { data: { screen_lock: 'false', broadcast_url: 'https://y' } });
check('update_single: data から patch を作る',
  p5.screen_lock === false && p5.broadcast_url === 'https://y', p5);
const p6 = mk('bulk_lock', {});
check('値が無ければキーを作らない（誤上書き防止）', Object.keys(mk('bulk_filter', {})).length === 0, mk('bulk_filter', {}));
void p6;

// ==================================================================
// 6) 宛先解決（クラス→子GAS URL）が GAS と同じ順序であること
// ==================================================================
console.log('\n===== [FE] R41: 児童ID→子GAS URL の振り分け =====');

function mkResolver(cfg, devices) {
  const ctx = {
    String, Number, Boolean, Object, JSON, Array, console,
    shardClientCfg: cfg,
    devicesData: devices,
    normalizeShardClassJs: feCtx.normalizeShardClassJs
  };
  vm.createContext(ctx);
  vm.runInContext(extract(html, 'shardResolveTargets'), ctx);
  return ctx.shardResolveTargets;
}

const cfgA = {
  enabled: true, secret: 'S',
  classes: [{ normalized: '5-1', url: 'https://child-51/exec' },
            { normalized: '5-2', url: 'https://child-52/exec' }],
  empty_default: '', default_url: ''
};
const devicesA = [
  { student_id: 'a@x', class_name: '5年1組' },
  { student_id: 'b@x', class_name: '５年２組' },
  { student_id: 'c@x', class_name: '未設定' }
];
const resA = mkResolver(cfgA, devicesA)(['a@x', 'b@x', 'c@x']);
check('クラス一致で2つの子GASに振り分ける', Object.keys(resA).length === 2, Object.keys(resA));
check('a@x は 5-1 の子GASへ', resA['https://child-51/exec'].ids.indexOf('a@x') >= 0);
check('b@x は 5-2 の子GASへ（全角も一致）', resA['https://child-52/exec'].ids.indexOf('b@x') >= 0);
check('未設定クラスは宛先なし（default 未設定）', !Object.keys(resA).some(u => resA[u].ids.indexOf('c@x') >= 0));
check('class_map に元の表記を渡す',
  resA['https://child-51/exec'].classMap['a@x'] === '5年1組',
  resA['https://child-51/exec'].classMap);

// 空キー既定 → SHARD_DEFAULT_URL の順で解決
const cfgB = { enabled: true, secret: 'S', classes: [], empty_default: 'https://child-def/exec', default_url: 'https://child-dflt/exec' };
const resB = mkResolver(cfgB, [{ student_id: 'z@x', class_name: '6年1組' }])(['z@x']);
check('空キー既定URLが優先される', !!resB['https://child-def/exec'], Object.keys(resB));

const cfgC = { enabled: true, secret: 'S', classes: [], empty_default: '', default_url: 'https://child-dflt/exec' };
const resC = mkResolver(cfgC, [{ student_id: 'z@x', class_name: '6年1組' }])(['z@x']);
check('無ければ SHARD_DEFAULT_URL に落ちる', !!resC['https://child-dflt/exec'], Object.keys(resC));

const resD = mkResolver({ enabled: false }, devicesA)(['a@x']);
check('直送が無効なら振り分けない（従来動作）', resD === null, resD);

// ==================================================================
// 7) 並列 fetch の実行時検証（fetch を差し替えて送信内容を見る）
// ==================================================================
console.log('\n===== [FE] R41: 並列 fetch の実行時検証 =====');

function runFire(cfg, devices, act, payload) {
  const sent = [];
  const ctx = {
    String, Number, Boolean, Object, JSON, Array, Promise, console,
    shardClientCfg: cfg,
    devicesData: devices,
    isShardFlushAction: a => a === 'bulk_lock' || a === 'bulk_broadcast' || a === 'bulk_filter' || a === 'update_single',
    normalizeShardClassJs: feCtx.normalizeShardClassJs,
    parseBoolJs: pCtx.parseBoolJs,
    syncShardClientConfig: () => {},
    fetch: (u, o) => { sent.push({ url: u, opt: o }); return Promise.resolve({ ok: true }); }
  };
  vm.createContext(ctx);
  ['parseBoolJs', 'shardPatchFromPayload', 'shardResolveTargets', 'fireShardApplyParallel']
    .forEach(n => { if (!ctx[n]) vm.runInContext(extract(html, n), ctx); });
  const p = ctx.fireShardApplyParallel(act, payload);
  return { sent, p };
}

const r1 = runFire(cfgA, devicesA, 'bulk_lock', { locked: true, student_ids: ['a@x', 'b@x'] });
check('2つの子GASへ同時に送る（並列）', r1.sent.length === 2, r1.sent.map(s => s.url));
check('Promise を返す（await しない前提）', r1.p && typeof r1.p.then === 'function');
const b0 = JSON.parse(r1.sent[0].opt.body);
check('body: action は shard_apply', b0.action === 'shard_apply', b0.action);
check('body: shard_secret を送る', b0.shard_secret === 'S');
check('body: patch に screen_lock:true', b0.patch && b0.patch.screen_lock === true, b0.patch);
check('送信は text/plain（プリフライト回避）',
  r1.sent[0].opt.headers['Content-Type'] === 'text/plain;charset=utf-8');
check('redirect:follow で /exec の302を追う', r1.sent[0].opt.redirect === 'follow');

const r2 = runFire(cfgA, devicesA, 'update_single', { student_id: 'a@x', data: { screen_lock: 'false' } });
check('個別操作(update_single)も直送する', r2.sent.length === 1, r2.sent.length);
check('個別操作は該当クラスの子GASのみ', r2.sent[0].url === 'https://child-51/exec', r2.sent[0].url);
check('個別操作の patch は false（"false"→false）',
  JSON.parse(r2.sent[0].opt.body).patch.screen_lock === false,
  JSON.parse(r2.sent[0].opt.body).patch);

const r3 = runFire(cfgA, devicesA, 'get_all', {});
check('対象外アクションでは送らない', r3.sent.length === 0 && r3.p === null, r3.sent.length);

const r4 = runFire({ enabled: false }, devicesA, 'bulk_lock', { locked: true, student_ids: ['a@x'] });
check('直送が無効なら何も送らない', r4.sent.length === 0 && r4.p === null);

const r5 = runFire(cfgA, devicesA, 'bulk_lock', { locked: true, student_ids: ['c@x'] });
check('宛先が解決できない児童だけなら送らない', r5.sent.length === 0, r5.sent.length);

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
