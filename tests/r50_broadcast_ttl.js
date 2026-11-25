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
// ============================================================================
// r50: 再起動・再連携時に「古い一斉表示URL」が勝手に開く不具合の回帰テスト
//
//  実機症状
//    対象端末がログアウト／シャットダウンでオフラインになった後、再度ログイン・
//    連携した「初回同期」だけ、以前実行した一斉表示URLのサイトが新しいタブで
//    1つ自動的に開いてしまう（2回目以降の同期では発生しない）。
//
//  原因
//    [1] シートの I列(一斉表示URL) / J列(一斉表示実行ID `bc_<ms>_<rand>`) に
//        過去の指示値が残ったままになっている。
//    [2] 端末(v1.6.5)の実行済みID記憶(storage.last_broadcast_id)は
//        ログアウト／シャットダウンで揮発する。再連携の初回ハートビート応答で
//        古い `bc_<ms>_<rand>` を受け取ると「新規の一斉表示指示」と判定される。
//
//  確定仕様（今回のルール）
//    ・GAS側のみ（extension/ は v1.6.5 のまま無変更）
//    ・buildHeartbeatResponse() 内の「メモリ上のタイムスタンプ比較」だけでマスク
//    ・シートへの書き込みは一切しない（書き込み負荷ゼロ）
//    ・TTL = Math.max(120000, sync_interval_sec * 1000 * 3)（最低2分）
//    ・`bc_<ms>_<rand>` から時刻が取れない不正・旧形式IDも安全側で期限切れ扱い
//    ・`broadcast_id` 自体が空のときは、そのまま空
//
//  検証対象
//    A. 実行IDから発行時刻を取り出す（形式・旧形式・空白・短すぎる数値）
//    B. TTL の計算（最低120秒／ポーリング間隔の3倍／不正値のフォールバック）
//    C. マスク判定（期限切れ・境界・不正ID・未来方向・空ID）
//    D. buildHeartbeatResponse への組み込み（実機シナリオ・スケジュール発動分）
//    E. 実装の不変条件（応答組み立て1か所・シート書き込みゼロ）
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

// --- 関数を波括弧の対応を数えて切り出す ---
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
// --- `var NAME = ...;` の1行定義を切り出す（BROADCAST_TTL_MIN_MS 用） ---
function lineVar(name) {
  const m = src.match(new RegExp('^var ' + name + '\\s*=[^;]*;', 'm'));
  if (!m) throw new Error('not found var: ' + name);
  return m[0];
}

// 端末一覧の13列（本番 CONFIG.DEVICE_COLUMNS と同じ並び）
const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック',
  'URL規制モード', '許可URLリスト', '規制URLリスト',
  '一斉表示URL', '一斉表示実行ID', '現在開いているURL', '最終同期日時', '備考'];
const HM = {};
DEVICE_COLUMNS.forEach((c, i) => { HM[c] = i + 1; });

// 「いま」は固定。テストは実時間に依存させない（フレーク防止）。
const NOW = 1762500000000;

let logLines = [];
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean,
  isNaN, isFinite, parseInt, parseFloat, Set, Map, RegExp, Error,
  Logger: { log(msg) { logLines.push(String(msg)); } },
  // server_time_ms の基準を固定するため、シート日時解釈はスタブ化する。
  sheetTsToMs() { return NOW; },
  // 予約配信はこのテストの対象外。既定の空ペイロードを返す。
  resolveSchedulePayloadForDevice_() {
    return { active: [], upcoming: [], overridden_ids: [] };
  }
};
vm.createContext(ctx);

let code = '';
['maskStaleBroadcast_', 'parseBroadcastIssuedMs_', 'broadcastTtlMs_',
 // 【r51】buildHeartbeatResponse は制御状態キャッシュと負荷バックオフも通す。
 //   このスイートは CacheService を持たないが、各ヘルパーは try/typeof で
 //   安全側（＝シート値・従来周期）に落ちるため、TTL 検証には影響しない。
 'hbStateCacheKey_', 'hbReadStateCache_',
 'hbReadLoad_', 'hbIsBackoffActive_', 'hbThrottleIntervalSec_',
 'buildHeartbeatResponse', 'parseBoolean', 'parseUrlList'].forEach(n => {
  code += extract(n) + '\n';
});
code += lineVar('BROADCAST_TTL_MIN_MS') + '\n';
vm.runInContext(code, ctx);

