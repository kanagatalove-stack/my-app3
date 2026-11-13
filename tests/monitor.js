// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== Round 16: AI監視（学習に関係のないサイトの検知）の回帰テスト =====
//  仕様: 判定はハイブリッド（ドメイン辞書 + 先生が登録するリスト）
//        システム全体のON/OFF は管理者のみ操作できる
//        監視OFFのときは注意マークを出さない（データは保持）
const fs = require('fs'), vm = require('vm');
const gasSrc = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');

// --- 関数抽出（ブレース対応） ---
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = gasSrc.search(re);
  if (start < 0) throw new Error('function not found: ' + name);
  let i = gasSrc.indexOf('{', start), depth = 0, end = -1;
  for (; i < gasSrc.length; i++) {
    if (gasSrc[i] === '{') depth++;
    else if (gasSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return gasSrc.slice(start, end + 1);
}
// --- const 抽出（ブラケット対応: 既定辞書は複数行配列） ---
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const start = gasSrc.search(re);
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0, end = -1;
  for (let i = gasSrc.indexOf('=', start); i < gasSrc.length; i++) {
    const ch = gasSrc[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  return gasSrc.slice(start, end + 1);
}

// --- PropertiesService モック ---
const props = {};
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat,
  Set, Map, RegExp, Error,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(k) { return (k in props) ? props[k] : null; },
        setProperty(k, v) { props[k] = String(v); },
        deleteProperty(k) { delete props[k]; }
      };
    }
  },
  Utilities: { formatDate() { return '2026/10/23 12:00:00'; } },
  Logger: { log() {} },
  invalidateDevicesCache() { ctx.__cacheInvalidated = (ctx.__cacheInvalidated || 0) + 1; }
};

let bundle = '';
[
  'normalizeMonitorHost', 'hostMatchesAnyDomain', 'isWebUrlForMonitoring', 'getMonitoringSettings',
  'sanitizeMonitorDomainList', 'saveMonitoringSettings', 'evaluateUrlForMonitoring',
  'applyMonitorVisibility', 'parseUrlList', 'parseBoolean', 'isAdminTeacher'
].forEach(n => { bundle += extract(n) + '\n'; });
bundle += extractConst('MONITOR_PROP_KEY') + '\n';
bundle += extractConst('MONITOR_MAX_DOMAINS') + '\n';
bundle += extractConst('MONITOR_DEFAULT_LEARNING_DOMAINS') + '\n';
bundle += extractConst('MONITOR_DEFAULT_BLOCKED_DOMAINS') + '\n';

vm.createContext(ctx);
vm.runInContext(bundle, ctx);

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}
const ADMIN = { email: 'admin@mimasaka.ed.jp', role: 'ADMIN', school: '全校管理' };
const TEACHER = { email: 't@mimasaka.ed.jp', role: 'TEACHER', school: '英田小学校' };

// ============================================================
console.log('===== ① normalizeMonitorHost: URL からホスト名を取り出す =====');
check('スキーム・www・パスを除去', ctx.normalizeMonitorHost('https://www.YouTube.com/watch?v=abc') === 'youtube.com',
  ctx.normalizeMonitorHost('https://www.YouTube.com/watch?v=abc'));
check('ポートを除去', ctx.normalizeMonitorHost('http://example.com:8080/a') === 'example.com',
  ctx.normalizeMonitorHost('http://example.com:8080/a'));
check('スキーム無しでも動く', ctx.normalizeMonitorHost('tiktok.com/x') === 'tiktok.com',
  ctx.normalizeMonitorHost('tiktok.com/x'));
check('クエリ付き', ctx.normalizeMonitorHost('https://search.yahoo.co.jp/search?p=1') === 'search.yahoo.co.jp',
  ctx.normalizeMonitorHost('https://search.yahoo.co.jp/search?p=1'));
check('空文字は空文字', ctx.normalizeMonitorHost('') === '', ctx.normalizeMonitorHost(''));
check('chrome-extension スキームも処理できる', ctx.normalizeMonitorHost('chrome-extension://abc/x.html') === 'abc',
  ctx.normalizeMonitorHost('chrome-extension://abc/x.html'));

