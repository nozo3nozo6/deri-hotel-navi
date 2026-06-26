#!/usr/bin/env bash
# ============================================================
# ⛔ 廃止: このスクリプトは使わない。本番デプロイは ./deploy-prod-admi2888.sh を使う。
#   理由（2026-06-26 事故）: このスクリプトは
#     - .htaccess の staging用 noindex(X-Robots-Tag) を除去せず配信 → admi2888が突然 noindex 化
#     - astro-admi/ctrl・api（古いフォーク）を配信 → 共有CMS/APIが旧版に巻き戻る
#   正しい本番デプロイ deploy-prod-admi2888.sh は noindex除去 + ctrl/api を astro-kichifu から配信する。
# ============================================================
echo "⛔ deploy.sh は廃止。本番は ./deploy-prod-admi2888.sh を使ってください（noindex除去・正ctrl/api配信）。" >&2
exit 1

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
