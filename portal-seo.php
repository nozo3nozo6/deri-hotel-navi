<?php
// ==========================================================================
// portal-seo.php — ポータルページの動的SEO処理
// portal-men.php等から呼び出される。HTMLテンプレートを読み込み、
// URLパラメータに応じてtitle/description/canonical/OG/h1/JSON-LDを差し替えて出力。
// ==========================================================================

// --- 呼び出し元で $mode, $template を定義済み ---

// HTMLは常に最新配信（.htaccessのHTML用no-cacheは.phpには効かないため明示設定）
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// 二重エンコードURL検出: %25 が含まれていたら正しいURLに301リダイレクト
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
if (strpos($requestUri, '%25') !== false) {
    $decoded = rawurldecode($requestUri);
    header('Location: ' . $decoded, true, 301);
    exit;
}

$pref   = isset($_GET['pref'])   ? urldecode($_GET['pref'])   : '';
$area   = isset($_GET['area'])   ? urldecode($_GET['area'])   : '';
$detail = isset($_GET['detail']) ? urldecode($_GET['detail']) : '';
$city   = isset($_GET['city'])   ? urldecode($_GET['city'])   : '';
$hotel_id = isset($_GET['hotel']) ? (int)$_GET['hotel']       : 0;
$shop   = isset($_GET['shop'])   ? $_GET['shop']              : '';

// SEO不要なケース（パラメータなし = トップページ、店舗ページ）はそのまま出力
if (!$pref && !$hotel_id) {
    readfile(__DIR__ . '/' . $template);
    exit;
}

// --- 2セグメントURL正規化: $area が市区町村名なら $city に再代入 ---
// .htaccess は 2セグメントURL /deli/東京都/渋谷区 を pref+area として渡すが、
// 実際にエリア名でない場合（市区町村名）は city として扱わないと
// SEOコンテンツが空になり Google に「代替ページ」「検出未登録」と判定される
if (!$city && $area && $pref) {
    $_checkData = @file_get_contents(__DIR__ . '/area-data.json');
    $_ad = $_checkData ? json_decode($_checkData, true) : [];
    $_prefAreas = $_ad['pref'][$pref]['areas'] ?? [];
    $_isRealArea = false;
    foreach ($_prefAreas as $_aRow) {
        if (($_aRow[0] ?? '') === $area) { $_isRealArea = true; break; }
    }
    if (!$_isRealArea) {
        // 市区町村として再解釈（canonicalはURLと一致させるため $area は復元しない）
        $city = $area;
        $area = '';
    }
    unset($_checkData, $_ad, $_prefAreas, $_isRealArea, $_aRow);
}

// --- モード別定義 ---
$MODE_SEO = [
    'men' => [
        'label'  => 'デリヘル',
        'verb'   => 'を呼べる',
        'suffix' => 'Deli YobuHo',
        'path'   => 'deli',
        'desc_detail' => 'デリヘルをホテルに呼べるか口コミで確認。直通・カードキー・フロント相談など入り方の実績もわかります。',
    ],
    'women' => [
        'label'  => '女性用風俗',
        'verb'   => 'を呼べる',
        'suffix' => 'JoFu YobuHo',
        'path'   => 'jofu',
        'desc_detail' => '女性用風俗・女風をホテルに呼べるか口コミで確認。出張女風俗の入室情報・呼べた実績を確認できます。',
    ],
    'men_same' => [
        'label'  => '男性同士',
        'verb'   => 'で利用できる',
        'suffix' => 'YobuHo',
        'path'   => 'same-m',
        'desc_detail' => '男性同士・ゲイカップルで利用できるホテルを口コミで確認。LGBTフレンドリーなホテル情報を掲載。',
    ],
    'women_same' => [
        'label'  => '女性同士',
        'verb'   => 'で利用できる',
        'suffix' => 'YobuHo',
        'path'   => 'same-f',
        'desc_detail' => '女性同士・レズビアンカップルで利用できるホテルを口コミで確認。LGBTフレンドリーなホテル情報を掲載。',
    ],
    'este' => [
        'label'  => 'デリエステ',
        'verb'   => 'を呼べる',
        'suffix' => 'Este YobuHo',
        'path'   => 'este',
        'desc_detail' => 'デリエステ（風俗エステ・回春マッサージ・M性感）をホテルに呼べるか口コミで確認。',
    ],
];

