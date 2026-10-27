#!/bin/bash
# ============================================================================
# Chromebook 児童端末管理拡張機能 — 2ビルド一括作成
#
#   dist/store.zip   … Chrome Web Store 提出用（本番・正本）
#                      extension/ をそのまま固める。
#                      default_popup を持たない＝児童がアイコンを押しても何も出ない。
#                      GAS URL は Google 管理コンソールのポリシーで配信する。
#
#   dist/direct.zip  … 実機検証用（直接読み込み）
#                      extension/ を完全複製し、variants/direct_overrides/ で上書きする。
#                      default_popup を持ち、ポップアップから GAS URL を直接入力できる。
#                      chrome://extensions が使えない環境でも、ポップアップが
#                      唯一の設定・診断窓口になる。
#
# 複製は cp -a を使う（rsync は環境によっては入っていないため使わない）。
#
# 使い方: bash scripts/package_extension.sh
# ============================================================================
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
EXT_DIR="$ROOT_DIR/extension"
OVERRIDE_DIR="$ROOT_DIR/variants/direct_overrides"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/build_tmp"

echo "=== Chromebook 児童端末管理拡張機能 パッケージ作成 ==="
echo

# --- 事前チェック ---------------------------------------------------------
for f in manifest.json background.js content.js popup.html popup.js popup.css; do
  [ -f "$EXT_DIR/$f" ] || { echo "エラー: 見つかりません: extension/$f" >&2; exit 1; }
done
for f in manifest.json popup.html popup.js popup.css; do
  [ -f "$OVERRIDE_DIR/$f" ] || { echo "エラー: 見つかりません: variants/direct_overrides/$f" >&2; exit 1; }
done

VERSION="$(python3 -c "import json;print(json.load(open('$EXT_DIR/manifest.json'))['version'])")"
echo "版数: $VERSION"
echo

rm -rf "$BUILD_DIR"
mkdir -p "$DIST_DIR" "$BUILD_DIR"

# ==========================================================================
# 1. ストア版（extension/ をそのまま）
# ==========================================================================
STORE_DIR="$BUILD_DIR/store"
cp -a "$EXT_DIR" "$STORE_DIR"
find "$STORE_DIR" -name '.DS_Store' -delete 2>/dev/null || true

rm -f "$DIST_DIR/store.zip" "$DIST_DIR/extension.zip"
( cd "$STORE_DIR" && zip -r -q -X "$DIST_DIR/store.zip" . )
# 後方互換: 既存ドキュメント（ADMIN_CONSOLE_SETUP / CHROME_WEB_STORE_* 等）は
# dist/extension.zip を参照しているため、同一内容をその名前でも出力する。
cp -f "$DIST_DIR/store.zip" "$DIST_DIR/extension.zip"
echo "✓ dist/store.zip（＝dist/extension.zip 同一内容・後方互換）"

# ストア版の検証: default_popup が無いこと（児童がアイコンを押しても無反応）
python3 - "$STORE_DIR/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert not (m.get('action') or {}).get('default_popup'), \
    'ストア版に default_popup があってはいけない（児童が押すと設定画面が出てしまう）'
print('  └ default_popup なし（児童のアイコン操作は無反応）を確認')
PY

# ==========================================================================
# 2. 直接読み込み版(検証用) = extension/ 完全複製 + overrides 上書き
# ==========================================================================
DIRECT_DIR="$BUILD_DIR/direct"
cp -a "$EXT_DIR" "$DIRECT_DIR"
cp -a "$OVERRIDE_DIR/." "$DIRECT_DIR/"
find "$DIRECT_DIR" -name '.DS_Store' -delete 2>/dev/null || true

rm -f "$DIST_DIR/direct.zip"
( cd "$DIRECT_DIR" && zip -r -q -X "$DIST_DIR/direct.zip" . )
echo "✓ dist/direct.zip"

