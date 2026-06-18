<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$title = '料金システム｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . 'の料金システム。60分〜お泊まりまでのコース料金、オプション、交通費エリア、キャンセルについてご案内します。';

/* ── 料金データ（編集はこのブロックだけでOK） ───────────────────────── */

// 初めての女性・ホテルご利用（FANTASY PRICE）
$priceHotel = [
    ['time' => '60分',  'was' => '¥19,800', 'now' => '16,500', 'cond' => '吉祥寺駅周辺限定／お待ち合わせ不可'],
    ['time' => '90分',  'was' => '¥28,600', 'now' => '22,000', 'cond' => ''],
    ['time' => '120分', 'was' => '¥37,400', 'now' => '27,500', 'cond' => ''],
    ['time' => '150分', 'was' => '¥46,200', 'now' => '33,000', 'cond' => ''],
];

// 2回目以降のご指名・ご自宅ご利用
$priceRepeat = [
    ['time' => '60分',  'was' => '¥19,800', 'now' => '16,500'],
    ['time' => '90分',  'was' => '¥28,600', 'now' => '22,000'],
    ['time' => '120分', 'was' => '¥37,400', 'now' => '27,500'],
    ['time' => '150分', 'was' => '¥46,200', 'now' => '33,000'],
];

// 指名料・延長など
$fees = [
    ['name' => '指名料',  'note' => '初めての女性のご利用',        'amount' => '¥1,100'],
    ['name' => '本指名料','note' => '同じ女性で2回目以降のご利用','amount' => '¥2,200'],
    ['name' => '延長／追加料金', 'note' => '', 'amount' => '¥8,800', 'unit' => '/30分'],
];

// オプション
$options = [
    ['name' => 'ローター', 'amount' => '¥1,100'],
    ['name' => '電マ',     'amount' => '¥1,100'],
    ['name' => 'バイブ',   'amount' => '¥1,100'],
    ['name' => 'コスチューム各種', 'amount' => '¥3,300'],
    ['name' => 'ソフトSMコース', 'note' => '緊縛・鞭・ローソク無し', 'amount' => '¥3,300'],
    ['name' => 'SMコース',       'note' => '緊縛・鞭・ローソク有り', 'amount' => '¥5,500'],
    ['name' => '撮影', 'note' => '前日予約必須', 'amount' => '¥11,000'],
];

// 交通費エリア（吉祥寺・確定）
$zones = [
    ['fee' => '¥2,200',   'area' => '吉祥寺付近ホテル'],
    ['fee' => '¥2,200〜', 'area' => '立川市、八王子駅周辺、瑞穂町、福生市、羽村市、あきる野市、昭島市、日野市、武蔵村山市、東大和市、小平市、国分寺市、国立市、府中市、多摩市、小金井市、青梅市、日の出町、三鷹市、調布市、所沢市、武蔵野市、西東京市、稲城市、清瀬市、その他八王子市、東久留米市 など'],
    ['fee' => '¥3,300〜', 'area' => '狛江市、世田谷区、杉並区、練馬区、多摩区、奥多摩町、町田市、相模原市、麻生区、和光市、志木市、富士見市、ふじみ野、川越市、日高市、狭山市、飯能市、新座市、朝霞市、坂戸市、鶴ヶ島市 など'],
];

// キャンセル
$cancels = [
    ['when' => '当日（合流前・合流後とも）', 'fee' => '総額の100%'],
    ['when' => '前日',                       'fee' => 'コース料金の50%'],
    ['when' => '2日前以前',                  'fee' => 'なし（次回ご利用時は当日予約）'],
];
/* ───────────────────────────────────────────────────────────────────── */

