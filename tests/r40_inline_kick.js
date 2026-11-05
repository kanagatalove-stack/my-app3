// R40: ビーコン発火タイミング（750ms 遅延）＋ 親GASからの直送キック の検証
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
// 1) フロントエンド: 既定は「送出から 750ms 後に1本」
// ==================================================================
console.log('===== [FE] R40: ビーコンは書き込み完了後 750ms に1本だけ =====');

const mAt = html.match(/var\s+SHARD_FLUSH_BEACON_AT\s*=\s*'([^']+)'/);
check("既定は 'delayed'（0ms の空振りを避ける）", !!mAt && mAt[1] === 'delayed', mAt && mAt[1]);

const mDelay = html.match(/var\s+SHARD_FLUSH_DELAY_MS\s*=\s*(\d+)/);
check('遅延は 750ms（echo 実測上限 533ms ＋ 余裕）', !!mDelay && Number(mDelay[1]) === 750,
  mDelay && mDelay[1]);

const mDelayed = html.match(/function\s+scheduleShardFlushDelayed\s*\([^)]*\)\s*\{/);
check('scheduleShardFlushDelayed がある', !!mDelayed);

const fnDelayed = mDelayed ? extract(html, 'scheduleShardFlushDelayed') : '';
check('setTimeout で遅延発火する', fnDelayed.indexOf('setTimeout') >= 0);
check('追い越されたら発火しない（seq ガード）', fnDelayed.indexOf('shardFlushDelaySeq') >= 0);
check('連打時は直前の予約を破棄する（同時1本）', fnDelayed.indexOf('clearTimeout') >= 0);

const fnSched = html.match(/function\s+scheduleShardFlushRetries\s*\([^)]*\)\s*\{/) ?
  extract(html, 'scheduleShardFlushRetries') : '';
check("'response' では送信時に撃たない", /SHARD_FLUSH_BEACON_AT\s*===\s*'response'/.test(fnSched));
check("'send'（0ms）は選択肢として残る", /SHARD_FLUSH_BEACON_AT\s*===\s*'send'/.test(fnSched));
check('既定経路で scheduleShardFlushDelayed を呼ぶ', fnSched.indexOf('scheduleShardFlushDelayed') >= 0);

// R38 で撤去した 5 段連射・R40 検討時の再試行プローブが復活していないこと
check('5段連射の配列が復活していない',
  html.indexOf('SHARD_FLUSH_RETRY_DELAYS') < 0 && html.indexOf('[400, 900, 1500]') < 0);
check('応答を読む再試行プローブは残っていない',
  html.indexOf('sendShardFlushProbe') < 0 && html.indexOf('scheduleShardFlushAdaptive') < 0);
