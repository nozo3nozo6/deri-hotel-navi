<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_login();
$admin    = current_admin();
$isOwner  = empty($admin['shop_id']);                 // 全店ownerのみ複数店舗を選べる（staffは自店固定）
$shop     = current_shop_id();
$allShops = shops_list();
$allShopIds = array_map(fn($s) => (int)$s['id'], $allShops);
$id = (int)($_GET['id'] ?? 0);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $title = trim((string)($_POST['title'] ?? ''));
    // 掲載店舗: owner=チェックされた店舗 / staff=自店固定
    $targetShops = $isOwner
        ? array_values(array_intersect(array_map('intval', (array)($_POST['shops'] ?? [])), $allShopIds))
        : [(int)$admin['shop_id']];
    if ($title === '') { flash('err', 'タイトルは必須です。'); }
    elseif (!$targetShops) { flash('err', '掲載店舗を1つ以上選択してください。'); }
    else {
        // 編集の起点（現在店舗の行）。画像差し替え判定 + リンクキー継承に使う
        $cur = null;
        if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $cur = $s->fetch(); }

        // リンクキー(source_id): 両店の行を1つのお知らせとして紐づける。
        // 取込(admi2888)は数値ID、手動投稿は synthetic 'm…'（ミラー対象外・チェックで制御）。
        $linkKey = $cur['source_id'] ?? null;
        if ($linkKey === null || $linkKey === '') $linkKey = 'm' . bin2hex(random_bytes(6));

        // サムネ（全店で共有。物理は /uploads/news/ のみ削除可。女の子画像 /uploads/girls/ は共有実体のため消さない）
        $thumb = $cur['thumb'] ?? '';
        $isNewsOwn = fn($p) => is_string($p) && str_starts_with($p, '/uploads/news/');
        if (!empty($_POST['remove_thumb'])) { if ($isNewsOwn($thumb)) delete_upload($thumb); $thumb = ''; }
        $fromGirl = trim((string)($_POST['thumb_from_girl'] ?? ''));
        if ($fromGirl !== '' && str_starts_with($fromGirl, '/uploads/girls/')) {
            if ($isNewsOwn($thumb) && $thumb !== $fromGirl) delete_upload($thumb);
            $thumb = $fromGirl;
        }
        if (($_FILES['thumb']['error'] ?? 4) === UPLOAD_ERR_OK) {
            $new = save_upload($_FILES['thumb'], 'news/' . $shop);
            if ($new) { if ($isNewsOwn($thumb)) delete_upload($thumb); $thumb = $new; }
        }
        $fields = [
            'title' => $title,
            'body' => (string)($_POST['body'] ?? ''),
            'thumb' => $thumb,
            'posted_at' => ($_POST['posted_at'] ?? '') ? str_replace('T', ' ', $_POST['posted_at']) . ':00' : null,
            // サムネのリンク先: ガールズ優先 → URL → どちらも無ければ無し
            'link_girl_id' => ($_POST['link_girl_id'] ?? '') !== '' ? (int)$_POST['link_girl_id'] : null,
            'link_url' => trim((string)($_POST['link_url'] ?? '')) !== '' ? trim((string)$_POST['link_url']) : null,
            'is_display' => isset($_POST['is_display']) ? 1 : 0,
            'source_id' => $linkKey,
        ];
        try {
            db()->beginTransaction();
            foreach ($allShopIds as $sid) {
                // この店舗の既存行（linkKey一致 or 編集起点の行=旧source_id NULL）
                $ex = db()->prepare('SELECT id FROM news WHERE shop_id=? AND source_id=? LIMIT 1');
                $ex->execute([$sid, $linkKey]);
                $exId = (int)($ex->fetchColumn() ?: 0);
                if (!$exId && $id && $sid === $shop && $cur) $exId = $id;

                if (in_array($sid, $targetShops, true)) {
                    $row = $fields + ['shop_id' => $sid];
                    if ($exId) {
                        $set = implode(',', array_map(fn($k) => "$k=:$k", array_keys($row)));
                        db()->prepare("UPDATE news SET $set WHERE id=:id")->execute($row + ['id' => $exId]);
                    } else {
                        $cols = implode(',', array_keys($row)); $ph = implode(',', array_map(fn($k) => ":$k", array_keys($row)));
                        db()->prepare("INSERT INTO news ($cols) VALUES ($ph)")->execute($row);
                    }
                } elseif ($exId) {
                    // チェックを外した店舗 → その店舗の行を削除（物理サムネは他店共有のため消さない）
                    db()->prepare('DELETE FROM news WHERE id=?')->execute([$exId]);
                }
            }
            db()->commit();
            flash('ok', '保存しました。');
            redirect('news.php');
        } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); flash('err', '保存に失敗しました。'); }
    }
}

