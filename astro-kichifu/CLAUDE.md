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

## デプロイ（GitHub Actions: `.github/workflows/deploy-kichifu.yml`）
- トリガー: `main` への push で `astro-kichifu/**` が変わった時のみ（yobuho の deploy.yml は `paths-ignore` で除外済み → 二重デプロイなし）。手動実行(workflow_dispatch)も可
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
- **Cloudflare 経由化**: NS→cosmin/galilea(yobuho同アカ)、SSL=Full、Always Use HTTPS ON。**Xアクセラレータ=OFF**（CF非経由時にAPIを空/古キャッシュする固着問題のため。kichifuはVer.2のまま）。
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

### memory 追加
[[feedback_admi2888_api_shared_with_kichifu]] / [[feedback_admi2888_xaccelerator_api_cache]] / [[feedback_ctrl_asset_cache_buster_mtime]] / [[feedback_ctrl_image_origin_kichifu]] / [[feedback_yobuho_deploy_rsync_retry]] / [[project_kichifu_fujoho_diary_import]]
