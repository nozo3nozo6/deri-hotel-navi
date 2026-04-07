<?php
/**
 * contract.php — 印刷可能な契約書HTML生成
 * Usage: contract.php?id={request_id}
 * Auth: shop session (own contract) or admin session
 */
require_once __DIR__ . '/db.php';

define('SHOP_SESSION_TIMEOUT', 86400);
session_set_cookie_params([
    'lifetime' => SHOP_SESSION_TIMEOUT, 'path' => '/', 'domain' => 'yobuho.com',
    'secure' => true, 'httponly' => true, 'samesite' => 'Strict'
]);
session_start();

$pdo = DB::conn();
$requestId = (int)($_GET['id'] ?? 0);
if (!$requestId) { http_response_code(400); echo 'Invalid ID'; exit; }

// データ取得
$stmt = $pdo->prepare('
    SELECT r.*, cp.name AS plan_name, cp.price AS plan_price,
           s.shop_name, s.email, s.gender_mode, s.shop_url
    FROM shop_plan_requests r
    JOIN contract_plans cp ON r.plan_id = cp.id
    JOIN shops s ON r.shop_id = s.id
    WHERE r.id = ?
');
$stmt->execute([$requestId]);
$req = $stmt->fetch();
if (!$req) { http_response_code(404); echo 'Not found'; exit; }

// 認証: shop sessionの自分 or admin session
$isShop = !empty($_SESSION['shop_id']) && $_SESSION['shop_id'] === $req['shop_id'];
$isAdmin = !empty($_SESSION['user_id']);
if (!$isShop && !$isAdmin) { http_response_code(403); echo 'Forbidden'; exit; }

$areas = $req['requested_areas'] ? json_decode($req['requested_areas'], true) : [];
$areasText = count($areas) ? implode('、', $areas) : '未指定';
$genreLabels = ['men' => 'デリヘル', 'women' => '女性用風俗', 'men_same' => '男性同士', 'women_same' => '女性同士', 'este' => 'デリエステ'];
$genre = $genreLabels[$req['gender_mode']] ?? $req['gender_mode'];
$statusLabels = ['pending' => '審査中', 'approved' => '承認済み', 'rejected' => '却下', 'cancelled' => 'キャンセル'];
$statusText = $statusLabels[$req['status']] ?? $req['status'];
$contractDate = $req['reviewed_at'] ? date('Y年n月j日', strtotime($req['reviewed_at'])) : '—';
$agreedDate = date('Y年n月j日 H:i', strtotime($req['agreed_at']));
$createdDate = date('Y年n月j日 H:i', strtotime($req['created_at']));

header('Content-Type: text/html; charset=UTF-8');
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>広告掲載契約書 #<?= $requestId ?> | YobuHo</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif; color:#1a1a1a; background:#f5f3f0; padding:20px; font-size:14px; line-height:1.8; }
  .contract { max-width:800px; margin:0 auto; background:#fff; padding:48px 56px; border:1px solid #ddd; box-shadow:0 2px 12px rgba(0,0,0,0.06); }
  .header { text-align:center; margin-bottom:40px; }
  .header h1 { font-size:24px; font-weight:700; letter-spacing:0.1em; border-bottom:2px solid #1a1a1a; display:inline-block; padding-bottom:8px; }
  .header .sub { font-size:12px; color:#888; margin-top:8px; }
  .section { margin-bottom:28px; }
  .section-title { font-size:13px; font-weight:700; color:#b5627a; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #f0e8e0; }
  table.info { width:100%; border-collapse:collapse; margin-bottom:4px; }
  table.info td { padding:8px 12px; border-bottom:1px solid #f0ede8; font-size:13px; }
  table.info td.label { width:140px; color:#888; font-weight:500; }
  table.info td.val { font-weight:600; }
  .terms { font-size:11px; color:#444; line-height:1.9; padding:16px; background:#faf8f6; border:1px solid #ece8e0; border-radius:6px; max-height:300px; overflow-y:auto; }
  .terms h3 { font-size:12px; margin:12px 0 4px; }
  .terms p, .terms li { margin-bottom:4px; }
  .terms ol { padding-left:20px; }
  .agreement { margin-top:20px; padding:16px; background:#f0f8f0; border:1px solid #c8e0c8; border-radius:6px; }
  .agreement .check { color:#28a745; font-weight:700; }
  .stamp { text-align:right; margin-top:32px; font-size:12px; color:#888; }
  .footer { text-align:center; margin-top:32px; padding-top:16px; border-top:1px solid #ece8e0; font-size:11px; color:#999; }
  .no-print { margin:20px auto; max-width:800px; text-align:center; }
  .no-print .btn { display:inline-block; padding:12px 32px; background:#b5627a; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; }
  .no-print .btn:hover { background:#9a4e66; }
  .no-print .hint { font-size:12px; color:#888; margin-top:8px; }
  .status-badge { display:inline-block; padding:2px 10px; border-radius:4px; font-size:11px; font-weight:700; }
  .status-approved { background:#e8f5e9; color:#2e7d32; }
  .status-pending { background:#fff3e0; color:#e65100; }
  .status-rejected { background:#fce4ec; color:#c62828; }
  @media print {
    body { background:#fff; padding:0; }
    .contract { box-shadow:none; border:none; padding:24px; }
    .no-print { display:none !important; }
    @page { margin:1.5cm; }
  }
  @media (max-width:640px) {
    .contract { padding:24px 20px; }
    table.info td.label { width:100px; }
  }
</style>
</head>
<body>

<div class="no-print">
  <button class="btn" onclick="window.print()">🖨 この契約書を印刷 / PDF保存</button>
  <div class="hint">ブラウザの印刷機能（Ctrl+P / Cmd+P）でPDFとして保存できます</div>
</div>

<div class="contract">
  <div class="header">
    <h1>広告掲載契約書</h1>
    <div class="sub">Contract No. PR-<?= str_pad($requestId, 6, '0', STR_PAD_LEFT) ?></div>
  </div>

  <div class="section">
    <div class="section-title">契約者情報</div>
    <table class="info">
      <tr><td class="label">店舗名</td><td class="val"><?= htmlspecialchars($req['shop_name']) ?></td></tr>
      <tr><td class="label">メールアドレス</td><td class="val"><?= htmlspecialchars($req['email']) ?></td></tr>
      <tr><td class="label">ジャンル</td><td class="val"><?= htmlspecialchars($genre) ?></td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">契約内容</div>
    <table class="info">
      <tr><td class="label">プラン</td><td class="val"><?= htmlspecialchars($req['plan_name']) ?></td></tr>
      <tr><td class="label">月額料金</td><td class="val">&yen;<?= number_format($req['plan_price']) ?>/月（税込）</td></tr>
      <tr><td class="label">掲載エリア</td><td class="val"><?= htmlspecialchars($areasText) ?></td></tr>
      <tr><td class="label">申込日</td><td class="val"><?= $createdDate ?></td></tr>
      <tr><td class="label">契約日</td><td class="val"><?= $contractDate ?></td></tr>
      <tr>
        <td class="label">ステータス</td>
        <td class="val">
          <span class="status-badge status-<?= htmlspecialchars($req['status']) ?>"><?= htmlspecialchars($statusText) ?></span>
        </td>
      </tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">広告掲載規約</div>
    <div class="terms">
      <h3>第1条（目的）</h3>
      <p>本規約は、YobuHo（以下「当サービス」）が提供する広告掲載サービスの利用条件を定めるものです。</p>

      <h3>第2条（掲載内容）</h3>
      <p>掲載店舗（以下「甲」）は、当サービスの定めるフォーマットに従い、店舗情報・ホテル口コミ情報を掲載できます。掲載内容は甲の責任において正確かつ最新の情報を提供するものとします。</p>

      <h3>第3条（契約期間）</h3>
      <p>契約期間は申込承認日から1ヶ月間とし、更新手続きにより延長できます。甲または当サービスから解約の申し出がない限り、自動更新されるものとします。</p>

      <h3>第4条（料金・支払い）</h3>
      <ol>
        <li>甲は、選択したプランに応じた月額料金を当サービスの指定する方法で支払うものとします。</li>
        <li>支払い済みの料金は、理由の如何を問わず返金いたしません。</li>
      </ol>

      <h3>第5条（禁止事項）</h3>
      <ol>
        <li>虚偽の情報を掲載すること</li>
        <li>法令に違反する内容を掲載すること</li>
        <li>他の掲載店舗を誹謗中傷すること</li>
        <li>当サービスの運営を妨害すること</li>
      </ol>

      <h3>第6条（掲載停止・解約）</h3>
      <p>当サービスは、甲が本規約に違反した場合、事前の通知なく掲載を停止できるものとします。この場合、料金の返金は行いません。</p>

      <h3>第7条（免責）</h3>
      <p>当サービスは、広告掲載による甲の売上・集客効果を保証するものではありません。当サービスの障害・メンテナンスによる一時的な非表示について、当サービスは責任を負いません。</p>

      <h3>第8条（規約の変更）</h3>
      <p>当サービスは、必要に応じて本規約を変更できるものとします。変更後の規約は、当サービス上での告知をもって効力を生じるものとします。</p>

      <h3>第9条（準拠法・管轄）</h3>
      <p>本規約は日本法に準拠し、紛争が生じた場合は東京地方裁判所を第一審の専属的合意管轄裁判所とします。</p>
    </div>
  </div>

  <div class="section">
    <div class="agreement">
      <span class="check">&#10003;</span> 上記の広告掲載規約に同意しました
      <div style="font-size:12px;color:#666;margin-top:4px;">同意日時: <?= $agreedDate ?></div>
    </div>
  </div>

  <div class="stamp">
    <div>発行: YobuHo 運営事務局</div>
    <div>発行日: <?= date('Y年n月j日') ?></div>
  </div>

  <div class="footer">
    <div>YobuHo — 呼べるホテル検索ポータル</div>
    <div>https://yobuho.com | hotel@yobuho.com</div>
  </div>
</div>

</body>
</html>
