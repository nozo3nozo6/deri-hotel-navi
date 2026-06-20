<?php
// ==========================================================================
// girls-import-admi.php — admi(MINERVA) 女性一覧HTMLを貼り付けて取込
//   抽出: 入店日 / 表示・非表示 / 年齢 / スリーサイズ / 各フラグ
//   照合: 名前（同名はスリーサイズで判定）。画像・名前・コメント等は変更しない。
//   ドライラン(プレビュー) → 実反映 の2段階。
// ==========================================================================
require_once __DIR__ . '/_lib.php';
$admin = require_login();
$shop  = current_shop_id();

// ---- MINERVA HTML をパース ----
function parse_admi_html(string $html): array {
    $rows = [];
    if (!preg_match_all('/<tr\b.*?<\/tr>/su', $html, $m)) return $rows;
    foreach ($m[0] as $tr) {
        if (strpos($tr, '名称(年齢)') === false) continue;
        if (!preg_match('/data-label="名称\(年齢\)"><span>([^()<]+?)\((\d+)\)<\/span>/u', $tr, $n)) continue;
        $name = trim($n[1]);
        $age  = (int)$n[2];

        $t=$b=$cup=$w=$hp = null;
        if (preg_match('/data-label="スリーサイズ"><span>([^<]*)<\/span>/u', $tr, $sz)) {
            if (preg_match('/T(\d+|—)\s*B(\d+|—)\(([^)]*)\)\s*W(\d+|—)\s*H(\d+|—)/u', $sz[1], $p)) {
                $t   = $p[1] === '—' ? null : (int)$p[1];
                $b   = $p[2] === '—' ? null : (int)$p[2];
                $cup = ($p[3] === '—' || $p[3] === '--' || $p[3] === '') ? null : trim($p[3]);
                $w   = $p[4] === '—' ? null : (int)$p[4];
                $hp  = $p[5] === '—' ? null : (int)$p[5];
            }
        }
        $in_date = null;
        if (preg_match('/data-label="入店日"><span>([0-9]{4}-[0-9]{2}-[0-9]{2})<\/span>/u', $tr, $d)) $in_date = $d[1];

        // フラグ（各列：マーク有=1）。data-label毎に mark-on の有無を見る
        $flag = function(string $label) use ($tr): int {
            if (preg_match('/data-label="' . preg_quote($label, '/') . '">(.*?)<\/td>/su', $tr, $c)) {
                return strpos($c[1], 'mark-on') !== false ? 1 : 0;
            }
            return 0;
        };
        $disp = 1;
        if (preg_match('/data-label="表示">.*?\[(表示|非表示)\]/su', $tr, $dd)) $disp = ($dd[1] === '表示') ? 1 : 0;

        $rows[] = [
            'name' => $name, 'age' => $age,
            'height' => $t, 'bust' => $b, 'cup' => $cup, 'waist' => $w, 'hip' => $hp,
            'in_date' => $in_date,
            'is_newgirl' => $flag('新人'), 'is_trial' => $flag('待ち合わせ'),
            'is_tel' => $flag('電話'), 'is_inbound' => $flag('インバウンド'),
            'is_genderless' => $flag('ジェンダーレス'),
            'is_display' => $disp,
        ];
    }
    return $rows;
}

// ---- kichifu 女性を取得（名前→候補） ----
function load_girls(int $shop): array {
    $st = db()->prepare('SELECT id,name,age,height,bust,cup,waist,hip,is_display,is_newgirl,is_trial,is_tel,is_inbound,is_genderless,in_date FROM girls WHERE shop_id=?');
    $st->execute([$shop]);
    $byName = [];
    foreach ($st->fetchAll() as $g) $byName[trim($g['name'])][] = $g;
    return $byName;
}

