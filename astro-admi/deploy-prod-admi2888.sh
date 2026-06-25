#!/usr/bin/env bash
# ============================================================
# astro-admi 本番配信 → admi2888.com（シンレン直配信・index許可）
#   biyobu 用 deploy-staging.sh の本番版。同一 astro-admi(shop_id=1) を配信。
#   - PUBLIC_PROD=1 ビルド → robots=index,follow ＋ GA(G-50Q48YG34Z) 有効
#   - canonical/OG は SITE=https://admi2888.com（Site.astro 固定）
#   - .htaccess の X-Robots-Tag(noindex) 行をデプロイ後に除去（本番はインデックス許可）
#   - 画像は config.ts ASSET_ORIGIN=kichifu.com から読む（共有ロスター画像）
#   - 動的JS(/api 相対) は同居 api/ + 共有DB(shop_id=1) で動作
#   - db-config.php は kichifu の共有DB設定をコピー（rsync除外の秘密）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SSH='ssh -p 10022 -i '"$HOME"'/.ssh/yobuho_deploy -o StrictHostKeyChecking=accept-new'
HOSTSSH='yobuho@sv6051.wpx.ne.jp'
ROOT='/home/yobuho/admi2888.com/public_html'
DEST="$HOSTSSH:$ROOT"

echo "▶ Astro build（本番: PUBLIC_PROD=1 → index,follow + GA有効 / shop_id=1）"
PUBLIC_PROD=1 npm run build

echo "▶ rsync dist/（静的フロント）"
rsync -avz -e "$SSH" dist/ "$DEST/"

echo "▶ rsync api/（PHP API・秘密ファイル除外）"
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" api/ "$DEST/api/"

echo "▶ rsync ctrl/（共有CMS・kichifu と同一コード・DB shop_id で店舗分離）"
rsync -avz -e "$SSH" ctrl/ "$DEST/ctrl/"

echo "▶ db-config.php（共有DB設定を kichifu からコピー）"
$SSH "$HOSTSSH" 'f='"$ROOT"'/api/db-config.php; \
  [ -f "$f" ] || cp /home/yobuho/kichifu.com/public_html/api/db-config.php "$f"; ls -l "$f"'

echo "▶ .htaccess の noindex(X-Robots-Tag) を本番用に除去"
$SSH "$HOSTSSH" 'sed -i "/X-Robots-Tag .*noindex/d" '"$ROOT"'/.htaccess; echo "残 X-Robots-Tag: $(grep -c X-Robots-Tag '"$ROOT"'/.htaccess || true)"'

echo "✓ admi2888.com 本番デプロイ完了（DNS反映＋SSL発行後に https://admi2888.com/ で公開）"
