// R42: 画面情報のマルチスプレッドシート化（親＋子GASへ並列で要求・取得）の検証
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');

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
// 1) GAS: 子GAS側の受け口
// ==================================================================
console.log('===== [GAS] R42: 子GAS側の画面情報 受け口 =====');

check("doPost に shard_request_screens の分岐がある",
  src.indexOf("action === 'shard_request_screens'") >= 0);
check("doPost に shard_get_screens の分岐がある",
  src.indexOf("action === 'shard_get_screens'") >= 0);
check('shard_request_screens は共有シークレット経路（認証ゲートより前）',
  src.indexOf("action === 'shard_request_screens'") <
  src.indexOf('これ以降の教員操作アクションは認証トークン必須'));
check('shard_get_screens は共有シークレット経路（認証ゲートより前）',
  src.indexOf("action === 'shard_get_screens'") <
  src.indexOf('これ以降の教員操作アクションは認証トークン必須'));

['shardAllStudentIdsForChild', 'shardRequestScreensFromBrowser', 'shardScreensFromBrowser']
  .forEach(n => {
    check(n + ' が1つだけ定義されている',
      (src.match(new RegExp('^function ' + n + '\\s*\\(', 'gm')) || []).length === 1);
  });

const fnReq = extract(src, 'shardRequestScreensFromBrowser');
check('要求側も shard_secret を検証する', /shardSecretMatches\(payload && payload\.shard_secret\)/.test(fnReq));
check('要求側は requestScreenCapture を呼ぶ', fnReq.indexOf('requestScreenCapture(') >= 0);
check('要求側は行の用意（shardEnsureDeviceRows）をする',
  fnReq.indexOf('shardEnsureDeviceRows(') >= 0);
check('要求側は配列以外（ALL等）を全児童へ展開する',
  /if \(!Array\.isArray\(ids\)\) ids = shardAllStudentIdsForChild\(\)/.test(fnReq));

const fnGet = extract(src, 'shardScreensFromBrowser');
check('取得側も shard_secret を検証する', /shardSecretMatches\(payload && payload\.shard_secret\)/.test(fnGet));
check('取得側は getScreenshots を使う（画像組み立てを再利用）',
  fnGet.indexOf('getScreenshots(') >= 0);
check('取得側は data 配列を返す', /data: data/.test(fnGet));

// ==================================================================
// 2) GAS: 実行時（本物の関数を vm で動かす）
// ==================================================================
console.log('\n===== [GAS] R42: 実行時の疎通 =====');

function mkCtx(opts) {
  const o = opts || {};
  const written = [];
  const deviceRows = (o.deviceRows || []).slice();
  const shotRows = (o.shotRows || []).slice();
  const ctx = {
    console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, Set, Map, RegExp, Error, Promise,
    Utilities: { formatDate() { return '2026/11/05 20:18:00'; } },
    LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
    Logger: { log() {} },
    CacheService: { getScriptCache() { return { get() { return null; }, put() {} }; } },
    isShardChild: () => o.child !== false,
    isShardParent: () => false,
    shardSecretMatches: g => String(g || '') === 'SEC',
    shardDeviceEntries: () => (o.entries || []),
    shardEnsureDeviceRows: () => 0,
    requestScreenCapture: (ids) => {
      written.push(ids.slice());
      return { requested: ids.length, ids: ids.slice(), request_id: 'sr_x', at: '2026/11/05 20:18:00' };
    },
    getScreenshots: (sch, t, inc, st, ids) => (o.shots || []).filter(x => !ids || ids.indexOf(x.student_id) >= 0)
  };
  ctx.__written = written;
  ctx.__deviceRows = deviceRows;
  ctx.__shotRows = shotRows;
  vm.createContext(ctx);
  ['shardAllStudentIdsForChild', 'shardRequestScreensFromBrowser', 'shardScreensFromBrowser']
    .forEach(n => vm.runInContext(extract(src, n), ctx));
  return ctx;
}

// --- 2-1) 要求: ID 指定
let c = mkCtx({});
const r1 = c.shardRequestScreensFromBrowser({ shard_secret: 'SEC', student_ids: ['a@x', 'b@x'] });
check('要求: 指定IDで requestScreenCapture が呼ばれる', c.__written.length === 1, c.__written);
check('要求: 対象IDがそのまま渡る', JSON.stringify(c.__written[0]) === JSON.stringify(['a@x', 'b@x']), c.__written[0]);
check('要求: requested を返す', r1.success === true && r1.requested === 2, r1);

// --- 2-2) 要求: シークレット不一致は拒否
c = mkCtx({});
const r2 = c.shardRequestScreensFromBrowser({ shard_secret: 'NG', student_ids: ['a@x'] });
check('要求: シークレット不一致は unauthorized', r2.success === false && r2.requested === 0, r2);
check('要求: 未認証では書き込まない', c.__written.length === 0);

