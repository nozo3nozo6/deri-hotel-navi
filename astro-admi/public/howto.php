<?php
$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
require_once $root . '/_inc/shop.php';
require_once $root . '/_inc/head.php';
require_once $root . '/_inc/layout.php';

$title = 'ご利用ガイド｜' . SHOP_FULL_NAME;
$desc  = SHOP_NAME . 'のご利用ガイド。ご予約から当日の流れ、ご自宅・ホテルでのご利用についてわかりやすくご案内します。';

/* ── ご予約の流れ（編集はこのブロックだけでOK） ───────────────────────── */
$steps = [
    [
        'num'   => '1',
        'icon'  => '📞',
        'title' => 'ご希望をお聞かせください',
        'desc'  => '「本日のおすすめの女の子」「ご希望のタイプ」「女の子のご指名」「ご希望の時間帯」「ご希望のオプション」など、お気軽にお聞かせください。',
    ],
    [
        'num'   => '2',
        'icon'  => '🏨',
        'title' => 'ご利用場所・コースをお選びください',
        'desc'  => '「ご自宅・ホテルのどちらでご利用か」「ご利用の地域（市区町村）」「ご希望のコース」などをお聞かせください。',
    ],
    [
        'num'   => '3',
        'icon'  => '💳',
        'title' => 'お支払い方法をお伝えください',
        'desc'  => '「現金」「クレジット決済」「領収書の有無」をお聞かせください。以上をお伺いしましたら、当店ドライバースタッフができる限りお待たせしないよう、安全運転でお伺いします。到着まで、女の子との対面を想像しながら、もう少々お待ちくださいませ。',
    ],
];

/* ── ご利用施設 ───────────────────────────────────────────────────────── */
$facilities = [
    [
        'icon'  => '🏠',
        'title' => 'ご自宅でご利用されるお客様へ',
        'lead'  => 'ご自宅でのご利用を選ばれるお客様は全体の半数以上。その理由は…',
        'points' => [
            'ホテルの利用時間を気にしなくて良い',
            '外出することなくご利用いただける',
            'ホテル料金を節約できる',
        ],
        'body'  => 'なかでも<strong>コストを抑えられること</strong>が最大のメリット。浮いた分だけコースを長くして、ゆっくりとお過ごしになるお客様が多くいらっしゃいます。お伺いする女の子たちはお部屋を汚さないよう十分に配慮してサービスいたしますので、安心してご自宅でお待ちください。',
    ],
    [
        'icon'  => '🏨',
        'title' => 'ホテルでご利用されるお客様へ',
        'lead'  => '吉祥寺エリアを中心に、行く先々で手軽にご利用いただけるのがホテルです。',
        'points' => [],
        'body'  => '非日常的な空間で、いつもより少しドキドキとワクワクを感じられるのではないでしょうか。出張中の方、一人暮らしではない方、ご自宅に呼ぶのは少し…という方に多く選ばれています。<br><br>ホテルは<strong>ラブホテル・ビジネスホテル・レンタルルーム</strong>と大きく分かれ、コスパが一番良いのはレンタルルームです。予算を抑えてコースを長めにされたい方におすすめです。<br><br>※ ビジネスホテルはフロントで止められるなど、ご利用いただけない場合もございます。事前情報は当店で把握しておりますので、お気軽にご相談ください。',
    ],
    [
        'icon'  => '📝',
        'title' => 'お客様へのお願い',
        'lead'  => '',
        'points' => [],
        'body'  => 'ご自宅でのご利用の際は、<strong>バスタオルのご用意</strong>をお願いしております。ご予約の際にご要望をいただけましたら、当店より1枚お持ちすることも可能でございます。ただし、状況によりご用意できない場合もございますので、あらかじめご了承いただけますと幸いです。<br><br>現金でのお支払いは、お釣りの出ないようご用意いただけますと大変助かります。領収証が必要な方は、お支払い方法をお伝えの際にお申し付けください。',
    ],
];
/* ───────────────────────────────────────────────────────────────────── */

site_head($title, $desc, 'https://kichifu.com/howto');
site_header();
?>
<main>
  <section class="page-section">
    <div class="neon-room"></div>
    <div class="wrap-md" style="position:relative;z-index:1;">

      <nav class="breadcrumb">
        <a href="/top">トップ</a>
        <span class="breadcrumb-sep">›</span>
        <span>ご利用ガイド</span>
      </nav>

      <div class="section-head">
        <span class="section-eyebrow holo-text">HOW TO</span>
        <h1 class="section-title">ご利用ガイド</h1>
      </div>

      <!-- ご予約の流れ -->
      <h2 class="section-label">ご予約の流れ</h2>
      <div class="steps-list">
        <?php foreach ($steps as $s): ?>
        <div class="step-row">
          <div class="step-num"><?= h($s['num']) ?></div>
          <div class="step-body">
            <p class="step-title"><?= h($s['icon']) ?> <?= h($s['title']) ?></p>
            <p class="step-desc"><?= h($s['desc']) ?></p>
          </div>
        </div>
        <?php endforeach; ?>
      </div>

      <!-- ご利用施設 -->
      <h2 class="section-label" style="margin-top:48px;">ご利用施設</h2>
      <div class="facility-list">
        <?php foreach ($facilities as $f): ?>
        <div class="facility-card">
          <div class="facility-card-head">
            <span class="facility-card-icon" aria-hidden="true"><?= h($f['icon']) ?></span>
            <span class="facility-card-title"><?= h($f['title']) ?></span>
          </div>
          <?php if (!empty($f['lead'])): ?><p class="facility-card-lead"><?= h($f['lead']) ?></p><?php endif; ?>
          <?php if (!empty($f['points'])): ?>
          <ul class="facility-points">
            <?php foreach ($f['points'] as $p): ?><li><?= h($p) ?></li><?php endforeach; ?>
          </ul>
          <?php endif; ?>
          <p class="facility-card-body"><?= $f['body'] ?></p>
        </div>
        <?php endforeach; ?>
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