// ============================================================
console.log('===== ② hostMatchesAnyDomain: サブドメイン一致と誤爆防止 =====');
check('完全一致', ctx.hostMatchesAnyDomain('youtube.com', ['youtube.com']) === true);
check('サブドメイン一致', ctx.hostMatchesAnyDomain('www.youtube.com', ['youtube.com']) === true);
check('深いサブドメイン一致', ctx.hostMatchesAnyDomain('m.youtube.com', ['youtube.com']) === true);
check('前方一致の誤爆をしない（notyoutube.com）', ctx.hostMatchesAnyDomain('notyoutube.com', ['youtube.com']) === false);
check('後方一致の誤爆をしない（youtube.com.evil.jp）', ctx.hostMatchesAnyDomain('youtube.com.evil.jp', ['youtube.com']) === false);
check('無関係ホストは false', ctx.hostMatchesAnyDomain('nhk.or.jp', ['youtube.com']) === false);
check('空ホストは false', ctx.hostMatchesAnyDomain('', ['youtube.com']) === false);

// ============================================================
console.log('===== ③ 既定はOFF（明示的にONにしない限り注意マークは出ない） =====');
const dflt = ctx.getMonitoringSettings();
check('既定 enabled=false', dflt.enabled === false, dflt.enabled);
check('既定で学習辞書が入っている', Array.isArray(dflt.learning_domains) && dflt.learning_domains.length > 10,
  dflt.learning_domains.length);
check('既定で非学習辞書が入っている', Array.isArray(dflt.blocked_domains) && dflt.blocked_domains.length > 10,
  dflt.blocked_domains.length);
check('既定辞書に youtube.com が含まれる', dflt.blocked_domains.indexOf('youtube.com') !== -1);
check('既定辞書に scratch.mit.edu が含まれる', dflt.learning_domains.indexOf('scratch.mit.edu') !== -1);

console.log('--- OFF のときは何を開いても注意しない ---');
let r = ctx.evaluateUrlForMonitoring('https://www.youtube.com/watch?v=1', '', '');
check('OFF: youtube.com でも flagged=false', r.flagged === false, r);

// ============================================================
console.log('===== ④ 管理者のみが設定を変更できる =====');
let threw = false;
try { ctx.saveMonitoringSettings(TEACHER, { enabled: true }); } catch (e) { threw = true; }
check('一般教員(TEACHER)の保存は拒否される', threw === true);

threw = false;
try { ctx.saveMonitoringSettings(null, { enabled: true }); } catch (e) { threw = true; }
check('未ログイン(null)の保存は拒否される', threw === true);

const saved = ctx.saveMonitoringSettings(ADMIN, { enabled: true });
check('管理者(ADMIN)は保存できる', saved.enabled === true, saved.enabled);
check('保存で読み取りキャッシュが無効化される', (ctx.__cacheInvalidated || 0) >= 1, ctx.__cacheInvalidated);
check('保存後に getMonitoringSettings で enabled=true が返る', ctx.getMonitoringSettings().enabled === true);
check('最終更新者が記録される', ctx.getMonitoringSettings().updated_by === 'admin@mimasaka.ed.jp',
  ctx.getMonitoringSettings().updated_by);

// ============================================================
console.log('===== ⑤ 判定の優先順位（ハイブリッド方式） =====');
// ON のまま検証する
const W = 'scratch.mit.edu';       // 学習辞書
const B = 'youtube.com';           // 非学習辞書

r = ctx.evaluateUrlForMonitoring('https://scratch.mit.edu/projects', '', '');
check('学習ドメイン辞書のサイトは注意しない', r.flagged === false, r);

r = ctx.evaluateUrlForMonitoring('https://www.youtube.com/watch?v=1', '', '');
check('非学習ドメイン辞書のサイトは注意する', r.flagged === true, r);
check('注意理由に学習に関係のない旨が入る', /学習に関係のない/.test(r.reason), r.reason);

console.log('--- 先生が登録するリスト（端末の許可/規制URL）が辞書より優先される ---');
r = ctx.evaluateUrlForMonitoring('https://www.youtube.com/watch?v=1', 'youtube.com', '');
check('許可URLリストにあれば非学習辞書でも注意しない（先生の判断を優先）', r.flagged === false, r);

r = ctx.evaluateUrlForMonitoring('https://example-class.jp/lesson', '', 'example-class.jp');
check('規制URLリストにあれば未知サイトでも注意する', r.flagged === true, r);
check('規制リスト由来の理由が入る', /規制URLリスト/.test(r.reason), r.reason);