// ---- 1レコードに対し kichifu girl を1件特定（同名はサイズで判定） ----
function match_girl(array $rec, array $cands): array {
    if (count($cands) === 0) return ['status' => 'nomatch', 'girl' => null];
    if (count($cands) === 1) return ['status' => 'ok', 'girl' => $cands[0]];
    $hit = [];
    foreach ($cands as $g) {
        $same = ((int)$g['bust'] === (int)$rec['bust'])
             && ((int)$g['waist'] === (int)$rec['waist'])
             && ((int)$g['hip'] === (int)$rec['hip'])
             && ((string)$g['cup'] === (string)$rec['cup']);
        if ($same) $hit[] = $g;
    }
    if (count($hit) === 1) return ['status' => 'ok', 'girl' => $hit[0]];
    return ['status' => 'ambiguous', 'girl' => null];
}

$FIELDS = ['age','height','bust','cup','waist','hip','in_date','is_newgirl','is_trial','is_tel','is_inbound','is_genderless','is_display'];

$result = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $html  = (string)($_POST['html'] ?? '');
    $apply = ($_POST['mode'] ?? '') === 'apply';
    $recs  = parse_admi_html($html);
    $byName = load_girls($shop);
    $seenKichifuNames = [];

    $updates = []; $ambiguous = []; $nomatch = []; $usedIds = [];
    foreach ($recs as $rec) {
        $cands = $byName[$rec['name']] ?? [];
        $mm = match_girl($rec, $cands);
        if ($mm['status'] === 'nomatch') { $nomatch[] = $rec; continue; }
        if ($mm['status'] === 'ambiguous') { $ambiguous[] = $rec; continue; }
        $g = $mm['girl'];
        if (isset($usedIds[$g['id']])) continue; // 同一kichifu girlへの二重割当は先勝ち
        $usedIds[$g['id']] = true;
        $seenKichifuNames[trim($g['name'])] = true;

        // 変更差分を計算
        $changes = [];
        foreach ($FIELDS as $f) {
            $newv = $rec[$f];
            $oldv = $g[$f];
            // in_date が空のレコードは入店日を上書きしない
            if ($f === 'in_date' && ($newv === null || $newv === '')) continue;
            if ((string)$oldv !== (string)$newv) $changes[$f] = [$oldv, $newv];
        }
        $updates[] = ['girl' => $g, 'rec' => $rec, 'changes' => $changes];
    }

    // kichifu にあるが MINERVA 側で見つからなかった子（=貼り漏れ/別名）
    $missing = [];
    foreach ($byName as $nm => $list) {
        if (!isset($seenKichifuNames[$nm])) foreach ($list as $g) $missing[] = $g;
    }

    if ($apply) {
        $pdo = db();
        $pdo->beginTransaction();
        $sql = 'UPDATE girls SET age=?,height=?,bust=?,cup=?,waist=?,hip=?,'
             . 'is_newgirl=?,is_trial=?,is_tel=?,is_inbound=?,is_genderless=?,is_display=?'
             . ', in_date=COALESCE(?, in_date)'
             . ' WHERE id=? AND shop_id=?';
        $up = $pdo->prepare($sql);
        $n = 0;
        foreach ($updates as $u) {
            $r = $u['rec'];
            $up->execute([
                $r['age'], $r['height'], $r['bust'], $r['cup'], $r['waist'], $r['hip'],
                $r['is_newgirl'], $r['is_trial'], $r['is_tel'], $r['is_inbound'], $r['is_genderless'], $r['is_display'],
                $r['in_date'],
                $u['girl']['id'], $shop,
            ]);
            $n++;
        }
        $pdo->commit();
        flash('ok', "反映しました：{$n}件更新（解析{".count($recs)."}・該当なし".count($nomatch)."・あいまい".count($ambiguous)."）");
        redirect('/admin/girls-import-admi.php?done=1');
    }

    $result = compact('recs','updates','ambiguous','nomatch','missing');
    $_SESSION['_admi_html'] = $html; // 確認後に実反映するため保持
}

layout_header('admi取込（入店日・表示）', 'girls.php');
?>
<div class="page-head">
  <h1>admi(MINERVA) 取込 — 入店日・表示/非表示</h1>
  <a class="btn" href="/admin/girls.php">← 女性一覧</a>
