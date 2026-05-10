# CLAUDE-SEO.md — SEO チーム向け基本情報シート

> SEO チーム（seo-lead / seo-content / seo-technical / seo-structure / seo-competitor）が
> 参照するためのサイト基本情報。プロジェクト全体ドキュメントは `CLAUDE.md` を参照。
> 最終更新: 2026-05-10

---

## サイト概要

- **ドメイン**: yobuho.com + サブドメイン（deli / jofu / same / loveho / este）
- **サイト名**: 呼べるホテル検索 YobuHo
- **業種・コンセプト**: 呼べるホテルの口コミ・検索ポータル
- **ターゲットユーザー**: 風俗をホテルに呼びたい利用者（男性 / 女性 / LGBT）
- **主要キーワード**:
  - デリヘル 呼べる ホテル
  - 女風 呼べる ホテル
  - 同性利用 呼べる ホテル / LGBT 呼べる ホテル
  - ラブホ 口コミ / ラブホ 一人入室
- **規模**: 中規模（50〜500ページ。動的に展開される地域×モードURLを含めるとそれ以上）
- **使用フレームワーク**:
  - フロント: Vanilla JS（5モジュール）+ Astro SSG（サブドメインLP・ガイドページ）
  - API: PHP + MySQL/MariaDB（シンレンタルサーバー）
  - 検索: Pagefind + Fuse.js（Web Worker）ハイブリッド
- **デプロイ環境**: シンレンタルサーバー sv6051 + Cloudflare Free / GitHub Actions で push 時自動デプロイ
- **競合サイト**:
  1. デリヘル口コミ・ポータル系
  2. ラブホ検索系（ハピホテル 等）
  3. 「デリヘル呼べるホテル」というサイト名のサイト

---

## SEO目標

- **最優先で順位を取りたいキーワード**:
  1. デリヘル 呼べる ホテル
  2. 女風 呼べる ホテル
  3. 同性利用 呼べる ホテル / LGBT 呼べる ホテル
- **次点のキーワード**:
  - 地域 × ジャンル複合（例: 新宿 デリヘル ホテル / 渋谷 女風 ホテル）
  - ラブホ 口コミ / ラブホ 一人入室 / ラブホ 査定
  - デリエス 呼べる ホテル / 回春 ホテル（este ジャンル）
- **ビジネス目標**:
  - **最優先**: 店舗登録数（会員ショップ数）の増加
  - 次点: PV・セッション数の増加
  - 次点: 店舗広告有料プランの収益化
- **想定ユーザーの検索意図**:
  - **今すぐ呼べるホテルを探したい（利用直前）** ← メイン
  - **ホテルの口コミ・呼べるかを確認したい（下調べ）** ← メイン
  - 情報収集型（風俗マナー・知識）は優先度低め

---

## 技術的な制約

- **触れない部分（SEO チームは原則修正しない）**:
  - `admin.html` / `shop-admin.html` などの認証ページ（管理画面・店舗管理画面）
  - `api/*.php`（PHP API レイヤー）
- **必ず守りたいルール（SEO 関連）**:
  - **SSG 配信された H1 / meta を JS で上書き禁止**
    （初期 HTML に正しい H1 / title / description を含める。GSC ソフト 404 防止 — `seo-rules` skill 参照）
  - **canonical / sitemap.xml の整合性維持**
    （URL 表記揺れ・重複コンテンツ・迷子 URL を生まない）
  - **Pagefind / Fuse.js のインデックス生成フローを壊さない**
    （`generate-pagefind-data.php` / `generate-search-index.php` / `generate-pagefind-index.mjs` の構造変更は事前相談）
  - **JS / PHP API の挙動を変える修正は事前相談**
    （SEO 調整と称してロジック・データ層を壊さない）

> **補足**: デザインルール（青系カラー禁止 等）は SEO とは別管理。
> 詳細は `~/.claude/projects/-Users-biyobu-Desktop-deri-hotel-navi/memory/MEMORY.md` の
> `feedback_*.md` を参照。

---

## 参考リンク（プロジェクト内）

- 全体ドキュメント: `CLAUDE.md`（プロジェクトルート）
- SEO ルール skill: `.claude/skills/seo-rules/`
- サイトマップ生成: `generate-sitemap.js`
- Pagefind データ生成: `api/generate-pagefind-data.php`
- 検索インデックス生成: `api/generate-search-index.php`
- Astro SSG ソース: `astro-src/src/pages/`
- ガイドページ（ロングテール SEO）: `astro-src/src/pages/guide/`
