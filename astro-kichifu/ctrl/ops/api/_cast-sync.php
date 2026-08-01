<?php
// ==========================================================================
// _cast-sync.php — CTRL のキャスト（girls）を ops のキャスト行へ同期
//
//   キャストの登録・編集は CTRL の /ctrl/girls.php が正（今後もそちらがメイン）。
//   ops 側は「タイムラインの行」と「予約の担当者」として参照するだけなので、
//   girls を ops_admin_users（is_therapist=1）へ写して紐付ける。
//
//   紐付けキーは ops_admin_users.girl_id（= girls.id）。名前照合はしない
//   （同名キャストが存在しうるため。名前で結ぶと別人に付く事故になる）。
//
//   ops 側だけで持つ情報（歩合率・並び順・ドライバー可否など）は上書きしない。
//   表示名とサムネイルだけ CTRL に追従する。
// ==========================================================================
declare(strict_types=1);

/**
 * CTRL の girls を ops_admin_users へ同期する。
 * 掲載中のキャスト＝タイムラインに出る（is_therapist=1）。
 * 掲載を外した／店舗から外れたキャスト＝行は残すが is_therapist=0 にして隠す
 * （過去の予約が参照しているため削除はしない）。
 *
 * @return array{added:int,updated:int,hidden:int}
 */
function ops_sync_casts(int $shopId): array {
    $pdo = getPdo();

    // ---- girl_id 列の用意（初回のみ）----
    static $migrated = false;
    if (!$migrated) {
        $migrated = true;
        $cols = $pdo->query('SHOW COLUMNS FROM ops_admin_users')->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('girl_id', $cols, true)) {
            $pdo->exec('ALTER TABLE ops_admin_users ADD COLUMN girl_id BIGINT UNSIGNED NULL,
                        ADD UNIQUE KEY uq_girl (girl_id)');
        }
    }

    // ---- CTRL 側の掲載キャスト（girl_shops で店舗に属するもの）----
    $st = $pdo->prepare(
        'SELECT g.id, g.name,
                (SELECT path FROM girl_images WHERE girl_id = g.id ORDER BY sort, id LIMIT 1) AS photo
           FROM girls g
           JOIN girl_shops gs ON gs.girl_id = g.id AND gs.shop_id = ?
          WHERE g.is_display = 1
          ORDER BY (g.in_date IS NULL), g.in_date DESC, g.id DESC'
    );
    $st->execute([$shopId]);
    $girls = $st->fetchAll(PDO::FETCH_ASSOC);

    $existing = [];
    foreach ($pdo->query('SELECT id, girl_id, display_name, thumbnail_url, is_therapist FROM ops_admin_users WHERE girl_id IS NOT NULL')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $existing[(int)$r['girl_id']] = $r;
    }

    $ins = $pdo->prepare('INSERT INTO ops_admin_users
            (username, password_hash, display_name, role, is_therapist, thumbnail_url, sort_order, girl_id)
            VALUES (?, "*", ?, "staff", 1, ?, ?, ?)');
    $upd = $pdo->prepare('UPDATE ops_admin_users
                             SET display_name = ?, thumbnail_url = ?, is_therapist = 1, sort_order = ?
                           WHERE girl_id = ?');

    $added = 0; $updated = 0; $seen = [];
    foreach ($girls as $i => $g) {
        $gid   = (int)$g['id'];
        $seen[$gid] = true;
        $photo = $g['photo'] ?: null;
        if (!isset($existing[$gid])) {
            // username は一意制約があるため機械生成（ops 単独ログインはしないので実害なし）
            $ins->execute(['cast_' . $gid, $g['name'], $photo, $i, $gid]);
            $added++;
            continue;
        }
        $cur = $existing[$gid];
        if ($cur['display_name'] !== $g['name']
            || (string)$cur['thumbnail_url'] !== (string)$photo
            || (int)$cur['is_therapist'] !== 1) {
            $upd->execute([$g['name'], $photo, $i, $gid]);
            $updated++;
        }
    }

    // ---- 掲載から外れたキャストを隠す ----
    $hidden = 0;
    $hide = $pdo->prepare('UPDATE ops_admin_users SET is_therapist = 0 WHERE girl_id = ?');
    foreach ($existing as $gid => $r) {
        if (!isset($seen[$gid]) && (int)$r['is_therapist'] === 1) {
            $hide->execute([$gid]);
            $hidden++;
        }
    }

    return ['added' => $added, 'updated' => $updated, 'hidden' => $hidden];
}

/**
 * 一覧APIの直前に呼ぶ軽い同期。毎リクエスト全件比較は無駄なので
 * girls の最終更新時刻が前回と変わったときだけ実行する。
 */
function ops_sync_casts_if_changed(int $shopId): void {
    $pdo = getPdo();
    try {
        $sig = (string)$pdo->query('SELECT CONCAT(COUNT(*), ":", COALESCE(MAX(modified), ""), ":", COALESCE(MAX(id), 0)) FROM girls')->fetchColumn();
    } catch (Throwable $e) {
        $sig = '';
    }
    $key = 'ops_cast_sync_sig_' . $shopId;
    if ($sig !== '' && ($_SESSION[$key] ?? null) === $sig) return;
    try {
        ops_sync_casts($shopId);
        $_SESSION[$key] = $sig;
    } catch (Throwable $e) { /* 同期失敗で画面を落とさない */ }
}
