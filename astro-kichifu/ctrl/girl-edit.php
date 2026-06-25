<?php
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
require_once __DIR__ . '/_deploy.php';
$admin = require_login();
$shop  = current_shop_id();
$id    = (int)($_GET['id'] ?? 0);

// ---- マスタ ----
$cats = db()->prepare('SELECT id, name FROM girl_categories WHERE shop_id=? ORDER BY sort, id');
$cats->execute([$shop]);
$cats = $cats->fetchAll();

$tags = db()->prepare('SELECT id, name FROM girl_image_tags WHERE shop_id=? AND is_active=1 ORDER BY sort, id');
$tags->execute([$shop]);
$tags = $tags->fetchAll();

$opts = db()->prepare('SELECT id, name, is_basic FROM girl_options WHERE shop_id=? ORDER BY is_basic DESC, sort, id');
$opts->execute([$shop]);
$opts = $opts->fetchAll();

$profs = db()->prepare('SELECT id, name, type FROM girl_profiles WHERE shop_id=? ORDER BY sort, id');
$profs->execute([$shop]);
$profs = $profs->fetchAll();
$profOpts = [];
if ($profs) {
    $po = db()->query('SELECT girl_profile_id, label FROM girl_profile_options ORDER BY sort, id');
    foreach ($po->fetchAll() as $r) $profOpts[(int)$r['girl_profile_id']][] = $r['label'];
}

$FLAGS = ['is_newgirl' => '新人', 'is_trial' => '体験入店', 'is_tel' => '電話', 'is_inbound' => 'インバウンド', 'is_genderless' => 'ジェンダーレス'];
$allShops = shops_list();  // 掲載店舗チェック用（☑アドミ立川/☑吉祥寺）

