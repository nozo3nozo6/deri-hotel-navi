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

// --- fatal 捕捉 + soft fallback ---
// catch(\Throwable) でも拾えない真の fatal（メモリ枯渇 / 実行時間超過 / parse 等）が
// 出ると PHP は自動で 500 を返す。Googlebot がこれを踏むと GSC「サーバーエラー(5xx)」に
// なるため、(1) docroot 外の log/ に記録して次回再発を確実に捕捉し、
// (2) 出力前ならテンプレートを 200 で返して 5xx の露出自体を防ぐ。
register_shutdown_function(function () use ($template) {
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true)) {
        return;
    }
    // 記録（log/ は public_html の外＝web 非公開）
    @error_log(sprintf(
        "[%s] FATAL: %s in %s:%d | uri=%s | ua=%s\n",
        date('c'), $e['message'], $e['file'], $e['line'],
        $_SERVER['REQUEST_URI'] ?? '-', $_SERVER['HTTP_USER_AGENT'] ?? '-'
    ), 3, __DIR__ . '/../log/seo_fatal.log');
    // まだ出力していなければ soft fallback（テンプレートを 200 で配信 → 5xx を出さない）
    if (!headers_sent()) {
        http_response_code(200);
        header('Content-Type: text/html; charset=UTF-8');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        $tpl = @file_get_contents(__DIR__ . '/' . $template);
        if ($tpl !== false) {
            echo $tpl;
        } else {
            // テンプレートすら読めない深刻な状況 → 503 + Retry-After で再クロールを促す
            // （500 と違い Google は URL を保持して再試行する）
            http_response_code(503);
            header('Retry-After: 120');
        }
    }
});

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

// SEO bottom section（解説/FAQ/人気エリア/ホテルタイプ）の表示制御:
//   - 真のトップページ（パラメータ全く無し）: 表示する
//   - 店舗ページ（shop= あり）: 非表示（重複防止）
//   - サブページ（pref/area/city/hotel あり）: 非表示（重複防止）
$isPureTopPage = !$pref && !$hotel_id && !$shop;

// 真のトップページ（pref/hotel/shop 全部なし）は $MODE_SEO 定義後の
// 「全国トップ: 47都道府県SSRリンク注入」ブランチで処理する（早期 exit しない）
// 店舗ページ ($shop あり) も早期 exit せず、下の elseif ($shop) ブランチで SEO を生成する

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

// --- 無効URLの404化（クロールトラップ / 薄い自動生成ページ量産の防止）---
// 背景: /deli/index.html・/deli/wp-login.php・/deli/foobar 等の任意文字列が
// 「{文字列}のデリヘルを呼べるホテル検索」という 200＋自己canonical のゴミページを
// 無限生成していた（Googleがindex.html等を試行→薄いページ大量インデックス→
// サイト全体の品質評価を低下させ、競合ヘッド語で抑制される原因）。
// 第1セグメント($pref)が実在都道府県でない、または市区町村に該当ホテルが無いURLは 404 に。
if ($pref || $city) {
    $_invalidUrl = false;
    if ($pref) {
        $_adv = loadAreaData();
        if (empty($_adv['pref'][$pref])) {
            $_invalidUrl = true;                       // 例: index.html, wp-login.php, 乱文字列
        } elseif ($city) {
            $_cs = cityHotelStats($pref, $city);
            if ((int)($_cs['total'] ?? 0) === 0) $_invalidUrl = true; // 実在しない市区町村
        }
    } else {
        // pref 無しで city だけ来るのは不正経路
        $_invalidUrl = true;
    }
    if ($_invalidUrl) {
        http_response_code(404);
        header('Content-Type: text/html; charset=UTF-8');
        $_e4 = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        echo '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow">'
           . '<title>ページが見つかりません | YobuHo</title></head>'
           . '<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:64px 20px;color:#3a2a1f;">'
           . '<h1 style="font-size:48px;margin:0 0 8px;">404</h1>'
           . '<p style="margin:0 0 20px;">お探しのページは見つかりませんでした。</p>'
           . '<p><a href="https://yobuho.com/' . $_e4($path) . '/" style="color:#9b2d35;font-weight:600;">' . $_e4($m['label']) . '全国ページへ戻る</a></p>'
           . '</body></html>';
        exit;
    }
}

// --- 全国トップ: 47都道府県SSRリンクを <main> 内に注入して配信 ---
// title/meta/H1 はテンプレート（Astro SSG）のまま変更しない。
// 内部リンク（クロール経路 + リンクジュース分配）だけを追加する。
// SPA遷移時は area-navigation.js updateUrl() が .seo-static-content を除去する（既存挙動）。
if ($isPureTopPage) {
    $html = file_get_contents(__DIR__ . '/' . $template);
    if ($html === false) {
        http_response_code(500);
        exit;
    }

    $PREFS_ALL = [
        '北海道',
        '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
        '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
        '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
        '岐阜県', '静岡県', '愛知県', '三重県',
        '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
        '鳥取県', '島根県', '岡山県', '広島県', '山口県',
        '徳島県', '香川県', '愛媛県', '高知県',
        '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県',
        '沖縄県',
    ];
    $topAccentMap = [
        'men' => '#9b2d35', 'women' => '#b5627a',
        'men_same' => '#2a5a8f', 'women_same' => '#8a5a9e',
        'este' => '#2aa8b8',
    ];
    $topAccent = $topAccentMap[$mode] ?? '#9b2d35';
    $topEsc = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };
    $areaData = loadAreaData();
    $prefCounts = $areaData['prefCounts'] ?? [];

    $sec  = '<style>.seo-pref-links .seo-area-card:hover{background:#fdf6f0!important;border-color:' . $topAccent . '!important;}@media(max-width:640px){.seo-pref-links{padding:24px 12px!important;}}</style>';
    $sec .= '<section class="seo-static-content seo-pref-links" style="background:#faf6f0; padding:32px 16px; margin-top:24px; border-top:1px solid #e8d8c8; font-size:14px; line-height:1.85; color:#3a2a1f;">';
    $sec .= '<div style="max-width:900px; margin:0 auto;">';
    $sec .= '<h2 style="font-size:18px; margin:0 0 14px; color:' . $topAccent . '; border-left:4px solid ' . $topAccent . '; padding-left:10px;">都道府県から' . $topEsc($m['label'] . $m['verb']) . 'ホテルを探す</h2>';
    $sec .= '<p style="margin:0 0 16px;">全国43,000件以上のホテルから、' . $topEsc($m['label'] . $m['verb']) . 'ホテルを都道府県別に検索できます。各都道府県ページでは市区町村・エリア・口コミ実績からさらに絞り込めます。</p>';
    $sec .= '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px;">';
    foreach ($PREFS_ALL as $p47) {
        $cnt = (int)($prefCounts[$p47] ?? 0);
        $countText = $cnt > 0 ? '<span style="color:#8a7a6a; font-size:12px; margin-left:4px;">（' . number_format($cnt) . '件）</span>' : '';
        $url = 'https://yobuho.com/' . $path . '/' . rawurlencode($p47);
        $sec .= '<a href="' . $topEsc($url) . '" class="seo-area-card" style="display:block; padding:10px 14px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $topAccent . '; text-decoration:none; font-weight:500; font-size:14px; line-height:1.5; transition:background 0.15s, border-color 0.15s;">' . $topEsc($p47) . $countText . '</a>';
    }
    $sec .= '</div></div></section>';

    $html = str_replace('</main>', $sec . '</main>', $html);

    header('Content-Type: text/html; charset=UTF-8');
    echo $html;
    exit;
}