$m = $MODE_SEO[$mode] ?? $MODE_SEO['men'];
$path = $m['path'];

// --- SEOデータ生成 ---
$seo_title = '';
$seo_desc  = '';
$seo_canonical = '';
$seo_h1 = '';
$breadcrumbs = [
    ['name' => 'ホーム', 'url' => 'https://yobuho.com/'],
    ['name' => "{$m['label']}{$m['verb']}ホテル検索", 'url' => "https://yobuho.com/{$path}/"],
];

if ($hotel_id) {
    // ホテル詳細ページ: DB lookup
    $hotel = null;
    try {
        require_once __DIR__ . '/api/db.php';
        $pdo = DB::conn();
        $stmt = $pdo->prepare('SELECT name, address, prefecture, city, hotel_type, postal_code, tel, latitude, longitude, nearest_station FROM hotels WHERE id = ? AND is_published = 1 LIMIT 1');
        $stmt->execute([$hotel_id]);
        $hotel = $stmt->fetch();
    } catch (Exception $e) {
        // DB接続失敗時はデフォルトSEOで出力
    }

    if ($hotel) {
        $hn = $hotel['name'];
        $ha = $hotel['address'];
        $hp = $hotel['prefecture'];
        $hc = $hotel['city'];
        $seo_title = "{$hn} - {$m['label']}{$m['verb']}？口コミ情報 | {$m['suffix']}";
        $seo_desc  = "{$hn}（{$ha}）に{$m['label']}{$m['verb']}か口コミで確認。入室方法・部屋タイプ・時間帯など実際の利用情報を掲載。";
        $seo_canonical = "https://yobuho.com/{$path}/hotel/{$hotel_id}";
        $seo_h1 = "{$hn} - {$m['label']}{$m['verb']}？口コミ・入室情報";
        $breadcrumbs[] = ['name' => $hp, 'url' => "https://yobuho.com/{$path}/" . rawurlencode($hp)];
        $breadcrumbs[] = ['name' => $hn, 'url' => $seo_canonical];
    } else {
        // ホテルが見つからない場合はデフォルト
        readfile(__DIR__ . '/' . $template);
        exit;
    }
} elseif ($city && $pref) {
    // 市区町村ページ
    $location = $area ? "{$city}（{$pref} {$area}）" : "{$city}（{$pref}）";
    $seo_title = "{$city}の{$m['label']}{$m['verb']}ホテル｜{$pref} | {$m['suffix']}";
    $seo_desc  = "{$pref}{$city}で{$m['label']}{$m['verb']}ホテルを検索。{$m['desc_detail']}";
    if ($detail && $area) {
        $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($area) . '/' . rawurlencode($detail) . '/' . rawurlencode($city);
    } elseif ($area) {
        $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($area) . '/' . rawurlencode($city);
    } else {
        $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($city);
    }
    $seo_h1 = "{$city}（{$pref}）の{$m['label']}{$m['verb']}ホテル検索";
    $breadcrumbs[] = ['name' => $pref, 'url' => "https://yobuho.com/{$path}/" . rawurlencode($pref)];
    if ($area) {
        $breadcrumbs[] = ['name' => $area, 'url' => "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($area)];
    }
    $breadcrumbs[] = ['name' => $city, 'url' => $seo_canonical];
} elseif ($area && $pref) {
    // エリアページ（2セグメント: pref+area、areaが市区町村の場合もある）
    $seo_title = "{$area}の{$m['label']}{$m['verb']}ホテル｜{$pref} | {$m['suffix']}";
    $seo_desc  = "{$pref}{$area}で{$m['label']}{$m['verb']}ホテルを検索。{$m['desc_detail']}";
    $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($area);
    $seo_h1 = "{$area}（{$pref}）の{$m['label']}{$m['verb']}ホテル検索";
    $breadcrumbs[] = ['name' => $pref, 'url' => "https://yobuho.com/{$path}/" . rawurlencode($pref)];
    $breadcrumbs[] = ['name' => $area, 'url' => $seo_canonical];
} elseif ($pref) {
    // 都道府県ページ
    $seo_title = "{$pref}の{$m['label']}{$m['verb']}ホテル検索 | {$m['suffix']}";
    $seo_desc  = "{$pref}で{$m['label']}{$m['verb']}ホテルを地域から検索。{$m['desc_detail']}";
    $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref);
    $seo_h1 = "{$pref}の{$m['label']}{$m['verb']}ホテル検索";
    $breadcrumbs[] = ['name' => $pref, 'url' => $seo_canonical];
}

