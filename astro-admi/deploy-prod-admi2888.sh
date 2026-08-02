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

echo "▶ 旧ページの掃除（dist に無くなった girls/ の .html をサーバーから削除）"
# rsync --delete を使わない運用（uploads 等を守るため）の副作用で、退店・削除したキャストの
# /girls/{id}.html がサーバーに残り続け、非掲載なのに 200 を返す「幽霊ページ」になっていた。
# （2026-07-28 実測: girls 10件。GSC「クロール済み-インデックス未登録」の一因）
# girls/ は完全にビルド生成物なので、dist に無い .html は消して安全。
#
# news/ は対象外。.htaccess で /news/[id] を常に news-ssr.php に回しており
# news/*.html は配信されない＝幽霊ページにならない（2026-08-02 実測で確認）。
# しかもビルドは最新100件しか出さない（api/news.php の list が min(limit,100)）ため、
# 掃除対象にすると毎回「削除数 > ビルド数」で安全弁が誤作動していた。
for d in girls; do
  [ -d "dist/$d" ] || continue
  ls "dist/$d" 2>/dev/null | grep '\.html$' | sort > "/tmp/_keep_$d.txt"
  $SSH "$HOSTSSH" "ls $ROOT/$d 2>/dev/null | grep '\\.html\$' | sort" > "/tmp/_srv_$d.txt" || true
  comm -13 "/tmp/_keep_$d.txt" "/tmp/_srv_$d.txt" > "/tmp/_del_$d.txt"
  n=$(wc -l < "/tmp/_del_$d.txt" | tr -d ' '); keep=$(wc -l < "/tmp/_keep_$d.txt" | tr -d ' ')
  if [ "$n" = "0" ]; then echo "  $d/: 削除対象なし"; continue; fi
  # 安全弁: ビルド結果より削除数が多い/同等なら異常（ビルド失敗等）とみなして中止
  if [ "$keep" -gt 0 ] && [ "$n" -ge "$keep" ]; then
    # 掃除は後片付けであってデプロイの本体ではない。異常を検知したらその d だけ飛ばし、
    # 配信そのものは止めない（2026-08-02: kichifu の news で発動しデプロイが中断した）
    echo "  ⚠ $d/: 削除対象 $n 件 ≥ ビルド $keep 件。異常の可能性があるため掃除を見送り"; continue
  fi
  echo "  $d/: $n 件を削除 → $(tr '\n' ' ' < "/tmp/_del_$d.txt")"
  tr '\n' '\0' < "/tmp/_del_$d.txt" | $SSH "$HOSTSSH" "cd $ROOT/$d && xargs -0 -r rm -f"
done

echo "▶ rsync api/（PHP API・秘密ファイル除外）— kichifu と共有(同一DB・同一ロジック)につき astro-kichifu/api を正にする"
# 旧 astro-admi/api/ は古いコピーで diaries 等が欠落 → 取込/配信の不整合の元。常に kichifu の api/ を配信する。
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" ../astro-kichifu/api/ "$DEST/api/"

echo "▶ rsync ctrl/（共有CMS）— api と同様 kichifu を正にする（astro-admi/ctrl は古いフォークで配信しない）"
# 旧 astro-admi/ctrl/ は古いコピー（preview編集/画像挿入/写メ日記管理/掲載店舗チェック等が欠落）。
# 両サイトとも DB shop_id で店舗分離するだけの同一コードなので、常に kichifu の ctrl/ を配信する。
rsync -avz --exclude='db-config.php' --exclude='deploy-config.php' --exclude='*.sample.php' \
  -e "$SSH" ../astro-kichifu/ctrl/ "$DEST/ctrl/"

echo "▶ rsync public/*.php（SSRフォールバック: postbuildでdistから削除されるため別途デプロイ）"
rsync -avz -e "$SSH" ../astro-kichifu/public/news-ssr.php ../astro-kichifu/public/diary-ssr.php ../astro-kichifu/public/girls-ssr.php ../astro-kichifu/public/_ssr-shell.php "$DEST/"

echo "▶ db-config.php（共有DB設定を kichifu から【常に】コピー＝同一DB強制）"
# 旧仕様は [ -f ] || cp（既存があればスキップ）だったが、それだとセットアップ時の別DB設定が残り
# admi2888 が kichifu と別DBを参照する事故が起きた（掲載状態がサイトごとに分岐）。常にコピーで統一。
$SSH "$HOSTSSH" 'cp /home/yobuho/kichifu.com/public_html/api/db-config.php '"$ROOT"'/api/db-config.php; ls -l '"$ROOT"'/api/db-config.php'

echo "▶ .htaccess の noindex(X-Robots-Tag) を本番用に除去（残存0でなければ abort＝本番noindex事故防止）"
$SSH "$HOSTSSH" 'set -e; sed -i "/X-Robots-Tag .*noindex/d" '"$ROOT"'/.htaccess; cnt=$(grep -c "X-Robots-Tag .*noindex" '"$ROOT"'/.htaccess || true); echo "残 noindex: $cnt"; [ "$cnt" = "0" ] || { echo "❌ noindexが残存。abort"; exit 1; }'

echo "▶ サーバーに残る旧 sitemap.xml を削除（rsync --delete無し運用のため手動。@astrojs/sitemap は sitemap-index.xml を出すので旧 sitemap.xml は不要・誤配信の元）"
$SSH "$HOSTSSH" 'rm -f '"$ROOT"'/sitemap.xml; echo "sitemap.xml 削除後: $(ls '"$ROOT"'/sitemap*.xml 2>/dev/null | tr "\n" " ")"'

echo "✓ admi2888.com 本番デプロイ完了（DNS反映＋SSL発行後に https://admi2888.com/ で公開）"
