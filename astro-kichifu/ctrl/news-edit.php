<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$shop = current_shop_id();
$id = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $title = trim((string)($_POST['title'] ?? ''));
    if ($title === '') { flash('err', 'タイトルは必須です。'); }
    else {
        // 既存読み込み（画像差し替え判定用）
        $cur = null;
        if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $cur = $s->fetch(); }
        $thumb = $cur['thumb'] ?? '';
        if (!empty($_POST['remove_thumb'])) { delete_upload($thumb); $thumb = ''; }
        if (($_FILES['thumb']['error'] ?? 4) === UPLOAD_ERR_OK) {
            $new = save_upload($_FILES['thumb'], 'news/' . $shop);
            if ($new) { delete_upload($thumb); $thumb = $new; }
        }
        $data = [
            'shop_id' => $shop, 'title' => $title,
            'body' => (string)($_POST['body'] ?? ''),
            'thumb' => $thumb,
            'posted_at' => ($_POST['posted_at'] ?? '') ? str_replace('T', ' ', $_POST['posted_at']) . ':00' : null,
            // サムネのリンク先: ガールズ優先 → URL → どちらも無ければ無し
            'link_girl_id' => ($_POST['link_girl_id'] ?? '') !== '' ? (int)$_POST['link_girl_id'] : null,
            'link_url' => trim((string)($_POST['link_url'] ?? '')) !== '' ? trim((string)$_POST['link_url']) : null,
            'is_display' => isset($_POST['is_display']) ? 1 : 0,
        ];
        try {
            if ($id && $cur) {
                $set = implode(',', array_map(fn($k) => "$k=:$k", array_keys($data)));
                db()->prepare("UPDATE news SET $set WHERE id=:id")->execute($data + ['id' => $id]);
            } else {
                $cols = implode(',', array_keys($data)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($data)));
                db()->prepare("INSERT INTO news ($cols) VALUES ($ph)")->execute($data);
                $id = (int)db()->lastInsertId();
            }
            flash('ok', '保存しました。');
            redirect('news.php');
        } catch (Throwable $e) { flash('err', '保存に失敗しました。'); }
    }
}

$n = ['title' => '', 'body' => '', 'thumb' => '', 'posted_at' => date('Y-m-d\TH:i'), 'is_display' => 1, 'link_girl_id' => null, 'link_url' => ''];
if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $n = $s->fetch(); if (!$n) { flash('err', '対象が見つかりません。'); redirect('news.php'); } $n['posted_at'] = $n['posted_at'] ? str_replace(' ', 'T', substr($n['posted_at'], 0, 16)) : ''; }

// サムネのリンク先プルダウン用: この店舗に掲載中の在籍（共有プール girl_shops）。
// 並びは schedules.php と同じ「出勤頻度が高い順 → 入店が新しい順 → id降順」
$gs = db()->prepare(
    'SELECT g.id, g.name,
            (SELECT COUNT(*) FROM schedules s WHERE s.girl_id = g.id AND s.shop_id = :shop AND s.status = \'work\') AS wc
       FROM girls g
      WHERE EXISTS (SELECT 1 FROM girl_shops gs WHERE gs.girl_id = g.id AND gs.shop_id = :shop2) AND g.is_display = 1
      ORDER BY wc DESC, g.in_date DESC, g.id DESC'
);
$gs->execute(['shop' => $shop, 'shop2' => $shop]);
$girlOpts = $gs->fetchAll();

layout_header($id ? 'お知らせを編集' : 'お知らせを作成', 'news.php');
?>
<div class="page-head"><h1><?= $id ? 'お知らせを編集' : 'お知らせを作成' ?></h1><a class="btn" href="/ctrl/news.php">← 一覧へ</a></div>
<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:760px">
  <?= csrf_field() ?>
  <div class="card card-pad form-grid">
    <div class="field"><label>タイトル *</label><input type="text" name="title" value="<?= h($n['title']) ?>" required></div>
    <div class="field"><label>日付</label><input type="datetime-local" name="posted_at" value="<?= h($n['posted_at']) ?>"></div>
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label style="margin-bottom:0">本文（HTMLソース可）</label>
        <div class="tabs" style="margin-bottom:0">
          <button type="button" class="tab active" id="tab-source" onclick="bodyTab('source')">ソース</button>
          <button type="button" class="tab" id="tab-preview" onclick="bodyTab('preview')">プレビュー</button>
        </div>
      </div>
      <textarea id="body-source" name="body" rows="10"><?= h($n['body']) ?></textarea>
      <div id="body-preview" class="body-preview" style="display:none"></div>
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">HTMLタグでそのまま投稿できます（admi2888の編集HTML・フォント色・画像・リンク等を貼り付け可）。改行は &lt;br&gt; を使ってください。</p>
    </div>
    <script>
    function bodyTab(mode) {
      var src = document.getElementById('body-source');
      var pre = document.getElementById('body-preview');
      document.getElementById('tab-source').classList.toggle('active', mode === 'source');
      document.getElementById('tab-preview').classList.toggle('active', mode === 'preview');
      if (mode === 'preview') {
        pre.innerHTML = src.value;
        src.style.display = 'none';
        pre.style.display = 'block';
      } else {
        src.style.display = 'block';
        pre.style.display = 'none';
      }
    }
    </script>
    <div class="field">
      <label>サムネイル画像</label>
      <?php if ($n['thumb']): ?>
        <div style="margin-bottom:8px"><img src="<?= h($n['thumb']) ?>" style="width:120px;border-radius:8px"><br>
          <label class="check" style="margin-top:6px"><input type="checkbox" name="remove_thumb"> 画像を削除</label></div>
      <?php endif; ?>
      <input type="file" name="thumb" accept="image/*">
    </div>
    <div class="field">
      <label>サムネのリンク先（任意）</label>
      <select name="link_girl_id">
        <option value="">— ガールズを選択 —</option>
        <?php foreach ($girlOpts as $g): ?>
          <option value="<?= (int)$g['id'] ?>" <?= (int)($n['link_girl_id'] ?? 0) === (int)$g['id'] ? 'selected' : '' ?>><?= h($g['name']) ?></option>
        <?php endforeach; ?>
      </select>
      <input type="url" name="link_url" value="<?= h($n['link_url'] ?? '') ?>" placeholder="https://…（ガールズ未選択時のみ使用）" style="margin-top:6px">
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">サムネをクリックした時の遷移先。<strong>ガールズ選択が優先</strong>、未選択ならURL、どちらも無ければリンク無し（同じタブで開きます）。</p>
    </div>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$n['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/news.php">キャンセル</a></div>
</form>
<?php layout_footer(); ?>