// --- JSON-LD BreadcrumbList 生成 ---
$breadcrumb_items = [];
foreach ($breadcrumbs as $i => $bc) {
    $breadcrumb_items[] = [
        '@type' => 'ListItem',
        'position' => $i + 1,
        'name' => $bc['name'],
        'item' => $bc['url'],
    ];
}
$breadcrumb_jsonld = json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'BreadcrumbList',
    'itemListElement' => $breadcrumb_items,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// --- HTMLテンプレート読み込み & 差し替え ---
$html = file_get_contents(__DIR__ . '/' . $template);
if ($html === false) {
    http_response_code(500);
    exit;
}

$esc = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };

// <title> 差し替え
$html = preg_replace('/<title>[^<]*<\/title>/', '<title>' . $esc($seo_title) . '</title>', $html, 1);

// <meta name="description"> 差し替え
$html = preg_replace(
    '/<meta name="description" content="[^"]*"/',
    '<meta name="description" content="' . $esc($seo_desc) . '"',
    $html, 1
);

// <link rel="canonical"> 差し替え
$html = preg_replace(
    '/<link rel="canonical" href="[^"]*"/',
    '<link rel="canonical" href="' . $esc($seo_canonical) . '"',
    $html, 1
);

// OGタグ差し替え
$html = preg_replace(
    '/<meta property="og:title" content="[^"]*"/',
    '<meta property="og:title" content="' . $esc($seo_title) . '"',
    $html, 1
);
$html = preg_replace(
    '/<meta property="og:description" content="[^"]*"/',
    '<meta property="og:description" content="' . $esc($seo_desc) . '"',
    $html, 1
);
$html = preg_replace(
    '/<meta property="og:url" content="[^"]*"/',
    '<meta property="og:url" content="' . $esc($seo_canonical) . '"',
    $html, 1
);

// Twitterタグ差し替え
$html = preg_replace(
    '/<meta name="twitter:title" content="[^"]*"/',
    '<meta name="twitter:title" content="' . $esc($seo_title) . '"',
    $html, 1
);
$html = preg_replace(
    '/<meta name="twitter:description" content="[^"]*"/',
    '<meta name="twitter:description" content="' . $esc($seo_desc) . '"',
    $html, 1
);

// <h1> 差し替え（sr-only）
$html = preg_replace(
    '/<h1 class="sr-only">[^<]*<\/h1>/',
    '<h1 class="sr-only">' . $esc($seo_h1) . '</h1>',
    $html, 1
);

// JSON-LD BreadcrumbList 差し替え（既存のBreadcrumbListを新しいものに置換）
$html = preg_replace(
    '/<script type="application\/ld\+json">\s*\{[^<]*"BreadcrumbList"[^<]*\}<\/script>/',
    '<script type="application/ld+json">' . $breadcrumb_jsonld . '</script>',
    $html, 1
);

// WebApplication JSON-LD の SearchAction URL をモード別に修正
$html = preg_replace(
    '/https:\/\/yobuho\.com\/[a-z-]+\/\?keyword=\{search_term_string\}/',
    'https://yobuho.com/' . $path . '/?keyword={search_term_string}',
    $html
);

