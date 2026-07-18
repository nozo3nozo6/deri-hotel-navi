<?php
// ==========================================================================
// _bot-schedule.php — bot 自動実行スケジュールの共通ロジック（CLAUDE-EKICHIKA-BULKTOP.md）
//   api/bot-schedule.php（APIキー認証・bot/外部用）と ctrl/bot-schedule.php（セッション認証・
//   店長UI用）の両方から使う。検証・正規化・clamp・保存を1箇所に集約（二重実装しない）。
//   現状 job=ekichika_bulktop のみ運用（駅ちか「上位表示」を指定時刻に自動実行）。
// ==========================================================================
declare(strict_types=1);

// bot と同一の既定35枠プリセット（駅ちか上位表示・CTRLの「既定」ボタン/初回シード用。夜ピーク厚め）
const BOT_SCHEDULE_PRESET_35 = [
    '00:15', '00:50', '01:30', '02:15',
    '10:00', '10:35', '11:10', '11:45', '12:20', '12:55',
    '13:30', '14:05', '14:40', '15:15', '15:50', '16:25',
    '17:00', '17:30', '18:00', '18:25', '18:50', '19:15', '19:40',
    '20:05', '20:25', '20:45', '21:05', '21:25', '21:45',
    '22:05', '22:25', '22:45', '23:10', '23:35', '23:55',
];

// 風じゃ/デリじゃ速報の既定10枠（bot config と同一）。CLAUDE-BOT-SCHEDULE-NEWS.md §1.1
const BOT_SCHEDULE_NEWS_10 = [
    '00:30', '10:00', '12:00', '14:30', '17:00',
    '18:30', '20:00', '21:30', '22:45', '23:50',
];

// 対応 job の定義（未知 job は 404）。job ごとに媒体上限・既定件数・既定プリセット・UIラベルが違う。
//   固定時刻系(interval=false): ekichika_bulktop(1〜38) / fuzoku_news, deli_news(1〜10) — schedule の HH:MM で実行。
//   周期系(interval=true): fujoho_sokuho=情報局速報, ekichika_news=駅ちかニュース — 一定間隔(分)で5枠ローテ。
//     既定 mode=interval・interval_min=10・daily_limit=0(無制限)・schedule=[]。mode=schedule への切替も可。
//   interval専用(interval_only=true): kyoku_wari=情報局 局割!再掲載 — 一定間隔のみ（時刻リストなし）。
//     媒体側上限(1日100回・プラン依存)は bot がフォームの掲載回数表示から自動検知してスキップ。
//   ※ CTRL/DBは interval_min(分)で持つ。bot は interval_min*60 を refresh_interval_sec として読む。
function bot_schedule_job_meta(string $job): ?array {
    static $meta = [
        'ekichika_bulktop' => ['label' => '駅ちか 上位表示', 'max' => 38,  'default_limit' => 35, 'default_schedule' => BOT_SCHEDULE_PRESET_35, 'default_mode' => 'schedule', 'default_interval' => null, 'interval' => false],
        'fuzoku_news'      => ['label' => '風じゃ 速報',     'max' => 10,  'default_limit' => 10, 'default_schedule' => BOT_SCHEDULE_NEWS_10,  'default_mode' => 'schedule', 'default_interval' => null, 'interval' => false],
        'deli_news'        => ['label' => 'デリじゃ 速報',   'max' => 10,  'default_limit' => 10, 'default_schedule' => BOT_SCHEDULE_NEWS_10,  'default_mode' => 'schedule', 'default_interval' => null, 'interval' => false],
        'fujoho_sokuho'    => ['label' => '情報局 速報',     'max' => 300, 'default_limit' => 0,  'default_schedule' => [],                     'default_mode' => 'interval', 'default_interval' => 10,   'interval' => true],
        'ekichika_news'    => ['label' => '駅ちか ニュース', 'max' => 300, 'default_limit' => 0,  'default_schedule' => [],                     'default_mode' => 'interval', 'default_interval' => 10,   'interval' => true],
        'kyoku_wari'       => ['label' => '情報局 局割！',   'max' => 150, 'default_limit' => 0,  'default_schedule' => [],                     'default_mode' => 'interval', 'default_interval' => 10,   'interval' => true, 'interval_only' => true],
    ];
    return $meta[$job] ?? null;
}
function bot_schedule_jobs(): array { return ['ekichika_bulktop', 'fuzoku_news', 'deli_news', 'fujoho_sokuho', 'ekichika_news', 'kyoku_wari']; }

