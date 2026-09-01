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

$opts = db()->prepare('SELECT id, name, play_tier FROM girl_options WHERE shop_id=? ORDER BY play_tier, sort, id');
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

// is_trial は列名こそ「体験入店」だが、公開サイトでは待ち合わせアイコン(flag-machiawase)として
// 出している。CTRLの表記を実際の表示に合わせる（店長指定 2026-08-25）
$FLAGS = ['is_newgirl' => '新人', 'is_trial' => '待ち合わせ', 'is_tel' => '電話', 'is_inbound' => 'インバウンド', 'is_genderless' => 'ジェンダーレス'];
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

            $imgErrs = [];   // 登録できなかった画像の理由（黙って捨てない）

            // 画像アップロード（複数）。
            //   ★ 以前は保存できなかった画像を黙って捨てていたため、
            //     「登録したのに前のまま」に見えていた（店長指摘 2026-08-22）。理由を出す。
            if (!empty($_FILES['images']['name'][0])) {
                $sortBase = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM girl_images WHERE girl_id=?');
                $sortBase->execute([$id]);
                $s      = (int)$sortBase->fetchColumn();
                $insImg = db()->prepare('INSERT INTO girl_images (girl_id, path, sort) VALUES (?,?,?)');
                $files  = $_FILES['images'];
                for ($i = 0; $i < count($files['name']); $i++) {
                    $fname = (string)($files['name'][$i] ?? '');
                    if ($fname === '') continue;
                    $err = (int)($files['error'][$i] ?? UPLOAD_ERR_NO_FILE);
                    if ($err !== UPLOAD_ERR_OK) {
                        if ($err !== UPLOAD_ERR_NO_FILE) {
                            $imgErrs[] = $fname . '（受け取れませんでした・サイズ超過などの可能性）';
                        }
                        continue;
                    }
                    $one = ['name' => $fname, 'type' => $files['type'][$i],
                            'tmp_name' => $files['tmp_name'][$i], 'error' => $err, 'size' => $files['size'][$i]];
                    if (($one['size'] ?? 0) > 20 * 1024 * 1024) { $imgErrs[] = $fname . '（20MBを超えています）'; continue; }
                    $info = @getimagesize($one['tmp_name']);
                    $mime = $info['mime'] ?? '';
                    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
                        $imgErrs[] = $fname . '（この形式は登録できません。iPhoneのHEICなどはJPEGで保存し直してください）';
                        continue;
                    }
                    $path = save_upload($one, 'girls/' . $shop);
                    if ($path) $insImg->execute([$id, $path, $s++]);
                    else $imgErrs[] = $fname . '（画像を変換できませんでした）';
                }
            }

            // 媒体別プロフィール（キャッチ/コメント）: 媒体の文字数制限に合わせた専用値。
            //   空欄=行削除（共通のキャッチ/コメントを自動使用）。girl_media_profiles に upsert。
            $mpUp  = db()->prepare('INSERT INTO girl_media_profiles (girl_id, media, field, value) VALUES (?,?,?,?)
                                    ON DUPLICATE KEY UPDATE value=VALUES(value)');
            $mpDel = db()->prepare('DELETE FROM girl_media_profiles WHERE girl_id=? AND media=? AND field=?');
            foreach ((array)($_POST['media_profile'] ?? []) as $mkey => $fields2) {
                if (!in_array($mkey, ['fujoho', 'ekichika', 'heaven', 'fuzoku', 'deli'], true)) continue;
                foreach ((array)$fields2 as $fkey => $val) {
                    if (!in_array($fkey, ['catch', 'comment'], true)) continue;
                    $val = trim((string)$val);
                    if ($val === '') { $mpDel->execute([$id, $mkey, $fkey]); }
                    else { $mpUp->execute([$id, $mkey, $fkey, $val]); }
                }
            }

            // 媒体用1枚目（レインボー枠版）: オフィシャルには出さず、媒体（情報局/駅ちか/ヘブン/風じゃ/デリじゃ）の
            //   メイン写真としてだけ使う。2枚目以降はオフィシャルの画像（girl_images）と共通＝媒体登録パックで配布。
            $curMediaTop = db()->prepare('SELECT media_top_image FROM girls WHERE id=?');
            $curMediaTop->execute([$id]);
            $oldMediaTop = (string)($curMediaTop->fetchColumn() ?: '');
            if (!empty($_POST['media_top_delete']) && $oldMediaTop !== '') {
                db()->prepare('UPDATE girls SET media_top_image=NULL WHERE id=?')->execute([$id]);
                @unlink(UPLOADS_ROOT . $oldMediaTop);
                $oldMediaTop = '';
            }
            if (($_FILES['media_top']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                $mtPath = save_upload($_FILES['media_top'], 'girls/' . $shop);
                if ($mtPath) {
                    db()->prepare('UPDATE girls SET media_top_image=? WHERE id=?')->execute([$mtPath, $id]);
                    if ($oldMediaTop !== '' && $oldMediaTop !== $mtPath) @unlink(UPLOADS_ROOT . $oldMediaTop);
                }
            }

            // 紹介動画（オフィシャルサイトのキャストページ専用。媒体には出さない・店長指定 2026-08-20）。
            //   /uploads/girls/<shop>/video/<girl_id>.mp4 に固定名で保存＝DBに列を足さない
            if (!empty($_POST['video_delete'])) delete_girl_video((int)$shop, (int)$id);
            if (($_FILES['girl_video']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                if (!save_girl_video($_FILES['girl_video'], (int)$shop, (int)$id)) {
                    $videoErr = '動画を保存できませんでした（mp4・60MBまで）。';
                }
            }

            db()->commit();

            // サイト自動リビルド
            trigger_deploy();

            $problems = array_filter(array_merge([$videoErr ?? ''], $imgErrs));
            flash($problems ? 'err' : 'ok',
                  $problems
                    ? '登録できなかったファイルがあります: ' . implode(' / ', $problems) . '（他の内容は保存しました）'
                    : '保存しました。ページをリロードすると即時反映されます。');
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

// 媒体別プロフィール（キャッチ/コメント）読込
$mediaProf = [];   // media => field => value
if ($id) {
    $mp = db()->prepare('SELECT media, field, value FROM girl_media_profiles WHERE girl_id=?');
    $mp->execute([$id]);
    foreach ($mp->fetchAll() as $r) { $mediaProf[$r['media']][$r['field']] = $r['value']; }
}
// 媒体ごとの文字数制限（2026-07-20 実フォーム調査。null=明確な上限なし＝カウンタのみ）
//   風じゃ紹介文=15字（placeholder「15文字以内で入力してください」実測）。デリじゃは紹介文欄なし=PR文のみ。
$MEDIA_PROF_DEF = [
    'fujoho'   => ['label' => '情報局',   'catch' => ['キャッチコピー', 30],  'comment' => ['コメント', null]],
    'ekichika' => ['label' => '駅ちか',   'catch' => ['キャッチコピー', 15],  'comment' => ['コメント', 2000]],
    'heaven'   => ['label' => 'ヘブン',   'catch' => ['キャッチコピー', null], 'comment' => ['コメント/PR', null]],
    'fuzoku'   => ['label' => '風じゃ',   'catch' => ['紹介文', 15],           'comment' => ['PR文', null]],
    'deli'     => ['label' => 'デリじゃ', 'catch' => null,                     'comment' => ['PR文', null]],
];

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
    <div class="field"><label>キャッチコピー</label><input type="text" name="catch_copy" value="<?= h($g['catch_copy']) ?>" placeholder="清楚系スレンダー美少女 など">
      <?php
        // 媒体別に専用文が入っている媒体は、この共通キャッチを編集しても反映されない
        // （同期は「媒体別があればそれ優先、無ければ共通文」）。画面に出ないと
        // 「同期されない」という誤解になるため明示する（2026-07-27 店長指摘）。
        $ovCatch = [];
        foreach ($MEDIA_PROF_DEF as $mk => $md) {
            if (!empty($md['catch']) && trim((string)($mediaProf[$mk]['catch'] ?? '')) !== '') $ovCatch[] = $md['label'];
        }
        if ($ovCatch):
      ?>
      <p class="override-note">⚠️ <strong><?= h(implode('・', $ovCatch)) ?></strong> は<strong>下の「媒体別プロフィール」の専用文が優先</strong>されます。ここを直しても、その媒体には反映されません（変えたい場合は下の該当欄を編集してください）。</p>
      <?php endif; ?>
    </div>
    <div class="field"><label>外部サイトURL <span class="muted" style="font-weight:400;font-size:12px">（ranking-deli等のプロフィールURL）</span></label><input type="url" name="external_url" value="<?= h($g['external_url'] ?? '') ?>" placeholder="https://ranking-deli.jp/..."></div>
  </div>

  <div class="card card-pad">
    <strong>掲載店舗</strong>
    <span class="muted" style="font-weight:400;font-size:12px;margin-left:8px">ONにした店舗のサイトに表示されます（立川だけ／吉祥寺だけ も可）</span>
    <div style="display:flex;flex-wrap:wrap;gap:14px 32px;margin-top:14px">
      <?php foreach ($allShops as $s): ?>
        <label class="shop-toggle" style="gap:10px;cursor:pointer">
          <input type="checkbox" class="shop-toggle-cb" name="shops[]" value="<?= (int)$s['id'] ?>" <?= in_array((int)$s['id'], $linkedShops, true) ? 'checked' : '' ?>>
          <span class="toggle" aria-hidden="true"></span>
          <span style="font-size:14px;font-weight:600;color:var(--text)"><?= h($s['name']) ?><span class="muted" style="font-weight:400">（<?= h($s['area']) ?>）</span></span>
        </label>
      <?php endforeach; ?>
    </div>
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
    <strong>プレイ項目</strong>
    <?php
      // 区分ごとに行を分けて出す（店長要望 2026-08-11）。1列に全部並べると境目が読めない。
      // 見出しに区分名を出すので、項目名のうしろの「(基本)」等は不要
      $optsByTier = [1 => [], 2 => [], 3 => []];
      foreach ($opts as $o) { $t = (int)$o['play_tier']; $optsByTier[isset($optsByTier[$t]) ? $t : 3][] = $o; }
      $tierLabels = [1 => '基本プレイ', 2 => '応用プレイ', 3 => 'オプションプレイ'];
    ?>
    <?php foreach ($tierLabels as $tv => $tlabel): if (!$optsByTier[$tv]) continue; ?>
      <div class="play-group">
        <div class="play-group-label"><?= h($tlabel) ?></div>
        <div class="checks">
          <?php foreach ($optsByTier[$tv] as $o): ?>
            <label class="check"><input type="checkbox" name="options[]" value="<?= (int)$o['id'] ?>" <?= in_array((int)$o['id'], $linkedOpts, true) ? 'checked' : '' ?>>
              <?= h($o['name']) ?></label>
          <?php endforeach; ?>
        </div>
      </div>
    <?php endforeach; ?>
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
      <?php
        $ovCmt = [];
        foreach ($MEDIA_PROF_DEF as $mk => $md) {
            if (!empty($md['comment']) && trim((string)($mediaProf[$mk]['comment'] ?? '')) !== '') $ovCmt[] = $md['label'];
        }
        if ($ovCmt):
      ?>
      <p class="override-note">⚠️ <strong><?= h(implode('・', $ovCmt)) ?></strong> は<strong>下の「媒体別プロフィール」の専用文が優先</strong>されます。ここを直しても、その媒体には反映されません。</p>
      <?php endif; ?>
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

  <div class="card card-pad" style="border:1px solid #99f6e4;background:#f0fdfa">
    <strong>📝 媒体別プロフィール（キャッチ・コメント）</strong>
    <p class="muted" style="margin:6px 0 10px;font-size:.85em">
      媒体ごとの<strong>文字数制限に合わせた専用文</strong>を登録できます。<strong>空欄の媒体は上の共通キャッチ/コメントを自動で使います</strong>（超過分は同期時に自動カット）。<br>
      名前・年齢・サイズ・Q&Aプロフィールは共通項目からそのまま各媒体形式に変換されるため、ここでの入力は不要です。
    </p>
    <?php foreach ($MEDIA_PROF_DEF as $mkey => $md): ?>
      <details style="margin-bottom:8px;background:#fff;border:1px solid #ccfbf1;border-radius:8px;padding:8px 12px" <?= !empty($mediaProf[$mkey]) ? 'open' : '' ?>>
        <summary style="cursor:pointer;font-weight:700;font-size:.9em">
          <?= h($md['label']) ?>用
          <?php if (!empty($mediaProf[$mkey])): ?><span style="color:#0d9488;font-size:.85em;margin-left:6px">✎ 専用文あり</span>
          <?php $pv = trim((string)($mediaProf[$mkey]['catch'] ?? '')); if ($pv !== ''): ?>
            <span class="muted" style="font-weight:400;font-size:.82em;margin-left:6px">「<?= h(mb_substr($pv, 0, 24)) ?><?= mb_strlen($pv) > 24 ? '…' : '' ?>」</span>
          <?php endif; ?>
          <?php else: ?><span style="color:#94a3b8;font-size:.8em;margin-left:6px">共通文を使用</span><?php endif; ?>
        </summary>
        <?php foreach (['catch', 'comment'] as $fkey): if (empty($md[$fkey])) continue; [$flabel, $fmax] = $md[$fkey]; $fval = (string)($mediaProf[$mkey][$fkey] ?? ''); ?>
          <div class="field" style="margin-top:8px">
            <label style="font-size:.85em">
              <?= h($md['label']) ?>用<?= h($flabel) ?><?= $fmax ? "（{$fmax}文字まで）" : '（文字数制限なし）' ?>
              <span class="mp-count" style="color:#94a3b8;font-size:.9em;margin-left:6px"></span>
            </label>
            <?php if ($fkey === 'catch'): ?>
              <input type="text" name="media_profile[<?= $mkey ?>][catch]" value="<?= h($fval) ?>"
                     <?= $fmax ? 'maxlength="' . (int)$fmax . '"' : '' ?> data-mp-max="<?= (int)($fmax ?? 0) ?>"
                     placeholder="空欄=共通キャッチ<?= $fmax ? '（' . $fmax . '文字に自動カット）' : '' ?>を使用">
            <?php else: ?>
              <textarea name="media_profile[<?= $mkey ?>][comment]" rows="3"
                        <?= $fmax ? 'maxlength="' . (int)$fmax . '"' : '' ?> data-mp-max="<?= (int)($fmax ?? 0) ?>"
                        placeholder="空欄=共通コメント<?= $fmax ? '（' . $fmax . '文字に自動カット）' : '' ?>を使用"><?= h($fval) ?></textarea>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </details>
    <?php endforeach; ?>
  </div>
  <script>
  // 媒体別フィールドの残り文字数カウンター
  document.querySelectorAll('[data-mp-max]').forEach(function (el) {
    var max = parseInt(el.getAttribute('data-mp-max'), 10);
    var label = el.closest('.field').querySelector('.mp-count');
    function upd() {
      var len = el.value.length;
      if (max > 0) {
        label.textContent = '（' + len + '/' + max + '文字）';
        label.style.color = len > max ? '#dc2626' : (len > max * 0.9 ? '#d97706' : '#94a3b8');
      } else if (len > 0) {
        label.textContent = '（' + len + '文字）';
      } else {
        label.textContent = '';
      }
    }
    el.addEventListener('input', upd);
    upd();
  });
  </script>

  <div class="card card-pad" style="border:1px solid #c4b5fd;background:#faf5ff">
    <strong>📣 媒体用1枚目（レインボー枠版）</strong>
    <p class="muted" style="margin:6px 0 10px;font-size:.85em">
      媒体（情報局・駅ちか・ヘブン・風じゃ・デリじゃ）の<strong>メイン写真専用</strong>です。オフィシャルサイトには表示されません。<br>
      2枚目以降は下の「オフィシャル画像」の②以降を媒体にもそのまま使います。
      <?php if ($id): ?>→ <a href="girl-media-pack.php?id=<?= (int)$id ?>"><strong>📦 媒体登録用の写真セットを一括ダウンロード</strong></a>（媒体用1枚目＋2枚目以降を番号順のzipで）<?php endif; ?>
    </p>
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <?php if (!empty($g['media_top_image'])):
        // 実寸を表示（媒体へそのまま配信されるため、低解像度なら差し替えを促す）
        $mtAbs = (defined('UPLOADS_ROOT') && is_dir(UPLOADS_ROOT) ? UPLOADS_ROOT : rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . $g['media_top_image'];
        $mtDim = @getimagesize($mtAbs);
        $mtW = $mtDim ? (int)$mtDim[0] : 0; $mtH = $mtDim ? (int)$mtDim[1] : 0;
        $mtLow = $mtW > 0 && $mtW < 480;
      ?>
        <div style="position:relative">
          <img src="<?= h(asset_url($g['media_top_image'])) ?>" style="width:110px;height:147px;object-fit:cover;border-radius:8px;border:3px solid <?= $mtLow ? '#f59e0b' : '#a78bfa' ?>">
          <span style="position:absolute;top:4px;left:4px;background:#7c3aed;color:#fff;border-radius:8px;font-size:.68em;font-weight:700;padding:1px 7px">媒体①</span>
          <?php if ($mtW): ?><span style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,.6);color:#fff;border-radius:6px;font-size:.62em;padding:1px 5px"><?= $mtW ?>×<?= $mtH ?></span><?php endif; ?>
        </div>
      <?php else: ?>
        <div style="width:110px;height:147px;border:2px dashed #c4b5fd;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:.75em;text-align:center">未設定<br>（媒体①は<br>オフィシャル①を使用）</div>
      <?php endif; ?>
      <div class="field" style="flex:1;min-width:220px">
        <label><?= !empty($g['media_top_image']) ? '差し替え' : 'アップロード' ?>（自動でWebP縮小）</label>
        <input type="file" name="media_top" accept="image/*">
        <?php if (!empty($mtLow)): ?>
          <p style="margin:8px 0 0;font-size:.8em;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:6px 8px">
            ⚠ この画像は<strong><?= $mtW ?>×<?= $mtH ?></strong>と低解像度です（媒体から取り込んだプレビュー）。媒体にはこのまま配信されるので、<strong>きれいに見せるなら高解像度のレインボー枠版に差し替え</strong>てください。
          </p>
        <?php endif; ?>
        <?php if (!empty($g['media_top_image'])): ?>
          <label style="display:block;margin-top:8px;font-size:.85em"><input type="checkbox" name="media_top_delete" value="1"> この媒体用1枚目を削除する</label>
        <?php endif; ?>
      </div>
    </div>
  </div>

  <?php
    // 紹介動画。ファイルの有無だけで判断する（DBに列なし）
    $vRel = '/uploads/girls/' . (int)$shop . '/video/' . (int)$id . '.mp4';
    $vAbs = (defined('UPLOADS_ROOT') && is_dir(UPLOADS_ROOT) ? UPLOADS_ROOT : rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . $vRel;
    $hasVideo = $id && is_file($vAbs);
  ?>
  <div class="card card-pad">
    <strong>🎬 紹介動画</strong>
    <p class="muted" style="margin:6px 0 10px;font-size:.85em">
      オフィシャルサイトのキャストページに出ます（写真の<strong>4枚目の枠</strong>が動画になります）。
      <strong>媒体には送りません</strong>。<br>
      mp4・60MBまで。縦向き（3:4 や 9:16）がきれいに収まります。枠より大きい動画は、枠の中をゆっくり動いて全体が見えます。
    </p>
    <?php if (!$id): ?>
      <p class="muted" style="font-size:.85em">※ 先にキャストを保存すると動画をアップロードできます。</p>
    <?php else: ?>
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <?php if ($hasVideo): ?>
        <div style="position:relative">
          <video src="<?= h(asset_url($vRel)) ?>?v=<?= (int)@filemtime($vAbs) ?>" style="width:110px;height:147px;object-fit:cover;border-radius:8px;border:3px solid #0ea5a4;background:#000" muted loop playsinline autoplay></video>
          <span style="position:absolute;top:4px;left:4px;background:#0f766e;color:#fff;border-radius:8px;font-size:.68em;font-weight:700;padding:1px 7px">動画</span>
          <span style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,.6);color:#fff;border-radius:6px;font-size:.62em;padding:1px 5px"><?= number_format(@filesize($vAbs) / 1048576, 1) ?>MB</span>
        </div>
      <?php else: ?>
        <div style="width:110px;height:147px;border:2px dashed #5eead4;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#0d9488;font-size:.75em;text-align:center">未設定<br>（動画なし）</div>
      <?php endif; ?>
      <div class="field" style="flex:1;min-width:220px">
        <label><?= $hasVideo ? '差し替え' : 'アップロード' ?>（mp4）</label>
        <input type="file" name="girl_video" accept="video/mp4,video/quicktime">
        <?php if ($hasVideo): ?>
          <label style="display:block;margin-top:8px;font-size:.85em"><input type="checkbox" name="video_delete" value="1"> この動画を削除する</label>
        <?php endif; ?>
      </div>
    </div>
    <?php endif; ?>
  </div>

  <div class="card card-pad">
    <strong>オフィシャル画像</strong>
    <p class="muted" style="margin:6px 0 0;font-size:.85em">
      <strong>①（1枚目）はオフィシャルサイト専用</strong>のメイン写真です（媒体の1枚目は上のレインボー枠版を使用）。<strong>②以降はオフィシャル・媒体共通</strong>で使います。
    </p>
    <?php if ($images): ?>
      <p class="muted" style="margin:6px 0 0;font-size:.85em">ドラッグで並べ替えできます。左上の番号が表示順（<strong>①がメイン写真</strong>）。</p>
      <div id="img-sort" style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0">
        <?php foreach ($images as $im): ?>
          <div style="position:relative;cursor:grab" data-img="<?= (int)$im['id'] ?>" draggable="true">
            <img src="<?= h(asset_url($im['path'])) ?>" style="width:90px;height:120px;object-fit:cover;border-radius:8px;pointer-events:none">
            <span class="img-order-no" style="position:absolute;top:4px;left:4px;min-width:20px;height:20px;line-height:20px;text-align:center;background:rgba(0,0,0,.7);color:#fff;border-radius:10px;font-size:.78em;font-weight:700;padding:0 4px"></span>
            <button type="button" class="btn btn-sm btn-danger" data-del-img="<?= (int)$im['id'] ?>" style="position:absolute;top:4px;right:4px;padding:2px 7px">✕</button>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
    <div class="field">
      <label>画像を追加（複数選択可・自動でWebP縮小）</label>
      <input type="file" name="images[]" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
      <span class="hint">JPEG / PNG / WebP / GIF（1枚20MBまで）。iPhoneのHEICは登録できないため、JPEGで書き出してください</span>
    </div>
  </div>

  <div class="form-actions">
    <button class="btn btn-primary" type="submit">保存する</button>
    <a class="btn" href="/ctrl/girls.php">キャンセル</a>
  </div>
</form>

  <?php if ($id): ?>
    <div class="card card-pad" style="border:1px solid #99f6e4;background:#f0fdfa;margin-top:14px">
      <strong style="color:#0d9488">🔄 保存済みの内容を媒体へ同期</strong>
      <p class="muted" style="font-size:.8em;margin:6px 0 10px">
        <strong>DBに保存されている現在の内容</strong>（未保存の編集は含みません。先に上の「保存する」を押してください）を媒体へ同期します。①同期する内容を選ぶ → ②媒体をチェック（デフォルト全チェック）→ ③確定ボタン、の流れです。<br>
        <strong>両方</strong>＝コメント＋写真 ／ <strong>💬 コメントのみ</strong>＝キャッチ/コメントだけ（写真は触らない） ／ <strong>🖼 写真のみ</strong>＝写真だけ（コメントは触らない）。<br>
        コメント＝媒体別欄があればそれ優先、無ければ共通文。写真＝「媒体用1枚目（あれば）＋オフィシャル②以降」の順。いずれも<strong>変更があった子・項目だけ反映</strong>されます（未変更はそのまま）。デリじゃはPR文のみ（紹介文欄なし）。
        写真パックDL（📦）は手動登録したいとき用に残しています。
      </p>
      <div id="sync-mode-picker" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn sync-mode-btn" data-mode="both">両方</button>
        <button type="button" class="btn sync-mode-btn" data-mode="profile">💬 コメントのみ</button>
        <button type="button" class="btn sync-mode-btn" data-mode="photo">🖼 写真のみ</button>
        <button type="button" class="btn sync-mode-btn" data-mode="create" style="border-color:#f59e0b">🆕 媒体へ新規登録</button>
      </div>
      <?php
        // 媒体チェックは店舗別（同名媒体でも立川と吉祥寺は別アカウント）。ヘブンのみ単体（立川アカウントのみ・吉祥寺は掲載なし）。
        $syncShops = array_values(array_intersect([1, 2], ($linkedShops ?? []) ?: [1, 2]));
        if ($syncShops === []) $syncShops = [1, 2];
        $SYNC_SHOP_NAMES = [1 => '立川', 2 => '吉祥寺'];
        $SYNC_MEDIA_ROW = [
          ['fujoho', '情報局'], ['ekichika', '駅ちか'], ['fuzoku', '風じゃ'], ['deli', 'デリじゃ'],
          ['fucolle', 'フーコレ', true], ['manzoku', 'マンゾク', true], ['mensv', 'メンズバ', true],
        ];
      ?>
      <div id="sync-media-picker" style="display:none;margin-top:10px;padding:10px;border:1px dashed #5eead4;border-radius:8px;background:#fff">
        <div style="font-size:.78em;color:#0d9488;font-weight:700;margin-bottom:6px">同期する媒体（チェックした媒体だけ反映されます。同名媒体でも立川・吉祥寺は別アカウントです）</div>
        <?php foreach ($syncShops as $ssid): ?>
        <div style="display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
          <span style="font-size:.78em;font-weight:700;color:#134e4a;min-width:52px"><?= h($SYNC_SHOP_NAMES[$ssid]) ?></span>
          <?php foreach ($SYNC_MEDIA_ROW as $mrow): ?>
          <label class="sync-media-cb">
            <input type="checkbox" value="<?= $ssid ?>:<?= h($mrow[0]) ?>" checked> <?= h($mrow[1]) ?><?= h($SYNC_SHOP_NAMES[$ssid]) ?>
          </label>
          <?php endforeach; ?>
        </div>
        <?php endforeach; ?>
        <?php if (in_array(1, $syncShops, true)): ?>
        <div style="display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center">
          <span style="font-size:.78em;font-weight:700;color:#134e4a;min-width:52px">単体</span>
          <label class="sync-media-cb"><input type="checkbox" value="1:heaven" checked> ヘブン</label>
        </div>
        <?php endif; ?>
        <div style="margin-top:6px">
          <button type="button" id="sync-media-all" class="btn" style="font-size:.72em;padding:2px 10px">全てチェック</button>
          <button type="button" id="sync-media-none" class="btn" style="font-size:.72em;padding:2px 10px">全て外す</button>
        </div>
      </div>
      <button type="button" id="sync-confirm-btn" disabled
              style="margin-top:12px;padding:8px 16px;border-radius:8px;border:1px solid #14b8a6;background:#0d9488;color:#fff;font-weight:700;opacity:.5;cursor:not-allowed">
        選択してください
      </button>
      <p id="sync-result" class="muted" style="font-size:.8em;margin-top:8px;display:none"></p>
      <!-- 媒体別の結果チップ（bot からの sync-result を request_id で突合して表示） -->
      <div id="sync-chips" style="margin-top:8px;display:none"></div>
    </div>

    <!-- 媒体からの取り下げ（退店・誤登録用）。同期とは別カードにする＝誤操作防止。
         bot 側は src/GirlDelete.php（girl_delete ジョブ）。
         対応: 情報局/駅ちか/フーコレ/マンゾク/メンズバ。風じゃ・デリじゃ・ヘブンは未対応でスキップを返す。 -->
    <div class="card card-pad" style="border:1px solid #fca5a5;background:#fef2f2;margin-top:14px">
      <strong style="color:#b91c1c">🗑 媒体から取り下げる（退店・誤登録）</strong>
      <p class="muted" style="font-size:.8em;margin:6px 0 10px">
        選んだ媒体からこの子の掲載を<strong>削除</strong>します。<strong>元に戻せない媒体がほとんどです</strong>（メンズバ・マンゾク・駅ちかは復元不可を確認済み）。<br>
        先に上の「掲載（店舗別）」をOFFにして保存し、<strong>同期対象から外してから</strong>実行してください。掲載中のまま消すと、次の同期で作り直されることがあります。<br>
        <strong>初期状態はすべて未チェック</strong>です。対象の媒体だけを選んでください。<br>
        <strong>🙈 非表示にする</strong>＝媒体側で「一時退店」にします。<strong>あとから戻せます</strong>（いまの対応: <strong>情報局</strong>）。<br>
        <strong>🗑 削除する</strong>＝媒体から消します。<strong>ほとんどの媒体で元に戻せません</strong>（いまの対応: <strong>情報局・駅ちか・フーコレ・マンゾク・メンズバ</strong>）。<br>
        対応していない媒体はチェックしても「スキップ」と表示されます（媒体側の管理画面から手動で操作してください）。
      </p>
      <div id="del-mode-picker" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="del-mode-btn del-mode-active" data-mode="hide">🙈 非表示にする（戻せます）</button>
        <button type="button" class="del-mode-btn" data-mode="delete">🗑 削除する（戻せません）</button>
      </div>
      <div id="del-media-picker" style="padding:10px;border:1px dashed #fca5a5;border-radius:8px;background:#fff">
        <?php foreach ($syncShops as $ssid): ?>
        <div style="display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
          <span style="font-size:.78em;font-weight:700;color:#7f1d1d;min-width:52px"><?= h($SYNC_SHOP_NAMES[$ssid]) ?></span>
          <?php foreach ($SYNC_MEDIA_ROW as $mrow): ?>
          <label class="del-media-cb">
            <input type="checkbox" value="<?= $ssid ?>:<?= h($mrow[0]) ?>"> <?= h($mrow[1]) ?><?= h($SYNC_SHOP_NAMES[$ssid]) ?>
          </label>
          <?php endforeach; ?>
        </div>
        <?php endforeach; ?>
        <?php if (in_array(1, $syncShops, true)): ?>
        <div style="display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center">
          <span style="font-size:.78em;font-weight:700;color:#7f1d1d;min-width:52px">単体</span>
          <label class="del-media-cb"><input type="checkbox" value="1:heaven"> ヘブン</label>
        </div>
        <?php endif; ?>
      </div>
      <button type="button" id="del-confirm-btn" disabled
              style="margin-top:12px;padding:8px 16px;border-radius:8px;border:1px solid #dc2626;background:#dc2626;color:#fff;font-weight:700;opacity:.5;cursor:not-allowed">
        媒体を選んでください
      </button>
      <p id="del-result" class="muted" style="font-size:.8em;margin-top:8px;display:none"></p>
      <div id="del-chips" style="margin-top:8px;display:none"></div>
    </div>
  <?php endif; ?>

<script>
const CSRF = '<?= h(csrf_token()) ?>';
const imgSort = document.getElementById('img-sort');

// 表示順の番号（①②③…）を振り直す
function renumberImages() {
  if (!imgSort) return;
  const C = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  [...imgSort.querySelectorAll('[data-img] .img-order-no')].forEach((el, i) => {
    el.textContent = i < C.length ? C[i] : (i + 1);
  });
}
renumberImages();

// 並べ替え結果を即保存（girl_images.sort 更新）
async function saveImageOrder() {
  if (!imgSort) return;
  const ids = [...imgSort.querySelectorAll('[data-img]')].map(d => d.dataset.img);
  const fd = new FormData();
  fd.append('_csrf', CSRF); fd.append('action', 'reorder-images');
  ids.forEach((id, i) => fd.append('ids[' + i + ']', id));
  await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
}

// ドラッグ並べ替え（flex-wrap グリッド対応）
if (imgSort) {
  let drag = null;
  imgSort.addEventListener('dragstart', e => {
    drag = e.target.closest('[data-img]');
    if (drag) { drag.style.opacity = '.4'; e.dataTransfer.effectAllowed = 'move'; }
  });
  imgSort.addEventListener('dragend', () => { if (drag) drag.style.opacity = ''; drag = null; });
  imgSort.addEventListener('dragover', e => {
    e.preventDefault();
    const t = e.target.closest('[data-img]');
    if (!t || t === drag || !drag) return;
    const r = t.getBoundingClientRect();
    // 同一行は横位置、行をまたぐ時も中心X基準で前後判定
    const after = (e.clientX - r.left) / r.width > 0.5;
    imgSort.insertBefore(drag, after ? t.nextSibling : t);
  });
  imgSort.addEventListener('drop', async e => {
    e.preventDefault();
    renumberImages();
    await saveImageOrder();
  });
}

document.querySelectorAll('[data-del-img]').forEach(b => b.addEventListener('click', async () => {
  if (!confirm('この画像を削除しますか？')) return;
  const fd = new FormData(); fd.append('_csrf', CSRF); fd.append('action', 'delete-image'); fd.append('image_id', b.dataset.delImg);
  const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
  if ((await r.json()).ok) { b.closest('[data-img]').remove(); renumberImages(); await saveImageOrder(); }
}));

// 保存済みの内容を媒体へ同期: 選択→確定の2段階（誤タップ防止）。フォーム保存とは独立したAJAX
// （bot は DB の現在値を読むため、この操作自体は何も保存しない＝押す前に必ず「保存する」を済ませておくこと）
(() => {
  const picker = document.getElementById('sync-mode-picker');
  if (!picker) return;
  const girlId = <?= (int)$id ?>;
  const confirmBtn = document.getElementById('sync-confirm-btn');
  const resultEl = document.getElementById('sync-result');
  const mediaPicker = document.getElementById('sync-media-picker');
  let selectedMode = '';
  const LABEL = { both: '両方（コメント＋写真）', profile: 'コメントのみ', photo: '写真のみ', create: '媒体へ新規登録' };
  const MEDIA_LABEL = { fujoho: '情報局', ekichika: '駅ちか', heaven: 'ヘブン', fuzoku: '風じゃ', deli: 'デリじゃ', fucolle: 'フーコレ', manzoku: 'マンゾク', mensv: 'メンズバ' };
  const SHOP_LABEL = { '1': '立川', '2': '吉祥寺' };
  // 値は "店舗ID:媒体キー"（例 "1:fujoho"=情報局立川）。ヘブンは単体（"1:heaven"）
  const mediaName = v => {
    const [sid, key] = v.split(':');
    return key === 'heaven' ? 'ヘブン' : (MEDIA_LABEL[key] || key) + (SHOP_LABEL[sid] || '');
  };
  const CONFIRM_MSG = {
    both: '保存済みの内容（コメント＋写真）を選択した媒体へ同期します。よろしいですか？\n※媒体側と差分がある子・項目だけ反映されます',
    profile: '保存済みのコメント（キャッチ/コメント）のみを選択した媒体へ同期します。写真は変更しません。よろしいですか？',
    photo: '保存済みの写真のみを選択した媒体へ同期します。コメントは変更しません。よろしいですか？\n※写真は変更があった子だけ差し替わります',
    create: 'この子を選択した媒体に新規登録します。\n名前・年齢・サイズ・入店日・キャッチ・コメント・プレイ項目・質問Q&A・写真が登録されます。\n※既に登録済みの媒体はスキップされます（二重登録なし）。よろしいですか？',
  };
  // 表示中のチェック済み媒体キーを返す（create以外はフーコレ/マンゾク/メンズバを含めない）
  const selectedMedia = () =>
    [...mediaPicker.querySelectorAll('.sync-media-cb')]
      .filter(l => l.style.display !== 'none')
      .map(l => l.querySelector('input'))
      .filter(cb => cb.checked)
      .map(cb => cb.value);
  const updateConfirm = () => {
    const n = selectedMode ? selectedMedia().length : 0;
    const ok = selectedMode && n > 0;
    confirmBtn.disabled = !ok;
    confirmBtn.style.opacity = ok ? '1' : '.5';
    confirmBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
    confirmBtn.textContent = !selectedMode ? '選択してください'
      : n === 0 ? '媒体を選んでください'
      : '🔄 「' + LABEL[selectedMode] + '」を' + n + '媒体へ同期する';
  };
  picker.querySelectorAll('.sync-mode-btn').forEach(btn => btn.addEventListener('click', () => {
    picker.querySelectorAll('.sync-mode-btn').forEach(b => b.classList.remove('sync-mode-active'));
    btn.classList.add('sync-mode-active');
    selectedMode = btn.dataset.mode;
    // モード選択→媒体チェック（デフォルト全チェック）→確定 の流れ
    mediaPicker.style.display = 'block';
    mediaPicker.querySelectorAll('.sync-media-cb').forEach(l => {
      l.querySelector('input').checked = true;
    });
    resultEl.style.display = 'none';
    updateConfirm();
  }));
  mediaPicker.addEventListener('change', updateConfirm);
  document.getElementById('sync-media-all').addEventListener('click', () => {
    mediaPicker.querySelectorAll('.sync-media-cb input').forEach(cb => { cb.checked = true; });
    updateConfirm();
  });
  document.getElementById('sync-media-none').addEventListener('click', () => {
    mediaPicker.querySelectorAll('.sync-media-cb input').forEach(cb => { cb.checked = false; });
    updateConfirm();
  });
  // ── 同期結果の受け取り（bot → media-profile-import.php?action=sync-result → media_sync_results）
  //    request_id で突合するので、続けて別の子を同期しても結果が混ざらない。
  //    bot 側は best-effort（結果POSTが失敗しても同期本体は成功）なので、
  //    結果が来ないこと自体は失敗を意味しない。タイムアウトは「不明」として明示する。
  const chipsEl = document.getElementById('sync-chips');
  const chipsElDel = document.getElementById('del-chips');
  const STATUS_STYLE = {
    created: { bg: '#ecfdf5', bd: '#6ee7b7', fg: '#047857', icon: '🆕', word: '登録' },
    deleted: { bg: '#fef2f2', bd: '#fca5a5', fg: '#b91c1c', icon: '🗑', word: '削除' },
    skipped: { bg: '#f8fafc', bd: '#cbd5e1', fg: '#475569', icon: '➖', word: 'スキップ' },
    failed:  { bg: '#fef2f2', bd: '#fca5a5', fg: '#b91c1c', icon: '⚠', word: '失敗' },
    pending: { bg: '#fffbeb', bd: '#fcd34d', fg: '#92400e', icon: '⏳', word: '待機中' },
    unknown: { bg: '#f8fafc', bd: '#cbd5e1', fg: '#64748b', icon: '❔', word: '結果不明' },
  };
  let pollTimer = null;
  const renderChips = (expected, byKey, done, el) => {
    const target = el || chipsEl;
    const parts = expected.map(v => {
      const r = byKey[v];
      const s = STATUS_STYLE[r ? r.status : (done ? 'unknown' : 'pending')] || STATUS_STYLE.unknown;
      const detail = r && r.detail ? r.detail : '';
      return '<span class="sync-chip" style="background:' + s.bg + ';border-color:' + s.bd + ';color:' + s.fg + '"'
        + (detail ? ' title="' + detail.replace(/"/g, '&quot;') + '"' : '')
        + '>' + s.icon + ' ' + mediaName(v) + '<b>' + s.word + '</b></span>';
    });
    const failed = expected.filter(v => byKey[v] && byKey[v].status === 'failed');
    let note = '';
    if (done) {
      note = failed.length
        ? '<div style="margin-top:6px;font-size:.78em;color:#b91c1c;font-weight:700">⚠ '
          + failed.map(v => mediaName(v)).join('・')
          + ' が失敗しました。媒体の公開ページで本人か確認してください（同名の別人に紐付いていないか）。</div>'
        : '<div style="margin-top:6px;font-size:.78em;color:#475569">結果が「結果不明」のままの媒体は、bot からの結果通知が届かなかっただけの可能性があります（同期自体は実行されています）。媒体側をご確認ください。</div>';
    }
    target.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap">' + parts.join('') + '</div>' + note;
    target.style.display = 'block';
  };
  const pollResults = (requestId, expected, el) => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const byKey = {};
    renderChips(expected, byKey, false, el);
    const started = Date.now();
    const tick = async () => {
      try {
        const fd = new FormData();
        fd.append('_csrf', CSRF);
        fd.append('action', 'sync-status');
        fd.append('girl_id', girlId);
        fd.append('request_id', requestId);
        const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
        const j = await r.json();
        if (j.ok) {
          // 結果は shop_id + media で返る。UIのチェック値 "店舗ID:媒体キー" に合わせる
          (j.results || []).forEach(row => { byKey[row.shop_id + ':' + row.media] = row; });
        }
      } catch (e) { /* ポーリング失敗は無視（次のtickで回復） */ }
      const allIn = expected.every(v => byKey[v]);
      const timeout = Date.now() - started > 5 * 60 * 1000;   // 5分で打ち切り
      renderChips(expected, byKey, allIn || timeout, el);
      if (allIn || timeout) { clearInterval(pollTimer); pollTimer = null; }
    };
    pollTimer = setInterval(tick, 4000);
    setTimeout(tick, 2500);
  };

  // ── 媒体からの取り下げ（削除）。同期とは別ボタン・初期は全部未チェック。
  //    元に戻せない媒体が多いため、確認は2段階にする。
  const delPicker = document.getElementById('del-media-picker');
  const delBtn = document.getElementById('del-confirm-btn');
  const delResult = document.getElementById('del-result');
  if (delPicker) {
    let delMode = 'hide';
    const modePicker = document.getElementById('del-mode-picker');
    modePicker.querySelectorAll('.del-mode-btn').forEach(btn => btn.addEventListener('click', () => {
      modePicker.querySelectorAll('.del-mode-btn').forEach(b => b.classList.remove('del-mode-active'));
      btn.classList.add('del-mode-active');
      delMode = btn.dataset.mode;
      updateDel();
    }));
    const delSelected = () =>
      [...delPicker.querySelectorAll('.del-media-cb input')].filter(cb => cb.checked).map(cb => cb.value);
    const updateDel = () => {
      const n = delSelected().length;
      delBtn.disabled = n === 0;
      delBtn.style.opacity = n ? '1' : '.5';
      delBtn.style.cursor = n ? 'pointer' : 'not-allowed';
      delBtn.textContent = n
        ? (delMode === 'hide' ? '🙈 ' + n + '媒体で非表示にする' : '🗑 ' + n + '媒体から削除する')
        : '媒体を選んでください';
      delBtn.style.background = delMode === 'hide' ? '#b45309' : '#dc2626';
      delBtn.style.borderColor = delBtn.style.background;
    };
    delPicker.addEventListener('change', updateDel);
    updateDel();
    delBtn.addEventListener('click', async () => {
      const media = delSelected();
      if (!media.length) return;
      const names = media.map(mediaName).join('・');
      const verb = delMode === 'hide' ? '非表示（一時退店）に' : '削除';
      const warn = delMode === 'hide'
        ? '※ あとから媒体側の「復帰」で戻せます。'
        : '※ ほとんどの媒体で元に戻せません。';
      if (!confirm('次の媒体で「<?= h($g['name']) ?>」を' + verb + 'します。\n\n' + names + '\n\n' + warn + ' よろしいですか？')) return;
      if (delMode === 'delete' && !confirm('最終確認です。\n\n' + names + ' から削除します。\n本当に実行しますか？')) return;
      delBtn.disabled = true; delBtn.style.cursor = 'wait';
      const prev = delBtn.textContent; delBtn.textContent = '送信中…';
      try {
        const fd = new FormData();
        fd.append('_csrf', CSRF);
        fd.append('action', 'delete-media');
        fd.append('girl_id', girlId);
        fd.append('mode', delMode);
        media.forEach(k => fd.append('media[]', k));
        const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
        const j = await r.json();
        delResult.style.display = 'block';
        if (j.ok) {
          delResult.style.color = '#b91c1c';
          delResult.textContent = (delMode === 'hide' ? '✅ 非表示の処理' : '✅ 削除の処理') + 'を開始しました。数分で反映されます。';
          if (j.request_id) pollResults(j.request_id, media, chipsElDel);
        } else {
          delResult.style.color = '#dc2626';
          delResult.textContent = '⚠ 送信に失敗しました（' + (j.error || '不明') + '）。';
        }
      } catch (e) {
        delResult.style.display = 'block';
        delResult.style.color = '#dc2626';
        delResult.textContent = '⚠ 通信エラーが発生しました。';
      } finally {
        delBtn.disabled = false; delBtn.style.cursor = 'pointer'; delBtn.textContent = prev;
      }
    });
  }

  confirmBtn.addEventListener('click', async () => {
    const media = selectedMedia();
    if (!selectedMode || media.length === 0) return;
    const mediaNames = media.map(mediaName).join('・');
    if (!confirm('対象媒体: ' + mediaNames + '\n\n' + CONFIRM_MSG[selectedMode])) return;
    confirmBtn.disabled = true;
    confirmBtn.style.cursor = 'wait';
    const prevText = confirmBtn.textContent;
    confirmBtn.textContent = '送信中…';
    try {
      const fd = new FormData();
      fd.append('_csrf', CSRF);
      fd.append('action', 'sync-media');
      fd.append('girl_id', girlId);
      fd.append('mode', selectedMode);
      media.forEach(k => fd.append('media[]', k));
      const r = await fetch('/ctrl/girl-actions.php', { method: 'POST', body: fd });
      const j = await r.json();
      resultEl.style.display = 'block';
      if (j.ok) {
        resultEl.style.color = '#0d9488';
        resultEl.textContent = '✅ 同期を開始しました。数分で反映されます。';
        if (j.request_id) pollResults(j.request_id, media);
      } else {
        resultEl.style.color = '#dc2626';
        resultEl.textContent = '⚠ 送信に失敗しました。もう一度お試しください。';
      }
    } catch (e) {
      resultEl.style.display = 'block';
      resultEl.style.color = '#dc2626';
      resultEl.textContent = '⚠ 通信エラーが発生しました。';
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.textContent = prevText;
    }
  });
})();
</script>
<style>
.sync-mode-btn { border: 1px solid #99f6e4; background: #fff; color: #0d9488; font-weight: 700; }
.sync-mode-btn.sync-mode-active { border-color: #0d9488; background: #0d9488; color: #fff; }
.sync-media-cb { display: inline-flex; align-items: center; gap: 4px; font-size: .82em; color: #134e4a; font-weight: 600; cursor: pointer; padding: 3px 6px; border-radius: 6px; }
.sync-media-cb:hover { background: #f0fdfa; }
.sync-media-cb input { accent-color: #0d9488; width: 15px; height: 15px; }
.del-mode-btn { border: 1px solid #fca5a5; background: #fff; color: #b91c1c; font-weight: 700; border-radius: 8px; padding: 6px 14px; font-size: .84em; cursor: pointer; }
.del-mode-btn.del-mode-active { background: #b91c1c; color: #fff; border-color: #b91c1c; }
.del-media-cb { display: inline-flex; align-items: center; gap: 4px; font-size: .82em; color: #7f1d1d; font-weight: 600; cursor: pointer; padding: 3px 6px; border-radius: 6px; }
.del-media-cb:hover { background: #fef2f2; }
.del-media-cb input { accent-color: #dc2626; width: 15px; height: 15px; }
/* 共通キャッチ/コメントが媒体別の専用文に上書きされる旨の注意書き */
.override-note { margin: 6px 0 0; padding: 7px 10px; font-size: .78rem; line-height: 1.6;
                 background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; color: #92400e; }
.sync-chip { display: inline-flex; align-items: center; gap: 4px; font-size: .76em; font-weight: 600;
             border: 1px solid; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
.sync-chip b { font-weight: 800; }
</style>
<?php layout_footer(); ?>