</div>
<p class="muted" style="margin-top:-6px">
  admi管理画面の「女性」一覧（<b>全ページ</b>）のHTMLをそのまま貼り付け → プレビュー → 実反映。
  名前（同名はスリーサイズ）で照合し、<b>入店日・表示/非表示・年齢・スリーサイズ・各フラグ</b>を更新します。画像・名前・コメント・タグは変更しません。
</p>

<form method="post">
  <?= csrf_field() ?>
  <textarea name="html" rows="10" class="inp" style="width:100%;font-family:monospace;font-size:12px"
            placeholder="ここに admi の女性一覧ページのHTMLを貼り付け（1〜12ページ分まとめて貼ってOK）"><?= h($result ? ($_SESSION['_admi_html'] ?? '') : '') ?></textarea>
  <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
    <button class="btn btn-primary" type="submit" name="mode" value="preview">🔍 プレビュー（変更なし）</button>
    <?php if ($result && $result['updates']): ?>
      <button class="btn btn-danger" type="submit" name="mode" value="apply"
        onclick="return confirm('<?= count($result['updates']) ?>件を実反映します。よろしいですか？')">✅ 実反映する（<?= count($result['updates']) ?>件）</button>
    <?php endif; ?>
  </div>
</form>

<?php if ($result): ?>
  <?php
    $labels = ['age'=>'年齢','height'=>'T','bust'=>'B','cup'=>'CUP','waist'=>'W','hip'=>'H','in_date'=>'入店日',
               'is_newgirl'=>'新人','is_trial'=>'待合','is_tel'=>'電話','is_inbound'=>'IB','is_genderless'=>'GL','is_display'=>'表示'];
  ?>
  <div class="card" style="margin-top:18px;padding:14px">
    <b>解析結果</b>：レコード <?= count($result['recs']) ?> / 更新対象 <?= count($result['updates']) ?>
    ・あいまい <?= count($result['ambiguous']) ?> ・該当なし(admi側) <?= count($result['nomatch']) ?>
    ・kichifuで未照合 <?= count($result['missing']) ?>
  </div>

  <?php if ($result['updates']): ?>
  <h3 style="margin-top:18px">更新プレビュー（変更フィールドのみ表示）</h3>
  <div class="l-table" style="overflow:auto">
  <table class="tbl"><thead><tr><th>名前</th><th>入店日</th><th>表示</th><th>その他の変更</th></tr></thead><tbody>
    <?php foreach ($result['updates'] as $u): $c = $u['changes']; ?>
      <tr>
        <td><?= h($u['girl']['name']) ?></td>
        <td><?= h($u['rec']['in_date'] ?? '—') ?></td>
        <td><?= ((int)$u['rec']['is_display']) ? '表示' : '<span style="color:#c00">非表示</span>' ?></td>
        <td style="font-size:12px">
          <?php
            $oth = [];
            foreach ($c as $f => $pair) {
              if (in_array($f, ['in_date','is_display'], true)) continue;
              $oth[] = ($labels[$f] ?? $f) . ': ' . h((string)$pair[0]) . '→' . h((string)$pair[1]);
            }
            echo $oth ? implode(' / ', $oth) : '<span class="muted">サイズ等変更なし</span>';
          ?>
        </td>
      </tr>
    <?php endforeach; ?>
  </tbody></table>
  </div>
  <?php endif; ?>

  <?php if ($result['ambiguous']): ?>
    <h3 style="margin-top:18px;color:#c60">あいまい（同名・サイズで特定できず／手動確認）</h3>
    <p class="muted"><?= h(implode('、', array_map(fn($r)=>$r['name'].'('.$r['age'].')', $result['ambiguous']))) ?></p>
  <?php endif; ?>

  <?php if ($result['missing']): ?>
    <h3 style="margin-top:18px;color:#c60">kichifuにあるがadmi側で見つからない（貼り漏れ/別名の可能性）</h3>
    <p class="muted"><?= h(implode('、', array_map(fn($g)=>$g['name'], $result['missing']))) ?></p>
  <?php endif; ?>
<?php endif; ?>

<?php layout_footer(); ?>