$n = ['title' => '', 'body' => '', 'thumb' => '', 'posted_at' => date('Y-m-d\TH:i'), 'is_display' => 1, 'link_girl_id' => null, 'link_url' => '', 'source_id' => null];
if ($id) { $s = db()->prepare('SELECT * FROM news WHERE id=? AND shop_id=?'); $s->execute([$id, $shop]); $n = $s->fetch(); if (!$n) { flash('err', '対象が見つかりません。'); redirect('news.php'); } $n['posted_at'] = $n['posted_at'] ? str_replace(' ', 'T', substr($n['posted_at'], 0, 16)) : ''; }

// 掲載店舗チェックの初期状態: 新規=全店ON / 編集=同 source_id を持つ店舗（旧source_id NULLの手動投稿は現在店舗のみ）
if (!$id) {
    $checkedShops = $allShopIds;
} elseif (!empty($n['source_id'])) {
    $cs = db()->prepare('SELECT DISTINCT shop_id FROM news WHERE source_id=?');
    $cs->execute([$n['source_id']]);
    $checkedShops = array_map('intval', array_column($cs->fetchAll(), 'shop_id'));
} else {
    $checkedShops = [(int)$n['shop_id']];
}

// サムネのリンク先プルダウン用: この店舗に掲載中の在籍（共有プール girl_shops）。
// 並びは schedules.php と同じ「出勤頻度が高い順 → 入店が新しい順 → id降順」
$gs = db()->prepare(
    'SELECT g.id, g.name, g.in_date,
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
        <div class="tabs" style="margin-bottom:0;align-items:center">
          <button type="button" class="tab active" id="tab-source" onclick="bodyTab('source')">ソース</button>
          <button type="button" class="tab" id="tab-preview" onclick="bodyTab('preview')">プレビュー</button>
          <button type="button" class="btn btn-sm" id="ins-img-btn" style="display:none;margin-left:8px">🖼 画像を挿入</button>
          <input type="file" id="ins-img-file" accept="image/*" style="display:none">
        </div>
      </div>
      <textarea id="body-source" name="body" rows="10"><?= h($n['body']) ?></textarea>
      <div id="body-preview" class="body-preview" contenteditable="true" spellcheck="false" style="display:none"></div>
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">HTMLタグでそのまま投稿できます（admi2888の編集HTML・フォント色・画像・リンク等を貼り付け可）。改行は &lt;br&gt; を使ってください。<br><strong>プレビュー</strong>タブでは表示を見ながら直接編集でき、変更はソースに自動反映されます。</p>
    </div>
    <script>
    function bodyTab(mode) {
      var src = document.getElementById('body-source');
      var pre = document.getElementById('body-preview');
      document.getElementById('tab-source').classList.toggle('active', mode === 'source');
      document.getElementById('tab-preview').classList.toggle('active', mode === 'preview');
      document.getElementById('ins-img-btn').style.display = (mode === 'preview') ? '' : 'none';  // 画像挿入はプレビュー時のみ
      if (mode === 'preview') {
        pre.innerHTML = src.value;            // ソース → プレビュー
        src.style.display = 'none';
        pre.style.display = 'block';
      } else {
        src.value = pre.innerHTML;            // プレビューでの編集 → ソースへ反映
        src.style.display = 'block';
        pre.style.display = 'none';
      }
    }
    (function () {
      var pre = document.getElementById('body-preview');
      var src = document.getElementById('body-source');
      // プレビュー編集をリアルタイムでソース(textarea)へ同期
      pre.addEventListener('input', function () { src.value = pre.innerHTML; });
      // 送信時、プレビュー表示中なら最新の編集内容を確実に反映
      src.closest('form').addEventListener('submit', function () {
        if (pre.style.display !== 'none') src.value = pre.innerHTML;
      });

      // カーソル位置を保存（画像をその位置に挿入するため）
      var savedRange = null;
      function saveRange() {
        var s = window.getSelection();
        if (s.rangeCount && pre.contains(s.anchorNode)) savedRange = s.getRangeAt(0);
      }
      pre.addEventListener('keyup', saveRange);
      pre.addEventListener('mouseup', saveRange);
      pre.addEventListener('blur', saveRange);

      // 画像挿入: ファイル選択 → アップロード → カーソル位置に <img> を挿入
      var insBtn = document.getElementById('ins-img-btn');
      var insFile = document.getElementById('ins-img-file');
      insBtn.addEventListener('click', function () { insFile.click(); });
      insFile.addEventListener('change', async function () {
        if (!this.files[0]) return;
        var fd = new FormData();
        fd.append('_csrf', '<?= h(csrf_token()) ?>'); fd.append('image', this.files[0]);
        insBtn.disabled = true; insBtn.textContent = '⏳ アップロード中…';
        try {
          var r = await fetch('/ctrl/upload-image.php', { method: 'POST', body: fd });
          var j = await r.json();
          if (j.ok && j.path) {
            pre.focus();
            var s = window.getSelection();
            if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }  // 保存したカーソル位置に復元
            document.execCommand('insertHTML', false, '<img src="https://admi2888.com' + j.path + '" style="max-width:100%;height:auto">');
            src.value = pre.innerHTML;   // ソース同期
            saveRange();
          } else { alert('画像のアップロードに失敗しました'); }
        } catch (e) { alert('画像のアップロードに失敗しました'); }
        insBtn.disabled = false; insBtn.textContent = '🖼 画像を挿入'; this.value = '';
      });
    })();
    </script>
    <!-- 女の子のお知らせ: 選択→登録画像クリックでサムネ＆リンク先(プロフ)を同時設定 -->
    <div class="field">
      <label>① 女の子を選ぶ（お知らせの主役）</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <span class="muted" style="font-size:13px">並び替え</span>
        <select id="girl-sort" style="width:auto;flex:none">
          <option value="freq">出勤頻度が高い順</option>
          <option value="indate">入店が新しい順</option>
        </select>
      </div>
      <select name="link_girl_id" id="girl-picker">
        <option value="">— 女の子を選択（手動の場合は未選択）—</option>
        <?php foreach ($girlOpts as $g): ?>
          <option value="<?= (int)$g['id'] ?>" data-wc="<?= (int)$g['wc'] ?>" data-indate="<?= h(str_replace('-', '', substr((string)($g['in_date'] ?? ''), 0, 10))) ?>" <?= (int)($n['link_girl_id'] ?? 0) === (int)$g['id'] ? 'selected' : '' ?>><?= h($g['name']) ?></option>
        <?php endforeach; ?>
      </select>
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">選ぶとリンク先が自動でその子のプロフページになります。</p>
    </div>
    <div class="field" id="girl-img-field" style="display:none">
      <label>② 登録画像からサムネを選ぶ</label>
      <div id="girl-images" class="girl-img-pick"></div>
      <input type="hidden" name="thumb_from_girl" id="thumb_from_girl" value="">
    </div>
    <div class="field">
      <label>サムネイル画像（現在）</label>
      <div id="current-thumb-box" style="margin-bottom:8px;<?= $n['thumb'] ? '' : 'display:none' ?>">
        <img id="current-thumb-img" src="<?= $n['thumb'] ? h(asset_url($n['thumb'])) : '' ?>" style="width:120px;border-radius:8px">
        <div id="thumb-set-note" style="font-size:.8125rem;color:#2e9e5b;margin-top:4px;display:none">✓ この画像をサムネに設定しました（保存で確定します）</div>
        <label class="check" style="margin-top:6px"><input type="checkbox" name="remove_thumb"> 画像を削除</label>
      </div>
      <input type="file" name="thumb" accept="image/*">
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">女の子以外のお知らせは、ここで画像を手動アップロード。上で女の子の画像を選んだ場合はそちらが優先されます。</p>
    </div>
    <div class="field">
      <label>手動リンク先URL（女の子を選ばない場合）</label>
      <input type="url" name="link_url" value="<?= h($n['link_url'] ?? '') ?>" placeholder="https://…">
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888"><strong>女の子選択が優先</strong>、未選択ならこのURL、どちらも無ければリンク無し（同じタブで開きます）。</p>
    </div>
    <?php if ($isOwner): ?>
    <div class="field">
      <label>掲載店舗</label>
      <div class="checks">
        <?php foreach ($allShops as $s): ?>
          <label class="check" style="color:var(--primary)"><input type="checkbox" name="shops[]" value="<?= (int)$s['id'] ?>" <?= in_array((int)$s['id'], $checkedShops, true) ? 'checked' : '' ?>> <?= h($s['name']) ?>（<?= h($s['area']) ?>）</label>
        <?php endforeach; ?>
      </div>
      <p class="hint" style="margin-top:6px;font-size:.8125rem;color:#888">チェックした店舗のサイトに掲載されます（デフォルトは両方ON）。外すとその店舗からは削除されます。</p>
    </div>
    <?php endif; ?>
    <label class="check"><input type="checkbox" name="is_display" <?= (int)$n['is_display'] ? 'checked' : '' ?>> サイトに表示</label>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit">保存する</button><a class="btn" href="/ctrl/news.php">キャンセル</a></div>
