<?php
// ==========================================================================
// news-slots.php — 媒体固定枠の編集（CLAUDE-NEWS-SLOTS-ROTATION.md・2026-07-17）
//   駅ちか5カテゴリ + 情報局速報(日100回)の5枠ローテのうち、CTRLで事前登録する固定3枠:
//     新人速報(shinjin) / イベント速報(event) / 激アツ割引情報(waribiki)
//   速報NEWS・緊急出勤速報の2枠は「お知らせ」最新1件が自動で入る（news-current.php）＝ここでは扱わない。
//   配信: api/news-slots.php（body_text はコピペ用と同一の news_html_to_text() でAPI側生成）。
//   保存後は bot へ Webhook news.slots.changed（jobs: ekichika_news / fujoho_sokuho）。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_upload.php';
$admin = require_login();
$shop  = current_shop_id();

const NS_SLOTS = ['shinjin' => '新人速報', 'event' => 'イベント速報', 'waribiki' => '激アツ割引情報'];

// ============================================================ POST（1枠ずつ保存）
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $key = (string)($_POST['slot_key'] ?? '');
    if (!isset(NS_SLOTS[$key])) { flash('err', '対象の枠が見つかりません。'); redirect('news-slots.php'); }

    $cur = db()->prepare('SELECT * FROM news_slots WHERE shop_id=? AND slot_key=?');
    $cur->execute([$shop, $key]);
    $cur = $cur->fetch() ?: null;

    // 画像（枠専用ディレクトリ。差し替え/削除時は自枠の旧物理ファイルを掃除）
    $image = $cur['image'] ?? '';
    $isOwn = fn($p) => is_string($p) && str_starts_with($p, '/uploads/news-slots/');
    if (!empty($_POST['remove_image'])) { if ($isOwn($image)) delete_upload($image); $image = ''; }
    if (($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $new = save_upload($_FILES['image'], 'news-slots/' . $shop);
        if ($new) { if ($isOwn($image)) delete_upload($image); $image = $new; }
    }

    $title   = trim((string)($_POST['title'] ?? ''));
    $body    = (string)($_POST['body_html'] ?? '');
    $enabled = isset($_POST['is_enabled']) ? 1 : 0;
    $by      = $admin['username'] ?? 'ctrl';

    db()->prepare(
        'INSERT INTO news_slots (shop_id, slot_key, title, body_html, image, is_enabled, updated_by)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), body_html=VALUES(body_html), image=VALUES(image),
             is_enabled=VALUES(is_enabled), updated_by=VALUES(updated_by)'
    )->execute([$shop, $key, $title, $body, $image, $enabled, $by]);

    // bot へ変更通知（best-effort。駅ちかニュース + 情報局速報の両ジョブを明示）
    $chg = [];
    if (!$cur || ($cur['title'] ?? '') !== $title)          $chg[] = 'title';
    if (!$cur || ($cur['body_html'] ?? '') !== $body)       $chg[] = 'body_html';
    if (!$cur || ($cur['image'] ?? '') !== $image)          $chg[] = 'image_url';
    if (!$cur || (int)($cur['is_enabled'] ?? -1) !== $enabled) $chg[] = 'enabled';
    if ($chg) {
        require_once __DIR__ . '/../api/media-webhook.php';
        media_webhook_send([
            'event'      => 'news.slots.changed',
            'shop_id'    => $shop,
            'slot_key'   => $key,
            'changed'    => $chg,
            'updated_at' => date('c'),
            'source'     => 'ctrl',
            'jobs'       => ['ekichika_news', 'fujoho_sokuho'],
        ]);
    }
    flash('ok', NS_SLOTS[$key] . ' を保存しました' . ($enabled ? '' : '（無効＝botはこの枠を使いません）') . '。');
    redirect('news-slots.php');
}

// ============================================================ 表示データ
$st = db()->prepare('SELECT * FROM news_slots WHERE shop_id=?');
$st->execute([$shop]);
$slots = [];
foreach ($st->fetchAll() as $r) $slots[$r['slot_key']] = $r;

