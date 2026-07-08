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

## 構成（Astro静的フロント + PHP API/CMS、全部シンレン同居）
公開ページは **Astro(SSG)** で配信、データ/管理は **シンレンPHP+MySQL** が同一オリジンで同居（CORS不要）。
**Cloudflare Pages は不採用**（検討したが ylka.jp と同じ「ローカル build → dist/ rsync」方式に決定）。
デザインの正は `public/site.css`（Tailwind不使用のスタンドアロン）。`src/styles/global.css` と旧 `src/components/{Header,Hero,Concept,FujohoBanners,Footer}.astro`・`src/layouts/{BaseLayout,SiteLayout}.astro`・`src/data/*.ts` は旧スキャフォルドで**未使用**。
```
astro-kichifu/
├── src/
│   ├── layouts/Site.astro           共通レイアウト（head/header/footer/offcanvas/予約モーダル, /site.css+/site.js）
│   ├── lib/config.ts                店舗定数 / ASSET_ORIGIN / 絵文字tagEmoji（_inc/shop.php と同期）
│   ├── lib/api.ts                   ビルド時fetch（getGirls/getGirl/getNews/getNewsItem）
│   ├── components/Fujoho.astro      口コミ風俗情報局バナー（_inc/fujoho.php 移植）
│   └── pages/                       index/top/system/howto/contacts/sitemap, news/index+[id], girls/index+[id]
├── public/                          静的アセット＋現行PHPページ(移行元・dist非配信)
│   ├── site.css / site.js           デザイン本体（Astroが /site.css /site.js で読込）
│   ├── .htaccess                    Astro静的配信ルーティング（下記「肝」）
│   ├── *.php / _inc/                旧PHPページ（postbuildでdist除去・サーバー残置はrollback用）
│   ├── img/ favicon.svg robots.txt sitemap.xml
├── api/                             PHP JSON API（girls.php/news.php/contact.php/health.php）+ db.php
│   └── db-config.php                生成物（Secrets由来、gitignore、サーバー保全＝rsync除外）
├── ctrl/                            PHP CMS（_lib.php / girls / news / banners / sliders / schedules、URL /ctrl/、旧admin/）
├── deploy.sh                        ★ローカルデプロイ（build→dist/ rsync＋api/admin、ylka方式）
├── astro.config.mjs                 output:'static', build.format:'file'
└── CLAUDE.md                        このファイル
```

## .htaccess の肝（public/.htaccess）
- `DirectoryIndex index.html index.php`（Astro優先 / index.php はフォールバック）
- **`DirectorySlash Off`**：`/girls` が `girls/`(詳細ディレクトリ)と衝突し mod_dir が `/girls/` へ301する事故を防ぐ（このサーバーは mod_dir が mod_rewrite より先に走る）
- `/girls`→`girls.html` / `/news`→`news.html` を明示マッピング、`/ctrl`→`/ctrl/` 301（旧 `/admin/` も `^admin(/.*)?$ → /ctrl$1` 301）、拡張子なし→`.html`
- `package.json` の `postbuild` が dist から `*.php`/`_inc` を除去（静的配信でPHPソース非露出）

## URL / ルーティング
- `output: 'static'` + `build.format: 'file'` → `src/pages/foo.astro` は `dist/foo.html`
- 複数ページ化したらクリーンURL（`/foo` → `foo.html`）を `public/.htaccess` の該当ブロックを有効化して対応

## デプロイ（kichifu/admi はローカル一本化・2026-06-27〜）
- **kichifu.com = ローカル `./deploy.sh` 一本化／admi2888.com = ローカル `./deploy-prod-admi2888.sh` 一本化**。push時の自動Actionsデプロイは廃止。
  - `deploy-kichifu.yml` は **`on: workflow_dispatch` のみ**（push自動デプロイ撤去＝二重デプロイ＆「未コミットの deploy.sh を Actions が旧mainで上書き」事故を根絶。緊急時のみ手動実行）。
  - `deploy.yml`(yobuho) の `paths-ignore` に `astro-kichifu/**` と `astro-admi/**` を追加＝admi/kichifu のpushで yobuho を誤デプロイしない。
  - yobuho.com は引き続き `deploy.yml`(Actions, push自動)＝CIで CACHE_HASH/?v= 置換するため Actions 必須（手動rsync不可）。
- 旧トリガー(`main` push で `astro-kichifu/**`)＝Actionsデプロイは廃止。GitHub→シンレンSSHが弾かれやすく Actions 自体が不安定だったのも理由。
- 流れ: `npm ci` → `astro build` → `api/db-config.php` を Secrets から生成 → **dist/ を rsync**（静的）→ **api/ を rsync**（PHP、`*.sample.php` は除外）→ Cloudflare パージ
- rsync は **`--delete` を使わない**（サーバー固有ファイル保全 / api と dist が別配信のため）
- 流れ(現行): Node→`npm ci && npm run build`(Astro+postbuild) → `dist/` rsync → `api/` rsync(db-config生成・*.sample.php除外) → `admin/` rsync → Cloudflareパージ。ssh-keyscan/rsyncはリトライ済
- **推奨デプロイ = ローカル `./deploy.sh`**（ylka方式、自分のSSHは安定。GitHubのIPがシンレンSSHに弾かれる時の確実な手段）:
  ```
  cd astro-kichifu && ./deploy.sh      # build → dist/ rsync ＋ api/(秘密除外) ＋ admin/
  ```
  ※ `db-config.php`/`deploy-config.php` はサーバー保全のため rsync 除外（既存を使う）

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

## 調査メモ: 「hero見出しが出力から消える」バグ（2026-06-20 真因確定）

### 結論（前提の訂正つき）
- **`public/_inc/shop.php:11` の `register_shutdown_function` は真因ではない**。これは fatal を `dirname(DOCUMENT_ROOT)/php_error.log`（= `~/kichifu.com/php_error.log`、Web非公開）へ記録するだけの**診断ロガー**で、`ob_*` も `echo` も一切せず**出力を加工しない**＝見出しを消すことは構造的に不可能。
- しかも `api/girls.php` は `shop.php` を **include していない**（`db.php` のみ）＋全体が `try { } catch (Throwable $e)` で 500+JSON を返すため、**API/Astro ビルド経路ではこの shutdown ロガーは発火すらしない**。発火するのは `_inc/shop.php` を require する旧 `public/*.php`（index.php/top.php 等）だけで、それらは `postbuild`（`find dist -name '*.php' -delete`）で **dist から除去＝ライブ非配信**。よって「ライブで hero 見出しが消える」現象の説明にはならない。

### 現状の実測（2026-06-20）
- `api/girls.php?action=detail` を id 1〜124 全件プローブ → **124/124 が http=200・有効な `name` あり**（null/404/500 なし）。
- ライブ配信 HTML の hero 見出しも全て存在: `/`→h1`Admi ア ド ミ 吉祥寺デリヘル` / `/top`→h1`ハズレなしの素人娘を、あなたのもとへ ♡` / `/girls/1`→h1`りあ24歳`。
- reduce-motion による視覚消失も `public/site.css:1591-1594` で `.reveal{opacity:1!important}` 強制済みで対策済み。
- → **現時点でこのバグは再現していない。**

### 真因クラスと対策（2026-06-20 修正済み）
- 唯一の構造的弱点は **`src/pages/girls/[id].astro:12` の `getGirl` null 未ガード**だった。`getGirl()` は `d.girl ?? null` を返し `getJson()` は非200で throw（`src/lib/api.ts`）→ detail が **404/500/girl:null** を返す id が getStaticPaths に1件でも混ざると、直後の `g.name` 参照で `TypeError` → **その詳細ページのビルドがクラッシュ**し名前 hero が出力から欠落する。detail 500 の前科あり（`da6bf030`=`girl_option_links.shop_id` 無し / `3c88a730`=存在しない `alt` 列）。
- 対策（適用済み）:
  - `src/lib/api.ts` の `getGirl`: detail 失敗時に **throw せず `null` を返す**（`try/catch` + id付き `console.warn`）。1件の不良が**サイト全体のビルドを巻き込まない**。
  - `src/pages/girls/[id].astro`: `const g = await getGirl(id)` 直後に `if (!g) { console.warn(...); return Astro.redirect('/girls'); }`。不良 girl はビルドを止めず一覧へ退避し、どの id で落ちたかビルドログに残る。
  - 検証: `npm run build` 成功（132ページ・リダイレクト警告0）／`dist/girls/*.html` 124件生成／リダイレクト退避0件／`girl-detail-name` は各ページ h1 のみ1回・名前正常。

### 二重名前（2026-06-20 解消済み）
- 右カラムにあった重複 `<p class="girl-detail-name">` を削除し、写真上の `<h1 class="girl-detail-name">`（`[id].astro:57`）に一本化。dist 検証で `<p class="girl-detail-name">` 残存0を確認。直近コミット `0db50f6e`（名前を写真上に大きく中央配置）の意図に沿う。

## 実装履歴（2026-06-20〜22）— girlsカード強化・出勤取込・/ctrl化

### girls 表示強化
- **属性アイコン**: `public/img/flag-{newgirl,machiawase,inbound,genderless,tel}.png`（128px）。詳細(`[id].astro`)=名前下に横並び、一覧/top=写真右上に縦並び（`.girl-card-flags`/`.girl-card-flag-icon`、`right:-12px`で約1/3はみ出し。`.girl-card`を`overflow:visible`にし角丸は`.girl-card-img-wrap`へ移譲）。
- **新人判定**: `isNewcomer(in_date)`（入店3ヶ月未満、`src/lib/config.ts`）に統一。手動フラグ `is_newgirl` は不使用（top新人セクション / 一覧の新人アイコン / 絞り込み `data-new` すべて in_date 基準）。
- **共通カード `src/components/GirlCardItem.astro`**: top と /girls で共用（`data-*`属性で `public/girls-filter.js` の絞り込み/並び替えと結合）。旧 `src/components/site/GirlCard.astro` は未使用。

### 出勤取り込み（admi2888 → kichifu）※詳細は memory [[project_kichifu_schedule_import]]
- **営業日は朝5時区切り**（営業 10:00〜翌5:00。0:00〜4:59 は前日が当日。`time()-5*3600` を 配信API/取込CLI起点/日付帯 すべてに適用）。日付帯は0除去表示（「6月21日（日）」）。
- ①取込CLI `api/import-admi-schedules.php`（cron専用ガード, `admi2888.com/schedules?date=` を週7日, `//li[p[@class="name"]]` で出勤抽出, name照合で girl_id, admi正で同期削除, `--dry-run`/`--days=N`）
- ②配信API `api/schedules.php`（`?action=today`→`{date,work:{id:{start,end}}}` / `?action=range`）
- ③小バッジ `public/schedule-badge.js`（/girls・top新人カードの**名前の上**「本日HH:MM〜翌HH:MM」=`.girl-card-info`先頭に`insertBefore`, `#schedule-grid`除外。旧=写真左上だが右上属性アイコン干渉のため2026-06-22に名前の上へ移動、`.girl-card-shukkin`は通常フローのピル。写真左上に戻さない）
- ④出勤ページ `/schedule`（`src/pages/schedule.astro`）＋ **top ヒーロー直下「本日の出勤」セクション**: 全girlsを`GirlCardItem`で`#schedule-grid`にhidden配置→`public/schedule-page.js`が本日出勤のみ表示＋出勤時間バッジ `.girl-card-worktime`（写真の下=サイズの下・タグの上, 時計絵文字なし）＋日付帯 `.schedule-date-band`
- cron: sv6051 crontab `0 */3 * * * cd .../kichifu.com/public_html && /usr/bin/php api/import-admi-schedules.php`（yobuho cronと同居）
- schedules テーブル: girl_id, work_date, start/end_time, status('work'/'off'/'undecided'), UNIQUE(girl_id,work_date)

