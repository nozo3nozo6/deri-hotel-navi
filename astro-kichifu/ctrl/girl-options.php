<?php
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// プレイ項目の区分（店長指定 2026-08-11 に「応用プレイ」を新設）。
// play_tier が正。is_basic は同じ内容の写しで、まだ tier を見ていない古い読み手のために残す
//（tier=1 → is_basic=1 / それ以外 → 0。応用は古い読み手からはオプション扱いになる）。
const PLAY_TIERS = [1 => '基本プレイ', 2 => '応用プレイ', 3 => 'オプションプレイ'];
function play_tier_of(array $post): int {
    $t = (int)($post['play_tier'] ?? 3);
    return isset(PLAY_TIERS[$t]) ? $t : 3;
}

// ---- 追加 ----
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();
    $name = trim((string)($_POST['name'] ?? ''));
    $tier = play_tier_of($_POST);
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
            db()->prepare('INSERT INTO girl_options (shop_id,name,is_basic,play_tier,sort) VALUES (?,?,?,?,?)')
                ->execute([$shop, $name, $tier === 1 ? 1 : 0, $tier, (int)$ms->fetchColumn()]);
            flash('ok', '「' . $name . '」を追加しました。');
        }
    }
    redirect('girl-options.php');
}

$rows = db()->prepare('SELECT id, name, play_tier FROM girl_options WHERE shop_id=? ORDER BY sort, id');
$rows->execute([$shop]);
$rows = $rows->fetchAll();

layout_header('女性オプション', 'girl-options.php');
?>
<div class="page-head">
  <h1>女性オプション（プレイ項目） <span class="muted" style="font-size:14px">（<?= count($rows) ?>件）</span></h1>
</div>
<p class="muted" style="margin-top:-8px">女の子に設定するプレイ項目。区分（基本プレイ／応用プレイ／オプションプレイ）ごとに、サイトの女の子ページでも同じ見出しに分かれて出ます。女性の編集画面で各項目を選択できます。</p>

<form method="post" class="toolbar" style="margin-bottom:18px">
  <?= csrf_field() ?>
  <div class="search"><input type="text" name="name" placeholder="項目名（例: 生フェラ）" required maxlength="80"></div>
  <select name="play_tier" class="sel">
    <?php foreach (PLAY_TIERS as $v => $label): ?>
      <option value="<?= $v ?>"<?= $v === 3 ? ' selected' : '' ?>><?= h($label) ?></option>
    <?php endforeach; ?>
  </select>
  <button class="btn btn-primary" type="submit">＋ 追加</button>
  <span class="muted" style="margin-left:auto">行をドラッグで並べ替え</span>
</form>

<div class="table-wrap">
  <table class="tbl">
    <thead><tr><th style="width:34px"></th><th>項目名</th><th style="width:130px">区分</th><th style="width:90px">操作</th></tr></thead>
    <tbody data-sortable id="rows">
      <?php foreach ($rows as $r): $t = (int)$r['play_tier']; ?>
        <tr draggable="true" data-id="<?= (int)$r['id'] ?>">
          <td style="cursor:grab;color:#bbb">⠿</td>
          <td><strong><?= h($r['name']) ?></strong></td>
          <td><?= h(PLAY_TIERS[$t] ?? PLAY_TIERS[3]) ?></td>
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