// --- 主要15都道府県の手書き description（プレースホルダー: {label}{verb}） ---
// 機械生成パターンの重複を避け、地域固有のランドマーク・繁華街名で SEO 強化.
$MAJOR_PREF_DESC = [
    '東京都'   => '東京都（新宿・渋谷・池袋・銀座・上野など23区主要エリア）で{label}{verb}ホテルを口コミから検索。ビジネスホテル・シティホテル・ラブホテルの利用者投稿と店舗公式情報をダブルチェックで確認できます。',
    '神奈川県' => '神奈川県（横浜みなとみらい・関内・新横浜・川崎・湘南など）で{label}{verb}ホテルを口コミから検索。繁華街のビジネスホテルから観光地のシティホテルまで、利用者の実体験で確認できます。',
    '埼玉県'   => '埼玉県（大宮・川口・川越・所沢・浦和など）で{label}{verb}ホテルを口コミから検索。さいたま新都心や首都圏ベッドタウンのビジネスホテル・ラブホテル情報を実体験の口コミで確認できます。',
    '千葉県'   => '千葉県（船橋・千葉・柏・松戸・舞浜など）で{label}{verb}ホテルを口コミから検索。首都圏東部のビジネスホテル・舞浜エリアのリゾートホテル・ラブホテル情報を利用者投稿で確認できます。',
    '大阪府'   => '大阪府（梅田・難波・心斎橋・天王寺・新大阪など）で{label}{verb}ホテルを口コミから検索。キタ・ミナミ繁華街のビジネスホテル・シティホテル・ラブホテル情報を、利用者と店舗のダブル情報で掲載しています。',
    '愛知県'   => '愛知県（名古屋・栄・伏見・金山・名駅など）で{label}{verb}ホテルを口コミから検索。中部最大のビジネス街周辺のホテル情報を、実際に利用したユーザーの口コミで確認できます。',
    '福岡県'   => '福岡県（博多・天神・中洲・小倉など）で{label}{verb}ホテルを口コミから検索。九州最大の繁華街のビジネスホテル・シティホテル・ラブホテル情報を、実際の利用者投稿と店舗公式情報で確認できます。',
    '北海道'   => '北海道（札幌・すすきの・函館・旭川・小樽など）で{label}{verb}ホテルを口コミから検索。すすきの繁華街のビジネスホテル・シティホテル・ラブホテルからリゾートホテルまで、利用者の実体験で確認できます。',
    '宮城県'   => '宮城県（仙台・国分町・青葉区など）で{label}{verb}ホテルを口コミから検索。東北最大の繁華街のビジネスホテル・シティホテル・ラブホテル情報を、実際の利用者投稿で確認できます。',
    '兵庫県'   => '兵庫県（神戸三宮・元町・尼崎・西宮・姫路など）で{label}{verb}ホテルを口コミから検索。神戸ハーバーランド周辺のシティホテル・三宮駅周辺のビジネスホテル・ラブホテル情報を、利用者の実体験で確認できます。',
    '京都府'   => '京都府（京都市内・四条・河原町・祇園・烏丸など）で{label}{verb}ホテルを口コミから検索。観光地のシティホテルから繁華街のビジネスホテル・ラブホテルまで、利用者投稿と店舗公式情報で確認できます。',
    '広島県'   => '広島県（広島市・福山・呉など）で{label}{verb}ホテルを口コミから検索。広島駅周辺・流川繁華街のビジネスホテル・シティホテル・ラブホテル情報を、実際の利用者投稿で確認できます。',
    '新潟県'   => '新潟県（新潟市古町・万代・長岡など）で{label}{verb}ホテルを口コミから検索。新潟駅周辺のビジネスホテル・古町繁華街のラブホテル情報を、利用者の実体験で確認できます。',
    '静岡県'   => '静岡県（静岡市・浜松・沼津・三島など）で{label}{verb}ホテルを口コミから検索。静岡駅・浜松駅周辺のビジネスホテル・ラブホテル情報を、実際の利用者投稿で確認できます。',
    '沖縄県'   => '沖縄県（那覇市国際通り・松山・宜野湾など）で{label}{verb}ホテルを口コミから検索。那覇繁華街のビジネスホテル・シティホテル・ラブホテルから本島のリゾートホテルまで、利用者の実体験で確認できます。',
];

