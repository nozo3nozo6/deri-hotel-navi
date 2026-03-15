# Deri Hotel Navi

## Stack
- Frontend: Vanilla JS (5モジュール), HTML (portal.html, admin.html, index.html, shop-register.html)
- DB: Supabase (PostgreSQL)
- Deploy: シンレンタルサーバー（sv6825.wpx.ne.jp）via GitHub Actions FTP
- Hotel data: Rakuten Travel API

## Supabase
- URL/Key/DB: see .env file (do not commit secrets to this file)

## Tables
- hotels: 42,052 hotels (hotel_type, detail_area, city)
- reports: user posts (can_call/cannot_call, reasons, room_type, time_slot)
- shops: shop registration (is_approved, plan, denial_reason)
- shop_placements: ad placement by area level
- can_call_reasons / cannot_call_reasons / room_types: master data

## Pages
- index.html: gate (men/women/lgbtq/shop)
- portal.html: main app (api-service.js, ui-utils.js, area-navigation.js, hotel-search.js, form-handler.js)
- admin.html: admin panel
- shop-register.html: shop registration

## Gender modes
men / women / men_same / women_same

## Key logic
- extractCity(): parse city from address using prefecture list
- hotel_type: detected from name (business/city/resort/ryokan/pension/minshuku/other)
- detail_area: Rakuten detailClass (11 major cities only)
- Cache buster: 各JSファイル?v=N（変更時はportal.htmlのバージョン番号を+1すること）
- RLS: public_read（writeはテーブルごとに制限済み）
- Auth: admin.html はサーバー側PHP認証（api/auth.php）

## Commands
- Import hotels: node import-rakuten.js
- Update city: node update_city.mjs
- Update detail_area: node update-detail-area.js
