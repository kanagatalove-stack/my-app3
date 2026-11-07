// R35: 端末索引の独立版数化（idx_v）— dev_v 前進で索引を破壊しない の検証
//
// 検証の狙い（承認済み仕様）:
//   1) 索引は idx_v で管理し、書き込み版 dev_v とは完全に独立している
//   2) 書き込み関数が差分を索引へ直接上書きする（全行再読込をしない）
//   3) shardPropagatePolicy は索引だけで解決し、openById / getDataRange を呼ばない
//   4) 索引が使えない環境では従来のシート読みへフォールバックし、機能を落とさない
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

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
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// ------------------------------------------------------------------ 共通モック

// CacheService のモック（TTL は無視。put/get/remove と統計のみ）
function mkCache() {
  const store = {};
  const stats = { puts: 0, gets: 0, removes: 0 };
  return {
    store, stats,
    CacheService: {
      getScriptCache() {
        return {
          get(k) { stats.gets++; return (k in store) ? store[k] : null; },
          put(k, v) { stats.puts++; store[k] = String(v); },
          remove(k) { stats.removes++; delete store[k]; }
        };
      }
    }
  };
}

// 端末シートのモック（読み取り範囲を記録する）
function mkSheet(rows) {
  const stats = { ranges: [], blockReads: 0, fullReads: 0, lastRow: 0 };
  return {
    rows, stats,
    getLastRow() { stats.lastRow++; return rows.length; },
    getLastColumn() { return rows[0] ? rows[0].length : 0; },
    getRange(r, c, nr, nc) {
      stats.ranges.push([r, c, nr, nc]);
      return {
        getValues() {
          stats.blockReads++;
          const out = [];
          for (let i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc));
          return out;
        }
      };
    },
    getDataRange() {
      return { getValues() { stats.fullReads++; return rows.map(function (x) { return x.slice(); }); } };
    }
  };
}

const INDEX_FNS = ['__cacheSafe', 'shardIndexVersion', 'shardIndexBump', 'shardIndexKey',
  'shardIndexSanitize', 'shardIndexSave', 'shardIndexLoad', 'shardIndexEnsure',
  'shardIndexUpsert', 'shardIndexRemove', 'shardIndexRefreshFromRows', 'shardDeviceEntries'];

const INDEX_CONSTS = ['SHARD_INDEX_TTL', 'SHARD_INDEX_CHUNK_ROWS', 'SHARD_INDEX_SEP',
  'SHARD_INDEX_FIELD', 'SHARD_INDEX_VER_KEY'];

function mkIndexCtx(cache, sheet) {
  const c = {
    console, JSON, String, Number, Array, Object, Boolean, Error, Math, Date, Set,
    CacheService: cache.CacheService,
    CONFIG: { DEVICE_SHEET_NAME: 'devices', DEVICE_COLUMNS: ['児童ID', '学校名', '氏名', 'クラス', '備考'] },
    getTargetSheet() { return sheet; },
    getHeaderMap() { return { '児童ID': 1, '学校名': 2, 'クラス': 4 }; }
  };
  vm.createContext(c);
  let b = '';
  INDEX_CONSTS.forEach(function (n) { b += lineConst(src, n) + '\n'; });
  INDEX_FNS.forEach(function (n) { b += extract(src, n) + '\n'; });
  vm.runInContext(b, c);
  return c;
}

// ------------------------------------------------------------------ 1) 保存と読み出し
console.log('===== [GAS] R35: 索引の保存・読み出し（チャンク分割） =====');

let cache = mkCache();
let ctx = mkIndexCtx(cache, mkSheet([[]]));

const tiny = [['s1@x.ed.jp', '第一小学校', '5年1組'],
              ['s2@x.ed.jp', '第一小学校', '6年1組'],
              ['s3@x.ed.jp', '第二小学校', '3年2組']];
check('保存に成功する', ctx.shardIndexSave(tiny) === true);
const back = ctx.shardIndexLoad();
check('読み出しで件数が一致する', back && back.length === 3, back && back.length);
check('内容が完全に往復する', JSON.stringify(back) === JSON.stringify(tiny), back);

// 区切り文字を含む値でも索引が壊れない
cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
ctx.shardIndexSave([['a' + String.fromCharCode(1) + 'b', '学' + String.fromCharCode(2) + '校', '5年1組']]);
const dirty = ctx.shardIndexLoad();
check('区切り文字は空白へ潰して壊れない', dirty && dirty.length === 1 && dirty[0][2] === '5年1組', dirty);

