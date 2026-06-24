#!/usr/bin/env bash
# ============================================================
# astro-admi ステージング配信 → biyobu.com（シンレン直配信・noindex）
#   admi2888.com 本番は deploy.sh。これは検証用ステージング。
#   - フロント(dist) + api(PHP) を biyobu.com の DocRoot へ rsync（--delete 不使用）
#   - 画像は config.ts の ASSET_ORIGIN=kichifu.com からそのまま読む（共有ロスター画像）
#   - 動的JS(/api 相対) は同居 api/ + 共有DB(shop_id=1) で動作
#   - db-config.php は kichifu の共有DB設定を初回コピー（rsync除外の秘密）
#   - ctrl(CMS) は本番 admi2888.com 側で運用するためステージングには置かない
# ============================================================
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