// ---- 保存 ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $ni = fn(string $k) => ($_POST[$k] ?? '') === '' ? null : (int)$_POST[$k];
    $name = trim((string)($_POST['name'] ?? ''));
    if ($name === '') { flash('err', '名前は必須です。'); }
    else {
        $fields = [
            'shop_id'          => $shop,
            'girl_category_id' => $ni('girl_category_id'),
            'name'             => $name,
            'age'              => $ni('age'),
            'height'           => $ni('height'),
            'bust'             => $ni('bust'),
            'cup'              => trim((string)($_POST['cup'] ?? '')),
            'waist'            => $ni('waist'),
            'hip'              => $ni('hip'),
            'in_date'          => ($_POST['in_date'] ?? '') ?: null,
            'catch_copy'       => trim((string)($_POST['catch_copy'] ?? '')),
            'external_url'     => trim((string)($_POST['external_url'] ?? '')),
            'comment'          => trim((string)($_POST['comment'] ?? '')),
            'shop_comment'     => trim((string)($_POST['shop_comment'] ?? '')),
        ];
        foreach ($FLAGS as $f => $_) $fields[$f] = isset($_POST[$f]) ? 1 : 0;

        db()->beginTransaction();
        try {
            if ($id) {
                $own = db()->prepare('SELECT id FROM girls WHERE id=? AND shop_id=?');
                $own->execute([$id, $shop]);
                if (!$own->fetchColumn()) throw new RuntimeException('not found');
                $set = implode(', ', array_map(fn($k) => "$k=:$k", array_keys($fields)));
                db()->prepare("UPDATE girls SET $set WHERE id=:id")->execute($fields + ['id' => $id]);
            } else {
                $maxSort = db()->prepare('SELECT COALESCE(MAX(sort),0)+1 FROM girls WHERE shop_id=?');
                $maxSort->execute([$shop]);
                $fields['sort'] = (int)$maxSort->fetchColumn();
                $cols = implode(',', array_keys($fields));
                $ph   = implode(',', array_map(fn($k) => ":$k", array_keys($fields)));
                db()->prepare("INSERT INTO girls ($cols) VALUES ($ph)")->execute($fields);
                $id = (int)db()->lastInsertId();
            }

            // 掲載店舗（girl_shops）。チェックされた店舗のみ
            db()->prepare('DELETE FROM girl_shops WHERE girl_id=?')->execute([$id]);
            $insShop = db()->prepare('INSERT INTO girl_shops (girl_id, shop_id) VALUES (?,?)');
            foreach ((array)($_POST['shops'] ?? []) as $sid) $insShop->execute([$id, (int)$sid]);

            // 特徴タグ
            db()->prepare('DELETE FROM girl_image_tag_links WHERE girl_id=?')->execute([$id]);
            $insTag = db()->prepare('INSERT INTO girl_image_tag_links (girl_id, girl_image_tag_id) VALUES (?,?)');
            foreach ((array)($_POST['tags'] ?? []) as $tid) $insTag->execute([$id, (int)$tid]);

            // オプション
            db()->prepare('DELETE FROM girl_option_links WHERE girl_id=?')->execute([$id]);
            $ins = db()->prepare('INSERT INTO girl_option_links (girl_id, girl_option_id) VALUES (?,?)');
            foreach ((array)($_POST['options'] ?? []) as $oid) $ins->execute([$id, (int)$oid]);

            // プロフィール回答（upsert）— is_display もまとめて更新
            $up = db()->prepare(
                'INSERT INTO girl_profile_values (girl_id, girl_profile_id, value, is_display)
                 VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE value=VALUES(value), is_display=VALUES(is_display)'
            );
            $profileDisplay = (array)($_POST['profile_display'] ?? []);
            foreach ((array)($_POST['profile'] ?? []) as $pid => $val) {
                $disp = isset($profileDisplay[$pid]) ? 1 : 0;
                $up->execute([$id, (int)$pid, trim((string)$val), $disp]);
            }

            // 画像アップロード（複数）
            if (!empty($_FILES['images']['name'][0])) {
                $sortBase = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM girl_images WHERE girl_id=?');
                $sortBase->execute([$id]);
                $s      = (int)$sortBase->fetchColumn();
                $insImg = db()->prepare('INSERT INTO girl_images (girl_id, path, sort) VALUES (?,?,?)');
                $files  = $_FILES['images'];
                for ($i = 0; $i < count($files['name']); $i++) {
                    if (($files['error'][$i] ?? 4) !== UPLOAD_ERR_OK) continue;
                    $one = ['name' => $files['name'][$i], 'type' => $files['type'][$i],
                            'tmp_name' => $files['tmp_name'][$i], 'error' => $files['error'][$i], 'size' => $files['size'][$i]];
                    $path = save_upload($one, 'girls/' . $shop);
                    if ($path) $insImg->execute([$id, $path, $s++]);
                }
            }

            db()->commit();

            // サイト自動リビルド
            trigger_deploy();

            flash('ok', '保存しました。サイトを更新中です（約1〜2分後に反映）。');
            redirect('girl-edit.php?id=' . $id);
        } catch (Throwable $e) {
            db()->rollBack();
            flash('err', '保存に失敗しました。');
        }
    }
}

