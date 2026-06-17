# kichifu.com — アドミ since2009 吉祥寺デリヘル

吉祥寺デリヘル「アドミ」の公式サイト。yobuho / ylka とは独立した別プロジェクト（同じ sv6051 サーバーに同居）。

## Stack
- Frontend: Astro 5 (SSG) + Tailwind v4 (@tailwindcss/vite)
  - ※ Astro 6 + Tailwind v4 は Rolldown の `tsconfigPaths` エラーでビルド不可 → **Astro 5 固定**
- Backend: PHP 8 + MySQL(MariaDB)（動的機能を順次追加予定。現状はLP＋疎通確認のみ）
- Server: シンレンタルサーバー sv6051.wpx.ne.jp（162.43.96.7）/ DocRoot `/home/yobuho/kichifu.com/public_html/`
- CDN: Cloudflare Free（SSL Full、Zone ID `0804b2fd34bd6eda7f833ef80406ded9`、yobuho と同アカウント）
- Analytics: GA4 `G-50Q48YG34Z`（BaseLayout に組込）
- デザイン: ガーリーネオン(Y2K) — 黒#0a0510 / 紫紺#160a26 / ネオンピンク#ff4fd8 / ラベンダー#b78fff
  - フォント: Pacifico（筆記体ネオン）+ M PLUS Rounded 1c（丸ゴシック）
  - ⚠️ 青系は使わない（欲を抑制する色のため）。寒色はラベンダー＝紫で代替

## 構成（ハイブリッド: Astro 静的 + PHP）
```
astro-kichifu/
├── src/
│   ├── layouts/BaseLayout.astro     SEO一元管理（title/desc/OG/JSON-LD/GA/CSP相当）
│   ├── components/                  Header / Hero / Concept / FujohoBanners / Footer
│   ├── pages/index.astro            トップLP
│   └── styles/global.css            デザイントークン + ネオンアニメ
├── public/                          静的アセット（ビルドで dist/ に複製）
│   ├── .htaccess                    セキュリティ/キャッシュ/クリーンURL土台
│   ├── img/                         indexbg.jpg(コラージュ背景), enter.png(CTA), index-logo.png 等
│   ├── favicon.svg / robots.txt / sitemap.xml
├── api/                             PHP（dist には含めず、別rsyncで配信）
│   ├── db.php                       PDO接続シングルトン + uuid/json/json_out ヘルパー
│   ├── db-config.sample.php         テンプレ（コミットOK）
│   ├── db-config.php                ← 生成物。Secretsから作成、gitignore済み（コミット禁止）
│   └── health.php                   疎通確認 /api/health.php（PHP実行 + DB接続の確認）
├── astro.config.mjs                 output:'static', build.format:'file'
└── CLAUDE.md                        このファイル
```

## URL / ルーティング
- `output: 'static'` + `build.format: 'file'` → `src/pages/foo.astro` は `dist/foo.html`
- 複数ページ化したらクリーンURL（`/foo` → `foo.html`）を `public/.htaccess` の該当ブロックを有効化して対応

## デプロイ（GitHub Actions: `.github/workflows/deploy-kichifu.yml`）
- トリガー: `main` への push で `astro-kichifu/**` が変わった時のみ（yobuho の deploy.yml は `paths-ignore` で除外済み → 二重デプロイなし）。手動実行(workflow_dispatch)も可
- 流れ: `npm ci` → `astro build` → `api/db-config.php` を Secrets から生成 → **dist/ を rsync**（静的）→ **api/ を rsync**（PHP、`*.sample.php` は除外）→ Cloudflare パージ
- rsync は **`--delete` を使わない**（サーバー固有ファイル保全 / api と dist が別配信のため）
- 手動デプロイ（CI を使わない緊急時）:
  ```
  cd astro-kichifu && npm run build
  rsync -avz -e "ssh -p 10022 -i ~/.ssh/yobuho_deploy" dist/ yobuho@sv6051.wpx.ne.jp:/home/yobuho/kichifu.com/public_html/
  rsync -avz --exclude='*.sample.php' -e "ssh -p 10022 -i ~/.ssh/yobuho_deploy" api/ yobuho@sv6051.wpx.ne.jp:/home/yobuho/kichifu.com/public_html/api/
  # ※ 手動時は api/db-config.php を手で用意（コミットされない）
  ```

## 必要な GitHub Secrets（リポジトリ deri-hotel-navi）
- 既存を流用: `SSH_HOST` / `SSH_USERNAME` / `SSH_PRIVATE_KEY`（同一サーバー）/ `CLOUDFLARE_API_TOKEN`
  - ※ CLOUDFLARE_API_TOKEN が kichifu zone を含まない場合、パージは warning（HTMLはDYNAMICなので実害なし）
