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

echo "▶ 旧ページの掃除（dist に無くなった girls/ の .html をサーバーから削除）"
# rsync --delete を使わない運用（uploads 等を守るため）の副作用で、退店・削除したキャストの
# /girls/{id}.html がサーバーに残り続け、非掲載なのに 200 を返す「幽霊ページ」になっていた。
# （2026-07-28 実測: 両サイトとも girls 10件。GSC「クロール済み-インデックス未登録」の一因）
# girls/ は完全にビルド生成物なので、dist に無い .html は消して安全。
#
# news/ は対象外。.htaccess で /news/[id] を常に news-ssr.php に回しており
# news/*.html は配信されない＝幽霊ページにならない（2026-08-02 実測で確認）。
# しかもビルドは最新100件しか出さない（api/news.php の list が min(limit,100)）ため、
# 掃除対象にすると毎回「削除数 > ビルド数」で安全弁が誤作動していた。
KHOST="${DEST%%:*}"; KROOT="${DEST#*:}"
for d in girls; do
  [ -d "dist/$d" ] || continue
  ls "dist/$d" 2>/dev/null | grep '\.html$' | sort > "/tmp/_kkeep_$d.txt"
  $SSH "$KHOST" "ls $KROOT/$d 2>/dev/null | grep '\\.html\$' | sort" > "/tmp/_ksrv_$d.txt" || true
  comm -13 "/tmp/_kkeep_$d.txt" "/tmp/_ksrv_$d.txt" > "/tmp/_kdel_$d.txt"
  n=$(wc -l < "/tmp/_kdel_$d.txt" | tr -d ' '); keep=$(wc -l < "/tmp/_kkeep_$d.txt" | tr -d ' ')
  if [ "$n" = "0" ]; then echo "  $d/: 削除対象なし"; continue; fi
  # 安全弁: ビルド結果より削除数が多い/同等なら異常（ビルド失敗等）とみなして中止
  if [ "$keep" -gt 0 ] && [ "$n" -ge "$keep" ]; then
    # 掃除は後片付けであってデプロイの本体ではない。異常を検知したらその d だけ飛ばし、
    # 配信そのものは止めない（2026-08-02: kichifu の news で発動しデプロイが中断した）
    echo "  ⚠ $d/: 削除対象 $n 件 ≥ ビルド $keep 件。異常の可能性があるため掃除を見送り"; continue
  fi
  echo "  $d/: $n 件を削除 → $(tr '\n' ' ' < "/tmp/_kdel_$d.txt")"
  tr '\n' '\0' < "/tmp/_kdel_$d.txt" | $SSH "$KHOST" "cd $KROOT/$d && xargs -0 -r rm -f"
done

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