const maskStale = ctx.maskStaleBroadcast_;
const parseIssued = ctx.parseBroadcastIssuedMs_;
const ttlOf = ctx.broadcastTtlMs_;
const buildHb = ctx.buildHeartbeatResponse;

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

const URL_OK = 'https://www.mext.go.jp/';

// `bc_<issuedMs>_<rand>` を作る。offsetMs だけ過去の発行時刻にする。
function bcId(offsetMs) {
  return 'bc_' + (NOW - offsetMs) + '_k3n8q';
}

// 端末一覧の1行を組み立てる（既定は一斉表示なし）
function rowOf(o) {
  o = o || {};
  const r = new Array(DEVICE_COLUMNS.length).fill('');
  r[0] = 'n1@x.ed.jp';
  r[1] = '第一小学校';
  r[2] = '児童 一';
  r[3] = '5年1組';
  r[4] = false;          // 画面ロック
  r[5] = 'OFF';          // URL規制モード
  r[8] = o.bcUrl === undefined ? '' : o.bcUrl;   // I列
  r[9] = o.bcId === undefined ? '' : o.bcId;     // J列
  return r;
}

// ハートビート応答を組み立てる（kaInfo.sync_interval_sec は既定 1.5 秒）
function hb(o) {
  const iv = o && o.iv !== undefined ? o.iv : 1.5;
  return buildHb(rowOf(o), HM, 'n1@x.ed.jp', false,
    { sync_interval_sec: iv, idle_drift_until: 0 }, '2026/11/18 09:00:00');
}

// ============================================================================
// A. 実行IDから発行時刻を取り出す
// ============================================================================
check('A1 標準形式 bc_<ms>_<rand> から発行時刻を取り出せる',
  parseIssued('bc_1762500000000_k3n8q') === 1762500000000,
  parseIssued('bc_1762500000000_k3n8q'));

check('A2 rand なし（bc_<ms>）でも取り出せる',
  parseIssued('bc_1762500000000') === 1762500000000);

check('A3 前後の空白は無視される',
  parseIssued('  bc_1762500000000_k3n8q  ') === 1762500000000);

check('A4 空文字は 0（＝指示なし）', parseIssued('') === 0, parseIssued(''));
check('A5 null/undefined は 0', parseIssued(null) === 0 && parseIssued(undefined) === 0);
check('A6 接頭辞だけ（bc_）は 0', parseIssued('bc_') === 0, parseIssued('bc_'));
check('A7 数値でない（bc_xyz_abc）は 0', parseIssued('bc_xyz_abc') === 0);
check('A8 桁が短すぎる（bc_12_abc）は 0', parseIssued('bc_12_abc') === 0);
check('A9 接頭辞なしの素の数値は 0（旧形式として扱う）',
  parseIssued('1762500000000') === 0);
check('A10 大文字接頭辞 BC_ は 0（本番生成は小文字のみ）',
  parseIssued('BC_1762500000000_k3n8q') === 0);

// ============================================================================
// B. TTL の計算
// ============================================================================
check('B1 未指定は最低2分（120000ms）', ttlOf(undefined) === 120000, ttlOf(undefined));
check('B2 0 は最低2分', ttlOf(0) === 120000, ttlOf(0));
check('B3 既定ポーリング 1.5 秒は最低2分（4500ms < 120000ms）',
  ttlOf(1.5) === 120000, ttlOf(1.5));
check('B4 40 秒ちょうどは最低2分と同値（120000ms）',
  ttlOf(40) === 120000, ttlOf(40));
check('B5 41 秒は「間隔×3」が上回るので 123000ms',
  ttlOf(41) === 123000, ttlOf(41));
check('B6 60 秒は 180000ms（= 間隔×3）', ttlOf(60) === 180000, ttlOf(60));
check('B7 300 秒は 900000ms（= 間隔×3）', ttlOf(300) === 900000, ttlOf(300));
check('B8 数値文字列 "60" も 180000ms', ttlOf('60') === 180000, ttlOf('60'));
check('B9 負値は最低2分へフォールバック', ttlOf(-5) === 120000, ttlOf(-5));
check('B10 数値でない値は最低2分へフォールバック', ttlOf('abc') === 120000, ttlOf('abc'));
check('B11 定数 BROADCAST_TTL_MIN_MS は 120000',
  ctx.BROADCAST_TTL_MIN_MS === 120000, ctx.BROADCAST_TTL_MIN_MS);

