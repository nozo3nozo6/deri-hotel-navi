<?php
// ==========================================================================
// _lib.php — 管理画面の共通基盤（認証 / シェル / CSRF / ヘルパー）
//   全 admin ページの冒頭で require_once __DIR__.'/_lib.php';
// ==========================================================================
declare(strict_types=1);

require_once __DIR__ . '/../api/db.php';

const ADMIN_NAME    = 'アドミ CMS';
const SESSION_TTL   = 28800; // 8h

// 画像は admi2888.com に物理集約し全ドメイン共有（astro lib/config.ts の ASSET_ORIGIN と対）。
// admi2888 が物理的に正、kichifu.com/public_html/uploads は admi2888 への symlink で同一実体を共有。
// CTRL からの保存も admi2888 の /uploads に集約＝両サイト即反映、実体分裂しない。
const ASSET_ORIGIN  = 'https://admi2888.com';                  // /uploads 画像の配信元（表示用・絶対URL）
const UPLOADS_ROOT  = '/home/yobuho/admi2888.com/public_html';  // /uploads 物理保存ルート（保存/削除用＝正の実体）

// ---- セッション開始（httponly / SameSite=Strict / https時secure）----
if (session_status() !== PHP_SESSION_ACTIVE) {
    $https = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('KICHIFU_ADMIN');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/', 'httponly' => true,
        'samesite' => 'Strict', 'secure' => $https,
    ]);
    session_start();
}

function db(): PDO { return DB::conn(); }
function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function redirect(string $url): void { header('Location: ' . $url); exit; }

// CMS画像URLを解決。/uploads(共有実体)は ASSET_ORIGIN(admi2888) を前置、/img 等ローカルアセットはそのまま。
// 旧 kichifu.com/uploads の絶対URLは admi2888 に正規化（実体はadmi2888が正・kichifuはsymlink）。
function asset_url(?string $p): string {
    if (!$p) return '';
    if (preg_match('#^https?://#', $p)) {
        return preg_replace('#https?://kichifu\.com(/uploads/)#', ASSET_ORIGIN . '$1', $p);
    }
    if (str_starts_with($p, '/uploads/')) return ASSET_ORIGIN . $p;
    return $p;
}

// ---- CSRF ----
function csrf_token(): string {
    if (empty($_SESSION['_csrf'])) $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['_csrf'];
}
function csrf_field(): string { return '<input type="hidden" name="_csrf" value="' . h(csrf_token()) . '">'; }
function csrf_check(): void {
    $t = $_POST['_csrf'] ?? '';
    if (!is_string($t) || !hash_equals($_SESSION['_csrf'] ?? '', $t)) {
        http_response_code(419); exit('セッションの有効期限が切れました。再読み込みしてください。');
    }
}

// ---- flash ----
function flash(string $type, string $msg): void { $_SESSION['_flash'][] = [$type, $msg]; }
function render_flash(): string {
    $out = '';
    foreach ($_SESSION['_flash'] ?? [] as [$type, $msg]) {
        $cls = $type === 'err' ? 'flash-err' : 'flash-ok';
        $out .= '<div class="flash ' . $cls . '">' . h($msg) . '</div>';
    }
    unset($_SESSION['_flash']);
    return $out;
}

