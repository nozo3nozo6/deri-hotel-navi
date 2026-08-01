<?php
// ==========================================================================
// order-masters.php — 料金マスタ（コース / 指名 / オプション / ドライバー）
//   オーダー表の料金自動計算の元。金額はオーダー確定時にスナップショットされる
//   （後からここを変えても過去のオーダーは変わらない）。
// ==========================================================================
require_once __DIR__ . '/_orders-lib.php';
$admin = require_login();
$shop  = current_shop_id();
orders_ensure_tables();

$TABS = [
    'courses'     => ['order_courses',          'コース',     true],   // [table, label, minutes列あり]
    'nominations' => ['order_nomination_types', '指名',       false],
    'options'     => ['order_option_items',     'オプション', false],
    'drivers'     => ['order_drivers',          'ドライバー', false],
];
$tab = isset($TABS[$_GET['tab'] ?? '']) ? $_GET['tab'] : 'courses';
[$table, $tabLabel, $hasMin] = $TABS[$tab];
$hasPrice = $tab !== 'drivers';

// ---- POST（追加 / 更新 / 有効切替）----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $act = $_POST['act'] ?? '';
    $id  = (int)($_POST['id'] ?? 0);

    if ($act === 'add' || $act === 'update') {
        $name = trim((string)($_POST['name'] ?? ''));
        if ($name === '') {
            flash('err', '名前を入力してください。');
        } else {
            $min   = max(0, (int)($_POST['minutes'] ?? 0));
            $price = max(0, (int)preg_replace('/\D+/', '', (string)($_POST['price'] ?? '0')));
            $back  = max(0, (int)preg_replace('/\D+/', '', (string)($_POST['back_amount'] ?? '0')));
            if ($act === 'add') {
                $ms = db()->prepare("SELECT COALESCE(MAX(sort),-1)+1 FROM {$table} WHERE shop_id=?");
                $ms->execute([$shop]);
                $sort = (int)$ms->fetchColumn();
                if ($hasPrice) {
                    $cols = $hasMin ? '(shop_id,name,minutes,price,back_amount,sort)' : '(shop_id,name,price,back_amount,sort)';
                    $vals = $hasMin ? [$shop, $name, $min, $price, $back, $sort] : [$shop, $name, $price, $back, $sort];
                } else {
                    $cols = '(shop_id,name,sort)';
                    $vals = [$shop, $name, $sort];
                }
                db()->prepare("INSERT INTO {$table} {$cols} VALUES (" . rtrim(str_repeat('?,', count($vals)), ',') . ')')->execute($vals);
                flash('ok', '「' . $name . '」を追加しました。');
            } else {
                if ($hasPrice) {
                    $set  = $hasMin ? 'name=?, minutes=?, price=?, back_amount=?' : 'name=?, price=?, back_amount=?';
                    $vals = $hasMin ? [$name, $min, $price, $back, $id, $shop] : [$name, $price, $back, $id, $shop];
                } else {
                    $set  = 'name=?';
                    $vals = [$name, $id, $shop];
                }
                db()->prepare("UPDATE {$table} SET {$set} WHERE id=? AND shop_id=?")->execute($vals);
                flash('ok', '保存しました。');
            }
        }
    } elseif ($act === 'toggle') {
        db()->prepare("UPDATE {$table} SET is_active = 1 - is_active WHERE id=? AND shop_id=?")->execute([$id, $shop]);
        flash('ok', '表示状態を切り替えました。');
    }
    redirect('order-masters.php?tab=' . $tab);
}

$rows = db()->prepare("SELECT * FROM {$table} WHERE shop_id=? ORDER BY is_active DESC, sort, id");
$rows->execute([$shop]);
$rows = $rows->fetchAll(PDO::FETCH_ASSOC);

layout_header('料金マスタ', 'order-masters.php');
?>
<div class="page-head">
  <h1>⚙️ 料金マスタ</h1>
</div>
<p class="muted" style="margin-top:-8px">オーダー入力時の選択肢と自動計算の元データです。金額を変えても<strong>過去のオーダーの金額は変わりません</strong>（確定時の金額を保存しているため）。</p>

<div class="toolbar" style="gap:6px;margin-bottom:16px">
  <?php foreach ($TABS as $k => [, $l]): ?>
    <a class="btn btn-sm <?= $k === $tab ? 'btn-primary' : '' ?>" href="?tab=<?= $k ?>"><?= h($l) ?></a>
  <?php endforeach; ?>
</div>

<form method="post" class="toolbar card card-pad" style="margin-bottom:18px;flex-wrap:wrap;gap:8px">
  <?= csrf_field() ?>
  <input type="hidden" name="act" value="add">
  <input type="text" name="name" placeholder="<?= h($tabLabel) ?>名" required maxlength="80" style="min-width:160px">
  <?php if ($hasMin): ?><input type="number" name="minutes" placeholder="分" min="0" step="5" style="width:80px"><?php endif; ?>
  <?php if ($hasPrice): ?>
    <input type="text" name="price" placeholder="料金" inputmode="numeric" style="width:100px">
    <input type="text" name="back_amount" placeholder="キャストバック" inputmode="numeric" style="width:120px">
  <?php endif; ?>
  <button class="btn btn-primary" type="submit">＋ 追加</button>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead><tr>
      <th>名前</th>
      <?php if ($hasMin): ?><th style="width:80px">分</th><?php endif; ?>
      <?php if ($hasPrice): ?><th style="width:110px">料金</th><th style="width:130px">バック</th><?php endif; ?>
      <th style="width:170px">操作</th>
    </tr></thead>
    <tbody>
      <?php foreach ($rows as $r): $off = !(int)$r['is_active']; ?>
        <tr style="<?= $off ? 'opacity:.45' : '' ?>">
          <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="act" value="update"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
          <td><input type="text" name="name" value="<?= h($r['name']) ?>" maxlength="80" style="width:100%"></td>
          <?php if ($hasMin): ?><td><input type="number" name="minutes" value="<?= (int)$r['minutes'] ?>" min="0" step="5" style="width:70px"></td><?php endif; ?>
          <?php if ($hasPrice): ?>
            <td><input type="text" name="price" value="<?= (int)$r['price'] ?>" inputmode="numeric" style="width:90px"></td>
            <td><input type="text" name="back_amount" value="<?= (int)$r['back_amount'] ?>" inputmode="numeric" style="width:100px"></td>
          <?php endif; ?>
          <td>
            <button class="btn btn-sm" type="submit">保存</button>
            <button class="btn btn-sm" type="submit" name="act" value="toggle"><?= $off ? '有効に戻す' : '無効化' ?></button>
          </td>
          </form>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="9" class="muted" style="text-align:center;padding:30px">まだ登録がありません。上のフォームから追加してください。</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<p class="muted" style="margin-top:10px">※ 削除は用意していません（過去オーダーが参照するため）。使わなくなったら「無効化」してください。</p>
<?php layout_footer(); ?>
