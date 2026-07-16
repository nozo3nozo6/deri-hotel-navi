<?php
// ==========================================================================
// media-webhook.php — CTRL → 媒体bot Webhook 送信ヘルパー
//   契約: official-media-update/references/WEBHOOK-CTRL.md（2026-07-13）
//   CTRL で play_availability / 本日出勤 を変更したら bot に「変わったよ」信号を
//   POST する。bot が 202 で受けてキュー→数秒で 出勤表/ヒメ割/すぐヒメ/駅ちか等を実行。
//   媒体への直接POSTはしない（媒体操作は bot の持ち場）。
//
//   秘密鍵: db-config.php の PLAY_MEDIA_WEBHOOK_SECRET（bot config の webhook.secret と同値）。
//           未定義/空 → 送信スキップ（機能OFF、PLAY_API_KEY と同じ流儀）。
//   失敗しても呼び出し元の保存は成功のまま（best-effort、bot の cron が保険）。
// ==========================================================================
declare(strict_types=1);

require_once __DIR__ . '/db-config.php';   // 定数は DB接続前に明示 require（db.php は遅延読込）

const PLAY_MEDIA_WEBHOOK_URL = 'https://tk2-409-45785.vs.sakura.ne.jp/official-media-hooks/play-availability-changed.php';

/**
 * bot へ変更通知を送る（best-effort・例外を投げない）。
 * @param int      $shopId  店舗（立川=1 / 吉祥寺=2）
 * @param int      $castId  girls.id
 * @param string   $name    表示名（bot ログ・only_names 絞り用）
 * @param string[] $changed 変わったフィールド名（'play_at','status','shift_end_at','himewari_minutes' 等）
 * @param string   $source  'ctrl' / 'shift' 等
 * @param string[] $jobs    実行ジョブの明示（省略時は bot が changed から推定）。
 *                          受付終了のように「出勤表・ヒメ割は絶対に触らせない」場合は必ず明示する
 *                          （changed に bot の推定表にない語が混ざると "不明→全ジョブ" になり得るため）。
 */
function media_webhook_notify(int $shopId, int $castId, string $name, array $changed, string $source = 'ctrl', array $jobs = []): void {
    $body = [
        'event'      => 'play_availability.changed',
        'shop_id'    => $shopId,
        'cast_id'    => $castId,
        'name'       => $name,
        'changed'    => array_values($changed),
        'updated_at' => date('c'),
        'source'     => $source,
    ];
    if ($jobs) $body['jobs'] = array_values($jobs);
    media_webhook_send($body);
}

/**
 * お知らせ変更を bot へ通知（CLAUDE-NEWS-API.md §5）。情報局「速報！」ジョブ用。
 * 送る: 下書き→公開 / 本文・画像・publish_at 変更 / 非公開化。下書きのみの保存では呼ばないこと。
 */
function media_webhook_notify_news(int $shopId, int $newsId, array $changed, string $source = 'ctrl'): void {
    media_webhook_send([
        'event'      => 'news.changed',
        'shop_id'    => $shopId,
        'news_id'    => $newsId,
        'changed'    => array_values($changed),
        'updated_at' => date('c'),
        'source'     => $source,
        'jobs'       => ['fujoho_sokuho'],
    ]);
}

/** 汎用送信（best-effort・例外を投げない）。payload はイベントごとに組み立て済みのもの。 */
function media_webhook_send(array $body): void {
    if (!defined('PLAY_MEDIA_WEBHOOK_SECRET') || PLAY_MEDIA_WEBHOOK_SECRET === '') return; // 未設定=OFF
    try {
        $payload = json_encode($body, JSON_UNESCAPED_UNICODE);
        $ch = curl_init(PLAY_MEDIA_WEBHOOK_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-Webhook-Secret: ' . PLAY_MEDIA_WEBHOOK_SECRET,
            ],
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT        => 5,
        ]);
        $res  = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($res === false || $code >= 400) {
            error_log('[media-webhook] failed http=' . $code . ' err=' . $err . ' payload=' . $payload);
        }
    } catch (Throwable $e) {
        error_log('[media-webhook] exception: ' . $e->getMessage());
    }
}