console.log('--- 未知のサイトは黙認（誤検知を避ける） ---');
r = ctx.evaluateUrlForMonitoring('https://unknown-school-site.example/abc', '', '');
check('未知サイトは flagged=false', r.flagged === false, r);

console.log('--- 内部ページは判定対象外 ---');
['chrome://settings/', 'chrome-extension://abcdefg/x.html', 'about:blank', 'file:///home/x.html']
  .forEach(u => {
    const rr = ctx.evaluateUrlForMonitoring(u, '', '');
    check('内部ページは注意しない: ' + u, rr.flagged === false, rr.host);
  });

// ============================================================
console.log('===== ⑥ 監視OFFにすると注意マークが伏せられる（データは保持） =====');
ctx.saveMonitoringSettings(ADMIN, { enabled: true });
const devices = [
  { student_id: 'a@x.jp', monitor_flag: true, monitor_reason: '学習に関係のないサイト（youtube.com）', monitor_url: 'youtube.com', monitor_at: '2026/10/23 10:00:00' },
  { student_id: 'b@x.jp', monitor_flag: false, monitor_reason: '', monitor_url: '', monitor_at: '' }
];
let out = ctx.applyMonitorVisibility(JSON.parse(JSON.stringify(devices)));
check('ON のときはフラグが保持される', out[0].monitor_flag === true, out[0].monitor_flag);

ctx.saveMonitoringSettings(ADMIN, { enabled: false });
out = ctx.applyMonitorVisibility(JSON.parse(JSON.stringify(devices)));
check('OFF のときは monitor_flag が false になる', out[0].monitor_flag === false, out[0].monitor_flag);
check('OFF のときは monitor_reason が空になる', out[0].monitor_reason === '', out[0].monitor_reason);
check('OFF のときは monitor_url が空になる', out[0].monitor_url === '', out[0].monitor_url);
check('OFF のときは monitor_at が空になる', out[0].monitor_at === '', out[0].monitor_at);
check('OFF でも元の配列（シートの値）は壊さない', devices[0].monitor_flag === true);

console.log('--- OFF のときは heartbeat でも判定しない（辞書照合しない） ---');
r = ctx.evaluateUrlForMonitoring('https://www.youtube.com/watch?v=1', '', '');
check('OFF: 非学習辞書のサイトでも flagged=false', r.flagged === false, r);

// ============================================================
console.log('===== ⑦ 辞書のサニタイズ（重複除去・正規化・上限） =====');
const dirty = ['https://www.YouTube.com/watch', 'youtube.com', '  tiktok.com  ', '', 'bad host', 'a.b', 'a.b'];
const clean = ctx.sanitizeMonitorDomainList(dirty);
check('URL形式はホスト名へ正規化される', clean.indexOf('youtube.com') !== -1, clean);
check('重複は除去される', clean.filter(x => x === 'youtube.com').length === 1, clean);
check('前後空白は除去される', clean.indexOf('tiktok.com') !== -1, clean);
check('空要素は捨てる', clean.indexOf('') === -1, clean);
check('空白を含む不正値は捨てる', clean.indexOf('bad host') === -1, clean);
const many = [];
for (let i = 0; i < 600; i++) many.push('d' + i + '.example.com');
check('上限（500件）を超えない', ctx.sanitizeMonitorDomainList(many).length <= 500,
  ctx.sanitizeMonitorDomainList(many).length);