const BOT_SCHEDULE_INTERVAL_MIN = 1;   // 間隔の下限（分）
const BOT_SCHEDULE_INTERVAL_MAX = 120; // 間隔の上限（分）
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
    $mode = ($row['mode'] ?? '') !== '' ? $row['mode'] : 'schedule';   // 既存行の後方互換
    return [
        'ok'               => true,
        'job'              => $row['job'],
        'shop_id'          => (int)$row['shop_id'],
        'enabled'          => (bool)$row['enabled'],
        'mode'             => $mode,                                                            // interval | schedule
        'interval_min'     => $row['interval_min'] !== null ? (int)$row['interval_min'] : null, // mode=interval で有効
        'daily_limit'      => (int)$row['daily_limit'],                                         // 0=無制限（interval系）
        'schedule'         => $sched,
        'min_interval_sec' => (int)$row['min_interval_sec'],   // deprecated（bot無視）
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
    $jm = bot_schedule_job_meta($job);
    if (!$jm) return ['error' => 'unknown job', 'code' => 404];   // 既知 job のみ保存可
    $cur = bot_schedule_fetch($pdo, $shopId, $job);

    // 既存 or job別の既定
    $enabled  = $cur ? (int)$cur['enabled'] : 1;
    $mode     = $cur ? (($cur['mode'] ?? '') !== '' ? $cur['mode'] : 'schedule') : $jm['default_mode'];
    $intMin   = $cur ? ($cur['interval_min'] !== null ? (int)$cur['interval_min'] : null) : $jm['default_interval'];
    $limit    = $cur ? (int)$cur['daily_limit'] : $jm['default_limit'];
    $interval = $cur ? (int)$cur['min_interval_sec'] : BOT_SCHEDULE_MIN_INTERVAL;
    $sched    = $cur ? (json_decode((string)$cur['schedule_json'], true) ?: []) : $jm['default_schedule'];

    if (array_key_exists('enabled', $in))          $enabled = (int)(bool)$in['enabled'];
    if (array_key_exists('daily_limit', $in))      $limit   = (int)$in['daily_limit'];
    if (array_key_exists('min_interval_sec', $in)) $interval = (int)$in['min_interval_sec'];
    if (array_key_exists('mode', $in)) {
        if (!in_array($in['mode'], ['interval', 'schedule'], true)) return ['error' => 'mode must be interval|schedule', 'code' => 400];
        if (!$jm['interval'] && $in['mode'] === 'interval') return ['error' => 'this job does not support interval mode', 'code' => 400];
        if (!empty($jm['interval_only']) && $in['mode'] === 'schedule') return ['error' => 'this job supports interval mode only', 'code' => 400];
        $mode = $in['mode'];
    }
    if (array_key_exists('interval_min', $in)) $intMin = (int)$in['interval_min'];

    $rawSched = $in['schedule'] ?? $in['times'] ?? null;   // times は別名として受理
    if ($rawSched !== null) {
        if (!is_array($rawSched)) return ['error' => 'schedule must be array', 'code' => 400];
        $norm = bot_schedule_norm_times($rawSched);
        if ($norm === false) return ['error' => 'invalid time in schedule (HH:MM)', 'code' => 400];
        $sched = $norm;
    }

    // モード別の検証・clamp
    $interval = max(BOT_SCHEDULE_MIN_INTERVAL, $interval);   // deprecated だが列保持のため下限維持
    $trimmed = 0;
    if ($mode === 'interval') {
        // 周期系: interval_min を 1〜120 clamp（欠落なら既定10）。daily_limit 0=無制限（0〜max）。schedule は任意
        if ($intMin === null) $intMin = $jm['default_interval'] ?? 10;
        $intMin = max(BOT_SCHEDULE_INTERVAL_MIN, min(BOT_SCHEDULE_INTERVAL_MAX, $intMin));
        $limit  = max(0, min($jm['max'], $limit));
    } else {
        // 固定時刻系: schedule 必須（空は 400）。daily_limit は 0=無制限(=時刻リスト全件) / それ以外は 1〜max。
        //   超過分は早い時刻優先で trim（無制限のときは trim しない）。
        if (empty($sched)) return ['error' => 'schedule required for mode=schedule', 'code' => 400];
        $intMin = null;   // schedule モードでは interval_min を持たない
        $limit  = ($limit <= 0) ? 0 : min($jm['max'], $limit);
        if ($limit > 0 && count($sched) > $limit) { $trimmed = count($sched) - $limit; $sched = array_slice($sched, 0, $limit); }
    }

    $pdo->prepare(
        'INSERT INTO bot_schedules (shop_id, job, enabled, mode, interval_min, daily_limit, min_interval_sec, schedule_json, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), mode=VALUES(mode), interval_min=VALUES(interval_min),
             daily_limit=VALUES(daily_limit), min_interval_sec=VALUES(min_interval_sec),
             schedule_json=VALUES(schedule_json), updated_by=VALUES(updated_by)'
    )->execute([$shopId, $job, $enabled, $mode, $intMin, $limit, $interval, json_encode(array_values($sched)), $by]);

    $out = bot_schedule_to_json(bot_schedule_fetch($pdo, $shopId, $job));
    $out['_trimmed'] = $trimmed;
    return $out;
}
