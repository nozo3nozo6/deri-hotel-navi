# Deri Hotel Navi

呼べるホテル検索ポータル「YobuHo」- デリヘル/女風/同性利用可能なホテルの口コミ検索サービス

## Stack
- Frontend: Vanilla JS (5モジュール), HTML 9ページ
- DB: Supabase (PostgreSQL) + RLS
- Deploy: シンレンタルサーバー（sv6825.wpx.ne.jp）via rsync over SSH (port 10022)
- Hotel data: Rakuten Travel API (43,580件), Yahoo!ローカルサーチAPI
- Map: Leaflet + OpenStreetMap
- Geocoding: Nominatim (OpenStreetMap)

## Supabase
- URL/Key/DB: see .env file (do not commit secrets to this file)
- anon key (sb_publishable_*): フロントエンド用（RLSで制限）
- service key (sb_secret_*): admin-api.php / submit-report.php / submit-shop.php 経由でのみ使用
- SMTP: hotel@yobuho.com（sv6825.wpx.ne.jp:587）— Magic Linkテンプレートカスタマイズ済み

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
├── api-service.js            Supabase初期化、API呼び出し、マスタデータ
├── ui-utils.js               Toast、モーダル、i18n（日英中韓）、extractCity()
├── area-navigation.js        エリアナビ、REGION_MAP、URL状態管理
├── hotel-search.js           ホテル検索/表示、ラブホタブ、地図、GPS検索
├── form-handler.js           投稿フォーム、フラグ報告、掲載リクエスト
├── style.css                 全スタイル（テーマ変数、レスポンシブ）
│
├── api/
│   ├── auth.php              admin認証（セッション、レート制限）
│   ├── auth-config.php       認証設定（service key、タイムアウト等）※デプロイ時にGitHub Secretsから生成
│   ├── admin-api.php         管理操作プロキシ（service key、PHP認証必須）
│   ├── submit-report.php     ユーザー投稿（レート制限、不正検知、CORS制限）
│   ├── submit-shop.php       店舗登録（service key、RLS回避、bcryptハッシュ化）
│   ├── verify-password.php   パスワード検証（bcrypt対応、レガシーBase64自動移行）
│   ├── send-mail.php         メール送信（HTML対応、CORS制限）
│   └── migrate-passwords.php パスワード移行（一回限り）
│
├── sql/
│   ├── add-indexes.sql       パフォーマンスインデックス
│   ├── contract_plans.sql    契約プラン
│   ├── shop_hotel_info.sql   店舗ホテル情報
│   ├── shop_service_options.sql  店舗サービス
│   ├── reports_add_shop_id.sql   reports拡張
│   └── ad_banner_columns.sql     広告バナー
│
├── import-rakuten.js         楽天ホテルインポート
├── update-detail-area.js     詳細エリア更新
├── generate-sitemap.js       サイトマップ生成
├── generate-area-data.js     エリアナビ用静的JSON生成
├── area-data.json            エリアナビ事前計算データ（generate-area-data.jsで生成）
├── scripts/
│   └── import-yahoo-hotels.js Yahoo!ホテルインポート
│
├── subdomain/                 全サブドメインはLP方式（HTMLのみ、JS不要）
│   ├── deli/index.html       デリヘル専用LP → portal.html?mode=men
│   ├── jofu/index.html       女風専用LP → portal.html?mode=women
│   ├── same/index.html       同性利用専用LP → portal.html?mode=men_same
│   └── loveho/index.html     ラブホLP → portal.html（loveho-app.js/loveho-style.cssは廃止）
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
- キャッシュバスター: style.css?v=13, portal-init.js?v=2, api-service.js?v=15, ui-utils.js?v=9, area-navigation.js?v=11, hotel-search.js?v=43, form-handler.js?v=6
- サブドメイン方針: 全サブドメイン（deli/jofu/same/loveho）はランディングページ方式（HTMLのみ、JS不要）。検索・投稿は全てportal.htmlに集約

### admin.html — 管理画面
- PHP認証（api/auth.php、セッション: $_SESSION['user_id']）
- ダッシュボード（統計、未対応タスクカード）
- 投稿管理（reports + loveho_reports統合、フラグ対応、編集/非表示/削除）
- 店舗管理（審査、プラン、ステータス管理）
- ホテル編集（地方→都道府県→市区町村カスケード、住所検索、ソースフィルタ: rakuten/yahoo/manual）
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