// ============================================================
console.log('===== ⑧ シート列とAPIの配線 =====');
// DEVICE_COLUMNS は CONFIG オブジェクトのプロパティなので、専用に切り出す
function extractConfigProp(name) {
  const re = new RegExp('^\\s*' + name + '\\s*:\\s*\\[', 'm');
  const m = gasSrc.match(re);
  if (!m) throw new Error('CONFIG property not found: ' + name);
  const start = m.index + m[0].length - 1; // '[' の位置
  let depth = 0, end = -1;
  for (let i = start; i < gasSrc.length; i++) {
    const ch = gasSrc[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  return gasSrc.slice(start, end + 1);
}
const COL = extractConfigProp('DEVICE_COLUMNS');
check('DEVICE_COLUMNS が取得できた', COL.length > 100, COL.length);
['要注意', '注意理由', '要注意URL', '注意検知日時'].forEach(c => {
  check('DEVICE_COLUMNS に「' + c + '」がある', COL.indexOf("'" + c + "'") !== -1);
});
check('getAllDevices が monitor_flag を返す', /monitor_flag:\s*monFlagIdx/.test(gasSrc));
check('getAllDevices が applyMonitorVisibility を通す', /return applyMonitorVisibility\(results\)/.test(gasSrc));
check('heartbeat が要注意4列をまとめて書き込む', /monFlagCol,\s*1,\s*4\)\.setValues/.test(gasSrc));
check('doPost に get_monitor_settings がある', /action === 'get_monitor_settings'/.test(gasSrc));
check('doPost に save_monitor_settings がある', /action === 'save_monitor_settings'/.test(gasSrc));
check('google.script.run 用 api_getMonitorSettings がある', /function api_getMonitorSettings\(/.test(gasSrc));
check('google.script.run 用 api_saveMonitorSettings がある', /function api_saveMonitorSettings\(/.test(gasSrc));
check('保存時に管理者チェックを行う（サーバー側の防御）',
  /function saveMonitoringSettings[\s\S]{0,300}isAdminTeacher/.test(gasSrc));

// ============================================================
console.log('===== ⑨ 管理画面: トグルと注意マーク =====');
check('監視設定モーダルがある', /id="monitorModal"/.test(html));
check('システム全体ON/OFFトグルがある', /id="monitorEnabledToggle"/.test(html));
check('非学習ドメイン辞書の編集欄がある', /id="monitorBlockedDomains"/.test(html));
check('学習ドメイン辞書の編集欄がある', /id="monitorLearningDomains"/.test(html));
check('ヘッダーの監視設定ボタンがある', /id="monitorSettingsBtn"/.test(html));
check('監視設定ボタンは初期状態で非表示（管理者のみ表示される）',
  /id="monitorSettingsBtn"[\s\S]{0,400}class="hidden/.test(html));
check('updateHeaderTeacherInfo が管理者のみ表示に制御している',
  /monitorSettingsBtn'\);\s*\n?\s*if \(monitorBtn\) monitorBtn\.classList\.toggle\('hidden', !isAdminUser\(\)\)/.test(html));
check('openMonitoringModal が管理者以外を弾く',
  /function openMonitoringModal[\s\S]{0,200}if \(!isAdminUser\(\)\)/.test(html));
check('saveMonitoringSettingsFromModal が管理者以外を弾く',
  /function saveMonitoringSettingsFromModal[\s\S]{0,200}if \(!isAdminUser\(\)\)/.test(html));
check('名簿の氏名の横に注意マークを描画する', /const monitorBadge = d\.monitor_flag/.test(html));
check('注意マークに理由がツールチップで入る', /title="\$\{escapeHtml\(d\.monitor_reason/.test(html));
check('apiRequest が get_monitor_settings を中継する', /act === 'get_monitor_settings'/.test(html));
check('apiRequest が save_monitor_settings を中継する', /act === 'save_monitor_settings'/.test(html));
// 関数本体を抽出し、その中で loadDevices を await しているかを見る
// （固定文字数窓だと実装が少し長くなっただけで壊れるため、本体抽出で判定する）
function extractHtmlFunction(name, from) {
  const start = html.indexOf('function ' + name);
  if (start < 0) return '';
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return html.slice(start, end + 1);
}
const saveFnBody = extractHtmlFunction('saveMonitoringSettingsFromModal');
check('saveMonitoringSettingsFromModal の本体を抽出できた', saveFnBody.length > 200, saveFnBody.length);
check('保存後に loadDevices で即時反映する', /await loadDevices\(\)/.test(saveFnBody));
check('保存後に抑制フラグを解除して即時反映を許可する',
  /refreshSuppressedUntil\s*=\s*0/.test(saveFnBody));
// 監視フラグ（monitor_flag）はサーバーが判定して書き込む値であり、画面側の
// 楽観更新ではない。したがって保護レジストリを装着してはいけない
// （装着するとサーバーが付けた注意マークを 12 秒間ブロックしてしまう）。
check('監視設定の保存は楽観更新保護の対象外（サーバー判定値のため）',
  !/armOptimisticGuard/.test(saveFnBody));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
