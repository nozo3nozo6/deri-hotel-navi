# Deri Hotel Navi

呼べるホテル検索ポータル「YobuHo」- デリヘル/女風/同性利用可能なホテルの口コミ検索サービス

## Stack
- Frontend: Vanilla JS (5モジュール), HTML 9ページ — 全ページSupabase依存ゼロ（PHP API経由）
- DB: MySQL (MariaDB) on シンレンタルサーバー — 全PHP APIがdb.php経由で接続
- Data: 静的JSON（area-data.json, master-data.json, hotel-data/） + PHP API
- Deploy: シンレンタルサーバー（sv6051.wpx.ne.jp、旧 sv6825 から 2026-04-21 移行完了 / MariaDB 10.5→10.11）via rsync over SSH (port 10022)、pushで自動デプロイ
- Hotel data: 43,580件（元: Rakuten Travel API + Yahoo!ローカルサーチAPI、source統一済み→imported/manual）
- Search: Pagefind + Fuse.js（Web Worker）ハイブリッド検索
- CDN: Cloudflare Free（SSL Full）
- Map: Leaflet + OpenStreetMap
- Geocoding: Nominatim (OpenStreetMap)
- Monitoring: UptimeRobot（5分間隔）

## DB
- MySQL (MariaDB): シンレンタルサーバー上、api/db-config.phpで接続情報定義（deploy.ymlでGitHub Secretsから生成）
- ローカル接続: SSHトンネル（ssh -p 10022 -L 3307:localhost:3306）+ db-local.js
- SMTP: hotel@yobuho.com（sv6051.wpx.ne.jp:587）— Magic Linkテンプレートカスタマイズ済み

## Project Structure
```
deri-hotel-navi/
├── index.html                 ゲートページ（モード選択）
├── portal.html               メインポータル
├── admin.html                管理画面（PHP認証）
├── shop-register.html        店舗登録（メール→プロフィール→確認）
├── shop-admin.html           店舗管理画面
├── legal.html / terms.html / privacy.html / contact.html  法的ページ
│
├── api-service.js            API呼び出し、マスタデータ、AppState
├── ui-utils.js               Toast、モーダル、i18n（日英中韓）、extractCity()
├── area-navigation.js        エリアナビ、REGION_MAP、URL状態管理
├── hotel-search.js           ホテル検索/表示、ラブホタブ、地図、GPS検索
├── form-handler.js           投稿フォーム、フラグ報告、掲載リクエスト
├── portal-init.js            ポータル初期化、イベント委譲
├── fuse-worker.js            Fuse.js Web Worker（メインスレッド非ブロック検索）
├── style.css                 全スタイル（テーマ変数、レスポンシブ）
│
├── api/
│   ├── auth.php              admin認証（セッション、レート制限）
│   ├── db-config.php         DB接続設定（デプロイ時にGitHub Secretsから生成、コミットしない）
│   ├── admin-api.php         管理統合API（CRUD/dashboard/reorder/reports-all/hotels-search/hotel-cascades/ad管理）
│   ├── submit-report.php     ユーザー投稿（レート制限、不正検知、CORS制限）
│   ├── submit-vote.php       口コミ評価（helpful/unhelpful、重複チェック）
│   ├── submit-loveho-report.php ラブホ口コミ投稿（レート制限）
│   ├── submit-flag.php       投稿報告（フラグ更新、reports/loveho_reports対応）
│   ├── submit-hotel-request.php 未掲載ホテル情報提供（レート制限）
│   ├── hotels.php            ホテル検索統一エンドポイント（フィルタ/キーワード/駅/GPS）
│   ├── hotel-detail.php      ホテル詳細+口コミ+店舗情報（loadDetail用）
│   ├── report-summaries.php  レポートサマリー一括取得（ホテル一覧用）
│   ├── area-shops.php        エリア内案内可能店舗
│   ├── ads.php               広告配置データ
│   ├── shop-info.php         店舗モード情報（initShopMode用）
│   ├── submit-shop.php       店舗登録（service key、RLS回避、bcryptハッシュ化）
│   ├── verify-password.php   パスワード検証（bcrypt対応、レガシーBase64自動移行）
│   ├── send-mail.php         メール送信（HTML対応、CORS制限）
│   ├── shop-auth.php         店舗セッション管理（login/check/profile/thumbnail/email）
│   ├── shop-hotel-api.php    店舗ホテルCRUD（登録/編集/削除/ラブホ、セッション認証必須）
│   └── db.php                DB接続ヘルパー（db-config.php読み込み、PDO接続）
│
├── sql/
│   ├── add-indexes.sql       パフォーマンスインデックス
│   ├── contract_plans.sql    契約プラン
│   ├── shop_hotel_info.sql   店舗ホテル情報
│   ├── shop_service_options.sql  店舗サービス
│   ├── reports_add_shop_id.sql   reports拡張
│   └── ad_banner_columns.sql     広告バナー
│
├── generate-sitemap.js       サイトマップ生成
├── generate-search-index.js  Fuse.js用検索インデックス生成
├── generate-pagefind-index.mjs  Pagefindインデックス生成（pagefind-data.json→pagefind/）
├── db-local.js               ローカルMySQL接続ヘルパー（SSHトンネル経由）
├── area-data.json            エリアナビ事前計算データ（PHP APIで生成）
├── master-data.json          マスタデータ（PHP APIで生成、2.7KB）
├── hotel-data/               都道府県別ホテルJSON（PHP APIで生成、17MB）
├── search-index.json         Fuse.js検索インデックス（6.5MB raw, 1.4MB gzip）
├── pagefind-data.json        Pagefind用データ（generate-pagefind-data.phpで生成）
├── pagefind/                 Pagefindインデックス（generate-pagefind-index.mjsで生成）
│
├── astro-src/src/pages/       サブドメインLP + ガイドページのソース（Astro SSGでビルド）
│   ├── deli/index.astro      デリヘル専用LP → portal.html?mode=men
│   ├── jofu/index.astro      女風専用LP → portal.html?mode=women
│   ├── same/index.astro      同性利用専用LP → portal.html?mode=men_same
│   ├── loveho/index.astro    ラブホLP → portal.html
│   ├── guide/deli-hotel.astro   デリヘルホテルガイド
│   ├── guide/jofu-hotel.astro   女風ホテルガイド
│   └── guide/lgbt-hotel.astro   LGBTホテルガイド
│   ※ ビルド後 dist/*.html → サーバーの *.yobuho.com/index.html にデプロイ
│
├── .github/workflows/deploy.yml  GitHub Actions デプロイ
├── .env                      環境変数（コミットしない）
└── CLAUDE.md                 このファイル
```

## Pages詳細

### index.html — ゲートページ
- モード選択: men / women / men_same / women_same / shop
- サブドメインリンク（deli.yobuho.com等）

### portal.html — メインポータル
- エリアナビ: 地方→都道府県→エリア→詳細エリア→市区町村→ホテル一覧
- ホテル/ラブホタブ切り替え
- キーワード検索（ホテル名+住所）、最寄駅検索
- GPS現在地リスト表示（Nominatim逆ジオコーディング→市区町村→距離順）
- 地図表示（Leaflet、現在地ボタン、マーカーから詳細表示→地図は上に残る）
- 口コミ投稿フォーム（呼べた/呼べなかった、理由、部屋タイプ、時間帯）
- ラブホ口コミ（一人入室、雰囲気、チェックポイント、複数人OK）
- 投稿報告（フラグ）機能
- 掲載リクエストモーダル
- 店舗広告表示（エリア別、プラン別）
- キャッシュバスター: deploy.ymlでgitハッシュに自動置換（手動更新不要）
- サブドメイン方針: 全サブドメイン（deli/jofu/same/loveho）はランディングページ方式（HTMLのみ、JS不要）。検索・投稿は全てportal.htmlに集約

### admin.html — 管理画面（Supabase依存ゼロ）
- PHP認証（api/auth.php、セッション: $_SESSION['user_id']）
- データ取得: admin-api.php統合エンドポイント（112箇所のsb.from()→fetch()に移行完了）
- ダッシュボード（統計、未対応タスクカード）
- 投稿管理（reports + loveho_reports統合、フラグ対応、編集/非表示/削除）
- 店舗管理（審査、プラン、ステータス管理）
- ホテル編集（地方→都道府県→市区町村カスケード、住所検索、ソースフィルタ: imported/manual）
- 掲載リクエスト管理（確認済/削除→admin-api.php経由）
- 広告配置管理（バナー画像対応）
- 営業メール送信
- マスタデータ管理: 呼べた理由、呼べなかった理由、部屋タイプ、契約プラン、店舗サービス、チェックポイント、雰囲気
- ハンバーガーメニュー（モバイル対応）

### shop-register.html — 店舗登録
- ライトテーマ（shop-adminと統一）
- ステップ1: ジャンル選択+メール入力 → Magic Link送信（スピナーUI）
- ステップ2: プロフィール入力（店舗名/URL/TEL/パスワード/届出確認書）
- ステップ3: 確認 → submit-shop.php経由で登録（RLS回避）
- ジャンル自動判定: URLパラメータ(?genre=)、リファラー、localStorage
- 届出確認書: Base64でdocument_urlに保存
- セッション: キャッシュ+タイムアウト+localStorageフォールバック（ロックハング対策）
- ステータス: email_pending → registered → active

### shop-admin.html — 店舗管理画面（Supabase依存ゼロ）
- ログイン: shop-auth.php PHPセッション認証、パスワード表示チェック、パスワードリセット機能（6桁認証コード）
- データ取得: shop-auth.php / shop-hotel-api.php / hotels.php / master-data.json / area-data.json
- 掲載状況カード: ジャンル表示、ステータス、プラン、店舗専用URL、サムネイル画像アップロード（有料のみ）
- ホテル情報登録（呼べる/呼べない、交通費、サービス、メモ）
- ラブホ口コミ投稿（チェックイン方法、交通費、雰囲気、チェックポイント）
- ホテル/ラブホ統一表示（カードデザイン、💬口コミ件数、登録済みバッジ）
- 登録済み: 「✏️ 編集」+「投稿削除」ボタン / 未登録: 「📝 情報登録」ボタン
- フォーム排他制御: ホテル/ラブホフォームは同時に1つのみ表示
- 投稿者名: 店舗名で固定（読み取り専用）
- 1店舗1ホテル1件制限（既存あればupsert）
- エリアナビ（ポータルと統一、ソート順も統一: 口コミ件数→タイプ→名前）
- キーワード検索（ラブホ選択時はラブホフォーム自動切替）
- お気に入りエリア機能（⭐のみ表示、ツールチップ説明）
- 設定: メールアドレス変更（認証コード）、パスワード変更（表示チェック付き）
- メールアドレス変更のパスワード入力: 表示チェックなし（セキュリティ重視）

