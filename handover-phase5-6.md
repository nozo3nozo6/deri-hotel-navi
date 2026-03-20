# MySQL移行 Phase 5-6 引き継ぎ

## 今回の作業概要

shop-admin.html（Phase 5）と admin.html（Phase 6）から Supabase JS SDK を完全除去し、PHP API + 静的JSON に置換した。**全HTMLページでSupabase依存ゼロを達成**。

## 新規作成ファイル

### api/shop-auth.php（Phase 5）
店舗向けPHPセッション管理。6アクション:
- `login` — メール+パスワード認証、セッション開始
- `check` — セッション有効性チェック（リロード復元）
- `profile` — shop + shop_contracts + contract_plans JOIN
- `update-thumbnail` — サムネイル更新/削除
- `update-email` — メールアドレス変更
- `lookup-email` — パスワードリセット用メール存在確認

セッション設計: `$_SESSION['shop_id']`, 24時間タイムアウト, httponly/secure/SameSite=Strict cookie

### api/shop-hotel-api.php（Phase 5）
店舗ホテル情報CRUD。8アクション、全てセッション認証必須:
- `registered-ids` / `registered-list` — 登録済みホテル取得
- `get-info` / `get-transport-fee` / `get-existing-loveho` — 個別データ取得
- `save-hotel-info` — report + shop_hotel_info + services を1トランザクションで保存
- `save-loveho-info` — loveho_report + transport_fee を1トランザクションで保存
- `delete-info` — services + info 削除

### api/admin-api.php 全面書き換え（Phase 6）
旧: update/delete の2アクションのみ
新: 汎用CRUD + 特殊エンドポイント計14アクション

汎用:
- `list` — テーブル名+フィルタで汎用SELECT（18テーブル対応）
- `insert` — 汎用INSERT（UUID自動生成、挿入行を返却）
- `update` — 汎用UPDATE
- `delete` — 汎用DELETE（複合キー対応: `filters` パラメータ）
- `reorder` — sort_order一括更新（DnD並べ替え）

特殊:
- `dashboard` — 統計+最新投稿（7つのCOUNTを1クエリで）
- `reports-all` — reports + flagged + loveho_reports を一括取得（hotels JOIN）
- `hotels-search` — フィルタ付きホテル検索
- `hotel-cascades` — major_area/detail_area/city/prefectureのDISTINCT値
- `shop-contracts` — 店舗契約プラン取得
- `ad-contracts-list` — 広告契約一覧（shops+ad_plans JOIN + placements）
- `ad-slot-count` — 広告枠使用数カウント（details付き）
- `ad-toggle-contract` — 広告契約ステータス切替（placements連動）
- `ad-delete-contract` — 広告契約削除（placements連動）

## 拡張したファイル

### api/hotels.php
- `include_summary=1` パラメータ追加: hotel_report_summary LEFT JOIN
- `type=all` パラメータ追加: ホテル+ラブホ同時検索

### api/generate-master-data.php
- `shop_service_options` テーブルを master-data.json に追加出力

## admin.html の移行パターン

JS側に2つのヘルパー関数を追加:
```js
async function api(action, body)   // POST、credentials:'include'
async function apiGet(action, params) // GET、credentials:'include'
```

主な置換パターン:
- `sb.from("TABLE").select("*").order("X")` → `apiGet('list','table=TABLE&order=X&dir=asc')`
- `sb.from("TABLE").update(DATA).eq("id",ID)` → `api('update',{table:'TABLE',id:ID,data:DATA})`
- `sb.from("TABLE").delete().eq("id",ID)` → `api('delete',{table:'TABLE',id:ID})`
- `sb.from("TABLE").insert(DATA).select().maybeSingle()` → `api('insert',{table:'TABLE',data:DATA})`
- 複合キー削除: `api('delete',{table:'TABLE',filters:{col1:v1,col2:v2}})`
- ホテルカスケード: `apiGet('hotel-cascades','field=major_area&pref=X')`
- 広告枠カウント: `apiGet('ad-slot-count','level=X&target=Y')`

## shop-admin.html の移行パターン

- エリアナビ: area-data.json 静的JSON読み込み（APIコール0回）
- マスタデータ: master-data.json 静的JSON読み込み
- ログイン: shop-auth.php login（PHPセッション開始）
- セッション復元: shop-auth.php check（Cookie認証）
- ホテル検索: hotels.php（include_summary=1）
- CRUD: shop-hotel-api.php（トランザクション使用）

## データ形式の変更点

### reports/loveho_reports
- Supabase JOIN `r.hotels?.name` → PHP JOIN `r.hotel_name`（フラット化）
- JSON配列カラム（can_call_reasons等）: PHP側でjson_decode済みで返却

### hotel-cascades
- Supabase: `[{major_area:"X"},{major_area:"Y"}]` → PHP: `["X","Y"]`（DISTINCT値の配列）

### ad-slot-count
- Supabase: `{count:N}` → PHP: `{count:N, details:[...]}`

### ad-contracts-list
- Supabase: 2回のクエリ → PHP: `{contracts:[...], placements:[...]}`（1回で）

## 未デプロイ

今回の変更はローカルのみ。デプロイ前に以下を確認:
1. `api/db-config.php` がサーバー上に存在すること
2. `master-data.json` にshop_service_optionsが含まれること（generate-master-data.php再実行が必要）
3. admin.htmlのPHPセッションはauth.phpと同じcookie設定（domain=yobuho.com）

## Phase 7（残タスク）

- package.json から `@supabase/supabase-js` 削除
- auth-config.php 廃止（もう使わない）
- import-rakuten.js / update-detail-area.js 等のNode.jsスクリプトをMySQL対応
- deploy.yml からSupabase関連ステップ削除
- .env からSupabase URLとキー削除
