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
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
    }
    session_destroy();
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

// ---- ナビゲーション定義（MINERVAのIAを踏襲・グループ化）----
function nav_groups(): array {
    return [
        '' => [
            ['index.php', '📊', 'ダッシュボード'],
            ['schedules.php', '📅', '出勤管理'],
            ['news.php', '📰', 'お知らせ'],
            ['girls.php', '👩', 'キャスト'],
            ['sliders.php', '🎞️', 'スライダー'],
            ['banners.php', '🖼️', 'バナー'],
            ['events.php', '🎉', 'イベント'],
            ['girl-categories.php', '🏷️', 'カテゴリー'],
            ['girl-image-tags.php', '✨', '特徴タグ'],
            ['girl-options.php', '💋', 'オプション'],
            ['girl-profiles.php', '📝', 'プロフィール項目'],
            ['girl-diaries.php', '📔', '写メ日記'],
        ],
        '媒体連携' => [['suguhime-sync.php', '⚡', 'すぐヒメ同期']],
        'メルマガ' => [
            ['mail-magazines.php', '✉️', '配信'],
            ['mail-users.php', '👥', '会員'],
        ],
        '管理' => [
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
  // 行アクションメニュー開閉
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.rowmenu-btn');
    document.querySelectorAll('.rowmenu.open').forEach(m => { if (!btn || m !== btn.closest('.rowmenu')) m.classList.remove('open'); });
    if (btn) btn.closest('.rowmenu').classList.toggle('open');
  });
</script>
</body></html>
<?php
}
