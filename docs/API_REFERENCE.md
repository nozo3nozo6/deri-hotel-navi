# Deri Hotel Navi - API Reference

## Supabase Configuration

- **URL**: `https://ojkhwbvoaiaqekxrbpdd.supabase.co`
- **Publishable Key**: `sb_publishable_UqlcQo5CdoPB_1s1ouLX9Q_olbwArKB`
- **Client Library**: `@supabase/supabase-js` v2 (loaded via CDN)

## RLS Policies

All tables use `public_read` + `public_write` RLS policies. This means:
- Any client with the publishable key can SELECT, INSERT, UPDATE rows
- Server-side operations (admin auth) use the **service role key** via PHP

---

## Tables

### hotels

Main hotel data. ~42,052 records imported from Rakuten Travel API.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer (PK) | Auto-increment ID |
| `name` | text | Hotel name |
| `address` | text | Full address |
| `prefecture` | text | Prefecture (e.g. "東京都") |
| `city` | text | City extracted from address |
| `major_area` | text | Major area grouping |
| `detail_area` | text | Detail area (Rakuten detailClass, 11 major cities only) |
| `hotel_type` | text | business / city / resort / ryokan / pension / minshuku / love_hotel / rental_room / other |
| `latitude` | float | Latitude |
| `longitude` | float | Longitude |
| `min_charge` | integer | Minimum room rate |
| `review_average` | float | Average review score |
| `review_count` | integer | Number of reviews |
| `nearest_station` | text | Nearest station name |
| `tel` | text | Phone number |
| `is_published` | boolean | Whether hotel is visible (default true) |

**API call patterns:**
```javascript
// Select with filters
supabaseClient.from('hotels').select('*')
  .eq('is_published', true)
  .eq('prefecture', pref)
  .eq('major_area', area)
  .not('hotel_type', 'in', '("love_hotel","rental_room")')
  .order('review_average', { ascending: false })
  .limit(1000)

// Count only
supabaseClient.from('hotels').select('id', { count: 'exact', head: true })
  .eq('prefecture', pref)

// Single hotel by ID
supabaseClient.from('hotels').select('*').eq('id', hotelId).maybeSingle()
```

---

### reports

User-submitted reports about whether a hotel allows delivery service calls.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated UUID |
| `hotel_id` | integer (FK -> hotels) | Referenced hotel |
| `can_call` | boolean | true = can call, false = cannot call |
| `poster_type` | text | "user" or "shop" |
| `poster_name` | text | Display name (default "無記名") |
| `can_call_reasons` | jsonb | Array of reasons (e.g. ["直通", "カードキー必須"]) |
| `cannot_call_reasons` | jsonb | Array of reasons (e.g. ["フロントSTOP"]) |
| `time_slot` | text | Time slot of visit |
| `room_type` | text | Room type |
| `comment` | text | Free-form comment (max 500 chars) |
| `multi_person` | boolean | Whether multiple guests |
| `guest_male` | integer | Number of male guests |
| `guest_female` | integer | Number of female guests |
| `gender_mode` | text | Mode at time of posting |
| `fingerprint` | text | Browser fingerprint (for duplicate prevention) |
| `created_at` | timestamptz | Creation timestamp |
| `flagged_at` | timestamptz | When flagged for review |
| `flag_reason` | text | Flag reason |
| `flag_comment` | text | Flag comment |

**API call patterns:**
```javascript
// Insert report
supabaseClient.from('reports').insert(payload)

// Fetch summaries
supabaseClient.from('reports')
  .select('hotel_id,can_call,poster_type')
  .in('hotel_id', hotelIds)

// Latest report dates
supabaseClient.from('reports')
  .select('hotel_id,created_at')
  .in('hotel_id', hotelIds)
  .order('created_at', { ascending: false })

// Flag a report
supabaseClient.from('reports')
  .update({ flagged_at, flag_reason, flag_comment })
  .eq('id', reportId)
```

---

### hotel_report_summary (view)

Materialized view/view aggregating report data per hotel. Tried first, falls back to `reports` table.

| Column | Type | Description |
|--------|------|-------------|
| `hotel_id` | integer | Hotel ID |
| `can_call_count` | integer | User "can call" reports |
| `cannot_call_count` | integer | User "cannot call" reports |
| `shop_can_count` | integer | Shop "can call" reports |
| `shop_ng_count` | integer | Shop "cannot call" reports |
| `total_reports` | integer | Total report count |

---

### report_votes

User votes on report helpfulness.

| Column | Type | Description |
|--------|------|-------------|
| `report_id` | uuid (FK -> reports) | Report being voted on |
| `fingerprint` | text | Voter's browser fingerprint |
| `vote` | text | "helpful" or "unhelpful" |

**Unique constraint**: `(report_id, fingerprint)` -- prevents duplicate votes (error code 23505).

```javascript
supabaseClient.from('report_votes').insert({
  report_id, fingerprint, vote
})
```

---

### shops

Registered shop/business accounts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Shop ID |
| `shop_name` | text | Shop name |
| `email` | text | Contact email |
| `shop_url` | text | Shop website URL |
| `gender_mode` | text | Target mode |
| `plan_id` | integer | Contract plan FK |
| `status` | text | "active", "pending", etc. |
| `is_approved` | boolean | Approval status |
| `denial_reason` | text | Reason for denial (if any) |