## Gender modes
- men: 男性用デリヘル（赤黒金テーマ #9b2d35）
- women: 女性用風俗（ローズレッドテーマ #b5627a）
- men_same: 男性同士（ネイビー/コバルトブルー #2a5a8f）
- women_same: 女性同士（ミディアムパープル/ラベンダー #8a5a9e）

## Tables

### hotels (43,580件)
id, name, address, prefecture, city, major_area, detail_area, hotel_type, source (imported/manual), review_average, nearest_station, postal_code, tel, latitude, longitude, is_published, is_edited, created_at, updated_at

### reports
id(UUID), hotel_id, can_call, poster_type(user/shop), poster_name, shop_id, can_call_reasons[], cannot_call_reasons[], time_slot, room_type, comment, multi_person, guest_male, guest_female, multi_fee, gender_mode, fingerprint, ip_hash, is_hidden, flagged_at, flag_reason, flag_comment, flag_resolved, created_at

### loveho_reports
id(UUID), hotel_id, solo_entry(yes/no/together/lobby/unknown), atmosphere, good_points[], time_slot, comment, poster_name, multi_person, guest_male, guest_female, multi_fee, gender_mode, is_hidden, flagged_at, flag_reason, flag_comment, flag_resolved, created_at
※ recommendation, cleanliness, cost_performance カラムはDB上残存するがUI非表示・新規投稿でnull固定

### shops
id(UUID), email, auth_user_id, shop_name, gender_mode, shop_url, shop_tel, phone, website_url, document_url, thumbnail_url, area, prefecture, status(email_pending/registered/active/suspended/revision_required/rejected/deleted), plan_id, contract_status, password_hash, slug, denial_reason, approved_at, deleted_at, last_login_ip_hash, created_at, updated_at

### shop_hotel_info
id, shop_id, hotel_id, can_call, transport_fee, memo, created_at, updated_at

### shop_hotel_services (junction)
id, shop_hotel_info_id, service_option_id

### hotel_requests
id, hotel_name, address, tel, hotel_type, status(pending/confirmed), created_at

### hotel_report_summary (ビュー)
hotel_id, total_reports, user_can_call, user_cannot_call, shop_can_call, shop_cannot_call

### ad_placements
id, placement_type, placement_target, status, mode, shop_id, banner_image_url, banner_link_url, banner_size, banner_alt

### マスタデータテーブル
- can_call_reasons: id, label, sort_order
- cannot_call_reasons: id, label, sort_order
- room_types: id, label, sort_order
- contract_plans: id, name, price, description, sort_order
  - 1:無料プラン(¥0) 2:市区町村(¥11,000) 3:エリア(¥27,500) 4:都道府県(¥55,000)
  - 5:3市区町村パック(¥27,500) 6:5市区町村パック(¥44,000) 7:エリア+3市区町村パック(¥49,500)
- shop_service_options: id, name, sort_order, is_active
- loveho_good_points: id, label, category(設備・お部屋/サービス・利便性), sort_order, is_active
- loveho_atmospheres: id, name, sort_order
- report_votes: id, report_id, voter_fingerprint, vote_type

## API endpoints

### api/auth.php
- action=login: POST {username, password} → セッション開始
- action=logout: POST → セッション破棄
- action=check: GET → ログイン状態確認
- action=change-password: POST {old_password, new_password}
- セッション: $_SESSION['user_id'], $_SESSION['last_activity']
- レート制限: 5回失敗で900秒ロックアウト

### api/admin-api.php
- action=update: POST {table, id, data} → service keyでUPDATE
- action=delete: POST {table, id} → service keyでDELETE
- 許可テーブル: hotel_requests, shops, shop_placements, reports
- PHP認証セッション必須

### api/submit-shop.php
- POST: 店舗登録（service key経由でshopsテーブルにUPSERT）
- 届出確認書画像はBase64でdocument_urlカラムに保存
- パスワードリセットモード: shop_name='_pw_reset_'でpassword_hashのみ更新
- パスワードはクライアントからBase64で受信→PHP側でbcryptハッシュ化して保存

### api/verify-password.php
- POST: {email, password} → パスワード検証
- bcryptハッシュ($2で始まる): password_verify()で検証
- レガシーBase64: base64_decode()で比較→一致時に自動bcrypt移行
- レスポンスからpassword_hashを除外（セキュリティ）

### api/submit-report.php
- POST: レポート投稿
- レート制限: IP 10件/24h、fingerprint 3件/ホテル（REMOTE_ADDR使用、X-Forwarded-For無視）
- 店舗IP検知（不正投稿防止）
- CORS: yobuho.com + サブドメインのみ許可

### api/send-mail.php
- HTML形式メール送信（UTF-8 Base64エンコード）
- 登録確認メール、承認メール、パスワードリセット認証コード送信
- CORS: yobuho.com + サブドメインのみ許可

### api/shop-auth.php
- action=login: POST {email, password} → PHPセッション開始、shop data返却
- action=check: GET → セッション有効性チェック（ページリロード時）
- action=profile: GET → shop + shop_contracts + contract_plans JOIN（ステータスカード）
- action=update-thumbnail: POST {thumbnail_url} → サムネイル更新/削除
- action=update-email: POST {new_email} → メールアドレス変更
- action=update-slug: POST {slug} → URLスラッグ更新（バリデーション+重複チェック）
- action=lookup-email: GET {email} → パスワードリセット用メール存在確認
- セッション: $_SESSION['shop_id'], $_SESSION['shop_email'], $_SESSION['last_activity']
- Cookie: httponly, samesite=Strict, secure, domain=yobuho.com
- タイムアウト: 86400秒（24時間）

### api/shop-hotel-api.php
- action=registered-ids: GET → 登録済みhotel_idリスト
- action=registered-list: GET → 登録済みホテル一覧（hotels JOIN）
- action=get-info: GET {hotel_id} → shop_hotel_info + service_ids
- action=get-transport-fee: GET {hotel_id} → transport_fee
- action=get-existing-loveho: GET {hotel_id, poster_name} → 既存ラブホレポート
- action=save-hotel-info: POST → report + info + services 一括トランザクション保存
- action=save-loveho-info: POST → ラブホレポート + transport_fee 一括トランザクション保存
- action=delete-info: POST {info_id} → services + info 削除
- 全action: PHPセッション認証必須（shop-auth.phpのセッション共有）

## Key logic

### エリアナビゲーション (area-navigation.js)
- REGION_MAP: 11地方（北海道〜沖縄）→47都道府県
- 階層: 地方→都道府県→エリア(major_area)→詳細エリア(detail_area)→市区町村(city)→ホテル一覧
- URL状態管理: ?mode=men&pref=東京都&area=東京２３区内&city=渋谷区
- 静的JSON方式: area-data.jsonから事前計算済みデータを読み込み（Supabase APIコール0回）
- フォールバック: JSONが取得できない場合のみSupabaseに直接クエリ
- _areaGeneration: 世代カウンタでレースコンディション防止

### ホテル検索 (hotel-search.js)
- 外部リンク: モバイル=同タブ(_self)、PC=新タブ(_blank)（_extTarget変数で判定: ontouchstart/maxTouchPoints）
- ラブホタブ件数: area-data.jsonから取得（フォールバック: Supabaseクエリ）
- ソート: 口コミ件数→最新投稿日時→ホテルタイプ→名前（ホテル/ラブホ共通）
- GPS検索: Nominatim→市区町村名でDB検索→都道府県で補完→距離順60件
- 都道府県名正規化: ISO3166-2-lvl4マッピング（JP-13→東京都等）
- 地図: Leaflet、ホテル(青)/ラブホ(ピンク)マーカー、現在地ボタン
- 地図詳細: マーカークリック→地図は上に残り詳細は下に表示(map-detail-content)

### 広告・掲載ルール
- 「この地域で案内できる店舗」: 有料プラン店舗のみ表示（ジャンル一致）
- 無料店舗: 店舗名テキストのみ（リンクなし）
- 有料店舗: 店舗名リンク付き + サムネイル画像（あれば）
- 口コミ内の店舗名: 有料=リンクあり、無料=テキストのみ
- 掲載停止中(suspended)の店舗: 広告非表示
- エリア枠: 市区町村5店舗、エリア5店舗、都道府県3店舗
- ジャンル別独立枠（men/women/men_same/women_same）

### 投稿ルール
- ユーザー投稿: ポータルから（レート制限あり）、全ジャンル共通表示
- 店舗投稿（情報提供）: shop-adminのみ、そのジャンルのポータルのみ表示（gender_mode一致必須）
- 店舗投稿制限: 1店舗1ホテル1件（upsert: 既存あればupdate）
- ラブホ店舗投稿: チェックイン方法 + 入室方法（front/direct/lobby/waiting） + 交通費
- 表示順: ①有料プラン高い順→更新日時新しい順 ②無料プラン→更新日時新しい順 ③停止中→更新日時新しい順（ホテル/ラブホ共通）
- 掲載停止中(suspended)の店舗投稿: ポータルから完全非表示（統計・件数カウントからも除外、DBデータは保持）
- 表示順更新: 全プラン共通、30日サイクルで自動的に新鮮扱い（ポータル側ソート計算、DB更新不要）
- 口コミ表示: 5件超はスクロール枠（420px）、フィルタータブ（呼べた/呼べなかった等、1行タブスタイル）
- ホテル投稿フォーム: ホテル名を小さいフォントで表示
- ラブホ投稿フォーム: ホテル名を小さいフォントで表示
- 店舗→ご案内実績有バッジ（solo_entry=yes/together）、ユーザー→一人で入れた/入れなかったバッジ

### loveho_reports追加カラム
- entry_method: front/direct/lobby/waiting（入室方法）
- updated_at: timestamptz（表示順用）

### shop_contracts テーブル（複数プラン対応）
- id, shop_id, plan_id, created_at
- 1店舗が複数プランを同時契約可能
- PLAN_LIMITS: 各プランのエリア枠数（city/spot/prefecture）

### CSP (Content Security Policy)
- portal.html: connect-src に Supabase, Nominatim, msearch.gsi.go.jp, unpkg.com, cdn.jsdelivr.net を許可
- frame-ancestors: metaタグでは無効のため全ページから削除済み

### RLS (Row Level Security)
- 全テーブル: SELECT = public (true)
- reports: INSERT = public, UPDATE/DELETE = admin-api.php経由
- hotel_requests: INSERT = public, UPDATE/DELETE = admin-api.php経由（anon keyではブロック）
- shops: INSERT = signup時, UPDATE = admin/shop-admin
- hotels: INSERT/UPDATE/DELETE = admin

