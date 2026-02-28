# Deri Hotel Navi

## Stack
- Frontend: Vanilla JS (app.js), HTML (portal.html, admin.html, index.html, shop-register.html)
- DB: Supabase (PostgreSQL)
- Deploy: Vercel
- Hotel data: Rakuten Travel API

## Supabase
- URL: https://ojkhwbvoaiaqekxrbpdd.supabase.co
- Key: sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB
- DB: see .env DATABASE_URL

## Tables
- hotels: 42,052 hotels (hotel_type, detail_area, city)
- reports: user posts (can_call/cannot_call, reasons, room_type, time_slot)
- shops: shop registration (is_approved, plan, denial_reason)
- shop_placements: ad placement by area level
- can_call_reasons / cannot_call_reasons / room_types: master data

## Pages
- index.html: gate (men/women/lgbtq/shop)
- portal.html + app.js: main app
- admin.html: admin panel
- shop-register.html: shop registration

## Gender modes
men / women / men_same / women_same

## Key logic
- extractCity(): parse city from address using prefecture list
- hotel_type: detected from name (business/city/resort/ryokan/pension/minshuku/other)
- detail_area: Rakuten detailClass (11 major cities only)
- Cache buster: app.js?v=3
- RLS: public_read + public_write on all tables

## Commands
- Import hotels: node import-rakuten.js
- Update city: node update_city.mjs
- Update detail_area: node update-detail-area.js
