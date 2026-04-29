<?php
/**
 * cast-bearer.php — Cast URL HMAC bearer 共通ユーティリティ.
 *
 * 用途:
 *   メール通知 URL ?cast=<shop_cast_id>&view=<session_token>&ct=<hmac>&iat=<epoch>
 *   の HMAC bearer 生成・検証を chat-api.php / chat-notify.php /
 *   chat-notify-visitor.php / cast-chat-api.php から共通利用するため.
 *
 * 鍵: CAST_URL_BEARER_SECRET (db-config.php).
 *      未定義時は CHAT_NOTIFY_SECRET にフォールバック.
 *
 * 詳細は chat-api.php castUrlBearerSign() 周辺コメント参照.
 */

if (!function_exists('castUrlBearerSecret')) {
    function castUrlBearerSecret(): string {
        if (defined('CAST_URL_BEARER_SECRET') && CAST_URL_BEARER_SECRET !== '') return CAST_URL_BEARER_SECRET;
        if (defined('CHAT_NOTIFY_SECRET') && CHAT_NOTIFY_SECRET !== '') return CHAT_NOTIFY_SECRET;
        return '';
    }
}

if (!function_exists('castUrlBearerSign')) {
    function castUrlBearerSign(string $shopCastId, string $sessionToken, int $iat): string {
        $secret = castUrlBearerSecret();
        if ($secret === '' || $shopCastId === '' || $sessionToken === '' || $iat <= 0) return '';
        $msg = 'v1|' . $shopCastId . '|' . $sessionToken . '|' . $iat;
        $raw = hash_hmac('sha256', $msg, $secret, true);
        return rtrim(strtr(base64_encode(substr($raw, 0, 16)), '+/', '-_'), '=');
    }
}

if (!function_exists('castUrlBearerVerify')) {
    function castUrlBearerVerify(string $ct, int $iat, string $shopCastId, string $sessionToken): bool {
        if ($ct === '' || $iat <= 0) return false;
        $now = time();
        if ($iat > $now + 300) return false;
        if ($iat < $now - 60 * 86400) return false;
        $expected = castUrlBearerSign($shopCastId, $sessionToken, $iat);
        if ($expected === '') return false;
        return hash_equals($expected, $ct);
    }
}

if (!function_exists('buildCastUrlQuery')) {
    function buildCastUrlQuery(string $shopCastId, string $sessionToken, ?int $iat = null): string {
        $iat = $iat ?? time();
        $ct = castUrlBearerSign($shopCastId, $sessionToken, $iat);
        $q = 'cast=' . rawurlencode($shopCastId) . '&view=' . rawurlencode($sessionToken);
        if ($ct !== '') {
            $q .= '&ct=' . rawurlencode($ct) . '&iat=' . $iat;
        }
        return $q;
    }
}
