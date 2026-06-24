<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// ---- 追加 ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name    = trim((string)($_POST['name'] ?? ''));
    $isBasic = isset($_POST['is_basic']) ? 1 : 0;
    if ($name === '') {
        flash('err', '項目名を入力してください。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_options WHERE shop_id=? AND name=?');
        $dup->execute([$shop, $name]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ名前の項目が既にあります。');
        } else {
            $ms = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM girl_options WHERE shop_id=?');
            $ms->execute([$shop]);
            db()->prepare('INSERT INTO girl_options (shop_id,name,is_basic,sort) VALUES (?,?,?,?)')
                ->execute([$shop, $name, $isBasic, (int)$ms->fetchColumn()]);
            flash('ok', '「' . $name . '」を追加しました。');
        }
    }
    redirect('girl-options.php');
}

$rows = db()->prepare('SELECT id, name, is_basic FROM girl_options WHERE shop_id=? ORDER BY sort, id');
$rows->execute([$shop]);
$rows = $rows->fetchAll();

layout_header('女性オプション', 'girl-options.php');
?>
<div class="page-head">
  <h1>女性オプション（プレイ項目） <span class="muted" style="font-size:14px">（<?= count($rows) ?>件）</span></h1>
</div>
<p class="muted" style="margin-top:-8px">女の子に設定するプレイ項目。「基本プレイ」ONでサイトの「基本プレイ」、OFFで「オプションプレイ」に表示。女性の編集画面で各項目を選択できます。</p>

<form method="post" class="toolbar" style="margin-bottom:18px">
  <?= csrf_field() ?>
  <div class="search"><input type="text" name="name" placeholder="項目名（例: 生フェラ）" required maxlength="80"></div>
  <label class="check"><input type="checkbox" name="is_basic"> 基本プレイ</label>
  <button class="btn btn-primary" type="submit">＋ 追加</button>
  <span class="muted" style="margin-left:auto">行をドラッグで並べ替え</span>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>項目名</th><th style="width:110px">基本プレイ</th><th style="width:90px">操作</th></tr></thead>
    <tbody data-sortable id="rows">
      <?php foreach ($rows as $r): ?>
        <tr draggable="true" data-id="<?= (int)$r['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><strong><?= h($r['name']) ?></strong></td>
          <td><button type="button" class="toggle <?= (int)$r['is_basic'] ? 'on' : '' ?>" data-toggle-id="<?= (int)$r['id'] ?>" aria-label="基本プレイ切替"></button></td>
          <td>
            <a class="btn btn-sm" href="/ctrl/girl-option-edit.php?id=<?= (int)$r['id'] ?>">✏️</a>
            <button type="button" class="btn btn-sm btn-danger" data-del-id="<?= (int)$r['id'] ?>" data-name="<?= h($r['name']) ?>">🗑</button>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="4" class="muted" style="text-align:center;padding:30px">項目がありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>

<script>window.__CSRF = '<?= h(csrf_token()) ?>'; window.__TABLE = 'girl_options';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