### shop-admin.html — 店舗管理画面
- ログイン: メール+パスワード認証、パスワード表示チェック、パスワードリセット機能（6桁認証コード）
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
id, name, address, prefecture, city, major_area, detail_area, hotel_type, source (rakuten/yahoo/manual), review_average, min_charge, nearest_station, postal_code, tel, latitude, longitude, is_published, is_edited, created_at, updated_at

### reports
id(UUID), hotel_id, can_call, poster_type(user/shop), poster_name, shop_id, can_call_reasons[], cannot_call_reasons[], time_slot, room_type, comment, multi_person, guest_male, guest_female, gender_mode, fingerprint, ip_hash, is_hidden, flagged_at, flag_reason, flag_comment, flag_resolved, created_at

### loveho_reports
id(UUID), hotel_id, solo_entry(yes/no/together/lobby/unknown), atmosphere, recommendation, cleanliness, cost_performance, good_points[], time_slot, comment, poster_name, multi_person, guest_male, guest_female, gender_mode, is_hidden, flagged_at, flag_reason, flag_comment, flag_resolved, created_at

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
- 表示順: 有料プラン高い順→30日自動更新サイクルで新しい順
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
- 店舗2件: 店舗専用URL表示ルール、ラブホタブ店舗差別化

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
- [ ] 店舗専用URL（?shop=xxx）の表示ルール確定
- [ ] ラブホタブの店舗差別化（さらなる検討）
- [ ] GitHub Secrets: SUPABASE_ANON_KEY の追加（deploy.ymlのarea-data.json生成用）

### パフォーマンス残課題
- [ ] ホテル一覧表示時のSupabaseクエリ速度改善（口コミデータはリアルタイム取得が必要、Redis等が理想だが現スタックでは限界）

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

## Security
- PHP認証: secure cookie (httponly, samesite=strict), 30分タイムアウト, 5回ロックアウト
- パスワード: bcryptハッシュ（verify-password.php、レガシーBase64自動移行対応）
- レート制限: ファイルベース(auth), DB+REMOTE_ADDR+fingerprint(reports)
- service key分離: submit-report.php / submit-shop.php / admin-api.php / verify-password.php のみ
- CORS: yobuho.com + サブドメインのみ許可（submit-report.php, send-mail.php, verify-password.php）
- CSP: 外部ドメインホワイトリスト
- 入力サニタイズ: esc()関数、コメント500文字制限

## Z-index Stack
- Header: 100
- Dropdown: 200
- Sticky: 500
- Modal backdrop: 1000
- Modal: 1001
- Modal confirm: 1010
- Toast: 1100

## Deploy
- サーバー: sv6825.wpx.ne.jp (シンレンタルサーバー)
- パス: /home/yobuho/yobuho.com/public_html/
- SSH: port 10022, key: ~/.ssh/yobuho_deploy
- rsync: --deleteは絶対に使わない（サブドメインディレクトリが消える）
- サブドメインパス: deli.yobuho.com/, jofu.yobuho.com/, same.yobuho.com/, loveho.yobuho.com/
- GitHub Actions: .github/workflows/deploy.yml（手動トリガー、auth-config.phpをSecretsから生成、sitemap.xml自動生成、area-data.json自動生成）
- GitHub Secrets必要: SSH_HOST, SSH_USERNAME, SSH_PRIVATE_KEY, SSH_PASSPHRASE, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
- Google Search Console: ドメインプロパティ登録済み（DNS TXTレコード認証）、サイトマップ送信済み

## Commands
- Import Rakuten hotels: node import-rakuten.js
- Import Yahoo hotels: node scripts/import-yahoo-hotels.js
- Update city: node update_city.mjs
- Update detail_area: node update-detail-area.js
- Generate sitemap: node generate-sitemap.js（deploy.ymlで自動実行、&をXML用に&amp;エスケープ済み）
- Generate area data: node generate-area-data.js（deploy.ymlで自動実行、ホテルインポート後にも手動実行が必要）

## Dependencies (package.json)
- @supabase/supabase-js: ^2.97.0
- axios: ^1.13.5
- dotenv: ^17.3.1
- pg: ^8.19.0
