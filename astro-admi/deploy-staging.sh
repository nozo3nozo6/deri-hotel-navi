#!/usr/bin/env bash
# ============================================================
# ⚠️ 廃止（2026-06-26）: biyobu.com は admi ステージングをやめ、別サイト用に転用した。
#   NS切替で admi2888.com が本番化したため biyobu.com への admi 配信は重複コンテンツになる。
#   このスクリプトを実行すると biyobu.com に admi がまた載って転用先を上書きするので無効化。
#   旧 admi 配信は /home/yobuho/biyobu.com/_bak_admi_20260626/ に退避済み。
#   admi の検証は admi2888.com 本番（deploy-prod-admi2888.sh）か、別途新ステージングを用意して行う。
# ------------------------------------------------------------
# （旧）astro-admi ステージング配信 → biyobu.com（シンレン直配信・noindex）
#   - フロント(dist) + api(PHP) を biyobu.com の DocRoot へ rsync（--delete 不使用）
#   - ctrl(CMS) は本番 admi2888.com 側で運用するためステージングには置かない
# ============================================================
echo "✋ deploy-staging.sh は廃止されました（biyobu.com は別サイトに転用済み）。"
echo "   admi の配信は ./deploy-prod-admi2888.sh（本番 admi2888.com）を使ってください。"
echo "   どうしても biyobu.com へ admi を再配信したい場合は、このガード行を一時的に外してください。"
exit 1

set -euo pipefail
cd "$(dirname "$0")"

SSH='ssh -p 10022 -i '"$HOME"'/.ssh/yobuho_deploy -o StrictHostKeyChecking=accept-new'
HOSTSSH='yobuho@sv6051.wpx.ne.jp'
DEST="$HOSTSSH:/home/yobuho/biyobu.com/public_html"

echo "▶ Astro build（postbuild で dist から php/_inc 除去）"
npm run build

echo "▶ rsync dist/（静的フロント＋noindex .htaccess）"
rsync -avz -e "$SSH" dist/ "$DEST/"

echo "▶ rsync api/（PHP API・秘密ファイル除外）"
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" api/ "$DEST/api/"

echo "▶ db-config.php（共有DB設定を kichifu から初回コピー）"
$SSH "$HOSTSSH" 'f=/home/yobuho/biyobu.com/public_html/api/db-config.php; \
  [ -f "$f" ] || cp /home/yobuho/kichifu.com/public_html/api/db-config.php "$f"; ls -l "$f"'

echo "✓ staging deploy 完了 → http://biyobu.com/（SSL発行後は https://biyobu.com/）"