layout_header('媒体固定枠', 'news-slots.php');
?>
<style>
  .ns-help { background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:12px 16px; font-size:.82rem; line-height:1.7; margin-bottom:16px; }
  .ns-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin-bottom:18px; }
  .ns-card h2 { font-size:1rem; margin:0 0 12px; display:flex; align-items:center; gap:10px; }
  .ns-badge { font-size:.68rem; border-radius:99px; padding:2px 10px; font-weight:700; }
  .ns-on  { background:#dcfce7; color:#15803d; }
  .ns-off { background:#f1f5f9; color:#64748b; }
  .ns-key { font-size:.7rem; color:#94a3b8; font-weight:400; }
  .ns-body { width:100%; min-height:180px; font-family:ui-monospace,monospace; font-size:.82rem; }
  .ns-preview { border:1px solid #cbd5e1; border-radius:8px; min-height:180px; padding:10px; overflow:auto; background:#fff; }
  .ns-tabs button { border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px 6px 0 0; padding:4px 14px; font-size:.75rem; cursor:pointer; }
  .ns-tabs button.active { background:#fff; border-bottom-color:#fff; font-weight:700; }
  .ns-img-cur img { max-height:90px; border-radius:8px; border:1px solid #e5e7eb; }
  .ns-row { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; margin-top:10px; }
</style>

<h1>📡 媒体固定枠（駅ちか・情報局速報）</h1>

<div class="ns-help">
  この3枠は<b>駅ちか（新人・イベント・割引カテゴリ）と情報局速報のローテ</b>に使われます（bot が自動投稿）。
  <b>速報NEWS・緊急出勤</b>の2枠は「お知らせ」の最新1件が自動で入るため、ここでの登録は不要です。<br>
  本文はお知らせと同じHTML可（インラインCSS・リンクOK）。情報局にはテキスト抽出版（コピペ用と同じ変換）が使われます。
  保存すると bot に通知され、次のローテ巡回から新しい内容になります。
</div>

<?php foreach (NS_SLOTS as $key => $label): $s = $slots[$key] ?? null; $on = $s && (int)$s['is_enabled'] === 1; ?>
<div class="ns-card">
  <h2><?= h($label) ?> <span class="ns-key"><?= h($key) ?></span>
    <span class="ns-badge <?= $on ? 'ns-on' : 'ns-off' ?>"><?= $on ? '有効' : ($s ? '無効' : '未登録') ?></span>
    <?php if ($s): ?><span class="ns-key">更新: <?= h(date('n/j H:i', strtotime($s['updated_at']))) ?><?= $s['updated_by'] ? ' ' . h($s['updated_by']) : '' ?></span><?php endif; ?>
  </h2>
  <form method="post" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <input type="hidden" name="slot_key" value="<?= h($key) ?>">
    <div class="field"><label>タイトル</label><input type="text" name="title" value="<?= h($s['title'] ?? '') ?>" placeholder="例: 完全未経験の新人『○○さん』デビュー！"></div>
    <div class="field" style="margin-top:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <label style="margin-bottom:0">本文（HTMLソース可）</label>
        <div class="ns-tabs">
          <button type="button" class="active" data-ns-tab="source" data-ns-key="<?= h($key) ?>">ソース</button>
          <button type="button" data-ns-tab="preview" data-ns-key="<?= h($key) ?>">プレビュー</button>
        </div>
      </div>
      <textarea class="ns-body" id="ns-src-<?= h($key) ?>" name="body_html"><?= h($s['body_html'] ?? '') ?></textarea>
      <div class="ns-preview" id="ns-pre-<?= h($key) ?>" contenteditable="true" spellcheck="false" style="display:none"></div>
    </div>
    <div class="ns-row">
      <div>
        <label>代表画像（任意）</label><br>
        <?php if (!empty($s['image'])): ?>
          <div class="ns-img-cur"><img src="<?= h(asset_url($s['image'])) ?>" alt=""></div>
          <label style="font-weight:400"><input type="checkbox" name="remove_image" value="1"> 画像を削除</label><br>
        <?php endif; ?>
        <input type="file" name="image" accept="image/*">
      </div>
      <div style="margin-left:auto;text-align:right">
        <label style="font-weight:400"><input type="checkbox" name="is_enabled" value="1" <?= ($s === null || $on) ? 'checked' : '' ?>> この枠を有効にする（botが使用）</label><br><br>
        <button class="btn btn-primary" type="submit"><?= h($label) ?> を保存</button>
      </div>
    </div>
  </form>
</div>
<?php endforeach; ?>

<script>
// ソース⇄プレビュー（news-edit.php と同パターン・枠ごとに独立）
document.querySelectorAll('[data-ns-tab]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var key = btn.dataset.nsKey, mode = btn.dataset.nsTab;
    var src = document.getElementById('ns-src-' + key);
    var pre = document.getElementById('ns-pre-' + key);
    if (pre.style.display !== 'none') src.value = pre.innerHTML;     // プレビュー編集をソースへ確定
    btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    src.style.display = (mode === 'source') ? 'block' : 'none';
    pre.style.display = (mode === 'preview') ? 'block' : 'none';
    if (mode === 'preview') pre.innerHTML = src.value;
  });
});
// 送信時、プレビュー表示中なら最新の編集内容を反映
document.querySelectorAll('form').forEach(function (f) {
  f.addEventListener('submit', function () {
    var key = f.querySelector('[name="slot_key"]');
    if (!key) return;
    var src = document.getElementById('ns-src-' + key.value);
    var pre = document.getElementById('ns-pre-' + key.value);
    if (src && pre && pre.style.display !== 'none') src.value = pre.innerHTML;
  });
});
// プレビュー編集のリアルタイム同期
document.querySelectorAll('.ns-preview').forEach(function (pre) {
  pre.addEventListener('input', function () {
    var key = pre.id.replace('ns-pre-', '');
    document.getElementById('ns-src-' + key).value = pre.innerHTML;
  });
});
</script>

<?php layout_footer(); ?>