check('ビーコン送信関数は健在', /function\s+sendShardFlushBeacon\s*\(/.test(html));

// ==================================================================
// 2) GAS: 直送キックの配線（静的）
// ==================================================================
console.log('\n===== [GAS] R40: 親の書き込み完了直後に子GASへ直送する配線 =====');

check('SHARD_INLINE_KICK 定数がある', /const\s+SHARD_INLINE_KICK\s*=\s*(true|false)\s*;/.test(src));
check('shardInlineKick がある', /function\s+shardInlineKick\s*\(/.test(src));

const fnKick = /function\s+shardInlineKick\s*\(/.test(src) ? extract(src, 'shardInlineKick') : '';
check('直送キックは shardFlushPending を呼ぶ', fnKick.indexOf('shardFlushPending()') >= 0);
check('キック無効時は何もしない', /SHARD_INLINE_KICK\s*===\s*'undefined'\s*\|\|\s*!SHARD_INLINE_KICK/.test(fnKick));
// ウォームインスタンスで固まらないこと（R40 で修正したバグの再発防止）
check('モジュール変数で回数制限していない（ウォーム対策）', fnKick.indexOf('__shardInlineKicked') < 0);

const fnProp = /function\s+shardPropagatePolicy\s*\(/.test(src) ? extract(src, 'shardPropagatePolicy') : '';
check('shardPropagatePolicy が第3引数 opts を受ける',
  /function\s+shardPropagatePolicy\s*\(\s*studentIds\s*,\s*patch\s*,\s*opts\s*\)/.test(src));
check('opts.inlineKick を kickNow として読む', /const\s+kickNow\s*=\s*!!\(opts\s*&&\s*opts\.inlineKick\)/.test(fnProp));
check('保留へ積んだ直後にキックする', fnProp.indexOf('shardInlineKick(') >= 0);
check('kickNow が false ならキックしない', /if\s*\(\s*kickNow\s*&&/.test(fnProp));

// doPost の4経路だけが inlineKick:true（google.script.run 側は同期送信のまま）
const kickSites = (src.match(/\{\s*inlineKick:\s*true\s*\}/g) || []).length;
check('inlineKick:true は doPost の4経路のみ', kickSites === 4, kickSites);

// doGet は doPost より前にある（743行 vs 800行）ため、終端は「doPost の次に来る関数」で切る。
const dopostStart = src.indexOf('function doPost(');
const dopostHead = src.slice(dopostStart, src.indexOf('\nfunction ', dopostStart + 10));
const runHead = src.slice(src.indexOf('function api_bulkLock('), src.indexOf('function api_bulkBroadcast('));
check('doPost の bulk_lock が inlineKick を渡す',
  /shardPropagatePolicy\(scoped\.ids,\s*\{\s*screen_lock:\s*parseBoolean\(payload\.locked\)\s*\},\s*\{\s*inlineKick:\s*true\s*\}\)/.test(dopostHead));
check('google.script.run の api_bulkLock は inlineKick を渡さない',
  runHead.indexOf('inlineKick') < 0);

// 空振りの可視化
check('空振り（保留なし）をログに残す',
  /保留なし（空振り）/.test(src) && /empty:\s*true/.test(src));

// ==================================================================
// 3) GAS: 実行時の疎通（本物の関数を vm で動かす）
// ==================================================================
console.log('\n===== [GAS] R40: 直送キックの実行時疎通（本物） =====');

const ok200 = { getResponseCode: () => 200, getContentText: () => '{"success":true}' };
let store = {};
let calls = [];

function mkCtx() {
  store = {};
  calls = [];
  const ctx = {
    console, JSON, String, Number, Array, Object, Boolean, Error, Math, Date, Set,
    CONFIG: { DEVICE_SHEET_NAME: 'devices', DEVICE_COLUMNS: ['児童ID', '学校名', 'クラス'] },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: k => { delete store[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock() {} }) },
    Logger: { log() {} },
    SHARD_ASYNC_ENABLED: true,
    SHARD_ASYNC_PROP: 'SHARD_ASYNC_QUEUE',
    SHARD_ASYNC_MAX_CHARS: 8000,
    SHARD_INLINE_KICK: true,
    SHARD_DIAG_MODE: false,
    isShardParent: () => true,
    isTeacherConsoleActive: () => true,
    shardConfigCached: () => ({ map: { '5年1組': 'https://child-a/exec' }, def: '', sec: 'SEC' }),
    shardMapIndexFromMap: m => {
      const o = {};
      Object.keys(m || {}).forEach(k => { o[String(k).trim()] = String(m[k]).trim(); });
      return o;
    },
    shardMapDefaultFromEmptyKey: () => '',
    normalizeShardClass: x => String(x || '').trim(),
    readShardDefaultUrl: () => '',
    getTargetSheet: () => ({}),
    getHeaderMap: () => ({ '児童ID': 1, '学校名': 2, 'クラス': 3 }),
    shardDeviceEntries: () => [['s1@x.ed.jp', '児童1', '5年1組']],
    bulkTraceMark() {},
    shardFetchMany(reqs) {
      calls.push((reqs || []).map(r => r.url));
      return (reqs || []).map(() => ok200);
    }
  };
  vm.createContext(ctx);
  let b = '';
  ['shardReadPending', 'shardQueuePending', 'shardDropPending', 'shardCoalescePending',
   'shardFlushPending', 'shardPropagatePolicy', 'shardInlineKick']
    .forEach(n => { b += extract(src, n) + '\n'; });
  vm.runInContext(b, ctx);
  return ctx;
}

// --- 3-1) inlineKick:true（doPost 経路）は即座に子GASへ送る
let c = mkCtx();
const r1 = c.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true }, { inlineKick: true });
check('inlineKick:true で子GASへ1回送信する', calls.length === 1 && calls[0][0] === 'https://child-a/exec', calls);
check('送信后は保留が空になる', c.shardReadPending().length === 0, c.shardReadPending().length);
check('deferred:true は維持される（応答を待っていない）', r1 && r1.deferred === true, r1 && r1.deferred);

// --- 3-2) 2回目も直送される（ウォームインスタンスで固まらない）
const r2 = c.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: false }, { inlineKick: true });
check('2回目も直送される（回数制限なし）', calls.length === 2, calls.length);
check('2回目も保留が空になる', c.shardReadPending().length === 0);
check('2回目は解除(false)が送られている',
  JSON.stringify(calls).length > 0 && store['SHARD_ASYNC_QUEUE'] === '[]', store['SHARD_ASYNC_QUEUE']);

// --- 3-3) inlineKick 未指定（google.script.run 経路）は積むだけ
c = mkCtx();
const r3 = c.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
check('inlineKick 未指定なら送信しない（待たせない）', calls.length === 0, calls.length);
check('inlineKick 未指定なら保留に1件積む', c.shardReadPending().length === 1, c.shardReadPending().length);
check('未指定でも deferred:true', r3 && r3.deferred === true);

// --- 3-4) SHARD_INLINE_KICK=false なら直送しない（ブラウザ任せ）
c = mkCtx();
c.SHARD_INLINE_KICK = false;
c.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true }, { inlineKick: true });
check('SHARD_INLINE_KICK=false なら送信しない', calls.length === 0, calls.length);
check('SHARD_INLINE_KICK=false でも保留には残る（回収される）', c.shardReadPending().length === 1);

// --- 3-5) 保留が空のときの shard_flush は空振りを返す（診断用）
c = mkCtx();
const r5 = c.shardFlushPending();
check('保留が無ければ通信せず empty を返す',
  calls.length === 0 && r5 && r5.sent === 0 && r5.empty === true, r5);

// --- 3-6) 子GASが失敗したら保留に残る（自己修復の根拠）
c = mkCtx();
c.shardFetchMany = function () { throw new Error('network down'); };
c.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true }, { inlineKick: true });
check('直送が失敗しても保留に残る（次回回収）', c.shardReadPending().length === 1, c.shardReadPending().length);

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