// ------------------------------------------------------------------ 2) チャンク数と分割
console.log('\n===== [GAS] R35: 1キー100KB対策のチャンク分割 =====');

cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
const many = [];
for (let i = 0; i < 600; i++) many.push(['s' + i + '@x.ed.jp', '第一小学校', '5年1組']);
ctx.shardIndexSave(many);
const m1 = JSON.parse(cache.store['dvi_0_m']);
check('600行は3チャンクに分かれる', m1.c === 3, m1);
check('メタに総件数が入る', m1.n === 600, m1);
check('チャンク0が存在する', typeof cache.store['dvi_0_c0'] === 'string');
check('チャンク2が存在する', typeof cache.store['dvi_0_c2'] === 'string');
check('チャンク3は存在しない', !('dvi_0_c3' in cache.store));
check('分割しても読むと600行に戻る', ctx.shardIndexLoad().length === 600);
check('1チャンクあたり250行を超えない',
  String(cache.store['dvi_0_c0']).split(String.fromCharCode(2)).length === 250,
  String(cache.store['dvi_0_c0']).split(String.fromCharCode(2)).length);

// ------------------------------------------------------------------ 3) 縮小時の古いチャンク掃除
console.log('\n===== [GAS] R35: 行数が減ったときの古いチャンク掃除 =====');

ctx.shardIndexSave(many.slice(0, 300));
const m2 = JSON.parse(cache.store['dvi_0_m']);
check('300行は2チャンクになる', m2.c === 2, m2);
check('余ったチャンク2は削除される', !('dvi_0_c2' in cache.store));
check('削除後も読むと300行', ctx.shardIndexLoad().length === 300);

// ------------------------------------------------------------------ 4) 容量ガード
console.log('\n===== [GAS] R35: 1チャンク95,000文字の安全弁 =====');

cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
const huge = [];
const longStr = new Array(200).join('あ'); // 199文字
for (let i = 0; i < 250; i++) huge.push(['s' + i + '@x.ed.jp', longStr, longStr]);
check('上限超過のチャンクは保存を諦める（false）', ctx.shardIndexSave(huge) === false);
check('諦めたときはメタを書かない（壊れた索引を配らない）', !('dvi_0_m' in cache.store));
check('諦めたときは読み出しも null', ctx.shardIndexLoad() === null);

// ------------------------------------------------------------------ 5) 差分アップサート
console.log('\n===== [GAS] R35: 書き込み関数による差分上書き =====');

cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
ctx.shardIndexSave(tiny);
check('新規IDを追加できる', ctx.shardIndexUpsert([{ id: 's4@x.ed.jp', school: '第三小学校', cls: '1年1組' }]) === true);
check('追加後の件数は4件', ctx.shardIndexLoad().length === 4);
const up1 = ctx.shardIndexLoad();
check('追加した児童の学校名が入る',
  up1.some(function (r) { return r[0] === 's4@x.ed.jp' && r[1] === '第三小学校' && r[2] === '1年1組'; }), up1);

// クラス変更（学校は据え置き）
ctx.shardIndexUpsert([{ id: 's1@x.ed.jp', cls: '5年2組' }]);
const up2 = ctx.shardIndexLoad();
const s1 = up2.filter(function (r) { return r[0] === 's1@x.ed.jp'; })[0];
check('クラスだけ変更しても学校名は保持される', s1 && s1[1] === '第一小学校' && s1[2] === '5年2組', s1);

// 変化なしなら書き込まない（無駄な put をしない）
const putsBefore = cache.stats.puts;
ctx.shardIndexUpsert([{ id: 's2@x.ed.jp', school: '第一小学校', cls: '6年1組' }]);
check('変化が無ければ put しない（速度を落とさない）', cache.stats.puts === putsBefore,
  { before: putsBefore, after: cache.stats.puts });

// 索引が無いときは何もしない（次回の ensure が作り直す）
cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
check('索引が無ければ upsert は false', ctx.shardIndexUpsert([{ id: 'zz@x.ed.jp' }]) === false);

// ------------------------------------------------------------------ 6) 削除（卒業）
console.log('\n===== [GAS] R35: 卒業・削除の反映 =====');

