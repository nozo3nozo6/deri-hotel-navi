<?php
// ==========================================================================
// deploy.php — pull型デプロイ Webhook受け口（GitHub Actions から HTTPS で叩く）
//   GitHub→サーバーのSSHが不安定なため、サーバー側が git pull して反映する。
//   認証: X-Deploy-Token ヘッダ === DEPLOY_TOKEN（deploy-config.php、gitignore）
//   実行: git fetch+reset → rsync で public/ api/ admin/ を public_html へ反映
// ==========================================================================

require_once __DIR__ . '/deploy-config.php';
header('Content-Type: application/json; charset=utf-8');

// ---- 認証（定数時間比較） -------------------------------------------------
$sent = $_SERVER['HTTP_X_DEPLOY_TOKEN'] ?? '';
if (!defined('DEPLOY_TOKEN') || DEPLOY_TOKEN === '' || !hash_equals(DEPLOY_TOKEN, (string)$sent)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

@set_time_limit(180);
ignore_user_abort(true);

$REPO = '/home/yobuho/kichifu-repo';
$DOC  = '/home/yobuho/kichifu.com/public_html';
$SRC  = $REPO . '/astro-kichifu';

$steps = [];
function run(string $cmd, array &$steps): bool {
    $out = []; $code = 0;
    exec($cmd . ' 2>&1', $out, $code);
    // PAT をレスポンスに漏らさない
    $safe = preg_replace('/bearer [^\']+/', 'bearer ***', $cmd);
    $steps[] = ['cmd' => $safe, 'code' => $code, 'tail' => array_slice($out, -4)];
    return $code === 0;
}

$pat  = defined('GITHUB_PAT') ? GITHUB_PAT : '';
$auth = escapeshellarg('http.extraheader=AUTHORIZATION: bearer ' . $pat);
$git  = 'git -C ' . escapeshellarg($REPO);
$rs   = 'rsync -rlt --no-perms --no-owner --no-group';

$ok = true;
$ok = run("$git -c $auth fetch --depth=1 origin main", $steps) && $ok;
$ok = run("$git reset --hard FETCH_HEAD", $steps) && $ok;
$ok = run("$rs " . escapeshellarg("$SRC/public/") . ' ' . escapeshellarg("$DOC/"), $steps) && $ok;
$ok = run("$rs --exclude=db-config.php --exclude=deploy-config.php --exclude=*.sample.php "
        . escapeshellarg("$SRC/api/") . ' ' . escapeshellarg("$DOC/api/"), $steps) && $ok;
$ok = run("$rs " . escapeshellarg("$SRC/admin/") . ' ' . escapeshellarg("$DOC/admin/"), $steps) && $ok;

$head = [];
exec("$git rev-parse --short HEAD 2>&1", $head);

http_response_code($ok ? 200 : 500);
echo json_encode(['ok' => $ok, 'head' => $head[0] ?? '', 'steps' => $steps], JSON_UNESCAPED_SLASHES);