// --- 主要5都市の手書き description（pref|city キー、プレースホルダー: {label}{verb}） ---
$MAJOR_CITY_DESC = [
    '東京都|新宿区'         => '新宿区（歌舞伎町・西新宿・新宿三丁目・大久保エリア）で{label}{verb}ホテルを口コミから検索。ビジネスホテル・シティホテル・ラブホテル情報を、利用者投稿と店舗公式情報で確認できます。',
    '東京都|渋谷区'         => '渋谷区（センター街・道玄坂・恵比寿・代官山エリア）で{label}{verb}ホテルを口コミから検索。シティホテル・ラブホテル情報を、利用者の実体験で確認できます。',
    '大阪府|大阪市北区'     => '大阪市北区（梅田・茶屋町・東梅田・新大阪エリア）で{label}{verb}ホテルを口コミから検索。ビジネスホテル・シティホテル・ラブホテル情報を、利用者投稿と店舗公式情報で確認できます。',
    '愛知県|名古屋市中区'   => '名古屋市中区（栄・伏見・大須・矢場町エリア）で{label}{verb}ホテルを口コミから検索。ビジネスホテル・シティホテル・ラブホテル情報を、実際の利用者投稿で確認できます。',
    '福岡県|福岡市博多区'   => '福岡市博多区（博多駅周辺・中洲・呉服町エリア）で{label}{verb}ホテルを口コミから検索。ビジネスホテル・シティホテル・ラブホテル情報を、利用者投稿と店舗公式情報で確認できます。',
];