// ---- 読込（編集） ----
$g = ['name'=>'','age'=>'','height'=>'','bust'=>'','cup'=>'','waist'=>'','hip'=>'','in_date'=>'','catch_copy'=>'','external_url'=>'','comment'=>'','shop_comment'=>'','is_display'=>1,'girl_category_id'=>(int)($_GET['cat'] ?? 0)];
foreach ($FLAGS as $f => $_) $g[$f] = 0;
$images = []; $linkedTags = []; $linkedOpts = []; $profVals = []; $profDisplay = [];
$linkedShops = array_map('intval', array_column($allShops, 'id')); // 新規はデフォルト全店チェック
if ($id) {
    $st = db()->prepare('SELECT * FROM girls WHERE id=? AND shop_id=?');
    $st->execute([$id, $shop]);
    $g = $st->fetch();
    if (!$g) { flash('err', '対象が見つかりません。'); redirect('girls.php'); }
    $im = db()->prepare('SELECT id, path FROM girl_images WHERE girl_id=? ORDER BY sort, id');
    $im->execute([$id]); $images = $im->fetchAll();
    $lt = db()->prepare('SELECT girl_image_tag_id FROM girl_image_tag_links WHERE girl_id=?');
    $lt->execute([$id]); $linkedTags = array_map('intval', array_column($lt->fetchAll(), 'girl_image_tag_id'));
    $lo = db()->prepare('SELECT girl_option_id FROM girl_option_links WHERE girl_id=?');
    $lo->execute([$id]); $linkedOpts = array_map('intval', array_column($lo->fetchAll(), 'girl_option_id'));
    $ls = db()->prepare('SELECT shop_id FROM girl_shops WHERE girl_id=?');
    $ls->execute([$id]); $linkedShops = array_map('intval', array_column($ls->fetchAll(), 'shop_id'));
    $pv = db()->prepare('SELECT girl_profile_id, value, is_display FROM girl_profile_values WHERE girl_id=?');
    $pv->execute([$id]);
    foreach ($pv->fetchAll() as $r) {
        $profVals[(int)$r['girl_profile_id']]    = $r['value'];
        $profDisplay[(int)$r['girl_profile_id']] = (int)$r['is_display'];
    }
}

layout_header($id ? '女性を編集' : '女性を登録', 'girls.php');
?>
<div class="page-head">
  <h1><?= $id ? '女性を編集' : '女性を登録' ?></h1>
  <a class="btn" href="/ctrl/girls.php">← 一覧へ</a>
</div>

