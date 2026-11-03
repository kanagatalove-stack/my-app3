// R34: ブラウザ起点ビーコン + 保留キュー自己修復 の検証
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');

function extract(s, name) {
  const re = new RegExp('^(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  return s.slice(st, end + 1);
}
function lineConst(s, name) {
  const m = s.match(new RegExp('^const ' + name + '\\s*=[^;]*;', 'm'));
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}

let pass = 0, fail = 0;
function check(n, c, e) { if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; } else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; } }

// ------------------------------------------------------------------ 保留キュー本体
console.log('===== [GAS] R34: 保留キューの蓄積・重複排除・送信・失敗保持 =====');

const store = {};
const logLines = [];
const calls = { fetchMany: 0 };

function mkCtx(responses) {
  const c = {
    console, JSON, String, Number, Array, Object, Boolean, Error, Math, Date,
    SHARD_ASYNC_PROP: 'SHARD_ASYNC_QUEUE',
    SHARD_ASYNC_MAX_CHARS: 8000,
    Logger: { log(m) { logLines.push(String(m)); } },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return (k in store) ? store[k] : null; },
          setProperty(k, v) { store[k] = String(v); },
          deleteProperty(k) { delete store[k]; }
        };
      }
    },
    LockService: { getScriptLock() { return { waitLock() { return true; }, releaseLock() {} }; } },
    shardFetchMany(reqs) {
      calls.fetchMany++;
      const arr = Array.isArray(reqs) ? reqs : [];
      return arr.map(function (r) { return (responses && responses[r.url]) || null; });
    }
  };
  vm.createContext(c);
  let b = '';
  ['shardReadPending', 'shardQueuePending', 'shardDropPending', 'shardFlushPending']
    .forEach(function (n) { b += extract(src, n) + '\n'; });
  vm.runInContext(b, c);
  return c;
}

function reset() { Object.keys(store).forEach(k => delete store[k]); logLines.length = 0; calls.fetchMany = 0; }