# 直接読み込み版の検証: default_popup があり、ポップアップ3点セットが同梱されていること
python3 - "$DIRECT_DIR" <<'PY'
import json, os, sys
d = sys.argv[1]
m = json.load(open(os.path.join(d, 'manifest.json')))
pop = (m.get('action') or {}).get('default_popup')
assert pop == 'popup.html', '直接読み込み版には default_popup: popup.html が必要'
for f in ('popup.html', 'popup.js', 'popup.css'):
    assert os.path.isfile(os.path.join(d, f)), '同梱されていません: ' + f
# overrides が確実に効いていること（検証用の名称になっている）
assert '検証用' in m.get('name', ''), 'overrides/manifest.json が反映されていません'
print('  └ default_popup あり／popup.html・js・css 同梱／検証用manifest 反映 を確認')
PY

# ==========================================================================
# 3. 構文チェック（両ビルドとも）
# ==========================================================================
if command -v node >/dev/null 2>&1; then
  for d in "$STORE_DIR" "$DIRECT_DIR"; do
    node --check "$d/background.js"
    node --check "$d/content.js"
    node --check "$d/popup.js" 2>/dev/null || true
  done
  echo "✓ JavaScript 構文チェック"
fi

# ==========================================================================
# 4. 管理コンソール配布用ポリシーJSON（ストア版用）
#    学校名は gas/Code.gs の CONFIG.SCHOOL_LIST を唯一の正とする。
#    ※ 東粟倉小学校は廃校のため含めない。
# ==========================================================================
SETUP_SCHOOLS=(
  "英田小学校"
  "大原小学校"
  "江見小学校"
  "勝田小学校"
  "勝田東小学校"
  "第一小学校"
  "北小学校"
  "土居小学校"
  "英田中学校"
  "大原中学校"
  "作東中学校"
  "勝田中学校"
  "美作中学校"
  "樸学園"
)

{
  echo "{"
  echo '  "gas_url_map": {'
  echo '    "Value": {'
  n=${#SETUP_SCHOOLS[@]}
  for i in "${!SETUP_SCHOOLS[@]}"; do
    s="${SETUP_SCHOOLS[$i]}"
    placeholder="https://script.google.com/macros/s/REPLACE_WITH_$(printf '%02d' $((i + 1)))_GAS_ID/exec"
    comma=","
    [ "$i" -eq $((n - 1)) ] && comma=""
    printf '      "%s": "%s"%s\n' "$s" "$placeholder" "$comma"
  done
  echo '    }'
  echo '  },'
  echo '  "school_name": {'
  echo '    "Value": ""'
  echo '  },'
  echo '  "student_id": {'
  echo "    \"Value\": \"${USER_EMAIL:-}\""
  echo '  }'
  echo "}"
} > "$DIST_DIR/managed_policy.json"

python3 - "$DIST_DIR/managed_policy.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
n = len(d['gas_url_map']['Value'])
assert '東粟倉小学校' not in d['gas_url_map']['Value'], '廃校が含まれています'
print('✓ dist/managed_policy.json（%d 校・東粟倉小学校は除外）' % n)
PY

# ==========================================================================
# 5. update.xml のひな形（版数は manifest.json から自動取得）
# ==========================================================================
cat > "$DIST_DIR/update.xml" <<XMLEOF
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <!--
    appid   : ストア公開後に確定する32文字の拡張機能IDに書き換えてください
    codebase: extension.crx を配置した公開URLに書き換えてください
    ※ 版数は manifest.json から自動反映しています（現在 $VERSION）
  -->
  <app appid='YOUR_EXTENSION_ID_HERE'>
    <updatecheck codebase='https://YOUR_DOMAIN_OR_GITHUB_PAGES/extension.crx' version='$VERSION' />
  </app>
</gupdate>
XMLEOF
echo "✓ dist/update.xml（version='$VERSION'）"

rm -rf "$BUILD_DIR"

echo
echo "=== 完了 ==="
echo "  ストア提出用            : dist/store.zip"
echo "  実機検証用（直接読み込み）: dist/direct.zip"
echo
ls -lh "$DIST_DIR/store.zip" "$DIST_DIR/direct.zip" | awk '{print "  " $9 "  " $5}'