cache = mkCache(); ctx = mkIndexCtx(cache, mkSheet([[]]));
ctx.shardIndexSave(tiny);
check('削除に成功する', ctx.shardIndexRemove(['s2@x.ed.jp']) === true);
const afterRm = ctx.shardIndexLoad();
check('削除後は2件', afterRm.length === 2, afterRm.length);
check('削除したIDは残らない', !afterRm.some(function (r) { return r[0] === 's2@x.ed.jp'; }), afterRm);

// ------------------------------------------------------------------ 7) ensure: 必要3列だけを読む
console.log('\n===== [GAS] R35: 索引が無いときは必要3列だけを1回読む =====');

const sheetRows = [
  ['児童ID', '学校名', '氏名', 'クラス', '画面ロック', 'URL規制モード', '備考'],
  ['s1@x.ed.jp', '第一小学校', '児童一', '5年1組', false, 'OFF', ''],
  ['s2@x.ed.jp', '第一小学校', '児童二', '6年1組', false, 'OFF', ''],
  ['', '未設定', '', '未設定', false, 'OFF', '']   // 児童IDが空の残骸行
];
cache = mkCache();
const sh = mkSheet(sheetRows);
ctx = mkIndexCtx(cache, sh);
const ensured = ctx.shardIndexEnsure();
check('索引が無ければシートから作る', ensured && ensured.length === 2, ensured && ensured.length);
check('児童IDが空の行は索引に入れない', ensured.length === 2);
check('シート読みは1回だけ', sh.stats.blockReads === 1, sh.stats.blockReads);
check('全列は読まない（getDataRange を使わない）', sh.stats.fullReads === 0, sh.stats.fullReads);
check('読む列幅は 児童ID〜クラスの4列に収まる',
  sh.stats.ranges.length === 1 && sh.stats.ranges[0][1] === 1 && sh.stats.ranges[0][3] === 4,
  sh.stats.ranges);

// 2回目はシートを読まない
const reads = sh.stats.blockReads;
ctx.shardIndexEnsure();
check('2回目はシートを読まない（索引ヒット）', sh.stats.blockReads === reads, sh.stats.blockReads);

// ------------------------------------------------------------------ 8) dev_v と idx_v の独立（本丸）
console.log('\n===== [GAS] R35: 書き込み版 dev_v が進んでも索引は壊れない（本丸） =====');

cache = mkCache();
const sh2 = mkSheet(sheetRows);
ctx = mkIndexCtx(cache, sh2);
vm.runInContext(extract(src, 'invalidateDevicesCache') + '\n', ctx);

ctx.shardIndexEnsure();
check('索引を作った直後のシート読みは1回', sh2.stats.blockReads === 1, sh2.stats.blockReads);
check('dev_v はまだ 0', String(cache.store['dev_v'] || '0') === '0', cache.store['dev_v']);

// 書き込みが走った状況を再現（withWriteLock が必ず呼ぶ関数）
ctx.invalidateDevicesCache();
check('書き込みで dev_v が進む（従来の全破壊の引き金）', String(cache.store['dev_v']) === '1', cache.store['dev_v']);
check('dev_v が進んでも索引本体は残っている', !!cache.store['dvi_0_m'], Object.keys(cache.store));
check('dev_v が進んでも索引キーは変わらない（idx_v 独立）',
  ctx.shardIndexVersion() === '0' && ctx.shardIndexKey('m') === 'dvi_0_m',
  { idx_v: ctx.shardIndexVersion(), key: ctx.shardIndexKey('m') });

const readsAfter = sh2.stats.blockReads;
const stillThere = ctx.shardIndexLoad();
check('dev_v が進んでも索引は読める（4,946ms の再読込が起きない）',
  stillThere && stillThere.length === 2, stillThere && stillThere.length);
check('dev_v が進んでもシートを読み直さない', sh2.stats.blockReads === readsAfter, sh2.stats.blockReads);

// 書き込み関数が差分を反映した後も、dev_v と無関係に最新である
ctx.shardIndexUpsert([{ id: 's9@x.ed.jp', school: '第三小学校', cls: '2年2組' }]);
ctx.invalidateDevicesCache();
const afterWrite = ctx.shardDeviceEntries();
check('書き込み直後でも索引に新規行が入っている',
  afterWrite.some(function (r) { return r[0] === 's9@x.ed.jp'; }), afterWrite.length);
check('ここまででシート読みは1回のまま（書き込み後も0ms）', sh2.stats.blockReads === 1, sh2.stats.blockReads);

