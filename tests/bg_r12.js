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
// ===== Round 12 background sim: resolveGasUrl / normalizeSchoolKey（1拡張機能→13校GAS振り分け） =====
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8');
function extract(name){
  const re = new RegExp('^function '+name+'\\s*\\(','m');
  const start = src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){ if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;} else {console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;} }

const ctx = { console, JSON, String, Object, Array, RegExp, Error };
vm.createContext(ctx);
vm.runInContext(extract('normalizeSchoolKey')+'\n'+extract('resolveGasUrl')+'\n__resolve=resolveGasUrl; __norm=normalizeSchoolKey;', ctx);

const map = {
  '英田小学校':'https://script.google.com/macros/s/AAA/exec',
  '大原小学校':'https://script.google.com/macros/s/BBB/exec',
  '江見小学校':'https://script.google.com/macros/s/CCC/exec'
};
const A='https://script.google.com/macros/s/AAA/exec', B='https://script.google.com/macros/s/BBB/exec';

console.log('===== gas_url_map による学校別ルーティング =====');
check('学校名が完全一致 → その学校のGAS', ctx.__resolve({ school_name:'大原小学校', gas_url_map:map })===B);
check('略称「大原小」は（正式名解決はGAS側の責務のため）フォールバック', ctx.__resolve({ school_name:'大原小', gas_url_map:map, gas_url:'https://fallback/exec' })==='https://fallback/exec');
check('表記ゆれ（接頭辞「美作市立英田小学校」）→ 一致', ctx.__resolve({ school_name:'美作市立英田小学校', gas_url_map:map })===A);
check('表記ゆれ（全角英数字・空白）を吸収', ctx.__resolve({ school_name:'　大原小学校　', gas_url_map:map })===B);
check('マップに無い学校 → gas_url にフォールバック', ctx.__resolve({ school_name:'未知小学校', gas_url_map:map, gas_url:'https://fallback/exec' })==='https://fallback/exec');
check('学校「未設定」→ gas_url にフォールバック', ctx.__resolve({ school_name:'未設定', gas_url_map:map, gas_url:'https://fallback/exec' })==='https://fallback/exec');
check('学校名が空 → gas_url にフォールバック', ctx.__resolve({ school_name:'', gas_url_map:map, gas_url:'https://fallback/exec' })==='https://fallback/exec');

console.log('===== マップが無い場合（後方互換） =====');
check('gas_url_map 未定義 → gas_url を使用', ctx.__resolve({ school_name:'英田小学校', gas_url:'https://only/exec' })==='https://only/exec');
check('gas_url_map が空オブジェクト → gas_url を使用', ctx.__resolve({ school_name:'英田小学校', gas_url_map:{}, gas_url:'https://only/exec' })==='https://only/exec');
check('学校もマップもURLも無い → 空文字', ctx.__resolve({})==='');
check('gas_url_map が壊れた値（文字列）でもクラッシュせず gas_url', ctx.__resolve({ school_name:'英田小学校', gas_url_map:'oops', gas_url:'https://only/exec' })==='https://only/exec');
check('data が null でもクラッシュせず空文字', ctx.__resolve(null)==='');

console.log('===== 優先度（マップ優先・空値はスキップ） =====');
check('マップ値が空文字なら gas_url にフォールバック', ctx.__resolve({ school_name:'大原小学校', gas_url_map:{'大原小学校':''}, gas_url:'https://fallback/exec' })==='https://fallback/exec');
check('完全一致が最優先（正規化一致より先）', ctx.__resolve({ school_name:'大原小', gas_url_map:{'大原小':'https://exact/exec','大原小学校':B} })==='https://exact/exec');

console.log('===== normalizeSchoolKey =====');
check('接頭辞・空白・全角を除去', ctx.__norm('美作市立 英田小学校')==='英田小学校', ctx.__norm('美作市立 英田小学校'));
check('小文字英字を大文字化', ctx.__norm('abc小')==='ABC小');

console.log('===== ソース配線の確認 =====');
check('DEFAULT_CONFIG に gas_url_map がある', /gas_url_map:\s*\{\}/.test(src));
check('initializeClient が managed.gas_url_map を優先する', /managed\.gas_url_map/.test(src));
check('syncWithGas が resolveGasUrl を呼ぶ', /syncWithGas[\s\S]*?resolveGasUrl\(data\)/.test(src));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
