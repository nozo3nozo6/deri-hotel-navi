<?php
// ==========================================================================
// _orders-lib.php — 店舗運営（顧客/オーダー/売上）の共通基盤
//   雛形段階: テーブルは lazy CREATE（media_sync_results と同方式）。
//   仕様が固まったら sql/ に定義を昇格する。
// ==========================================================================
declare(strict_types=1);

require_once __DIR__ . '/_lib.php';

// ---- 営業日（朝5時区切り、play_availability と同じ境界）----
function orders_biz_date(?int $ts = null): string {
    return date('Y-m-d', ($ts ?? time()) - 5 * 3600);
}
// 営業時間軸: 10:00〜翌5:00 を 10..29 の連続時間で表す（play-availability.php と同じ並び）
function orders_hours(): array { return range(10, 29); }
// datetime → 営業日内の分オフセット（10:00=0）。営業日外は null
function orders_min_offset(string $bizDate, string $dt): ?int {
    $base = strtotime($bizDate . ' 10:00:00');
    $m = (int)floor((strtotime($dt) - $base) / 60);
    return ($m >= -600 && $m <= 60 * 24) ? $m : $m; // 雛形では制限しない（描画側でclamp）
}

// ---- 電話番号の正規化（顧客の実質主キー）----
function orders_norm_phone(string $p): string {
    return preg_replace('/\D+/', '', $p) ?? '';
}

// ---- 集客媒体（media-sync と同じ語彙 + 直電系）----
function orders_media_list(): array {
    return [
        'heaven'  => 'ヘブン',
        'ekichika'=> '駅ちか',
        'fujoho'  => '情報局',
        'fuzoku'  => '風じゃ',
        'deli'    => 'デリじゃ',
        'fucolle' => 'フーコレ',
        'manzoku' => 'マンゾク',
        'mensv'   => 'メンズバ',
        'web'     => '公式サイト',
        'repeat'  => 'リピート直電',
        'other'   => 'その他',
    ];
}

function orders_status_list(): array {
    return [
        'reserved' => ['予約',       '#8a6d3b'],
        'active'   => ['案内中',     '#2e7d32'],
        'done'     => ['完了',       '#555'],
        'canceled' => ['キャンセル', '#999'],
        'ng'       => ['NG',         '#b03030'],
    ];
}

// ---- lazy migration（存在しなければ作成。ALTER は雛形期間中ここに追記）----
function orders_ensure_tables(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    $q = static fn(string $sql) => db()->exec($sql);
    $q('CREATE TABLE IF NOT EXISTS order_courses (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(80) NOT NULL,
        minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
        price INT UNSIGNED NOT NULL DEFAULT 0,
        back_amount INT UNSIGNED NOT NULL DEFAULT 0,
        sort SMALLINT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_shop (shop_id, is_active, sort)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS order_nomination_types (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(80) NOT NULL,
        price INT UNSIGNED NOT NULL DEFAULT 0,
        back_amount INT UNSIGNED NOT NULL DEFAULT 0,
        sort SMALLINT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_shop (shop_id, is_active, sort)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS order_option_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(80) NOT NULL,
        price INT UNSIGNED NOT NULL DEFAULT 0,
        back_amount INT UNSIGNED NOT NULL DEFAULT 0,
        sort SMALLINT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_shop (shop_id, is_active, sort)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS order_drivers (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(80) NOT NULL,
        sort SMALLINT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_shop (shop_id, is_active, sort)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS order_customers (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        phone VARCHAR(20) NOT NULL,
        name VARCHAR(80) NOT NULL DEFAULT "",
        is_ng TINYINT(1) NOT NULL DEFAULT 0,
        ng_reason VARCHAR(200) NOT NULL DEFAULT "",
        memo TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_shop_phone (shop_id, phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS orders (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        biz_date DATE NOT NULL,
        customer_id INT UNSIGNED NULL,
        girl_id BIGINT UNSIGNED NOT NULL,
        course_id INT UNSIGNED NULL,
        nomination_type_id INT UNSIGNED NULL,
        media_key VARCHAR(20) NOT NULL DEFAULT "other",
        hotel_name VARCHAR(120) NOT NULL DEFAULT "",
        room_no VARCHAR(40) NOT NULL DEFAULT "",
        driver_id INT UNSIGNED NULL,
        start_at DATETIME NOT NULL,
        end_at DATETIME NOT NULL,
        extension_min SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        price_course INT NOT NULL DEFAULT 0,
        price_nomination INT NOT NULL DEFAULT 0,
        price_options INT NOT NULL DEFAULT 0,
        price_extension INT NOT NULL DEFAULT 0,
        discount INT NOT NULL DEFAULT 0,
        total INT NOT NULL DEFAULT 0,
        back_total INT NOT NULL DEFAULT 0,
        payment ENUM("cash","card") NOT NULL DEFAULT "cash",
        status ENUM("reserved","active","done","canceled","ng") NOT NULL DEFAULT "reserved",
        memo VARCHAR(500) NOT NULL DEFAULT "",
        created_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_shop_date (shop_id, biz_date),
        KEY idx_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $q('CREATE TABLE IF NOT EXISTS order_selected_options (
        order_id INT UNSIGNED NOT NULL,
        option_item_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (order_id, option_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

// ---- マスタ取得（is_active のみ、sort順）----
function orders_masters(int $shop): array {
    orders_ensure_tables();
    $get = static function (string $table) use ($shop): array {
        $st = db()->prepare("SELECT * FROM {$table} WHERE shop_id=? AND is_active=1 ORDER BY sort, id");
        $st->execute([$shop]);
        return $st->fetchAll(PDO::FETCH_ASSOC);
    };
    return [
        'courses'     => $get('order_courses'),
        'nominations' => $get('order_nomination_types'),
        'options'     => $get('order_option_items'),
        'drivers'     => $get('order_drivers'),
    ];
}
