# Deri Hotel Navi - Architecture

## System Overview

```
+-------------------+       +-------------------+       +-------------------+
|   Browser         |       |   Shin Rental     |       |   Supabase        |
|   (Vanilla JS)    | <---> |   Server (PHP)    | <---> |   (PostgreSQL)    |
|                   |       |   sv6825.wpx.ne.jp|       |                   |
| portal.html       |       | api/auth.php      |       | hotels            |
| index.html        |       | api/send-mail.php |       | reports           |
| admin.html        |       |                   |       | shops             |
| shop-register.html|       +-------------------+       | ad_placements     |
|                   |                                   | loveho_reports    |
| JS Modules:       |  Direct Supabase (REST API)       | hotel_requests    |
| api-service.js    | --------------------------------> | admin_users       |
| ui-utils.js       |                                   | can_call_reasons  |
| area-navigation.js|                                   | cannot_call_reasons|
| hotel-search.js   |                                   | room_types        |
| form-handler.js   |                                   | loveho_* tables   |
+-------------------+                                   +-------------------+
        |
        v
+-------------------+       +-------------------+
| Leaflet (Maps)    |       | Nominatim OSM     |
| CDN               |       | (Reverse Geocode) |
+-------------------+       +-------------------+
```

## Directory Structure

```
deri-hotel-navi/
|-- portal.html            # Main app page (hotel search, detail, report forms)
|-- index.html             # Gate page (mode selection: men/women/men_same/women_same)
|-- admin.html             # Admin panel (report management, shop approval)
|-- shop-register.html     # Shop registration form
|-- contact.html           # Contact page
|-- legal.html             # Legal information
|-- privacy.html           # Privacy policy
|-- terms.html             # Terms of service
|
|-- api-service.js         # Supabase client init, API calls, master data loading, ads
|-- ui-utils.js            # DOM helpers, toast, modal, i18n, extractCity, calcDistance
|-- area-navigation.js     # Region/prefecture/city navigation, URL state management
|-- hotel-search.js        # Hotel list fetching, card rendering, love hotel tabs, detail view
|-- form-handler.js        # Report form state, submission, flag/vote, hotel request
|
|-- style.css              # All styles, CSS custom properties for theming
|-- favicon.svg            # SVG favicon
|-- ogp.svg                # OGP image source
|-- robots.txt             # Robots configuration
|-- sitemap.xml            # Generated sitemap
|
|-- api/
|   |-- auth.php           # Admin authentication (login/logout/session/password change)
|   |-- auth-config.php    # Supabase service key, session/rate limit constants
|   |-- send-mail.php      # Email sending endpoint (mb_send_mail)
|   |-- migrate-passwords.php  # Password migration utility
|
|-- sql/
|   |-- contract_plans.sql      # Contract plans table DDL
|   |-- shop_service_options.sql # Shop service options DDL
|   |-- shop_hotel_info.sql      # Shop hotel info DDL
|   |-- reports_add_shop_id.sql  # Migration: add shop_id to reports
|   |-- add-indexes.sql          # Performance indexes
|
|-- scripts/
|   |-- import-yahoo-hotels.js   # Yahoo hotel import script
|
|-- import-rakuten.js      # Rakuten Travel API hotel import
|-- update-detail-area.js  # Update detail_area column for hotels
|-- generate-sitemap.js    # Sitemap generator
|
|-- docs/                  # Documentation
|-- tests/                 # Test files
|-- package.json           # Node dependencies (supabase-js, axios, dotenv)
```

## Module Dependency Graph

```
portal.html
  |-- (CDN) Leaflet 1.9.4 (maps)
  |-- (CDN) @supabase/supabase-js v2
  |
  |-- api-service.js          [1st loaded]
  |     Provides: supabaseClient, esc(), SHOP_ID, SHOP_DATA
  |     Provides: fetchReportSummaries(), fetchLatestReportDates()
  |     Provides: fetchHotelsWithSummary(), fetchLovehoReviewSummaries()
  |     Provides: loadCanCallReasonsMaster(), loadCannotCallReasonsMaster()
  |     Provides: loadRoomTypesMaster(), loadLhMasters()
  |     Provides: loadAds(), fetchDetailAds(), clearAds()
  |     Provides: reverseGeocode(), getGateUrl()
  |     Provides: CAN_CALL_REASONS, CANNOT_CALL_REASONS, ROOM_TYPES, LH_MASTER
  |
  |-- ui-utils.js              [2nd loaded]
  |     Depends on: (nothing external)
  |     Provides: showToast(), showLoading(), hideLoading()
  |     Provides: showSuccessModal(), closeSuccessModal()
  |     Provides: extractCity(), calcDistance(), freshnessLabel()
  |     Provides: formatDate(), formatTransportFee(), buildDonutSVG()
  |     Provides: setTitle(), setBackBtn(), setBreadcrumb()
  |     Provides: buildAreaButtons(), clearHotelList()
  |     Provides: t() (i18n), changeLang(), state, LANG
  |     Provides: sortHotelsByReviews(), getReportCount()
  |     Provides: applyKeywordFilter(), updatePageTitle()
  |
  |-- area-navigation.js      [3rd loaded]
  |     Depends on: supabaseClient, esc(), SHOP_ID (api-service.js)
  |     Depends on: t(), setTitle(), setBackBtn(), setBreadcrumb() (ui-utils.js)
  |     Depends on: clearHotelList(), buildAreaButtons() (ui-utils.js)
  |     Depends on: loadAds(), clearAds() (api-service.js)
  |     Depends on: extractCity(), updatePageTitle() (ui-utils.js)
  |     Provides: REGION_MAP, showJapanPage(), showPrefPage()
  |     Provides: showMajorAreaPage(), showCityPage(), showDetailAreaPage()
  |     Provides: restoreFromUrl(), updateUrl(), backLevel()
  |     Provides: pageStack, currentPage
  |
  |-- hotel-search.js         [4th loaded]
  |     Depends on: supabaseClient, fetchHotelsWithSummary() (api-service.js)
  |     Depends on: showLoading/hideLoading(), sortHotelsByReviews() (ui-utils.js)
  |     Depends on: updateUrl(), REGION_MAP (area-navigation.js)
  |     Provides: fetchAndShowHotels(), fetchAndShowHotelsByCity()
  |     Provides: showLovehoTabs(), renderHotelCards()
  |     Provides: showHotelPanel(), loadHotelDetail(), loadLovehoDetail()
  |
  |-- form-handler.js         [5th loaded]
  |     Depends on: supabaseClient, CAN_CALL_REASONS (api-service.js)
  |     Depends on: showToast(), showSuccessModal() (ui-utils.js)
  |     Depends on: currentHotelId (hotel-search.js)
  |     Provides: hotelFormState, hotelSetCanCall(), hotelSubmitReport()
  |     Provides: doSubmitReport(), submitLovehoReport()
  |     Provides: voteReport(), submitFlag(), submitHotelRequest()
  |     Provides: window.onload (initialization entry point)
```