## 修正履歴
### 2026年3月15日 — analysis-report.html 全78件修正完了
- CRITICAL 6件: APIキー露出、CLAUDE.mdから秘密情報削除、.env gitignore確認、Supabase RLS制限、nullチェック追加、キャッシュバスター更新
- HIGH 19件: XSS修正(6箇所)、CSP追加(4ファイル)、aria属性、defer読み込み、og:image追加、viewport修正、Escapeキー対応、JSON-LD動的更新等
- MEDIUM 22件: CLS対策、canonical修正、メディアクエリ拡充、z-index変数化、セマンティックHTML等
- LOW 16件: 全対応済み
- ogp.png: サーバー(/public_html/)にアップロード済み

### 2026年3月17日 — admin/portal/shop-admin多数修正
- admin: Yahoo!APIフィルタ、住所検索、カスケード絞込、detail_area修正、掲載リクエストRLS修正(admin-api.php新設)、雰囲気マスタ、投稿編集改善、head:true修正、is_approved修正
- portal: ラブホソート修正、地図現在地ボタン、GPS精度改善、CSP修正(Nominatim許可)、都道府県名正規化、地図UI改善、frame-ancestors削除
- shop-admin: 店舗用ラベル(チェックイン方法)、投稿者名固定、1店舗1ホテル1件制限(upsert)、ラブホフォーム自動切替、エリアナビ統一、お気に入りエリア機能

### 2026年3月19日 — UI/UX改善・投稿表示ルール整備
- ラブホタブ: ダークムードデザイン（エロチック切替、全モード共通）
- 女性モード: ときめきデザイン（角丸、グラデーション、ホバーアニメ）
- 口コミ表示: 店舗/ユーザー分離（ラブホ）、5件超スクロール枠、フィルタータブ（1行タブスタイル）
- 入室方法: entry_methodカラム追加、モード別ラベル（キャスト/セラピスト）
- gender_modeフィルタ厳密化: 店舗投稿は完全一致のみ（nullは非表示）
- 表示順: 30日自動更新サイクル（ポータル側計算、DB不要）
- ホテル詳細→前へ: パンくず・タブ復元修正
- admin: 複数プラン対応（shop_contracts）、掲載エリアプルダウン連動、枠数制限
- admin: 400エラー修正（flag_resolved is null）、CSP cdn.jsdelivr.net追加
- shop-admin: 編集モーダル化、未掲載ホテル情報提供、ホテルリストスクロール枠
- favicon: shop-admin用「s」追加

### 2026年3月17-18日 — 店舗登録フロー完成・広告プラン再設計
- SMTP設定: hotel@yobuho.com（Magic Linkテンプレートカスタマイズ）
- 店舗登録: セッションロック対策、Storage→Base64保存、RLS回避(submit-shop.php)
- send-mail.php: mb_send_mail→mail()でUTF-8文字化け修正
- shop-register.html: ダーク→ライトテーマ、ジャンル自動判定、スピナーUI
- shop-admin.html: パスワードリセット機能、サムネイルアップロード(有料のみ)、ホテル/ラブホ統一表示、フォーム排他制御、交通費(ラブホ)
- admin.html: 掲載開始=無料プラン自動セット、プラン変更(掲載中のみ)、一覧ボタン統合(📄審査/✏️編集)、掲載停止店舗の広告非表示
- ポータル: 有料店舗のみ「📢掲載店舗」表示(サムネイル+リンク)、無料はテキストのみ、ラブホ口コミに交通費表示
- contract_plans: 7プランに再設計(無料/市区町村¥11K/エリア¥27.5K/都道府県¥55K/パック3種)
- shops: thumbnail_urlカラム追加
- favicon.ico/favicon-admin.ico追加（Y/a）
- shop-adminとポータルのホテルリスト一致修正(major_areaフィルタ/ソート統一)

### 2026年3月19日 — SEO全面強化
- portal.html: twitter:card→summary_large_image、twitter:title/description/image追加、og:image:alt追加
- portal.html: JSON-LD強化（SearchAction+BreadcrumbList+Organization+provider）
- portal.html: H1キーワード最適化（呼べるホテル検索 YobuHo よぶほ ヨブホ）、clip-path:inset()に変更
- portal.html: metaキーワード21語に拡張（女風/レズビアン/ゲイ/LGBT/デリバリーヘルス/出張ヘルス等）
- portal.html: フッターSEOテキスト3段落+サブドメイン相互リンク追加
- index.html: metaキーワード14語に拡張、twitter:card強化、JSON-LD（WebSite+Organization）追加
- index.html: フッターSEOテキスト+全サブドメインリンク追加
- ui-utils.js: MODE_DESC_MAP追加（モード別description動的更新）、OGタグ動的更新
- ui-utils.js: TITLE_SUFFIX_MAP修正（women_same/men_same→Same YobuHo）
- サブドメイン全4ページ: og:image+twitter強化+favicon+キーワード拡張+フッターSEOテキスト+相互リンク
- shop-register.html: title/description/keywords強化（広告・集客キーワード）
- robots.txt: Disallow追加（/sql/, /scripts/, *.bak）
- .htaccess: セキュリティヘッダー追加、キャッシュ拡充（画像/JSON/ETag）、XML圧縮追加
- sitemap.xml: 192→398 URL（lovehoサブドメイン追加、主要都市×モード別URL追加）
- generate-sitemap.js: MAJOR_CITIES追加（15都道府県×主要都市）、URLエンコード対応
- Leafletモバイルタッチ修正: tap:false、touchZoom/doubleClickZoom有効化、touch-action:none
- SEOペナルティ修正: canonical動的化(mode+pref+city)、モードなし47ページ削除、すすきの削除、sitemap 398→349 URL

### 2026年3月19日 — 全チーム監査レポート対応（CRITICAL/HIGH/MEDIUM/LOW一括）
#### CRITICAL 5件（全完了）
- 非同期レースコンディション: area-navigation.jsに_areaGeneration世代カウンタ導入、全5つのasync関数(showPrefPage/showMajorAreaPage/showCityPage/showDetailAreaPage/showNoAreaCityPage)の各await後にif(gen!==_areaGeneration)returnガード追加。hotel-search.jsのfetchAndShowHotels/fetchAndShowHotelsByCityからも++_areaGenerationでエリアナビの古い処理をキャンセル
- currentHotelId未初期化: loveho-app.jsのdoSubmitReport()にif(!currentHotelId)ガード追加、leaveHotelDetail()でcurrentHotelId=nullリセット追加

#### HIGH 10件（全完了、うち7件は調査の結果既に対応済み）
- WCAGコントラスト修正: --text-3を濃い色に変更（women:#7a5a66→#6b4453, men_same:#566a88→#3d5478, women_same:#6a5a7a→#564568）→4.5:1以上達成
- XSS修正: ui-utils.js setBreadcrumb()のc.labelにesc()適用、loveho-app.js setBreadcrumb()も同様修正、hotel-search.jsのlocationLabelにesc()適用
- console.log全削除: 本番フロントエンド4ファイル(api-service.js/hotel-search.js/form-handler.js/loveho-app.js)から33件のconsole.log/warn/error削除

#### MEDIUM 15件完了（全17件中）
- フォント遅延読込: portal.htmlのGoogle Fonts URLからNoto Serif JPを分離、women/women_sameモードのみ動的link挿入
- 広告バナーCLS: renderAdHTML()のバナーimgにwidth/height属性+loading="lazy"追加、サムネイルimgにもwidth="48" height="64" loading="lazy"追加
- GPS エラー種別: 地図内の現在地ボタンのエラーコールバックにerr.codeベースのメッセージ分岐追加（権限拒否/取得不可/タイムアウト）
- モーダル背景クリック: ui-utils.jsにdocument.addEventListener('click')でmodal-overlayクラスのクリックを検知、MODAL_CLOSE_MAPでモーダルID→close関数をマッピング
- フォントサイズ12px統一: style.cssに15セレクタ(.mode-badge/.btn-location-label/.hotel-rating-star等)のfont-size:12px!important一括適用
- touch-action: 7セレクタ(.area-btn/.hotel-card-lux/.lang-btn/.breadcrumb-item/.filter-chip等)にtouch-action:manipulation追加
- CSRF: CORS制限(yobuho.comのみ)+Content-Type:application/json(preflight必須)で実質対策済みと判断
- フィンガープリント同意: privacy.html第1条に「端末識別情報（ブラウザフィンガープリント）」項目追加（ハッシュ値のみ記録、元データ非保存を明記）
- await漏れ修正: showHotelPanel()をasync化、loadLovehoDetail()/loadHotelDetail()呼び出しにawait追加
- composition重複: モジュールレベル登録で重複リスクなしを確認
- form-handler.js onclick除去: portal.htmlの全25箇所のonclick/oninputをdata-action/data-oninputに変換、portal-init.jsでイベント委譲
- CSP unsafe-inline削除: 3つのインラインscriptをportal-init.jsに外部化、script-src 'unsafe-inline'をCSPから削除
- AppState導入: api-service.jsにAppStateオブジェクト定義（nav/search/map/detail/form/timers/masterの7グループ）、Object.definePropertiesで既存let変数と双方向バインド

#### LOW 4件完了（全7件中）
- 横向き最適化: @media(orientation:landscape)and(max-height:500px)追加（モーダル高さ縮小、グリッド3列化）
- Leafletマーカータップ拡大: L.divIconのhtml内に44x44pxラッパーdiv追加、iconSize[44,44]に変更

#### 残タスク（新機能 — 要相談）
- ビジネス3件(MEDIUM): お気に入りホテル、最新24h口コミ、投稿感謝可視化
- パフォーマンス2件(LOW): Service Worker、CSS分割
- ビジネス3件(LOW): 営業ダッシュボード、メール購読、アクセス追跡
- 店舗2件: [x]店舗専用URL slug化完了、[x]ラブホタブ店舗差別化完了

## 残タスク一覧（2026-03-19 全チーム監査結果）

### CRITICAL（即座に対応）
- [x] セキュリティ: shop-admin.htmlのパスワードBase64保存→PHP側bcryptハッシュ化に統一（verify-password.php新設、submit-shop.phpでbcrypt変換）
- [x] セキュリティ: CORS `Access-Control-Allow-Origin: *` を submit-report.php, send-mail.php で制限（yobuho.com+サブドメインのみ許可）
- [x] セキュリティ: X-Forwarded-For偽装によるレート制限回避→REMOTE_ADDR優先に修正
- [x] コード品質: 非同期レースコンディション対策（_areaGeneration世代カウンタ導入、エリア高速切替時の古いデータ表示防止）
- [x] コード品質: currentHotelId未初期化チェック追加（loveho-app.js追加、leaveHotelDetailでリセット）

