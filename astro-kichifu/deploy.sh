#!/usr/bin/env bash
# ============================================================
# kichifu.com ローカルデプロイ（ylka方式 / 全部シンレン同居）
#   Astroビルド → dist/ をシンレン public_html へ rsync。
#   同一オリジンなので CORS 不要・画像も同一ホスト。GitHub Actions 不要。
#   --delete は使わない（api/ admin/ uploads/ 等のサーバー資産を保全）。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SSH='ssh -p 10022 -i '"$HOME"'/.ssh/yobuho_deploy -o StrictHostKeyChecking=accept-new'
DEST='yobuho@sv6051.wpx.ne.jp:/home/yobuho/kichifu.com/public_html'

echo "▶ Astro build (+postbuild: distからphp/_inc除去)"
npm run build

echo "▶ rsync dist/（静的フロント＋.htaccess）"
rsync -avz -e "$SSH" dist/ "$DEST/"

echo "▶ rsync api/（PHP API・秘密ファイル除外）"
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" api/ "$DEST/api/"

# ctrl/（CMS）は kichifu には配信しない。CMSは admi2888.com/ctrl に一本化（kichifu.com/ctrlは廃止・admi2888へ301）。
# ctrl コードの正は astro-kichifu/ctrl/ で、admi2888 へは deploy-prod-admi2888.sh が配信する。

echo "▶ rsync public/*.php（SSRフォールバック: postbuildでdistから削除されるため別途デプロイ）"
rsync -avz -e "$SSH" public/news-ssr.php public/diary-ssr.php public/girls-ssr.php public/_ssr-shell.php "$DEST/"

echo "▶ サーバーに残る旧 sitemap.xml を削除（rsync --delete無し運用。@astrojs/sitemap は sitemap-index.xml を出すので旧 sitemap.xml は不要・誤配信の元）"
$SSH 'yobuho@sv6051.wpx.ne.jp' 'rm -f /home/yobuho/kichifu.com/public_html/sitemap.xml; echo "sitemap: $(ls /home/yobuho/kichifu.com/public_html/sitemap*.xml 2>/dev/null | tr "\n" " ")"'

echo "✓ Deploy complete → https://kichifu.com/"