// ============================================================================
// C. マスク判定
// ============================================================================
// C1 指示そのものが無い
{
  const r = maskStale('', '', NOW, 1.5);
  check('C1 一斉表示URLもIDも空なら空を返す',
    r.broadcast_url === '' && r.broadcast_id === '', r);
}
// C2 期限切れ（実機症状の再現）
{
  const r = maskStale(URL_OK, bcId(120001), NOW, 1.5);
  check('C2 期限切れ(2分+1ms)はURL/IDとも空にマスクされる（実機症状）',
    r.broadcast_url === '' && r.broadcast_id === '', r);
}
// C3 期限内
{
  const id = bcId(60000);
  const r = maskStale(URL_OK, id, NOW, 1.5);
  check('C3 期限内(1分前)はURL/IDともそのまま返る',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r);
}
// C4 境界（ちょうどTTL）
{
  const id = bcId(120000);
  const r = maskStale(URL_OK, id, NOW, 1.5);
  check('C4 ちょうどTTL(120000ms)は「超えていない」ので返る（境界は有効側）',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r);
}
// C5 不正・旧形式
{
  const r = maskStale(URL_OK, 'bc_old_format', NOW, 1.5);
  check('C5 時刻を取り出せない不正IDは安全側でマスクされる',
    r.broadcast_url === '' && r.broadcast_id === '', r);
}
// C6 旧形式（数値のみ）
{
  const r = maskStale(URL_OK, String(NOW - 1000), NOW, 1.5);
  check('C6 素の数値ID（旧形式）は時刻不明としてマスクされる',
    r.broadcast_url === '' && r.broadcast_id === '', r);
}
// C7 未来方向（端末時計ずれ等の保険）
{
  const id = 'bc_' + (NOW + 5000) + '_k3n8q';
  const r = maskStale(URL_OK, id, NOW, 1.5);
  check('C7 発行時刻が未来でも「期限切れ」にはしない',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r);
}
// C8 now が不正
{
  const r = maskStale(URL_OK, bcId(1000), 0, 1.5);
  check('C8 now が不正(0)なら比較不能としてマスクする',
    r.broadcast_url === '' && r.broadcast_id === '', r);
}
// C9 トリム
{
  const id = bcId(1000);
  const r = maskStale('  ' + URL_OK + '  ', '  ' + id + '  ', NOW, 1.5);
  check('C9 URL/IDの前後空白はトリムして返る',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r);
}
// C10 長いポーリング間隔なら古めでも届く
{
  const id = bcId(4 * 60 * 1000); // 4分前
  const r = maskStale(URL_OK, id, NOW, 300); // TTL = 900000ms
  check('C10 ポーリング300秒なら4分前でも返る（TTL=15分）',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r);
}
// C11 返り値の型
{
  const r = maskStale(null, null, NOW, 1.5);
  check('C11 返り値は必ず2つの文字列プロパティを持つ',
    typeof r.broadcast_url === 'string' && typeof r.broadcast_id === 'string', r);
}