### HIGH（今月中に対応）
- [x] パフォーマンス: API limit(50)に既に削減済み
- [x] パフォーマンス: fetchReportSummaries + fetchLatestReportDates は既にPromise.allで並列化済み
- [x] パフォーマンス: Leaflet は既にensureLeaflet()で動的ロード済み
- [x] モバイルUX: women/men_same/women_sameの--text-3をWCAGコントラスト基準(4.5:1)に修正（women:#6b4453, men_same:#3d5478, women_same:#564568）
- [x] モバイルUX: モーダル高さは既にcalc(100dvh - 80px) + @media(max-height:667px)で対応済み
- [x] モバイルUX: 言語ボタン等のタッチターゲットは既に44px以上に設定済み
- [x] ビジネス: shop-register.htmlに料金表は既に追加済み
- [x] ビジネス: ホテルカードに「呼べた率」は既に表示済み（successRate計算+rateHTML）
- [x] セキュリティ: setBreadcrumbにesc()適用、locationLabelにesc()適用（XSS修正）
- [x] コード品質: 本番フロントエンド(api-service/hotel-search/form-handler/loveho-app)のconsole.log/warn/error全削除

### MEDIUM（中期対応）
- [ ] ビジネス: 「お気に入りホテル」機能（localStorage、マイホテルタブ）
- [ ] ビジネス: 「最新24h口コミ」セクション追加（portal.html エリアナビ直後）
- [ ] ビジネス: 投稿後の感謝可視化（投稿数カウント、認定レビュアーバッジ）
- [x] パフォーマンス: Noto Serif JPをwomen/women_sameモードのみ動的読込に変更
- [x] パフォーマンス: form-handler.js — onclick属性をdata-action化+portal-init.jsでイベント委譲に移行
- [x] パフォーマンス: 広告バナー<img>にwidth/height属性+loading="lazy"追加（CLS改善）
- [x] モバイルUX: GPS失敗時のエラー種別表示（地図ボタンにも適用: 権限拒否/取得不可/タイムアウト）
- [x] モバイルUX: モーダル背景クリックで閉じる機能追加（ui-utils.jsでイベント委譲）
- [x] モバイルUX: フォントサイズ最小12px以上に統一（15箇所修正）
- [x] モバイルUX: touch-action: manipulation を主要ボタンに追加（300ms遅延対策）
- [x] セキュリティ: CSRF対策 — CORS制限+Content-Type:application/jsonでpreflight必須のため実質対策済み
- [x] セキュリティ: フィンガープリント収集の同意取得（privacy.htmlに端末識別情報の項目追加）
- [ ] セキュリティ: CSP script-src 'unsafe-inline' 削除 — 静的HTMLのonclickはdata-action化済みだが、動的生成HTML（hotel-search.js/area-navigation.js等）のonclickが大量に残存。完全なイベント委譲化が必要。現在はunsafe-inline復元中
- [x] コード品質: AppStateオブジェクト導入（nav/search/map/detail/form/timers/masterの7グループ、Object.definePropertiesで既存変数と双方向バインド）
- [x] コード品質: loadLovehoDetail()/loadHotelDetail()のawait漏れ修正（showHotelPanelをasync化）
- [x] コード品質: compositionイベントリスナーはモジュールレベルで登録済み（重複なし）
- [x] セキュリティ: CSP unsafe-inline復元（動的生成HTMLのonclickが大量にあるため、完全なイベント委譲化まで必要）

### LOW（余裕があれば）
- [ ] パフォーマンス: Service Worker導入（オフラインキャッシュ）
- [ ] パフォーマンス: CSS分割（theme-men.css/theme-women.css）
- [x] モバイルUX: スマートフォン横向き最適化（@media orientation: landscape追加）
- [x] モバイルUX: Leafletマーカーのタップエリア拡大（28px→44pxラッパー追加）
- [ ] ビジネス: shop-admin.htmlに営業ダッシュボード（閲覧数/ホテル別アクセス数）
- [ ] ビジネス: メール購読オプトイン（週1回の新規口コミ通知）
- [ ] ビジネス: shop-redirect.phpでアクセス追跡（店舗リンククリック計測）
- [x] YobuChat: Cloudflare Durable Objects 移行完了（2026-04-20）
      - cf-worker/ 実装: ChatRoom.ts（DO本体）、sync.ts（MySQL ↔ DO双方向同期）、notify.ts（メール通知）、cors.ts
      - DO=配信専用、inbox/read_at は PHP 側が権威（feedback_yobuchat_do_split_brain.md 参照）

### 2026年3月19日（後半） — バグ修正・lovehoサブドメインLP化・フッター統一
#### バグ修正（前回会話の修正で混入した問題）
- hotel-search.js: バックスラッシュ混入5箇所除去（.limit(50)の前の\）→エリア検索復旧
- portal.html: CSP unsafe-inline復元（動的生成HTMLのonclickが未変換のためブロックされていた）
- hotel-search.js/api-service.js: contract_plansクエリパス修正（shops→shop_contracts→contract_plans に統一、4箇所）
- hotel-search.js/api-service.js: contract_plansデータ参照修正（shop.contract_plans?.price → Math.max(...shop_contracts.map())、4箇所）
- portal-init.js: MODE変数をwindow.MODEでグローバル公開（DOMContentLoaded内のvar宣言がスコープ外だった）
- form-handler.js: is_approved → status='active'に修正（存在しないカラム参照）
- shop-admin.html: loadStatusCard()のcontract_plansクエリパス修正（shop_contracts経由に変更）
- shop-register.html: sed一括削除で壊れた構文3箇所修正（console.log残骸除去）
- hotel-search.js: saveListState()をhideLovehoTabs()の前に移動（タブ復元修正）
- ui-utils.js: changeLang()のセレクタをdata-action/data-param対応に修正
- admin.html: s.plan → contractPlansData経由のplan_id価格判定に修正（2箇所）
- loveho-app.js: flags テーブル → loveho_reports の flagged_at 更新に修正

#### lovehoサブドメインLP化
- subdomain/loveho/index.html: 独自アプリ（1300行JS）→ランディングページ方式に全面書き換え
- loveho-app.js: 不要に（サーバーに残存するが読み込まれない）
- 方針決定: 全サブドメインはLP方式（HTMLのみ）、検索・投稿はportal.htmlに集約

#### ポータル改善
- hotel-search.js: ラブホ投稿フォームに星評価3項目追加（recommendation/cleanliness/cost_performance）
- form-handler.js: submitLovehoReportペイロードに星評価3項目追加
- shop-admin.html/shop-register.html: console.log除去

#### フッター統一（SEO内部リンク強化）
- terms.html/privacy.html/contact.html/legal.html/shop-register.html: フッターをポータルと統一（サブドメイン4リンク+トップ+店舗登録追加）

### 店舗専用URL・ラブホタブ（前回からの残タスク）
- [x] 店舗専用URL: /deli/shop/slug/ パスベース化（slug自動生成+編集UI+.htaccessリライト）
- [x] ラブホタブの店舗差別化: 認定/認証バッジ統一、広告自店舗表示
- [x] GitHub Secrets: DB_HOST/DB_NAME/DB_USER/DB_PASS の追加（deploy.ymlのdb-config.php生成用）

### パフォーマンス残課題
- [ ] ホテル一覧表示時のSupabaseクエリ速度改善（口コミデータはリアルタイム取得が必要、Redis等が理想だが現スタックでは限界）

### 2026年3月21日 — MySQL移行 Phase 7（クリーンアップ・Supabase完全除去）
- package.jsonから@supabase/supabase-js、pg、pagefind削除
- .envからSUPABASE_URL/KEY/SERVICE_KEY削除
- 不要スクリプト6ファイル削除: check_yokohama.js、migrate-to-mysql.js、build-search-index.mjs、generate-hotel-data.js、generate-master-data.js、generate-area-data.js
- Node.jsスクリプト3ファイルMySQL化（db-local.js経由）: import-rakuten.js、update-detail-area.js、scripts/import-yahoo-hotels.js
- api/auth-config.php削除（Supabase service key参照、もう不要）、api/migrate-passwords.php削除（一回限り）
- .eslintrc.jsonからsupabaseグローバル変数削除
- deploy.ymlのrsync exclude整理
- **Supabaseへの依存がコードベースから完全にゼロになった**

### 2026年3月21日 — MySQL移行 Phase 6（admin.html）
- admin.htmlからSupabase JS SDK完全除去（112箇所のsb.from()→0箇所）
- api/admin-api.php全面書き換え: 汎用CRUD（list/insert/update/delete/reorder）+ 特殊エンドポイント（dashboard/reports-all/hotels-search/hotel-cascades/shop-contracts/ad-contracts-list/ad-slot-count/ad-toggle-contract/ad-delete-contract）
- Supabase CDN削除、CSPからSupabase URL除去
- 許可テーブル18個: hotels, reports, loveho_reports, shops, shop_placements, shop_contracts, ad_placements, ad_contracts, hotel_requests, outreach_emails, can_call_reasons, cannot_call_reasons, room_types, shop_service_options, loveho_good_points, loveho_atmospheres, contract_plans, ad_plans
- JS側にapi()/apiGet()ヘルパー関数追加（credentials:'include'でPHPセッション共有）
- ホテルカスケードドロップダウン: hotel-cascadesエンドポイントで都道府県→エリア→市区町村のDISTINCT値取得

### 2026年3月21日 — MySQL移行 Phase 5（shop-admin.html）
- shop-admin.htmlからSupabase JS SDK完全除去（46箇所のsb.from()→0箇所）
- api/shop-auth.php新設: 店舗PHPセッション管理（login/check/profile/update-thumbnail/update-email/lookup-email）、24時間タイムアウト、httponly cookie
- api/shop-hotel-api.php新設: 店舗ホテルCRUD 8アクション（registered-ids/registered-list/get-info/get-transport-fee/get-existing-loveho/save-hotel-info/save-loveho-info/delete-info）、トランザクション使用
- api/hotels.php拡張: include_summary=1（hotel_report_summary LEFT JOIN）、type=all（ホテル+ラブホ同時検索）
- api/generate-master-data.php拡張: shop_service_optionsをmaster-data.jsonに追加
- エリアナビ: area-data.json静的JSON読み込み（Supabase 12〜17クエリ → 0クエリ）
- マスタデータ: master-data.json読み込み（Supabase 4クエリ → 0クエリ）
- ログイン: verify-password.php → shop-auth.php login（PHPセッション開始）
- セッション復元: localStorage → PHPセッション check（Cookie認証）

### 2026年3月20日 — SEO登録・Analytics・UI改善
#### SEO・検索エンジン登録
- Google Search Console: ドメインプロパティ登録（DNS TXTレコード認証）、サイトマップ349URL送信
- Bing Webmaster Tools: GSCからインポート
- google-site-verificationメタタグ追加（index.html/portal.html）
- sitemap.xml: &→&amp;エスケープ修正、deploy.ymlで自動生成追加
- 主要8ページのインデックス登録リクエスト