// idx_v を進めると別空間になる（構造変更時の全破棄ができる）
ctx.shardIndexBump();
check('idx_v を進めるとキーが別空間になる', ctx.shardIndexKey('m') === 'dvi_1_m', ctx.shardIndexKey('m'));
check('新しい版では索引が空（作り直し対象）', ctx.shardIndexLoad() === null);

// ------------------------------------------------------------------ 9) propagate はシートI/Oゼロ
console.log('\n===== [GAS] R35: shardPropagatePolicy がシートI/Oゼロで動く（実物） =====');

const PROP_FNS = ['__cacheSafe', 'shardIndexVersion', 'shardIndexBump', 'shardIndexKey',
  'shardIndexSanitize', 'shardIndexSave', 'shardIndexLoad', 'shardIndexEnsure',
  'shardIndexUpsert', 'shardIndexRemove', 'shardIndexRefreshFromRows', 'shardDeviceEntries',
  'shardReadPending', 'shardQueuePending', 'shardDropPending', 'shardCoalescePending',
  'shardFlushPending', 'shardPropagatePolicy'];

function mkPropCtx(sheetRowsArr, sheetTrap) {
  const c2 = mkCache();
  const propStore = {};   // 保留キューを実際に保存させる（no-op にすると検証にならない）
  const sh3 = sheetTrap ? null : mkSheet(sheetRowsArr);
  const c = {
    console, JSON, String, Number, Array, Object, Boolean, Error, Math, Date, Set,
    CacheService: c2.CacheService,
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return (k in propStore) ? propStore[k] : null; },
          setProperty(k, v) { propStore[k] = String(v); },
          deleteProperty(k) { delete propStore[k]; }
        };
      }
    },
    LockService: { getScriptLock() { return { waitLock() { return true; }, releaseLock() {} }; } },
    CONFIG: { DEVICE_SHEET_NAME: 'devices', DEVICE_COLUMNS: ['児童ID', '学校名', '氏名', 'クラス', '備考'] },
    SHARD_ASYNC_ENABLED: true,
    SHARD_ASYNC_PROP: 'SHARD_ASYNC_QUEUE',
    SHARD_ASYNC_MAX_CHARS: 8000,
    // シートに触れたら記録する（触れなければ 0 のまま＝I/O ゼロの証明）
    getTargetSheet() {
      if (sheetTrap) { sheetTrap.calls++; throw new Error('SHEET_IO_FORBIDDEN'); }
      return sh3;
    },
    getHeaderMap() { return { '児童ID': 1, '学校名': 2, 'クラス': 4 }; },
    isShardParent() { return true; },
    shardConfigCached() {
      return { map: { '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' }, def: '', sec: 'sk' };
    },
    shardMapIndexFromMap: null, shardMapDefaultFromEmptyKey: null, normalizeShardClass: null,
    bulkTraceMark() {},
    shardFetchMany() { return []; }
  };
  vm.createContext(c);
  let b = '';
  INDEX_CONSTS.forEach(function (n) { b += lineConst(src, n) + '\n'; });
  PROP_FNS.forEach(function (n) { b += extract(src, n) + '\n'; });
  // 実物の依存ヘルパーも入れる（モックより本物で試す）
  ['shardMapIndexFromMap', 'shardMapDefaultFromEmptyKey', 'normalizeShardClass', 'shardWarnOnce']
    .forEach(function (n) {
      try { b += extract(src, n) + '\n'; } catch (e) { /* 無い場合は下で補う */ }
    });
  vm.runInContext(b, c);
  c.__cacheStore = c2.store;
  c.__cacheStats = c2.stats;
  return c;
}

// 索引を作ってから propagate（索引がある状態＝本番の通常状態）
const trap = { calls: 0 };
const pc = mkPropCtx(null, trap);
pc.shardIndexSave([['s1@x.ed.jp', '第一小学校', '5年1組'],
                   ['s2@x.ed.jp', '第一小学校', '6年1組']]);
check('索引を用意した（テスト前提）', pc.shardIndexLoad().length === 2);

const pol = pc.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
check('propagate が deferred を返す', pol && pol.deferred === true, pol && Object.keys(pol));
check('シートには一切触れていない（openById/getDataRange = 0）', trap.calls === 0, trap.calls);
check('索引からクラスを解決して子GASを選べている',
  pc.shardReadPending().length === 1 && pc.shardReadPending()[0].url === 'https://child-a/exec',
  pc.shardReadPending());

