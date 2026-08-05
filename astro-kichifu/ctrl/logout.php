<?php
require_once __DIR__ . '/_lib.php';
// 端末の登録は残したまま、この端末の自動復帰だけ止める。
// （消してしまうと次回また認証コードが必要になり、ログアウトのたびに手間が増える）
device_pause_auto_login();
logout_session();
redirect('login.php');