const ok200 = { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
const err500 = { getResponseCode() { return 500; }, getContentText() { return 'boom'; } };
const jsonNo = { getResponseCode() { return 200; }, getContentText() { return '{"success":false,"error":"unauthorized"}'; } };

// --- 1) 蓄積
reset();
let ctx = mkCtx({});
const r1 = [{ url: 'https://c1/exec', method: 'post', payload: '{"a":1}' }];
check('保留に積める（true=待たなくてよい）', ctx.shardQueuePending(r1) === true);
check('スクリプトプロパティに保存される', typeof store['SHARD_ASYNC_QUEUE'] === 'string' && store['SHARD_ASYNC_QUEUE'].length > 2);
check('読み出しで1件返る', ctx.shardReadPending().length === 1);

// --- 2) 追記（連続操作で先の指示を落とさない）
const r2 = [{ url: 'https://c2/exec', method: 'post', payload: '{"b":2}' }];
ctx.shardQueuePending(r2);
check('2回目は追記される（上書きしない）', ctx.shardReadPending().length === 2, ctx.shardReadPending().length);

// --- 3) 同一内容の重複は畳む
ctx.shardQueuePending(r1);
check('同一内容の再送は畳む', ctx.shardReadPending().length === 2, ctx.shardReadPending().length);

// --- 4) 空配列は「待つ必要なし」
check('空配列でも true（待つ必要がない）', ctx.shardQueuePending([]) === true);

// --- 5) 容量超過は同期送信へ（false）
reset();
const big = [];
for (let i = 0; i < 200; i++) big.push({ url: 'https://c' + i + '/exec', method: 'post', payload: new Array(200).join('x') });
check('容量超過なら false（同期送信に任せる）', ctx.shardQueuePending(big) === false);

// --- 6) 送信成功で保留から消える
reset();
ctx = mkCtx({ 'https://c1/exec': ok200, 'https://c2/exec': ok200 });
ctx.shardQueuePending(r1); ctx.shardQueuePending(r2);
const fl = ctx.shardFlushPending();
check('全件送信される', fl.sent === 2, fl);
check('成功分は保留から消える', fl.removed === 2, fl);
check('保留が空になる', ctx.shardReadPending().length === 0, ctx.shardReadPending());
check('fetchMany を1回だけ呼ぶ（並列1回）', calls.fetchMany === 1, calls.fetchMany);

// --- 7) 失敗分は保留に残る（自己修復の根拠）
reset();
ctx = mkCtx({ 'https://c1/exec': ok200, 'https://c2/exec': err500 });
ctx.shardQueuePending(r1); ctx.shardQueuePending(r2);
const fl2 = ctx.shardFlushPending();
check('成功1件・失敗1件を正しく分ける', fl2.removed === 1 && fl2.queued === 1, fl2);
const left = ctx.shardReadPending();
check('失敗分だけが残る', left.length === 1 && left[0].url === 'https://c2/exec', left);
check('500 はログに残す', logLines.some(l => l.indexOf('500') >= 0), logLines);

// --- 8) success:false（HTTP 200）も失敗扱いで残す
reset();
ctx = mkCtx({ 'https://c1/exec': jsonNo });
ctx.shardQueuePending(r1);
const fl3 = ctx.shardFlushPending();
check('HTTP 200 でも success:false は残す', fl3.removed === 0 && fl3.queued === 1, fl3);
check('拒否理由をログに残す', logLines.some(l => l.indexOf('拒否') >= 0), logLines);

// --- 9) 応答なしも残す
reset();
ctx = mkCtx({});
ctx.shardQueuePending(r1);
const fl4 = ctx.shardFlushPending();
check('応答なしは残す', fl4.removed === 0 && fl4.queued === 1, fl4);

// --- 10) 空のときは通信しない
reset();
ctx = mkCtx({});
const fl5 = ctx.shardFlushPending();
check('保留が無ければ通信しない', calls.fetchMany === 0 && fl5.sent === 0, fl5);

// --- 11) 例外時も保留を失わない
reset();
ctx = mkCtx({});
ctx.shardQueuePending(r1);
ctx.shardFetchMany = function () { throw new Error('network down'); };
const fl6 = ctx.shardFlushPending();
// 例外文言をそのまま出すとテストランナーの異常検出に誤ヒットするため、有無だけを表示する
check('送信例外でも落ちない', !!fl6 && typeof fl6.error === 'string',
  fl6 ? { hasError: true, sent: fl6.sent } : null);
check('送信例外でも保留は残る', ctx.shardReadPending().length === 1, ctx.shardReadPending().length);

// ------------------------------------------------------------------ shardPropagatePolicy 実物
console.log('\n===== [GAS] R34: shardPropagatePolicy が「待たずに積む」か（実物） =====');
reset();

const COLS = ['児童ID', '学校名', 'クラス'];
const rows = [
  COLS.slice(),
  ['s1@x.ed.jp', '第一小学校', '5年1組'],
  ['s2@x.ed.jp', '第一小学校', '6年1組']
];
let fetchManyCalled = 0;

const p = {
  console, JSON, String, Number, Array, Object, Boolean, Error, Math, Date, Set,
  CONFIG: { DEVICE_SHEET_NAME: 'devices', DEVICE_COLUMNS: COLS },
  SHARD_ASYNC_ENABLED: true,
  SHARD_ASYNC_PROP: 'SHARD_ASYNC_QUEUE',
  SHARD_ASYNC_MAX_CHARS: 8000,
  Logger: { log(m) { logLines.push(String(m)); } },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(k) { return (k in store) ? store[k] : null; },
        setProperty(k, v) { store[k] = String(v); },
        deleteProperty(k) { delete store[k]; }
      };
    }
  },
  LockService: { getScriptLock() { return { waitLock() { return true; }, releaseLock() {} }; } },
  isShardParent() { return true; },
  shardConfigCached() {
    return {
      map: { '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' },
      def: '', sec: 'sk_test'
    };
  },
  shardMapIndexFromMap(map) {
    const out = {};
    Object.keys(map || {}).forEach(function (k) { out[k.replace('年', '-').replace('組', '')] = map[k]; });
    return out;
  },
  shardMapDefaultFromEmptyKey() { return ''; },
  normalizeShardClass(raw) { return String(raw || '').replace('年', '-').replace('組', ''); },
  getTargetSheet() { return {}; },
  getHeaderMap() { return { '児童ID': 1, '学校名': 2, 'クラス': 3 }; },
  getDeviceScopeRowsCached() { return rows.map(r => r.slice()); },
  bulkTraceMark() {},
  shardFetchMany(reqs) { fetchManyCalled++; return (reqs || []).map(() => ok200); }
};
vm.createContext(p);
let pb = '';
['shardReadPending', 'shardQueuePending', 'shardDropPending', 'shardCoalescePending', 'shardFlushPending', 'shardPropagatePolicy']
  .forEach(function (n) { pb += extract(src, n) + '\n'; });
vm.runInContext(pb, p);

reset();
const pol = p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
check('deferred:true を返す（応答を待っていない）', pol && pol.deferred === true, pol);
check('応答待ちの fetchMany を呼ばない', fetchManyCalled === 0, fetchManyCalled);
const pend = p.shardReadPending();
check('子GAS宛の送信内容が保留に積まれる', pend.length === 1 && pend[0].url === 'https://child-a/exec', pend);
check('ロック指示が payload に入っている', pend.length === 1 && String(pend[0].payload).indexOf('"screen_lock":true') >= 0, pend.length ? pend[0].payload : '');
check('対象児童IDが payload に入っている', pend.length === 1 && String(pend[0].payload).indexOf('s1@x.ed.jp') >= 0);
check('クラス情報も添えられている', pend.length === 1 && String(pend[0].payload).indexOf('5年1組') >= 0);