// テンプレート文字列の {label}{verb} を実値で展開するヘルパー
$expandDesc = function($tpl) use ($m) {
    return strtr($tpl, ['{label}' => $m['label'], '{verb}' => $m['verb']]);
};

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
    } catch (\Throwable $e) {
        // DB接続失敗 / Error 系（TypeError等）も含めて握りつぶし、デフォルトSEOで出力（5xx回避）
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
        // ホテルが見つからない場合: SEO bottom section を除去してから配信（重複コンテンツ防止）
        $html = file_get_contents(__DIR__ . '/' . $template);
        if ($html !== false) {
            $html = preg_replace('/<section[^>]*data-seo-toponly="1"[^>]*>.*?<\/section>/s', '', $html);
            echo $html;
        }
        exit;
    }
} elseif ($shop) {
    // 店舗専用URL: /jofu/shop/slug/ 等
    $shopData = null;
    try {
        require_once __DIR__ . '/api/db.php';
        $pdo = DB::conn();
        $stmt = $pdo->prepare('SELECT shop_name, gender_mode, area, prefecture, slug, status FROM shops WHERE slug = ? AND status = "active" LIMIT 1');
        $stmt->execute([$shop]);
        $shopData = $stmt->fetch();
    } catch (\Throwable $e) {
        // DB接続失敗 / Error 系も含めて握りつぶし、デフォルトSEOで出力（5xx回避）
    }

    if ($shopData) {
        $sn = $shopData['shop_name'];
        $sa = $shopData['area'] ?? '';
        $sp = $shopData['prefecture'] ?? '';
        $sLoc = $sp . ($sa ? ' ' . $sa : '');
        $seo_title = $sLoc
            ? "{$sn}（{$sLoc}拠点）- {$m['label']}派遣店舗 | {$m['suffix']}"
            : "{$sn} - {$m['label']}派遣店舗 | {$m['suffix']}";
        $seo_desc  = $sLoc
            ? "{$sn}は{$sLoc}を拠点に{$m['label']}を派遣する店舗です。複数エリアに対応、利用者の口コミと案内実績、対応可能なホテル情報を確認できます。"
            : "{$sn}は{$m['label']}を派遣する店舗です。利用者の口コミと案内実績、対応可能なホテル情報を確認できます。";
        $seo_canonical = "https://yobuho.com/{$path}/shop/" . rawurlencode($shop) . '/';
        $seo_h1 = "{$sn} - {$m['label']}派遣店舗";
        $breadcrumbs[] = ['name' => $sn, 'url' => $seo_canonical];
    } else {
        // 非active/未登録 slug: canonical は shop URL のまま、SEO抑制
        $seo_canonical = "https://yobuho.com/{$path}/shop/" . rawurlencode($shop) . '/';
        $seo_title = "{$m['label']}{$m['verb']}ホテル検索 | {$m['suffix']}";
        $seo_desc  = "{$m['label']}をホテルに{$m['verb']}か地域から検索。{$m['desc_detail']}";
    }
} elseif ($city && $pref) {
    // 市区町村ページ
    $location = $area ? "{$city}（{$pref} {$area}）" : "{$city}（{$pref}）";
    // データ駆動SEO: 当該市区町村の件数・タイプ内訳・主要駅を算出（title/desc/本文/FAQで共用）
    $cityStats = cityHotelStats($pref, $city);
    $cityTypeLabels = [
        'business' => 'ビジネスホテル', 'city' => 'シティホテル', 'resort' => 'リゾートホテル',
        'ryokan' => '旅館', 'love_hotel' => 'ラブホテル', 'rental_room' => 'レンタルルーム',
    ];
    // title: 件数を入れて固有性とクリック誘因を強化（0件なら件数省略）
    $cityCountLabel = $cityStats['total'] > 0 ? number_format($cityStats['total']) . '件' : '';
    $seo_title = $cityCountLabel
        ? "{$city}の{$m['label']}{$m['verb']}ホテル{$cityCountLabel}｜{$pref} | {$m['suffix']}"
        : "{$city}の{$m['label']}{$m['verb']}ホテル｜{$pref} | {$m['suffix']}";
    // 主要5都市は手書き description を使用、それ以外はデータ駆動で機械生成
    $cityKey = $pref . '|' . $city;
    if (isset($MAJOR_CITY_DESC[$cityKey])) {
        $seo_desc = $expandDesc($MAJOR_CITY_DESC[$cityKey]);
    } elseif ($cityStats['total'] > 0) {
        // 件数＋タイプ内訳（上位2種）＋主要駅 を盛り込み、各市区町村ページを固有化
        $descTypeParts = [];
        foreach (array_slice($cityStats['types'], 0, 2, true) as $t => $c) {
            if (isset($cityTypeLabels[$t])) $descTypeParts[] = $cityTypeLabels[$t] . number_format($c) . '件';
        }
        $descTypes = $descTypeParts ? '（' . implode('・', $descTypeParts) . 'など）' : '';
        $descStation = !empty($cityStats['stations'][0]) ? $cityStats['stations'][0] . '周辺ほか、' : '';
        $seo_desc = "{$pref}{$city}で{$m['label']}{$m['verb']}ホテルを口コミで検索。掲載" . number_format($cityStats['total']) . "件{$descTypes}。{$descStation}入室方法・部屋タイプ・呼べた実績を確認できます。";
    } else {
        $seo_desc = "{$pref}{$city}で{$m['label']}{$m['verb']}ホテルを検索。{$m['desc_detail']}";
    }
    // canonical は常に 2セグ /pref/city に統一（3/4セグURLからの重複信号を解消）
    $seo_canonical = "https://yobuho.com/{$path}/" . rawurlencode($pref) . '/' . rawurlencode($city);
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
    // 主要15都道府県は手書き description を使用、それ以外は機械生成
    if (isset($MAJOR_PREF_DESC[$pref])) {
        $seo_desc = $expandDesc($MAJOR_PREF_DESC[$pref]);
    } else {
        $seo_desc = "{$pref}で{$m['label']}{$m['verb']}ホテルを地域から検索。{$m['desc_detail']}";
    }
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

// サブページ（pref/city/hotel あり）では SEO bottom section（解説/FAQ/人気エリア/ホテルタイプ）を除去.
// トップページ専用コンテンツのため、市区町村ページ等で重複コンテンツになるのを防ぐ.
$html = preg_replace('/<section[^>]*data-seo-toponly="1"[^>]*>.*?<\/section>/s', '', $html);

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

// <h1> 差し替え（visible hero h1）
// Astro レイアウトは <h1 class="genre-hero-title" id="genre-hero-title">{hero.h1}</h1> を出力する.
// サブページ毎にページ固有のH1にすることで Google の重複判定を回避.
$html = preg_replace(
    '/<h1 class="genre-hero-title" id="genre-hero-title">[^<]*<\/h1>/',
    '<h1 class="genre-hero-title" id="genre-hero-title">' . $esc($seo_h1) . '</h1>',
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

// 市区町村ページのデータ駆動SEO用: 当該市区町村の件数・タイプ内訳・主要駅・上位ホテルを
// hotel-data/*.json から算出（追加DBクエリ不要）。全市区町村ページを固有コンテンツ化するための土台。
function cityHotelStats($pref, $city) {
    static $cache = [];
    $key = $pref . '|' . $city;
    if (isset($cache[$key])) return $cache[$key];
    $hotels = loadPrefHotels($pref);
    $typeCount = [];      // hotel_type => 件数
    $stationCount = [];   // 最寄駅 => 件数
    $list = [];
    $total = 0;
    if (is_array($hotels)) {
        foreach ($hotels as $h) {
            if (($h['city'] ?? '') !== $city) continue;
            $total++;
            $t = $h['hotel_type'] ?? '';
            if ($t) $typeCount[$t] = ($typeCount[$t] ?? 0) + 1;
            $st = trim((string)($h['nearest_station'] ?? ''));
            if ($st !== '') $stationCount[$st] = ($stationCount[$st] ?? 0) + 1;
            $list[] = $h;
        }
    }
    arsort($typeCount);
    arsort($stationCount);
    // 上位ホテル: ラブホ以外を優先、review_average降順
    usort($list, function ($a, $b) {
        $al = in_array($a['hotel_type'] ?? '', ['love_hotel', 'rental_room'], true);
        $bl = in_array($b['hotel_type'] ?? '', ['love_hotel', 'rental_room'], true);
        if ($al !== $bl) return $al ? 1 : -1;
        return ($b['review_average'] ?? 0) <=> ($a['review_average'] ?? 0);
    });
    $stats = [
        'total'    => $total,
        'types'    => $typeCount,                                  // [type=>count] desc
        'stations' => array_slice(array_keys($stationCount), 0, 5),
        'top'      => array_slice($list, 0, 30),
    ];
    $cache[$key] = $stats;
    return $stats;
}

function buildSeoLink($path, $pref, $area = '', $detail = '', $city = '', $label = '', $count = null, $accentColor = '#9b2d35') {
    $parts = [rawurlencode($pref)];
    if ($area !== '') $parts[] = rawurlencode($area);
    if ($detail !== '') $parts[] = rawurlencode($detail);
    if ($city !== '') $parts[] = rawurlencode($city);
    $url = 'https://yobuho.com/' . $path . '/' . implode('/', $parts);
    $esc = fn($s) => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $countText = $count !== null ? '<span style="color:#8a7a6a; font-size:12px; margin-left:4px;">（' . number_format($count) . '件）</span>' : '';
    return '<a href="' . $esc($url) . '" class="seo-area-card" style="display:block; padding:10px 14px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $accentColor . '; text-decoration:none; font-weight:500; font-size:14px; line-height:1.5; transition:background 0.15s, border-color 0.15s;">' . $esc($label) . $countText . '</a>';
}

$seo_static = '';
if (!$hotel_id && $pref) {
    $esc_fn = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };
    $areaData = loadAreaData();
    $label = $m['label'];
    $verb = $m['verb'];

    // モード別アクセントカラー（SeoBottomSectionと統一）
    $accentMap = [
        'men' => '#9b2d35',
        'women' => '#b5627a',
        'men_same' => '#2a5a8f',
        'women_same' => '#8a5a9e',
        'este' => '#2aa8b8',
    ];
    $accent = $accentMap[$mode] ?? '#9b2d35';
    // グリッド共通スタイル（カード型2〜4列、レスポンシブ）
    $gridStyle = 'list-style:none; padding:0; margin:0 0 24px; display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:8px;';
    // 見出し共通スタイル（左側にアクセントボーダー）
    $h3Style = 'font-size:16px; margin:24px 0 12px; color:' . $accent . '; border-left:4px solid ' . $accent . '; padding-left:10px; font-weight:600;';

    $seo_static .= '<style>.seo-static-content .seo-area-card:hover{background:#fdf6f0!important;border-color:' . $accent . '!important;}@media(max-width:640px){.seo-static-content{padding:24px 12px!important;}}</style>';
    $seo_static .= '<section class="seo-static-content" style="background:#faf6f0; padding:32px 16px; margin-top:24px; border-top:1px solid #e8d8c8; font-size:14px; line-height:1.85; color:#3a2a1f;">';
    $seo_static .= '<div style="max-width:900px; margin:0 auto;">';
    $seo_static .= '<h2 style="font-size:18px; margin:0 0 14px; color:' . $accent . '; border-left:4px solid ' . $accent . '; padding-left:10px;">' . $esc_fn($seo_h1) . '</h2>';

    if ($city) {
        // --- 市区町村ページ: 上位ホテル10件 + 近隣市区町村リンク ---
        $totalInArea = 0;
        // areaKey 解決: URL に area あり → 即用 / なし → city から所属エリアを逆引き
        // canonical URL は /pref/city（2セグ）なので URL に area が無いケースが大半.
        // L-S3 近隣エリアセクションのために、city から area を逆引きする.
        $areaKey = $area ? $pref . "\t" . $area : '';
        if (!$areaKey && $city && isset($areaData['pref'][$pref]['areas'])) {
            foreach ($areaData['pref'][$pref]['areas'] as $aRow) {
                $aName = $aRow[0] ?? '';
                if (!$aName) continue;
                $candidateKey = $pref . "\t" . $aName;
                if (!isset($areaData['area'][$candidateKey]['ct'])) continue;
                foreach ($areaData['area'][$candidateKey]['ct'] as $cRow) {
                    if (($cRow[0] ?? '') === $city) {
                        $areaKey = $candidateKey;
                        $area = $aName; // 近隣エリア見出し用に保持
                        break 2;
                    }
                }
            }
        }
        if ($areaKey && isset($areaData['area'][$areaKey]['ct'])) {
            foreach ($areaData['area'][$areaKey]['ct'] as $row) {
                if ($row[0] === $city) { $totalInArea = ($row[1] ?? 0) + ($row[2] ?? 0); break; }
            }
        }
        if ($totalInArea === 0) {
            // エリアなし直接 or エリア情報なし: noArea or prefCount から推定
            $totalInArea = 0;
        }

        // データ駆動の固有プロローグ（件数・タイプ内訳・主要駅）— 全市区町村ページを固有コンテンツ化
        $cityStats = cityHotelStats($pref, $city);
        $cityTypeLabelsP = [
            'business' => 'ビジネスホテル', 'city' => 'シティホテル', 'resort' => 'リゾートホテル',
            'ryokan' => '旅館', 'love_hotel' => 'ラブホテル', 'rental_room' => 'レンタルルーム',
        ];
        if ($cityStats['total'] > 0) {
            $typeParts = [];
            foreach (array_slice($cityStats['types'], 0, 4, true) as $t => $c) {
                if (isset($cityTypeLabelsP[$t])) $typeParts[] = $cityTypeLabelsP[$t] . number_format($c) . '件';
            }
            $seo_static .= '<p>' . $esc_fn($pref . $city) . 'には' . $esc_fn($label . $verb) . 'か口コミで確認できるホテルを<strong>' . number_format($cityStats['total']) . '件</strong>掲載しています。';
            if ($typeParts) $seo_static .= '内訳は' . $esc_fn(implode('・', $typeParts)) . '。';
            $stations3 = array_slice($cityStats['stations'], 0, 3);
            if ($stations3) $seo_static .= $esc_fn(implode('・', $stations3)) . '周辺に多く、';
            $seo_static .= '直通エレベーター・カードキー・フロント相談など実際の入室方法と、利用者の呼べた／呼べなかった実績を各ホテルページで確認できます。</p>';
        } else {
            $seo_static .= '<p>' . $esc_fn($pref . $city) . 'で' . $esc_fn($label . $verb) . 'ホテルを口コミから検索。';
            $seo_static .= '直通・カードキー・フロント相談など実際の入室実績から判断できます。</p>';
        }

        // 上位ホテル（cityHotelStats で算出済み: ラブホ以外優先・review降順・最大30件）を再利用
        $topHotels = $cityStats['top'];

        if (count($topHotels) > 0) {
            $seo_static .= '<h3 style="' . $h3Style . '">主要ホテル</h3>';
            $seo_static .= '<div style="' . $gridStyle . '">';
            foreach ($topHotels as $h) {
                $hUrl = 'https://yobuho.com/' . $path . '/hotel/' . (int)$h['id'];
                $addr = !empty($h['address']) ? '<span style="display:block; color:#8a7a6a; font-size:12px; font-weight:400; margin-top:4px;">' . $esc_fn($h['address']) . '</span>' : '';
                $seo_static .= '<a href="' . $esc_fn($hUrl) . '" class="seo-area-card" style="display:block; padding:10px 14px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $accent . '; text-decoration:none; font-weight:500; font-size:14px; line-height:1.5;">' . $esc_fn($h['name']) . $addr . '</a>';
            }
            $seo_static .= '</div>';

            // #hotel-list にサーバーサイドで初期ホテルカードを注入
            // (JS実行で上書きされるが、クローラーは初期HTMLを主要コンテンツとして見る)
            $initial_hotel_cards = '';
            foreach ($topHotels as $h) {
                $hUrl = '/' . $path . '/hotel/' . (int)$h['id'];
                $hName = $esc_fn($h['name']);
                $hAddr = !empty($h['address']) ? $esc_fn($h['address']) : '';
                $hStation = !empty($h['nearest_station']) ? $esc_fn($h['nearest_station']) : '';
                $initial_hotel_cards .= '<article class="hotel-card hotel-card-lux" style="background:#fff;border:1px solid #e5ddd0;border-radius:12px;padding:16px;margin-bottom:12px;">';
                $initial_hotel_cards .= '<a href="' . $esc_fn($hUrl) . '" style="text-decoration:none;color:inherit;display:block;">';
                $initial_hotel_cards .= '<h3 class="hotel-card-name" style="margin:0 0 8px;font-size:16px;font-weight:600;color:#1a1410;">' . $hName . '</h3>';
                if ($hAddr) {
                    $initial_hotel_cards .= '<p class="hotel-card-address" style="margin:0 0 6px;font-size:13px;color:#5a4a3a;">📍 ' . $hAddr . '</p>';
                }
                if ($hStation) {
                    $initial_hotel_cards .= '<p class="hotel-card-station" style="margin:0;font-size:12px;color:#8a7a6a;">🚉 ' . $hStation . '</p>';
                }
                $initial_hotel_cards .= '</a></article>';
            }
        }

        // --- 近隣エリア（同じエリア内の他の市区町村） ---
        // メインUIのエリアナビは折り畳み式UIのため、SEO観点では明示HTMLリンクの方が信頼性が高い.
        // area-data.json の area[$pref\t$area].ct から自エリア内の他市区町村を取得し、最大7件まで表示.
        if ($areaKey && isset($areaData['area'][$areaKey]['ct']) && is_array($areaData['area'][$areaKey]['ct'])) {
            $neighborCities = [];
            foreach ($areaData['area'][$areaKey]['ct'] as $row) {
                $cityName = $row[0] ?? '';
                if (!$cityName || $cityName === $city) continue;
                $cityCount = ($row[1] ?? 0) + ($row[2] ?? 0);
                $neighborCities[] = [$cityName, $cityCount];
            }
            // 件数の多い順に並べて上位7件
            usort($neighborCities, fn($a, $b) => $b[1] <=> $a[1]);
            $neighborCities = array_slice($neighborCities, 0, 7);

            if (count($neighborCities) > 0) {
                $seo_static .= '<h3 style="' . $h3Style . '">近隣エリア（' . $esc_fn($area) . '）</h3>';
                $seo_static .= '<div style="' . $gridStyle . '">';
                foreach ($neighborCities as [$nCity, $nCount]) {
                    $nUrl = 'https://yobuho.com/' . $path . '/' . rawurlencode($pref) . '/' . rawurlencode($nCity);
                    $countText = $nCount > 0 ? '<span style="color:#8a7a6a; font-size:12px; margin-left:4px;">（' . number_format($nCount) . '件）</span>' : '';
                    $seo_static .= '<a href="' . $esc_fn($nUrl) . '" class="seo-area-card" style="display:block; padding:10px 14px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $accent . '; text-decoration:none; font-weight:500; font-size:14px; line-height:1.5;">' . $esc_fn($nCity) . $countText . '</a>';
                }
                $seo_static .= '</div>';
            }
        }

        // --- データ駆動FAQ + FAQPage JSON-LD（固有性 & SERP占有面積/CTR向上）---
        if ($cityStats['total'] > 0) {
            $faqTopType = '';
            foreach ($cityStats['types'] as $t => $c) {
                if (isset($cityTypeLabelsP[$t])) { $faqTopType = $cityTypeLabelsP[$t]; break; }
            }
            $faqBrief = [];
            foreach (array_slice($cityStats['types'], 0, 2, true) as $t => $c) {
                if (isset($cityTypeLabelsP[$t])) $faqBrief[] = $cityTypeLabelsP[$t] . number_format($c) . '件';
            }
            $faqBriefStr = $faqBrief ? implode('・', $faqBrief) . 'など' : '';
            $lv = $label . $verb;
            $q1 = $pref . $city . 'で' . $lv . 'ホテルはありますか？';
            $a1 = $pref . $city . 'では' . $lv . 'か口コミで確認できるホテルを' . number_format($cityStats['total']) . '件掲載しています。'
                . ($faqBriefStr ? $faqBriefStr . '。' : '')
                . '利用者の口コミと掲載店舗の案内実績から、実際に' . $lv . 'か確認できます。';
            $q2 = $city . 'でおすすめのホテルタイプは？';
            $a2 = $city . 'では' . ($faqTopType ?: 'ホテル') . 'の掲載が最も多くなっています。ホテルごとに' . $lv
                . 'かは異なるため、各ホテルページで利用者の口コミ（呼べた／呼べなかった）と入室方法（直通・カードキー・フロント相談）を確認するのが確実です。';

            $seo_static .= '<h3 style="' . $h3Style . '">よくあるご質問</h3>';
            $seo_static .= '<div style="margin-bottom:8px;">';
            $seo_static .= '<p style="font-weight:600;margin:0 0 4px;color:' . $accent . ';">Q. ' . $esc_fn($q1) . '</p>';
            $seo_static .= '<p style="margin:0 0 14px;">' . $esc_fn($a1) . '</p>';
            $seo_static .= '<p style="font-weight:600;margin:0 0 4px;color:' . $accent . ';">Q. ' . $esc_fn($q2) . '</p>';
            $seo_static .= '<p style="margin:0;">' . $esc_fn($a2) . '</p>';
            $seo_static .= '</div>';

            $faq_jsonld = json_encode([
                '@context' => 'https://schema.org',
                '@type' => 'FAQPage',
                'mainEntity' => [
                    ['@type' => 'Question', 'name' => $q1, 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $a1]],
                    ['@type' => 'Question', 'name' => $q2, 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $a2]],
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $seo_static .= '<script type="application/ld+json">' . $faq_jsonld . '</script>';
        }
    } elseif ($detail && $area) {
        // --- 詳細エリアページ: 説明文のみ. 市区町村リンクはメインUIと重複のため削除済み. ---
        $seo_static .= '<p style="margin:0 0 16px;">' . $esc_fn($pref . ' ' . $area . ' ' . $detail) . 'エリアで' . $esc_fn($label . $verb) . 'ホテルを市区町村別に検索。</p>';
    } elseif ($area) {
        // --- エリアページ: 説明文のみ. 詳細エリア/市区町村リンクはメインUI(エリアナビ)と重複のため削除済み. ---
        $seo_static .= '<p style="margin:0 0 16px;">' . $esc_fn($pref . ' ' . $area) . 'エリアで' . $esc_fn($label . $verb) . 'ホテルを詳細エリア・市区町村別に検索。</p>';
    } elseif ($pref) {
        // --- 都道府県ページ: 説明文のみ. エリア/市区町村リンクはメインUI(エリアナビ)と重複のため削除済み. ---
        $prefInfo = $areaData['pref'][$pref] ?? [];
        $prefCount = $areaData['prefCounts'][$pref] ?? 0;

        $seo_static .= '<p style="margin:0 0 16px;">' . $esc_fn($pref) . 'で' . $esc_fn($label . $verb) . 'ホテルを地域から検索できます。';
        if ($prefCount > 0) {
            $seo_static .= '掲載ホテル数: <strong>' . number_format($prefCount) . '件</strong>（ビジネス/シティ/ラブホ含む）。';
        }
        $seo_static .= '利用者の口コミと掲載店舗の案内実績情報から、実際に' . $esc_fn($label . $verb) . 'か判断できます。</p>';

        // 店舗登録CTAブロック（{pref}の店舗様向け、無料掲載訴求）
        $seo_static .= '<div style="background:#fff; border:1px solid ' . $accent . '; border-radius:8px; padding:16px 18px; margin:16px 0 8px;">';
        $seo_static .= '<h3 style="font-size:15px; margin:0 0 8px; color:' . $accent . '; font-weight:600;">' . $esc_fn($pref) . 'の' . $esc_fn($label) . '店舗様へ — 無料で掲載しませんか？</h3>';
        $seo_static .= '<p style="margin:0 0 12px; font-size:13px; color:#5a4a3a; line-height:1.7;">YobuHoは届出確認済み店舗の<strong>無料掲載</strong>を受付中。成果報酬なし・初期費用ゼロ・店舗専用URL発行で、43,000件以上のホテル情報に対応した集客ページを作れます。</p>';
        $seo_static .= '<a href="https://yobuho.com/shop-register/" style="display:inline-block; padding:10px 18px; background:' . $accent . '; border-radius:6px; color:#fff; text-decoration:none; font-size:13px; font-weight:600;">店舗登録（無料）→</a>';
        $seo_static .= '<a href="https://yobuho.com/about/" style="display:inline-block; padding:10px 16px; margin-left:8px; background:#fff; border:1px solid ' . $accent . '; border-radius:6px; color:' . $accent . '; text-decoration:none; font-size:13px; font-weight:600;">審査プロセスを見る</a>';
        $seo_static .= '</div>';
    }

    // 共通末尾: 全国ページへの戻りリンク
    $seo_static .= '<p style="margin-top:24px;"><a href="https://yobuho.com/' . $esc_fn($path) . '/" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $accent . '; text-decoration:none; font-size:13px; font-weight:500;">← ' . $esc_fn($label) . '全国ページへ</a></p>';
    $seo_static .= '</div>';
    $seo_static .= '</section>';
}

// --- ホテル詳細ページ: <main> 内に SSR コンテンツを注入してソフト404を回避 ---
if ($hotel_id && isset($hotel) && $hotel) {
    $h_esc = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };
    $h_accentMap = [
        'men' => '#9b2d35', 'women' => '#b5627a',
        'men_same' => '#2a5a8f', 'women_same' => '#8a5a9e',
        'este' => '#2aa8b8',
    ];
    $h_accent = $h_accentMap[$mode] ?? '#9b2d35';
    $h_h3Style = 'font-size:16px; margin:24px 0 12px; color:' . $h_accent . '; border-left:4px solid ' . $h_accent . '; padding-left:10px; font-weight:600;';

    $h_typeLabels = [
        'business' => 'ビジネスホテル', 'city' => 'シティホテル',
        'love_hotel' => 'ラブホテル', 'rental_room' => 'レンタルルーム',
        'resort' => 'リゾートホテル', 'ryokan' => '旅館',
        'pension' => 'ペンション', 'minshuku' => '民宿',
    ];
    $h_typeLabel = $h_typeLabels[$hotel['hotel_type'] ?? ''] ?? 'ホテル';
    $h_postal = $hotel['postal_code'] ?? '';
    $h_tel = $hotel['tel'] ?? '';
    $h_station = $hotel['nearest_station'] ?? '';

    $seo_static .= '<style>.seo-static-content .seo-area-card:hover{background:#fdf6f0!important;border-color:' . $h_accent . '!important;}@media(max-width:640px){.seo-static-content{padding:24px 12px!important;}}</style>';
    $seo_static .= '<section class="seo-static-content" style="background:#faf6f0; padding:32px 16px; margin-top:24px; border-top:1px solid #e8d8c8; font-size:14px; line-height:1.85; color:#3a2a1f;">';
    $seo_static .= '<div style="max-width:900px; margin:0 auto;">';
    $seo_static .= '<h2 style="font-size:18px; margin:0 0 14px; color:' . $h_accent . '; border-left:4px solid ' . $h_accent . '; padding-left:10px;">' . $h_esc($hn) . ' - ' . $h_esc($m['label'] . $m['verb']) . '？口コミ・入室情報</h2>';

    // ホテル基本情報カード
    $seo_static .= '<div style="background:#fff; border:1px solid #e8d8c8; border-radius:8px; padding:16px; margin-bottom:16px;">';
    $seo_static .= '<p style="margin:0 0 8px; font-size:13px; color:#8a7a6a;">' . $h_esc($h_typeLabel) . '</p>';
    if ($ha) {
        $seo_static .= '<p style="margin:0 0 6px; font-size:13px; color:#3a2a1f;">📍 ';
        if ($h_postal) $seo_static .= '〒' . $h_esc($h_postal) . ' ';
        $seo_static .= $h_esc($ha) . '</p>';
    }
    if ($h_station) {
        $seo_static .= '<p style="margin:0 0 6px; font-size:13px; color:#3a2a1f;">🚉 ' . $h_esc($h_station) . '</p>';
    }
    if ($h_tel) {
        $seo_static .= '<p style="margin:0; font-size:13px; color:#3a2a1f;">📞 ' . $h_esc($h_tel) . '</p>';
    }
    $seo_static .= '</div>';

    // 説明テキスト
    $seo_static .= '<p style="margin:0 0 16px;">' . $h_esc($hn) . '（' . $h_esc($hp . $hc) . '）に' . $h_esc($m['label'] . $m['verb']) . 'か、利用者の口コミと掲載店舗の案内実績から確認できます。直通エレベーター、カードキー、フロント相談など実際の入室方法が分かります。部屋タイプ・時間帯・複数人利用情報も掲載しています。</p>';

    // 同じエリアのホテルへの導線
    $seo_static .= '<h3 style="' . $h_h3Style . '">同じエリアのホテルを探す</h3>';
    $seo_static .= '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">';
    if ($hc && $hp) {
        $seo_static .= '<a href="https://yobuho.com/' . $path . '/' . rawurlencode($hp) . '/' . rawurlencode($hc) . '" class="seo-area-card" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $h_accent . '; text-decoration:none; font-size:13px; font-weight:500;">' . $h_esc($hc) . 'の' . $h_esc($m['label']) . '可ホテル一覧</a>';
    }
    if ($hp) {
        $seo_static .= '<a href="https://yobuho.com/' . $path . '/' . rawurlencode($hp) . '" class="seo-area-card" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $h_accent . '; text-decoration:none; font-size:13px; font-weight:500;">' . $h_esc($hp) . '全体</a>';
    }
    $seo_static .= '</div>';

    // モード別ガイドへの導線（ロングテール送客）
    $h_guideMap = [
        'men'        => ['/guide/deli-hotel.html',  'デリヘルを呼べるホテルの見分け方ガイド'],
        'women'      => ['/guide/jofu-hotel.html',  '女性用風俗（女風）を呼べるホテルの選び方'],
        'men_same'   => ['/guide/lgbt-hotel.html',  'LGBTフレンドリーなホテルの探し方ガイド'],
        'women_same' => ['/guide/lgbt-hotel.html',  'LGBTフレンドリーなホテルの探し方ガイド'],
        'este'       => ['/guide/este-hotel.html',  'デリエステを呼べるホテルの選び方ガイド'],
    ];
    if (isset($h_guideMap[$mode])) {
        [$h_guideHref, $h_guideLabel] = $h_guideMap[$mode];
        $seo_static .= '<h3 style="' . $h_h3Style . '">もっと詳しく知る</h3>';
        $seo_static .= '<a href="' . $h_esc($h_guideHref) . '" class="seo-area-card" style="display:inline-block; padding:10px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $h_accent . '; text-decoration:none; font-size:13px; font-weight:500;">' . $h_esc($h_guideLabel) . ' →</a>';
    }

    // 全国ページへの戻りリンク
    $seo_static .= '<p style="margin-top:24px;"><a href="https://yobuho.com/' . $h_esc($path) . '/" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $h_accent . '; text-decoration:none; font-size:13px; font-weight:500;">← ' . $h_esc($m['label']) . '全国ページへ</a></p>';
    $seo_static .= '</div>';
    $seo_static .= '</section>';
}

// --- 店舗専用ページ: <main> 内に SSR コンテンツを注入 ---
if ($shop && isset($shopData) && $shopData) {
    $s_esc = function($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };
    $s_accentMap = [
        'men' => '#9b2d35', 'women' => '#b5627a',
        'men_same' => '#2a5a8f', 'women_same' => '#8a5a9e',
        'este' => '#2aa8b8',
    ];
    $s_accent = $s_accentMap[$mode] ?? '#9b2d35';
    $s_h3Style = 'font-size:16px; margin:24px 0 12px; color:' . $s_accent . '; border-left:4px solid ' . $s_accent . '; padding-left:10px; font-weight:600;';

    $s_sn = $shopData['shop_name'];
    $s_sa = $shopData['area'] ?? '';
    $s_sp = $shopData['prefecture'] ?? '';
    $s_loc = $s_sp . ($s_sa ? ' ' . $s_sa : '');

    $seo_static .= '<style>.seo-static-content .seo-area-card:hover{background:#fdf6f0!important;border-color:' . $s_accent . '!important;}@media(max-width:640px){.seo-static-content{padding:24px 12px!important;}}</style>';
    $seo_static .= '<section class="seo-static-content" style="background:#faf6f0; padding:32px 16px; margin-top:24px; border-top:1px solid #e8d8c8; font-size:14px; line-height:1.85; color:#3a2a1f;">';
    $seo_static .= '<div style="max-width:900px; margin:0 auto;">';
    $seo_static .= '<h2 style="font-size:18px; margin:0 0 14px; color:' . $s_accent . '; border-left:4px solid ' . $s_accent . '; padding-left:10px;">' . $s_esc($s_sn) . ' - ' . $s_esc($m['label']) . '派遣店舗</h2>';

    // 店舗情報カード
    $seo_static .= '<div style="background:#fff; border:1px solid #e8d8c8; border-radius:8px; padding:16px; margin-bottom:16px;">';
    $seo_static .= '<p style="margin:0 0 8px; font-size:13px; color:#8a7a6a;">' . $s_esc($m['label']) . '派遣</p>';
    if ($s_loc) {
        $seo_static .= '<p style="margin:0; font-size:13px; color:#3a2a1f;">📍 拠点: ' . $s_esc($s_loc) . '</p>';
    }
    $seo_static .= '</div>';

    // 説明テキスト（location あれば「{location}を拠点に」、無ければ location 省略）
    $seo_static .= '<p style="margin:0 0 16px;">' . $s_esc($s_sn) . 'は';
    if ($s_loc) {
        $seo_static .= $s_esc($s_loc) . 'を拠点に、';
    }
    $seo_static .= $s_esc($m['label']) . 'を派遣する店舗です。';
    if ($s_loc) {
        $seo_static .= '複数エリアに対応しており、案内可能なホテルは利用者の口コミと案内実績から確認できます。';
    } else {
        $seo_static .= '案内可能なホテルは利用者の口コミと案内実績から確認できます。';
    }
    $seo_static .= '直通エレベーター、カードキー、フロント相談など実際の入室方法もチェックできます。</p>';

    // 案内可能エリアへのリンク
    if ($s_sp) {
        $seo_static .= '<h3 style="' . $s_h3Style . '">案内可能エリア</h3>';
        $seo_static .= '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">';
        $seo_static .= '<a href="https://yobuho.com/' . $path . '/' . rawurlencode($s_sp) . '" class="seo-area-card" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $s_accent . '; text-decoration:none; font-size:13px; font-weight:500;">' . $s_esc($s_sp) . 'の' . $s_esc($m['label']) . '可ホテル一覧</a>';
        if ($s_sa) {
            $seo_static .= '<a href="https://yobuho.com/' . $path . '/' . rawurlencode($s_sp) . '/' . rawurlencode($s_sa) . '" class="seo-area-card" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $s_accent . '; text-decoration:none; font-size:13px; font-weight:500;">' . $s_esc($s_sa) . 'エリア</a>';
        }
        $seo_static .= '</div>';
    }

    // 全国ページへの戻りリンク
    $seo_static .= '<p style="margin-top:24px;"><a href="https://yobuho.com/' . $s_esc($path) . '/" style="display:inline-block; padding:8px 16px; background:#fff; border:1px solid #e8d8c8; border-radius:6px; color:' . $s_accent . '; text-decoration:none; font-size:13px; font-weight:500;">← ' . $s_esc($m['label']) . '全国ページへ</a></p>';
    $seo_static .= '</div>';
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

// #hotel-list にサーバーサイドで初期ホテルカードを注入
// JS実行でAPI 0件になっても renderHotelCards が data-initial=1 を尊重して残す
if (!empty($initial_hotel_cards)) {
    $html = str_replace(
        '<div id="hotel-list" class="hotel-list-container"></div>',
        '<div id="hotel-list" class="hotel-list-container" data-initial="1">' . $initial_hotel_cards . '</div>',
        $html
    );
}

// --- 出力 ---
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
echo $html;
