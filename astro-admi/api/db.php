<?php
// ==========================================================================
// db.php — kichifu.com MariaDB PDO 接続シングルトン + ユーティリティ
//   設定は db-config.php（デプロイ時に GitHub Secrets から生成、gitignore済み）
// ==========================================================================

class DB {
    private static ?PDO $pdo = null;

    public static function conn(): PDO {
        if (self::$pdo === null) {
            require_once __DIR__ . '/db-config.php';
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            self::$pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+09:00'",
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

    /** PHP配列 → JSON文字列（JSONカラム保存用） */
    public static function jsonEncode($value): ?string {
        if ($value === null) return null;
        if (is_string($value)) {
            json_decode($value);
            if (json_last_error() === JSON_ERROR_NONE) return $value;
        }
        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    /** JSON文字列 → PHP配列 */
    public static function jsonDecode($value): ?array {
        if ($value === null) return null;
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}

/** JSONレスポンスを返して終了する小ヘルパー */
function json_out($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