</form>
<script>
(function () {
  var ASSET = 'https://admi2888.com';
  var CSRF = '<?= h(csrf_token()) ?>';
  var picker = document.getElementById('girl-picker');
  var wrap = document.getElementById('girl-images');
  var field = document.getElementById('girl-img-field');
  var hidden = document.getElementById('thumb_from_girl');

  async function loadGirlImages(gid) {
    wrap.innerHTML = ''; hidden.value = '';
    if (!gid) { field.style.display = 'none'; return; }
    field.style.display = '';
    wrap.innerHTML = '<span class="muted" style="font-size:13px">読み込み中…</span>';
    var fd = new FormData();
    fd.append('_csrf', CSRF); fd.append('action', 'girl-images'); fd.append('girl_id', gid);
    try {
      var r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
      var j = await r.json();
      wrap.innerHTML = '';
      if (!j.ok || !j.images || !j.images.length) {
        wrap.innerHTML = '<span class="muted" style="font-size:13px">この子の登録画像がありません（手動アップロードしてください）</span>';
        return;
      }
      j.images.forEach(function (im) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'girl-img-thumb';
        var img = document.createElement('img');
        img.src = ASSET + im.path; img.alt = '';
        b.appendChild(img);
        b.addEventListener('click', function () {
          wrap.querySelectorAll('.girl-img-thumb').forEach(function (x) { x.classList.remove('sel'); });
          b.classList.add('sel');
          hidden.value = im.path;   // 選んだ画像を news サムネに（保存時 thumb_from_girl で反映）
          // 「現在のサムネ」プレビューを即更新（セットされたと一目で分かるように）
          var box = document.getElementById('current-thumb-box');
          var cimg = document.getElementById('current-thumb-img');
          var note = document.getElementById('thumb-set-note');
          if (cimg) cimg.src = ASSET + im.path;
          if (box) box.style.display = '';
          if (note) note.style.display = '';
          var rm = document.querySelector('input[name=remove_thumb]'); if (rm) rm.checked = false;
        });
        wrap.appendChild(b);
      });
    } catch (e) {
      wrap.innerHTML = '<span class="muted" style="font-size:13px">読み込みに失敗しました</span>';
    }
  }
  picker.addEventListener('change', function () { loadGirlImages(this.value); });
  if (picker.value) loadGirlImages(picker.value);   // 編集時、選択済みなら画像表示

  // 並び替え（出勤頻度が高い順 / 入店が新しい順）— option を JS で並べ替え
  var sortSel = document.getElementById('girl-sort');
  function sortGirls(mode) {
    var ph = picker.options[0];   // 「— 女の子を選択 —」プレースホルダは先頭固定
    var opts = Array.prototype.slice.call(picker.options).filter(function (o) { return o.value; });
    opts.sort(function (a, b) {
      var inB = parseInt(b.dataset.indate || '0', 10), inA = parseInt(a.dataset.indate || '0', 10);
      if (mode === 'indate') return inB - inA;                       // 入店が新しい順
      var d = (parseInt(b.dataset.wc || '0', 10)) - (parseInt(a.dataset.wc || '0', 10));
      return d !== 0 ? d : inB - inA;                                // 出勤頻度が高い順 → 入店が新しい順
    });
    picker.innerHTML = '';
    picker.appendChild(ph);
    opts.forEach(function (o) { picker.appendChild(o); });           // selected 状態は option に残るので選択維持
  }
  sortSel.addEventListener('change', function () { sortGirls(this.value); });
})();
</script>
<?php layout_footer(); ?>
