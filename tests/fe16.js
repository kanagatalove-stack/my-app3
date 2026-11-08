// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== Round 16 frontend sim: URL規制モーダルの「許可/規制リスト混在」バグの回帰テスト =====
//  症状: 許可URLリストにも規制URLリストにも同じURLが表示される。
//  原因: collectKnownAddresses() が許可・規制の両方の情報源を1つの集合に統合し、
//        renderFilterAddressList() がその同一集合を両方のリストへ描画していた。
//  期待: ホワイトリストは許可URLリストへ、ブラックリストは規制URLリストへ。
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');

// --- インライン script を抽出 ---
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue;
  code += m[1] + '\n';
}

// --- 関数をブレース対応で抽出（let 宣言に依存しない） ---
function extract(name, src) {
  const rx = new RegExp('^\\s{4}function ' + name + '\\s*\\(', 'm');
  const st = src.search(rx);
  if (st < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', st), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(st, end + 1);
}

const fns = ['parseAddressList', 'collectKnownAddresses', 'renderFilterAddressList', 'toggleFilterAddress'];
let bundle = '';
fns.forEach(n => { bundle += extract(n, code) + '\n'; });
bundle += '\nfunction escapeHtml(s){ if (typeof s !== "string") return s; return s.replace(/[&<>"\']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#039;"}[c]; }); }\n';

// --- モック DOM ---
const els = {};
function mkEl(id) {
  if (!els[id]) els[id] = { id, innerHTML: '', textContent: '', value: '', checked: false };
  return els[id];
}

// --- テストデータ: 許可と規制で完全に別ドメインにする ---
const WHITE_ONLY = ['nhk.or.jp', 'scratch.mit.edu', 'manabi.example.jp', 'google.com'];
const BLACK_ONLY = ['youtube.com', 'tiktok.com', 'twitter.com'];

const ctx = {
  console, JSON, String, Number, Array, Object, Set, Map, URL, RegExp, Math, Date,
  document: { getElementById: mkEl, querySelectorAll: () => [] },
  currentTeacher: {
    role: 'ADMIN',
    filter_whitelist: 'nhk.or.jp, scratch.mit.edu',
    filter_blacklist: 'youtube.com, tiktok.com',
    // マイURL（＝許可側の候補）: www. を除去してホスト名化される
    urls: [{ title: 'まなび', url: 'https://www.manabi.example.jp/lesson/1' }]
  },
  devicesData: [
    { student_id: 'a@example.jp', whitelist_urls: 'google.com', blacklist_urls: 'twitter.com' },
    { student_id: 'b@example.jp', whitelist_urls: '', blacklist_urls: '' }
  ],
  filterModalState: { white: [], black: [] }
};
vm.createContext(ctx);
vm.runInContext(bundle, ctx);

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}
function has(list, v) { return list.indexOf(v) !== -1; }

console.log('===== ① collectKnownAddresses が種別ごとに分離されている =====');
const white = ctx.collectKnownAddresses('white');
const black = ctx.collectKnownAddresses('black');

check('許可候補に教員の個別許可設定が含まれる', has(white, 'nhk.or.jp'));
check('規制候補に教員の個別規制設定が含まれる', has(black, 'youtube.com'));
check('許可候補にマイURLのホスト名が含まれる（www.除去）', has(white, 'manabi.example.jp'), white);
check('許可候補に端末の許可URLリストが含まれる', has(white, 'google.com'));
check('規制候補に端末の規制URLリストが含まれる', has(black, 'twitter.com'));

console.log('===== ② 許可候補に規制専用ドメインが混ざらない（本バグの核心） =====');
BLACK_ONLY.forEach(d => {
  check('許可候補に規制専用 ' + d + ' が含まれない', !has(white, d), white);
});
console.log('===== ③ 規制候補に許可専用ドメインが混ざらない（本バグの核心） =====');
WHITE_ONLY.forEach(d => {
  check('規制候補に許可専用 ' + d + ' が含まれない', !has(black, d), black);
});

console.log('===== ④ 両リストの候補集合が完全一致しない（同一内容になっていない） =====');
check('許可候補と規制候補が同一集合ではない',
  JSON.stringify(white.slice().sort()) !== JSON.stringify(black.slice().sort()));

console.log('===== ⑤ 描画結果: 許可URLリストに規制URLが表示されない =====');
ctx.renderFilterAddressList('white');
const whiteHtml = mkEl('modalWhitelistList').innerHTML;
const blackHtmlBefore = mkEl('modalBlacklistList').innerHTML;
check('許可リストのHTMLに nhk.or.jp が表示される', whiteHtml.indexOf('nhk.or.jp') !== -1);
check('許可リストのHTMLに youtube.com が表示されない', whiteHtml.indexOf('youtube.com') === -1);
check('許可リストのHTMLに tiktok.com が表示されない', whiteHtml.indexOf('tiktok.com') === -1);
check('許可リストのHTMLに twitter.com が表示されない', whiteHtml.indexOf('twitter.com') === -1);

console.log('===== ⑥ 描画結果: 規制URLリストに許可URLが表示されない =====');
ctx.renderFilterAddressList('black');
const blackHtml = mkEl('modalBlacklistList').innerHTML;
check('規制リストのHTMLに youtube.com が表示される', blackHtml.indexOf('youtube.com') !== -1);
check('規制リストのHTMLに nhk.or.jp が表示されない', blackHtml.indexOf('nhk.or.jp') === -1);
check('規制リストのHTMLに scratch.mit.edu が表示されない', blackHtml.indexOf('scratch.mit.edu') === -1);
check('規制リストのHTMLに manabi.example.jp が表示されない', blackHtml.indexOf('manabi.example.jp') === -1);
check('規制リストのHTMLに google.com が表示されない', blackHtml.indexOf('google.com') === -1);
check('2つのリストのHTMLが同一ではない', whiteHtml !== blackHtml);

console.log('===== ⑦ 片方で選択したURLは反対側の候補から外れる =====');
ctx.filterModalState.black = ['youtube.com'];
ctx.filterModalState.white = [];
const whiteAfter = ctx.collectKnownAddresses('white');
check('規制で選択中の youtube.com は許可候補に出ない', !has(whiteAfter, 'youtube.com'), whiteAfter);
ctx.filterModalState.white = ['nhk.or.jp'];
ctx.filterModalState.black = [];
const blackAfter = ctx.collectKnownAddresses('black');
check('許可で選択中の nhk.or.jp は規制候補に出ない', !has(blackAfter, 'nhk.or.jp'), blackAfter);

console.log('===== ⑧ 選択済みアドレスは自リストに必ず表示される（チェックが消えない） =====');
ctx.filterModalState.white = ['only-here.example.com'];
ctx.filterModalState.black = [];
ctx.renderFilterAddressList('white');
const wHtml2 = mkEl('modalWhitelistList').innerHTML;
check('手入力で追加したアドレスも許可リストに表示される', wHtml2.indexOf('only-here.example.com') !== -1);
check('選択数カウントが表示される', /1件 選択中/.test(mkEl('modalWhitelistCount').textContent),
  mkEl('modalWhitelistCount').textContent);

console.log('===== ⑨ 実装ガード（ゼロ引数呼び出しの再混入を防ぐ） =====');
check('collectKnownAddresses(type) は type 引数を受け取る',
  /function collectKnownAddresses\(\s*type\s*\)/.test(html));
check('呼び出し側が種別を渡している（collectKnownAddresses(key)）',
  /collectKnownAddresses\(key\)/.test(html));
check('ゼロ引数呼び出し collectKnownAddresses() が残っていない',
  !/collectKnownAddresses\(\s*\)/.test(html));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
