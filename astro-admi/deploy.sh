#!/usr/bin/env bash
# ============================================================
# admi2888.com 本番デプロイ（★NS切替後のみ使用）
#   Astroビルド → dist/ をシンレン public_html へ rsync。--delete 不使用。
#   ⚠️ 本番デプロイ前に config を本番値へ戻すこと:
#       - src/lib/config.ts   : ASSET_ORIGIN='https://admi2888.com'（共有ロスターのshop_id確定）
#       - astro.config.mjs    : site='https://admi2888.com'
#       - src/layouts/Site.astro: SITE=admi2888.com / robots=index,follow / GA=admi専用ID
#       - public/.htaccess    : X-Robots-Tag noindex 行を削除
#   ※ 検証は ./deploy-staging.sh（biyobu.com）を使う。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SSH='ssh -p 10022 -i '"$HOME"'/.ssh/yobuho_deploy -o StrictHostKeyChecking=accept-new'
DEST='yobuho@sv6051.wpx.ne.jp:/home/yobuho/admi2888.com/public_html'

echo "▶ Astro build (+postbuild: distからphp/_inc除去)"
npm run build

echo "▶ rsync dist/（静的フロント＋.htaccess）"
rsync -avz -e "$SSH" dist/ "$DEST/"

echo "▶ rsync api/（PHP API・秘密ファイル除外）"
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" api/ "$DEST/api/"

echo "▶ rsync ctrl/（PHP CMS、旧admin）"
rsync -avz -e "$SSH" ctrl/ "$DEST/ctrl/"

echo "✓ Deploy complete → https://admi2888.com/"