#### Google Analytics
- GA4 測定ID: G-250LFPCPCE
- 全公開ページ10ページにgtag埋め込み（admin/shop-admin/legal除外）
- CSPにgoogletagmanager.com/google-analytics.com追加

#### X (Twitter)・JSON-LD
- @yobuho_com作成、index.htmlのJSON-LD sameAsに追加

#### ホテル件数更新
- DB実数43,580件、全サイト表記「43,000件以上」に統一

#### 口コミ色分け（店舗 vs ユーザー）
- 店舗実績（🏪）: 緑#3a9a60（変更なし）
- ユーザー口コミ（📊）: 青#2196f3/#1976d2に変更（バー/タグ/タブ/ラベル）

#### 地図ダブルタップズーム
- tap:false削除、touch-action:none→manipulation、カスタムダブルタップハンドラー追加

#### shop-register.html改善
- 有料プラン料金表→「掲載無料！」+無料プランメリット7項目に変更
- メリット: 店舗名掲載/ご案内実績公式発信/認証バッジ/店舗専用URL/管理画面/43,000件対応/費用ゼロ

### 2026年3月20日（後半） — パフォーマンス大幅改善・外部リンク
#### エリアナビ静的JSON化（根本解決）
- 問題: showPrefPageのcount:exact,head:trueが7並列でタイムアウト（error 57014→500エラー）
- 原因: hotelsテーブル43,580件でCOUNTフルスキャン、インデックスなし
- generate-area-data.js: 全ホテルから地方→都道府県→エリア→市区町村の階層+件数を事前計算
- area-data.json (91.5KB): 静的JSONとしてWebサーバーから配信
- area-navigation.js: 全面書き換え、Supabase直接クエリ→JSON読み込み（フォールバック付き）
- エリアナビのAPIコール: 12〜17回 → 0回（初回1 fetchのみ）
- deploy.ymlにnpm ci + generate-area-data.jsステップ追加

#### DB最適化
- RPC関数: get_pref_hotel_counts（都道府県別カウント、フォールバック用）
- 部分インデックス: idx_hotels_pref_active ON hotels(prefecture) WHERE is_published=true AND hotel_type NOT IN loveho
- ANALYZE hotels実行（プランナー統計更新）
- RPC速度: 6.3秒 → 0.35秒

#### countクエリ全廃
- hotel-search.js: ラブホタブ件数をarea-data.jsonから取得（フォールバック: select id limit 50）
- loveho-app.js: ホテルタブ件数をselect id limit 50に変更
- showMajorAreaPage: noAreaCountをselect id limit 1の存在チェックに変更

#### 外部リンクのモバイル対応
- _extTarget変数: ontouchstart/maxTouchPointsでタッチデバイス判定
- モバイル: target="_self"（戻るボタンで戻れる、bfcacheで状態保持）
- PC: target="_blank"（従来通り新タブ）
- hotel-search.jsの全7箇所の外部リンクに適用

### 2026年3月22日 — CI/CD復旧・データクリーンアップ・インフラプロ仕様化・SEO・UI

#### CI/CD復旧
- SSH鍵: パスフレーズなしed25519に再生成（旧鍵はチャット露出のため無効化・削除済み）
- deploy.yml: ssh-agent方式→鍵ファイル直接指定に簡素化、actions v4→v5
- GitHub Secrets追加: DB_HOST, DB_NAME, DB_USER, DB_PASS
- SSH_PASSPHRASE削除（パスフレーズなし鍵のため不要）

#### データクリーンアップ
- min_charge（最安値）: DB全レコードNULL化 + コード全削除
- 楽天/Yahoo API痕跡除去: source='rakuten'/'yahoo'→'imported'統一
- 削除ファイル: import-rakuten.js, update-detail-area.js, scripts/import-yahoo-hotels.js, scripts/ディレクトリ
- .env APIキー削除、axios依存削除
- 住所正規化: 丁目/番地→ハイフン、全角数字→半角（3,159件）
- ホテル名: ハピホテ提携244件、ラブホグループ名189件削除

#### インフラプロ仕様化（7項目）
1. push時自動デプロイ（on: push: branches: [main] + workflow_dispatch）
2. キャッシュバスター自動化（gitハッシュで?v=自動置換）
3. Fuse.js Web Worker化（fuse-worker.js、メインスレッド非ブロック）
4. Cloudflare CDN導入（Free、SSL Full、NS変更済み）
5. デプロイ後の自動キャッシュPurge（Cloudflare API）
6. HTMLキャッシュ無効化 + JS/CSS/画像1年キャッシュ（.htaccess）
7. UptimeRobot監視（5分間隔、メール通知）

#### SEO改善
- titleタグ・OGP・descriptionをキーワード最適化
- ガイドページ3本追加（/guide/deli-hotel, jofu-hotel, lgbt-hotel）
- GSCインデックス登録リクエスト12URL

#### UI修正
- パンくず: 44pxタッチターゲット除去（行間空き解消）
- 言語ボタン: 4ボタン横並び→ドロップダウン化
- スマホ検索: debounce 800ms、最低3文字、blur()、scrollTo(0,0)
- サブドメインfavicon修正、CSPにCloudflare Insights許可

#### 検索品質改善
- hybridSearch()にキーワード一致度ソート追加（完全一致>先頭一致>部分一致>その他）

### 2026年3月25日 — キャッシュ修正・esteバグ修正・テーマ最終決定・確認ダイアログ・掲載エリアUX改善・detail_area再配分

#### detail_area再配分（8ブロック、413件更新）
- 目的: 1つのdetail_areaに偏っていた大規模ブロックの市区町村を再配分してバランス改善
- 福岡/博多: 博多駅周辺→博多駅・博多に統合、太宰府・二日市（筑紫野/太宰府/春日/大野城/那珂川）分離、博多南（城南区/志免町）分離
- 神奈川/湘南: 藤沢/平塚/茅ヶ崎/大磯/二宮→藤沢・茅ヶ崎・平塚に移動（101:67）
- 千葉/舞浜・船橋: 船橋/八千代/習志野/千葉市→船橋・幕張に移動（59:62）
- 千葉/松戸・柏: 柏/野田/印西/白井/我孫子→柏・野田に移動（13:34）
- 埼玉/大宮・浦和: 川口/蕨/戸田→川口・蕨・戸田に移動（48:23）
- 埼玉/川越・東松山: 東松山/鶴ヶ島/坂戸/比企郡/入間郡→東松山・坂戸に移動（32:22）
- 大阪/堺・岸和田: 岸和田/泉佐野/貝塚/泉南/阪南/泉南郡→岸和田・関空・泉佐野に移動（49:82）
- 愛知/豊田・岡崎: 岡崎/安城/碧南→岡崎・安城に移動（55:41）
- area-data.json再生成済み

#### .htaccessキャッシュ修正
- ExpiresByType application/json 削除（PHP APIレスポンスまでキャッシュされていた根本原因）

#### esteモードバグ修正
- area-shops.php / submit-shop.php に este モード追加（400エラー修正）