// --- 2-3) 要求: 配列でなければ子の全児童へ展開
c = mkCtx({ entries: [['a@x', '英田小', '5年1組'], ['b@x', '英田小', '5年2組']] });
const r3 = c.shardRequestScreensFromBrowser({ shard_secret: 'SEC', student_ids: 'ALL' });
check('要求: ALL は子の全児童へ展開される',
  r3.success === true && JSON.stringify(c.__written[0]) === JSON.stringify(['a@x', 'b@x']), c.__written[0]);

// --- 2-4) 要求: 児童ゼロなら安全に返す
c = mkCtx({ entries: [] });
const r4 = c.shardRequestScreensFromBrowser({ shard_secret: 'SEC', student_ids: 'ALL' });
check('要求: 対象0件でも success で返す（例外にしない）',
  r4.success === true && r4.requested === 0, r4);

// --- 2-5) 取得: 子の画像を返す
c = mkCtx({ shots: [
  { student_id: 'a@x', has_image: true, image_data_url: 'data:image/png;base64,AAA', screenshot_at: '2026/11/05 20:18:00' }
] });
const g1 = c.shardScreensFromBrowser({ shard_secret: 'SEC', student_ids: ['a@x'] });
check('取得: 子の画像を data 配列で返す',
  g1.success === true && g1.data.length === 1 && g1.data[0].has_image === true, g1);
check('取得: image_data_url がそのまま入る',
  g1.data[0].image_data_url === 'data:image/png;base64,AAA', g1.data[0].image_data_url);

// --- 2-6) 取得: シークレット不一致
c = mkCtx({ shots: [{ student_id: 'a@x', has_image: true }] });
const g2 = c.shardScreensFromBrowser({ shard_secret: 'NG', student_ids: ['a@x'] });
check('取得: シークレット不一致は unauthorized で data 空',
  g2.success === false && Array.isArray(g2.data) && g2.data.length === 0, g2);

// --- 2-7) 親でも子でもないスクリプトは拒否
c = mkCtx({ child: false });
const g3 = c.shardScreensFromBrowser({ shard_secret: 'SEC', student_ids: ['a@x'] });
check('取得: 役割未設定のスクリプトは拒否', g3.success === false, g3);

// ==================================================================
// 3) フロントエンド: 並列直送
// ==================================================================
console.log('\n===== [FE] R42: 親＋子GASへの並列 要求/取得 =====');

