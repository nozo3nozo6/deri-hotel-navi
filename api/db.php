<?php
// ==========================================================================
// db.php — MariaDB PDO接続シングルトン + ユーティリティ
// ==========================================================================

class DB {
    private static ?PDO $pdo = null;

    public static function conn(): PDO {
        if (self::$pdo === null) {
            // db-config.php から設定読み込み（deploy時にSecretsから生成）
            require_once __DIR__ . '/db-config.php';
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            self::$pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00'",
            ]);
        }
        return self::$pdo;
    }

    /** UUID v4 生成 */
    public static function uuid(): string {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40); // version 4
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80); // variant
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    /** JSON配列カラム用: PHP配列 → JSON文字列 */
    public static function jsonEncode($value): ?string {
        if ($value === null) return null;
        if (is_string($value)) {
            // 既にJSON文字列ならそのまま
            $decoded = json_decode($value);
            if (json_last_error() === JSON_ERROR_NONE) return $value;
        }
        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    /** JSON配列カラム用: JSON文字列 → PHP配列 */
    public static function jsonDecode($value): ?array {
        if ($value === null) return null;
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}
