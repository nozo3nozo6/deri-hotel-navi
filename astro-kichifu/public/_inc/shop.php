<?php
// ── エラーログ設定（白画面の事後解析用。訪問者には絶対に表示しない） ──
// ログは Web 非公開の DocRoot 外（/home/<site>/kichifu.com/php_error.log）に出力
ini_set('display_errors', '0');
ini_set('log_errors', '1');
if (!empty($_SERVER['DOCUMENT_ROOT'])) {
    ini_set('error_log', dirname($_SERVER['DOCUMENT_ROOT']) . '/php_error.log');
}
error_reporting(E_ALL);
// 致命エラー（白画面の主因）を確実にログへ。URL・行を添えて後追い可能にする
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log(sprintf(
            '[FATAL] %s in %s:%d | URI=%s',
            $e['message'], $e['file'], $e['line'], $_SERVER['REQUEST_URI'] ?? '-'
        ));
    }
});

// 店舗固有設定（shop.ts と同期）
define('SHOP_NAME',       'アドミ');
define('SHOP_NAME_EN',    'Admi');
define('SHOP_SINCE',      2009);
define('SHOP_CATCH',      '吉祥寺デリヘル');
define('SHOP_FULL_NAME',  'アドミ since2009 吉祥寺デリヘル & Go To FANTASY');
define('SHOP_TEL',        '090-1045-9155');
define('SHOP_TEL_RAW',    '09010459155');
define('SHOP_RECEPTION',  '10:00〜翌5:00');
define('SHOP_LINE_URL',   'https://line.me/ti/p/L4-1uY6q2e');
define('SHOP_RECRUIT_URL','https://kanto.qzin.jp/admi2888/?v=official');
define('SHOP_FUJOHO_ID',  '53179');
define('SHOP_ID_DB',      1);

define('FUJOHO_SHOP',     'https://fujoho.jp/index.php?p=shop&id=' . SHOP_FUJOHO_ID);
define('FUJOHO_SCHEDULE', 'https://fujoho.jp/index.php?p=shop_info&id=' . SHOP_FUJOHO_ID . '&h=ON');
define('FUJOHO_DIARY',    'https://fujoho.jp/index.php?p=shop_girl_blog_list&id=' . SHOP_FUJOHO_ID);

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