```javascript
// Fetch active shop by ID
supabaseClient.from('shops')
  .select('shop_name,gender_mode,shop_url,plan_id,status,contract_plans(price)')
  .eq('id', SHOP_ID)
  .eq('status', 'active')
  .maybeSingle()
```

---

### ad_placements

Advertisement placements by area level.

| Column | Type | Description |
|--------|------|-------------|
| `placement_type` | text | "premium" / "big" / "area" / "town" / "spot" |
| `placement_target` | text | Target area name |
| `status` | text | "active" |
| `mode` | text | "men" / "women" / "all" / null |
| `shop_id` | uuid (FK -> shops) | Advertising shop |

**Joined tables**: `shops(shop_name, shop_url)`, `ad_plans(name)`

```javascript
supabaseClient.from('ad_placements')
  .select('*, shops(shop_name, shop_url), ad_plans(name)')
  .eq('placement_type', placementType)
  .eq('placement_target', placementTarget)
  .eq('status', 'active')
  .or('mode.eq.' + currentMode + ',mode.eq.all,mode.is.null')
```

Ad placement levels:
| Level | Type | Example Target |
|-------|------|----------------|
| National | `premium` | "全国" |
| Prefecture | `big` | "東京都" |
| Major Area | `area` | "新宿・歌舞伎町" |
| Town | `town` | Detail area name |
| Spot | `spot` | City name |

---

### hotel_requests

User-submitted requests to add missing hotels.

| Column | Type | Description |
|--------|------|-------------|
| `hotel_name` | text | Requested hotel name |
| `address` | text | Hotel address |
| `tel` | text | Phone number (optional) |
| `hotel_type` | text | Hotel type |
| `status` | text | "pending" / "approved" / "rejected" |

```javascript
supabaseClient.from('hotel_requests').insert({
  hotel_name, address, tel, hotel_type, status: 'pending'
})
```

---

### loveho_reports

Love hotel review submissions.

| Column | Type | Description |
|--------|------|-------------|
| `hotel_id` | integer (FK -> hotels) | Hotel ID |
| `solo_entry` | text | Solo entry possibility |
| `atmosphere` | text | Atmosphere description |
| `good_points` | jsonb | Array of good point labels |
| `time_slot` | text | Visit time slot |
| `comment` | text | Free-form comment (max 500 chars) |
| `poster_name` | text | Poster display name |
| `gender_mode` | text | Mode at time of posting |
| `multi_person` | boolean | Multiple guests |
| `guest_male` | integer | Male guest count |
| `guest_female` | integer | Female guest count |
| `recommendation` | integer | Rating (1-5) |
| `cleanliness` | integer | Rating (1-5) |
| `cost_performance` | integer | Rating (1-5) |

---

### Master Data Tables

#### can_call_reasons
| Column | Type | Description |
|--------|------|-------------|
| `label` | text | Reason label (e.g. "直通", "カードキー必須") |
| `sort_order` | integer | Display order |

Default values: 直通, カードキー必須, EVフロント階スキップ, 玄関待ち合わせ, 深夜玄関待合, 2名予約必須, フロント相談, ノウハウ, バスタオル依頼推奨, その他

#### cannot_call_reasons
| Column | Type | Description |
|--------|------|-------------|
| `label` | text | Reason label |
| `sort_order` | integer | Display order |

Default values: フロントSTOP, 防犯カメラ確認, 深夜外出NG, その他

#### room_types
| Column | Type | Description |
|--------|------|-------------|
| `label` | text | Room type label |
| `sort_order` | integer | Display order |

Default values: シングル, ダブル, ツイン, スイート, 和室, その他

#### Love Hotel Master Tables
- `loveho_atmospheres` (name, sort_order)
- `loveho_room_types` (name, sort_order)
- `loveho_facilities` (name, sort_order)
- `loveho_price_ranges` (name, type ["rest"/"stay"], sort_order)
- `loveho_time_slots` (name, sort_order)
- `loveho_good_points` (label, category, is_active, sort_order)

---

### admin_users

Admin panel user accounts. Accessed only from server-side PHP.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer (PK) | User ID |
| `username` | text | Login username |
| `password_hash` | text | bcrypt hashed password |

---

## PHP API Endpoints

### `api/auth.php`

Admin authentication endpoint. Uses PHP sessions with file-based rate limiting.

| Action | Method | Parameters | Description |
|--------|--------|------------|-------------|
| `?action=login` | POST | `{ username, password }` | Login with bcrypt verification |
| `?action=logout` | GET/POST | - | Destroy session |
| `?action=check` | GET | - | Check session validity (30min timeout) |
| `?action=change-password` | POST | `{ current_password, new_password }` | Change password (requires active session) |

Rate limiting: 5 attempts max, 15-minute lockout.
Session timeout: 30 minutes of inactivity.
CORS: restricted to `https://yobuho.com`.

### `api/send-mail.php`

Email sending endpoint using `mb_send_mail`.

| Method | Parameters | Description |
|--------|------------|-------------|
| POST | `{ to, subject, body }` | Send email from `hotel@yobuho.com` |

CORS: open (`*`).

---

## External APIs

### Nominatim (OpenStreetMap)
Used for reverse geocoding in location-based search.
```
GET https://nominatim.openstreetmap.org/reverse
  ?format=json&lat={lat}&lon={lng}&accept-language=ja
User-Agent: DeriHotelNavi/1.0
```

### Rakuten Travel API
Used for hotel data import (via `import-rakuten.js`, server-side Node.js script).
