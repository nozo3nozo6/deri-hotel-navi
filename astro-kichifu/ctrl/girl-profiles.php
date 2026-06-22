<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// ---- 追加（質問文＋種別。list の選択肢は編集画面で） ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name = trim((string)($_POST['name'] ?? ''));
    $type = ($_POST['type'] ?? 'text') === 'list' ? 'list' : 'text';
    if ($name === '') {
        flash('err', '質問文を入力してください。');
    } else {
        $dup = db()->prepare('SELECT id FROM girl_profiles WHERE shop_id=? AND name=?');
        $dup->execute([$shop, $name]);
        if ($dup->fetchColumn()) {
            flash('err', '同じ質問が既にあります。');
        } else {
            $ms = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM girl_profiles WHERE shop_id=?');
            $ms->execute([$shop]);
            db()->prepare("INSERT INTO girl_profiles (shop_id,name,type,lang,sort) VALUES (?,?,?,'ja',?)")
                ->execute([$shop, $name, $type, (int)$ms->fetchColumn()]);
            $newId = (int)db()->lastInsertId();
            flash('ok', '「' . $name . '」を追加しました。' . ($type === 'list' ? '続けて選択肢を登録してください。' : ''));
            redirect($type === 'list' ? 'girl-profile-edit.php?id=' . $newId : 'girl-profiles.php');
        }
    }
    redirect('girl-profiles.php');
}

$rows = db()->prepare('SELECT id, name, type FROM girl_profiles WHERE shop_id=? ORDER BY sort, id');
$rows->execute([$shop]);
$rows = $rows->fetchAll();

layout_header('女性プロフィール', 'girl-profiles.php');
?>
<div class="page-head">
  <h1>女性プロフィール（質問項目） <span class="muted" style="font-size:14px">（<?= count($rows) ?>件）</span></h1>
</div>
<p class="muted" style="margin-top:-8px">「女の子に質問」の質問項目。種別が「リスト選択」の場合は編集画面で選択肢を登録できます。女性の編集画面で各質問に回答を入力します。</p>

<form method="post" class="toolbar" style="margin-bottom:18px">
  <?= csrf_field() ?>
  <div class="search" style="flex:1"><input type="text" name="name" placeholder="質問文（例: 好きな体位は？）" required maxlength="160"></div>
  <select name="type" style="max-width:160px">
    <option value="text">単一行テキスト</option>
    <option value="list">リスト選択</option>
  </select>
  <button class="btn btn-primary" type="submit">＋ 追加</button>
  <span class="muted" style="margin-left:auto">行をドラッグで並べ替え</span>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>質問文</th><th style="width:130px">種別</th><th style="width:90px">操作</th></tr></thead>
    <tbody data-sortable id="rows">
      <?php foreach ($rows as $r): ?>
        <tr draggable="true" data-id="<?= (int)$r['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><strong><?= h($r['name']) ?></strong></td>
          <td class="muted"><?= $r['type'] === 'list' ? 'リスト選択' : '単一行テキスト' ?></td>
          <td>
            <a class="btn btn-sm" href="/ctrl/girl-profile-edit.php?id=<?= (int)$r['id'] ?>">✏️</a>
            <button type="button" class="btn btn-sm btn-danger" data-del-id="<?= (int)$r['id'] ?>" data-name="<?= h($r['name']) ?>">🗑</button>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="4" class="muted" style="text-align:center;padding:30px">質問項目がありません</td></tr><?php endif; ?>
    </tbody>
  </table>
</div>

<script>window.__CSRF = '<?= h(csrf_token()) ?>'; window.__TABLE = 'girl_profiles';</script>
<script src="/ctrl/list.js?v=1"></script>
<?php layout_footer(); ?>