All modules use global scope. Functions and variables are shared via `window` globals.
Load order in portal.html is critical: api-service -> ui-utils -> area-navigation -> hotel-search -> form-handler.

## Data Flow

### Hotel Search Flow
```
User selects region
  -> showJapanPage() [area-navigation.js]
  -> showPrefPage(region) -> showMajorAreaPage() -> showCityPage()
  -> fetchAndShowHotelsByCity() [hotel-search.js]
     -> supabaseClient.from('hotels').select('*').eq(filters)
     -> fetchHotelsWithSummary() [api-service.js]
        -> fetchReportSummaries(hotelIds)
           -> tries 'hotel_report_summary' view first
           -> falls back to 'reports' table
        -> fetchLatestReportDates(hotelIds)
     -> sortHotelsByReviews() [ui-utils.js]
     -> renderHotelCards() -> DOM update
```

### Report Submission Flow
```
User taps hotel card
  -> showHotelPanel() / loadHotelDetail() [hotel-search.js]
  -> User fills form (can_call, reasons, time_slot, room_type, comment)
  -> hotelSubmitReport() [form-handler.js]
     -> showPostConfirmModal() (confirmation)
     -> doSubmitReport()
        -> supabaseClient.from('reports').insert(payload)
        -> showSuccessModal()
        -> reload detail via loadHotelDetail()
```

### URL State Management
```
Each page change calls updateUrl() [area-navigation.js]
  -> history.pushState() with params: mode, region, pref, area, detail, city, hotel

Browser back button:
  -> popstate event -> restoreFromUrl()
  -> Parses URL params and rebuilds the correct page

Direct URL access (deep link / SEO):
  -> window.onload -> restoreFromUrl()
  -> Reconstructs pageStack and navigates to correct view
```

## Theme Management (CSS Custom Properties)

Themes are controlled via `data-mode` attribute on `<body>`, set by JavaScript based on the `mode` URL parameter.

| Mode          | Description       | Accent Color | Background |
|---------------|-------------------|--------------|------------|
| (default)     | Base theme        | `#c9a84c` (gold) | `#faf8f3` (warm white) |
| `men`         | Male delivery     | `#9b2d35` (dark red) | Same as default |
| `women`       | Female escort     | `#b5627a` (rose) | `#faf6f8` (pink tint) |
| `men_same`    | Male same-sex     | `#2a5a8f` (navy) | `#f0f2f8` (blue tint) |
| `women_same`  | Female same-sex   | `#8a5a9e` (purple) | `#f4f0f8` (lavender tint) |

CSS custom properties used:
- `--accent`, `--accent-light`, `--accent-dim`, `--accent-bg`, `--accent-glow`
- `--bg-2`, `--bg-3`, `--bg-4`
- `--text`, `--text-2`, `--text-3`
- `--border`, `--border-strong`

## Deploy Flow

```
Developer
  -> git push to GitHub (main branch)
  -> Server-side git pull (auto-configured on sv6825.wpx.ne.jp)
  -> Files served from shin rental server
```

Note: GitHub Actions was previously used for FTP deploy but has been removed. The server now uses git pull directly.

## Adding a New Feature - Guide

### Adding a new Supabase table query
1. Add the fetch function in `api-service.js`
2. Call it from the appropriate module (hotel-search.js for display, form-handler.js for submissions)

### Adding a new UI component
1. Add HTML structure in `portal.html`
2. Add styles in `style.css` using CSS custom properties for theme compatibility
3. Add behavior in the appropriate JS module
4. If it's a modal, register it in the Escape key listener in `form-handler.js`

### Adding a new master data table
1. Create the table in Supabase with `sort_order` column
2. Add a `load*Master()` function in `api-service.js`
3. Call it during initialization (in `form-handler.js` `window.onload`)

### Adding a new page/mode
1. Add the mode to `GATE_URL_MAP` in `api-service.js`
2. Add theme CSS variables under `[data-mode="new_mode"]` in `style.css`
3. Add the option in `index.html` gate page

### Cache busting
When modifying `app.js` or any JS module, increment the version number in portal.html:
```html
<script defer src="hotel-search.js?v=4"></script>  <!-- increment v= -->
```

### Testing
Run tests with: `npx vitest`
Test files go in `tests/` directory.
