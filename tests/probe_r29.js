// R29 実測プローブ: 実物の集約関数をそのまま動かし、
// 子GASが返す最新 last_seen が親コンソールの応答に載るかを確かめる。
//
// ※ 時刻は必ず「実行時の実時刻」を基準に組み立てる。
//   実装は is_online を new Date().getTime() と比較するため、固定時刻を前提にすると
//   差が負値になり「偶然オンライン」に見える誤検証になる（過去に実際そうなった）。
const fs = require('fs'), vm = require('vm');
const gasSrc = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

function extract(src, name) {
  const re = new RegExp('^(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  return src.slice(start, end + 1);
}
function lineConst(src, name) {
  const re = new RegExp('^const ' + name + '\\s*=[^;]*;', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}

// 実装（sheetTsToMs）はシートの日時を「日本時間」として解釈する。
// よって検証データも日本時間の表記で作る。
function jstStr(ms) {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

const REAL_NOW = Date.now();
const PARENT_SEEN = jstStr(REAL_NOW - 30 * 60 * 1000); // 30分前（割り当て時点で停止）
const CHILD_SEEN = jstStr(REAL_NOW - 5 * 1000);         // 5秒前（子はリアルタイム更新）

let childResponseText = JSON.stringify({
  success: true,
  data: [{
    student_id: '1607002@city-mimasaka.ed.jp',
    school_name: '美作市立勝田小学校', class_name: '5年1組',
    student_name: 'テスト太郎',
    last_seen: CHILD_SEEN, is_online: true,
    current_url: 'https://classroom.google.com/',
    screen_lock: true, filter_mode: 'OFF',
    whitelist_urls: [], blacklist_urls: [],
    broadcast_url: '', broadcast_id: '',
    notes: '', screen_request_at: '', screenshot_at: '',
    monitor_flag: false, monitor_reason: '', monitor_url: '', monitor_at: ''
  }]
});
let childStatus = 200;

function mkCtx(opts) {
  opts = opts || {};
  const cacheStore = {};
  const c = {
    console, JSON, Date, Math, String, Number, Array, Object, Boolean,
    isNaN, parseInt, parseFloat, Set, Map, RegExp, Error,
    CONFIG: { DEVICE_SHEET_NAME: '端末一覧' },
    Logger: { log(m) { if (opts.log) opts.log.push(String(m)); } },
    isShardParent() { return true; },
    shardConfigCached() {
      if (opts.cfgThrows) throw new Error('cfg boom');
      return { map: { '5年1組': 'https://child-a/exec' }, def: '', sec: 'sk_test' };
    },
    shardUrlsForTeacher() {
      if (opts.urlsThrow) throw new Error('urls boom');
      return ['https://child-a/exec'];
    },
    shardFilterMergedDevices(list) { return list; },
    // 親シート由来のデータ（L列は古いまま＝設計どおり。書き戻しは仕様外）
    getAllDevices() {
      return [{
        student_id: '1607002@city-mimasaka.ed.jp',
        school_name: '美作市立勝田小学校', class_name: '5年1組',
        student_name: 'テスト太郎',
        last_seen: PARENT_SEEN, is_online: false,
        current_url: 'https://old.example/',
        screen_lock: true, filter_mode: 'OFF',
        whitelist_urls: [], blacklist_urls: [],
        broadcast_url: '', broadcast_id: '',
        notes: '', screen_request_at: '', screenshot_at: '',
        monitor_flag: false, monitor_reason: '', monitor_url: '', monitor_at: ''
      }];
    },
    CacheService: {
      getScriptCache() {
        return {
          get(k) { return (k in cacheStore) ? cacheStore[k] : null; },
          put(k, v) { cacheStore[k] = String(v); },
          remove(k) { delete cacheStore[k]; }
        };
      }
    },
    UrlFetchApp: {
      fetch(url, o) {
        return { getResponseCode() { return childStatus; }, getContentText() { return childResponseText; } };
      },
      fetchAll(reqs) {
        if (opts.fetchThrows) throw new Error('fetch boom');
        return (reqs || []).map(() => ({
          getResponseCode() { return childStatus; },
          getContentText() { return childResponseText; }
        }));
      }
    }
  };
  vm.createContext(c);
  let b = '';
  b += lineConst(gasSrc, 'SHARD_LIST_CACHE_TTL') + '\n';
  b += lineConst(gasSrc, 'SHARD_LIST_CACHE_PREFIX') + '\n';
  b += lineConst(gasSrc, 'SHEET_TZ_OFFSET_MS') + '\n';
  ['sheetTsToMs', 'shardHash', 'shardDevVersion', 'shardFetchMany',
   'shardFetchChildDevices', 'shardMergeDeviceRow', 'shardMergeDevices',
   'getShardMergedDevices'].forEach(n => { b += extract(gasSrc, n) + '\n'; });
  vm.runInContext(b, c);
  return c;
}

let pass = 0, fail = 0;
function check(n, cond, extra) {
  if (cond) { console.log('PASS  ' + n + (extra !== undefined ? '  => ' + JSON.stringify(extra) : '')); pass++; }
  else { console.log('FAIL  ' + n + (extra !== undefined ? '  => ' + JSON.stringify(extra) : '')); fail++; }
}

console.log('===== R29 実測: 親の読み取り時集約が子の最新 last_seen を載せるか =====');
console.log('  親シート L列(30分前) =', PARENT_SEEN);
console.log('  子シート L列(5秒前)  =', CHILD_SEEN);

// 1) 正常系（子が 200 で最新を返す）＝ 実機の状態
{
  const c = mkCtx();
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  console.log('  merged last_seen =', row && row.last_seen, ' is_online =', row && row.is_online,
    ' source =', row && row.last_seen_source);
  check('子の最新 last_seen が応答に載る', !!row && row.last_seen === CHILD_SEEN, row && row.last_seen);
  check('親の古い last_seen で上書きされない', !!row && row.last_seen !== PARENT_SEEN, row && row.last_seen);
  check('その結果 is_online が true になる（オフライン誤判定の解消）', !!row && row.is_online === true, row && row.is_online);
  check('判定根拠が child と分かる（実機で追跡できる）', !!row && row.last_seen_source === 'child', row && row.last_seen_source);
}

// 2) タイムゾーン非依存であること（R29 の実バグ）
{
  const c = mkCtx();
  const ms = c.sheetTsToMs(CHILD_SEEN);
  const expected = Date.UTC(
    Number(CHILD_SEEN.slice(0, 4)), Number(CHILD_SEEN.slice(5, 7)) - 1, Number(CHILD_SEEN.slice(8, 10)),
    Number(CHILD_SEEN.slice(11, 13)), Number(CHILD_SEEN.slice(14, 16)), Number(CHILD_SEEN.slice(17, 19))
  ) - 9 * 60 * 60 * 1000;
  check('sheetTsToMs は実行TZに依存せず日本時間として解釈する', ms === expected, { ms, expected });
  check('Date オブジェクトも受け付ける', c.sheetTsToMs(new Date(ms)) === ms);
  check('空値は 0', c.sheetTsToMs('') === 0 && c.sheetTsToMs(null) === 0 && c.sheetTsToMs(undefined) === 0);
  check('壊れた文字列でも落ちない', typeof c.sheetTsToMs('not-a-date') === 'number');
}

// 3) 子が非200（認証・URL誤り等）を返したとき
{
  childStatus = 401;
  const c = mkCtx();
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  console.log('  (子=401) is_online =', row && row.is_online);
  check('子が失敗すると親の古い値でオフライン表示になる（＝症状の再現）',
    !!row && row.is_online === false, row && row.is_online);
  childStatus = 200;
}

// 4) 子の取得が例外を投げたとき（fetchAll 例外→直列フォールバックで取得を諦めない）
{
  const c = mkCtx({ fetchThrows: true });
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  console.log('  (fetchAll例外) last_seen =', row && row.last_seen, ' is_online =', row && row.is_online);
  check('fetchAll が例外でも直列フォールバックで取得を諦めない（実装どおり）',
    !!row && row.is_online === true, row && row.is_online);
}

// 5) 設定取得が例外を投げたとき
{
  const c = mkCtx({ cfgThrows: true });
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  check('設定例外時も古い値で黙って返る（原因が画面から分からない）',
    !!row && row.is_online === false, row && row.is_online);
}

// 6) 子の応答が HTML（ログイン要求のリダイレクト等）のとき
{
  childResponseText = '<!DOCTYPE html><html><body>Sign in</body></html>';
  const c = mkCtx();
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  console.log('  (HTML応答) is_online =', row && row.is_online);
  check('子が HTML を返すと JSON 解析に失敗し、古い値のまま黙って返る',
    !!row && row.is_online === false, row && row.is_online);
  childResponseText = JSON.stringify({ success: true, data: [] });
}

// 7) 子が data:[] を返したとき（子側スコープで0件）
{
  const c = mkCtx();
  const res = c.getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
  const row = res[0];
  check('子が0件を返すと親の古い値のまま（名簿スコープ不整合でも同じ症状）',
    !!row && row.is_online === false, row && row.is_online);
}

console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