// --- Hotel スキーマ JSON-LD（ホテル詳細ページのみ）---
// Googleホテル検索結果での露出・リッチリザルト対応
if ($hotel_id && !empty($hotel)) {
    $hotel_schema = [
        '@context' => 'https://schema.org',
        '@type' => 'Hotel',
        'name' => $hotel['name'],
        'url' => $seo_canonical,
        'description' => "{$hotel['name']}（{$hotel['address']}）で{$m['label']}{$m['verb']}か、口コミと店舗情報から確認できるホテル情報ページ。",
        'address' => [
            '@type' => 'PostalAddress',
            'streetAddress' => $hotel['address'],
            'addressLocality' => $hotel['city'],
            'addressRegion' => $hotel['prefecture'],
            'addressCountry' => 'JP',
        ],
    ];
    if (!empty($hotel['postal_code'])) {
        $hotel_schema['address']['postalCode'] = $hotel['postal_code'];
    }
    if (!empty($hotel['latitude']) && !empty($hotel['longitude'])) {
        $hotel_schema['geo'] = [
            '@type' => 'GeoCoordinates',
            'latitude' => (float)$hotel['latitude'],
            'longitude' => (float)$hotel['longitude'],
        ];
    }
    if (!empty($hotel['tel'])) {
        $hotel_schema['telephone'] = $hotel['tel'];
    }
    // hotel_type を schema.org 分類に補助マッピング
    $type_map = [
        'business' => 'ビジネスホテル',
        'city'     => 'シティホテル',
        'resort'   => 'リゾートホテル',
        'ryokan'   => '旅館',
        'love_hotel'   => 'ラブホテル',
        'rental_room'  => 'レンタルルーム',
    ];
    if (!empty($hotel['hotel_type']) && isset($type_map[$hotel['hotel_type']])) {
        $hotel_schema['additionalType'] = $type_map[$hotel['hotel_type']];
    }
    $hotel_jsonld = json_encode($hotel_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $html = str_replace('</head>', '<script type="application/ld+json">' . $hotel_jsonld . '</script></head>', $html);
}

// --- 静的SEOコンテンツ生成（クローラー & JS無効ユーザー向け） ---
// area-data.json / hotel-data/*.json から当該ページ固有の情報を埋め込む

function loadAreaData() {
    static $data = null;
    if ($data === null) {
        $raw = @file_get_contents(__DIR__ . '/area-data.json');
        $data = $raw ? json_decode($raw, true) : [];
    }
    return $data;
}

function loadPrefHotels($pref) {
    static $cache = [];
    if (!isset($cache[$pref])) {
        $raw = @file_get_contents(__DIR__ . '/hotel-data/' . $pref . '.json');
        $cache[$pref] = $raw ? json_decode($raw, true) : [];
    }
    return $cache[$pref];
}

function buildSeoLink($path, $pref, $area = '', $detail = '', $city = '', $label = '', $count = null) {
    $parts = [rawurlencode($pref)];
    if ($area !== '') $parts[] = rawurlencode($area);
    if ($detail !== '') $parts[] = rawurlencode($detail);
    if ($city !== '') $parts[] = rawurlencode($city);
    $url = 'https://yobuho.com/' . $path . '/' . implode('/', $parts);
    $countText = $count !== null ? '（' . number_format($count) . '件）' : '';
    $esc = fn($s) => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return '<li><a href="' . $esc($url) . '">' . $esc($label) . $countText . '</a></li>';
}

$seo_static = '';
if (!$hotel_id && $pref) {
    $esc_fn = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };
    $areaData = loadAreaData();
    $label = $m['label'];
    $verb = $m['verb'];

    $seo_static .= '<section class="seo-static-content" style="padding:24px 20px; max-width:900px; margin:0 auto; font-size:14px; line-height:1.8;">';
    $seo_static .= '<h2 style="font-size:18px; margin:0 0 12px;">' . $esc_fn($seo_h1) . '</h2>';

    if ($city) {
        // --- 市区町村ページ: 上位ホテル10件 + 近隣市区町村リンク ---
        $totalInArea = 0;
        $areaKey = $area ? $pref . "\t" . $area : '';
        if ($areaKey && isset($areaData['area'][$areaKey]['ct'])) {
            foreach ($areaData['area'][$areaKey]['ct'] as $row) {
                if ($row[0] === $city) { $totalInArea = ($row[1] ?? 0) + ($row[2] ?? 0); break; }
            }
        }
        if ($totalInArea === 0) {
            // エリアなし直接 or エリア情報なし: noArea or prefCount から推定
            $totalInArea = 0;
        }

        $seo_static .= '<p>' . $esc_fn($pref . $city) . 'で' . $esc_fn($label . $verb) . 'ホテルを口コミから検索。';
        $seo_static .= '直通・カードキー・フロント相談など実際の入室実績から判断できます。</p>';

        // 当該市区町村のホテルを hotel-data から抽出（最大10件）
        $hotels = loadPrefHotels($pref);
        $matched = [];
        if (is_array($hotels)) {
            foreach ($hotels as $h) {
                if (isset($h['city']) && $h['city'] === $city) {
                    $matched[] = $h;
                    if (count($matched) >= 30) break;
                }
            }
        }
        // ラブホ以外を優先、review_average降順
        usort($matched, function($a, $b) {
            $aLoveho = in_array($a['hotel_type'] ?? '', ['love_hotel', 'rental_room']);
            $bLoveho = in_array($b['hotel_type'] ?? '', ['love_hotel', 'rental_room']);
            if ($aLoveho !== $bLoveho) return $aLoveho ? 1 : -1;
            return ($b['review_average'] ?? 0) <=> ($a['review_average'] ?? 0);
        });
        $topHotels = array_slice($matched, 0, 10);

        if (count($topHotels) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">主要ホテル</h3>';
            $seo_static .= '<ul style="padding-left:20px; margin:0 0 12px;">';
            foreach ($topHotels as $h) {
                $hUrl = 'https://yobuho.com/' . $path . '/hotel/' . (int)$h['id'];
                $seo_static .= '<li><a href="' . $esc_fn($hUrl) . '">' . $esc_fn($h['name']) . '</a>';
                if (!empty($h['address'])) {
                    $seo_static .= ' <span style="color:#888; font-size:12px;">' . $esc_fn($h['address']) . '</span>';
                }
                $seo_static .= '</li>';
            }
            $seo_static .= '</ul>';
        }

        // 同じエリア内の他の市区町村
        if ($areaKey && isset($areaData['area'][$areaKey]['ct'])) {
            $siblings = $areaData['area'][$areaKey]['ct'];
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">' . $esc_fn($area) . 'の他の市区町村</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            $cnt = 0;
            foreach ($siblings as $row) {
                if ($row[0] === $city || $cnt >= 20) continue;
                $total = ($row[1] ?? 0) + ($row[2] ?? 0);
                $seo_static .= buildSeoLink($path, $pref, $area, '', $row[0], $row[0], $total);
                $cnt++;
            }
            $seo_static .= '</ul>';
        }
    } elseif ($detail && $area) {
        // --- 詳細エリアページ: 配下市区町村 ---
        $detailKey = $pref . "\t" . $area . "\t" . $detail;
        $cities = $areaData['da'][$detailKey]['ct'] ?? [];
        $seo_static .= '<p>' . $esc_fn($pref . ' ' . $area . ' ' . $detail) . 'エリアで' . $esc_fn($label . $verb) . 'ホテルを市区町村別に検索。</p>';
        if (count($cities) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">市区町村一覧</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            foreach ($cities as $row) {
                $total = ($row[1] ?? 0) + ($row[2] ?? 0);
                $seo_static .= buildSeoLink($path, $pref, $area, $detail, $row[0], $row[0], $total);
            }
            $seo_static .= '</ul>';
        }
    } elseif ($area) {
        // --- エリアページ: 配下の詳細エリア + 市区町村 ---
        $areaKey = $pref . "\t" . $area;
        $areaInfo = $areaData['area'][$areaKey] ?? [];
        $detailsList = $areaInfo['da'] ?? [];
        $cities = $areaInfo['ct'] ?? [];
        $seo_static .= '<p>' . $esc_fn($pref . ' ' . $area) . 'エリアで' . $esc_fn($label . $verb) . 'ホテルを詳細エリア・市区町村別に検索。</p>';

        if (count($detailsList) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">詳細エリア</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            foreach ($detailsList as $row) {
                $seo_static .= buildSeoLink($path, $pref, $area, $row[0], '', $row[0], $row[1] ?? null);
            }
            $seo_static .= '</ul>';
        }
        if (count($cities) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">市区町村一覧</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            $cnt = 0;
            foreach ($cities as $row) {
                if ($cnt >= 30) break;
                $total = ($row[1] ?? 0) + ($row[2] ?? 0);
                $seo_static .= buildSeoLink($path, $pref, $area, '', $row[0], $row[0], $total);
                $cnt++;
            }
            $seo_static .= '</ul>';
        }
    } elseif ($pref) {
        // --- 都道府県ページ: エリア一覧 + 代表市区町村 ---
        $prefInfo = $areaData['pref'][$pref] ?? [];
        $areas = $prefInfo['areas'] ?? [];
        $prefCount = $areaData['prefCounts'][$pref] ?? 0;

        $seo_static .= '<p>' . $esc_fn($pref) . 'で' . $esc_fn($label . $verb) . 'ホテルを地域から検索できます。';
        if ($prefCount > 0) {
            $seo_static .= '掲載ホテル数: <strong>' . number_format($prefCount) . '件</strong>（ビジネス/シティ/ラブホ含む）。';
        }
        $seo_static .= '利用者の口コミと掲載店舗の案内実績情報から、実際に' . $esc_fn($label . $verb) . 'か判断できます。</p>';

        if (count($areas) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">エリアから探す</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            foreach ($areas as $row) {
                $seo_static .= buildSeoLink($path, $pref, $row[0], '', '', $row[0], $row[1] ?? null);
            }
            $seo_static .= '</ul>';
        }

        // 代表市区町村（全エリアから上位を集める）
        $allCities = [];
        foreach ($areas as $aRow) {
            $areaKey = $pref . "\t" . $aRow[0];
            $cts = $areaData['area'][$areaKey]['ct'] ?? [];
            foreach ($cts as $c) {
                $cityName = $c[0];
                $total = ($c[1] ?? 0) + ($c[2] ?? 0);
                if (!isset($allCities[$cityName]) || $allCities[$cityName]['total'] < $total) {
                    $allCities[$cityName] = ['area' => $aRow[0], 'total' => $total];
                }
            }
        }
        // noArea（エリア無し）の場合は noArea.ct から
        if (count($allCities) === 0 && isset($areaData['noArea'][$pref]['ct'])) {
            foreach ($areaData['noArea'][$pref]['ct'] as $c) {
                $allCities[$c[0]] = ['area' => '', 'total' => ($c[1] ?? 0) + ($c[2] ?? 0)];
            }
        }
        uasort($allCities, fn($a, $b) => $b['total'] <=> $a['total']);
        $topCities = array_slice($allCities, 0, 20, true);

        if (count($topCities) > 0) {
            $seo_static .= '<h3 style="font-size:15px; margin:16px 0 8px;">主要市区町村</h3>';
            $seo_static .= '<ul style="padding-left:20px; columns:2; margin:0 0 12px;">';
            foreach ($topCities as $cityName => $info) {
                $seo_static .= buildSeoLink($path, $pref, $info['area'], '', $cityName, $cityName, $info['total']);
            }
            $seo_static .= '</ul>';
        }
    }

    // 共通末尾: 全国ページへの戻りリンク
    $seo_static .= '<p style="margin-top:16px;"><a href="https://yobuho.com/' . $esc_fn($path) . '/">← ' . $esc_fn($label) . '全国ページへ</a></p>';
    $seo_static .= '</section>';
}

// --- noscript セクション追加（JSが実行されないクローラー向け） ---
$noscript_content = '<noscript><div style="padding:20px;max-width:800px;margin:0 auto;">';
$noscript_content .= '<h2>' . $esc($seo_h1) . '</h2>';
$noscript_content .= '<p>' . $esc($seo_desc) . '</p>';
if ($pref && !$hotel_id) {
    $noscript_content .= '<p><a href="https://yobuho.com/' . $esc($path) . '/">← ' . $esc($m['label']) . '全国ページへ</a></p>';
}
$noscript_content .= '</div></noscript>';

// <main>内末尾に挿入（静的SEOを主要コンテンツ扱いにしてソフト404回避）
// noscriptは</main>の外側（従来どおり）
$html = str_replace('</main>', $seo_static . '</main>' . $noscript_content, $html);

// --- 出力 ---
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
echo $html;
