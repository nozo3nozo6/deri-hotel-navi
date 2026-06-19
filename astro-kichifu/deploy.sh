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

echo "▶ rsync admin/（PHP CMS）"
rsync -avz -e "$SSH" admin/ "$DEST/admin/"

echo "✓ Deploy complete → https://kichifu.com/"