// ============================================================================
// D. buildHeartbeatResponse への組み込み（実機シナリオ）
// ============================================================================
// D1 期限切れ → 端末は「新規指示なし」と受け取る（タブが開かない）
{
  const r = hb({ bcUrl: URL_OK, bcId: bcId(10 * 60 * 1000) }); // 10分前
  check('D1 10分前の一斉表示はハートビート応答で空になる（誤爆しない）',
    r.broadcast_url === '' && r.broadcast_id === '', {
      url: r.broadcast_url, id: r.broadcast_id
    });
}
// D2 期限内 → 従来どおり届く
{
  const id = bcId(2000);
  const r = hb({ bcUrl: URL_OK, bcId: id });
  check('D2 2秒前の一斉表示は従来どおり届く',
    r.broadcast_url === URL_OK && r.broadcast_id === id, {
      url: r.broadcast_url, id: r.broadcast_id
    });
}
// D3 発行直後（0ms 差）も届く
{
  const id = bcId(0);
  const r = hb({ bcUrl: URL_OK, bcId: id });
  check('D3 押した直後(0ms)の一斉表示は必ず届く',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r.broadcast_id);
}
// D4 スケジュール発動分（発動時に新しいIDが採番される）は3分以内なので届く
{
  const schedId = bcId(30 * 1000); // 発動から30秒
  const r = hb({ bcUrl: URL_OK, bcId: schedId });
  check('D4 スケジュール発動分（30秒前）は届く＝予約配信を壊さない',
    r.broadcast_url === URL_OK && r.broadcast_id === schedId, r.broadcast_id);
}
// D5 一斉表示が無い端末は空のまま
{
  const r = hb({ bcUrl: '', bcId: '' });
  check('D5 一斉表示が無い端末は空のまま', r.broadcast_url === '' && r.broadcast_id === '');
}
// D6 URLだけ残ってIDが空（過去の手作業編集など）
{
  const r = hb({ bcUrl: URL_OK, bcId: '' });
  check('D6 IDが空なら URL だけ残っていても返さない（誤爆防止）',
    r.broadcast_url === '' && r.broadcast_id === '', r.broadcast_url);
}
// D7 長いポーリング現場では古めでも届く（現場差を吸収）
{
  const id = bcId(4 * 60 * 1000);
  const r = hb({ bcUrl: URL_OK, bcId: id, iv: 300 });
  check('D7 ポーリング300秒の現場では4分前でも届く',
    r.broadcast_url === URL_OK && r.broadcast_id === id, r.broadcast_id);
}
// D8 一斉表示以外の項目はマスクの影響を受けない
{
  const r = hb({ bcUrl: URL_OK, bcId: bcId(10 * 60 * 1000) });
  check('D8 期限切れでも他の項目（学校名/クラス/規制）は正常に返る',
    r.school_name === '第一小学校' && r.class_name === '5年1組' &&
    r.filter_mode === 'OFF' && typeof r.server_time_ms === 'number',
    { school: r.school_name, cls: r.class_name, mode: r.filter_mode });
}
// D9 画面ロック等のブール値も壊れない
{
  const r = hb({ bcUrl: URL_OK, bcId: bcId(9999999) });
  check('D9 期限切れでも screen_lock / ka_active は正常',
    r.screen_lock === false && r.ka_active === false);
}

// ============================================================================
// E. 実装の不変条件
// ============================================================================
const maskBody = extract('maskStaleBroadcast_');
const hbBody = extract('buildHeartbeatResponse');

check('E1 buildHeartbeatResponse が maskStaleBroadcast_ を通している',
  /maskStaleBroadcast_\s*\(/.test(hbBody));
check('E2 応答の broadcast_url はマスク結果から入る（生の行値ではない）',
  /broadcast_url:\s*bcMasked\.broadcast_url/.test(hbBody));
check('E3 応答の broadcast_id はマスク結果から入る（生の行値ではない）',
  /broadcast_id:\s*bcMasked\.broadcast_id/.test(hbBody));
check('E4 maskStaleBroadcast_ はシート書き込みAPIを一切呼ばない（setValue/setValues）',
  !/\.setValue\s*\(/.test(maskBody) && !/\.setValues\s*\(/.test(maskBody));
check('E5 maskStaleBroadcast_ はシート読み取りAPIも呼ばない（getRange/getDataRange）',
  !/\.getRange\s*\(/.test(maskBody) && !/\.getDataRange\s*\(/.test(maskBody));
check('E6 buildHeartbeatResponse の一斉表示ブロックも書き込みを行わない',
  !/broadcast_(url|id)\s*[\s\S]{0,80}\.setValue/.test(hbBody));
check('E7 TTL は最低値と「間隔×3」の大きい方を採る（Math.max 相当）',
  /byInterval\s*>\s*base\s*\?\s*byInterval\s*:\s*base/.test(extract('broadcastTtlMs_')));
check('E8 「間隔×3」は sync_interval_sec * 1000 * 3 で計算している',
  /\*\s*1000\s*\*\s*3/.test(extract('broadcastTtlMs_')));
check('E9 実行IDの形式は bc_ + 10〜16桁の数値 で読み取る',
  /\^bc_\(\\d\{10,16\}\)/.test(extract('parseBroadcastIssuedMs_')));
check('E10 マスクは応答組み立ての1か所（buildHeartbeatResponse）で行う',
  /maskStaleBroadcast_/.test(hbBody) &&
  (src.match(/maskStaleBroadcast_\s*\(/g) || []).length === 2); // 定義1 + 呼び出し1
check('E11 extension/ は変更していない（v1.6.10 のまま）',
  (function () {
    const mf = JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8'));
    return mf.version === '1.6.10';
  })(), JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8')).version);
check('E12 端末の実行済みID記憶キー(last_broadcast_id)は拡張機能側のまま存在する',
  /last_broadcast_id/.test(fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8')));

// ---------- 結果 ----------
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