### 管理画面 /admin/ → /ctrl/（ylka統一）
- ディレクトリ `admin/` → `ctrl/`（git mv）＋内部 `/admin/` パス参照を全て `/ctrl/` に置換。`deploy.sh`・`public/.htaccess`・`.github/workflows/deploy-kichifu.yml` も ctrl/ に更新。
- 旧 `/admin/` は .htaccess で `^admin(/.*)?$ → /ctrl$1` 301リダイレクト。**サーバー上の旧 admin/ 実体は手動 rm 予定**（rsyncは--delete無し）。
- DB接続は `ctrl/_lib.php` の `require __DIR__.'/../api/db.php'`（相対のためリネーム後も無事）。
- **管理画面はAstro化しない**: 認証/CRUD/画像アップロード等の動的処理はSSG不可。Astro SSRはNode常駐が必要だがシンレンはPHP/MySQL専用（=シンレンが唯一できないのがSSR）。**公開=Astro(SSG) / 管理=PHP** が最適解。

### ヘッダー「ご予約」ボタン
- `.reserve-btn` を padding `2px 18px→13px`・font `.8125rem→.75rem` に詰めてロゴ高さに寄せた。`.reserve-stack`（営業時間表記 `.reserve-hours` + ボタンの縦並び）。

### バナー（管理画面/ctrl → top ヒーロー）
- `banners` テーブル（type top/bottom, title, url, image, is_display, sort。画像 `/uploads/banners/{shop}/`）。配信API `api/banners.php?type=top`、`getBanners()`(api.ts) がビルド時取得（try/catchで未配信時も空でビルド継続）。
- **top ヒーロー＝スライダー** `hero-slider`（2026-06-25〜 **`sliders`テーブル駆動に移行**。旧 banners(type=top) は廃止）: `api/sliders.php`＋`getSliders()`(api.ts) がビルド時取得、`/ctrl`のスライダー(slider-edit.php)で管理（PC=image_pc/SP=image_sp、SPは`<picture> source media=max-width:640px`）。横長スライダー（自動5秒・‹›矢印・ドット、`public/banner-slider.js`）。0件時のみロゴヒーローにフォールバック。**バナー(type=top)は廃止＝CTRLバナー管理は下部のみ運用**（既存上部4枚はslidersへ移行済）。
- **スライダーは表示中バナーの高さに自動調整**（banner-slider.js `setHeight` + `.hero-slider{transition:height}` + track `align-items:flex-start`）＝短いバナー下の余白解消。
- バナーは girls/news と同じ **ビルド時取得(SSG)→変更はデプロイで反映**。

### 最新情報の動的化（デプロイ不要で自動更新）
- top最新情報は **SSR初期表示(getNews,SEO維持) ＋ `public/news-latest.js` が `news.php` 最新4件で `#top-news-list` を上書き**。ニュース追加後デプロイ不要で反映。
- **更新頻度**: 最新情報=ページ読込毎 / 出勤=cron3h＋ページ読込毎 / バナー=デプロイ時。

### 全リンク _self（kichifuルール）
- kichifu は外部含め **全リンク `target="_self"`（同タブ）**。`_extTarget`不使用・`_blank`禁止。例外は `Fujoho.astro` の `target="_top"`（口コミ局仕様）。memory [[feedback_kichifu_links_self]]。

### 出勤の並び順・口コミ局バナー・セクション余白
- 出勤は **start_time 昇順（早い順）**表示（schedule-page.js が DOM並べ替え。営業日5時区切りで深夜は遅い扱い `if(h<5)h+=24`）。
- 口コミ局バナー(Fujoho)は **スマホで横1行（横スクロール＋スナップ）**: `.fujoho-grid` を `flex-wrap:nowrap`+`overflow-x:auto`、スワイプヒント `.fujoho-scroll-hint`＋ピンクスクロールバー＋左揃えpeek。**iframe内部は不変**（口コミ局仕様）。
- top余白統一: `.top-news-section`/`.top-girls-section`/`.fujoho-section` の padding を 38px→10px（section-topper上の空白を全セクションで揃える）。

### top下部バナーエリア（料金/LINE固定カード廃止、2026-06-22）
- **料金システム/LINE の固定カード(`top-banner-section`)を廃止** → 管理画面 /ctrl の**下部バナー(type=bottom)で一元管理**するバナーエリアに置換。`getBanners('bottom')`(api.ts) でビルド時取得。配置: 本日の出勤 → `bottom-banner-section` → フッター。
- **画像未設定(image空)は自動除外**: `getBanners('top'/'bottom')` を `.filter(b => b.image)` で囲み、壊れた `<img src="">` を防止。画像をアップすれば次デプロイで自動表示（画像なしは恒久スキップ）。
- レイアウト: **1行ずつ(1列縦積み)** `.bottom-banner-grid{grid-template-columns:1fr;max-width:600px;gap:14px}`。横長バナーを大きく見せる。
- 余白: 最後のバナー下〜フッター区切り線(`footer-top-divider`)を**バナー間gapと同じ14px**に統一（`.bottom-banner-section{padding:8px 0 14px}`）。プレビュー実測(`gap_last_to_divider===gap_between_banners`)で確認。
- 旧 `.top-banner-section`/`.top-banner-card` CSSは未使用のまま残置（害なし・掃除可）。
- ⚠️ **デプロイ事故の教訓**: `deploy.sh`(ローカルビルド)の変更を未コミット放置すると、別コミットの push→GitHub Actions が**古い main でライブを上書き**する（実際に下部バナーが消えた）。フロント変更は **commit + push と deploy.sh をセット**で。memory [[feedback_kichifu_deploy_commit_before_actions]]

### topスライダー操作の外出し・girlsカードY2K・最新情報中段・Fujoho操作（2026-06-22）
- **ヒーロースライダー操作の外出し**: 矢印/ドットを画像オーバーレイ→画像の下(✦⋆♡ラインの上)に横並び移設(`.hero-slider-controls`)。`data-slider`を`hero-slider-section`へ移し、高さ自動調整(banner-slider.js)は画像枠`.hero-slider`(imgWrap)に限定。
- **girlsカードY2K化**: `.girl-card-info`の名前/サイズ背景を黒グラデ→明るいピンク/パープル(`rgba(255,79,216,.95)`→`rgba(160,110,235,.86)`)。年齢を白。`.girl-card`縁をネオン強化(border1.5px+ラベンダーリング+ピンクglow)。「黒背景で怪しく見える」解消。
- **最新情報サムネ中段揃え**: `.news-item{align-items:center}`。
- **Fujoho操作**: 口コミ局3カード横スクロールに画像下の矢印+ドット(`public/fujoho-slider.js`、`.fujoho-controls`/`-arrow`/`-dot`)。スマホのみ(PCは3枚全表示で不要)。iframe内部不変、外側スクロール位置のみ操作。`Fujoho.astro`に`data-fujoho-slider`+ver付きscript。
- **ヘッダーロゴPacifico光学補正**: line box中心ズレを`transform:translateY(0.0425em)`で補正し3段ロゴと中央揃え(ユーザー実装 9ff9b9ae)。
- ⚠️ **並行編集時の部分デプロイ**: 同一ファイル(site.css)に自分とユーザーの未コミット変更が混在する場合 → `cp`で全体退避→`git checkout HEAD -- <file>`→自分の変更だけ再Edit→commit+deploy+push→`cp`で相手分を書き戻し。相手の編集を巻き込まず自分の変更だけライブ反映できる。memory [[feedback_kichifu_partial_deploy_mixed_file]]

### indexヒーロー鮮明化・全ページ共通要素・虹区切り線・出勤時刻整形（2026-06-22〜24）
- **indexヒーロー「✦ 吉祥寺 ・ SINCE 2009 ✦」鮮明化**: ラベンダー(`neon-lav-glow`)→白文字+濃い黒シャドウ(`text-shadow:0 1px 6px rgba(0,0,0,.95)...`)で写真コラージュ背景に埋もれない様に(`index.astro`、コミット 31081304)。
- **indexエンターボタンのリンク先**: `FUJOHO.shop`(口コミ局)→`/top` に変更(`index.astro`、コミット 2241559d)。kichifu入場は自サイトtopへ。
- **ヘッダーadmiロゴ左マージン詰め**: `.site-header-inner` の padding `0 14px`→`0 14px 0 6px`(`site.css`、コミット 83e5b782)。
- **ハンバーガーメニュー フッター電話2行化**: `.offcanvas-tel-link` に `<br/>` 追加で「📞 090-1045-9155 / (受付 10:00〜翌5:00)」2行表示、カッコは半角(`Site.astro`、コミット 1b001978)。
- **フッター上の区切り線(全ページ共通)**: `.footer-top-divider` を Site.astro footer 先頭に配置(全ページ共通)。後に虹グラデ化(下記)。
- **虹色アニメ区切り線**: `.footer-top-divider`/`.holo-divider`/`.section-topper-line` を虹グラデ(`#ff4fd8→#ffb347→#7dff79→#79d4ff→#b78fff`)+`divider-glint`(白いglintスイープ)+`divider-flicker`アニメ化。height 3px。⚠️虹に`#79d4ff`(水色系)を含むが**ユーザー自身の意図的な選択**なので青系禁止ルールの例外(勝手にrevertしない)。`@media(prefers-reduced-motion:reduce)`でもアニメ維持(ブランド点滅方針 [[feedback_reduced_motion_brand_flicker]])。`.section-topper-stars`もreduce-motionで`topper-twinkle`維持。
- **全ページ共通「← 前へ戻る」ボタン**: `Site.astro` の `<slot/>`〜`<footer>`間に `.back-bar`>`.back-bar-btn`(`onclick="history.back()"`)。ピル型ラベンダー枠。
- **出勤バッジ時刻の先頭ゼロ除去**: `schedule-badge.js`/`schedule-page.js` に `fmtT(t)=t.replace(/^0/,'')` 追加(例 `09:00→9:00`、`翌05:00→翌5:00`)。
- コミット: 2158c118/76e89781(虹線・戻るボタン・時刻整形をまとめて)。⚠️ デプロイ済み変更が未コミットだとActionsが上書きする為、ライブ反映後は必ずコミット([[feedback_kichifu_deploy_commit_before_actions]])。

