<?php
// ==========================================================================
// _deploy.php — GitHub Actions workflow_dispatch トリガー
//   保存後に呼び出すと Astro 再ビルド → サイト反映される。
//   deploy-config.php（gitignore済み）が存在しない場合はスキップ。
// ==========================================================================

function trigger_deploy(): bool {
    $cfg = __DIR__ . '/../api/deploy-config.php';
    if (!file_exists($cfg)) return false;
    require_once $cfg;
    if (!defined('GITHUB_PAT') || GITHUB_PAT === '') return false;

    $url  = 'https://api.github.com/repos/' . GITHUB_REPO
          . '/actions/workflows/' . GITHUB_WORKFLOW . '/dispatches';
    $body = json_encode(['ref' => GITHUB_BRANCH]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . GITHUB_PAT,
            'Accept: application/vnd.github+json',
            'Content-Type: application/json',
            'User-Agent: kichifu-admin/1.0',
        ],
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // 204 = success
    return $code === 204;
}