// ---- 認証 ----
function current_admin(): ?array {
    static $cache = false;            // リクエスト内メモ化（DB照会の重複回避）
    if ($cache !== false) return $cache;
    // セッションが無い/切れた場合でも、信頼済み端末のCookieがあれば黙って復帰する
    // （毎回のログイン操作を無くすための仕組み。端末の登録は初回のみ・認証コード必須）
    if (empty($_SESSION['admin_id'])) { try_device_login(); }
    if (empty($_SESSION['admin_id'])) return $cache = null;
    if ((time() - ($_SESSION['admin_seen'] ?? 0)) > SESSION_TTL) { logout_session(); return $cache = null; }
    $_SESSION['admin_seen'] = time();
    $st = db()->prepare('SELECT id, shop_id, username, display_name, role, password_hash FROM admins WHERE id = ?');
    $st->execute([$_SESSION['admin_id']]);
    $a = $st->fetch();
    // 認証情報変更時はセッション無効化（パスワード指紋を比較）
    if (!$a || ($_SESSION['admin_fp'] ?? '') !== substr(hash('sha256', $a['password_hash']), 0, 32)) {
        logout_session(); return $cache = null;
    }
    return $cache = $a;
}
function require_login(): array {
    $a = current_admin();
    if (!$a) redirect('login.php');
    return $a;
}
function login_session(array $a): void {
    session_regenerate_id(true);
    $_SESSION['admin_id']   = (int)$a['id'];
    $_SESSION['admin_fp']   = substr(hash('sha256', $a['password_hash']), 0, 32);
    $_SESSION['admin_seen'] = time();
    $_SESSION['shop_id']    = $a['shop_id'] ? (int)$a['shop_id'] : null;
}
function logout_session(): void {
    // 端末Cookieは消さない。消すと「ログアウト＝端末登録の取り消し」になってしまい、
    // 次回また認証コードが必要になる。端末の解除は端末一覧から明示的に行う
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
    }
    session_destroy();
}

// ==========================================================================
// 信頼済み端末（Trusted device）
//   初回だけ パスワード＋メールの6桁コード で端末を登録し、以後その端末は
//   ログイン操作なしで入れる。パスワードが漏れても未登録の端末からは入れない。
//   端末Cookieは httponly / SameSite=Lax（管理画面のみで使うため外部からは送られない）。
//   有効期限は90日で、使うたびに延長（スライディング）。紛失時は端末一覧から解除。
// ==========================================================================
// 端末認証のON/OFF。false の間は従来どおり「ユーザー名＋パスワード」だけで入れる。
// メール（認証コード）の到達を確認してから true に戻すこと。
// ※ false でも登録済み端末の自動復帰は効くので、ログイン操作は増えない。
const DEVICE_AUTH_ENABLED = false;
const DEVICE_COOKIE = 'KICHIFU_DEVICE';
const DEVICE_TTL_DAYS = 90;

function device_cookie_set(string $token): void {
    $https = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie(DEVICE_COOKIE, $token, [
        'expires'  => time() + DEVICE_TTL_DAYS * 86400,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => $https,
    ]);
}
function device_cookie_clear(): void {
    setcookie(DEVICE_COOKIE, '', ['expires' => time() - 42000, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
}
function device_ua(): string { return substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255); }
function device_ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45); }

/** いまの端末Cookieに対応する有効な端末行（無ければ null） */
function current_device(?int $adminId = null): ?array {
    $tok = (string)($_COOKIE[DEVICE_COOKIE] ?? '');
    if ($tok === '') return null;
    $sql = 'SELECT * FROM admin_trusted_devices WHERE token_hash = ? AND expires_at > NOW()';
    $args = [hash('sha256', $tok)];
    if ($adminId !== null) { $sql .= ' AND admin_id = ?'; $args[] = $adminId; }
    try {
        $st = db()->prepare($sql);
        $st->execute($args);
        return $st->fetch() ?: null;
    } catch (Throwable $e) { return null; }   // テーブル未作成でも従来どおり動かす
}

/** 端末Cookieだけでセッションを復帰させる（ログイン操作なし）
 *  明示的にログアウトした端末は auto_disabled_at が立っていて自動復帰しない
 *  （そうしないとログアウトしてもすぐ入り直ってしまい、ログアウトが機能しない）。
 *  次回パスワードで入り直せば解除される（信頼済みなので認証コードは不要）。 */
function try_device_login(): bool {
    $d = current_device();
    if (!$d || !empty($d['auto_disabled_at'])) return false;
    try {
        $st = db()->prepare('SELECT id, shop_id, username, display_name, role, password_hash FROM admins WHERE id = ?');
        $st->execute([$d['admin_id']]);
        $a = $st->fetch();
        if (!$a) return false;
        login_session($a);
        device_touch((int)$d['id']);
        return true;
    } catch (Throwable $e) { return false; }
}

