#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
EXT_DIR="$ROOT_DIR/extension"
DIST_DIR="$ROOT_DIR/dist"

mkdir -p "$DIST_DIR"

echo "=== Chromebook 児童端末管理拡張機能 パッケージ作成 ==="

# 1. ZIPアーカイブの作成
cd "$EXT_DIR"
zip -r -q "$DIST_DIR/extension.zip" . -x "*.git*" -x "*.DS_Store"
echo "✓ $DIST_DIR/extension.zip を作成しました"

# 2. update.xml のひな形作成
cat << 'XMLEOF' > "$DIST_DIR/update.xml"
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <!-- 
    appid: 手元のPCのChromeでパッケージ化した際に表示される32文字の拡張機能IDに書き換えてください
    codebase: extension.crx を配置した公開URLに書き換えてください
  -->
  <app appid='YOUR_EXTENSION_ID_HERE'>
    <updatecheck codebase='https://YOUR_DOMAIN_OR_GITHUB_PAGES/extension.crx' version='1.0.6' />
  </app>
</gupdate>
XMLEOF
echo "✓ $DIST_DIR/update.xml のひな形を作成しました"

# 3. Google 管理コンソール用ポリシーJSONの作成
cat << 'JSONEOF' > "$DIST_DIR/managed_policy.json"
{
  "gas_url": {
    "Value": "https://script.google.com/macros/s/AKfycb.../exec"
  },
  "student_id": {
    "Value": "${USER_EMAIL}"
  },
  "school_name": {
    "Value": ""
  }
}
JSONEOF
echo "✓ $DIST_DIR/managed_policy.json を作成しました"

echo "=== 完了 ==="