### index背景アニメ・ゲート簡素化・SEOコンセプト本文・料金システム刷新（2026-06-24）
※ 全て **biyobu.com(astro-admi=立川アドミ) を参照して吉祥寺ローカライズ**。admi2888.com(外部MINERVA)は見ない（memory [[feedback_admi_reference_is_biyobu_not_admi2888]]）。
- **indexヒーロー背景をKen Burns風パン化**: `site.css .hero-bg` を背景画像 `background-size:cover,640%` ＋ `@keyframes hero-pan`(四隅を48sで巡回) に。`background-attachment:scroll`(fixedはiOSで%が効かない)。reduce-motionでも90sで継続(ブランド演出維持)。astro-adminの実装を黒地・紫グラデmultiplyのまま移植。
- **indexゲートのみハンバーガー/戻る/offcanvas非表示**: `Site.astro` に `gate?:boolean` prop追加→`{!gate && ...}` で `.burger`/`.back-bar`/offcanvasを出し分け。`index.astro` で `<Site gate={true}>`。他ページ(top/girls等)は従来通り表示。
- **indexゲートにSEOコンセプト本文(吉祥寺版)**: 立川 `index.astro` の `index-concept`(h2+5段落)を移植。`/`は最初にクロールされるためゲートにキーワード本文を置く設計。立川→吉祥寺/since2002→2009/24年→`yearsInBusiness`動的(今年-since)/「東京本店」除外(fullName準拠)/「西東京最大の風俗楽園」→「中央線屈指の人気タウン」。SEO地域KW: 吉祥寺・武蔵野市・三鷹・西荻窪・中央線。CSSは黒地対応(h2=neon-pink/p=text-soft #f6ecff)。
- **/system コース料金をbiyobu(立川)と同一に刷新**(金額は元々一致:60→16,500/90→22,000/120→27,500/150→33,000/お泊り¥88,000):
  - 2グループ(初めて×ホテル/2回目以降×自宅)→ **立川式1グループに統合**(ユーザー承認済)。指名料/延長/オプション/キャンセルは元々同一。
  - **割引OFFバッジ**(¥X OFF)を追加。`site.css` に `price-off-badge`/`price-popular-badge`/`price-row-popular` を移植する際、立川の青系(`#60a5fa`等)→**ネオンピンク/ラベンダー/金〜ローズに変換**(青不使用 [[feedback_no_blue_color]])。
  - **120分「人気No.1」は削除**(`popular`フラグ撤去、ユーザー指示)。**60分「吉祥寺駅周辺ホテル限定」注記も削除**(ユーザー指示)。
  - **割引感強調**: `price-amount-line` で通常価格(was)を現価格(now)の左に横並び。was=`.75rem→1.25rem`拡大＋**白文字#fff**＋太いローズ赤取消線(`#ff5b8f`/3px)、now=`1.375→1.5rem`ネオンピンク。「元値→安い」を一目で。
  - お泊り表記「24時〜翌10時」→「**0時〜翌10時(最大10時間)**」(cond/desc 2箇所、括弧半角)。
  - 交通費(zones)は **吉祥寺の現状値を維持**(ユーザー「交通費はそのまま」)。立川の値混入なしを本番確認。
- コミット: 0e895914(背景/ゲート)・67a4e8af(コンセプト)・1b9844be(料金統合)・00b9f58b(60分注記削除)・c7e61dac(人気No.1削除)・8eefe40d(割引強調)・7b2f2321(元値白)・38dc239f(お泊り0時)。

## 媒体更新ツール構想（admi→kichifu→各媒体、別セクションで立ち上げ予定・2026-06-24）
※ Phase2(自前CMS)の延長。**媒体更新ツールは別セクション(別ターミナル)で進める**。詳細は memory [[project_admi_media_sync_tool]]
- **構想**: admi2888(メイン＝吉祥寺アドミ)を母艦に女性/出勤/写メ日記/すぐ姫を一元管理→複数媒体(口コミ情報局/シティヘブン/駅ちか/風俗じゃぱん)へ自動配信する"自前Mr.Venrey"。kichifuはadmiミラー。
- **当面のゴール**: admiの口コミ情報局(id=57,すぐ姫登録済)→kichifuの口コミ情報局(id=53179,**別アカウント**,すぐ姫404未登録)へ同期。
- **技術調査**: 口コミ情報局の店舗管理の実体=**Mr.Venrey(mrvenrey.jp)=Angular SPA + OAuth2 REST API**(main-*.jsにaccess_token/Authorization/expires_in/V_API_URL_BLOBSASSES)。店舗管理(shp_*)はログイン必須でWebFetch不可、公開ページのみ閲覧可。公式API/連携は未発見。
- **既知の事実**: `shop_info_notime_girl&id=57`=admiすぐ姫(みりあ等) / `id=53179`=404(kichifu未登録) / `config.ts fujohoId:'53179'`→**topのすぐヒメiframeは404で壊れている**(写メ日記は表示)。
- **肝(課題)**: ①女の子idマッピング(admiとkichifuは別アカウントでid違う→名前で対応表) ②2アカウントのOAuth2トークン保持・更新(expires_in) ③規約(非公式API自動利用=アカウント停止リスク。公式可否を問い合わせ推奨) ④保守。
- **次の一手**: admiのMr.Venreyで「すぐ姫」更新時の **Copy as cURL** → API URL/トークン渡し方/payload/girl_id体系を確定 → admi→kichifu すぐ姫1本同期のPoC → 横展開(女性登録/出勤、他媒体はアダプター方式)。

## 実装履歴（2026-06-25〜26）— admi2888本番化・写メ日記取込・最新情報交互表示・CTRL強化

### admi2888.com 本番稼働（biyobu→admi2888 移行完了）
- `deploy-prod-admi2888.sh`（PUBLIC_PROD=1: robots index/GA有効、canonical=admi2888.com）で astro-admi を admi2888.com DocRoot へ配信。`/ctrl/` も配置（kichifuと同一CMS、DBのshop_idで店舗分離）。
- **Cloudflare 経由化**: NS→cosmin/galilea(yobuho同アカ)、SSL=Full、Always Use HTTPS ON。**Xアクセラレータ=両サイトともOFF**（2026-06-28、kichifu/admi2888 とも。no-store を無視して動的PHP(news-ssr/api)を数十秒〜数分キャッシュし「お知らせ編集・予約投稿の自動公開がHPに反映されない」原因になるため。当初ドキュメントは admi=OFF/kichifu=Ver.2 だったが実態は両方ON相当→両方OFF＋キャッシュ削除で即反映に。詳細 memory feedback_kichifu_news_detail_static_stale）。
- **api/ は astro-kichifu/api を共有**: 旧 astro-admi/api は古いコピー(diaries欠落)だったため deploy-prod の rsync 元を `../astro-kichifu/api/` に変更。両サイト同一DB(yobuho_kichifu)・同一ロジック。memory [[feedback_admi2888_api_shared_with_kichifu]]。

### 写メ日記取込 → 最新情報に「お知らせ⇄写メ日記」交互表示（両サイト）
- `api/import-fujoho-diary.php`（cron `*/30`）: fujoho.jp 写メ日記(id=57=立川アドミ)を公開スクレイプ→`girl_diaries`(source/source_id/girl_name/link_url 追加, UNIQUE)に冪等取込。両店(shop1/2)共有。女の子名で girls マッチ→girl_id。
- **掲載時刻**: 一覧は相対(N時間前)で不正確→**新規のみ個別ページ(shop_girl_blog&id=)の絶対時刻(YYYY/MM/DD HH:MM)と本文フル(sub_blog_post_text)を取得**。既存は posted_at固定(upsert除外)。
- **オフィシャル日記ページ**: `/diary/[id].astro`(SSG, getDiaries(60)) + `diary-ssr.php`(新規分の動的フォールバック, .htaccess `^diary/([0-9]+)→diary-ssr`)。写メ日記クリックでfujohoでなく自サイトの日記詳細(本文フル/画像/プロフ導線)へ。
- **配信/表示**: news.php に `action=diaries`、lib/api.ts `getDiaries()`。top.astro/news-latest.js で **交互配置**(news[0],diary[0],news[1]…上位6)。写メ日記=ピンクバッジ。
- **日付**: お知らせ=「2026年6月25日(木) 0:53」/ 写メ日記=「写メ日記 6月25日(木) 20:30」(バッジ先頭・年なしでスマホ1行)。本文抜粋は6件で長いため削除(タイトル中心)。サムネは3:4縦長に統一(kichifuも108x144に, 女の子写真の顔切れ回避)。
- ⚠️ 非公式スクレイプ＋本文/画像転載＝規約リスク(ユーザー承認済「自己責任」)。控えめアクセス(30分/1ページ/個別は新規のみ)。memory [[project_kichifu_fujoho_diary_import]]。

### CTRL(/ctrl) 強化
- お知らせ/女の子コメントの**プレビュー編集**(contenteditable, ソース⇄プレビュー双方向同期) + **カーソル位置への画像挿入**(upload-image.php)。
- お知らせサムネを**女の子の登録画像から選択**(girl-actions.php action=girl-images)+並び替え(出勤頻度/入店順)。サムネのリンク先=ガールズ優先。
- **店舗別掲載トグル**(owner=立川/吉祥寺2トグル, staff=自店1, girl-actions.php toggle に shop指定+越境403)。
- **CTRL専用ファビコン**(ティール「A」+歯車, フロントのピンクと区別)。`admin.css` の `?v=` を **filemtime化**(固定?v=1だと更新が反映されない)。

### バグ修正（重要）
- **__SHOP_ID は head 必須**: news-latest.js/girl-visibility.js が `window.__SHOP_ID||2` で shop判定。設定scriptが body末尾(slot後)だと top.astroのnews-latest.js(slot内)が先に実行→undefined→default shop2→admi2888で kichifuの番号(112)を使い `/news/112` が404(シークレットでも再現)。`</head>` 直前へ移動で解決。
- **FPM枯渇**: CIビルドが girls/[id] 124件並列fetch→FPMが瞬間枯渇し空レスポンス(200+0byte)→getNews/getGirls(catch無)がthrowしビルド失敗。getJsonに空時リトライ4回追加。
- お知らせ日付の年月日曜日化・先頭ゼロ除去(04:00→4:00, 06月→6月)。news-ssr.php(news/[id]未生成時の動的フォールバック, shop_idはホスト判定)。
- **予約投稿フィルタはお知らせ(news)にも必須**: 写メ日記(diaries)だけ `posted_at <= NOW()` を入れていたが、お知らせ(news)も予約投稿(未来時刻)があり最新情報に先行表示されていた。`api/news.php` の `action=list` と `public/news-ssr.php`(詳細直アクセス)の WHERE に `AND posted_at <= NOW()` 追加。診断のコツ＝**「写メ日記」バッジの有無で news/diary を判別**（年表示あり＋バッジなし＝news側）。両サイト共有apiなので kichifu deploy.sh + admi deploy-prod-admi2888.sh の両方に反映必要。

### 最新情報のレイアウト微調整（2026-06-26）
- **admi2888 Fujoho 3カラム順序変更**: `src/components/Fujoho.astro` の `banners` 配列を **すぐヒメ！→ヒメ日記→好評価！** に並べ替え（旧=ヒメ日記→好評価→すぐヒメ）。iframe内部は不変、配列順のみ。astro-admi のみ（kichifuの fujohoId は別店舗）。
- **最新情報カードの高さコンパクト化（両サイト）**: サムネ3:4(80×107/108×144)がカード高さを支配し日付+2行テキスト(≈63px)の上下に余白→ **4:5縦長に圧縮(モバイル64×80 / PC84×104)** + padding 12×16→10×14 + gap 16→14。`.news-thumb`/`.news-no-thumb`(site.css) と img の `width`/`height`属性(news-latest.js/top.astro、CLS用)を 64×80 に統一。縦長感は維持、カード高さ≈日付+2行+少し余白。

### お知らせの2店舗掲載チェック・ctrl共有化・biyobu.com転用（2026-06-26）
- **お知らせ(news)に「掲載店舗」2チェック追加**（`ctrl/news-edit.php`、owner時・デフォ両店ON）。girls の掲載店舗チェックと同作法。news は1店舗1行なので、両店の行を `source_id` で紐付け（手動投稿=synthetic `'m…'` / 取込=数値ID）、チェック店舗に upsert・外した店舗は行削除。staff は自店固定。編集時のチェック初期状態は同 source_id を持つ店舗（旧 source_id NULL の手動投稿は現在店舗のみ→もう片方を手動ONで両店化）。
  - 根本原因: 手動投稿は `source_id=NULL` でミラー対象外だったため kichifu に出ず（8:30お知らせが admi のみだった）。「写メ日記」バッジ無し＋年表示＝news側の漏れ。
- **ミラー同期を取込のみに限定**（`api/import-admi-news.php`）: `WHERE shop_id=1 AND source_id REGEXP '^[0-9]+$'`。手動投稿はチェックで制御、NULL行の重複生成バグも解消。
- **ctrl も api と同様 kichifu を正に共有化**（`deploy-prod-admi2888.sh` の ctrl rsync 元を `ctrl/`→`../astro-kichifu/ctrl/`）。admi/ctrl は古いフォークで preview編集/画像挿入/写メ日記管理/掲載店舗チェックが全欠落だった。**ctrl コードの正＝`astro-kichifu/ctrl/`、runtime CMS＝admi2888.com/ctrl のみ使用**（ユーザー指示・NS切替で admi2888本番化）。[[feedback_admi2888_api_shared_with_kichifu]] に追記。
- **biyobu.com を admi ステージングから別サイトへ転用**: biyobu.com と admi2888.com は同一DB・同 shop_id=1 でデータ共有（DB上に biyobu専用データは無い＝DB削除は admi2888本番も消える）。重複の正体はサイトURLが2つ生きていたこと。biyobu.com/public_html の admi配信を `_bak_admi_20260626/`（DocRoot外・可逆）へ退避し空に。`deploy-staging.sh`(admi→biyobu)は誤再配信防止で `exit 1` ガード。[[feedback_admi_reference_is_biyobu_not_admi2888]] 更新。

### サイトマップ整備・admi2888 SEO移行（2026-06-26）
- **両サイトの sitemap が壊れていた**: `public/sitemap.xml` が `kichifu.com` の1URLだけのstub（admi/kichifu md5一致）、robots の Sitemap行も kichifu。girls(122)/news/diary が0件。→ **`@astrojs/sitemap` を両 astro.config に導入**し全ページ自動サイトマップ化（`sitemap-index.xml`+`sitemap-0.xml`、各221URL、`filter` で /sitemap HTML除外）。`public/sitemap.xml` stub削除、robots を `/sitemap-index.xml`＋`/ctrl//api/` Disallow に修正。**astro-admi の `site` は旧 `biyobu.com`→`admi2888.com` に修正**（@astrojs/sitemap の基準）。
- **旧 sitemap.xml は rsync(--delete無し)で消えない** → deploy スクリプトに `ssh rm -f .../sitemap.xml` を恒久追加（admi=deploy-prod、kichifu=deploy.sh）。
- **robots/sitemap は Cloudflare が ~4h キャッシュ**（実測 max-age=14400 HIT）。ローカルdeployにCFパージ無し → デプロイ後はCFダッシュボードでパージ or CF Cache Ruleで /robots.txt・/sitemap*.xml をキャッシュ無効化（恒久策）。
- **admi2888 SEO実状（ワークフロー実機検証）**: noindex解除済・canonical自己参照・GA4 OK・CF経由。**同一ドメイン移行ゆえアドレス変更ツール不要**。og:image が404だった→indexbg.jpgから1200×630生成し実体化（両サイト）。deploy-prod の noindex除去を「残存0でなければabort」に堅牢化。
- **写メ日記 /diary を noindex化（両サイト・ユーザー判断）**: fujoho原典転載＝index価値薄/重複/著作権リスク。Site.astro に `noindex?` prop 追加（`noindex,follow`）、diary/[id].astro で `noindex={true}`、**sitemap filter からも /diary 除外**（221→171URL、noindexをsitemapに残さない）。最新情報セクションの回遊は維持。
- **LocalBusiness JSON-LD 追加（両サイト・ユーザー判断）**: Site.astro head に店舗別 JSON-LD（admi=立川/東京都・kichifu=吉祥寺/武蔵野市）。
- **旧URL301は不要（ユーザー判断）**: 旧admi2888(MINERVA)は検索流入ほぼ無し→301しない（旧形式URLは実機で全404）。
- **旧業者(admi2002fantasy@gmail.com)のGSC所有権をロックアウト**: Site.astro:56 の `google-site-verification=ndAzGRDjDiq5…` メタタグ削除＋GSCでトークン削除。現所有権はドメインプロパティのDNS TXTで認証（メタタグ不要）。yobuho側の別トークン(nQWgZIeYu0…)は残す。
- **【完了】GSC/CF/Bing 運用作業（両サイト・2026-06-26）**: ①GSCドメインプロパティ化(DNS TXT、admi2888はCloudflare自動連携TXT、kichifuも完了) ②sitemap-index.xml 送信(成功・171URL、旧/sitemap.xml=MINERVAの107pは削除) ③主要ページURL検査→インデックス要求 ④**www→apex 301**(CF Redirect Rule「WWW to root」テンプレ、www DNSは既にプロキシ済み=162.43.96.7、実機で301+パス/クエリ保持確認) ⑤**CF Cache Rule**で `/robots.txt`・`/sitemap*` をBypass cache(cf-cache HIT→DYNAMIC、今後パージ不要) ⑥Bing GSCインポート。**両サイトとも完了＝再提案不要**。残るは経過観察(GSCカバレッジ1〜2週)とGA4↔GSCリンク(任意)のみ。詳細 [[feedback_astro_sitemap_setup]]。

### memory 追加
[[feedback_admi2888_api_shared_with_kichifu]] / [[feedback_admi2888_xaccelerator_api_cache]] / [[feedback_ctrl_asset_cache_buster_mtime]] / [[feedback_ctrl_image_origin_kichifu]] / [[feedback_yobuho_deploy_rsync_retry]] / [[project_kichifu_fujoho_diary_import]] / [[feedback_astro_sitemap_setup]]

## 実装履歴（2026-06-26 後半）— 画像オリジンをadmi2888主体に移行・kichifu/ctrl廃止

### お知らせ画像の表示バグ修正（admi2888で画像が出ない／PCで切れる）
- **SSGお知らせ詳細 `news/[id].astro`** がサムネを `src={it.thumb}`（相対 `/uploads/`）で出力していた→kichifu同一オリジンでは表示できるがadmi2888でSSGビルドされると404。一覧(top/news index)は `asset()` 済みだったが詳細だけ漏れ。`asset()` 経由＋本文の `/uploads/`・旧kichifu絶対URLを描画時正規化に修正（両プロジェクト）。`news-ssr.php` も同様＋ `/site.css?v=filemtime` キャッシュバスター追加（裸 `/site.css` は1yr immutable で旧CSSが出続けた）。
- `.news-detail-thumb` の `object-fit:cover;max-height:400px`（PCで縦長写真の頭/脚が切れる）→ `max-height:560px;width/height:auto;中央` に統一。

### 画像/uploads の正を kichifu.com → admi2888.com に移行（admi2888主体）※詳細 [[feedback_admi2888_canonical_asset_origin]]
- 物理: admi2888.com/public_html/uploads を正の実体(415ファイル copy)、**kichifu.com/uploads は admi2888 への symlink**（同一実体・両サイト即反映）。旧実体は kichifu/uploads_bak_20260626。
- コード: `ASSET_ORIGIN='https://admi2888.com'`（画像、両config.ts）／**API_BASEはASSET_ORIGINから分離し各サイト自身**（kichifu→kichifu.com/api・admi→admi2888.com/api＝同一オリジン）。`contacts.astro` も `API_BASE` に。`news-latest.js`/`news-ssr.php`/`ctrl/_lib.php`(ASSET_ORIGIN+UPLOADS_ROOT)/`news-edit.php`/`_upload.php` を admi2888 に。SEO canonical(SITE)・og:image・robots・contact.phpメール宛先は変更せず。
- 検証(ワークフロー): 両サイト全ページ型で kichifu.com/uploads leak=0・相対=0・実画像200。

### 孤立サムネ修正（「選択した画像が表示されない」の真因）
- girl_images 364件中2件が物理欠落（かれん girl80 と みりあ girl31 の各2枚目 sort=1）。それがnews 126/127/132/133 のサムネに選択されていた。各girlのメイン写真(sort=0、実在)に付替え＋死んだ girl_images 行2件削除（ユーザー承認）。残存orphan 0。

### kichifu.com/ctrl 廃止（CMSは admi2888/ctrl 一本化、ユーザー指示）
- サーバーの kichifu.com/{ctrl,admin} 実体削除、`deploy.sh` の ctrl rsync 撤去、`.htaccess` で `/ctrl`・`/admin`→`admi2888.com/ctrl` 301。
- ⛔ **事故**: `cd astro-admi` 後の `./deploy.sh` 誤実行で admi2888 が noindex 化＋旧ctrl/api巻き戻り → deploy-prod-admi2888.sh 再実行で復旧、astro-admi/deploy.sh に exit 1 ガード追加。詳細 [[feedback_admi2888_api_shared_with_kichifu]]。

### 女の子詳細のCTRL編集を即反映（girl-detail-refresh.js、2026-06-27）
- **症状**: CTRLで店舗コメント(shop_comment)等を編集しても `/girls/{id}` に出ない（ゆあ girls/38）。**girls詳細は純SSG**＝DBは即更新されるが公開HTMLはビルド時固定。girls.modified > /girls/38.html mtime で確実に判定（ライブが古いビルド）。まず両サイト再デプロイで最新反映。
- **恒久対策（ユーザー選択=自動反映）**: `public/girl-detail-refresh.js` を追加。最新情報(news-latest.js)と同方式で、読込時に **同一オリジンの `/api/girls.php?action=detail`** から最新を取得し `.girl-shop-comment`/`.comment-box`/`.girl-catch` を差し替え（編集=innerHTML swap・空=ラベルごと非表示・新規=本文列`.girl-flags`の親に追加）。**API失敗時はSSG内容を保持**（graceful、try/catch）。SEO＝ビルド時の静的版が残る／訪問者＝最新版。
- girls/[id].astro（両プロジェクト）: `.girl-detail-wrap` に `data-girl-id`、`?v=mtime` で読込。`window.__SHOP_ID`(Site.astro head)で店判定。
- **対象はリッチテキスト3項目のみ**（shop_comment/comment/catch_copy）。構造データ(画像/サイズ/タグ/プロフ/プレイ)は変更頻度低くSSG再ビルドで対応（client全再現は重いので非対象）。
- ⚠️ **dev server(npm run dev)はPHP非実行**＝相対 `/api/` がPHPソースを返す→JSON.parse失敗→.catchでSSG保持（=本番でAPI障害時の安全動作をdevで確認できる）。本番は同一オリジンでJSON正常。CORSのため dev から本番API直叩きも不可。
- **即反映の実証（2026-06-27）**: 「登録後すぐ反映」を本番でエンドツーエンド検証済。①`/api/girls.php?action=detail` は両サイト `cache-control: no-store` + `cf-cache-status: DYNAMIC`＝Cloudflare非キャッシュで**DB更新が即API反映**（OPcache/Xアクセラレータの遅延も無し）。②DBに検出用マーカー(HTMLコメント)を挿入→**実Chrome で admi2888.com/girls/38 を開くと、デプロイ済みSSGには無いマーカーが `.girl-shop-comment` に出現**（client-refreshが同一オリジンAPIから取得し差し替え）。③マーカー削除→リロードで消失（削除も即反映）。**結論: CTRL保存→公開ページ(再)読込で即反映、デプロイ不要・キャッシュ遅延なし**。唯一の条件は訪問者がページを(再)読込すること（既に開いているページのリアルタイム更新ではない）。
- **注記**: astro-admi の girls/[id].astro は canonical が `https://kichifu.com/girls/{id}` ハードコード（admiでもkichifu表記）＝別件のSEOバグ。今回未修正。

### トップに「アイコンの見かた」凡例＋説明モーダル追加（2026-06-27）
- 女の子カードの属性アイコン(`flag-{machiawase,inbound,genderless,tel,newgirl}.png`)の意味を説明する凡例を top に追加。配置＝「すけべな女の子達を見る」ボタンと「today's schedule/本日の出勤」の間（`.top-iconlegend-section`）。5アイコン横並び→タップで `#icons-modal` が開き、該当アイコンの説明を `is-active`(ピンク枠)でハイライト＋scrollIntoView。✕/オーバーレイ/Esc で閉じる。両サイト(kichifu/admi)に実装。
- 説明文(5種): お待ち合わせOK / 外国人のお客様OK / 女性のお客様もOK / ご予約前のお試し通話OK / 新人女性。`top.astro` の `ICON_LEGEND` 配列で定義。
- **モーダルは既存 `.reserve-card`/`.modal-*` を流用**＝admi(ライト)/kichifu(ダーク)の両テーマ上書きが自動で効く（新規テーマCSS不要）。アイコン行ボタンは白地+ピンク枠で両bg対応。
- ⚠️ **オーバーレイ衝突回避**: `.modal-overlay` を2つ持つため、`body.reserve-open .modal-overlay`→`body.reserve-open #reserve-modal` にIDスコープ化（さもないと予約を開くと icons-modal も表示される）。icons は `body.icons-open #icons-modal` で独立トグル。site.js は両プロジェクト同一なので片方編集→cpで同期。
- 検証(preview): 両テーマで凡例行表示・モーダル開閉(✕/overlay/Esc)・タップ項目ハイライト・**予約モーダル無回帰**を確認。
- 追補(2026-06-27): ①凡例の上に `section-topper`(✦ ⋆ ♡ ⋆ ✦)を追加＝ボタンと出勤の間で上下区切りに挟まれる。②女の子カードの属性アイコン縦並び順(`GirlCardItem.astro` girl-card-flags)を凡例と統一: 新人→お待ち合わせ→電話→外国人→女性(tel を3番目へ)。③`.modal-close` を 36→48px 丸ボタン+ピンク枠、font 1.75rem に拡大（reserve/icons共通・両テーマ、タップ域はmargin相殺で見た目位置維持）。
- 追補(2026-06-27): 凡例アイコン行を**スマホで1行に固定（レスポンシブ）**。旧 `flex-wrap:wrap`+`flex-shrink:0`+固定58px は幅不足で折返し2行になっていた→ `.iconlegend-row{flex-wrap:nowrap}` ＋ `.iconlegend-btn{flex:0 1 58px;aspect-ratio:1/1;min-width:0}`（最大58px・足りなければ縮小・正方形維持）＋ img を `70%`。実測=320/360pxで1行(btn≈45px)・1280pxで1行(btn=58px頭打ち)。

### SSRフォールバックのヘッダー復元・本文電話の店舗統一（2026-06-27）
- **ヘッダー崩れ**: SSGに無い新規ニュース/日記が `news-ssr.php`/`diary-ssr.php` に落ちると、ヘッダーがロゴだけの簡略版で崩れていた（ナビ/電話/予約/ハンバーガー/オフキャンバス/予約モーダル/フッターCTA全欠落、両SSRが別実装でドリフト）。→ `public/_ssr-shell.php` に head/header/footer/offcanvas/予約モーダル＋`asset_url()`/`ssr_h()`/`ssr_localize_body()` を集約し両SSRから利用。店舗別設定(admi=1/kichifu=2: 電話・キャッチ・GA-ID・fujohoId)は host判定で出し分け。`site.js?v=mtime` 読込でハンバーガー/予約が動作。deploy.sh / deploy-prod に `_ssr-shell.php` の rsync 追加。**Site.astro を変えたら _ssr-shell.php も合わせる**。
- **本文の電話が他店番号**: 立川/吉祥寺は別店舗だが **CTRLの2店舗掲載**（手動投稿 source_id=`m…` で両店行）で立川登録の本文が吉祥寺にも反映され、本文CTA(`tel:0425282888`/`📞042-528-2888`)が立川番号のままだった（ミラー取込ではない）。→ **表示時に全店電話を当店番号へ統一**: `config.ts localizeBody()`（両プロジェクト）を `news/[id].astro`(SSG)、`ssr_localize_body()` を `news-ssr.php`(SSR) に適用。**SSGビルド済みページは再ビルド必須**（no-store=SSR/no-cache=SSG で判別、両 deploy 再ビルドで全43件置換）。詳細 [[project_kichifu_fujoho_diary_import]]。
- **お知らせの主役(女の子)サムネ→プロフリンクがSSRで欠落**: CTRLで女の子を選ぶと `link_girl_id` 保存→詳細サムネを `/girls/{id}`(相対=当店プロフ)にリンクする仕様。SSG(`news/[id].astro`)は実装済だが SSRフォールバック `news-ssr.php` に無く、admi2888(recent newsはSSR配信)でリンクが付かず「反映されない」状態だった。→ `$thumbLink = link_girl_id ? /girls/{id} : link_url` をSSGと同一移植。相対URLゆえ 立川→立川プロフ/吉祥寺→吉祥寺プロフに自動解決。**挙動は「カード→お知らせ詳細(プロモ本文)→写真クリックでプロフ」の2段が正**（ユーザー確認・カード直リンクにはしない）。news/[id].astro を変えたら news-ssr.php も合わせる（thumbLink/電話localize/画像asset すべて二重実装）。詳細 [[project_kichifu_fujoho_diary_import]]。

### 写メ日記サムネを高解像度化（fujoho _180→_360）（2026-06-26）
- **症状**: 最新情報のサムネが粗い。調査の結果、**お知らせ(news)サムネは960×1280で詳細と同一ファイル＝既に高画質で無罪**。粗さの主因は隣の**写メ日記サムネが fujoho 180px** で Retina/PC 表示で解像度不足だった。
- fujoho は `_180.jpg`(180×180) と `_360.jpg`(360×360) を配信（`_240/_500/原寸` は403）。`import-fujoho-diary.php` の画像抽出に `preg_replace('/_180(\.jpe?g)$/i','_360$1',$img)` を追加（142行・1箇所で完結）＋既存 girl_diaries 134件を `REPLACE(image,'_180.jpg','_360.jpg')` で一括_360化。共有DB＝両サイト即反映、news-latest.js(クライアント)で再ビルド不要。PHP単体ゆえ両サーバー api/ へ直接rsync。詳細 [[project_kichifu_fujoho_diary_import]]。

## 実装履歴（2026-06-28）— お知らせ反映バグ根治・正式店名統一・おすすめSEO

### お知らせの「編集が反映されない／予約投稿の404」を根治（両サイト）
スタッフ報告「お知らせを保存後に修正してもHPが古いまま／予約投稿はサムネ出るのにクリックで404」の真因は2層。詳細 memory `feedback_kichifu_news_detail_static_stale`。
- **層1（.htaccess・commit f311f6c3）**: kichifu の `/news/[id]` が「ビルド済み静的html優先」で、既存お知らせを編集してもデプロイまで古いままだった（admiは元々 news-ssr 優先＝反映済）。`RewriteRule ^news/([0-9]+) → /news-ssr.php` を**汎用 `.html` ルールより前**へ移動し admiと統一＝**常時SSR（DB直）化**。診断＝レスポンスヘッダ `no-store`=SSR / `no-cache,must-revalidate`=静的。
- **層2（シンレンXアクセラレータ・両サイトOFF・commit dc813e4f）**: origin側Xアクセラレータが `no-store` を無視して news-ssr.php/api出力を数十秒〜数分キャッシュ→編集/予約公開が遅延、予約時刻前後で一覧と詳細のキャッシュTTLがズレ「サムネ出るが404」発生。Set-Cookie等コード側除外は効かず＝**パネルで両サイトとも Xアクセラレータ OFF＋キャッシュ削除**で解決。マーカー実証（DB body にHTMLコメント付与→curl→除去→即curl）で **OFF後=即反映** を両サイト確認。
- **結果**: お知らせ編集も予約投稿(posted_at到来時の自動公開)も**即時・ズレなし**。予約投稿は posted_at>NOW の間は一覧非表示＋詳細は /news へ302（公開前は完全に隠れる＝正常）。**「明日の予約公開の404」はこの2層修正で解消済**。

### 店名を正式名に統一（広告媒体と完全一致・ブランドSEO）
広告媒体（口コミ局/シティヘブン/風俗じゃぱん）の登録名と一字一句そろえ、Googleの同一店舗認識・ブランド検索/サイトリンクを強化。
- **admi（commit eab8d6e3）**: `アドミsince2002立川デリヘル&Go To FANTASY東京本店`
- **kichifu（commit 93d42514）**: `アドミsince2009吉祥寺デリヘル&Go To FANTASY東京吉祥寺店`
- 変更点（両サイト同型）: `config.ts SHOP.fullName` を無スペース正式名に / `index.astro` title=fullName / `top.astro` title=`${fullName}｜（立川|吉祥寺）でおすすめ` / `Site.astro` JSON-LD `name=fullName`＋`alternateName=SHOP.name`。og:site_name/footer/girlsページ等は元々 fullName 参照で自動追従。旧title「アドミ since2002 | 立川デリヘル & Go To FANTASY」は「東京本店」欠落＋` | `分断だった。
- ユーザーが GSC で両ドメインの `/` と `/top` をインデックス再リクエスト済（反映は数日〜2週、他ページは自然クロールで追従）。

### admi に「おすすめ／オススメ」SEO追加（commit cb319a76 ＋ eab8d6e3）
- admi のみ: `Site.astro` に meta keywords 新設（おすすめ/オススメ＋立川デリヘル系・全ページ）、top/index の description とコンセプト h2・本文に「立川でおすすめ/オススメ」を自然に織り込み、/top title 末尾に「立川でおすすめ」。kichifu は /top title に「吉祥寺でおすすめ」のみ（店名統一の一環）。

## 実装履歴（2026-06-29）— CTRL出勤登録のUX改善

### 「出勤を保存しても登録されない」の正体＋UX改善（`ctrl/schedules.php`）
スタッフ報告「なほの7/1を出勤保存しても登録されない」。調査の結果**バグではなく、状態プルダウンを「未定」のまま時間だけ入れていた**ため（出勤=workのときのみstart/end保存、未定だと時間無視で未定保存）。バックエンドのupsertは正常（schedules UNIQUE(shop_id,girl_id,work_date)、トランザクションでwork書込→ロールバックして実証）。なほ(girl20)は立川shop1+吉祥寺shop2両在籍なので両店に直接7/1=10:00〜18:00を投入して即対応。詳細 memory `feedback_ctrl_schedules_editing`。
- **UX改善3点（schedules.php 末尾 `<script>`、両モード共通、commit 42beee64/df67fd73/9fa6ce77）**:
  1. 時間(`.tsel-h`/`.tsel-m`)を「--」以外にしたら、その行を自動で「出勤」に（未定のまま時間だけ保存→未定になる事故防止）。
  2. 時(左)を選んだら、分(右)が空のとき自動で「00」（option value="0"）。行＋一括時間の全`.tsel`対象。
  3. 保存時バリデーション: status='work'の行で開始/終了どちらかが「--」なら `e.preventDefault()`＋alert＋該当を赤枠＋scrollIntoView。
- 注意: 上部の「女性/並び順/開始日」selectは onchange で `location.href` リロード＝テーブルの未保存編集が消える（UXの落とし穴）。CTRL runtime=admi2888のみ、ソース=`astro-kichifu/ctrl/`。

## 実装履歴（2026-07-09）— CTRL登録の全項目を即時反映化（設計監査で4穴を閉塞・コミット 6ee2d597）

### 設計監査（ユーザー指示「登録するもの全て即時反映で」）
CTRLで登録できる全データ×表示箇所を棚卸し。**既に即時反映**: スライダー（slider-latest.js）/お知らせ一覧・詳細（news-latest.js・常時SSR）/出勤（schedule-*.js毎回API）/女性の掲載ON・OFF/新規カード/写真（girl-visibility.js）/コメント3種＋ギャラリー（girl-detail-refresh.js）。**未対応の4穴**を特定し全て修正（両サイト）:
- **A. 下部バナー**: client-refresh無し＆0件時セクション自体無し → `public/banner-latest.js` 新設（slider-latest.jsと同パターン: 署名=画像URL|リンクURL|タイトル比較・全消し→非表示）＋ top.astro のセクション常設化（`data-bottom-banners`、0件時display:none）＝0→1枚/差替/リンク変更/全消しすべて再読込で即反映。
- **B. 女性カードの文字情報**: 既存カードは写真しか同期されず名前/年齢/サイズ/タグ/属性変更がデプロイ待ちだった → `girl-visibility.js` にステップ4追加。名前/年齢/サイズ行/属性フラグ/タグ絵文字/サムネリンク先(external_url)/data-*属性を**要素単位でpatch**（カードを作り直さない＝schedule-badge.jsの出勤バッジを壊さない）。data-*更新で girls-filter.js の並び替え/絞り込みも最新値で動作。
- **C. 女性詳細の構造データ**: リッチテキスト3種＋画像以外が未同期だった → `girl-detail-refresh.js` を全項目化。h1名前・年齢/属性フラグ/キャッチ（無→有の新規挿入も）/特徴タグ/スリーサイズ5マス/プロフィールQ&A table/基本・オプションプレイchips。各項目とも「差分時のみ書換・空→ラベルごと非表示・ビルド時に無かったセクションは正位置に新規挿入・名前変更時は『○○さんに質問』等のラベルも追従」。`#girl-week`（週間出勤）はschedule-week.jsの持ち場なので不干渉。
- **D. 新規女性の詳細ページが404**: SSGに girls/{id}.html が無く、カード（即時表示）をタップすると404。trigger_deploy()はgirl-edit.phpのみ＆サーバーにdeploy-config.php無しなら空振り（bool返すだけ） → **`public/girls-ssr.php` 新設**（news-ssr.phpと同パターン: _ssr-shell.php利用・host判定でshop_id・[id].astroと同一マークアップ/lightbox/schedule-week.js・canonical自己参照・DB無しid→302 /girls）。`.htaccess` に `RewriteCond %{DOCUMENT_ROOT}/girls/$1.html !-f` 付きフォールバックルール追加（**既存女性=SSG優先＋client-refresh / 新規女性のみSSR**）。両deployスクリプトの public/*.php rsync に girls-ssr.php 追加。⚠️ **girls/[id].astro を変えたら girls-ssr.php も合わせる**（news/[id].astro ⇄ news-ssr.php と同じ二重管理）。

### 検証
- jsdom＋fetchスタブで13項目 ALL PASS（バナー表示/全消し・カード文字patch・掲載OFF除去・h1/フラグ/キャッチ/タグ/サイズ/プロフ/プレイ/リッチテキスト/週間出勤温存）。
- 本番: 両サイト `php -l` OK・全主要ページ200（.htaccess事故なし）・girls-ssr.php直叩きで完全レンダリング（canonical/h1/detail-wrap/schedule-week）・存在しないid=302→/girls・banner-latest.js配信200。
- 運用条件は従来どおり「**訪問者がページを（再）読込したとき**に反映」（開きっぱなしページのリアルタイム更新ではない）。

## 実装履歴（2026-07-08 後半）— スライダー即時反映の調査＋残存2ケース対応

### 調査結論（Workflow 4並列＝ランタイム/コード/CTRL・API/キャッシュ）
「先日スライダー画像登録が即時反映されなかった」＝**一過性**。原因はキャッシュでもコードバグでもなく「SSG＋client-refresh のタイミング」で、すでに解消済み（現時点で再現しない）。
- **API健全**: `/api/sliders.php` は `Cache-Control: no-store`＋CF `DYNAMIC`＋Age無し。2回連続取得で完全一致＝キャッシュされず常に最新（Xアクセラレータも2026-06-28に両サイトOFF済で無罪）。
- **SSG↔API一致**: 両サイト5枚が枚数・並び・URL完全一致（差分ゼロ）＝現状チラつきの元すら無い。
- **スクリプト健全**: `banner-slider.js`→`slider-latest.js` の正順・ヒーロー直後・news前。`__initHeroSliders` 定義済み・再init対応。
- **CTRL健全**: 新規スライダーは `is_display=1` 既定（slider-edit.php）、`_upload.php` はランダムファイル名で即配信、`trigger_deploy()` は呼ばない（girl-edit と違い「1-2分後」表示は出ない）。
- **「先日」の正体**: `slider-latest.js` 導入前（〜7/5）or スクリプト最下部時代（〜7/7）の観測＝古画像が長時間表示され「反映されない」ように見えた。両方修正済み。
- **運用上の唯一条件**: 即時反映は**訪問者がtopを再読込**したとき（開きっぱなしページのリアルタイム更新ではない）。

### 残存2ケースを塞ぐ（`public/slider-latest.js`・両サイトidentical）
調査で見つかった「画像登録以外で反映されない」穴を修正:
1. **全消し／最後の1枚の削除・非表示**: 旧 `if(!live.length) return`（SSG維持で古いスライドが残る）→ track空＋`slider.display=none`＋fallback表示に。
2. **画像そのままでリンクURL/タイトルだけ編集**: 差分判定を画像src URLのみ→**署名 `画像URL|リンクURL|タイトル` 比較**に拡張（`liveSig`/`currSig`）。Astroのattr自動エスケープは `getAttribute` で元値にデコードされSSG↔API署名が損失なく一致＝**変更なし時は誤検知せずチラつかない**（プレビューで round-trip 検証済＝noFalseRebuild、タイトル変更検出＝detectsTitleChange）。
- ※画像の新規登録/差し替え/並べ替えは既存修正で元々即反映（top再読込時）。今回は別ケースの予防。
- ⚠️ 副次観測（実害なし）: `?v=`無しの bare `/slider-latest.js` は 2026-07-08 の .htaccess「?v無しJS→no-cache」変更前にCFエッジへ焼かれた immutable オブジェクトが残存し古い版を返す。だが実ページは常に `?v=<mtime>` 付きで参照し新版が配信される（本番の `?v=` 付きURLで liveSig/全消し分岐の配信を確認済）。気になればCFで bare JS を手動パージ。

## 実装履歴（2026-07-08）— 画像/コンテンツのチラつきを全面解消（スクリプト位置＋プリロード＋キャッシュ）

### 背景・調査（Workflowで4並列調査）
「スライダーだけでなく他の画像も、過去登録したものが一瞬表示される」という報告を受け、girl-visibility.js / girl-detail-refresh.js / news-latest.js の3ファイルについて①スクリプト配置位置 ②本番キャッシュヘッダー ③JS内部ロジック を並列調査。原因は2系統＋副次的なキャッシュ懸念1点と判明。

1. **スクリプト配置**（体感的に最大要因）: `girl-visibility.js` が **Site.astro の `</body>` 直前**（フッター・オフキャンバス・予約モーダルまで含めた**全ページ内容の後**）に配置。`news-latest.js`(top.astro)も対象の `#top-news-list` から**118行も後**（女の子一覧・出勤表・バナー等を挟んでから）実行されていた。SSGの古い内容がその間ずっと表示され続ける。
2. **画像差し替え実装**: 新しいURLをプリロードせず `img.src`/`innerHTML` を直接書き換えており、「旧画像→一瞬空白/壊れたアイコン→新画像」の2段階チラつきが発生。
3. **キャッシュ設定（軽微）**: JS/CSSは `.htaccess` の拡張子マッチで `?v=`有無に関わらず一律1年immutable。`?v=`無し直アクセスがCloudflareに乗ると、デプロイしても永久に古いJSが返り続ける構造的弱点（パージ処理も無し）。実運用ではHTML内は常に`?v=`付きのため露出頻度は低いが、防御的に対処。

### 対策1: スクリプトを対象DOM直後に再配置（両サイト、5ファイルずつ）
昨日のスライダー修正（`banner-slider.js`/`slider-latest.js`をヒーロー直後へ）と同じ考え方を、girl-visibility.js/girl-detail-refresh.js/news-latest.jsにも適用。
- **`girl-visibility.js`**: Site.astroからのグローバル読込を廃止（`gvV`変数・scriptタグとも削除）。対象ページ（top.astro/girls/index.astro/schedule.astro）それぞれに、対象グリッドの直後で個別読込に変更:
  - `top.astro`: 「本日の出勤」セクション`</section>`直後（新人セクション+schedule-gridの**両方**が既にDOM上にある位置）、下部バナーより前
  - `girls/index.astro`: `</main>`直後（girls-filter.js/schedule-badge.jsと並び）
  - `schedule.astro`: `</main>`直後（schedule-page.jsと並び）
  - 対象外ページ（index/news/system/howto/contacts等）では読込自体が無くなり、無駄なfetchも削減
- **`news-latest.js`**(top.astro分のみ): 「お知らせ」セクション`</section>`直後に移動（news/index.astro分は元々`#news-archive-list`のすぐ後だったため変更不要）
- **`girl-detail-refresh.js`**: `.girl-detail-wrap`を含む`</main>`直後、ライトボックスモーダルより前に移動
- 検証: 両サイトビルド後、生成HTML内のバイト位置比較で全ページ「対象DOM要素 < script位置 < 後続の無関係コンテンツ」の順序をPythonスクリプトで機械的に確認。プレビューでも実際の画面表示・カード数・コンソールエラー無しを確認。

### 対策2: 画像プリロード後にDOM反映（3ファイル共通パターン、両サイト）
- **`preloadThenSwap(imgEl, newSrc)`**: `new Image()`で新URLをバックグラウンド取得→`onload`で初めて実際の`<img>`の`src`を書き換え。ダウンロード中は旧画像がそのまま見え続け、完了と同時に瞬時切替＝空白/壊れたアイコンの表示が起きない。`onerror`時は何もせず旧画像を維持（安全側フォールバック）。
  - `girl-visibility.js`: 既存カードの写真差し替え（ステップ3）に適用。「写真なし→写真あり」の新規追加ケースもプリロード後に要素挿入。
  - `girl-detail-refresh.js`: メイン写真(`#girlMainPhoto`)の差し替えに適用。
- **`preloadAll(urls, cb)`**: 複数画像をまとめてプリロードし、全て読込完了(または失敗)、もしくは**4秒タイムアウト**でコールバック実行（一部の画像が遅い/壊れていても無限に待たない安全弁）。
  - `girl-detail-refresh.js`: サブ画像ギャラリー（`.girl-sub-photos`）の一括再構築に適用。1枚ずつ順にロードされる途中の崩れを防止。
  - `news-latest.js`: 最新情報リスト（`#top-news-list`/`#news-archive-list`）のサムネ一括再構築に適用。
- **副次改善（news-latest.js）**: `signatureOf()`/`currentSignature()`でAPI取得内容と現在DOMのitem ID列を比較し、**内容が変わっていなければinnerHTML自体を書き換えない**（ほとんどのページ表示では前回と内容不変＝再描画ゼロ＝チラつきもゼロ）。girl-detail-refresh.jsのギャラリーは元々同種の比較ロジックを保持済み。

### 対策3: .htaccess キャッシュルール見直し（Cloudflare API連携不要の防御策、両サイト）
画像/フォントは従来通り無条件1年immutable（アップロードのたびに新しいハッシュファイル名になるため無害）。JS/CSSのみ `?v=` の有無で分岐:
```apache
<IfModule mod_setenvif.c>
  SetEnvIf Query_String "^v=" HAS_VERSION
</IfModule>
<FilesMatch "\.(css|js|mjs)$">
  Header set Cache-Control "public, max-age=31536000, immutable" env=HAS_VERSION
  Header set Cache-Control "no-cache, must-revalidate" env=!HAS_VERSION
</FilesMatch>
```
サイト内の全参照は常に`?v=<mtime>`付きなので通常時の挙動は無変更（従来通り1年キャッシュ＋デプロイ毎にURL自体が変わり自動的にバスト）。`?v=`無し直アクセスのみ`no-cache`に変わり、Cloudflareに古いJSが未来永劫キャッシュされ続けるリスクを閉じた。Cloudflare側APIパージの追加は行っていない（ローカルデプロイスクリプトに新規シークレット管理を持ち込みたくないため。実運用リスクは低いと判断し見送り）。

### 影響範囲
girl-visibility.js: `/top`（新人セクション・本日の出勤）・`/girls`・`/schedule`。girl-detail-refresh.js: `/girls/{id}`。news-latest.js: `/top`・`/news`。全て両サイト（admi2888/kichifu）で同一実装。

## 実装履歴（2026-07-07）— topスライダーのチラつき解消（スクリプト位置移動）

### 症状・原因
- `/top` をリロードすると毎回、一瞬前の（古い）スライダー画像が見えてから最新画像に切り替わる。
- 原因: `banner-slider.js`/`slider-latest.js` が **ページ最下部**（お知らせ・女の子一覧・出勤表・GA等**全コンテンツの後**）にあり、非defer/非asyncの `<script src>` はDOMパースがそこに到達するまで実行されない＝SSG焼き込みの画像がかなり長い時間そのまま表示されてから、ようやくJSがAPI最新に差し替えていた。
- ⚠️ 前提として「SSGとAPI最新のズレ自体」はCTRL編集が随時入るため**次のデプロイまで常に起こりうる**（アーキテクチャ上の制約、根絶不可）。今回直したのは「ズレがあったときにどれだけ長く古い画像が見えるか」という**チラつきの継続時間**。

### 対策（両サイト・`top.astro`）
- `banner-slider.js`＋`slider-latest.js` の `<script>` タグを、**ヒーロー（fallback含む）直後・お知らせセクションより前**に移動。ヒーローHTMLがパースされ次第ほぼ即座にJS実行→API最新へ差し替わるようになった。
- `schedule-badge.js`/`schedule-page.js`/`news-latest.js` は元の最下部のまま（対象外セクションなので急ぐ必要なし）。
- プレビュー検証: 5枚/5ドット/最新画像への差し替え/自動送り/`__initHeroSliders`（banner-slider.jsの初期化関数）とも正常、コンソールエラー無し。
- 本番デプロイ後も再びCTRL編集でSSGとAPIがズレていたが、これは想定内（次デプロイまでの正常な挙動）で、スクリプト早期化により**表示直後にほぼ即差し替わる**ため体感上のチラつきは大幅に軽減。

## 実装履歴（2026-07-06）— 最新情報をお知らせのみに戻す＋ヒメ日記ウィジェット単体設置

### 背景・判断
- 以前「最新情報にお知らせ⇄写メ日記を交互表示」にしたが、**ポイント対象の口コミ局ヒメ日記ウィジェット（fujoho iframe）がクリックされなくなった**（訪問者が自サイト /diary へ流れる）ためユーザーが撤回を指示。
- **最新情報＝お知らせ(news)のみに戻し**、写メ日記は**最新情報の直下にヒメ日記ウィジェットを単体掲出**（スマホ横幅100%）。

### 実装（両サイト）
- **写メ日記マージ撤去**: `top.astro`（feed=`getNews().slice(0,6)`）／`news/index.astro`（feed=`getNews()`）／`news-latest.js`（news専用に書き換え、#top-news-list・#news-archive-list とも diary fetch/merge削除）。日付関数の diary 分岐・`/diary/` href・`news-diary-badge` も除去。
- **`src/components/HimeDiary.astro` 新設**（両プロジェクト identical、SHOP.fujohoId/SHOP.catch使用＝admi57立川/kichifu53179吉祥寺で自動出し分け）: 口コミ局ヒメ日記 iframe(`sp_shop_girl_blog_list&ct=color_diary_pink`)。`top.astro` の最新情報 `</section>` 直後に `<HimeDiary />`。
- **スマホ全幅**: `.hime-diary-widget .fujoho_custom_banner{width:100%!important}` で fujoho外枠の `width:310px` を上書き（iframe内部は不変ルール遵守＝外枠のみ）。PC=max-width420px中央 / ≤640px=横幅100%（padding0）。プレビュー実測: mobile 375px全幅・PC 396px中央。
- **高さ調整（2026-07-06 追補）**: 最新情報 top を6→**3件**（top.astro `slice(0,3)`＋news-latest.js top slice3）。ヒメ日記ウィジェットのスクロール枠 220→**166px**・外枠 300→**245px**＝fujoho日記1行(サムネ+タイトル+時刻+名前)の中身に合わせフッター「立川/吉祥寺デリヘル 口コミ風俗情報局」を中身直下へ（下部の白い余白を解消）。プレビュー実測で mobile375全幅/PC396中央とも余白0・見切れ無し。
- **残置（「一旦」）**: `/diary/[id]` ページ・fujoho写メ日記取込(import-fujoho-diary.php/cron)・`getDiaries()`API は削除せず残す（将来再開余地）。/diary は内部リンク元が消え orphan 化するが noindex なので無害。
- 本番確認: 両サイト top で news-diary-badge=0・ヒメ日記ウィジェット設置。注: top の「ヒメ日記」iframeは2箇所ヒット＝①今回の最新情報直下ウィジェット ②下部GIRLS(Fujoho.astro)の6枚中のヒメ日記カード、で正常。

## 実装履歴（2026-07-05）— SSRの/news/*全noindexバグ・写メ日記全文表示・topスライダー即反映

### GSC「noindexタグによって除外」41件の主因 — SSRシェルがrobots noindex固定
- **症状**: GSCで admi2888 の /news/* と /diary/* 計41件が「noindexタグによって除外」。/news は本来indexしたいのに全てnoindexだった。
- **原因**: `public/_ssr-shell.php` の `ssr_head()` が `<meta name="robots" content="noindex, follow">` を**ハードコード**。news-ssr.php/diary-ssr.php 共通シェルのため、**常時SSR配信の /news/*（.htaccessでnews/[id]→news-ssr.php優先）が全てnoindex**に。canonicalも未出力だった。diaryのnoindex化(2026-06-26)のときシェルに固定で入れnewsに波及したと推測。
- **修正（`astro-kichifu/public/` の3ファイル。SSR PHPの正はここ＝deploy-prod-admi2888.shが `../astro-kichifu/public/*.php` をrsync）**:
  - `_ssr-shell.php`: `ssr_head($S,$title,$desc,$noindex=false,$canonical='')` に拡張。robots動的化（既定index,follow / $noindex時noindex,follow）、canonical+og:url出力。`ssr_canonical($S,$path)` ヘルパー（shop_idで admi2888.com/kichifu.com 確定＝Host偽装耐性）。
  - `news-ssr.php`: `ssr_head(...,false,ssr_canonical($SSR,'/news/'.$id))`＝index。
  - `diary-ssr.php`: `ssr_head(...,true,ssr_canonical($SSR,'/diary/'.$id))`＝noindex(fujoho転載で意図通り)+canonical自己参照。
- **配信**: PHP単体（Astroビルド不要）。両サーバー(kichifu.com/admi2888.com public_html)へ3ファイル直接rsync＝即反映（Cloudflare no-store/DYNAMICでキャッシュ無し）。本番確認: /news/*=index+canonical, /diary/*=noindex+canonical。
- **もう1つのGSC警告「代替ページ(canonical)6件」（`/girls?order=...` `/news?page=...`）は正常動作**＝SSG一覧の canonical が /girls・/news を指しパラメータバリアントが正規URLに統合されている（放置可・修正不要）。
- ⚠️ **Site.astro を変えたら _ssr-shell.php も合わせる**の原則に、**robots/canonical も含める**（SSG=Site.astro / SSR=_ssr-shell.php の2系統で meta を二重管理）。
- **GSC検証（2026-07-06 開始）**: ユーザーが「noindexタグによって除外」レポートで「検証を開始」実行済（保留41/失敗0）。⚠️ **この検証は最終的に「失敗」で終わる想定＝正常**。理由: 41件に /diary/*（意図的noindex維持）が混在し、再クロールでも noindex が残るため「全件修正」にならない。/news/* は index 復帰しインデックスされる（検証失敗は news の復帰に影響しない）。意図的noindexページ(/diary)はこのレポートに残り続けるのが正常。急ぐ news は URL検査→インデックス登録リクエストで個別再クロール。

### 写メ日記全文表示バグ・topスライダー即反映

### 写メ日記の本文が抜粋(…)止まりで全文表示されないバグ修正
- **症状**: `/diary/{id}` 本文が末尾`…`で切れ全文が出ない（例 /diary/51001）。DB調査で source=fujoho 278行中212行が `body LIKE '%…'`。
- **真因2層**: ①fujoho個別ページの構造変更＝メイン日記本文は現在 `main_profile_girl_blog_text`、旧参照 `shop_contents_sub_blog_post_text` は「下部の他日記一覧の抜粋」に（1ページ57回出現・全部抜粋、雑な正規表現だと5000字級を誤取得）。②`ON DUPLICATE KEY UPDATE body=VALUES(body)` で毎30分cronが一覧抜粋(…)で上書き。
- **修正（`api/import-fujoho-diary.php`）**: `extract_full_body()` ヘルパー（新クラス優先＋旧fallback、`\n{3,}→\n\n` 空行圧縮）。ON DUPLICATE を `body=IF(CHAR_LENGTH(VALUES(body))>CHAR_LENGTH(body),VALUES(body),body)`＝**長い方を保持**。`--repair` モード追加で既存抜粋止まり**104件を全文に復旧**（skip2件）。
- 反映: /diary/{id}=SSR(diary-ssr.php,no-store)でDB修復即反映。SSGビルド済み日記は両サイト再デプロイで最新化。詳細 memory [[project_kichifu_fujoho_diary_import]]。

### top ヒーロースライダーもCTRL変更を即反映（デプロイ不要）
- **症状**: CTRLでスライダー追加（「ランキング2,3」）してもtopに出ない。**ヒーロースライダーはtop.astroのビルド時取得(SSG)で、news/girlsと違いクライアント補正が無かった**（APIとDBには登録済み）。
- **修正**: `public/slider-latest.js` 新設（news-latest.js等と同じSSG+クライアント補正パターン）。読込時に `/api/sliders.php?shop_id=N` 最新で `.hero-slider-track` を差し替え→`window.__initHeroSliders()` で再初期化。`banner-slider.js` を**再実行可能化**（cleanup=タイマー/リスナー/ドット破棄を `slider.__sliderCleanup` に登録、`window.__initHeroSliders` 公開）＝多重初期化してもドット重複しない（プレビュー検証済）。
- 並び/画像URL一致時は触らない（チラつき防止）、全消し・API失敗はSSG維持。`top.astro` に `slider-latest.js` 読込追加。両サイト共通identical（banner-slider.js/slider-latest.js）。
- **0→1枚目の登録も即反映（セクション常設化・2026-07-05後追い）**: 当初「SSG0枚時は `[data-slider]` セクションが無く0→1枚目だけデプロイ必要」だったのを解消。`top.astro` を三項分岐廃止→ **スライダーセクション(`[data-slider]`)とロゴfallback(`.hero-fallback`)を両方常時レンダリング**（0枚時=スライダー`display:none`/fallback表示、N枚時=逆）。`slider-latest.js` は track差し替え時に `slider.style.display=''`＋`fallback.style.display='none'`＋操作`.hero-slider-controls`の表示可否(2枚以上)を切替。これで0枚からの初回登録もリロードで反映。プレビューで0→2枚遷移（スライダー表示/fallback非表示/ドット2/多重初期化なし）検証済。
- kichifu fallback は `<h1>` 維持（admiは sr-only h1 に一本化済のため fallback は `<p>`）。

## 実装履歴（2026-07-03）— admi「アドミ立川」語順SEO対策

### 調査結果（「立川アドミ」3位 vs「アドミ立川」圏外の原因）
- **「立川アドミ」**: 第三者（さくら検査研究所の検査済証「立川アドミ様」/キャストX投稿/YouTube/#立川アドミ/爆サイ）が通称として多用→エンティティ確立済みで順位が付く。
- **「アドミ立川」**: 連続表記の使用者が実質 **TikTok公式 @admi_girl（表示名「アドミ立川」）のみ**。第三者使用ゼロ→Googleにとってこのクエリの正解エンティティはTikTokアカウントで、SERP上位をTikTokが占有し公式サイトは圏外。
- 自サイト側も両複合KWが title/h1/keywords/JSON-LD に不在（title は「アドミsince2002立川」で since2002 が挟まりフレーズ不成立＝両クエリ共通ハンデ・変更不可）。**/top は h1 が0件**（スライダー無し時のフォールバック分岐にしか h1 がなかった）。

### 実装（astro-admi のみ・正式店名/titleは不変更）
- `Site.astro` JSON-LD: `alternateName=["アドミ","立川アドミ","アドミ立川"]`（配列化）＋ `sameAs`（TikTok @admi_girl/口コミ局id=57/駅ちか4517/シティヘブン/風俗じゃぱん/デリヘルじゃぱん）追加＝TikTokの「アドミ立川」エンティティと公式サイトを統合。
- `Site.astro` keywords: `立川アドミ,アドミ立川,立川おすすめデリヘル,おすすめ立川デリヘル,立川オススメデリヘル,オススメ立川デリヘル` 追加。
- `index.astro`: 表記ゆれ変種「アドミ立川 since2002 立川デリヘル＆(全角)…」→ `{SHOP.fullName}` verbatim に修正、可視本文に「立川アドミ」を追加（従来0回）＝「地元では『立川アドミ』『アドミ立川』の愛称で…」。
- `top.astro`: `main` 先頭に `<h1 class="sr-only">{fullName}｜立川アドミ（アドミ立川）── 立川でおすすめのデリヘル</h1>` を常時設置、フォールバック分岐の旧h1は `<p>` に降格（重複回避）。`site.css` に `.sr-only` 追加。
- ⚠️ JSON-LD は `IS_PROD` ゲート＝**ローカルビルドでは出力されない**。検証は `PUBLIC_PROD=1 npm run build` か本番curl で。
- **残タスク（運用・コード外）**: TikTok @admi_girl のプロフィール/動画説明に admi2888.com リンクを設置（「アドミ立川」SERP1位が自社TikTokなので導線＋エンティティ紐付けの即効性最大）。効果測定=2〜4週後に「アドミ立川」でadmi2888.comが出るか。

## 実装履歴（2026-06-30）— 新規女性の即時表示・admiメニュー変更・駅ちかバナー

### admi GIRLS最新情報に口コミ局バナー3点追加＋スライダー統合（commit 直後）
- `astro-admi/src/components/Fujoho.astro` に口コミ風俗情報局の公式embed3本を **verbatim追加**（id=57＝立川アドミ）: ①ヒメ割！(shop_info_discount_girl/himewari_orange) ②当店の口コミ(shop_repo_list/kuchikomi_pink) ③情報局みた！割引(shop_event_list custom_banner2)。iframe内部不変ルール遵守（`loading="lazy"` のみ付与）。
- **配置=既存3枚(すぐヒメ/ヒメ日記/好評価)と同じ `.fujoho-grid` 内に `.fujoho-card` として入れる**（当初 `.fujoho-extra` 別ブロック下置き→ユーザー要望「スマホはスライダーに混ぜて」で統合に変更）。結果: **スマホ=6枚横スクロールスライダー(ドット6/矢印、`fujoho-slider.js` が `.fujoho-card` 数で自動対応) / PC=6枚wrap(2行×3・中央、`.fujoho-controls` は≤640pxのみ表示)**。
- `site.css .fujoho-grid` に `align-items:flex-start` 追加（高さ違いバナー: ヒメ割300/口コミ235等の上揃え）。
- **admiのみ**（`kichifu` の Fujoho.astro は `fujohoId` 別店舗のため対象外）。index/top 両方の GIRLS セクションに表示。本番反映確認済（fujoho-card=6）。

### admiメニュー変更（commit d2b49712）
- `astro-admi/src/layouts/Site.astro`（Astroページ）＋ `public/_ssr-shell.php`（SSRフォールバック）の3箇所（ヘッダー/フッター/オフキャンバス）で変更:
  - **お知らせ** → `https://ranking-deli.jp/tokyo/area39/style2/4517/news/`（外部URL、target=_self）
  - **お問合せ** → 削除
- `_ssr-shell.php` に `$SSR_SHOPS[1]['news_url']`/`['show_contact']=false`、`$SSR_SHOPS[2]['news_url'='/news']`/`['show_contact']=true` を追加して条件分岐化。両店の fullName を正式名に修正（SSR詳細ページの店名ズレも解消）。

### admi index ページに駅ちか版バナー追加
- `astro-admi/src/pages/index.astro`：「18歳未満の方はこちらよりご退出ください」の1行下に駅ちか版バナー（`ranking-deli.jp/assets/img/user/link/bnr30050.jpg`）を追加。リンク先=`https://ranking-deli.jp/8/shop/4517/`、target=_self。

### 新規登録女性の即時表示（girl-visibility.js 拡張）
- **背景**: Astro SSG はビルド時に女性カードを生成するため、CTRL新規登録後は再デプロイまでフロントに表示されなかった。
- **解決**: `public/girl-visibility.js` を「掲載OFF除去のみ」→「**除去 + 新規カード追加**」の両方向に拡張:
  - `buildCard(g)` 関数: GirlCardItem.astro と同一構造のHTML文字列をJS側で生成（`data-*`属性/属性アイコン/tagEmoji/asset_url対応）
  - `addMissing(grid, filterFn)`: APIにあってSSGカードが無いgirl → `buildCard` で追加
  - 対象: `#girl-grid`（/girls全員）/ `#schedule-grid`（全員、schedule-page.jsがhide/show管理）/ `.girl-grid:not([id])`（top新人セクション、新人のみ）
- **admi `Site.astro` で girl-visibility.js を再有効化**: Xアクセラレータ OFF（2026-06-28）でAPIキャッシュ問題解消済みのため、コメントアウトを解除。
- **動作**: CTRL保存 → ページリロードで即表示（デプロイ不要）。非掲載OFF→除去も従来通り即反映。
- 両サイト（admi2888/kichifu）同内容でデプロイ済み。

### 既存女性の写真差し替えも即時反映（girl-visibility.js ステップ3追加）
- **症状**: CTRL `girl-edit.php` で写真を差し替えると「約1〜2分後に反映」と出る（`trigger_deploy()` で GitHub Actions リビルドをキックするため）。
- **真因**: `girl-visibility.js` は「新規追加」「掲載OFF除去」はするが、**既存カードの写真URL差し替えは未対応**（既にSSGカードがあればスキップしていた）。
- **解決**: `girl-visibility.js` に **ステップ3「既存カードの写真URL最新化」** を追加。全 `.girl-card[data-id]` を走査し、APIの最新 `photo` を `asset()` で絶対URL化→ `img.src` と比較→異なれば差し替え（写真なし→写真ありの新規アップも対応）。SSGは `ASSET_ORIGIN='https://admi2888.com'` 絶対URL焼き込みなので比較が成立。
- `ctrl/girl-edit.php` のフラッシュを「約1〜2分後に反映」→「ページをリロードすると即時反映されます」に変更（`trigger_deploy()` 自体は残置＝SEO用のSSG静的版も裏で更新）。
- 両サイト同内容でデプロイ・本番JS反映確認済み。

### /news 一覧を top と同じ「お知らせ⇄写メ日記」交互表示に（両サイト、commit 直後）
- **背景**: top の最新情報は news + fujoho写メ日記を交互マージしていたが、`/news` 一覧はお知らせ(news)のみだった。「topと同じように写メ日記も表示」要望。
- **SSG（`src/pages/news/index.astro` 両プロジェクト）**: `getDiaries(30)` を追加し news + diary を交互マージ（`news[0],diary[0],news[1]…` フルリスト・top と同じ並び）。写メ日記=ピンクバッジ＋年なし日付＋`/diary/{id}` リンク、お知らせ=年あり＋`/news/{id}`＋抜粋。サムネは admi=108×144 / kichifu=112×112（`data-thumb-w/h` でJSへ受け渡し）。
- **クライアント更新（`public/news-latest.js` 拡張・両サイト共通identical）**: 既存 `#top-news-list`（6件・小サムネ・h3・抜粋なし）に加え **`#news-archive-list`（全件・大サムネ・h2・お知らせのみ抜粋）も処理**。`/news` も news-latest.js を読み込み→デプロイ不要で最新お知らせ/写メ日記を反映（topと同じSSG+クライアント補正パターン）。
- **抜粋バグ修正**: お知らせ本文は `<style>` アニメCSSブロックを含む。旧 `replace(/<[^>]*>/g,'')` だとタグ内のCSSコードが抜粋に漏れていた（`@keyframes heart-beat...` が表示）。`replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,'')` でブロックごと除去＋`replace(/\s+/g,' ')` で空白正規化。SSG/JS両方に適用。

### CTRL 女性編集の画像をドラッグ並べ替え可能に＋表示順番号
- **要望**: `girl-edit.php` の画像セクションで順番をソート＆順番を表示。
- **`ctrl/girl-edit.php`**: 画像カードを `draggable` 化（`#img-sort` コンテナ）、左上に順番バッジ（`.img-order-no`、①②③…=メイン写真が①）。flex-wrap グリッド対応のドラッグ（中心X基準で前後判定）、drop で `girl_images.sort` を**即保存**（`reorder-images` アクション）＋番号振り直し。削除時も番号振り直し＋order再保存。
- **`ctrl/girl-actions.php`**: `reorder-images` アクション追加。`UPDATE girl_images gi JOIN girls g ON g.id=gi.girl_id SET gi.sort=? WHERE gi.id=? AND g.shop_id=?` で**自店舗の画像のみ**スコープ更新。
- CTRL runtime=admi2888のみ、ソース=`astro-kichifu/ctrl/`（deploy-prod-admi2888.sh が `../astro-kichifu/ctrl/` を rsync）。本番デプロイ済み。
- **詳細ページ `/girls/{id}` の画像順も即反映（`public/girl-detail-refresh.js` に syncGallery 追加・両サイト共通identical）**: 症状＝CTRLで画像を並べ替えるとカード(girl-visibility.js)は変わるが詳細ギャラリーはSSG焼き込みで旧順のまま。`girl-detail-refresh.js` は従来テキスト3項目のみ更新だった。→ API detail の `images`(sort順) で `#girlMainPhoto` + `.girl-sub-photos` を作り直す（`asset()`で絶対URL化、並び一致時は触らずチラつき防止、1枚→複数追加時は `.girl-sub-photos` 新規生成）。`site.js` のサムネ切替/ライトボックスは**イベント委譲+`getGallery()` 都度読み**なので innerHTML 差替でも動作継続。デプロイで SSG も新順に再ビルド（即時はクライアント補正、SEOは静的版）。両サイト本番反映確認済。

### CTRL 女性一覧(`girls.php`)に並び替え追加（出勤頻度/入店順・手動ドラッグ順は廃止）
- **要望**: girl-edit の画像同様、女性一覧も「出勤頻度・入店順」で並べ替え。**手動ドラッグ順は不要（ユーザー指示で削除）**。並び替えselectは名前検索の下に配置。
- **`ctrl/girls.php`**: `?sort=freq|indate`（既定=`freq`、toolbar の `<select onchange=submit>`、`flex-basis:100%` の改行divで名前検索行の下に配置）。
  - `freq`=出勤頻度高い順(`wc DESC,in_date DESC,id DESC`)。`indate`=入店新しい順(`in_date DESC,id DESC`)。
  - `wc`=出勤頻度＝`schedules` の当店 `status='work'` 件数サブクエリ（news-edit と同集計、`s.shop_id=?` は `current_shop_id()`）。param順=wcサブクエリの`?`が先頭なので `array_merge([$shop],$args)`。
  - 先頭列は freq時=出勤回数(○回) 表示 / indate時=空。ドラッグ並べ替えJS/ハンドル/draggable/`reorder`は撤去（girl-actions.php の `reorder` 自体は残置・未使用）。
  - `$baseQ`/pager に `sort` 引継ぎ。本番デプロイ済み。
  - ⚠️ デプロイ事故メモ: `./deploy-prod-admi2888.sh > log 2>&1 | tail` のように **`| tail` でパイプすると exit code が tail の0になり失敗を見逃す**。`> log 2>&1; echo $?` で正確に取得すること。今回ネット切断中に3回 SSH timeout(255) するも tail で 0 と誤認。
- **抜粋バグ修正**: お知らせ本文は `<style>` アニメCSSブロックを含む。旧 `replace(/<[^>]*>/g,'')` だとタグ内のCSSコードが抜粋に漏れていた（`@keyframes heart-beat...` が表示）。`replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,'')` でブロックごと除去＋`replace(/\s+/g,' ')` で空白正規化。SSG/JS両方に適用。
- 検証: ビルド成功・プレビューで交互表示/バッジ/画像/抜粋確認・本番両サイトで写メ日記30件反映確認。
