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
    <updatecheck codebase='https://YOUR_DOMAIN_OR_GITHUB_PAGES/extension.crx' version='1.6.0' />
  </app>
</gupdate>
XMLEOF
echo "✓ $DIST_DIR/update.xml のひな形を作成しました"

# 3. Google 管理コンソール用ポリシーJSONの作成
#    ※ 13校でGASを分ける場合は gas_url_map に「学校名 → GAS URL」を列挙します。
#       1つの拡張機能が、端末の school_name に応じて対応するGASへ自動で振り分けます。
#       （全校共通のGASを使う場合は gas_url のみでOK）
#
#    学校名は gas/Code.gs の CONFIG.SCHOOL_LIST を唯一の正とし、そこから自動列挙します。
#    （拡張機能側 background.js の resolveGasUrl / normalizeSchoolKey はこの正式名称で照合）
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
    # 学校ごとのGAS URLひな形（各校の実デプロイURLに置き換えてください）
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
  echo "    \"Value\": \"${USER_EMAIL}\""
  echo '  }'
  echo "}"
} > "$DIST_DIR/managed_policy.json"
# JSON として妥当か検証（python があれば）
if command -v python3 >/dev/null 2>&1; then
  python3 -c "import json,sys;json.load(open('$DIST_DIR/managed_policy.json'));print('✓ managed_policy.json: valid JSON ('+str(len(json.load(open('$DIST_DIR/managed_policy.json'))['gas_url_map']['Value']))+' 校)')"
else
  echo "✓ $DIST_DIR/managed_policy.json を作成しました"
fi

echo "=== 完了 ==="
