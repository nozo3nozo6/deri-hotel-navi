<?php
// ==========================================================================
// _bot-schedule.php — bot 自動実行スケジュールの共通ロジック（CLAUDE-EKICHIKA-BULKTOP.md）
//   api/bot-schedule.php（APIキー認証・bot/外部用）と ctrl/bot-schedule.php（セッション認証・
//   店長UI用）の両方から使う。検証・正規化・clamp・保存を1箇所に集約（二重実装しない）。
//   現状 job=ekichika_bulktop のみ運用（駅ちか「上位表示」を指定時刻に自動実行）。
// ==========================================================================
declare(strict_types=1);

// bot と同一の既定35枠プリセット（CTRLの「既定」ボタン・初回シード用。夜ピーク厚め）
const BOT_SCHEDULE_PRESET_35 = [
    '00:15', '00:50', '01:30', '02:15',
    '10:00', '10:35', '11:10', '11:45', '12:20', '12:55',
    '13:30', '14:05', '14:40', '15:15', '15:50', '16:25',
    '17:00', '17:30', '18:00', '18:25', '18:50', '19:15', '19:40',
    '20:05', '20:25', '20:45', '21:05', '21:25', '21:45',
    '22:05', '22:25', '22:45', '23:10', '23:35', '23:55',
];

const BOT_SCHEDULE_MAX_LIMIT = 38;   // 媒体上限（駅ちか N/38回）
// min_interval_sec: deprecated 2026-07-18 — bot は時刻表(schedule)どおりのみ実行し、この値は読まない。
//   （旧: 遅れを毎分連打で追いつく際の連続抑制に使用 → 現: 過ぎた枠はスキップ）。
//   API/DBには後方互換で残すが CTRL UI から入力欄は削除。既定値のみここで保持。
const BOT_SCHEDULE_MIN_INTERVAL = 60;

/**
 * HH:MM 配列を検証・正規化（ゼロ埋め・重複除去・昇順）。不正な要素が1つでもあれば false。
 * @return string[]|false
 */
function bot_schedule_norm_times(array $raw) {
    $set = [];
    foreach ($raw as $t) {
        $t = trim((string)$t);
        if ($t === '') continue;
        if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', $t, $m)) return false;
        $set[sprintf('%02d:%02d', (int)$m[1], (int)$m[2])] = true;   // 重複はキーで潰す
    }
    $keys = array_keys($set);
    sort($keys);   // "HH:MM" は辞書順＝時刻順
    return $keys;
}

/** カンマ・空白・改行・全角読点/コロン混在の入力を HH:MM トークン配列へ */
function bot_schedule_parse_text(string $text): array {
    $text = str_replace(['：', '、', '　'], [':', ',', ' '], $text);   // 全角→半角
    $parts = preg_split('/[\s,]+/u', trim($text));
    return array_values(array_filter($parts, fn($p) => $p !== ''));
}

/** DBから1件取得（無ければ null）。 */
function bot_schedule_fetch(PDO $pdo, int $shopId, string $job): ?array {
    $st = $pdo->prepare('SELECT * FROM bot_schedules WHERE shop_id=? AND job=?');
    $st->execute([$shopId, $job]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** GETレスポンス形（bot が読む形）に整形。 */
function bot_schedule_to_json(array $row): array {
    $sched = json_decode((string)$row['schedule_json'], true);
    if (!is_array($sched)) $sched = [];
    return [
        'ok'               => true,
        'job'              => $row['job'],
        'shop_id'          => (int)$row['shop_id'],
        'enabled'          => (bool)$row['enabled'],
        'daily_limit'      => (int)$row['daily_limit'],
        'min_interval_sec' => (int)$row['min_interval_sec'],
        'schedule'         => $sched,
        'updated_at'       => date('Y-m-d\TH:i:sP', strtotime($row['updated_at'])),
        'updated_by'       => $row['updated_by'] ?? null,
    ];
}

/**
 * 部分更新で保存。$in は {enabled?, daily_limit?, min_interval_sec?, schedule?|times?} 。
 * schedule/times は HH:MM 配列。検証失敗時は ['error'=>..., 'code'=>400] を返す（保存しない）。
 * 成功時は保存後の row を bot_schedule_to_json した配列に 'trimmed' を添えて返す。
 * @return array  成功=to_json形+['_trimmed'=>int]、失敗=['error'=>string,'code'=>int]
 */
function bot_schedule_save(PDO $pdo, int $shopId, string $job, array $in, string $by): array {
    $cur = bot_schedule_fetch($pdo, $shopId, $job);

    // 既存 or 既定
    $enabled  = $cur ? (int)$cur['enabled'] : 1;
    $limit    = $cur ? (int)$cur['daily_limit'] : 35;
    $interval = $cur ? (int)$cur['min_interval_sec'] : BOT_SCHEDULE_MIN_INTERVAL;
    $sched    = $cur ? (json_decode((string)$cur['schedule_json'], true) ?: []) : BOT_SCHEDULE_PRESET_35;

    if (array_key_exists('enabled', $in))          $enabled = (int)(bool)$in['enabled'];
    if (array_key_exists('daily_limit', $in))      $limit   = (int)$in['daily_limit'];
    if (array_key_exists('min_interval_sec', $in)) $interval = (int)$in['min_interval_sec'];

    $rawSched = $in['schedule'] ?? $in['times'] ?? null;   // times は別名として受理
    if ($rawSched !== null) {
        if (!is_array($rawSched)) return ['error' => 'schedule must be array', 'code' => 400];
        $norm = bot_schedule_norm_times($rawSched);
        if ($norm === false) return ['error' => 'invalid time in schedule (HH:MM)', 'code' => 400];
        $sched = $norm;
    }

    // clamp
    $limit    = max(1, min(BOT_SCHEDULE_MAX_LIMIT, $limit));               // 1〜38
    $interval = max(BOT_SCHEDULE_MIN_INTERVAL, $interval);                 // 60以上
    $trimmed = 0;
    if (count($sched) > $limit) { $trimmed = count($sched) - $limit; $sched = array_slice($sched, 0, $limit); }  // 早い時刻優先で trim

    $pdo->prepare(
        'INSERT INTO bot_schedules (shop_id, job, enabled, daily_limit, min_interval_sec, schedule_json, updated_by)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), daily_limit=VALUES(daily_limit),
             min_interval_sec=VALUES(min_interval_sec), schedule_json=VALUES(schedule_json), updated_by=VALUES(updated_by)'
    )->execute([$shopId, $job, $enabled, $limit, $interval, json_encode(array_values($sched)), $by]);

    $out = bot_schedule_to_json(bot_schedule_fetch($pdo, $shopId, $job));
    $out['_trimmed'] = $trimmed;
    return $out;
}
