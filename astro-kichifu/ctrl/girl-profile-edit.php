<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();
$id    = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name = trim((string)($_POST['name'] ?? ''));
    $type = ($_POST['type'] ?? 'text') === 'list' ? 'list' : 'text';
    if ($name === '') {
        flash('err', '質問文は必須です。');
    } else {
        db()->beginTransaction();
        try {
            $own = db()->prepare('SELECT id FROM girl_profiles WHERE id=? AND shop_id=?');
            $own->execute([$id, $shop]);
            if (!$own->fetchColumn()) throw new RuntimeException('not found');
            $dup = db()->prepare('SELECT id FROM girl_profiles WHERE shop_id=? AND name=? AND id!=?');
            $dup->execute([$shop, $name, $id]);
            if ($dup->fetchColumn()) throw new RuntimeException('dup');
            db()->prepare('UPDATE girl_profiles SET name=?, type=? WHERE id=? AND shop_id=?')
                ->execute([$name, $type, $id, $shop]);

            // 選択肢（list型のみ。textに変えたら選択肢は削除）
            db()->prepare('DELETE FROM girl_profile_options WHERE girl_profile_id=?')->execute([$id]);
            if ($type === 'list') {
                $ins = db()->prepare('INSERT INTO girl_profile_options (girl_profile_id, label, sort) VALUES (?,?,?)');
                $s = 0;
                foreach (preg_split('/\r\n|\r|\n/', (string)($_POST['options'] ?? '')) as $line) {
                    $line = trim($line);
                    if ($line !== '') $ins->execute([$id, $line, $s++]);
                }
            }
            db()->commit();
            flash('ok', '保存しました。');
            redirect('girl-profiles.php');
        } catch (Throwable $e) {
            db()->rollBack();
            flash('err', $e->getMessage() === 'dup' ? '同じ質問が既にあります。' : '保存に失敗しました。');
        }
    }
}

$st = db()->prepare('SELECT * FROM girl_profiles WHERE id=? AND shop_id=?');
$st->execute([$id, $shop]);
$p = $st->fetch();
if (!$p) { flash('err', '対象が見つかりません。'); redirect('girl-profiles.php'); }

$opt = db()->prepare('SELECT label FROM girl_profile_options WHERE girl_profile_id=? ORDER BY sort, id');
$opt->execute([$id]);
$optLines = implode("\n", array_column($opt->fetchAll(), 'label'));

layout_header('質問項目を編集', 'girl-profiles.php');
?>
<div class="page-head"><h1>質問項目を編集</h1><a class="btn" href="/ctrl/girl-profiles.php">← 一覧へ</a></div>
<form method="post" class="card card-pad form-grid" style="max-width:600px">
  <?= csrf_field() ?>
  <div class="field"><label>質問文 *</label><input type="text" name="name" value="<?= h($p['name']) ?>" required maxlength="160"></div>
  <div class="field">
    <label>種別</label>
    <select name="type" id="typeSel">
      <option value="text" <?= $p['type'] === 'text' ? 'selected' : '' ?>>単一行テキスト（自由入力）</option>
      <option value="list" <?= $p['type'] === 'list' ? 'selected' : '' ?>>リスト選択（選択肢から選ぶ）</option>
    </select>
  </div>
  <div class="field" id="optWrap" style="<?= $p['type'] === 'list' ? '' : 'display:none' ?>">
    <label>選択肢（1行に1つ）</label>
    <textarea name="options" rows="6" placeholder="A型&#10;B型&#10;O型&#10;AB型&#10;秘密"><?= h($optLines) ?></textarea>
    <p class="muted" style="font-size:12px;margin:4px 0 0">リスト選択のとき、女性の編集画面でここの選択肢から選びます。</p>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/girl-profiles.php">キャンセル</a></div>
</form>
<script>
  document.getElementById('typeSel').addEventListener('change', function () {
    document.getElementById('optWrap').style.display = this.value === 'list' ? '' : 'none';
  });
</script>
<?php layout_footer(); ?>
