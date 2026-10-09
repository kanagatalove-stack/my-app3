#!/usr/bin/env bash
# ===== 全テストスイート実行（拡張機能 + GAS バックエンド/フロントエンド） =====
# 使い方: bash tests/run_all.sh
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PASS=0; FAIL=0

echo "=== 構文チェック ==="
node tests/check_html.js gas/index.html || FAIL=$((FAIL+1))
for f in extension/background.js extension/content.js extension/lock.js extension/blocked.js; do
  node --check "$f" && echo "OK $f" || FAIL=$((FAIL+1))
done
node -e "new Function(require('fs').readFileSync('gas/Code.gs','utf8')); console.log('Code.gs parsed OK')" || FAIL=$((FAIL+1))
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); JSON.parse(require('fs').readFileSync('extension/schema.json','utf8')); console.log('json OK')" || FAIL=$((FAIL+1))

echo ""
echo "=== 回帰テスト ==="
for t in fe4 fe5 fe6 fe12 fe13 fe14 fe15 r15 gas_adv gas_heartbeat gas_r11 gas_r11_adv gas_r12 gas_r13 gas_screen bg_r12 bg_r13; do
  out="$(node "tests/$t.js" 2>&1)"
  code=$?
  last="$(echo "$out" | tail -1)"
  # 失敗判定: 明示的な FAIL / プロセスの異常終了（クラッシュ・未捕捉例外）/ スタックトレース
  if [ "$code" -ne 0 ] \
     || echo "$out" | grep -qE "FAIL=[1-9]" \
     || echo "$out" | grep -qE "^FAIL " \
     || echo "$out" | grep -qE "(ReferenceError|TypeError|SyntaxError|RangeError|Error:)" ; then
    echo "✗ $t (exit=$code): $last"; FAIL=$((FAIL+1))
  else
    echo "✓ $t: $last"; PASS=$((PASS+1))
  fi
done

echo ""
echo "===== SUITE: 成功 ${PASS} / 失敗 ${FAIL} ====="
exit $(( FAIL > 0 ? 1 : 0 ))
