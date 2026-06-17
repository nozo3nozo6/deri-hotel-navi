<?php
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
define('SHOP_FUJOHO_ID',  '53179');
define('SHOP_ID_DB',      1);

define('FUJOHO_SHOP',     'https://fujoho.jp/index.php?p=shop&id=' . SHOP_FUJOHO_ID);
define('FUJOHO_SCHEDULE', 'https://fujoho.jp/index.php?p=shop_info&id=' . SHOP_FUJOHO_ID . '&h=ON');
define('FUJOHO_DIARY',    'https://fujoho.jp/index.php?p=shop_girl_blog_list&id=' . SHOP_FUJOHO_ID);

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
