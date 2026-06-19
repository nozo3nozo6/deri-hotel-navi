<?php
// ==========================================================================
// _migrate-image-tags.php — 特徴タグ/店舗コメントのスキーマ投入（CLI専用・冪等）
//   migration_image_tags.sql の PHP 版（シンレンに mysql クライアントが無いため）。
//   デプロイ後にサーバーで1回実行: php admin/_migrate-image-tags.php
// ==========================================================================
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require_once __DIR__ . '/../api/db.php';
$pdo  = DB::conn();
$SHOP = 1;

$pdo->exec("CREATE TABLE IF NOT EXISTS girl_image_tags (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shop_id   BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(40) NOT NULL,
  sort      INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gtag_shop (shop_id, sort),
  CONSTRAINT fk_gtag_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
echo "girl_image_tags OK\n";

$pdo->exec("CREATE TABLE IF NOT EXISTS girl_image_tag_links (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  girl_id           BIGINT UNSIGNED NOT NULL,
  girl_image_tag_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_gtaglink (girl_id, girl_image_tag_id),
  CONSTRAINT fk_gtaglink_girl FOREIGN KEY (girl_id) REFERENCES girls(id) ON DELETE CASCADE,
  CONSTRAINT fk_gtaglink_tag  FOREIGN KEY (girl_image_tag_id) REFERENCES girl_image_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
echo "girl_image_tag_links OK\n";

// shop_comment カラム（既存ならスキップ）
try {
    $pdo->exec("ALTER TABLE girls ADD COLUMN shop_comment MEDIUMTEXT NULL AFTER comment");
    echo "girls.shop_comment added\n";
} catch (Throwable $e) {
    echo "girls.shop_comment: skip (" . $e->getMessage() . ")\n";
}

// 特徴タグ 初期マスタ（空のときだけ29種を投入）
$cnt = (int)$pdo->query("SELECT COUNT(*) FROM girl_image_tags WHERE shop_id=$SHOP")->fetchColumn();
if (!$cnt) {
    $tags = ['オススメ','素人','未経験','可愛い系','綺麗系','お嬢様','女子大生','OL系','セクシー','清楚',
             '癒し','ギャル系','モデル系','ロリ系','グラマー','スレンダー','美乳','美脚','巨乳','色白',
             '愛嬌抜群','イチャイチャ系','テクニシャン','痴女','サービス抜群','敏感','濃厚サービス','天然','おっとり'];
    $ins = $pdo->prepare("INSERT INTO girl_image_tags (shop_id,name,sort) VALUES (?,?,?)");
    foreach ($tags as $i => $n) $ins->execute([$SHOP, $n, $i]);
    echo "seeded " . count($tags) . " tags\n";
} else {
    echo "tags already exist: $cnt\n";
}

echo "✅ migration done\n";
