#!/usr/bin/env node
/**
 * docs/manual/README.md（操作説明書）の整合性チェック。
 *
 * この説明書は挿絵をインラインSVGで手書きしているため、
 * 閉じタグ漏れ・id重複・目次リンク切れが起きやすい。
 * 文章の校正ではなく「壊れていないか」だけを見る回帰テスト。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'manual', 'README.md');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? ' => ' + detail : '')); }
}

if (!fs.existsSync(DOC)) {
  console.log('FAIL manual not found: ' + DOC);
  console.log('===== 結果: PASS=0 FAIL=1 =====');
  process.exit(1);
}

const src = fs.readFileSync(DOC, 'utf8');
const lines = src.split('\n');

// ---------- 1. 基本構成 ----------
ok(lines.length > 500, '説明書は十分な分量がある', lines.length + ' lines');
ok(src.indexOf('\uFFFD') === -1, '文字化け(U+FFFD)が無い',
  src.indexOf('\uFFFD') >= 0 ? 'offset ' + src.indexOf('\uFFFD') : '');
ok(!/MANEOF|<< '/.test(src), 'シェル用ヒアドキュメントの残骸が無い');

const fences = (src.match(/^```/gm) || []).length;
ok(fences % 2 === 0, 'コードブロックの数が偶数（閉じ忘れ無し）', 'fences=' + fences);

// ---------- 2. SVG 挿絵 ----------
const svgOpen = (src.match(/<svg/g) || []).length;
const svgClose = (src.match(/<\/svg>/g) || []).length;
ok(svgOpen > 0, 'インラインSVGの挿絵がある', 'count=' + svgOpen);
ok(svgOpen === svgClose, 'SVGの開始/終了タグが同数',
  'open=' + svgOpen + ' close=' + svgClose);

// SVG を1枚ずつ切り出して検査
const blocks = [];
{
  let i = 0;
  for (;;) {
    const s = src.indexOf('<svg', i);
    if (s < 0) break;
    const e = src.indexOf('</svg>', s);
    if (e < 0) break;
    blocks.push({ off: s, body: src.slice(s, e + 6) });
    i = e + 6;
  }
}
ok(blocks.length === svgOpen, 'SVGブロックを全て切り出せた',
  'blocks=' + blocks.length + ' open=' + svgOpen);

blocks.forEach((b, n) => {
  const line = src.slice(0, b.off).split('\n').length;
  const vb = /viewBox="([^"]+)"/.exec(b.body);
  const label = 'SVG#' + (n + 1) + ' (line ' + line + ')';

  // viewBox は "min-x min-y width height"。min-x/min-y は 0 が正常なので、
  // 正値であることを要求するのは width / height だけ。
  const nums = vb ? vb[1].trim().split(/\s+/).map(Number) : [];
  ok(vb && nums.length === 4 && nums.every(isFinite) && nums[2] > 0 && nums[3] > 0,
    label + ' viewBox が数値4つ・幅高さが正', vb ? vb[1] : 'viewBox missing');

  ok(b.body.indexOf('<text') >= 0, label + ' 文字要素がある（挿絵として意味がある）');

  // 閉じタグの対応（主要な図形要素のみ）
  ['g', 'text', 'rect', 'circle', 'path', 'line', 'polygon', 'defs', 'marker'].forEach(tag => {
    const o = (b.body.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const c = (b.body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    // <rect .../> のような自己終了は閉じタグを持たない
    const selfClose = (b.body.match(new RegExp('<' + tag + '[^>]*/>', 'g')) || []).length;
    if (o - selfClose !== c) {
      ok(false, label + ' <' + tag + '> の対応',
        'open=' + o + ' selfClose=' + selfClose + ' close=' + c);
    }
  });
});

// ---------- 3. id の重複（SVG を複数並べるとマーカー等が衝突する） ----------
const ids = (src.match(/\sid="([A-Za-z0-9_-]+)"/g) || [])
  .map(s => s.replace(/\sid="/, '').replace(/"$/, ''));
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
ok(dup.length === 0, 'SVG内の id が重複していない', dup.join(', '));

// ---------- 4. 目次アンカーが実在する見出しに解決する ----------
function slug(h) {
  // github-slugger 相当: 小文字化 → 句読点/記号を削除 → 空白をハイフンに
  let s = h.trim().toLowerCase();
  s = Array.from(s).filter(ch => {
    const cp = ch.codePointAt(0);
    // Unicode の P(句読点) / S(記号) を除去。'・'(U+30FB) や '：' もここに入る。
    return !/[\p{P}\p{S}]/u.test(ch) && cp !== 0xFEFF;
  }).join('');
  return s.replace(/\s/g, '-');
}

