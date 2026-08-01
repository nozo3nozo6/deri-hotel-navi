<?php
// ==========================================================================
// _shift-sync.php — CTRL の出勤（schedules）を ops のシフト（ops_shifts）へ同期
//
//   出勤の入力は CTRL の /ctrl/schedules.php が正。ops は読むだけ。
//   ops_shifts は「タイムラインに誰の行を出すか」「何時から何時か」の元になる。
//
//   CTRL schedules.status → ops_shifts.status
//     work      → available （出勤。これだけをタイムラインに出す）
//     undecided → 同期しない（「未定」は出勤ではない。CTRL では在籍者ほぼ全員が
//                 既定でこの状態のため、取り込むとタイムラインが全員で埋まる。
//                 2026-08-01 実測: 立川の同日 work 4件 / undecided 115件）
//     off       → 同期しない（休み）
//
//   時間未入力の work は 10:00-翌5:00（営業時間いっぱい）として扱う。
//   CTRL 側で消された・未定に戻された出勤は ops からも消す（同期元が正）。
//
//   ただし ops 側のタイムラインで「終了/休み/予定」に手動で切り替えた行
//   （status !== 'available'）は上書き・削除しない。CTRL が正なのは時間だけで、
//   状態は ops 側の当日運用（終了操作など）を優先する。これを守らないと、
//   他のキャストの出勤を編集しただけで差分同期が走り、既に押した「終了」が
//   available に戻ってタイムラインの先頭へ復活してしまう。
// ==========================================================================
declare(strict_types=1);

const OPS_SHIFT_DEFAULT_START = '10:00:00';
const OPS_SHIFT_DEFAULT_END   = '05:00:00';   // 翌朝5時（営業日の終わり）

/**
 * 指定営業日の範囲で CTRL の出勤を ops_shifts に反映する。
 *
 * @return array{added:int,updated:int,removed:int}
 */
function ops_sync_shifts(int $shopId, string $from, string $to): array {
    $pdo = getPdo();

    // girl_id → ops_admin_users.id
    $map = [];
    foreach ($pdo->query('SELECT id, girl_id FROM ops_admin_users WHERE girl_id IS NOT NULL')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $map[(int)$r['girl_id']] = (int)$r['id'];
    }

    $st = $pdo->prepare(
        'SELECT girl_id, work_date, start_time, end_time, note
           FROM schedules
          WHERE shop_id = ? AND work_date BETWEEN ? AND ? AND status = "work"'
    );
    $st->execute([$shopId, $from, $to]);

    $want = [];   // "adminId|date" => [start, end, status, note]
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $aid = $map[(int)$r['girl_id']] ?? null;
        if (!$aid) continue;   // ops に未同期のキャスト（掲載外など）は無視
        $want[$aid . '|' . $r['work_date']] = [
            $r['start_time'] ?: OPS_SHIFT_DEFAULT_START,
            $r['end_time']   ?: OPS_SHIFT_DEFAULT_END,
            'available',
            (string)($r['note'] ?? ''),
        ];
    }

    // 既存（同期対象＝キャスト行のみ。手入力のスタッフシフトは触らない）
    $cur = [];
    $ex = $pdo->prepare(
        'SELECT s.id, s.admin_user_id, s.shift_date, s.start_time, s.end_time, s.status, s.note
           FROM ops_shifts s
           JOIN ops_admin_users u ON u.id = s.admin_user_id AND u.girl_id IS NOT NULL
          WHERE s.shift_date BETWEEN ? AND ?'
    );
    $ex->execute([$from, $to]);
    foreach ($ex->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cur[(int)$r['admin_user_id'] . '|' . $r['shift_date']] = $r;
    }

    $ins = $pdo->prepare('INSERT INTO ops_shifts (admin_user_id, shift_date, start_time, end_time, status, note) VALUES (?,?,?,?,?,?)');
    $upd = $pdo->prepare('UPDATE ops_shifts SET start_time=?, end_time=?, status=?, note=? WHERE id=?');
    $del = $pdo->prepare('DELETE FROM ops_shifts WHERE id=?');

    $added = 0; $updated = 0; $removed = 0;
    foreach ($want as $key => [$start, $end, $status, $note]) {
        [$aid, $date] = explode('|', $key);
        if (!isset($cur[$key])) {
            $ins->execute([(int)$aid, $date, $start, $end, $status, $note]);
            $added++;
            continue;
        }
        $c = $cur[$key];
        if ($c['status'] !== 'available') continue;   // 手動オーバーライドは触らない
        if ($c['start_time'] !== $start || $c['end_time'] !== $end || (string)$c['note'] !== $note) {
            $upd->execute([$start, $end, $status, $note, (int)$c['id']]);
            $updated++;
        }
    }
    foreach ($cur as $key => $c) {
        if ($c['status'] !== 'available') continue;   // 手動オーバーライドは消さない
        if (!isset($want[$key])) { $del->execute([(int)$c['id']]); $removed++; }
    }

    return ['added' => $added, 'updated' => $updated, 'removed' => $removed];
}

/**
 * 一覧APIの直前に呼ぶ差分同期。schedules の件数・最終更新が変わった時だけ実行する。
 */
function ops_sync_shifts_if_changed(int $shopId, string $from, string $to): void {
    $pdo = getPdo();
    try {
        $sg = $pdo->prepare('SELECT CONCAT(COUNT(*), ":", COALESCE(MAX(modified), ""), ":", COALESCE(MAX(id), 0))
                               FROM schedules WHERE shop_id = ? AND work_date BETWEEN ? AND ?');
        $sg->execute([$shopId, $from, $to]);
        $sig = (string)$sg->fetchColumn();
    } catch (Throwable $e) {
        $sig = '';
    }
    $key = 'ops_shift_sync_' . $shopId . '_' . $from . '_' . $to;
    if ($sig !== '' && ($_SESSION[$key] ?? null) === $sig) return;
    try {
        ops_sync_shifts($shopId, $from, $to);
        $_SESSION[$key] = $sig;
    } catch (Throwable $e) { /* 同期失敗で画面を落とさない */ }
}