<form method="post" enctype="multipart/form-data" class="form-grid" style="max-width:880px">
  <?= csrf_field() ?>

  <div class="card card-pad form-grid">
    <div class="row2">
      <div class="field"><label>名前 *</label><input type="text" name="name" value="<?= h($g['name']) ?>" required></div>
      <div class="field"><label>年齢</label><input type="number" name="age" value="<?= h($g['age']) ?>" min="18" max="99"></div>
    </div>
    <div class="row2">
      <div class="field"><label>カテゴリー</label>
        <select name="girl_category_id">
          <option value="">未選択</option>
          <?php foreach ($cats as $c): ?><option value="<?= (int)$c['id'] ?>" <?= (int)$g['girl_category_id'] === (int)$c['id'] ? 'selected' : '' ?>><?= h($c['name']) ?></option><?php endforeach; ?>
        </select>
      </div>
      <div class="field"><label>入店日</label><input type="date" name="in_date" value="<?= h($g['in_date']) ?>"></div>
    </div>
    <div class="field"><label>キャッチコピー</label><input type="text" name="catch_copy" value="<?= h($g['catch_copy']) ?>" placeholder="清楚系スレンダー美少女 など"></div>
    <div class="field"><label>外部サイトURL <span class="muted" style="font-weight:400;font-size:12px">（ranking-deli等のプロフィールURL）</span></label><input type="url" name="external_url" value="<?= h($g['external_url'] ?? '') ?>" placeholder="https://ranking-deli.jp/..."></div>
  </div>

  <div class="card card-pad form-grid">
    <strong>スリーサイズ</strong>
    <div class="row2">
      <div class="field"><label>身長 (T)</label><input type="number" name="height" value="<?= h($g['height']) ?>"></div>
      <div class="field"><label>バスト (B)</label><input type="number" name="bust" value="<?= h($g['bust']) ?>"></div>
    </div>
    <div class="row2">
      <div class="field"><label>カップ</label><input type="text" name="cup" value="<?= h($g['cup']) ?>" placeholder="E" maxlength="3"></div>
      <div class="field"><label>ウエスト (W)</label><input type="number" name="waist" value="<?= h($g['waist']) ?>"></div>
    </div>
    <div class="field" style="max-width:50%"><label>ヒップ (H)</label><input type="number" name="hip" value="<?= h($g['hip']) ?>"></div>
  </div>

  <div class="card card-pad">
    <strong>属性</strong>
    <div class="checks" style="margin-top:10px">
      <?php foreach ($FLAGS as $f => $lbl): ?>
        <label class="check"><input type="checkbox" name="<?= $f ?>" <?= (int)$g[$f] ? 'checked' : '' ?>> <?= h($lbl) ?></label>
      <?php endforeach; ?>
      <span style="margin-left:auto;display:flex;gap:12px;align-items:center">
        <span class="muted" style="font-size:12px">掲載店舗:</span>
        <?php foreach ($allShops as $s): ?>
          <label class="check" style="color:var(--primary)"><input type="checkbox" name="shops[]" value="<?= (int)$s['id'] ?>" <?= in_array((int)$s['id'], $linkedShops, true) ? 'checked' : '' ?>> <?= h($s['name']) ?>（<?= h($s['area']) ?>）</label>
        <?php endforeach; ?>
      </span>
    </div>
  </div>

  <?php if ($tags): ?>
  <div class="card card-pad">
    <strong>特徴タグ <span class="muted" style="font-weight:400;font-size:12px">（可愛い系・清楚 など。4つ程度がおすすめ）</span></strong>
    <div class="checks" style="margin-top:10px">
      <?php foreach ($tags as $t): ?>
        <label class="check"><input type="checkbox" name="tags[]" value="<?= (int)$t['id'] ?>" <?= in_array((int)$t['id'], $linkedTags, true) ? 'checked' : '' ?>> <?= h($t['name']) ?></label>
      <?php endforeach; ?>
    </div>
  </div>
  <?php endif; ?>

  <?php if ($opts): ?>
  <div class="card card-pad">
    <strong>プレイ項目 <span class="muted" style="font-weight:400;font-size:12px">（基本プレイ・オプションプレイ）</span></strong>
    <div class="checks" style="margin-top:10px">
      <?php foreach ($opts as $o): ?>
        <label class="check"><input type="checkbox" name="options[]" value="<?= (int)$o['id'] ?>" <?= in_array((int)$o['id'], $linkedOpts, true) ? 'checked' : '' ?>>
          <?= h($o['name']) ?><?= (int)$o['is_basic'] ? ' <span class="muted">(基本)</span>' : '' ?></label>
      <?php endforeach; ?>
    </div>
  </div>
  <?php endif; ?>

  <?php if ($profs): ?>
  <div class="card card-pad form-grid">
    <strong>女の子に質問（プロフィール）</strong>
    <p class="muted" style="margin:0 0 8px;font-size:12px">「表示」のチェックを外すとサイトに表示されません。空欄の項目はサイトに出ません</p>
    <?php foreach ($profs as $p):
      $pid  = (int)$p['id'];
      $val  = $profVals[$pid] ?? '';
      $disp = $profDisplay[$pid] ?? 1;
    ?>
      <div class="field" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
        <div>
          <label><?= h($p['name']) ?></label>
          <?php if ($p['type'] === 'list' && !empty($profOpts[$pid])): ?>
            <select name="profile[<?= $pid ?>]">
              <option value="">未選択</option>
              <?php foreach ($profOpts[$pid] as $lab): ?><option <?= $val === $lab ? 'selected' : '' ?>><?= h($lab) ?></option><?php endforeach; ?>
            </select>
          <?php else: ?>
            <input type="text" name="profile[<?= $pid ?>]" value="<?= h($val) ?>">
          <?php endif; ?>
        </div>
        <label class="check" style="padding-bottom:10px;white-space:nowrap">
          <input type="checkbox" name="profile_display[<?= $pid ?>]" <?= $disp ? 'checked' : '' ?>> 表示
        </label>
      </div>
    <?php endforeach; ?>
  </div>
  <?php endif; ?>

  <div class="card card-pad form-grid">
    <strong>コメント <span class="muted" style="font-weight:400;font-size:12px">（HTMLコード可。装飾カード等のウィジェットを貼り付けるとそのまま表示されます）</span></strong>
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label style="margin-bottom:0">女の子コメント（一言・任意・HTML可）</label>
        <div class="tabs" style="margin-bottom:0">
          <button type="button" class="tab active" id="tab-comment-source" onclick="previewTab('comment','source')">ソース</button>
          <button type="button" class="tab" id="tab-comment-preview" onclick="previewTab('comment','preview')">プレビュー</button>
        </div>
      </div>
      <textarea id="comment-source" name="comment" rows="3" placeholder="本人からの一言。HTMLタグやウィジェットコードもそのまま反映されます"><?= h($g['comment']) ?></textarea>
      <div id="comment-preview" class="body-preview" contenteditable="true" spellcheck="false" style="display:none;min-height:60px"></div>
    </div>
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label style="margin-bottom:0">店舗コメント（紹介文・HTMLウィジェット可）</label>
        <div class="tabs" style="margin-bottom:0">
          <button type="button" class="tab active" id="tab-shop_comment-source" onclick="previewTab('shop_comment','source')">ソース</button>
          <button type="button" class="tab" id="tab-shop_comment-preview" onclick="previewTab('shop_comment','preview')">プレビュー</button>
        </div>
      </div>
      <textarea id="shop_comment-source" name="shop_comment" rows="10" placeholder="お店からの紹介文。HTMLコード（装飾カード等のウィジェット）をそのまま貼り付けられます"><?= h($g['shop_comment']) ?></textarea>
      <div id="shop_comment-preview" class="body-preview" contenteditable="true" spellcheck="false" style="display:none"></div>
    </div>
  </div>
  <script>
  function previewTab(key, mode) {
    var src = document.getElementById(key + '-source');
    var pre = document.getElementById(key + '-preview');
    document.getElementById('tab-' + key + '-source').classList.toggle('active', mode === 'source');
    document.getElementById('tab-' + key + '-preview').classList.toggle('active', mode === 'preview');
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
  // プレビュー編集をリアルタイムでソースへ同期 + 送信時に最新反映
  ['comment', 'shop_comment'].forEach(function (key) {
    var pre = document.getElementById(key + '-preview');
    pre.addEventListener('input', function () {
      document.getElementById(key + '-source').value = pre.innerHTML;
    });
  });
  document.getElementById('comment-source').closest('form').addEventListener('submit', function () {
    ['comment', 'shop_comment'].forEach(function (key) {
      var pre = document.getElementById(key + '-preview');
      if (pre.style.display !== 'none') document.getElementById(key + '-source').value = pre.innerHTML;
    });
  });
  </script>

  <div class="card card-pad">
    <strong>画像</strong>
    <?php if ($images): ?>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:12px 0">
        <?php foreach ($images as $im): ?>
          <div style="position:relative" data-img="<?= (int)$im['id'] ?>">
            <img src="<?= h(asset_url($im['path'])) ?>" style="width:90px;height:120px;object-fit:cover;border-radius:8px">
            <button type="button" class="btn btn-sm btn-danger" data-del-img="<?= (int)$im['id'] ?>" style="position:absolute;top:4px;right:4px;padding:2px 7px">✕</button>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
    <div class="field">
      <label>画像を追加（複数選択可・自動でWebP縮小）</label>
      <input type="file" name="images[]" accept="image/*" multiple>
    </div>
  </div>

  <div class="form-actions">
    <button class="btn btn-primary" type="submit">保存する</button>
    <a class="btn" href="/ctrl/girls.php">キャンセル</a>
  </div>
</form>

<script>
const CSRF = '<?= h(csrf_token()) ?>';
document.querySelectorAll('[data-del-img]').forEach(b => b.addEventListener('click', async () => {
  if (!confirm('この画像を削除しますか？')) return;
  const fd = new FormData(); fd.append('_csrf', CSRF); fd.append('action', 'delete-image'); fd.append('image_id', b.dataset.delImg);
  const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
  if ((await r.json()).ok) b.closest('[data-img]').remove();
}));
</script>
<?php layout_footer(); ?>