const anchors = Array.from(new Set((src.match(/\]\(#([^)]+)\)/g) || [])
  .map(s => s.replace(/\]\(#/, '').replace(/\)$/, ''))));
const headingSlugs = new Set();
(src.match(/^#{2,4}\s+.+$/gm) || []).forEach(h => {
  headingSlugs.add(slug(h.replace(/^#+\s+/, '')));
});

ok(anchors.length > 0, '目次にアンカーリンクがある', 'count=' + anchors.length);
anchors.forEach(a => {
  ok(headingSlugs.has(a), 'アンカー #' + a + ' が見出しに解決する');
});

// ---------- 5. 章構成（前半=先生の日常操作 / 後半=管理者の初期設定） ----------
const h2 = (src.match(/^##\s+.+$/gm) || []).map(s => s.replace(/^##\s+/, ''));
ok(h2.length >= 13, '章・付録がそろっている', 'count=' + h2.length);

const idxTeacher = src.indexOf('## 1. このシステムでできること');
const idxAdmin = src.indexOf('## 10. 初期設定の手順');
ok(idxTeacher > 0 && idxAdmin > idxTeacher,
  '先生向けの章(1〜)が管理者向けの章(10〜)より前にある');

['このシステムでできること', 'ログインする', '画面の見方',
 '児童の画面をロックする', 'URLを配信する', '児童の画面を見る',
 '注意マーク', '困ったときは', 'システムの全体像', '初期設定の手順',
 'AI監視の設定'].forEach(kw => {
  ok(src.indexOf(kw) >= 0, '「' + kw + '」の章がある');
});

// ---------- 6. 実装との食い違いが起きやすい箇所 ----------
ok(src.indexOf('東粟倉') >= 0 && /東粟倉小学校は廃校/.test(src),
  '廃校(東粟倉小学校)が「含めないでください」と明記されている');
// 廃校名が14校の一覧に混ざっていないこと。
// 一覧は折り返して2行にまたがるので、見出し行の後ろの空行区切りブロックを行単位で集める。
// （正規表現でまとめて抜くと "**対象は次の14校です。**" の閉じ ** を
//   本文の開始と誤認しやすいため、行単位で素直に走査する。）
const schoolBlock = (() => {
  const idx = lines.findIndex(l => /対象は次の\d+校です/.test(l));
  if (idx < 0) return '';
  const out = [];
  let started = false; // 見出し直後の空行は読み飛ばし、本文が始まってから区切りとする
  for (let i = idx + 1; i < lines.length && i < idx + 12; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (started) break;
      continue;
    }
    if (l.startsWith('>') || l.startsWith('#')) break;
    started = true;
    out.push(l);
  }
  return out.join('\n');
})();
ok(schoolBlock.length > 0, '14校の一覧ブロックを取得できた', JSON.stringify(schoolBlock).slice(0, 80));
const schoolCount = (schoolBlock.match(/[^\s／、]+(?:小学校|中学校|学園)/g) || []).length;
ok(!/東粟倉/.test(schoolBlock), '14校の一覧に東粟倉小学校が入っていない');
ok(schoolCount === 14, '一覧が14校ちょうど', 'count=' + schoolCount);

// ポリシーのキー名（schema.json と一致している必要がある）
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'schema.json'), 'utf8'));
const schemaKeys = Object.keys(schema.properties || {});
ok(schemaKeys.length === 4, 'schema.json のポリシーキーは4個', schemaKeys.join(','));
schemaKeys.forEach(k => {
  ok(src.indexOf(k) >= 0, '説明書に正しいキー「' + k + '」が載っている');
});

// 誤ったキー例として「使わない」と明示されているか
ok(/gasApiUrl/.test(src) && /使わない|誤り|間違い/.test(src),
  '誤ったキー例(gasApiUrl)が「使わない」と説明されている');

// GAS 再デプロイの注意（既存デプロイの更新であること）
ok(/新しいデプロイ/.test(src) && /(変わり|無効)/.test(src),
  '「新しいデプロイ」を押すとURLが変わる注意が書かれている');
ok(/鉛筆|✏/.test(src), '既存デプロイを鉛筆アイコンで更新する手順がある');

// 児童端末でアイコンを押しても何も出ない仕様
ok(/default_popup/.test(src) || /アイコンを押しても/.test(src),
  '児童端末でアイコンを押しても何も出ないことが書かれている');

// URL規制リストの不具合修正（許可/規制が別々に出ること）が反映されている
ok(/許可URLリスト/.test(src) && /規制URLリスト/.test(src),
  '許可URLリストと規制URLリストを区別して説明している');
ok(/それぞれ別のURL/.test(src),
  '「それぞれ別のURLが表示される」旨の注記がある');

// AI監視が既定OFF・管理者のみ
ok(/既定|初期値/.test(src), 'AI監視の初期値について書かれている');
ok(/管理者/.test(src), 'AI監視が管理者のみ操作できると書かれている');

// ---------- 7. 操作例（ボタンを押すと児童画面はこうなる） ----------
const exampleCount = (src.match(/押すと児童の?(画面|端末)は/g) || []).length;
ok(exampleCount >= 2, '「押すと児童の画面はこうなります」の操作例が複数ある',
  'count=' + exampleCount);
ok(src.indexOf('画面ロック中') >= 0, 'ロック画面の実表示文言を再現している');
ok(src.indexOf('アクセスが制限されています') >= 0, 'ブロック画面の実表示文言を再現している');

// ---------- 結果 ----------
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
