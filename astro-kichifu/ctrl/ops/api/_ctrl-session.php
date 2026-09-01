<?php
// ==========================================================================
// _ctrl-session.php — CTRL のログインを ops の認証として使う（独自ログイン廃止）
//
//   ops は元々 ylka の独立ログイン（ADMI_OPS_SID + ops_admin_users）だったが、
//   CTRL に既にログインしている状態で二重ログインは不要という運用方針のため、
//   CTRL のセッション（KICHIFU_ADMIN / admins テーブル）を唯一の認証元にする。
//
//   - セッションは CTRL のものを1つだけ使う（Cookie も1つ。二重管理を作らない）
//   - ops 側は admin_id が必要（予約の担当者・経理の紐付け）ので、
//     CTRL の admins.username と同名の行を ops_admin_users に自動で用意する
//   - ops_admin_users 側で役割や歩合率を個別に設定したい場合は、そのまま編集してよい
//     （username は CTRL と一致させておくこと。照合キーになっている）
// ==========================================================================
declare(strict_types=1);

require_once __DIR__ . '/../../_lib.php';   // CTRL セッション開始 + current_admin()

/**
 * CTRL のログイン情報から ops のユーザーを解決する。
 * 未ログインなら null。
 *
 * @return array{id:int,username:string,display_name:string,role:string}|null
 */
function ops_current_user(): ?array {
    static $cache = false;
    if ($cache !== false) return $cache;

    $a = current_admin();
    if (!$a) return $cache = null;

    $pdo = getPdo();
    $st  = $pdo->prepare('SELECT id, username, display_name, role FROM ops_admin_users WHERE username = ? LIMIT 1');
    $st->execute([$a['username']]);
    $u = $st->fetch();

    if (!$u) {
        // CTRL にはいるが ops に未登録 → 同じ役割で作る。
        // password_hash は使わない（ops 単独ログインは廃止）が NOT NULL なので不可能な値を入れる。
        $role = in_array($a['role'] ?? '', ['owner', 'manager', 'staff'], true) ? $a['role'] : 'staff';
        $pdo->prepare('INSERT INTO ops_admin_users (username, password_hash, display_name, role) VALUES (?,?,?,?)')
            ->execute([$a['username'], '*', $a['display_name'] ?: $a['username'], $role]);
        $st->execute([$a['username']]);
        $u = $st->fetch();
    }

    // ops 側 API が参照するセッション変数を CTRL セッション上に載せる
    $_SESSION['ylka_admin_id']    = (int)$u['id'];
    $_SESSION['ylka_admin_email'] = $u['username'];
    $_SESSION['ylka_admin_name']  = $u['display_name'];
    $_SESSION['ylka_admin_role']  = $u['role'] ?: 'staff';
    $_SESSION['last_activity']    = time();

    return $cache = [
        'id'           => (int)$u['id'],
        'username'     => (string)$u['username'],
        'display_name' => (string)$u['display_name'],
        'role'         => (string)($u['role'] ?: 'staff'),
    ];
}

/**
 * 権限は「上のメニュー（タブ）の表示・非表示」だけで分ける（店長指定 2026-08-15）。
 * そのタブを見られるロールなら、中の操作は全部できる。判定は権限管理（tab_permissions）に従う。
 * キャスト(staff)はマイページだけなので常に不可。オーナーは常に可。
 */
function opsRoleCanSeeTab(PDO $pdo, string $tab): bool {
    $role = $_SESSION['ylka_admin_role'] ?? '';
    if ($role === 'owner') return true;
    if ($role === 'staff' || $role === '') return false;
    $row = $pdo->query("SELECT setting_value FROM ops_admin_settings WHERE setting_key = 'tab_permissions'")->fetch();
    $perms = $row ? json_decode($row['setting_value'], true) : null;
    if (is_array($perms[$tab] ?? null)) return in_array($role, $perms[$tab], true);
    // まだ保存していないタブの既定（画面側 TAB_DEFAULTS と合わせる）
    $def = [
        'payroll'     => ['owner', 'manager'],
        'staff'       => ['owner', 'manager'],
        'staffboard'  => ['owner', 'manager'],
        'permissions' => ['owner'],
        'chat'        => ['owner', 'manager', 'office'],
    ];
    return isset($def[$tab]) ? in_array($role, $def[$tab], true) : true;
}
function requireTabOps(PDO $pdo, string $tab): void {
    if (!opsRoleCanSeeTab($pdo, $tab)) {
        errorResponse('この操作の権限がありません（権限管理で許可できます）', 403);
    }
}
/** どれか1つのタブが見えていれば可（例: スタッフ管理 と キャスト管理 の両方から使う操作） */
function requireAnyTabOps(PDO $pdo, array $tabs): void {
    foreach ($tabs as $t) { if (opsRoleCanSeeTab($pdo, $t)) return; }
    errorResponse('この操作の権限がありません（権限管理で許可できます）', 403);
}
