<?php
/**
 * submit-shop.php — 店舗登録（MySQL版）
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: https://yobuho.com');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mail-utils.php';
$pdo = DB::conn();

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) { http_response_code(400); echo json_encode(['error' => '無効なリクエストです']); exit; }

$email      = trim($input['email'] ?? '');
$shopName   = trim($input['shop_name'] ?? '');
$genderMode = $input['gender_mode'] ?? 'men';
$shopUrl    = trim($input['shop_url'] ?? '');
$shopTel    = trim($input['shop_tel'] ?? '');
$prefecture = trim($input['prefecture'] ?? '');
$area       = trim($input['area'] ?? '');
$docUrl     = $input['document_url'] ?? null;
$pwHash     = $input['password_hash'] ?? null;

// 47都道府県のホワイトリスト検証（任意項目なので空はOK）
$validPrefs = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
if ($prefecture !== '' && !in_array($prefecture, $validPrefs, true)) $prefecture = '';
$area = mb_substr($area, 0, 50);

if (!$email || !$shopName) { http_response_code(400); echo json_encode(['error' => 'email と shop_name は必須です']); exit; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { http_response_code(400); echo json_encode(['error' => '無効なメールアドレスです']); exit; }

$allowedGenders = ['men', 'women', 'men_same', 'women_same', 'este'];
if (!in_array($genderMode, $allowedGenders)) { http_response_code(400); echo json_encode(['error' => '無効なジャンルです']); exit; }

$shopName = mb_substr($shopName, 0, 100);

// slug自動生成（ランダム8文字英小文字+数字）
function generateSlug(PDO $pdo): string {
    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for ($attempt = 0; $attempt < 10; $attempt++) {
        $slug = '';
        for ($i = 0; $i < 8; $i++) $slug .= $chars[random_int(0, strlen($chars) - 1)];
        $stmt = $pdo->prepare('SELECT id FROM shops WHERE slug = ? LIMIT 1');
        $stmt->execute([$slug]);
        if (!$stmt->fetch()) return $slug;
    }
    return bin2hex(random_bytes(4)); // フォールバック
}

// 既存チェック
$stmt = $pdo->prepare('SELECT id, status FROM shops WHERE email = ?');
$stmt->execute([$email]);
$existing = $stmt->fetch();

// パスワードリセットモード
if ($shopName === '_pw_reset_' && $pwHash && $existing) {
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $bcryptHash = password_hash($decodedPw, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare('UPDATE shops SET password_hash = ?, updated_at = ? WHERE email = ?');
    $stmt->execute([$bcryptHash, date('Y-m-d H:i:s'), $email]);
    $stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ?');
    $stmt->execute([$email]);
    $shop = $stmt->fetch();
    unset($shop['password_hash']);
    echo json_encode(['success' => true, 'shop' => $shop]);
    exit;
}

// bcryptハッシュ化
$bcryptHash = null;
if ($pwHash) {
    $decodedPw = base64_decode($pwHash, true);
    if ($decodedPw === false) $decodedPw = $pwHash;
    $bcryptHash = password_hash($decodedPw, PASSWORD_BCRYPT);
}

$now = date('Y-m-d H:i:s');

if ($existing) {
    // UPDATE
    $sql = 'UPDATE shops SET shop_name=?, gender_mode=?, shop_url=?, shop_tel=?, prefecture=?, area=?, document_url=?, status=?, updated_at=?';
    $params = [$shopName, $genderMode, $shopUrl ?: null, $shopTel ?: null, $prefecture ?: null, $area ?: null, $docUrl, 'registered', $now];
    if ($bcryptHash) { $sql .= ', password_hash=?'; $params[] = $bcryptHash; }
    $sql .= ' WHERE email = ?';
    $params[] = $email;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    // ad_placementsのmodeも連動更新
    $syncStmt = $pdo->prepare('UPDATE ad_placements SET mode = ? WHERE shop_id = ?');
    $syncStmt->execute([$genderMode, $existing['id']]);
} else {
    // INSERT
    $id = DB::uuid();
    $slug = generateSlug($pdo);
    $stmt = $pdo->prepare('INSERT INTO shops (id, email, shop_name, gender_mode, shop_url, shop_tel, prefecture, area, document_url, password_hash, slug, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$id, $email, $shopName, $genderMode, $shopUrl ?: null, $shopTel ?: null, $prefecture ?: null, $area ?: null, $docUrl, $bcryptHash, $slug, 'registered', $now, $now]);
}

$stmt = $pdo->prepare('SELECT * FROM shops WHERE email = ?');
$stmt->execute([$email]);
$shop = $stmt->fetch();
unset($shop['password_hash']);

// admin通知メール（新規登録・更新時、パスワードリセット以外）
$genreLabels = ['men' => 'デリヘル', 'women' => '女風', 'men_same' => '男性同士', 'women_same' => '女性同士', 'este' => 'デリエステ'];
$genreLabel = $genreLabels[$genderMode] ?? $genderMode;
$isNew = !$existing;
$adminSubject = $isNew
    ? "【YobuHo】新規店舗登録: {$shopName}"
    : "【YobuHo】店舗情報更新: {$shopName}";
$adminBody = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
    . '<h2 style="color:#333;">' . ($isNew ? '🏪 新規店舗登録' : '🏪 店舗情報更新') . '</h2>'
    . '<table style="border-collapse:collapse;width:100%;font-size:14px;">'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:100px;">店舗名</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($shopName) . '</td></tr>'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">メール</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($email) . '</td></tr>'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">ジャンル</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($genreLabel) . '</td></tr>'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">URL</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($shopUrl ?: '未入力') . '</td></tr>'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">TEL</td><td style="padding:8px;border-bottom:1px solid #eee;">' . htmlspecialchars($shopTel ?: '未入力') . '</td></tr>'
    . '<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">届出確認書</td><td style="padding:8px;border-bottom:1px solid #eee;">' . ($docUrl ? 'あり' : 'なし') . '</td></tr>'
    . '<tr><td style="padding:8px;color:#888;">登録日時</td><td style="padding:8px;">' . $now . ' UTC</td></tr>'
    . '</table>'
    . '<div style="margin-top:20px;text-align:center;">'
    . '<a href="https://yobuho.com/admin.html" style="display:inline-block;padding:12px 30px;background:#e67e22;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">管理画面で確認する</a>'
    . '</div>'
    . '</div>';

sendTransactionalMail('hotel@yobuho.com', $adminSubject, $adminBody);

echo json_encode(['success' => true, 'shop' => $shop]);
?>