/** 使うたびに最終利用と有効期限を更新（スライディング90日）。自動復帰の停止も解除する */
function device_touch(int $deviceId): void {
    try {
        db()->prepare('UPDATE admin_trusted_devices
                          SET last_used_at = NOW(), last_ip = ?, user_agent = ?, auto_disabled_at = NULL,
                              expires_at = DATE_ADD(NOW(), INTERVAL ' . DEVICE_TTL_DAYS . ' DAY)
                        WHERE id = ?')->execute([device_ip(), device_ua(), $deviceId]);
    } catch (Throwable $e) {}
}

/** ログアウト時: この端末の自動復帰だけ止める（端末の登録自体は残す） */
function device_pause_auto_login(): void {
    $tok = (string)($_COOKIE[DEVICE_COOKIE] ?? '');
    if ($tok === '') return;
    try {
        db()->prepare('UPDATE admin_trusted_devices SET auto_disabled_at = NOW() WHERE token_hash = ?')
            ->execute([hash('sha256', $tok)]);
    } catch (Throwable $e) {}
}

/** 端末を登録して Cookie を発行する。戻り値は端末ID */
function device_register(int $adminId, string $name): int {
    $token = bin2hex(random_bytes(32));
    $name  = trim($name) !== '' ? mb_substr(trim($name), 0, 60) : '名称未設定の端末';
    db()->prepare('INSERT INTO admin_trusted_devices
                     (admin_id, token_hash, device_name, created_at, last_used_at, expires_at, last_ip, user_agent)
                   VALUES (?, ?, ?, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ' . DEVICE_TTL_DAYS . ' DAY), ?, ?)')
        ->execute([$adminId, hash('sha256', $token), $name, device_ip(), device_ua()]);
    device_cookie_set($token);
    return (int)db()->lastInsertId();
}

/** 認証コードのメール送信。宛先が無ければ false（画面側で案内する） */
function device_send_code(array $admin, string $code): bool {
    $to = trim((string)($admin['email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $subject = '=?UTF-8?B?' . base64_encode('【' . ADMIN_NAME . '】ログイン認証コード') . '?=';
    $body = "管理画面にログインするための認証コードです。\n\n"
          . "    {$code}\n\n"
          . "10分間有効です。心当たりがない場合はこのメールを破棄し、パスワードを変更してください。\n"
          . '接続元IP: ' . device_ip() . "\n";
    // envelope sender（-f）を必ず渡す。省くと差出人がサーバー既定になり SPF が揃わず、
    // Gmail で迷惑メール判定・拒否になる（yobuho で同じ事故あり）
    $from = 'no-reply@admi2888.com';
    $headers = "From: " . ADMIN_NAME . " <{$from}>\r\n"
             . "Reply-To: {$from}\r\n"
             . "Content-Type: text/plain; charset=UTF-8\r\n"
             . "X-Mailer: admi-ctrl\r\n";
    return (bool)@mail($to, $subject, $body, $headers, '-f ' . $from);
}

// ---- 店舗（マルチテナント）----
function shops_list(): array {
    return db()->query('SELECT id, slug, name, area FROM shops ORDER BY id')->fetchAll();
}
function current_shop_id(): int {
    $a = current_admin();
    // staff は自店舗固定。owner(全店)は切替可（セッション保持）
    if ($a && $a['shop_id']) return (int)$a['shop_id'];
    if (!empty($_GET['shop'])) $_SESSION['shop_id'] = (int)$_GET['shop'];
    if (!empty($_SESSION['shop_id'])) return (int)$_SESSION['shop_id'];
    $row = db()->query('SELECT id FROM shops ORDER BY id LIMIT 1')->fetch();
    return $row ? (int)$row['id'] : 1;
}

// ---- 「この店のサイトに出るもの」スコープ（表示店舗トグルを持つテーブル用）----
// sliders / banners は 1行 = 1コンテンツ で、表示先は slider_shops / banner_shops のトグルで決まる。
// 一覧を owner(shop_id) で絞ると「他店が作って自店にも出している行」が管理画面から見えず、
// 消したつもりのバナーがサイトに残り続ける（2026-08-03 吉祥寺のスライダー8枚問題）。
// そこで一覧・編集・削除のスコープを「自店に表示される行」＋「自店が作った表示先なしの行」に統一する。
//   $alias: 対象テーブルの別名（例 's'）/ $link: 中間テーブル名 / $fk: 中間テーブルの外部キー列
// 戻り値: [SQL断片, バインド値] — SQL断片は AND で連結して使う
function display_scope_sql(string $alias, string $link, string $fk, int $shop): array {
    $sql = "(EXISTS (SELECT 1 FROM `$link` l1 WHERE l1.`$fk` = $alias.id AND l1.shop_id = ?)"
         . " OR ($alias.shop_id = ? AND NOT EXISTS (SELECT 1 FROM `$link` l2 WHERE l2.`$fk` = $alias.id)))";
    return [$sql, [$shop, $shop]];
}

// ---- ナビゲーション定義（MINERVAのIAを踏襲・グループ化）----
function nav_groups(): array {
    return [
        '' => [
            ['index.php', '📊', 'ダッシュボード'],
            ['schedules.php', '📅', '出勤管理'],
            ['news.php', '📰', 'お知らせ'],
            ['girls.php', '👩', 'キャスト'],
        ],
        // 店舗運営（顧客/オーダー/売上）— ylka /ctrl SPA を ops/ に移植（2026-08-01）
        '店舗運営' => [
            ['ops/dashboard/', '📋', 'オペレーション'],
        ],
        // 媒体連携は頻用のためスライダーより上に配置（2026-07-12 ユーザー指示）
        '媒体連携' => [
            ['play-availability.php', '⏰', '最速で遊べる時間'],
            ['media-sync.php', '🔗', '媒体ID同期'],
            ['news-slots.php', '📡', '媒体固定枠'],
            ['bot-schedule.php', '🔄', '媒体自動更新'],
            ['suguhime-sync.php', '⚡', 'すぐヒメ同期'],
            ['media-accounts.php', '🔐', '媒体アカウント'],
        ],
        'コンテンツ' => [
            ['sliders.php', '🎞️', 'スライダー'],
            ['banners.php', '🖼️', 'バナー'],
            ['events.php', '🎉', 'イベント'],
            ['girl-categories.php', '🏷️', 'カテゴリー'],
            ['girl-image-tags.php', '✨', '特徴タグ'],
            ['girl-options.php', '💋', 'オプション'],
            ['girl-profiles.php', '📝', 'プロフィール項目'],
            ['girl-diaries.php', '📔', '写メ日記'],
        ],
        'メルマガ' => [
            ['mail-magazines.php', '✉️', '配信'],
            ['mail-users.php', '👥', '会員'],
        ],
        '管理' => [
            ['devices.php', '🔒', '端末とログイン'],
            ['contacts.php', '📨', 'お問い合わせ'],
            ['courses.php', '💴', '料金'],
            ['configs.php', '⚙️', '設定'],
            ['admins.php', '🔑', '管理者'],
        ],
    ];
}

// ---- 一覧ページのページャ ----
function pager(int $total, int $page, int $per, string $baseQuery = ''): string {
    $pages = max(1, (int)ceil($total / $per));
    if ($pages <= 1) return '';
    $out = '<div class="pager">';
    for ($i = 1; $i <= $pages; $i++) {
        $cls = $i === $page ? 'cur' : '';
        $out .= '<a class="' . $cls . '" href="?' . h($baseQuery) . 'page=' . $i . '">' . $i . '</a>';
    }
    return $out . '</div>';
}

// ==========================================================================
// レイアウト（共通シェル）
// ==========================================================================
function layout_header(string $title, string $active = ''): void {
    // CTRLは常に最新DB状態を反映すべき管理画面。キャッシュ制御ヘッダーが無いと、モバイル
    // Safari等がPOST後のredirect先(GET)を積極的にキャッシュし、保存/クリア操作直後に古い
    // 表示のまま見えることがある（2026-07-13 発覚: play-availabilityのクリアが反映されない報告）。
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    $admin = require_login();
    $shops = shops_list();
    $curShop = current_shop_id();
    $canSwitch = !$admin['shop_id']; // 全店 owner のみ切替可
    ?><!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h($title) ?> | <?= ADMIN_NAME ?></title>
<link rel="icon" href="/ctrl/favicon.svg?v=<?= @filemtime(__DIR__ . '/favicon.svg') ?: '1' ?>" type="image/svg+xml">
<link rel="stylesheet" href="/ctrl/admin.css?v=<?= @filemtime(__DIR__ . '/admin.css') ?: '1' ?>">
</head><body>
<div class="l-wrap">
  <aside class="l-sidebar">
    <div class="s-brand"><span class="dot"></span><?= ADMIN_NAME ?></div>
    <?php foreach (nav_groups() as $group => $links): ?>
      <?php if ($group !== ''): ?><div class="s-group"><?= h($group) ?></div><?php endif; ?>
      <?php foreach ($links as [$href, $ic, $label]): ?>
        <a class="s-link <?= $active === $href ? 'active' : '' ?>" href="/ctrl/<?= $href ?>"><span class="ic"><?= $ic ?></span><?= h($label) ?></a>
      <?php endforeach; ?>
    <?php endforeach; ?>
  </aside>
  <div class="l-main">
    <header class="l-topbar">
      <button class="btn-burger" type="button" data-nav-toggle aria-label="メニュー">☰</button>
      <?php if ($canSwitch): ?>
        <form class="shop-switch" method="get">
          <span class="muted">店舗</span>
          <select name="shop" onchange="this.form.submit()">
            <?php foreach ($shops as $s): ?>
              <option value="<?= (int)$s['id'] ?>" <?= (int)$s['id'] === $curShop ? 'selected' : '' ?>><?= h($s['area'] . ' ' . $s['name']) ?></option>
            <?php endforeach; ?>
          </select>
        </form>
      <?php else: ?>
        <span class="muted"><?php foreach ($shops as $s) if ((int)$s['id'] === $curShop) echo h($s['area'] . ' ' . $s['name']); ?></span>
      <?php endif; ?>
      <div class="topbar-right">
        <a href="https://admi2888.com/" target="_blank">アドミ ↗</a>
        <a href="https://kichifu.com/" target="_blank">吉祥寺 ↗</a>
        <span class="muted"><?= h($admin['display_name'] ?: $admin['username']) ?></span>
        <a href="/ctrl/logout.php" class="btn btn-sm">ログアウト</a>
      </div>
    </header>
    <main class="l-content">
      <?= render_flash() ?>
<?php
}

function layout_footer(): void {
    ?>
    </main>
  </div>
</div>
<script>
  document.querySelectorAll('[data-nav-toggle]').forEach(b => b.addEventListener('click', () => document.body.classList.toggle('nav-open')));
  // 行アクションメニュー開閉。
  // 親の .table-wrap が overflow-x:auto（= y も auto 扱い）なので、absolute のままだと
  // メニューが切り取られる。特に絞り込みで1行だけになると下に余白が無く全く見えない。
  // → 開くときだけ position:fixed にして、ボタンの画面座標から配置する。
  const placeRowMenu = (menu) => {
    const btn = menu.querySelector('.rowmenu-btn');
    const list = menu.querySelector('.rowmenu-list');
    if (!btn || !list) return;
    const r = btn.getBoundingClientRect();
    list.style.position = 'fixed';
    list.style.right = 'auto';
    const w = list.offsetWidth || 150;
    // 右端からはみ出さないように寄せる
    list.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    // 下に入らなければボタンの上に出す
    const h = list.offsetHeight || 90;
    list.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + 'px';
  };
  const closeRowMenus = () => document.querySelectorAll('.rowmenu.open').forEach(m => m.classList.remove('open'));
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.rowmenu-btn');
    document.querySelectorAll('.rowmenu.open').forEach(m => { if (!btn || m !== btn.closest('.rowmenu')) m.classList.remove('open'); });
    if (!btn) return;
    const menu = btn.closest('.rowmenu');
    const opening = !menu.classList.contains('open');
    menu.classList.toggle('open');
    if (opening) placeRowMenu(menu);
  });
  // 位置が固定なのでスクロール・リサイズしたら閉じる（追従させると重い＆ずれる）
  window.addEventListener('scroll', closeRowMenus, true);
  window.addEventListener('resize', closeRowMenus);
</script>
</body></html>
<?php
}
