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
- **top ヒーロー＝バナースライダー** `hero-slider`: 上部バナーを横長スライダー（自動5秒・‹›矢印・ドット、`public/banner-slider.js`）。バナー0件時のみ簡易ロゴヒーローにフォールバック。
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