- kichifu 専用で新規追加が必要: `KICHIFU_DB_HOST` / `KICHIFU_DB_NAME` / `KICHIFU_DB_USER` / `KICHIFU_DB_PASS`

## DB
- kichifu 専用の MySQL DB をシンレンのサーバーパネルで作成（yobuho/ylka とは分離）。命名例 `yobuho_kichifu`
- 接続は `api/db.php` の `DB::conn()`（PDO, utf8mb4, JST `+09:00`）
- ローカルで PHP を動かす場合: `cp api/db-config.sample.php api/db-config.php` して値を入れる（または SSHトンネル + 本番DB）

## ローカル開発
- 静的プレビュー: `npm run dev`（Astro、PHPは動かない）/ `.claude/launch.json` にプレビュー設定（ローカル専用・gitignore）
- PHP含めて確認: `php -S localhost:8080`（dist 配信 + api 実行）など。PHP着手時に整備

## 規約・注意
- 訪問者向けテキストは日本語
- 18禁サイト: 入場/退出フロー（fujoho.jp の店舗ページへ遷移）を維持
- FujohoBanners の iframe 内部スタイルは口コミ風俗情報局の指定なので変更しない（外枠だけ装飾）
- 秘密情報（DB認証等）は db-config.php に集約し、コミットしない（Secrets→生成）

## Phase 2: 自前CMS（MINERVA相当の内製化）
admi2888 のバックエンドは外部委託CMS「MINERVA」(CakePHP+MDB, 画像S3)。kichifu用に自前CMSを作り、完成後 admi も載せ替えて内製化する。**最初から shop_id（店舗）+ girl_category（アドミ/GTF等ブランド）前提でDB設計**。yobuho の admin 資産（PHPセッション認証/CRUD API/画像アップロード）を流用。

### モジュール（=MINERVAの機能）
- Home: news / events / banners(top/bottom,sortable) / sliders(PC+SP画像,sortable) / hotel-areas / hotels
- schedules: 女性別 / カレンダー
- girls: girls / girl-diaries(写メ日記) / girl-categories / girl-profiles(質問テンプレ) / girl-options(プレイ項目)
- mail: mail-magazines / mail-users
- 管理情報: contacts / アクセス解析
- 設定: configs / cache / admins(theme/password/login) / dashboard widgets

### 主要テーブル（案・全テーブルに shop_id）
- `girls`: name,age,height,bust,cup,waist,hip,in_date,is_newgirl,is_trial,is_tel,is_inbound,is_genderless,image_1..N,is_display,girl_category_id,sort
- `girl_profiles`(質問: name,type[list/text],sort,多言語) / `girl_profile_values`(girl_id,profile_id,value)
- `girl_options`(name,is_basic,sort) / `girl_option_links`(girl_id,option_id)
- `girl_categories`(name,sort) — admiは アドミ=1 / GTF=2
- `news` / `events` / `banners`(type,url,image,is_display,sort) / `sliders`(url,image_pc,image_sp,is_display,sort)
- `hotel_areas` / `hotels` / `schedules`(girl_id,date,start,end) / `girl_diaries`
- `mail_magazines` / `mail_users` / `contacts` / `admins` / `configs`
- 共通カラム: is_display, sort, created, modified

### フロント連携
- フロントの `src/data/{girls,news}.ts`（暫定サンプル）を PHP API（MySQL）に置き換え。SEO重要ページ(girls/news)は PHP サーバーレンダリング
- 画像: **サーバー保存に決定**（/uploads/<entity>/<shop_id>/、`_upload.php` が GD→WebP縮小）。S3へは path 文字列差替で将来移行可

### 実装状況（admin/、2026-06-17）
- 基盤: `_lib.php`(セッション認証/CSRF/店舗切替/共通シェル/ナビ/ページャ) ・ `admin.css`(依存ゼロUI) ・ `login/logout/index(dashboard)`
- 画像: `_upload.php`(GD→WebP) ・ 非同期: `girl-actions.php`(女性) ・ `content-actions.php`(汎用toggle/delete/reorder, テーブルwhitelist) ・ `list.js`
- 実装済CRUD: **女性**(girls/girl-edit: 3サイズ/属性/オプション/プロフィール/複数画像/並べ替え) ・ **お知らせ**(news) ・ **バナー**(banners: top/bottom) ・ **スライダー**(sliders: PC/SP) ・ **出勤**(schedules: 女性別・日付一括)
- 未実装: events / hotels・hotel-areas / girl-diaries / マスタ管理(girl-categories・girl-profiles・girl-options) / mail-magazines・mail-users / contacts / courses / configs / admins、および **フロントのDB連携(PHP化)**
- デプロイ: deploy-kichifu.yml が admin/ も rsync。DB必須のため動作確認は DB作成後