#### テーマ最終決定
- esteテーマ: 紫→ゴールド→ネオンティール→パステルティール(#2aa8b8)に最終決定
- ラブホタブ: ダークワイン紫→ソフトピンク(#fff0f3)にリデザイン

#### 確認ダイアログ一括追加
- 全画面の投稿・編集・追加アクションに確認ダイアログ追加（ポータル/admin/shop-admin、計20+箇所）

#### admin CSP修正
- CSPに `https://static.cloudflareinsights.com` 追加（Cloudflare Insights許可）

#### 掲載エリア管理モーダルUX改善（admin.html）
- モーダル上部にプログレスバー付き残り枠サマリバナーを常時表示（レベル別: 色分け+バー+使用数）
- エリア追加後にフィードバックメッセージ表示（「✓ 立川市を追加しました。残り2枠 — 続けて追加できます」）
- フォームを連続追加しやすく改善（レベル・都道府県を維持、市区町村/エリアのみリセット）
- レベルselect変更時にそのレベルの残り枠数をインライン表示（枠0時は追加ボタン無効化）
- getSlotStatus() / renderSlotBanner() / updatePmFormSlotHint() 関数追加

### 2026年3月24日（後半7） — デリエステ（este）ジャンル追加

#### 新ジャンル仕様
- ジャンル名: デリエステ（回春マッサージ・M性感・風俗エステ、男性専用）
- モードキー: `este`（パスとキーが同じ）
- URLパス: `/este/`、サブドメイン: `este.yobuho.com`
- テーマ: パステルティール `#2aa8b8`（清潔感・リラックス・親しみ）、アイコン: 💆‍♂️
- ユーザー口コミは全ジャンル共通表示

#### 変更ファイル
- style.css: `[data-mode="este"]` テーマ追加
- ui-utils.js: TITLE_SUFFIX_MAP + MODE_DESC_MAP に este 追加
- api-service.js: GATE_PATH_MAP に este→/este/ 追加
- area-navigation.js: MODE_PATH_MAP/PATH_MODE_MAP に este 追加
- portal-init.js: pathMap/pathModeMap/modePathMap 全3箇所に este 追加
- .htaccess: /este/ 全ルール追加（hotel/shop/4〜0セグメント）
- astro-src/pages/index.astro: 💆‍♂️ デリエステボタン追加 + esteスタイル
- astro-src/layouts/PortalLayout.astro: este エントリ追加
- astro-src/pages/portal-este.astro: 新規作成
- astro-src/pages/este/index.astro: LPページ新規作成
- generate-sitemap.js: MODES + MODE_PATH に este 追加
- deploy.yml: portal-este.html コピー + este.yobuho.com デプロイ + サブドメインLP専用rsyncステップ追加
- admin.html: shop-mode-f/sr-gender/re-gender-mode select + SHOP_GENRE_LABELS に este 追加
- shop-admin.html: genreLabels + modePathMap に este 追加
- astro-src/pages/shop-register.astro: reg-genre/shop-gender select + GENRE_LABELS + detectGenre() に este 追加

#### admin 掲載エリア管理 UI改善
- `admin.html` loadShopContracts(): 枠数・エリア一覧・管理ボタンを1つのカード（緑枠）に統合（カードヘッダー「掲載エリア」+ 右に「管理する →」ボタン、カード内エリアチップ、カードフッターに枠数青帯）
- renderPlacements(): モーダル上部に残り枠サマリ追加（市区町村/エリア/都道府県、赤/緑で視認性向上）

#### hotel-detail.php キャッシュ対策
- `api/hotel-detail.php` に `Cache-Control: no-store` ヘッダー追加
- 背景: ホテル一覧の口コミ件数と詳細の口コミ件数が不一致になるケース（ブラウザキャッシュが原因）

#### LP入場CTA追加・全国ページLP常時表示・ゲートへ→全国へ
- `area-navigation.js`: appendShopModeLpContent() の `_shopParam` ガード削除 → 全モードの全国ページでLP内容を常時表示 + este を heroMap に追加
- `astro-src/pages/deli/index.astro`, `jofu/index.astro`, `este/index.astro`: heroに「ホテルを検索する（入場）」CTAボタン追加（same/lovehoは既存CTAあり → 変更なし）
- `astro-src/components/PageHeader.astro`: 「ゲートへ」→「← 全国へ」（history.back()）に変更

### 2026年3月24日（後半6） — 店舗URLバグ修正・全国へSPA・LP改善

#### 店舗専用URLで他店舗が表示されるバグ修正（hotel-search.js）
- renderAreaShopSection(): `if (SHOP_ID && shops)` → `if (_shopParam && shops)` に変更（非同期レース対策）
- SHOP_ID / SHOP_SLUG / _shopParam の3条件マルチフィルタ
- loadHotelDetail() ホテル口コミフィルタ: `if (_shopParam && SHOP_ID)` → `if (_shopParam && (SHOP_ID || SHOP_DATA?.shop_name))` に変更
- loadHotelDetail() ラブホ口コミフィルタ: `loveho_reports`に`poster_type`カラム非存在が根本原因 → `shopInfoMap[r.poster_name]`で店舗判定に変更
- loadHotelDetail() renderDetailShopCards: cityShopsを`_shopParam`フィルタ（自店舗のみ）、エリア/都道府県広告は店舗モード時に非表示

#### 「全国へ」ボタン SPA遷移実装（area-navigation.js / portal.html / portal-init.js）
- ボタン変更: `data-action="goToGate"` → `data-action="goToNationalTop"` "全国へ"
- goToNationalTop() 追加（SPA方式、ページリロードなし）: SHOP_SLUG維持 or 通常URLリセット
- portal-init.js: goToNationalTopイベント委譲追加
- astro-src/src/layouts/PortalLayout.astro: 同ボタン変更

#### getGateUrl() をパスベースURLに変更（api-service.js）
- GATE_URL_MAP（サブドメイン）→ GATE_PATH_MAP（/deli/ 等パスベース）に変更

#### フッターリンク・サブドメインLP フッターリンクをパスベースに統一
- portal.html: デリヘル/女風/同性/ラブホリンクをパスベースに変更
- astro-src 全5ページ（deli/jofu/same/loveho/shop-register）: footerLinksをパスベースに変更

#### LP改善（astro-src）
- deli/index.astro・jofu/index.astro: heroセクションの「今すぐホテルを検索する」CTAボタン削除

#### 店舗URLの全国ページにLPコンテンツ表示（area-navigation.js）
- appendShopModeLpContent() 追加（_shopParamある場合のみ表示）
- showJapanPage() 末尾で呼び出し
- 表示: ヒーローテキスト（モード別）、「なぜYobuHoの情報は信頼できるのか」3カード、「かんたん3ステップ」

#### モバイルUX改善
- style.css: @media (max-width: 640px) で主要コンテナに padding 16px 追加
- portal-init.js: 480px未満のプレースホルダーを短縮（"ホテル名・住所で検索"）

### 2026年3月24日（後半5） — 保存エラー改善・文字化け修正・複数人追加料金

#### admin保存エラー改善
- saveHotel(), saveNewHotel()にtry-catch追加（無反応バグ防止）
- api(), apiGet()で非JSONレスポンス時のクラッシュ防止
- エラー時に具体的なメッセージをtoast表示

#### サーバー障害後のデータ修正
- .htaccess: AddDefaultCharset UTF-8追加
- DB文字化け4件修正: 渋?谷?区→渋谷区、東村→東村山市、武蔵村→武蔵村山市
- 全国データ整合性チェック: 上記以外は全て正常

#### 交通費表示統一
- ラブホ口コミの交通費表示をformatTransportFee()に統一（文字列"0"対応）
- 交通費無料=表示、未記入=非表示

#### 複数人利用「追加料金あり」チェック追加
- DB: reports, loveho_reports に multi_fee TINYINT(1) DEFAULT NULL カラム追加
- ポータル: ホテル/ラブホ投稿フォームに追加料金チェック（男性/女性と同じ行、1行表示）
- ポータル: 口コミ表示に「💰追加料金あり」タグ（multi_fee=trueの場合のみ）
- shop-admin: ホテル/ラブホフォームに追加料金チェック追加
- admin: ラブホ編集に追加料金フィールド追加
- PHP API: submit-report.php, submit-loveho-report.php, shop-hotel-api.php 全対応

### 2026年3月24日（後半4） — 検索をEnter実行方式に変更

#### キーワード検索UX改善（Google式Enter実行）
- 旧: 入力中に800msデバウンスで自動検索（入力途中で発火、意図しない検索）
- 新: Enterキー（PC）/ 検索ボタン（スマホ）で明示的に検索実行
- portal.html: input type="search" + enterkeyhint="search"（スマホに検索ボタン表示）
- hotel-search.js: data-oninput自動検索→keydownイベントでEnter検出、executeKeywordSearch()実行
- ✕ボタン表示/非表示はinputイベントで維持（検索は発火しない）
- IME変換確定のEnterはcomposingフラグでスキップ
- 駅検索のsuggestStationsは入力中サジェストのまま変更なし

### 2026年3月24日（後半3） — 検索の半角/全角表記ゆれ対応

#### NFKC正規化による表記ゆれ吸収
- 問題: 「東横inn府中」(半角)で「東横ＩＮＮ府中」(全角)がヒットしない
- 原因: Unicode的に半角INN≠全角ＩＮＮ、Fuse.js/Pagefind両方で別文字扱い
- 解決: NFKC正規化（全角英数→半角、カタカナ統一等）を検索パイプライン全体に適用
- fuse-worker.js: インデックス構築時に正規化フィールド(_n,_a,_c,_s)追加 + クエリ正規化
- hotel-search.js: Pagefindクエリ正規化 + ソート比較正規化（_norm関数追加）
- generate-pagefind-index.mjs: Pagefindインデックス生成時にcontent NFKC正規化
- 効果: 半角inn/全角ＩＮＮ/カタカナイン 全てで同一ホテルがヒット

### 2026年3月24日（後半2） — ホテル詳細URLクリーン化

#### ホテル詳細クリーンURL（SEO・CTR・シェアしやすさ向上）
- 旧: /deli/?hotel=29599（クエリパラメータ）
- 新: /deli/hotel/29599（パスベース、クリーンURL）
- .htaccess: /deli/hotel/29599 リライトルール追加（店舗shopルールの前に配置）
- .htaccess: 旧 ?hotel=ID → /deli/hotel/ID 301リダイレクト追加
- area-navigation.js: buildUrl()でhotelパス生成（`/deli/hotel/ID`）、parseUrlPath()でhotelパス解析
- portal-init.js: canonical URLにhotelクリーンURL対応
- hotel-search.js: updateUrl({hotel:id})はbuildUrl()経由のため自動対応

### 2026年3月24日（後半） — 店舗専用URL slug化・ラブホバッジ統一・Cloudflare Purge改善

#### 店舗専用URL slug化（SEO被リンク最適化）
- 旧: /deli/?shop=UUID（クエリパラメータ、36文字）
- 新: /deli/shop/my-slug/（パスベース、3〜30文字、SEO効果大）
- .htaccess: /deli/shop/slug/ リライトルール追加（通常セグメントルールより前に配置）
- submit-shop.php: 登録時にランダム8文字slug自動生成（英小文字+数字、重複チェック）
- shop-info.php: slug検索対応（?slug=xxx OR ?shop_id=uuid、レスポンスにid/slug追加）
- shop-auth.php: update-slug API追加（バリデーション: ^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$、重複チェック）
- api-service.js: SHOP_ID(UUID)とSHOP_SLUG分離保持、UUID/slug自動判定
- area-navigation.js: buildUrl()を/deli/shop/slug/形式に、parseUrlPath()でshopパス判別
- portal-init.js: canonical URLをshop slug対応に
- shop-admin.html: slug編集UI追加、店舗URLをslug形式で表示
- sql/backfill-slugs.sql: 既存店舗への一括slug付与SQL

#### ラブホタブ店舗バッジ統一
- ラブホ詳細のbuildLhReviewCard()に認定店舗/認証店舗バッジ追加（ホテル側と統一）

#### 店舗モード広告改善
- hotel-search.js: SHOP_ID時の広告全非表示→自店舗情報のみ表示に変更
- renderAreaShopSection(): 他店舗フィルタ（自店舗ID一致のみ表示）

#### Cloudflare Purge改善
- deploy.yml: curl -sf → レスポンス変数格納 + "success":true 検証
- タイムアウト追加（接続10秒、最大30秒）
- 失敗時 ::warning:: でGitHub Actions警告表示（エラー詳細付き）
- 次回push時に根本原因が特定可能に

### 2026年3月24日 — URLパスSEO最適化 + 2セグメント404修正

#### URLパス変更（SEOキーワード最適化、サブドメインと統一）
- /men/ → /deli/（デリヘルキーワード、deli.yobuho.comと一致）
- /women/ → /jofu/（女風キーワード、jofu.yobuho.comと一致）
- /men-same/ → /same-m/（same.yobuho.comと一致）
- /women-same/ → /same-f/（same.yobuho.comと一致）
- .htaccess: 全リライトルール更新 + 旧パス(/men/等)→新パス(/deli/等) 301リダイレクト追加
- area-navigation.js: MODE_PATH_MAP/PATH_MODE_MAP更新
- portal-init.js: pathMap/pathModeMap/canonical/redirect先更新
- generate-sitemap.js: MODE_PATH + 静的URL更新
- portal.html: canonical/og:url/JSON-LD更新
- index.html: 全モードリンク更新
- shop-admin.html: modePathMap更新
- astro-src/: 全サブドメインLP + ガイドページ + PortalLayout更新

#### 2セグメントURL 404修正
- .htaccess: 2セグメントリライトルール追加（/deli/東京都/渋谷区 → portal-men.html?pref=$1&area=$2）
- area-navigation.js restoreFromUrl(): area-data.jsonで2セグメントURLの自動判別（エリア名 or 市区町村名）
- サイトマップの /deli/東京都/渋谷区 形式URLが404だった問題を解消
- エリアページ（/deli/東京都/東京２３区内）のリロード時404も同時修正

### 2026年3月23日 — サブディレクトリURL移行・UI改善・バグ修正

#### サブディレクトリ方式URL移行（SEO最適化）
- 旧: portal.html?mode=men&pref=東京都&city=立川市
- 新: /men/東京都/立川市
- .htaccess: /men/, /women/, /men-same/, /women-same/ の内部リライト + 旧URL 301リダイレクト
- area-navigation.js: updateUrl()/restoreFromUrl() パスベースに全面書き換え
- portal-init.js: MODE読み取り・canonical をパスベースに
- generate-sitemap.js: 全352 URLを新形式に
- 全JS: fetch('api/...') → fetch('/api/...') 絶対パスに修正（相対パス問題解消）
- index.html/shop-admin.html/Astro全ページ: リンクを新URL形式に

#### 駅検索改善
- DBの最寄駅名からサジェストドロップダウン方式に変更（LIKE部分一致→DB駅名候補→完全一致検索）
- hotels.php: suggest_station APIエンドポイント追加（DISTINCT駅名+件数）
- 「駅」入力有無で同じ結果（PHP側で末尾「駅」除去）
- formatStationName(): 駅名表示統一（駅なし→付与、駅前等→そのまま）

#### UI改善
- 現在地リスト表示ボタン削除（地図内の現在地ボタンに集約、検索エリア縦幅改善）
- 地図表示時にホテル/ラブホタブを上下両方に配置
- 口コミ表示: 3件一覧表示 + 4件目以降スクロール枠(520px) + 「▼ 他N件の口コミを表示」ヒント
- 検索窓/駅入力: padding 12px→8px（スマホ高さ縮小）
- ラブホ0件でもホテルタブ+地図ボタンを表示
- ホテル詳細表示中のキーワード/駅検索で詳細を閉じてから結果表示
- shop-admin投稿完了時にshowSuccessModal（画面中央モーダル）

#### バグ修正
- ラブホ詳細で店舗投稿が2重表示されるバグ修正（reviewsHTML経由の重複除去）
- Leaflet GestureHandlingプラグイン導入（Macトラックパッドズーム暴走対策）
- zoomSnap: 0.5, zoomDelta: 0.5, scrollWheelZoom: 'center'
- Cloudflare Purge失敗時にデプロイを失敗扱いにしない（|| echo フォールバック）

## URL構造（サブディレクトリ方式）
- /deli/ — デリヘルトップ
- /deli/東京都 — 都道府県（1セグメント）
- /deli/東京都/渋谷区 — 都道府県+市区町村（2セグメント、エリアなし直接アクセス）
- /deli/東京都/東京２３区内 — 都道府県+エリア（2セグメント）
- /deli/東京都/東京２３区内/渋谷区 — エリア+市区町村（3セグメント）
- /deli/東京都/東京２３区内/渋谷/渋谷区 — エリア+詳細エリア+市区町村（4セグメント）
- /jofu/, /same-m/, /same-f/ — 同様
- 店舗専用URL: /deli/shop/my-slug/ — パスベース（SEO被リンク最適化）
- 店舗+エリア: /deli/shop/my-slug/?pref=東京都&city=渋谷区
- ホテル詳細: /deli/hotel/12345 — クリーンURL（旧 ?hotel=12345 は301リダイレクト）
- タブ: /deli/東京都/立川市?tab=loveho
- 旧URL (portal.html?mode=..., /men/...) は全て301リダイレクト
- 旧店舗URL (?shop=UUID) はJS側でslugフォールバック対応
- MODE↔パスマッピング: men→deli, women→jofu, men_same→same-m, women_same→same-f
- 2セグメントURL判別: restoreFromUrl()でarea-data.jsonを参照し、エリア名か市区町村名かを自動判別

## Security
- PHP認証: secure cookie (httponly, samesite=strict), 30分タイムアウト, 5回ロックアウト
- パスワード: bcryptハッシュ（verify-password.php、レガシーBase64自動移行対応）
- レート制限: ファイルベース(auth), DB+REMOTE_ADDR+fingerprint(reports)
- DB接続: db-config.phpにDB認証情報集約（deploy.ymlでGitHub Secretsから生成）
- CORS: yobuho.com + サブドメインのみ許可（submit-report.php, send-mail.php, verify-password.php）
- CSP: 外部ドメインホワイトリスト
- 入力サニタイズ: esc()関数、コメント500文字制限

## YobuChat（店舗 ↔ 訪問者チャット）

### 構成
- chat.html / chat.js / chat.css — **唯一の訪問者UIソース**（/chat/{slug}/ で公開、全5埋込タイプが iframe でこれを読み込む）
- chat-widget.js — 外部サイト埋込①（`<script>` 1行、右下💬ボタン → クリックで iframe モーダル）
- chat-i18n.json — 訳文の唯一のソース（chat.js が起動時 fetch）
- api/chat-api.php — 全アクションを集約（start-session/send-message/poll-messages/can-connect/owner-inbox/owner-reply/register-device/verify-device/block-visitor/unblock-visitor/toggle-notify/owner-go-offline/translate/admin-overview/admin-save-settings ほか）
- shop-admin.html 内 `💬 YobuChat` タブ — 有効化/受付時間/ウェルカムメッセージ/通知先メール/定型文管理、貼付コード生成（①script/②iframe/③link/④floating/⑤CMS用インライン）

### 埋込アーキテクチャ（iframe 統一、2026-04-20〜）
**全埋込タイプが `/chat/{slug}/` を iframe で読み込む。本家 chat.html を直せば5タイプ全部に自動反映される**。
過去は chat-widget-inline.template.html を別実装として維持し CI パリティ検証で同期していたが、
CSS/レイアウト/文言のドリフトが頻発し「片方に機能追加、もう片方に忘れる」事故が再三発生。
iframe 方式で真の単一ソース化を達成し、手動同期作業自体を排除した。

**5タイプの役割:**
- ①script: `<script src="yobuho.com/chat-widget.js" data-slug>` — chat-widget.js が iframe 付きフローティングボタンを注入
- ②iframe: 静的 `<iframe src="/chat/slug/?embed=1">` + 高さ自動調整 script
- ③link: 別タブリンク（iframe 不使用）
- ④floating: 別タブ浮動リンク（iframe 不使用）
- ⑤CMS用インライン: 静的 `<iframe>` + 高さ自動調整 script。script 禁止 CMS 用に固定高さ版を `<details>` 内で別提供

**高さ自動調整:**
- chat.js の `setupEmbedResizeNotifier()` が `ResizeObserver` で body サイズ変化を検知し親に `postMessage({type:'ychat:resize', h})` を送信
- 埋込側（②⑤）の小さい inline script が message イベントで受信、`iframe.style.height` を更新（範囲 500-900px）
- **高さ調整ロジックは埋込タイプごとに独立しているため、「この埋込タイプだけ高さを変えたい」指示時のみ該当コードに触る**

**変更時の鉄則:**
- 訪問者UIの変更 → `chat.html` / `chat.js` / `chat.css` のみ編集。全5埋込に自動反映
- i18n追加 → `chat-i18n.json` のみ編集（chat.js が fetch するため即時反映）
- 高さ・外枠スタイル（iframe 側）の変更 → shop-admin.html の `renderChatAdmin()` 内の該当埋込タイプのコードのみ修正
- .htaccess の `/chat/` は `frame-ancestors *` / X-Frame-Options 除去済み（iframe 埋込許可）

### DO-Ready 仕様（2026-04-18 launch前改造）
Cloudflare Durable Objects (WebSocket Hibernation) への将来移行を痛くなく行うため、
launch前にAPI/DB/フロントを移行前提に整備済み。
1. **client_msg_id 冪等送信**: `chat_messages.client_msg_id VARCHAR(36) UNIQUE`。send-message/owner-reply は同一IDで再送されても重複INSERTしない（UNIQUE制約+try/catchで1062復旧）。WS再接続中の重複送信を防ぐ。
2. **統一バッチレスポンス**: `okBatch()` ヘルパーで全配信系エンドポイントが `{messages[], status, shop_online, last_read_own_id, server_time}` を返す。WS pushと完全同形状。
3. **can-connect プリゲート**: subscribe前に `session_token` or `shop_slug` で ok/outside_hours/closed/blocked/not_found を一括判定。WS upgrade時の拒否判定と同形。
4. **presence heartbeat**: `chat_sessions.last_visitor_heartbeat_at` / `last_owner_heartbeat_at`。poll tick毎に更新。DO版でもWS接続のping/pong代わりに使える。
5. **Transport.send / canConnect 追加**: フロントの送信も `Transport.sendVisitor / sendOwner / canConnect` 経由。DO版でWS送信に切り替える余地あり（HTTPのままでも可、Cloudflare推奨のハイブリッド）。
6. **since_id 両面サポート**: poll-messages / owner-inbox / send-message / owner-reply 全てが `since_id` を受け付け、WSリプレイと同じ取りこぼし防止挙動に統一。

### DBテーブル（sql/chat_tables.sql）
- chat_sessions — 匿名訪問者セッション（session_token、shop_id、status=open/closed、blocked）
- chat_messages — メッセージ（sender_type=visitor/shop、read_at）
- shop_chat_templates — 店舗定型文
- shop_chat_status — 有効化 + is_online + notify_mode + reception_start/end + welcome_message + notify_email（shop-chat-status にレコードあり = チャット機能ON）
- shop_chat_devices — オーナー端末（localStorage `chat_owner_token` と照合）
- chat_blocks — visitor_hash（IP+UA hash）でのブロックリスト

### 通知メール
- `shop_chat_status.notify_email` が NULL/空 → `shops.email` に送信（デフォルト）
- 値あり → notify_email のみに送信（登録メールには送らない。現場と総務で分ける運用向け）

### Transport抽象化（Cloudflare Durable Objects 移行保険）
chat.js の `PollingTransport` オブジェクトが配信層を抽象化。`const Transport = PollingTransport;` の1行差し替えで WebSocket/DO に切替可能。

**インターフェイス:**
- `Transport.subscribeVisitor({ getSessionToken, getSinceId, onBatch, intervalMs })` → `{ stop }`
- `Transport.subscribeOwner({ getDeviceToken, getSelectedSessionId, onBatch, intervalMs })` → `{ stop }`
- `onBatch(data[, selectedSid])` に生のAPIレスポンスを渡す → `applyVisitorBatch` / `applyOwnerBatch` が画面反映

**絶対に壊してはいけない不変条件:**
- UIコード（enter*Mode / addMessage / renderInbox / updateReadMarkers 等）は Transport 実装に依存しない
- Transport の責務は「配信」のみ。業務ロジック（status==='closed' 時の入力欄hide、既読マーカー更新、saveVisitorSession等）は applyVisitorBatch/applyOwnerBatch に置く
- 受付時間外は `startVisitorPolling()` が `scheduleReceptionReopenCheck()` にフォールバックするため、Transport.subscribeVisitor は呼ばれない → DO実装でも同じガードを保つ

### Durable Objects 移行マッピング
| 現状 | DO版 |
|---|---|
| shop_id (CHAR(36)) | DO instance ID（`env.CHAT_DO.idFromName(shop_id)`） |
| chat_sessions 1行 | DO内メモリ + 永続化（DurableObject.storage.put(`session:${token}`, {...})） |
| chat_messages (session_id別) | DO内 storage.list({prefix:`msg:${sid}:`}) or SQL onパラレル |
| shop_chat_status.is_online | DO インスタンス内フラグ（WebSocket接続数で判定可） |
| api/chat-api.php の poll-messages | DO.fetch('/ws') → WebSocket → onmessage |
| api/chat-api.php の owner-inbox | DO.fetch('/owner/inbox') → WebSocket push |
| send-message / owner-reply | DO.fetch('/send', {method:POST}) → 全接続 WebSocket に broadcast |
| register-device / verify-device | MySQLに残したままでOK（認証系はMySQLで集中管理） |
| 通知メール送信 | DO 内で `fetch('https://yobuho.com/api/chat-notify.php')` 呼び出し or Workers Email |

**DO移行の前提:**
- チャット以外のDB（shops/reports/hotels）は引き続きシンレン MySQL を使う
- 認証（shop-auth.php セッション）はPHP側に残す。DO接続時は device_token をクエリ or 認証headerで渡す
- Cloudflare Workers + DO binding が必要（Free $5/月で数千チャットOK）
- WebSocket接続数 = Workers実行時間課金。idle セッションは 60s で切断 → 次のpollでreconnect の設計が堅い

**移行見積もり（保険①〜④完了後）:**
- ①APIラッパー: 済（api() 関数）
- ②Transport抽象化: 済（PollingTransport）
- ③メール送信の独立API化: 未（DO移行時に同時でも可）
- ④このマッピング表: 済
- 実装本体: 5-7日（DO SQL schema、WebSocket handler、broadcast、heartbeat、retention cron on DO alarm）

## Z-index Stack
- Header: 100
- Dropdown: 200
- Sticky: 500
- Modal backdrop: 1000
- Modal: 1001
- Modal confirm: 1010
- Toast: 1100

## Deploy
- サーバー: **sv6051.wpx.ne.jp (162.43.96.7)** — シンレンタルサーバー（2026-04-21 に sv6825 から移行完了、MariaDB 10.5→10.11）
- 旧サーバー: sv6825.wpx.ne.jp (210.157.79.215) — grace period 中、直アクセス時は .maintenance でPOSTを503拒否中
- CDN: Cloudflare Free（SSL Full、NS: cosmin/galilea.ns.cloudflare.com）
- パス: /home/yobuho/yobuho.com/public_html/
- SSH: port 10022, key: ~/.ssh/yobuho_deploy（パスフレーズなし）
- rsync: --deleteは絶対に使わない（サブドメインディレクトリが消える）
- サブドメインDocRoot: /home/yobuho/yobuho.com/public_html/*.yobuho.com/（deli/jofu/same/loveho）
- rsync --deleteでサブドメインが消えないよう --exclude='*.yobuho.com' 設定済み
- rsync --excludeにサーバー生成ファイル追加（pagefind/, master-data.json, area-data.json, hotel-data/, search-index.json）
- GitHub Actions: .github/workflows/deploy.yml（pushで自動デプロイ + 手動トリガー）
- キャッシュバスター: gitハッシュで?v=自動置換（deploy.ymlのsedステップ）
- キャッシュ: HTML=no-cache、JS/CSS/画像=1年（.htaccess）
- デプロイ後Cloudflareキャッシュ自動Purge（CLOUDFLARE_ZONE_ID/API_TOKEN）
- GitHub Secrets必要: SSH_HOST, SSH_USERNAME, SSH_PRIVATE_KEY, DB_HOST, DB_NAME, DB_USER, DB_PASS, CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN
- Google Search Console: ドメインプロパティ登録済み（DNS TXTレコード認証）、サイトマップ送信済み
- 監視: UptimeRobot（5分間隔、メール通知）

## Commands
- Generate sitemap: node generate-sitemap.js（deploy.ymlで自動実行、&をXML用に&amp;エスケープ済み）
- Generate area data: php api/generate-area-data.php（サーバー上で実行、deploy.ymlで自動実行）
- Generate master data: php api/generate-master-data.php（サーバー上で実行、deploy.ymlで自動実行）
- Generate hotel data: php api/generate-hotel-data.php（サーバー上で実行、deploy.ymlで自動実行）
- Generate search index: php api/generate-search-index.php（サーバー上で実行、deploy.ymlで自動実行）
- Generate pagefind data: php api/generate-pagefind-data.php（サーバー上で実行、deploy.ymlで自動実行）
- Build pagefind index: node generate-pagefind-index.mjs（CI上で実行、pagefind-data.json必須）
- ローカルからDB接続: SSHトンネル（ssh -p 10022 -i ~/.ssh/yobuho_deploy -L 3307:localhost:3306 yobuho@sv6051.wpx.ne.jp -N）+ db-local.js

## Dependencies (package.json)
- dotenv: ^17.3.1
- fuse.js: ^7.1.0
- mysql2: ^3.20.0
- pagefind: ^1.4.0 (devDependency) Pagefindインデックス生成
- vitest: ^3.2.1 (devDependency) テスト
- jsdom: ^26.1.0 (devDependency) vitest用DOM環境

## Astro SSG移行（2026-03-20）

### Phase 1+2 完了（14ページ + ガイド3ページ）
- astro-src/ ディレクトリに全ファイル構築済み
- Phase 1: index, legal, terms, privacy, contact, shop-register, deli, jofu, same, loveho（10ページ）
- Phase 2: portal-men, portal-women, portal-men-same, portal-women-same（4ページ）
- ガイドページ: guide/deli-hotel, guide/jofu-hotel, guide/lgbt-hotel（3ページ、SEOロングテール向け）
- PortalLayout.astroでモード別meta/OG/title/JSON-LDをビルド時確定
- 既存JS5モジュール + portal-init.js はそのままdefer読み込み
- admin.html, shop-admin.htmlはAstro移行しない（認証系はVanilla JS維持）

### astro-src/ 構造
```
astro-src/
├── astro.config.mjs        SSG mode, build.format: 'file'
├── src/
│   ├── layouts/
│   │   ├── BaseLayout.astro    GA4, meta, favicon, OG, JSON-LD, CSP
│   │   ├── LegalLayout.astro   法的ページ共通
│   │   └── PortalLayout.astro  ポータル（モード別SEO、全モーダル、JS読込）
│   ├── components/
│   │   ├── PageHeader.astro    法的ページ用ヘッダー
│   │   ├── Footer.astro        サイト共通フッター
│   │   └── LPFooter.astro      サブドメインLP用フッター
│   └── pages/
│       ├── index.astro, legal.astro, terms.astro, privacy.astro, contact.astro
│       ├── shop-register.astro
│       ├── deli/index.astro, jofu/index.astro, same/index.astro, loveho/index.astro
│       ├── portal-men.astro, portal-women.astro
│       ├── portal-men-same.astro, portal-women-same.astro
│       └── guide/deli-hotel.astro, jofu-hotel.astro, lgbt-hotel.astro
└── public/ (favicon only)
```

### Astro Dependencies (astro-src/package.json)
- astro: ^6.0.7

## Supabase依存削減 — 完了（2026-03-20 Scenario C）

### 方針
- ユーザー向けポータルからSupabase依存をゼロにする → **完了**
- 全ページSupabase依存ゼロ化完了（PHP API + 静的JSON）

### 完了フェーズ
- [x] C4: フロントWRITE→PHP API化（submit-vote/loveho-report/flag/hotel-request.php）
- [x] C2: マスタデータ静的JSON化（9テーブル → master-data.json 2.7KB）
- [x] C3: 口コミ・店舗データPHP API化（hotel-detail/report-summaries/area-shops/ads/shop-info/hotels.php）
- [x] C1: ホテルデータ静的JSON化（47都道府県 → hotel-data/*.json 17MB）
- [x] C5: anon key完全除去（portal.htmlからsupabase-js CDN削除、api-service.jsからキー削除）

### ポータルのデータフロー（Supabaseゼロ）
- エリアナビ: area-data.json（静的JSON）→ フォールバック: api/hotels.php
- ホテル一覧: api/hotels.php → api/report-summaries.php
- ホテル詳細: api/hotel-detail.php（hotel+reports+shop_info+summary）
- マスタデータ: master-data.json（静的JSON）
- 投稿: api/submit-report.php, submit-loveho-report.php, submit-vote.php, submit-flag.php, submit-hotel-request.php
- 広告: api/ads.php
- 店舗: api/area-shops.php, api/shop-info.php
- 検索: api/hotels.php（keyword/station/GPS/フィルタ）

### Pagefind + Fuse.js ハイブリッド検索
- **Pagefind**: 全文検索 + 構造化フィルタ（prefecture/city/hotel_type/deri/jofu/same_m/same_f）
  - generate-pagefind-data.php: DB→ホテル+モード別レポート統計JSON（pagefind-data.json）
  - generate-pagefind-index.mjs: Pagefind Node APIでインデックス生成（pagefind/ディレクトリ）
  - クライアント初期負荷: pagefind.js(33KB) + wasm(51KB)、インデックスチャンクはオンデマンド
  - フィルタ: deri/jofu/same_m/same_f = "OK"（呼べた実績あり）、loveho_report = "OK"
- **Fuse.js**: 曖昧・部分一致検索（タイポ・略称に強い）
  - generate-search-index.php: search-index.json (6.5MB/1.4MB gzip)
  - Fuse.js: Web Worker（fuse-worker.js）でメインスレッド非ブロック
  - CDN読み込み（cdn.jsdelivr.net）、threshold:0.3, ignoreLocation:true
- **検索フロー**: hybridSearch() → Pagefind + Fuse.js(Worker) 並列実行 → マージ（Pagefind優先）→ キーワード一致度ソート（完全一致>先頭一致>部分一致>その他）→ PHP APIで詳細取得
- **フォールバック**: 両方失敗時 → hotels.php LIKE検索（PHP API）
- CSP: script-src に 'wasm-unsafe-eval' 追加
- deploy.yml: PHP→pagefind-data.json生成 → SCP → Node→Pagefindインデックス生成 → rsync

### デプロイ方針
- deploy.yml: Astroビルド + 静的JSON生成 + 検索インデックス + sitemap生成を自動実行
- Astro出力: dist/portal-*.html → ルートにコピー、dist/*.html → *.yobuho.com/index.html にコピー
- .htaccess: portal.html?mode=men → portal-men.html にリライト設定済み
- CSS: inlineStylesheets:'always' でインライン化（サブドメインに _astro/ 不要）