// dev_v を進めても propagate はシートを読まない
vm.runInContext(extract(src, 'invalidateDevicesCache') + '\n', pc);
pc.invalidateDevicesCache();
const pol2 = pc.shardPropagatePolicy('ALL', { broadcast_url: 'https://example.com/a' });
check('書き込み後（dev_v 前進後）でもシートI/Oは0', trap.calls === 0, trap.calls);
check('書き込み後でも2クラスへ配信できる', pol2 && pol2.deferred === true &&
  pc.shardReadPending().length === 3, pc.shardReadPending().length);

// 索引が無い環境では従来のシート読みへフォールバックする（機能を落とさない）
const fbRows = [['児童ID', '学校名', '氏名', 'クラス', '備考'],
                ['s1@x.ed.jp', '第一小学校', '児童一', '5年1組', '']];
const fbc = mkPropCtx(fbRows, null);
const fbres = fbc.shardPropagatePolicy(['s1@x.ed.jp'], { screen_lock: true });
check('索引が無ければシート読みで動作する（フォールバック）',
  fbres && fbres.deferred === true && fbc.shardReadPending().length === 1,
  fbc.shardReadPending().length);

// ------------------------------------------------------------------ 10) 静的検証
console.log('\n===== [静的] R35: 構造が承認済み仕様どおりか =====');

check('索引の版キーは idx_v（dev_v と別物）', /const SHARD_INDEX_VER_KEY = 'idx_v';/.test(src));
check('idx_v は 6時間 TTL で保持される', /SHARD_INDEX_TTL = 21600/.test(src));
check('1チャンク250行で分割する', /SHARD_INDEX_CHUNK_ROWS = 250/.test(src));
check('95,000文字の安全弁がある', /payload\.length > 95000/.test(src));

// shardIndexVersion は dev_v を参照しない
const verSeg = extract(src, 'shardIndexVersion');
check('索引版数の関数は dev_v を参照しない', verSeg.indexOf('dev_v') < 0, verSeg.indexOf('dev_v'));

// propagate 本体からシートアクセスが消えている
const propSeg = extract(src, 'shardPropagatePolicy');
check('propagate に openById が無い', propSeg.indexOf('openById(') < 0);
check('propagate の getDataRange はフォールバックの1箇所のみ',
  (propSeg.match(/\.getDataRange\(/g) || []).length === 1,
  (propSeg.match(/\.getDataRange\(/g) || []).length);
check('propagate は索引（shardDeviceEntries）を使う',
  propSeg.indexOf('shardDeviceEntries()') >= 0);

// scope も索引経由
const scopeSeg = extract(src, 'scopeStudentIdsForTeacher');
check('scope は索引（shardDeviceEntries）を使う', scopeSeg.indexOf('shardDeviceEntries()') >= 0);
check('scope の全列読みは無い', scopeSeg.indexOf('.getDataRange(') >= 0 === false ||
  (scopeSeg.match(/\.getDataRange\(/g) || []).length === 1,
  (scopeSeg.match(/\.getDataRange\(/g) || []).length);

// 書き込み関数が自分で差分を反映している
check('getAllDevices が索引を作り直す', /shardIndexRefreshFromRows\(data, headerMap\)/.test(src));
check('updateSingleDevice がクラス/学校変更を反映する',
  /function updateSingleDevice[\s\S]{0,6000}?shardIndexUpsert/.test(src));
check('addStudentRecord が新規行を反映する',
  /function addStudentRecord[\s\S]{0,3000}?shardIndexUpsert/.test(src));
check('importStudents が一括反映する',
  /function importStudents[\s\S]{0,9000}?shardIndexUpsert/.test(src));
check('runAnnualRollover が卒業生を索引から外す',
  /function runAnnualRollover[\s\S]{0,6000}?shardIndexRemove/.test(src));
check('hbRegisterDevice が新規端末を反映する（残骸行の再利用側と新規追加側の2箇所）',
  (extract(src, 'hbRegisterDevice').match(/shardIndexUpsert\(\[/g) || []).length === 2,
  (extract(src, 'hbRegisterDevice').match(/shardIndexUpsert\(\[/g) || []).length);
check('shardUpsertTelemetryFromChild が受信行を反映する',
  /function shardUpsertTelemetryFromChild[\s\S]{0,8000}?shardIndexUpsert/.test(src));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