['slog', 'shardScreenTargets', 'fireShardRequestScreensParallel',
 'fetchShardScreensParallel', 'mergeScreenRows'].forEach(n => {
  check(n + ' が1つだけ定義されている',
    (html.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length === 1);
});

const fnFire = extract(html, 'fireShardRequestScreensParallel');
check("要求の直送は action:'shard_request_screens'",
  /action:\s*'shard_request_screens'/.test(fnFire));
check('要求の直送は shard_secret を送る', /shard_secret:\s*cfg\.secret/.test(fnFire));
check('要求の直送は Promise.all で並列', fnFire.indexOf('Promise.all(') >= 0);
check('要求の直送は text/plain（プリフライト回避）',
  /'Content-Type':\s*'text\/plain;charset=utf-8'/.test(fnFire));
check('要求の直送は失敗しても throw しない',
  fnFire.indexOf('.catch(function () { return null; })') >= 0);

const fnFetchS = extract(html, 'fetchShardScreensParallel');
check("取得の直送は action:'shard_get_screens'",
  /action:\s*'shard_get_screens'/.test(fnFetchS));
check('取得の直送は Promise.all で並列', fnFetchS.indexOf('Promise.all(') >= 0);

// 平坦化は「実装の見た目」ではなく「振る舞い」で検証する。
//   子GASが2校ぶん返したとき、1本の配列に連結されること。
const fCtx = {
  Object, Array, String, Number, JSON, Promise,
  shardClientCfg: { enabled: true, secret: 's3cr3t' },
  shardScreenTargets: function () {
    return {
      'https://child1/exec': { ids: ['a@x'], classMap: null },
      'https://child2/exec': { ids: ['b@x'], classMap: null }
    };
  },
  slog: function () {},
  fetch: function (u) {
    const id = u.indexOf('child1') >= 0 ? 'a@x' : 'b@x';
    return Promise.resolve({
      status: 200,
      json: function () {
        return Promise.resolve({ success: true, data: [{ student_id: id, has_image: true, image_data_url: 'IMG-' + id }] });
      }
    });
  }
};
vm.createContext(fCtx);
vm.runInContext(fnFetchS, fCtx);
let flat = null;
try { flat = fCtx.fetchShardScreensParallel(['a@x', 'b@x']); } catch (e) { flat = null; }
check('取得の直送は Promise を返す', !!flat && typeof flat.then === 'function');
new Promise(function (resolve) {
  Promise.resolve(flat).then(function (rows) {
    const arr = Array.isArray(rows) ? rows : [];
    check('取得の直送は複数子GASの結果を1本に平坦化する', arr.length === 2, arr.length);
    check('平坦化しても各要素は失われない',
      arr.map(function (r) { return r && r.student_id; }).sort().join(',') === 'a@x,b@x',
      arr.map(function (r) { return r && r.student_id; }));
  }).catch(function () {
    check('取得の直送は複数子GASの結果を1本に平坦化する', false, 'rejected');
    check('平坦化しても各要素は失われない', false, 'rejected');
  }).then(resolve);
}).then(function () {
  runMergeTests();
});

// 結線: 要求ボタンは親送信と同じ tick で子へも投げる
const fnOnClick = extract(html, 'requestScreenInfo');
const iFire = fnOnClick.indexOf('fireShardRequestScreensParallel(');
const iApi = fnOnClick.indexOf("await apiRequest({ action: 'request_screens'");
check('要求ボタンが子GASへも直送する', iFire >= 0);
check('直送は親への送信より先（同一 tick）', iFire >= 0 && iApi > iFire, [iFire, iApi]);
check('直送の戻り値は await しない', !/await fireShardRequestScreensParallel/.test(fnOnClick));

// 結線: 一覧取得は親＋子を突き合わせる
const fnLoad = extract(html, 'loadScreens');
check('一覧取得が子GASへも問い合わせる', fnLoad.indexOf('fetchShardScreensParallel(') >= 0);
check('一覧取得が併合する', fnLoad.indexOf('mergeScreenRows(') >= 0);
check("request_screens → loadScreens の順序が維持されている（fe15 の制約）",
  new RegExp("await apiRequest\\(\\{ action: 'request_screens'[\\s\\S]*?await loadScreens\\(").test(html));

// ==================================================================
// 4) 併合ロジック（子の新しい画像だけを採る）
//    平坦化の検証が非同期なので、この節は関数に包んで後段で呼ぶ。
// ==================================================================
function runMergeTests() {
console.log('\n===== [FE] R42: mergeScreenRows（親優先・新しい画像のみ採用） =====');

const mCtx = { Object, Array, String, Number, console };
vm.createContext(mCtx);
vm.runInContext(extract(html, 'mergeScreenRows'), mCtx);
const merge = mCtx.mergeScreenRows;

// 親: a@x は古い画像、b@x は画像なし
const parent = [
  { student_id: 'a@x', student_name: '親の名前', has_image: true, image_data_url: 'OLD', screenshot_at: '2026/10/28 10:00:00', screen_request_at: '' },
  { student_id: 'b@x', student_name: 'Bさん', has_image: false, image_data_url: '', screenshot_at: '', screen_request_at: '2026/11/05 19:00:00' }
];
// 子: a@x は新しい画像、b@x は画像あり、c@x は親に無い
const child = [
  { student_id: 'a@x', student_name: '子の名前', has_image: true, image_data_url: 'NEW', screenshot_at: '2026/11/05 20:18:00' },
  { student_id: 'b@x', has_image: true, image_data_url: 'BIMG', screenshot_at: '2026/11/05 20:18:00' },
  { student_id: 'c@x', student_name: 'Cさん', has_image: true, image_data_url: 'CIMG', screenshot_at: '2026/11/05 20:18:00' }
];
const m1 = merge(parent, child);
const a = m1.find(d => d.student_id === 'a@x');
check('子の方が新しければ子の画像を採用する', a.image_data_url === 'NEW', a.image_data_url);
check('氏名は親（名簿の正）を保つ', a.student_name === '親の名前', a.student_name);
const b = m1.find(d => d.student_id === 'b@x');
check('親に画像が無ければ子の画像を採用する', b.has_image === true && b.image_data_url === 'BIMG', b.image_data_url);
const cc = m1.find(d => d.student_id === 'c@x');
check('親に無い児童も子から追加される', !!cc && cc.image_data_url === 'CIMG');
check('親の並び順を維持する', m1.map(d => d.student_id).join(',') === 'a@x,b@x,c@x', m1.map(d => d.student_id));

// 親の方が新しい場合は上書きしない
const m2 = merge(
  [{ student_id: 'a@x', has_image: true, image_data_url: 'NEWER', screenshot_at: '2026/11/05 21:00:00' }],
  [{ student_id: 'a@x', has_image: true, image_data_url: 'OLDER', screenshot_at: '2026/11/05 20:00:00' }]
);
check('親の方が新しければ上書きしない', m2[0].image_data_url === 'NEWER', m2[0].image_data_url);

// 子が空でも壊れない
check('子が空配列でも親をそのまま返す', merge(parent, []).length === 2);
check('親が空でも子を返す', merge([], child).length === 3);
check('null でも落ちない', merge(null, null).length === 0);

finish();
}

// 非同期の平坦化検証が終わってから集計する（同期の exit を先に置かない）
function finish() {
  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail === 0 ? 0 : 1);
}