// 全校（2クラス）でも2件積まれる
reset();
const pol2 = p.shardPropagatePolicy('ALL', { screen_lock: false });
check('ALL で2つの子GASに分かれる', p.shardReadPending().length === 2, p.shardReadPending().length);
check('ALL でも deferred', pol2 && pol2.deferred === true, pol2);
check('ALL でも fetchMany を呼ばない', fetchManyCalled === 0, fetchManyCalled);

// ------------------------------------------------------------------ R34b 畳み込み
console.log('\n===== [GAS] R34b: 同一児童への複数指示は「最後の指示が勝つ」 =====');
reset();
// ロックON を押して、すぐ OFF に直した状況を作る
p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: false });
check('保留には2件入っている', p.shardReadPending().length === 2, p.shardReadPending().length);

let sentPayloads = [];
p.shardFetchMany = function (reqs) {
  fetchManyCalled++;
  sentPayloads = (reqs || []).map(r => String(r.payload));
  return (reqs || []).map(() => ok200);
};
fetchManyCalled = 0;
const flc = p.shardFlushPending();
check('畳み込んで1回だけ送る', fetchManyCalled === 1 && sentPayloads.length === 1, sentPayloads);
check('最終状態は OFF（古い ON で上書きされない）',
  sentPayloads.length === 1 && sentPayloads[0].indexOf('"screen_lock":false') >= 0, sentPayloads);
check('古い ON は送られない',
  !sentPayloads.some(x => x.indexOf('"screen_lock":true') >= 0), sentPayloads);
check('畳んだ元の2件とも保留から消える', flc.removed === 2 && p.shardReadPending().length === 0, flc);

// 別項目（ロックとURL配信）は片方が消えない
reset();
p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
p.shardPropagatePolicy(['s1@x.ed.jp'], { broadcast_url: 'https://example.com/a' });
sentPayloads = [];
fetchManyCalled = 0;
p.shardFlushPending();
check('別項目は両方残る（片方が消えない）',
  sentPayloads.length === 1 &&
  sentPayloads[0].indexOf('"screen_lock":true') >= 0 &&
  sentPayloads[0].indexOf('"broadcast_url"') >= 0, sentPayloads);

// 失敗したら畳んだ元の全件が保留に残る
reset();
p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: false });
p.shardFetchMany = function (reqs) { fetchManyCalled++; return (reqs || []).map(() => err500); };
fetchManyCalled = 0;
const flf = p.shardFlushPending();
check('失敗時は畳んだ元の全件が残る', flf.removed === 0 && p.shardReadPending().length === 2, flf);


// 積めない環境では同期送信へフォールバックする（機能が落ちない）
delete p.PropertiesService;
fetchManyCalled = 0;
const pol3 = p.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
check('積めない環境では同期送信にフォールバック', fetchManyCalled === 1, fetchManyCalled);
check('同期送信時は deferred を付けない', pol3 && !pol3.deferred, pol3 && Object.keys(pol3));

// ------------------------------------------------------------------ 配線（静的）
console.log('\n===== [配線] R34: ビーコン経路と回収経路が繋がっているか =====');
check('doPost に shard_flush アクションがある', /if \(action === 'shard_flush'\)/.test(src));
check('shard_flush はトークン必須', /if \(action === 'shard_flush'\)[\s\S]{0,200}?verifyToken\(payload\.token\)/.test(src));
check('console_touch でも保留を回収する（15秒ごとの自己修復）',
  /action === 'console_touch'\)[\s\S]{0,400}?shardFlushPending\(\)/.test(src));
check('console_release でも保留を回収する',
  /action === 'console_release'\)[\s\S]{0,400}?shardFlushPending\(\)/.test(src));
check('api_consoleTouch（google.script.run 経路）でも回収する',
  /function api_consoleTouch[\s\S]{0,600}?shardFlushPending\(\)/.test(src));
check('api_consoleRelease でも回収する',
  /function api_consoleRelease[\s\S]{0,600}?shardFlushPending\(\)/.test(src));
check('ScriptApp のトリガーは完全に撤去された',
  src.indexOf('newTrigger') < 0 && src.indexOf('getProjectTriggers') < 0);
check('旧名の関数が残っていない',
  src.indexOf('shardQueueDeferred') < 0 && src.indexOf('shardRunDeferredPropagate') < 0);

check('[FE] ビーコン送信関数がある', /function sendShardFlushBeacon/.test(html));
check('[FE] 対象アクションを判定する', /function isShardFlushAction/.test(html));
check('[FE] sendBeacon を使う', /navigator\.sendBeacon\(url, blob\)/.test(html));
check('[FE] sendBeacon 不可時は fetch(keepalive) へ', /keepalive: true/.test(html));
check('[FE] google.script.run 成功時に予約する',
  /google\.script\.run[\s\S]{0,1200}?isShardFlushAction\(payload\.action\)[\s\S]{0,80}?requestShardFlush\(\)/.test(html));
check('[FE] fetch 経路でも予約する（両経路で漏らさない）',
  (html.match(/isShardFlushAction\(payload\.action\)/g) || []).length >= 2,
  (html.match(/isShardFlushAction\(payload\.action\)/g) || []).length);

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