site_head($title, $desc, 'https://kichifu.com/system');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1;">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>料金システム</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">SYSTEM</span>
        <h1 class="section-title">料金システム</h1>
      </div>

      <!-- FANTASY PRICE バナー -->
      <div class="price-banner">
        <span class="price-banner-badge"><span aria-hidden="true">🌸</span> オフィシャルサイトをご覧の方限定</span>
        <span class="price-banner-en holo-text">FANTASY PRICE</span>
        <span class="price-banner-jp">通常料金からの特別割引価格でご案内中。<br>非日常的なひとときを、ゆっくりとお楽しみください。</span>
      </div>

      <!-- ① 初回・ホテル -->
      <h2 class="section-label">コース料金</h2>
      <div class="price-group">
        <div class="price-group-head">
          <span class="price-group-title"><span aria-hidden="true">🏨</span> ホテルでご利用</span>
          <span class="neon-chip">初めての女性</span>
        </div>
        <p class="price-group-desc">初めてお会いする女性とホテルでご利用のお客様はこちら。</p>
        <div class="price-table">
          <?php foreach ($priceHotel as $p): ?>
          <div class="price-row">
            <span class="price-row-course">
              <span class="price-row-time"><?= h($p['time']) ?></span>
              <?php if (!empty($p['cond'])): ?><span class="price-row-cond">※ <?= h($p['cond']) ?></span><?php endif; ?>
            </span>
            <span class="price-row-amount">
              <span class="price-was"><?= h($p['was']) ?></span>
              <span class="price-now"><small>¥</small><?= h($p['now']) ?></span>
            </span>
          </div>
          <?php endforeach; ?>
        </div>
        <div class="system-note">
          ※ 180分コース以上はコースの組み合わせでご利用いただけます。<br>
          <span class="text-mute">[例] 180分＝90分コース×2／300分＝150分コース×2</span><br>
          ※ この場合、指名料も×2・×3…となります。
        </div>
      </div>

      <!-- ② リピート・自宅 -->
      <div class="price-group">
        <div class="price-group-head">
          <span class="price-group-title"><span aria-hidden="true">💗</span> ご指名・ご自宅でご利用</span>
          <span class="neon-chip">2回目以降</span>
        </div>
        <p class="price-group-desc">2回目以降の女性ご指名、またはご自宅でご利用のお客様はこちら。</p>
        <div class="price-table">
          <?php foreach ($priceRepeat as $p): ?>
          <div class="price-row">
            <span class="price-row-course">
              <span class="price-row-time"><?= h($p['time']) ?></span>
            </span>
            <span class="price-row-amount">
              <span class="price-was"><?= h($p['was']) ?></span>
              <span class="price-now"><small>¥</small><?= h($p['now']) ?></span>
            </span>
          </div>
          <?php endforeach; ?>
        </div>
        <div class="system-note">
          ※ ご自宅でご利用のお客様は、女性用のバスタオルをご用意ください。
        </div>
      </div>

      <!-- ③ お泊まり -->
      <div class="price-group">
        <div class="price-group-head">
          <span class="price-group-title"><span aria-hidden="true">🌙</span> お泊まりコース</span>
        </div>
        <p class="price-group-desc">24時〜翌10時の間、最大10時間でのご利用となります。</p>
        <div class="price-table">
          <div class="price-row price-row-feature">
            <span class="price-row-course">
              <span class="price-row-time">お泊り</span>
              <span class="price-row-cond">24時〜翌10時（最大10時間）</span>
            </span>
            <span class="price-row-amount">
              <span class="price-now"><small>¥</small>88,000</span>
            </span>
          </div>
        </div>
        <div class="system-note">
          ※ 10時間の間でお好きな時間にご利用いただけます。<br>
          ※ 本指名の場合は「本指名料×2」、指名がある場合は「指名料×2」となります。
        </div>
      </div>

      <!-- 指名料・延長 -->
      <h2 class="section-label">指名料・延長</h2>
      <div class="fee-card">
        <div class="fee-list">
          <?php foreach ($fees as $f): ?>
          <div class="fee-row">
            <span class="fee-name">
              <?= h($f['name']) ?>
              <?php if (!empty($f['note'])): ?><small><?= h($f['note']) ?></small><?php endif; ?>
            </span>
            <span class="fee-amount"><?= h($f['amount']) ?><?php if (!empty($f['unit'])): ?><small><?= h($f['unit']) ?></small><?php endif; ?></span>
          </div>
          <?php endforeach; ?>
        </div>
      </div>

      <!-- オプション -->
      <h2 class="section-label" style="margin-top:40px;">オプション</h2>
      <div class="fee-card">
        <div class="fee-list">
          <?php foreach ($options as $o): ?>
          <div class="fee-row">
            <span class="fee-name">
              <?= h($o['name']) ?>
              <?php if (!empty($o['note'])): ?><small><?= h($o['note']) ?></small><?php endif; ?>
            </span>
            <span class="fee-amount"><?= h($o['amount']) ?></span>
          </div>
          <?php endforeach; ?>
        </div>
      </div>
      <div class="system-note">
        <span aria-hidden="true">🎁</span> 120分コースのご利用でオモチャ1つ無料、150分コースのご利用でオモチャ全て無料！
      </div>

      <!-- 交通費 -->
      <h2 class="section-label" style="margin-top:40px;">交通費</h2>
      <div class="zone-list">
        <?php foreach ($zones as $z): ?>
        <div class="zone-card">
          <span class="zone-fee"><?= h($z['fee']) ?> エリア</span>
          <span class="zone-area"><?= h($z['area']) ?></span>
        </div>
        <?php endforeach; ?>
      </div>
      <div class="system-note">
        ※ 「〜」表記のエリアは目的地までの距離により変動します。詳しい交通費はお電話・LINEにてご確認ください。
      </div>

      <!-- キャンセル -->
      <h2 class="section-label" style="margin-top:40px;">ご変更・キャンセル</h2>
      <div class="fee-card">
        <table class="cancel-table">
          <tbody>
            <?php foreach ($cancels as $c): ?>
            <tr>
              <th><?= h($c['when']) ?></th>
              <td><?= h($c['fee']) ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <div class="system-note">
        ※ キャンセル料は3日以内にクレジットまたは銀行振込にてお支払いをお願いいたします。<br>
        ※ ご予約のキャンセルは、他のお客様・キャストへの影響も大きいため、できる限りお避けください。
      </div>

      <!-- ご利用にあたって（簡潔版） -->
      <h2 class="section-label" style="margin-top:40px;">ご利用にあたって</h2>
      <div class="notice-box">
        <ul class="notice-list">
          <li>20歳未満の方はご利用いただけません。</li>
          <li>本番行為・盗撮・録音、キャストが嫌がる行為は固くお断りしております。</li>
          <li>キャストへのスカウト・引き抜き行為はご遠慮ください。</li>
          <li>キャストが安心して接客できるよう、ご理解とご協力をお願いいたします。</li>
        </ul>
        <p class="notice-foot">ご不明な点はお気軽にお問い合わせください。</p>
      </div>

      <div class="system-note">
        ※ 料金はすべて税込です。<br>
        ※ 料金・エリアは予告なく変更となる場合がございます。
      </div>

      <!-- CTA -->
      <div class="system-cta">
        <a href="<?= h(SHOP_LINE_URL) ?>" target="_blank" rel="noopener" class="footer-cta-line system-cta-btn">
          <span aria-hidden="true">💬</span> LINEで予約
        </a>
        <a href="tel:<?= h(SHOP_TEL_RAW) ?>" class="glossy-pill footer-cta-tel system-cta-btn">
          <span aria-hidden="true">📞</span> 電話で予約
        </a>
      </div>

    </div>
  </section>
</main>
<?php site_footer(); ?>
