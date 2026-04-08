<?php
// ==========================================================================
// portal-seo.php — ポータルページの動的SEO処理
// portal-men.php等から呼び出される。HTMLテンプレートを読み込み、
// URLパラメータに応じてtitle/description/canonical/OG/h1/JSON-LDを差し替えて出力。
// ==========================================================================

// --- 呼び出し元で $mode, $template を定義済み ---

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
        $stmt = $pdo->prepare('SELECT name, address, prefecture, city, hotel_type FROM hotels WHERE id = ? AND is_published = 1 LIMIT 1');
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

// --- noscript セクション追加（JSが実行されないクローラー向け） ---
$noscript_content = '<noscript><div style="padding:20px;max-width:800px;margin:0 auto;">';
$noscript_content .= '<h2>' . $esc($seo_h1) . '</h2>';
$noscript_content .= '<p>' . $esc($seo_desc) . '</p>';
if ($pref && !$hotel_id) {
    $noscript_content .= '<p><a href="https://yobuho.com/' . $esc($path) . '/">← ' . $esc($m['label']) . '全国ページへ</a></p>';
}
$noscript_content .= '</div></noscript>';

// </main>の直後に挿入
$html = str_replace('</main>', '</main>' . $noscript_content, $html);

// --- 出力 ---
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
echo $html;
