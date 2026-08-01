<?php
// ==========================================================================
// orders.php — オーダー表（タイムテーブル）
//   縦=キャスト × 横=時間（10:00〜翌5:00、営業日=朝5時区切り）。
//   空きセルをクリック→新規モーダル / ブロックをクリック→編集モーダル。
//   電話番号で顧客を自動照合し、NG客は受付前に赤警告。
//   金額はマスタから自動計算し、保存時にスナップショット（マスタ変更の影響を受けない）。
// ==========================================================================
require_once __DIR__ . '/_orders-lib.php';
$admin = require_login();
$shop  = current_shop_id();
orders_ensure_tables();

$bizToday = orders_biz_date();
$date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'] ?? '') ? $_GET['date'] : $bizToday;

// ==========================================================================
// AJAX
// ==========================================================================
$action = $_GET['action'] ?? '';
if ($action !== '') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    try {
        // ---- 顧客照合（電話番号）----
        if ($action === 'customer-lookup') {
            $phone = orders_norm_phone((string)($_GET['phone'] ?? ''));
            if (strlen($phone) < 8) { echo json_encode(['found' => false]); exit; }
            $st = db()->prepare('SELECT id, name, is_ng, ng_reason, memo FROM order_customers WHERE shop_id=? AND phone=?');
            $st->execute([$shop, $phone]);
            $c = $st->fetch(PDO::FETCH_ASSOC);
            if (!$c) { echo json_encode(['found' => false]); exit; }
            $h = db()->prepare('SELECT o.start_at, o.total, o.status, g.name AS girl_name
                                  FROM orders o LEFT JOIN girls g ON g.id = o.girl_id
                                 WHERE o.shop_id=? AND o.customer_id=? ORDER BY o.start_at DESC LIMIT 5');
            $h->execute([$shop, (int)$c['id']]);
            $cnt = db()->prepare('SELECT COUNT(*), COALESCE(SUM(total),0) FROM orders WHERE shop_id=? AND customer_id=? AND status="done"');
            $cnt->execute([$shop, (int)$c['id']]);
            [$visits, $sum] = $cnt->fetch(PDO::FETCH_NUM);
            echo json_encode([
                'found' => true, 'customer' => $c,
                'visits' => (int)$visits, 'total_spent' => (int)$sum,
                'history' => $h->fetchAll(PDO::FETCH_ASSOC),
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { throw new RuntimeException('POST only'); }
        csrf_check();

        // ---- 保存（新規/更新）----
        if ($action === 'save') {
            $id      = (int)($_POST['id'] ?? 0);
            $girlId  = (int)($_POST['girl_id'] ?? 0);
            $startAt = (string)($_POST['start_at'] ?? '');
            if (!$girlId || !strtotime($startAt)) throw new RuntimeException('キャストと開始時刻は必須です');

            $m = orders_masters($shop);
            $byId = static fn(array $list, int $mid): ?array => array_values(array_filter($list, fn($x) => (int)$x['id'] === $mid))[0] ?? null;

            $courseId = (int)($_POST['course_id'] ?? 0) ?: null;
            $nomId    = (int)($_POST['nomination_type_id'] ?? 0) ?: null;
            $optIds   = array_values(array_unique(array_map('intval', (array)($_POST['option_ids'] ?? []))));
            $course   = $courseId ? $byId($m['courses'], $courseId) : null;
            $nom      = $nomId ? $byId($m['nominations'], $nomId) : null;
            $extMin   = max(0, (int)($_POST['extension_min'] ?? 0));
            $priceExt = max(0, (int)($_POST['price_extension'] ?? 0));
            $discount = max(0, (int)($_POST['discount'] ?? 0));

            $priceCourse = (int)($course['price'] ?? 0);
            $priceNom    = (int)($nom['price'] ?? 0);
            $priceOpt = 0; $backOpt = 0; $validOptIds = [];
            foreach ($optIds as $oid) {
                if ($o = $byId($m['options'], $oid)) { $priceOpt += (int)$o['price']; $backOpt += (int)$o['back_amount']; $validOptIds[] = $oid; }
            }
            $total = $priceCourse + $priceNom + $priceOpt + $priceExt - $discount;
            $back  = (int)($course['back_amount'] ?? 0) + (int)($nom['back_amount'] ?? 0) + $backOpt;

            $minutes = (int)($course['minutes'] ?? 60) + $extMin;
            $endAt   = date('Y-m-d H:i:s', strtotime($startAt) + $minutes * 60);
            $bizDate = orders_biz_date(strtotime($startAt));

            // 顧客: 電話番号があれば照合、無ければ作成（名前だけの飛び込みは customer 無しでも保存可）
            $customerId = null;
            $phone = orders_norm_phone((string)($_POST['phone'] ?? ''));
            $custName = trim((string)($_POST['customer_name'] ?? ''));
            if ($phone !== '' && strlen($phone) >= 8) {
                $st = db()->prepare('SELECT id, name FROM order_customers WHERE shop_id=? AND phone=?');
                $st->execute([$shop, $phone]);
                if ($c = $st->fetch(PDO::FETCH_ASSOC)) {
                    $customerId = (int)$c['id'];
                    if ($custName !== '' && $custName !== $c['name']) {
                        db()->prepare('UPDATE order_customers SET name=? WHERE id=?')->execute([$custName, $customerId]);
                    }
                } else {
                    db()->prepare('INSERT INTO order_customers (shop_id, phone, name) VALUES (?,?,?)')->execute([$shop, $phone, $custName]);
                    $customerId = (int)db()->lastInsertId();
                }
            }

            $media   = array_key_exists($_POST['media_key'] ?? '', orders_media_list()) ? $_POST['media_key'] : 'other';
            $payment = ($_POST['payment'] ?? 'cash') === 'card' ? 'card' : 'cash';
            $status  = array_key_exists($_POST['status'] ?? '', orders_status_list()) ? $_POST['status'] : 'reserved';
            $vals = [
                $shop, $bizDate, $customerId, $girlId, $courseId, $nomId, $media,
                trim((string)($_POST['hotel_name'] ?? '')), trim((string)($_POST['room_no'] ?? '')),
                (int)($_POST['driver_id'] ?? 0) ?: null,
                date('Y-m-d H:i:s', strtotime($startAt)), $endAt, $extMin,
                $priceCourse, $priceNom, $priceOpt, $priceExt, $discount, $total, $back,
                $payment, $status, mb_substr(trim((string)($_POST['memo'] ?? '')), 0, 500),
            ];
            if ($id) {
                $chk = db()->prepare('SELECT id FROM orders WHERE id=? AND shop_id=?');
                $chk->execute([$id, $shop]);
                if (!$chk->fetchColumn()) throw new RuntimeException('対象が見つかりません');
                db()->prepare('UPDATE orders SET shop_id=?, biz_date=?, customer_id=?, girl_id=?, course_id=?, nomination_type_id=?, media_key=?,
                        hotel_name=?, room_no=?, driver_id=?, start_at=?, end_at=?, extension_min=?,
                        price_course=?, price_nomination=?, price_options=?, price_extension=?, discount=?, total=?, back_total=?,
                        payment=?, status=?, memo=? WHERE id=' . $id)->execute($vals);
                db()->prepare('DELETE FROM order_selected_options WHERE order_id=?')->execute([$id]);
            } else {
                db()->prepare('INSERT INTO orders (shop_id, biz_date, customer_id, girl_id, course_id, nomination_type_id, media_key,
                        hotel_name, room_no, driver_id, start_at, end_at, extension_min,
                        price_course, price_nomination, price_options, price_extension, discount, total, back_total,
                        payment, status, memo, created_by)
                    VALUES (' . rtrim(str_repeat('?,', count($vals)), ',') . ',' . (int)$admin['id'] . ')')->execute($vals);
                $id = (int)db()->lastInsertId();
            }
            if ($validOptIds) {
                $io = db()->prepare('INSERT IGNORE INTO order_selected_options (order_id, option_item_id) VALUES (?,?)');
                foreach ($validOptIds as $oid) $io->execute([$id, $oid]);
            }
            echo json_encode(['ok' => true, 'id' => $id, 'total' => $total]);
            exit;
        }

        // ---- ステータス変更 ----
        if ($action === 'set-status') {
            $id = (int)($_POST['id'] ?? 0);
            $status = (string)($_POST['status'] ?? '');
            if (!array_key_exists($status, orders_status_list())) throw new RuntimeException('不正なステータス');
            $st = db()->prepare('UPDATE orders SET status=? WHERE id=? AND shop_id=?');
            $st->execute([$status, $id, $shop]);
            echo json_encode(['ok' => true]);
            exit;
        }

        // ---- 削除（誤登録用。通常はキャンセルを使う）----
        if ($action === 'delete') {
            $id = (int)($_POST['id'] ?? 0);
            db()->prepare('DELETE FROM order_selected_options WHERE order_id=?')->execute([$id]);
            db()->prepare('DELETE FROM orders WHERE id=? AND shop_id=?')->execute([$id, $shop]);
            echo json_encode(['ok' => true]);
            exit;
        }

        // ---- 顧客NGフラグ ----
        if ($action === 'set-ng') {
            $cid = (int)($_POST['customer_id'] ?? 0);
            $ng  = (int)($_POST['is_ng'] ?? 0) ? 1 : 0;
            db()->prepare('UPDATE order_customers SET is_ng=?, ng_reason=? WHERE id=? AND shop_id=?')
                ->execute([$ng, mb_substr(trim((string)($_POST['ng_reason'] ?? '')), 0, 200), $cid, $shop]);
            echo json_encode(['ok' => true]);
            exit;
        }

        throw new RuntimeException('unknown action');
    } catch (Throwable $e) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

// ==========================================================================
// 画面データ
// ==========================================================================
$masters = orders_masters($shop);

// この営業日のオーダー
$ost = db()->prepare('SELECT o.*, c.phone AS c_phone, c.name AS c_name, c.is_ng AS c_ng
                        FROM orders o LEFT JOIN order_customers c ON c.id = o.customer_id
                       WHERE o.shop_id=? AND o.biz_date=? ORDER BY o.start_at');
$ost->execute([$shop, $date]);
$orders = $ost->fetchAll(PDO::FETCH_ASSOC);

// 行=キャスト: 出勤(work) + オーダーがあるキャスト。暦日は営業日と深夜側(翌暦日)の両方を見る
$gst = db()->prepare('SELECT DISTINCT g.id, g.name,
                             s.start_time, s.end_time
                        FROM girls g
                        LEFT JOIN schedules s ON s.girl_id = g.id AND s.shop_id = g.shop_id AND s.work_date = ? AND s.status = "work"
                       WHERE g.shop_id = ?
                         AND (s.id IS NOT NULL OR g.id IN (SELECT girl_id FROM orders WHERE shop_id=? AND biz_date=?))
                       ORDER BY s.start_time IS NULL, s.start_time, g.name');
$gst->execute([$date, $shop, $shop, $date]);
$rows = $gst->fetchAll(PDO::FETCH_ASSOC);

// モーダルのキャスト選択肢は全在籍（出勤外の受注も現場ではある）
$allGirls = db()->prepare('SELECT id, name FROM girls WHERE shop_id=? AND is_display=1 ORDER BY name');
$allGirls->execute([$shop]);
$allGirls = $allGirls->fetchAll(PDO::FETCH_ASSOC);

$ordersByGirl = [];
foreach ($orders as $o) $ordersByGirl[(int)$o['girl_id']][] = $o;

$HOURS = orders_hours();                       // 10..29
$COLW  = 64;                                    // 1時間の幅(px)
$statusList = orders_status_list();
$mediaList  = orders_media_list();

// 本日サマリ
$sumDone = 0; $cntDone = 0; $cntActive = 0; $cntReserved = 0;
foreach ($orders as $o) {
    if ($o['status'] === 'done')     { $sumDone += (int)$o['total']; $cntDone++; }
    if ($o['status'] === 'active')   $cntActive++;
    if ($o['status'] === 'reserved') $cntReserved++;
}

layout_header('オーダー表', 'orders.php');
?>
<div class="page-head" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  <h1>📋 オーダー表</h1>
  <form method="get" style="display:flex;align-items:center;gap:6px">
    <a class="btn btn-sm" href="?date=<?= date('Y-m-d', strtotime($date . ' -1 day')) ?>">←</a>
    <input type="date" name="date" value="<?= h($date) ?>" onchange="this.form.submit()">
    <a class="btn btn-sm" href="?date=<?= date('Y-m-d', strtotime($date . ' +1 day')) ?>">→</a>
    <?php if ($date !== $bizToday): ?><a class="btn btn-sm" href="?date=<?= $bizToday ?>">本日へ</a><?php endif; ?>
  </form>
  <span class="muted">営業日は朝5時区切り（深夜1時の受注は前日の営業日に入ります）</span>
  <button class="btn btn-primary" style="margin-left:auto" onclick="OrderModal.open()">📞 新規オーダー</button>
</div>

<div class="stat-grid" style="margin-bottom:14px">
  <div class="stat"><div class="l">✅ 完了</div><div class="n"><?= $cntDone ?>本</div></div>
  <div class="stat"><div class="l">💰 売上（完了のみ）</div><div class="n">¥<?= number_format($sumDone) ?></div></div>
  <div class="stat"><div class="l">🏃 案内中</div><div class="n"><?= $cntActive ?></div></div>
  <div class="stat"><div class="l">🕐 予約</div><div class="n"><?= $cntReserved ?></div></div>
</div>

<?php if (!$rows): ?>
  <div class="card card-pad muted">この営業日の出勤（<a href="/ctrl/schedules.php">出勤管理</a>）とオーダーがまだありません。「📞 新規オーダー」からも登録できます。</div>
<?php endif; ?>

<div class="card" style="overflow:hidden">
<div class="ot-wrap" id="ot-wrap">
  <table class="ot-grid" style="min-width:<?= 140 + count($HOURS) * $COLW ?>px">
    <thead>
      <tr>
        <th class="ot-girl-col">キャスト</th>
        <?php foreach ($HOURS as $hh): ?>
          <th class="ot-hour" style="min-width:<?= $COLW ?>px"><?= $hh % 24 ?>:00</th>
        <?php endforeach; ?>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($rows as $g): $gid = (int)$g['id']; ?>
        <tr>
          <th class="ot-girl-col">
            <div class="ot-girl-name"><?= h($g['name']) ?></div>
            <?php if ($g['start_time']): ?>
              <div class="muted" style="font-size:11px"><?= substr($g['start_time'], 0, 5) ?>〜<?= substr((string)$g['end_time'], 0, 5) ?></div>
            <?php else: ?>
              <div class="muted" style="font-size:11px">出勤外</div>
            <?php endif; ?>
          </th>
          <td class="ot-lane" colspan="<?= count($HOURS) ?>" data-girl-id="<?= $gid ?>" data-girl-name="<?= h($g['name']) ?>">
            <?php
            // 出勤時間の背景バー
            if ($g['start_time']) {
                $sh = (int)substr($g['start_time'], 0, 2); $sm = (int)substr($g['start_time'], 3, 2);
                $eh = (int)substr((string)$g['end_time'], 0, 2); $em = (int)substr((string)$g['end_time'], 3, 2);
                if ($sh < 10) $sh += 24;
                if ($eh <= 10 || $eh < $sh) $eh += 24;
                $sx = (($sh - 10) * 60 + $sm) / 60 * $COLW;
                $wx = ((($eh - $sh) * 60) + ($em - $sm)) / 60 * $COLW;
                echo '<div class="ot-shift" style="left:' . $sx . 'px;width:' . max(0, $wx) . 'px"></div>';
            }
            foreach ($ordersByGirl[$gid] ?? [] as $o):
                $off = orders_min_offset($date, $o['start_at']);
                $dur = max(20, (int)((strtotime($o['end_at']) - strtotime($o['start_at'])) / 60));
                $x = max(0, $off) / 60 * $COLW;
                $w = max(34, $dur / 60 * $COLW - 3);
                [$stLabel] = $statusList[$o['status']];
                $json = h(json_encode($o, JSON_UNESCAPED_UNICODE));
            ?>
              <div class="ot-block st-<?= h($o['status']) ?>" style="left:<?= $x ?>px;width:<?= $w ?>px" data-order="<?= $json ?>" title="<?= h(($o['c_name'] ?: '客名未登録') . ' ' . $o['hotel_name']) ?>">
                <div class="b1"><?= date('H:i', strtotime($o['start_at'])) ?>-<?= date('H:i', strtotime($o['end_at'])) ?> <span class="st"><?= h($stLabel) ?></span></div>
                <div class="b2"><?= h($o['c_name'] !== '' && $o['c_name'] !== null ? $o['c_name'] : ($o['c_phone'] ? '…' . substr($o['c_phone'], -4) : '—')) ?><?= (int)$o['c_ng'] ? ' ⚠️' : '' ?></div>
                <div class="b3"><?= h($o['hotel_name'] ?: '') ?></div>
              </div>
            <?php endforeach; ?>
          </td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
  <div class="ot-nowline" id="ot-nowline" hidden></div>
</div>
</div>

<!-- ============================ モーダル ============================ -->
<div class="om-overlay" id="om-overlay" hidden>
  <div class="om" role="dialog" aria-modal="true">
    <div class="om-head">
      <strong id="om-title">新規オーダー</strong>
      <button class="btn btn-sm" type="button" onclick="OrderModal.close()">✕ 閉じる</button>
    </div>
    <form id="om-form" onsubmit="return OrderModal.save(event)">
      <input type="hidden" name="id" value="">
      <div class="om-grid">
        <label>電話番号
          <input type="tel" name="phone" placeholder="09012345678" autocomplete="off" inputmode="tel">
        </label>
        <label>お客様名
          <input type="text" name="customer_name" placeholder="呼び名でOK" maxlength="80" autocomplete="off">
        </label>
      </div>
      <div id="om-customer-info" class="om-cinfo" hidden></div>

      <div class="om-grid">
        <label>キャスト <span class="req">必須</span>
          <select name="girl_id" required>
            <option value="">選択</option>
            <?php foreach ($allGirls as $ag): ?><option value="<?= (int)$ag['id'] ?>"><?= h($ag['name']) ?></option><?php endforeach; ?>
          </select>
        </label>
        <label>開始時刻 <span class="req">必須</span>
          <input type="datetime-local" name="start_at" required step="300">
        </label>
      </div>

      <div class="om-grid">
        <label>コース
          <select name="course_id" data-price-recalc>
            <option value="" data-price="0" data-min="60">選択</option>
            <?php foreach ($masters['courses'] as $c): ?>
              <option value="<?= (int)$c['id'] ?>" data-price="<?= (int)$c['price'] ?>" data-min="<?= (int)$c['minutes'] ?>"><?= h($c['name']) ?>（<?= (int)$c['minutes'] ?>分 ¥<?= number_format((int)$c['price']) ?>）</option>
            <?php endforeach; ?>
          </select>
        </label>
        <label>指名
          <select name="nomination_type_id" data-price-recalc>
            <option value="" data-price="0">なし（フリー）</option>
            <?php foreach ($masters['nominations'] as $n): ?>
              <option value="<?= (int)$n['id'] ?>" data-price="<?= (int)$n['price'] ?>"><?= h($n['name']) ?>（¥<?= number_format((int)$n['price']) ?>）</option>
            <?php endforeach; ?>
          </select>
        </label>
      </div>

      <?php if ($masters['options']): ?>
      <div class="om-field"><span class="om-label">オプション</span>
        <div class="om-opts">
          <?php foreach ($masters['options'] as $op): ?>
            <label class="om-opt"><input type="checkbox" name="option_ids[]" value="<?= (int)$op['id'] ?>" data-price="<?= (int)$op['price'] ?>" data-price-recalc> <?= h($op['name']) ?> ¥<?= number_format((int)$op['price']) ?></label>
          <?php endforeach; ?>
        </div>
      </div>
      <?php endif; ?>

      <div class="om-grid om-grid-3">
        <label>延長（分）<input type="number" name="extension_min" value="0" min="0" step="10" data-price-recalc></label>
        <label>延長料金 <input type="number" name="price_extension" value="0" min="0" step="500" data-price-recalc></label>
        <label>割引 <input type="number" name="discount" value="0" min="0" step="500" data-price-recalc></label>
      </div>

      <div class="om-grid">
        <label>ホテル名 <input type="text" name="hotel_name" list="om-hotels" maxlength="120" autocomplete="off"></label>
        <label>部屋番号 <input type="text" name="room_no" maxlength="40" autocomplete="off"></label>
      </div>
      <datalist id="om-hotels">
        <?php
        $hh = db()->prepare('SELECT hotel_name, COUNT(*) c FROM orders WHERE shop_id=? AND hotel_name<>"" GROUP BY hotel_name ORDER BY c DESC LIMIT 30');
        $hh->execute([$shop]);
        foreach ($hh->fetchAll(PDO::FETCH_COLUMN) as $hn) echo '<option value="' . h($hn) . '">';
        ?>
      </datalist>

      <div class="om-grid om-grid-3">
        <label>ドライバー
          <select name="driver_id"><option value="">未定</option>
            <?php foreach ($masters['drivers'] as $d): ?><option value="<?= (int)$d['id'] ?>"><?= h($d['name']) ?></option><?php endforeach; ?>
          </select>
        </label>
        <label>媒体（何を見て？）
          <select name="media_key">
            <?php foreach ($mediaList as $k => $l): ?><option value="<?= $k ?>"><?= h($l) ?></option><?php endforeach; ?>
          </select>
        </label>
        <label>支払
          <select name="payment"><option value="cash">現金</option><option value="card">カード</option></select>
        </label>
      </div>

      <label class="om-field">メモ <input type="text" name="memo" maxlength="500" autocomplete="off"></label>

      <div class="om-total">
        <span>合計 <strong id="om-total">¥0</strong></span>
        <span class="muted" id="om-endtime"></span>
      </div>

      <div class="om-actions">
        <div id="om-status-btns" hidden>
          <?php foreach ($statusList as $k => [$l]): ?>
            <button type="button" class="btn btn-sm" data-set-status="<?= $k ?>"><?= h($l) ?></button>
          <?php endforeach; ?>
          <button type="button" class="btn btn-sm btn-danger" id="om-delete">削除</button>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button type="button" class="btn btn-sm" id="om-copy-staff">📋 スタッフ用</button>
          <button type="button" class="btn btn-sm" id="om-copy-cust">📋 お客様用</button>
          <button class="btn btn-primary" type="submit">保存</button>
        </div>
      </div>
      <input type="hidden" name="status" value="reserved">
    </form>
  </div>
</div>

<style>
/* ==== オーダー表（雛形。確定後 admin.css へ移動） ==== */
.ot-wrap{overflow-x:auto;position:relative;-webkit-overflow-scrolling:touch}
.ot-grid{border-collapse:collapse;width:max-content}
.ot-grid th,.ot-grid td{border:1px solid var(--line,#e5dede);padding:0}
.ot-grid thead th{background:#faf6f6;font-size:12px;padding:6px 4px;position:sticky;top:0;z-index:2}
.ot-girl-col{position:sticky;left:0;background:#fff;z-index:3;min-width:120px;max-width:140px;padding:8px 10px !important;text-align:left;font-size:13px}
thead .ot-girl-col{z-index:4;background:#faf6f6}
.ot-girl-name{font-weight:600}
.ot-lane{position:relative;height:74px;background:
  repeating-linear-gradient(to right, transparent 0, transparent 63px, #eee6e6 63px, #eee6e6 64px)}
.ot-shift{position:absolute;top:0;bottom:0;background:rgba(178,90,120,.08);border-left:2px solid rgba(178,90,120,.35);border-right:2px solid rgba(178,90,120,.35)}
.ot-block{position:absolute;top:6px;bottom:6px;border-radius:6px;padding:3px 6px;font-size:11px;line-height:1.35;overflow:hidden;cursor:pointer;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.ot-block .b1{font-weight:700;white-space:nowrap}
.ot-block .b2,.ot-block .b3{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ot-block .st{font-weight:400;opacity:.85;font-size:10px}
.st-reserved{background:#a98548}
.st-active{background:#2e7d32}
.st-done{background:#777}
.st-canceled{background:#c9c2c2;color:#666;text-decoration:line-through}
.st-ng{background:#b03030}
.ot-nowline{position:absolute;top:0;bottom:0;width:2px;background:#d33;z-index:1;pointer-events:none}
/* ==== モーダル ==== */
.om-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}
.om{background:#fff;border-radius:10px;max-width:640px;width:100%;padding:16px 18px}
.om-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.om-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.om-grid-3{grid-template-columns:1fr 1fr 1fr}
.om label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#666}
.om input,.om select{padding:7px 8px;border:1px solid #ddd;border-radius:6px;font-size:14px}
.om .req{color:#b03030;font-size:10px}
.om-field{display:block;margin-bottom:10px;font-size:12px;color:#666}
.om-label{display:block;margin-bottom:4px}
.om-opts{display:flex;flex-wrap:wrap;gap:6px 14px}
.om-opt{flex-direction:row !important;align-items:center;font-size:13px !important;color:#333 !important}
.om-cinfo{border:1px solid #e3d5c8;background:#fdf8f2;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px}
.om-cinfo.ng{border-color:#b03030;background:#fdf0f0}
.om-total{display:flex;justify-content:space-between;align-items:center;background:#faf6f6;border-radius:8px;padding:10px 14px;margin-bottom:12px}
.om-total strong{font-size:20px}
.om-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (max-width:640px){ .om-grid,.om-grid-3{grid-template-columns:1fr} }
</style>

<script>
window.__CSRF = '<?= h(csrf_token()) ?>';
const OT = {
  date: '<?= h($date) ?>',
  isToday: <?= $date === $bizToday ? 'true' : 'false' ?>,
  colw: <?= $COLW ?>,
  girlColW: 0,
};

// ---- 現在時刻ライン（本日のみ）----
(function () {
  if (!OT.isToday) return;
  const line = document.getElementById('ot-nowline');
  const wrap = document.getElementById('ot-wrap');
  const girlCol = document.querySelector('tbody .ot-girl-col');
  const draw = () => {
    const base = new Date(OT.date + 'T10:00:00');
    const min = (Date.now() - base.getTime()) / 60000;
    if (min < 0 || min > 20 * 60) { line.hidden = true; return; }
    const gw = girlCol ? girlCol.offsetWidth : 130;
    line.style.left = (gw + min / 60 * OT.colw) + 'px';
    line.hidden = false;
  };
  draw();
  setInterval(draw, 60000);
  // 初回は現在時刻へスクロール
  const base = new Date(OT.date + 'T10:00:00');
  const min = (Date.now() - base.getTime()) / 60000;
  if (min > 60) wrap.scrollLeft = Math.max(0, min / 60 * OT.colw - 120);
})();

// ---- モーダル ----
const OrderModal = {
  el: document.getElementById('om-overlay'),
  form: document.getElementById('om-form'),
  cur: null,

  open(preset) {
    this.cur = null;
    this.form.reset();
    this.form.id.value = '';
    this.form.status.value = 'reserved';
    document.getElementById('om-title').textContent = '新規オーダー';
    document.getElementById('om-status-btns').hidden = true;
    document.getElementById('om-customer-info').hidden = true;
    if (preset) {
      if (preset.girl_id) this.form.girl_id.value = preset.girl_id;
      if (preset.start_at) this.form.start_at.value = preset.start_at;
    }
    if (!this.form.start_at.value) {
      const d = new Date(Date.now() + 30 * 60000);
      d.setMinutes(Math.floor(d.getMinutes() / 10) * 10);
      this.form.start_at.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    this.recalc();
    this.el.hidden = false;
    this.form.phone.focus();
  },

  openEdit(o) {
    this.open();
    this.cur = o;
    document.getElementById('om-title').textContent = 'オーダー編集 #' + o.id;
    document.getElementById('om-status-btns').hidden = false;
    const f = this.form;
    f.id.value = o.id;
    f.phone.value = o.c_phone || '';
    f.customer_name.value = o.c_name || '';
    f.girl_id.value = o.girl_id;
    f.start_at.value = o.start_at.replace(' ', 'T').slice(0, 16);
    f.course_id.value = o.course_id || '';
    f.nomination_type_id.value = o.nomination_type_id || '';
    f.extension_min.value = o.extension_min;
    f.price_extension.value = o.price_extension;
    f.discount.value = o.discount;
    f.hotel_name.value = o.hotel_name;
    f.room_no.value = o.room_no;
    f.driver_id.value = o.driver_id || '';
    f.media_key.value = o.media_key;
    f.payment.value = o.payment;
    f.memo.value = o.memo;
    f.status.value = o.status;
    if (o.c_phone) this.lookup(o.c_phone);
    this.recalc();
  },

  close() { this.el.hidden = true; },

  recalc() {
    const f = this.form;
    const num = v => parseInt(v, 10) || 0;
    const optPrice = [...f.querySelectorAll('input[name="option_ids[]"]:checked')].reduce((s, c) => s + num(c.dataset.price), 0);
    const courseOpt = f.course_id.selectedOptions[0];
    const total = num(courseOpt?.dataset.price) + num(f.nomination_type_id.selectedOptions[0]?.dataset.price)
      + optPrice + num(f.price_extension.value) - num(f.discount.value);
    document.getElementById('om-total').textContent = '¥' + total.toLocaleString();
    // 終了時刻プレビュー
    const minutes = num(courseOpt?.dataset.min || 60) + num(f.extension_min.value);
    if (f.start_at.value) {
      const end = new Date(new Date(f.start_at.value).getTime() + minutes * 60000);
      document.getElementById('om-endtime').textContent = '終了 ' + String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0') + '（' + minutes + '分）';
    }
    return total;
  },

  async lookup(phone) {
    const box = document.getElementById('om-customer-info');
    const digits = (phone || '').replace(/\D+/g, '');
    if (digits.length < 8) { box.hidden = true; return; }
    try {
      const r = await fetch('?action=customer-lookup&phone=' + encodeURIComponent(digits));
      const d = await r.json();
      if (!d.found) { box.hidden = true; return; }
      const c = d.customer;
      box.classList.toggle('ng', !!+c.is_ng);
      let html = (+c.is_ng ? '<strong style="color:#b03030">⚠️ NG客です' + (c.ng_reason ? '：' + esc(c.ng_reason) : '') + '</strong><br>' : '')
        + '<strong>' + esc(c.name || '名前未登録') + '</strong>'
        + '　利用 ' + d.visits + '回 / 累計 ¥' + (+d.total_spent).toLocaleString();
      if (d.history.length) {
        html += '<br>' + d.history.slice(0, 3).map(hh => esc(hh.start_at.slice(5, 16)) + ' ' + esc(hh.girl_name || '') + ' ¥' + (+hh.total).toLocaleString()).join(' ｜ ');
      }
      box.innerHTML = html;
      box.hidden = false;
      if (c.name && !this.form.customer_name.value) this.form.customer_name.value = c.name;
    } catch (e) { box.hidden = true; }
  },

  async save(ev) {
    ev.preventDefault();
    const fd = new FormData(this.form);
    fd.append('_csrf', window.__CSRF);
    try {
      const r = await fetch('?action=save', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '保存に失敗しました');
      location.reload();
    } catch (e) { alert(e.message); }
    return false;
  },
};

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// ---- レーン: 空きクリック=新規 / ブロッククリック=編集 ----
document.addEventListener('click', (e) => {
  const block = e.target.closest('.ot-block');
  if (block) { OrderModal.openEdit(JSON.parse(block.dataset.order)); return; }
  const lane = e.target.closest('.ot-lane');
  if (lane) {
    const rect = lane.getBoundingClientRect();
    const min = Math.floor((e.clientX - rect.left) / OT.colw * 60 / 10) * 10;
    const base = new Date(OT.date + 'T10:00:00');
    const t = new Date(base.getTime() + min * 60000);
    const pad = n => String(n).padStart(2, '0');
    OrderModal.open({
      girl_id: lane.dataset.girlId,
      start_at: t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + 'T' + pad(t.getHours()) + ':' + pad(t.getMinutes()),
    });
  }
});

// ---- 料金再計算 ----
document.getElementById('om-form').addEventListener('input', (e) => {
  if (e.target.closest('[data-price-recalc]') || e.target.name === 'start_at') OrderModal.recalc();
});
// ---- 電話番号 → 顧客照合（入力が落ち着いてから）----
let lookupTimer = null;
document.querySelector('#om-form [name="phone"]').addEventListener('input', (e) => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => OrderModal.lookup(e.target.value), 400);
});

// ---- ステータス変更 / 削除 ----
document.getElementById('om-status-btns').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-set-status]');
  const id = OrderModal.form.id.value;
  if (!id) return;
  if (btn) {
    const fd = new FormData();
    fd.append('_csrf', window.__CSRF); fd.append('id', id); fd.append('status', btn.dataset.setStatus);
    const r = await fetch('?action=set-status', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.ok) location.reload(); else alert(d.error || 'エラー');
  }
  if (e.target.id === 'om-delete') {
    if (!confirm('このオーダーを削除します。よろしいですか？（通常は「キャンセル」を使ってください）')) return;
    const fd = new FormData();
    fd.append('_csrf', window.__CSRF); fd.append('id', id);
    const r = await fetch('?action=delete', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.ok) location.reload(); else alert(d.error || 'エラー');
  }
});

// ---- コピーボタン ----
function copyText(t) { navigator.clipboard.writeText(t).then(() => alert('コピーしました')); }
document.getElementById('om-copy-staff').addEventListener('click', () => {
  const f = OrderModal.form;
  const girl = f.girl_id.selectedOptions[0]?.textContent || '';
  const course = f.course_id.selectedOptions[0]?.textContent || '';
  const t = [
    '【オーダー】' + (OrderModal.form.start_at.value || '').replace('T', ' '),
    'キャスト: ' + girl,
    'コース: ' + course,
    'ホテル: ' + f.hotel_name.value + (f.room_no.value ? ' ' + f.room_no.value + '号室' : ''),
    'お客様: ' + (f.customer_name.value || '—') + ' ' + f.phone.value,
    'ドライバー: ' + (f.driver_id.selectedOptions[0]?.textContent || '未定'),
    '合計: ' + document.getElementById('om-total').textContent,
    f.memo.value ? 'メモ: ' + f.memo.value : '',
  ].filter(Boolean).join('\n');
  copyText(t);
});
document.getElementById('om-copy-cust').addEventListener('click', () => {
  const f = OrderModal.form;
  const start = (f.start_at.value || '').split('T')[1] || '';
  const t = 'ご予約ありがとうございます。' + start + 'より' +
    (f.course_id.selectedOptions[0]?.textContent.split('（')[0] || 'ご案内') + 'にてお伺いいたします。' +
    '料金は' + document.getElementById('om-total').textContent + 'です。お待ちしております。';
  copyText(t);
});

// ---- Escで閉じる ----
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') OrderModal.close(); });
document.getElementById('om-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) OrderModal.close(); });
</script>
<?php layout_footer(); ?>
