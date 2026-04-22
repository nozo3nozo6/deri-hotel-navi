<?php
// =========================================================
// /api/chat-send.php — YobuChat 統一送信エンドポイント
// 4 auth kind (visitor / owner / cast_view / cast_inbox) を単一URLに集約.
// 実装本体は chat-api.php の handleUnifiedSend().
// =========================================================
$_GET['action'] = 'send';
require __DIR__ . '/chat-api.php';
