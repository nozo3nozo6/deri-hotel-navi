<?php
// キャッシュバスターは admin.js の更新時刻から自動生成する。
// 固定文字列(?v=20260716b)のままだと、admin.js を直しても各端末が古いJSを
// 掴み続ける（2026-08-02: 出勤トグルの「終了」が反映されない事象の原因）。
// CTRL 本体の admin.css / list.js と同じ filemtime 方式に揃えた。
$APP_VERSION = (string)(@filemtime(__DIR__ . '/../admin.js') ?: '1');

// 💬 チャットタブに読み込む YobuChat の店舗受信箱。
// 店舗ごとに slug が違うので、店舗を増やすときはここを変える（アドミ立川 = 0tkzk670）。
define('OPS_CHAT_URL', 'https://yobuho.com/chat/0tkzk670/');

header('Cache-Control: no-store, no-cache, must-revalidate');
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>店舗運営｜ADMI CTRL</title>
<!-- PWA (iPhone ホーム画面追加で Web Push 受信可能 / iOS 16.4+) -->
<link rel="manifest" href="/ctrl-manifest.webmanifest">
<meta name="theme-color" content="#0a3d52">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ADMI運営">
<!-- 店舗運営(オペレーション) favicon: 青白系の「A」。CTRL本体(コーラル)と区別 -->
<link rel="icon" href="/ctrl/ops/favicon.svg?v=<?= @filemtime(__DIR__ . '/../favicon.svg') ?: '1' ?>" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --deep:#0a3d52;--sea:#1d7a9c;--aqua:#5bbcd4;--aqua-light:#a8e0ea;
    --foam:#eef9fb;--sand:#f7f4ec;--ink:#173842;--ink-soft:#4a6670;
    --white:#ffffff;--coral:#ff9a76;--green:#3a9a60;--red:#dc3545;--gray:#e2e8ec;
    --visited:#3a9a60;--inquiry:#ff9a76;--unavailable:#8a8e92;--unset:#cbd1d6;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Zen Maru Gothic',sans-serif;color:var(--ink);background:var(--foam);-webkit-font-smoothing:antialiased;}
  .en{font-family:'Outfit',sans-serif;}
  button{font-family:'Zen Maru Gothic';cursor:pointer;}
  input,select,textarea{font-family:'Zen Maru Gothic';}

  /* Header: ロゴ・タブ・ユーザー情報を1行に統合（タイムラインの縦スペース確保のため2行→1行化） */
  header{background:var(--white);box-shadow:0 2px 12px rgba(10,61,82,.06);position:sticky;top:0;z-index:100;}
  .header-inner{display:flex;align-items:center;gap:1rem;padding:.7rem 1.5rem;max-width:1600px;margin:0 auto;}
  .logo{display:inline-flex;align-items:center;gap:.5rem;color:var(--deep);text-decoration:none;flex:none;}
  .logo svg{width:26px;height:26px;color:var(--deep);}
  .logo .name{font-family:'Outfit';font-weight:700;font-size:1.3rem;letter-spacing:.3em;}
  .logo .badge{font-size:.65rem;background:var(--sea);color:#fff;padding:.18rem .55rem;border-radius:10px;letter-spacing:.15em;font-weight:600;margin-left:.4rem;}
  .header-right{display:flex;align-items:center;gap:1rem;flex:none;}
  .header-right .email{color:var(--ink-soft);font-size:.85rem;}
  @media(max-width:600px){.header-right .email{display:none;}}
  .btn-logout{background:transparent;border:1.5px solid var(--gray);color:var(--ink-soft);padding:.45rem 1rem;border-radius:8px;font-size:.85rem;transition:all .2s;}
  .btn-logout:hover{background:var(--red);color:#fff;border-color:var(--red);}

  /* Tab nav: header-inner内でロゴとユーザー情報の間を埋め、余った分だけ横スクロール。
     min-width を確保し、狭い画面でロゴ/ユーザー情報に押されてタブが消えないようにする */
  .tab-nav{background:transparent;display:flex;flex-wrap:nowrap;overflow-x:auto;flex:1 1 auto;min-width:90px;}
  .tab-btn{background:transparent;border:none;white-space:nowrap;flex-shrink:0;padding:.7rem .85rem;font-size:.86rem;color:var(--ink-soft);font-weight:600;border-bottom:3px solid transparent;cursor:pointer;transition:all .2s;}
  .tab-btn:hover{color:var(--sea);}
  .tab-btn.active{color:var(--deep);border-bottom-color:var(--coral);}
  .tab-btn.owner-only{display:none;}
  body.is-owner .tab-btn.owner-only{display:block;}
  /* 店長: 名前プルダウンでモード切替（マネージャー管理 / キャスト管理） */
  .user-menu{position:relative;}
  .user-name-btn{display:flex;align-items:center;gap:.3rem;background:transparent;border:none;color:var(--ink-soft);font-size:.85rem;font-weight:600;padding:.3rem .2rem;cursor:default;}
  .user-menu.has-modes .user-name-btn{cursor:pointer;padding:.3rem .7rem;border:1.5px solid var(--gray);border-radius:50px;}
  .user-menu.has-modes .user-name-btn:hover{border-color:var(--sea);color:var(--sea);}
  .user-caret{font-size:.7rem;transition:transform .15s;}
  .user-menu.open .user-caret{transform:rotate(180deg);}
  .user-dropdown{display:none;position:absolute;right:0;top:calc(100% + .4rem);background:var(--white);border:1.5px solid var(--gray);border-radius:12px;box-shadow:0 8px 24px rgba(10,61,82,.16);padding:.35rem;min-width:200px;z-index:200;}
  .user-menu.open .user-dropdown{display:block;}
  .user-dd-item{display:block;width:100%;text-align:left;background:transparent;border:none;padding:.6rem .8rem;font-size:.9rem;font-weight:700;color:var(--deep);border-radius:8px;cursor:pointer;white-space:nowrap;}
  .user-dd-item:hover{background:var(--aqua-light);}
  .user-dd-item.active{background:var(--deep);color:#fff;}
  /* 名前(.email)はPCのみ非表示だったが、店長の切替プルダウンはモバイルでも必須なので表示 */
  @media(max-width:600px){.header-right .user-menu.has-modes .email{display:inline;}}
  /* 店長: 入口の2択カード */
  .entry-wrap{max-width:480px;margin:0 auto;padding:1.5rem 1rem;text-align:center;}
  .entry-title{font-size:1.1rem;color:var(--deep);margin:0 0 .2rem;font-weight:800;}
  .entry-sub{color:var(--ink-soft);margin:0 0 1rem;font-size:.82rem;}
  .entry-cards{display:flex;flex-direction:column;gap:.6rem;}
  .entry-card{display:flex;flex-direction:row;align-items:center;gap:.7rem;background:var(--white);border:2px solid var(--gray);border-radius:50px;padding:.6rem 1.2rem;cursor:pointer;transition:all .15s;box-shadow:0 2px 8px rgba(10,61,82,.06);text-align:left;}
  .entry-card.active{background:var(--deep);border-color:var(--deep);}
  .entry-card.active .entry-name,.entry-card.active .entry-desc{color:#fff;}
  .entry-card:hover{border-color:var(--coral);}
  .entry-ico{font-size:1.3rem;line-height:1;flex-shrink:0;}
  .entry-name{font-size:.95rem;font-weight:700;color:var(--deep);}
  .entry-desc{font-size:.75rem;color:var(--ink-soft);line-height:1.4;margin-top:.1rem;}
  .ac-tab{background:transparent;border:none;padding:.7rem 1rem;font-size:.9rem;color:var(--ink-soft);font-weight:600;border-bottom:3px solid transparent;cursor:pointer;transition:all .2s;margin-bottom:-1.5px;}
  .ac-tab:hover{color:var(--sea);}
  .ac-tab.active{color:var(--deep);border-bottom-color:var(--coral);}
  .view{display:none;}
  .view.active{display:block;}

  /* Staff page */
  .staff-main{padding:1.5rem;max-width:1100px;margin:0 auto;}
  .staff-head{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin-bottom:1.3rem;}
  .staff-head h2{font-size:1.2rem;font-weight:700;color:var(--deep);}
  .btn-primary-coral{background:var(--coral);color:#fff;border:none;padding:.6rem 1.4rem;border-radius:50px;font-size:.9rem;font-weight:600;cursor:pointer;}
  .btn-primary-coral:hover{background:var(--deep);}
  .btn-ghost{background:#fff;border:1.5px solid var(--gray);color:var(--ink-soft);padding:.5rem 1rem;border-radius:50px;
    font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;}
  .btn-ghost:hover{border-color:var(--sea);color:var(--sea);background:var(--foam);}
  .staff-table{background:var(--white);border-radius:14px;padding:.5rem;box-shadow:0 4px 14px rgba(10,61,82,.05);}
  .staff-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:.9rem;padding:.9rem 1.1rem;border-bottom:1px solid var(--gray);align-items:center;}
  /* スマホ: スタッフ行をカード型に組み替え (横並び→2段) */
  @media(max-width:780px){
    .staff-row{
      grid-template-columns: auto auto 1fr !important;
      grid-template-areas: 'drag thumb info' 'meta meta meta' 'actions actions actions' !important;
      gap:.5rem .6rem!important;
      padding:.7rem .8rem!important;
      align-items:center;
    }
    .staff-row .drag-handle{grid-area:drag;}
    .staff-row > img,.staff-row > div[style*="border-radius:10px"]{grid-area:thumb;}
    .staff-row .sr-role{grid-area:thumb;display:none;}
    /* スタッフ管理は「オーナー／内勤／ドライバー」の区別が要るので、スマホでも権限を出す。
       キャスト管理は全員キャストで意味がないため出さない（店長指摘 2026-09-01） */
    #staffTable .staff-row{grid-template-areas:'drag thumb info' 'role role role' 'meta meta meta' 'actions actions actions'!important;}
    #staffTable .staff-row .sr-role{grid-area:role;display:inline-block;justify-self:start;}
    .staff-row .sr-info{grid-area:info;min-width:0;}
    .staff-row .sr-info .sr-name{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;}
    /* スマホでも 登録日・専用URL・暗証番号 を出す（横並びの1列に押し込むと消えてしまうので、
       名前の下に丸ごと1段とる）。店長指摘 2026-09-01 */
    .staff-row .sr-meta{grid-area:meta;min-width:0;width:100%;font-size:.76rem;}
    .staff-row .sr-meta:empty{display:none;}
    .staff-row .sr-access{margin-top:.5rem;padding-top:.5rem;gap:.5rem;}
    .staff-row .sra-url-in{font-size:16px;padding:.45rem .55rem;}
    .staff-row .sra-copy{padding:.42rem .65rem;font-size:.95rem;}
    .staff-row .sra-btn{padding:.42rem .8rem;font-size:.76rem;}
    .staff-row .sra-pin{font-size:.78rem;}
    .staff-row .sra-note{font-size:.74rem;}
    .staff-row .sr-driver{margin-top:.45rem!important;padding:.42rem .9rem!important;font-size:.78rem!important;}
    .staff-row .sr-actions{
      grid-area:actions;
      display:flex!important;flex-direction:row!important;flex-wrap:wrap;gap:.4rem;
      justify-self:stretch!important;width:100%;
    }
    .staff-row .sr-actions button{flex:1;min-width:0;writing-mode:horizontal-tb!important;white-space:nowrap;font-size:.78rem;padding:.5rem .3rem!important;}
  }
  .staff-row:last-child{border-bottom:none;}
  .sr-role{padding:.3rem .7rem;border-radius:50px;font-size:.74rem;font-weight:700;letter-spacing:.06em;white-space:nowrap;}
  /* 白抜き文字は薄い地だと読めなかったので、地を淡く・文字を同系の濃色にする（店長指摘 2026-08-06）。
     兼任つきで文字数が増えても読めるよう、5つの権限すべてに色を用意する */
  .sr-role.owner{background:#fbe7dd;color:#a2461d;border:1px solid #f0bda3;}
  .sr-role.manager{background:#ddeff4;color:#125b70;border:1px solid #a5d2de;}
  .sr-role.office{background:#efe9f8;color:#573c78;border:1px solid #cab7e2;}
  .sr-role.driver{background:#e4f1e2;color:#2d6733;border:1px solid #b3d6b3;}
  .sr-role.staff{background:#eef8fa;color:#12667e;border:1px solid #b7dde6;}

  /* 権限管理テーブル (ロールは5列: owner/manager/office/staff/driver) */
  .perm-table{background:#fff;border-radius:14px;padding:1rem;box-shadow:0 4px 14px rgba(10,61,82,.05);overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .perm-row{display:grid;grid-template-columns:minmax(150px,1fr) repeat(3,72px);gap:.6rem;padding:.85rem 1rem;border-bottom:1px solid var(--gray);align-items:center;min-width:460px;}
  .perm-row.header .perm-cell{text-align:center;line-height:1.2;}
  @media(max-width:780px){
    .perm-table{padding:.55rem;}
    .perm-row{grid-template-columns:128px repeat(3,56px);gap:.3rem;padding:.6rem .35rem;min-width:max-content;}
    .perm-row.header{font-size:.62rem;}
    .perm-name{font-size:.8rem;}
    .perm-name .perm-desc{font-size:.64rem;}
    .perm-cell input[type="checkbox"]{width:20px;height:20px;}
  }

  /* ========== 駅マスタグループ表示 ========== */
  .st-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:.45rem;}
  .st-grid .bk-row{margin-bottom:0;}
  .st-toolbar{padding:.7rem;border-bottom:1px solid var(--gray);background:var(--foam);margin-bottom:.7rem;border-radius:10px;}
  .st-group{margin-bottom:.5rem;border:1.5px solid rgba(91,188,212,.2);border-radius:12px;overflow:hidden;background:#fff;}
  .st-group-head{background:linear-gradient(135deg,var(--foam),#fff);padding:.55rem 1rem;font-weight:700;color:var(--deep);font-size:.95rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(91,188,212,.25);}
  .st-group-count{font-size:.75rem;color:var(--ink-soft);font-weight:500;}
  .st-group-list .bk-row{border-bottom:1px solid rgba(91,188,212,.12);background:#fff;border-radius:0;box-shadow:none;}
  .st-group-list .bk-row:last-child{border-bottom:none;}

  /* ========== チャット管理 ========== */
  .tab-badge{display:inline-block;background:#ff4d4f;color:#fff;border-radius:10px;min-width:20px;height:20px;line-height:20px;text-align:center;font-size:.7rem;font-weight:700;margin-left:.4rem;padding:0 6px;}
  .chat-admin{padding:1.5rem;max-width:1200px;margin:0 auto;}
  .chat-admin-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.8rem;}
  .chat-admin-head h2{font-size:1.4rem;color:var(--deep);}
  .chat-admin-grid{display:grid;grid-template-columns:340px 1fr;gap:1rem;background:var(--white);border-radius:16px;overflow:hidden;box-shadow:0 6px 20px rgba(10,61,82,.08);min-height:60vh;height:65vh;}
  .ca-back-mobile{display:none;background:transparent;border:none;color:var(--sea);font-size:.85rem;font-weight:600;padding:.3rem .6rem .3rem 0;cursor:pointer;white-space:nowrap;}
  @media(max-width:780px){
    .chat-admin-grid{grid-template-columns:1fr;height:calc(100dvh - 220px);min-height:480px;}
    .chat-admin-grid:not(.show-thread) .ca-thread{display:none;}
    .chat-admin-grid.show-thread .ca-inbox{display:none;}
    .chat-admin-grid.show-thread .ca-back-mobile{display:inline-flex;align-items:center;gap:.2rem;}
  }
  .ca-inbox{border-right:1px solid var(--gray);overflow-y:auto;background:var(--foam);}
  .ca-inbox-item{padding:.85rem 1rem;border-bottom:1px solid rgba(91,188,212,.2);cursor:pointer;transition:background .15s;position:relative;}
  .ca-inbox-item:hover{background:rgba(91,188,212,.1);}
  .ca-inbox-item.active{background:var(--white);border-left:3px solid var(--sea);}
  .ca-inbox-item .ci-name{font-weight:700;color:var(--deep);font-size:.95rem;display:flex;justify-content:space-between;align-items:center;}
  .ca-inbox-item .ci-preview{color:var(--ink-soft);font-size:.82rem;margin-top:.2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .ca-inbox-item .ci-time{font-size:.7rem;color:var(--ink-soft);font-family:'Outfit';}
  .ca-inbox-item .ci-unread{background:#ff4d4f;color:#fff;border-radius:10px;padding:0 7px;font-size:.7rem;font-weight:700;min-width:20px;text-align:center;}
  .ca-inbox-item .ci-bk-badge{display:inline-block;background:linear-gradient(135deg,#c799d0,#9b6db0);color:#fff;border-radius:10px;padding:.1rem .55rem;font-size:.7rem;font-weight:700;cursor:pointer;transition:transform .15s;}
  .ca-inbox-item .ci-bk-badge:hover{transform:scale(1.05);}
  .ca-thread{display:flex;flex-direction:column;overflow:hidden;}
  .ca-thread-head{padding:1rem 1.2rem;border-bottom:1px solid var(--gray);font-weight:700;color:var(--deep);background:var(--white);font-size:.95rem;}
  .ca-messages{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.5rem;background:linear-gradient(180deg,var(--foam),#f4faff);}
  .ca-msg{max-width:75%;padding:.6rem .9rem;border-radius:16px;font-size:.92rem;line-height:1.5;word-break:break-word;white-space:pre-wrap;box-shadow:0 1px 3px rgba(0,0,0,.05);}
  .ca-msg-visitor{align-self:flex-start;background:var(--white);border:1px solid rgba(91,188,212,.25);border-bottom-left-radius:6px;}
  .ca-msg-owner{align-self:flex-end;background:linear-gradient(135deg,var(--aqua),var(--sea));color:#fff;border-bottom-right-radius:6px;}
  .ca-msg-system{align-self:center;background:rgba(91,188,212,.15);color:var(--ink-soft);font-size:.78rem;padding:.3rem .8rem;border-radius:10px;}
  .ca-msg-meta{font-size:.65rem;opacity:.7;font-family:'Outfit';margin-top:.2rem;}
  .ca-reply{position:relative;display:flex;gap:.5rem;padding:.7rem;border-top:1px solid var(--gray);background:var(--white);align-items:flex-end;}
  .ca-reply textarea{flex:1;border:1.5px solid rgba(91,188,212,.3);border-radius:12px;padding:.6rem .8rem;font-family:inherit;font-size:.95rem;resize:none;max-height:120px;}
  .ca-reply textarea:focus{outline:none;border-color:var(--sea);}
  .ca-reply button{flex-shrink:0;}
  .ca-tpl-btn{background:var(--white);border:1.5px solid rgba(91,188,212,.4);border-radius:12px;padding:.55rem .7rem;font-size:1.05rem;line-height:1;cursor:pointer;color:var(--sea);}
  .ca-tpl-btn:hover{background:var(--foam);}
  .ca-tpl-panel{position:absolute;left:.7rem;right:.7rem;bottom:calc(100% + .3rem);background:#fff;border:1px solid var(--gray);border-radius:14px;box-shadow:0 8px 28px rgba(10,61,82,.18);max-height:320px;overflow-y:auto;z-index:30;}
  .ca-tpl-panel .tpl-head{display:flex;justify-content:space-between;align-items:center;padding:.65rem .9rem;border-bottom:1px solid var(--gray);position:sticky;top:0;background:#fff;}
  .ca-tpl-panel .tpl-head b{font-size:.9rem;color:var(--deep);}
  .ca-tpl-panel .tpl-head button{background:none;border:none;color:var(--sea);font-size:.82rem;cursor:pointer;font-weight:600;padding:.2rem .3rem;}
  .ca-tpl-item{padding:.6rem .9rem;border-bottom:1px dashed var(--gray);cursor:pointer;}
  .ca-tpl-item:hover{background:var(--foam);}
  .ca-tpl-item .tpl-title{font-size:.82rem;font-weight:700;color:var(--deep);margin-bottom:.15rem;}
  .ca-tpl-item .tpl-body{font-size:.78rem;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ca-tpl-empty{padding:1rem;text-align:center;color:var(--ink-soft);font-size:.82rem;}
  .em-entry-chips{display:flex;flex-wrap:wrap;gap:.5rem;}
  .em-entry-chips .em-chip{padding:.5rem .9rem;background:var(--white);border:1.5px solid rgba(91,188,212,.3);border-radius:50px;font-size:.88rem;cursor:pointer;user-select:none;transition:all .15s;color:var(--ink);}
  .em-entry-chips .em-chip:hover{background:var(--foam);}
  .em-entry-chips .em-chip.active{background:linear-gradient(135deg,var(--aqua),var(--sea));color:#fff;border-color:var(--sea);font-weight:700;box-shadow:0 3px 10px rgba(29,122,156,.25);}
  .perm-row:last-child{border-bottom:none;}
  .perm-row.header{font-weight:700;color:var(--ink-soft);font-size:.82rem;background:var(--foam);border-radius:8px;}
  .perm-name{font-weight:600;color:var(--ink);}
  .perm-name .perm-desc{display:block;font-size:.78rem;color:var(--ink-soft);font-weight:400;margin-top:.15rem;}
  .perm-cell{display:flex;justify-content:center;}
  .perm-cell input[type="checkbox"]{width:22px;height:22px;cursor:pointer;accent-color:var(--sea);}
  .perm-cell input[type="checkbox"]:disabled{opacity:.4;cursor:not-allowed;}
  .sr-info .sr-name{font-weight:700;font-size:1rem;color:var(--ink);}
  .sr-info .sr-email{font-size:.84rem;color:var(--ink-soft);margin-top:.1rem;}
  .sr-meta{font-size:.78rem;color:var(--ink-soft);}
  .sr-actions{display:flex;gap:.4rem;flex-wrap:wrap;}
  .sr-actions button{padding:.4rem .75rem;border-radius:7px;font-size:.78rem;font-weight:600;border:1.5px solid var(--gray);background:#fff;color:var(--ink-soft);cursor:pointer;transition:all .15s;}
  .sr-actions .sr-edit{background:var(--white);border:1.5px solid var(--sea);color:var(--sea);}
  .sr-actions .sr-edit:hover{background:var(--sea);color:#fff;border-color:var(--sea);}
  .sr-actions .sr-pw:hover{background:var(--coral);color:#fff;border-color:var(--coral);}
  .sr-actions .sr-del:hover{background:var(--red);color:#fff;border-color:var(--red);}
  .sr-actions button:disabled{opacity:.4;cursor:not-allowed;}
  .staff-row.sortable.dragging{opacity:.35;}
  .staff-row.sortable.drag-over-top{border-top:3px solid var(--coral);}
  .staff-row.sortable.drag-over-bottom{border-bottom:3px solid var(--coral);}

  /* Modal generic */
  .pw-display{background:var(--foam);padding:.85rem 1rem;border-radius:10px;font-family:'Outfit';font-size:1.05rem;color:var(--deep);letter-spacing:.04em;text-align:center;margin:.8rem 0 .5rem;word-break:break-all;font-weight:600;}
  .pw-display-note{font-size:.78rem;color:var(--red);text-align:center;}
  .field-row{display:grid;grid-template-columns:1fr auto;gap:.5rem;}
  .field-row button{padding:.6rem 1rem;background:var(--foam);border:1.5px solid var(--aqua);color:var(--sea);border-radius:8px;font-size:.85rem;cursor:pointer;font-weight:600;white-space:nowrap;}
  .field-row button:hover{background:var(--aqua);color:#fff;}

  /* Stats Bar */
  .stats{background:linear-gradient(160deg,var(--deep),var(--sea));color:#fff;padding:1.2rem 1.5rem;}
  .stats-inner{max-width:1600px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:1rem;}
  @media(max-width:480px){.stats-inner{gap:.6rem;}}
  .stat{text-align:center;padding:.4rem;}
  .stat .num{font-family:'Outfit';font-size:1.8rem;font-weight:700;line-height:1;}
  .stat .num.visited{color:#7ce0a0;}
  .stat .num.inquiry{color:#ffc2a8;}
  .stat .num.unavailable{color:rgba(255,255,255,.65);}
  .stat .num.unset{color:rgba(255,255,255,.5);}
  .stat .lbl{font-size:.72rem;color:rgba(255,255,255,.78);margin-top:.3rem;letter-spacing:.06em;}

  /* Filter Bar */
  .filter-bar{background:var(--white);padding:1rem 1.5rem;border-bottom:1px solid var(--gray);position:sticky;top:68px;z-index:90;}
  .filter-inner{max-width:1600px;margin:0 auto;display:grid;grid-template-columns:200px 200px 1fr auto;gap:.7rem;align-items:center;}
  @media(max-width:780px){.filter-inner{grid-template-columns:1fr 1fr;}.filter-inner .reset-wrap{grid-column:1/-1;}}
  .filter-bar select,.filter-bar input{padding:.6rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.92rem;background:var(--white);color:var(--ink);}
  .filter-bar select:focus,.filter-bar input:focus{outline:none;border-color:var(--sea);}
  .filter-bar input[type="search"]{font-size:16px;}
  .btn-reset{background:var(--foam);color:var(--ink-soft);border:1.5px solid var(--gray);padding:.55rem 1.1rem;border-radius:8px;font-size:.85rem;transition:all .2s;}
  .btn-reset:hover{background:var(--aqua);color:#fff;border-color:var(--aqua);}

  /* Bulk Bar */
  .bulk-bar{background:var(--deep);color:#fff;padding:.7rem 1.5rem;display:none;position:sticky;top:136px;z-index:85;}
  .bulk-bar.show{display:block;}
  .bulk-inner{max-width:1600px;margin:0 auto;display:flex;align-items:center;gap:1rem;justify-content:space-between;flex-wrap:wrap;}
  .bulk-info{font-size:.92rem;}
  .bulk-info b{color:var(--aqua-light);font-family:'Outfit';font-weight:700;font-size:1.1rem;margin:0 .3rem;}
  .bulk-actions{display:flex;gap:.45rem;flex-wrap:wrap;}
  .bulk-actions button{padding:.45rem .9rem;border-radius:8px;border:none;font-size:.82rem;font-weight:600;white-space:nowrap;}
  .btn-bulk-visited{background:var(--visited);color:#fff;}
  .btn-bulk-inquiry{background:var(--inquiry);color:#fff;}
  .btn-bulk-unavailable{background:var(--unavailable);color:#fff;}
  .btn-bulk-unset{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.4)!important;}
  .btn-bulk-clear{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.4)!important;}
  /* 交通費の一括設定（区切り線＋選択＋実行ボタン） */
  .bulk-sep{width:1px;align-self:stretch;background:rgba(255,255,255,.25);margin:0 .15rem;}
  .bulk-fee-select{padding:.45rem .7rem;border-radius:8px;border:1.5px solid rgba(255,255,255,.4);background:#fff;color:var(--ink);font-size:.82rem;font-weight:600;}
  .btn-bulk-fee{background:var(--aqua);color:var(--deep)!important;}
  .btn-bulk-fee:disabled{opacity:.4;cursor:not-allowed;}
  @media(max-width:640px){.bulk-sep{display:none;}}

  /* Hotel List */
  .main{padding:1.5rem;max-width:1600px;margin:0 auto;}
  .results-bar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.9rem;padding:0 .2rem;gap:.8rem;flex-wrap:wrap;}
  .select-all-wrap{display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.85rem;color:var(--ink-soft);font-weight:600;white-space:nowrap;}
  .select-all-wrap input{width:16px;height:16px;cursor:pointer;margin:0;}
  .results-bar .count{color:var(--ink-soft);font-size:.92rem;}
  .results-bar .count b{color:var(--deep);font-family:'Outfit';font-weight:700;font-size:1.1rem;margin:0 .15rem;}

  .hotel-row{background:var(--white);border-radius:14px;padding:1rem 1.2rem;margin-bottom:.55rem;display:grid;grid-template-columns:auto auto 1fr auto;gap:.9rem;align-items:center;box-shadow:0 3px 12px rgba(10,61,82,.05);transition:all .2s;border:1.5px solid transparent;}
  .hotel-row:hover{box-shadow:0 6px 18px rgba(10,61,82,.1);}
  /* 並び順=自分の順番 のときだけ出るドラッグ用の掴み手 */
  .hotel-row.sortable{grid-template-columns:auto auto auto 1fr auto;cursor:grab;}
  .hotel-row.sortable:active{cursor:grabbing;}
  .hotel-row.sortable.dragging{opacity:.35;}
  .hotel-row.sortable.drag-over-top{border-top:3px solid var(--coral);}
  .hotel-row.sortable.drag-over-bottom{border-bottom:3px solid var(--coral);}
  .hotel-row.status-visited{border-color:rgba(58,154,96,.4);background:linear-gradient(135deg,var(--white),#f0fbf4);}
  .hotel-row.status-inquiry{border-color:rgba(255,154,118,.4);background:linear-gradient(135deg,var(--white),#fff5f0);}
  .hotel-row.status-unavailable{border-color:rgba(138,142,146,.3);opacity:.85;}
  .hotel-row.selected{outline:2px solid var(--coral);outline-offset:-2px;}
  @media(max-width:980px){.hotel-row{grid-template-columns:auto 1fr;gap:.7rem;}.hotel-row .row-status{grid-column:1/-1;}.hotel-row .row-actions{grid-column:1/-1;}}

  .row-check{display:flex;align-items:center;}
  .row-check input{width:18px;height:18px;cursor:pointer;accent-color:var(--coral);}

  .row-status{display:flex;gap:.25rem;}
  .row-status .sbtn{padding:.32rem .6rem;border-radius:7px;font-size:.74rem;font-weight:700;border:1.5px solid var(--gray);background:#f6f8f9;color:var(--ink-soft);cursor:pointer;transition:all .18s;letter-spacing:.04em;white-space:nowrap;}
  .row-status .sbtn:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(0,0,0,.08);}
  .row-status .sbtn.active{color:#fff;}
  .row-status .sbtn.v-visited.active{background:var(--visited);border-color:var(--visited);box-shadow:0 3px 8px rgba(58,154,96,.4);}
  .row-status .sbtn.v-inquiry.active{background:var(--inquiry);border-color:var(--inquiry);box-shadow:0 3px 8px rgba(255,154,118,.4);}
  .row-status .sbtn.v-unavailable.active{background:var(--unavailable);border-color:var(--unavailable);box-shadow:0 3px 8px rgba(138,142,146,.4);}
  .row-status .sbtn.v-unset.active{background:#aab2b7;border-color:#aab2b7;color:#fff;}

  .row-info{min-width:0;}
  .row-name{font-size:1rem;font-weight:700;color:var(--ink);line-height:1.4;margin-bottom:.2rem;}
  .row-meta{display:flex;flex-wrap:wrap;gap:.4rem 1rem;font-size:.82rem;color:var(--ink-soft);}
  .row-meta b{color:var(--sea);font-weight:600;}
  /* 交通費は常に表示（未設定でもそう分かるように）。値の有無で濃淡を分ける */
  .row-meta .row-fee-unset{opacity:.55;}
  .row-meta .row-fee-unset b{color:var(--ink-soft);}
  .row-meta .badge-mini{background:var(--foam);color:var(--sea);padding:.1rem .5rem;border-radius:6px;font-size:.72rem;font-weight:600;}
  /* かな以外で始まるのに読み仮名が無い＝あいうえお順の位置がずれるもの */
  .row-meta .badge-kana{background:#fff3e0;color:#a85a00;}

  .row-actions{display:flex;gap:.5rem;}
  .btn-edit{background:var(--white);border:1.5px solid var(--sea);color:var(--sea);padding:.4rem .9rem;border-radius:8px;font-size:.82rem;font-weight:600;transition:all .2s;}
  .btn-edit:hover{background:var(--sea);color:#fff;}

  /* Modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(7,43,58,.7);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:200;padding:1rem;}
  .modal-overlay.show{display:flex;}
  .modal{background:#fff;border-radius:20px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;padding:0;box-shadow:0 30px 60px rgba(0,0,0,.4);}

  /* 透過 + ドラッグ可能なモーダル（予約モーダル用） */
  /* overlay 自体は全画面に居るが pointer-events:none で背景タイムラインに透過 */
  /* .modal だけ pointer-events:auto にしてモーダル操作可能 */
  .modal-overlay.transparent{display:none;background:transparent;backdrop-filter:none;pointer-events:none;}
  .modal-overlay.transparent.show{display:block;}
  .modal-overlay.transparent.minimized{display:none;}
  .modal-overlay.transparent .modal{
    pointer-events:auto;
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:250;border:2px solid var(--sea);box-shadow:0 20px 50px rgba(7,43,58,.4);
    max-height:88vh;overflow-y:auto;
  }
  .modal.draggable{cursor:default;}
  /* 右上に ×（閉じる）と ＿（最小化）を固定配置。右側に余白を確保して中身と被らせない */
  .modal.draggable .modal-header{cursor:grab;user-select:none;background:linear-gradient(180deg,var(--foam),#fff);border-radius:18px 18px 0 0;position:sticky;top:0;z-index:2;padding-right:5rem;}
  .modal.draggable .modal-header::before{content:"⋮⋮";position:absolute;top:1rem;left:50%;transform:translateX(-50%);color:var(--ink-soft);font-size:.7rem;letter-spacing:.3em;opacity:.6;}
  /* 予約内容サマリーバー: ヘッダー同様にモーダル下端へ固定（ボタン行は通常スクロール） */
  /* 高さを取りすぎないよう詰める（入力中は常に見える帯なので圧迫感を減らす） */
  .bm-summary-bar{position:sticky;bottom:0;z-index:3;display:none;align-items:flex-start;justify-content:space-between;gap:.6rem;padding:.45rem 1.1rem;background:linear-gradient(0deg,var(--foam),#fff);border-top:1.5px solid var(--aqua-light,#bfe3e8);border-radius:0 0 18px 18px;box-shadow:0 -4px 12px rgba(7,43,58,.08);}
  .bm-summary-bar.show{display:flex;}
  /* 省略せず全部出す（2段以上になってもよい＝店長要望 2026-08-05）。
     伸びすぎたときだけ帯の中でスクロールさせる */
  .bm-summary-bar .bm-sum-main{flex:1;min-width:0;font-size:.84rem;font-weight:600;color:var(--ink);line-height:1.5;
    white-space:normal;overflow-wrap:anywhere;max-height:5.4em;overflow-y:auto;}
  /* 意味の固まりごとに改行（1行目=日時とコース / 2行目=お客様・場所 / 3行目=料金） */
  .bm-summary-bar .fs-row{display:block;}
  .bm-summary-bar .fs-row + .fs-row + .fs-row{color:var(--ink-soft);font-weight:600;font-size:.82rem;}
  .bm-summary-bar .fs-l{color:var(--ink-soft);font-weight:600;font-size:.72rem;margin-right:.2em;}
  /* 金額の内訳: 「名前 ¥金額」を1つの固まりとして扱う（折り返しても分断されない） */
  .bm-summary-bar .fs-item{display:inline-block;white-space:nowrap;}
  .bm-summary-bar .fs-item .fs-n{color:var(--ink-soft);font-weight:600;margin-right:.35em;}
  .bm-summary-bar .fs-item b{font-family:'Outfit',sans-serif;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
  .bm-summary-bar .fs-row + .fs-row .fs-l{opacity:.8;}
  .bm-summary-bar .fs-sep{display:inline-block;width:1px;height:.85em;background:var(--gray);margin:0 .55em;vertical-align:-.1em;}
  .bm-summary-bar .bm-sum-save{flex-shrink:0;align-self:center;padding:.5rem 1.1rem;font-size:.9rem;border-radius:9999px;}
  .bm-summary-bar .bm-sum-total{flex-shrink:0;font-family:'Outfit',sans-serif;font-weight:800;font-size:1.2rem;color:var(--deep);white-space:nowrap;}
  .modal.draggable.dragging{transition:none;}
  .modal.draggable.dragging .modal-header{cursor:grabbing;}

  /* 最小化ボタン (右上・×の左隣) */
  .modal.draggable .modal-minimize{
    position:absolute;top:.85rem;right:3rem;z-index:5;
    background:transparent;border:none;font-size:1.4rem;line-height:1;
    color:var(--ink-soft);cursor:pointer;padding:.3rem .5rem;border-radius:8px;
  }
  .modal.draggable .modal-minimize:hover{background:var(--foam);color:var(--ink);}
  /* 閉じる × は右上に固定 */
  .modal.draggable .modal-close{position:absolute;top:.85rem;right:.7rem;z-index:5;}
  /* ヘッダー内 担当/ステータス: 縮小可能にして×を押し出さない */
  .bm-head-ss{min-width:0;}
  /* 担当キャスト・ステータスはタイトルのすぐ右に左寄せ（中央寄せだと視線が飛ぶ） */
  .bm-head-ss{justify-content:flex-start!important;padding-left:1rem!important;}
  /* 本文の入力欄と同じ濃さに揃える。既定色のままだと薄くて読みにくかった */
  /* 本文の入力欄と同じ大きさ・同じ濃さに揃える（ヘッダーだけ小さいと別物に見える） */
  .bm-head-ss select{min-width:0;flex:1;max-width:190px;color:var(--ink);font-weight:600;
    padding:.7rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:var(--white);
    font-family:'Zen Maru Gothic';}
  .bm-head-ss select:has(option[value=""]:checked){color:var(--ink-soft);font-weight:400;}
  /* 担当キャストが未選択のときは薄くせず、赤枠＋太字で「キャストは？」と目立たせる（店長要望 2026-08-16） */
  .bm-ngcast-btn{flex:0 0 auto;padding:.3rem .55rem;border-radius:8px;border:1.5px solid #e5b4b4;
        background:#fff5f5;color:#a5342f;font-weight:700;font-size:.78rem;cursor:pointer;white-space:nowrap;}
  .bm-ngcast-btn.is-on{background:#a5342f;border-color:#a5342f;color:#fff;}
  .bm-ngcast-btn:disabled{opacity:.5;cursor:default;}
  .bm-head-ss select#bmAdminId:has(option[value=""]:checked),
  .bm-head-ss select[id^="bmAdminId"]:has(option[value=""]:checked){
    color:#b3421a!important;font-weight:800!important;background:#fff5f1;border-color:var(--coral,#e2725b);
    box-shadow:0 0 0 3px rgba(226,114,91,.14);}

  /* 最小化バー (画面右下に表示) */
  .min-dock{position:fixed;right:1rem;bottom:1rem;z-index:300;display:flex;flex-direction:column;gap:.5rem;align-items:flex-end;pointer-events:none;}
  .min-card{
    pointer-events:auto;background:linear-gradient(135deg,var(--sea),var(--deep));color:#fff;
    border-radius:50px;padding:.6rem 1.2rem;font-size:.88rem;
    box-shadow:0 8px 24px rgba(10,61,82,.3);
    display:flex;align-items:center;gap:.7rem;cursor:pointer;
    transition:all .25s;max-width:300px;
    border:2px solid rgba(255,255,255,.25);
  }
  .min-card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(10,61,82,.45);}
  .min-card .mc-label{font-family:'Outfit';font-weight:600;font-size:.78rem;color:var(--aqua-light);letter-spacing:.06em;}
  .min-card .mc-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;}
  .min-card .mc-close{background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.9rem;flex-shrink:0;}
  .min-card .mc-close:hover{background:rgba(255,255,255,.35);}

  /* ロケーションタブ */
  .loc-tab{flex:1;cursor:pointer;text-align:center;padding:.55rem .1rem;border-radius:8px;background:#fff;border:1.5px solid transparent;transition:all .15s;font-size:.68rem!important;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0!important;}
  .loc-tab input{display:none;}
  .loc-tab:hover{background:#f6fbfc;}
  .loc-tab:has(input:checked){background:linear-gradient(135deg,var(--aqua),var(--sea));color:#fff;border-color:var(--sea);font-weight:600;}
  .modal-header{padding:1.4rem 1.6rem .5rem;border-bottom:1px solid var(--gray);position:sticky;top:0;background:#fff;border-radius:20px 20px 0 0;z-index:1;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:1rem;}
  .modal-header .mh-title{font-size:1.1rem;font-weight:700;line-height:1.4;}
  .modal-header .mh-sub{font-size:.82rem;color:var(--ink-soft);margin-top:.25rem;}
  .modal-close{background:transparent;border:none;font-size:1.4rem;color:var(--ink-soft);line-height:1;padding:.3rem;border-radius:8px;cursor:pointer;}
  .modal-close:hover{background:var(--foam);color:var(--ink);}
  .modal-body{padding:1.4rem 1.6rem 1rem;}
  .modal-body .field{margin-bottom:1.1rem;min-width:0;}
  .modal-body label{display:block;color:var(--ink);font-size:.88rem;font-weight:600;margin-bottom:.4rem;}
  .modal-body .hint{display:block;color:var(--ink-soft);font-size:.78rem;margin-top:.25rem;line-height:1.5;}
  .modal-body input:not([type="checkbox"]):not([type="radio"]),.modal-body select,.modal-body textarea{width:100%;min-width:0;box-sizing:border-box;padding:.7rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;color:var(--ink);background:var(--white);font-weight:600;}
  /* 入力済みの値と入力例（プレースホルダ）の濃さが同じで見分けにくかったため、
     値は濃く太く・例は薄く細くしてはっきり差をつける（店長指摘 2026-08-03） */
  /* opacity .45 では字が薄くて読めなかった（店長指摘 2026-09-01）。
     Firefox は既定で opacity が乗るので 1 に戻してから色で調整する */
  .modal-body input::placeholder,.modal-body textarea::placeholder{color:#6f858e;opacity:1;font-weight:500;}
  /* 未選択の select（先頭の「選択」「— すべて —」等）も入力例と同じ扱いで薄く */
  .modal-body select:has(option[value=""]:checked){color:var(--ink-soft);font-weight:400;}
  /* 日付入力: 年を隠すハックはSafariで先頭の「/」が残る（/08/15）ため撤去し、そのまま出す（店長指摘 2026-08-16） */
  /* リピーター履歴バー: 電話番号で顧客がヒットしたときだけ表示、タップで開閉（読み取り専用） */
  .bm-history-toggle{display:flex;align-items:center;gap:.5rem;width:100%;background:var(--foam);border:1.5px solid var(--aqua-light,#bfe3e8);border-radius:10px;padding:.55rem .8rem;font-size:.85rem;font-weight:600;color:var(--sea);cursor:pointer;text-align:left;}
  .bm-history-toggle:hover{background:#e8f5f8;}
  .bm-history-toggle .bm-history-chev{flex-shrink:0;transition:transform .15s;color:var(--ink-soft);}
  .bm-history-toggle[aria-expanded="true"] .bm-history-chev{transform:rotate(180deg);}
  .bm-history-panel{margin-top:.4rem;border:1.5px solid var(--gray);border-radius:10px;background:#fff;overflow:hidden;}
  /* お客様メモ（顧客に紐づく。キャストには伝えない内容）。予約メモ #bmNotes とは別物 */
  /* 担当キャストの注意事項（猫アレルギー等）。予約を取る前に必ず目に入る位置に出す */
  .bm-cast-alert{margin:.1rem 0 .2rem;padding:.5rem .7rem;border:1.5px solid #f0b4b4;border-radius:8px;
    background:#fff4f4;color:#a5342f;font-size:.82rem;font-weight:600;line-height:1.55;white-space:pre-wrap;}
  .tl-staff-alert{display:inline-block;margin-left:.2rem;color:#c0392b;font-size:.8rem;cursor:pointer;}
  .tl-staff-thumb{cursor:pointer;}
  /* 媒体・予約経路のチェック群 */
  /* ラベルが2行になるとチェック群が右に押し出されて不揃いに見えたので、ラベルは1行で上に置く */
  /* クレジット決済: 手数料の内訳と決済確認チェック */
  .bm-card-paid{display:flex;align-items:center;gap:.4rem;margin-top:.55rem;padding:.5rem .7rem;
    border:1.5px solid #f5d5b0;background:#fffaf3;border-radius:8px;font-size:.85rem;font-weight:600;
    color:#8a4a12;cursor:pointer;}
  .bm-card-paid input{width:18px;height:18px;cursor:pointer;flex-shrink:0;margin:0;}
  .bm-card-paid:has(input:checked){border-color:#a7ddb8;background:#eefaf1;color:#1d6b39;}
  .bm-card-paid-at{margin-left:auto;font-weight:500;font-size:.76rem;opacity:.85;}
  .bm-card-fee{font-size:.8rem;font-weight:600;color:var(--ink-soft);margin-top:.35rem;text-align:right;}
  /* 自宅の場所: 住所｜建物 を1行に。狭い画面では素直に縦積み */
  .bm-home-row{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;}
  @media(max-width:560px){.bm-home-row{grid-template-columns:1fr;gap:0;}}
  /* id ではなく class で当てる: 2枚目の予約モーダルは clone で id に -2 が付き、
     #bmMediaField 指定が外れてレイアウトが崩れていた（2026-08-05 店長指摘） */
  /* 1列のグリッドで「ラベルの下にチェック群」を確定させる。
     block だけだと親要素の指定に負けてラベルが左・チェック群が右の2段組みになる場合があった */
  .bm-media-field{display:grid!important;grid-template-columns:1fr!important;gap:.4rem;}
  .bm-media-label{display:block!important;float:none!important;width:auto!important;white-space:normal;margin-bottom:0;}
  .bm-media-note{font-weight:500;font-size:.72rem;color:var(--ink-soft);}
  /* OP（オプション）: 見出しを左、チップを右に置く。見出しは縦の中央に揃え、間に少し余白をとる。
     id ではなく class で当てる（2枚目の予約モーダルは clone で id に -2 が付くため） */
  .bm-opt-field{display:grid!important;grid-template-columns:1fr;align-items:start;row-gap:.25rem;padding-top:.15rem;}
  /* 見出しは一覧の上に置き、チップは横幅いっぱいを使って回り込ませる */
  .bm-opt-field > .bm-media-label{margin:0!important;white-space:nowrap;text-align:left;padding-top:0;}
  /* ＋10分は自動で入るが、媒体を見ていないお客様など外したい場合があるのでチェックで操作できる */
  /* ＋10分は売りの特典なので、他のチップより目立つ濃いピンクにする（店長指定 2026-08-08） */
  .bm-plus10{display:inline-flex;justify-self:start;align-items:center;gap:.35rem;margin-top:.1rem;padding:.3rem .75rem;
    border:1.5px solid #e0559a;background:#fff0f6;border-radius:999px;cursor:pointer;
    font-size:.76rem;font-weight:700;color:#c2185b;vertical-align:middle;}
  /* 2行目（LINE ＋ ＋10分）は左揃え・互いに上下中央（店長指定 2026-08-08） */
  .bm-media-row2{grid-column:1 / -1;display:flex;justify-content:flex-start;align-items:center;gap:.5rem;}
  .bm-media-row2 .bm-media{min-width:7.5rem;}
  /* admin.css の `.field label{margin-bottom:6px}` が効くと、その余白ごと中央に揃うので
     見た目が上にずれる。マージンを消してから中央に揃える（店長指摘 2026-08-08） */
  .bm-media-row2 .bm-plus10{margin:0!important;white-space:nowrap;align-self:center;}
  .bm-plus10 input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#d81b60;}
  .bm-plus10-note{display:block;margin-top:.25rem;font-size:.72rem;font-weight:500;color:var(--ink-soft);line-height:1.5;}
  .bm-plus10:has(input:checked){background:#ffd6e7;border-color:#d81b60;color:#ad1457;}
  /* 幅がバラバラだと段ごとに端がずれて読みにくいので、等幅の升目に並べる */
  /* PC・スマホとも2行に収める: 1行目=媒体6つ / 2行目=LINE予約（全幅）。
     狭い画面でも折り返さないよう、文字と余白を詰めて6列を維持する */
  /* チップ同士の間隔を詰めて（.4→.2rem）、その分を右端の余白に回す（店長要望 2026-08-08） */
  .bm-media-list{display:grid;grid-template-columns:repeat(6,1fr);gap:.2rem;padding-right:1.4rem;}
  /* OP は媒体(6個固定)と違って項目数が可変。4列固定だと右端が枠からはみ出していたので、
     幅に応じて列数を決める升目にする（最低 8.5rem 確保・店長指摘 2026-08-09） */
  .bm-opt-list{grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))!important;padding-right:0;gap:.25rem;
    width:100%;box-sizing:border-box;}
  /* OP は注文が稀なので普段は畳む（店長要望 2026-08-09）。開閉の見た目はホテル手入力と揃える */
  .bm-opt-acc{display:block!important;margin-bottom:1.1rem;}
  .bm-opt-acc > summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;
    font-size:.82rem;font-weight:700;color:var(--sea);}
  .bm-opt-acc > summary::-webkit-details-marker{display:none;}
  .bm-opt-acc > summary::before{content:'＋';font-weight:700;}
  .bm-opt-acc[open] > summary::before{content:'−';}
  .bm-opt-acc[open] > summary{margin-bottom:.4rem;}
  .bm-opt-acc > summary:hover{text-decoration:underline;}
  /* 選ばれているときは畳んでいても分かるよう、見出しの注記を強調する */
  .bm-opt-acc > summary .bm-media-note{color:var(--deep);font-weight:700;}
  /* OP は「名前＋個数プルダウン」。個数が入ったら枠を色づけて選択が分かるようにする（店長要望 2026-08-08） */
  .bm-media.bm-opt{justify-content:space-between;gap:.2rem;padding:.25rem .35rem;}
  .bm-opt-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;text-align:left;}
  /* .modal-body select{width:100%} が効くとプルダウンが枠いっぱいに広がり、
     名前が幅0に潰れて見えなくなる。幅を固定して名前ぶんを残す（2026-08-08） */
  .bm-opt-qty{flex:0 0 auto!important;width:2.9em!important;min-width:2.9em!important;
    padding:.1rem .15rem!important;border:1.5px solid var(--gray)!important;border-radius:6px!important;
    background:#fff!important;font-size:.72rem!important;font-weight:700!important;color:var(--ink)!important;cursor:pointer;}
  .bm-media.bm-opt.has-count{border-color:var(--deep);background:var(--foam);color:var(--deep);}
  .bm-media.bm-opt.has-count .bm-opt-qty{border-color:var(--deep);color:var(--deep);}
  /* 狭い画面では6つ横並びにチェック□を置く幅が無いので、□は隠して枠の色で選択を示す
     （選ぶと枠が濃くなり地が色づく）。LINE予約は全幅なので□をそのまま残す */
  @media(max-width:520px){
    .bm-media-list{gap:.22rem;}
    .bm-media-list .bm-media{padding:.45rem .05rem;font-size:.66rem;gap:0;min-width:0;}
    .bm-media-list .bm-media input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;}
    /* 選択時は枠を太らせず内側の影で示す（太らせると幅が変わって文字が切れる） */
    .bm-media-list .bm-media:has(input:checked){box-shadow:inset 0 0 0 1px currentColor;font-weight:700;}
  }
  /* チップは <label> なので、スマホ幅の `.field label`(0,1,1) に負けないよう
     `.bm-media-list .bm-media`(0,2,0) で指定する（font-size が効かず文字が切れていた） */
  .bm-media-list .bm-media{display:flex;align-items:center;justify-content:center;gap:.3rem;padding:.45rem .5rem;border:1.5px solid var(--gray);
    border-radius:8px;background:#fff;font-size:.82rem;font-weight:600;color:var(--ink);cursor:pointer;
    touch-action:manipulation;white-space:nowrap;margin-bottom:0;}
  .bm-media input{width:16px;height:16px;cursor:pointer;flex-shrink:0;margin:0;}
  .bm-media:has(input:checked){border-color:var(--deep);background:var(--foam);color:var(--deep);}
  /* LINE予約は他の媒体と性質が違う（＋10分の特典つき自社導線）ので、常に緑で区別する */
  .bm-media-list .bm-media.is-line{border-color:#9edcb8;background:#eafaf0;color:#0a7a3a;}
  .bm-media.is-line:has(input:checked){border-color:#06c755;background:#d6f5e3;color:#06682f;}
  .bm-media.is-line input{accent-color:#06c755;}
  .bulk-actions .btn-bulk-delete{background:var(--red);border-color:var(--red);color:#fff;}
  /* 担当キャストの注意事項（ヘッダー・小さく1行） */
  /* 固定ヘッダーの中の2行目。ヘッダーの左右パディング（右は×ボタンぶん広い）を
     打ち消して端まで伸ばす。--hdr-pl / --hdr-pr を変えればここも追従する */
  .modal-header{--hdr-pl:1.6rem;--hdr-pr:1.6rem;}
  .modal.draggable .modal-header{--hdr-pr:5rem;}
  .bm-cast-alert-head{flex:0 0 calc(100% + var(--hdr-pl) + var(--hdr-pr));order:9;
    margin:1px calc(-1 * var(--hdr-pr)) -.5rem calc(-1 * var(--hdr-pl));
    padding:.32rem var(--hdr-pr) .32rem var(--hdr-pl);
    background:#fff4f4;border-top:1px solid #f3d3cf;color:#a5342f;font-size:.76rem;font-weight:700;line-height:1.5;}
  @media(max-width:640px){
    .modal-header{--hdr-pl:1.1rem;--hdr-pr:1.1rem;}
    .modal.draggable .modal-header{--hdr-pr:3.4rem;}
    .bm-cast-alert-head{font-size:.72rem;margin-top:1px;margin-bottom:-.5rem;}
  }
  /* ホテル料金の適用条件の注意（チェックする前に気づけるように） */
  /* 見出しと同じ行に流して高さを詰める（店長要望 2026-08-08）。
     本指名で対象外のときだけ強い注意なので、そのときは折り返して目立たせる */
  .bm-hf-warn{display:inline;margin-left:.35rem;font-size:.74rem;font-weight:600;color:#6b7f9e;line-height:1.5;}
  .bm-hf-warn.is-block{display:block;margin:.15rem 0 0;color:#a5342f;}
  .bm-hf-warn.is-block{color:#a5342f;}
  /* 同時編集ロックの注意帯（別端末が編集中＝読み取り専用） */
  .bm-lock-notice{margin-bottom:1rem;padding:.6rem .8rem;background:#fff4f4;border:1.5px solid #e7a6a0;
    border-radius:8px;font-size:.85rem;font-weight:700;color:#a5342f;line-height:1.5;}
  /* 予約モーダル: 選んだホテルの住所・TEL・入室方法＋地図リンク */
  .bm-hotel-addr{margin:-.5rem 0 1.1rem;padding:.55rem .75rem;background:var(--foam);border:1px solid var(--aqua-light,#bfe3e8);
    border-radius:8px;font-size:.82rem;line-height:1.6;color:var(--ink);}
  .bm-hotel-addr .bha-line{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline;}
  .bm-hotel-addr .bha-l{color:var(--ink-soft);font-weight:600;font-size:.76rem;flex-shrink:0;}
  .bm-hotel-addr .bha-route{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-top:.45rem;
    padding-top:.45rem;border-top:1px dashed var(--aqua-light,#bfe3e8);}
  .bm-hotel-addr .bha-origin{flex:1;min-width:150px;padding:.35rem .55rem!important;border:1.5px solid var(--gray);
    border-radius:7px;font-size:.8rem!important;background:#fff;}
  .bm-hotel-addr .bha-go{border:1.5px solid var(--sea);background:var(--sea);color:#fff;border-radius:7px;
    padding:.35rem .7rem;font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-hotel-addr .bha-go:hover{filter:brightness(1.08);}
  .bm-hotel-addr .bha-office{background:none;border:none;color:var(--sea);font-size:.72rem;cursor:pointer;
    text-decoration:underline;padding:0;white-space:nowrap;}
  /* 出発地を打ち直したあと、所要時間だけ出し直すボタン（🚗ルートはGoogleが開いてしまうため別にする） */
  .bm-hotel-addr .bha-fix{border:1.5px solid var(--sea);background:#fff;color:var(--sea);border-radius:7px;
    padding:.32rem .6rem;font-size:.76rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-hotel-addr .bha-fix:hover{background:var(--foam);}
  /* 車での所要時間（渋滞なしの道なり）。Googleへのリンクは残したまま、その手前に添える */
  .bm-hotel-addr .bha-eta{font-size:.76rem;font-weight:700;white-space:nowrap;color:var(--deep);
    background:#fff;border:1.5px solid var(--aqua-light,#bfe3e8);border-radius:7px;padding:.3rem .55rem;}
  .bm-hotel-addr .bha-eta:empty{display:none;}
  .bm-hotel-addr .bha-eta.is-loading{color:var(--ink-soft);font-weight:600;}
  .bm-hotel-addr .bha-eta.is-ng{color:var(--ink-soft);font-weight:600;}
  /* 住所からの地図リンク（案内・場所確認用。別タブで開く） */
  .cu-loc{margin-top:.2rem;font-size:.78rem;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cu-last{margin-left:.6rem;font-size:.74rem;color:var(--ink-soft);}
  /* 市区町村は選ぶだけなので狭く、訪問先タイプ（4択）に幅を回す（店長要望 2026-08-08）。
     ただし町名プルダウンが並ぶときは市区町村が読めなくなるので広げる（店長指摘 2026-08-09） */
  .bm-loctype-row{display:grid;grid-template-columns:.72fr 1.28fr;gap:.7rem;}
  .bm-loctype-row.has-town{grid-template-columns:1.15fr 1.05fr;}
  /* 前回と交通費が違うときの注意。基本は前回と同じ額でご案内する（店長要望 2026-08-24） */
  .bm-fee-hint{display:flex;align-items:center;flex-wrap:nowrap;gap:.4rem;white-space:nowrap;overflow-x:auto;
    margin:.35rem 0 0;font-size:.74rem;font-weight:700;color:#a35b00;line-height:1.45;}
  .bm-fee-hint .bm-fee-apply{margin-left:.4rem;border:1.5px solid #a35b00;background:#fff;color:#a35b00;
    border-radius:7px;padding:.1rem .5rem;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-fee-hint .bm-fee-apply:hover{background:#fff3e0;}
  /* 町名の選び忘れ注意。赤字＋町名プルダウンを赤枠にして気づけるように（店長要望 2026-08-24） */
  .bm-town-hint{margin:.3rem 0 0;font-size:.74rem;font-weight:700;color:var(--red);line-height:1.4;}
  #bmTown.need-pick,#bmTown-2.need-pick{border-color:var(--red);box-shadow:0 0 0 2px rgba(220,53,69,.15);}
  /* 市区町村のほうが文字数が多いので、町名より広く取る */
  .bm-loctype-row.has-town #bmCity,.bm-loctype-row.has-town #bmCity-2{flex:1.35;}
  .map-links{display:inline-flex;gap:.3rem;flex-wrap:wrap;vertical-align:middle;}
  .map-link{display:inline-block;padding:.22rem .55rem;border:1.5px solid var(--gray);border-radius:6px;
    background:#fff;color:var(--deep);font-size:.72rem;font-weight:700;text-decoration:none;white-space:nowrap;
    touch-action:manipulation;}
  .map-link:hover{background:var(--foam);border-color:var(--sea);}
  .map-link-sm{margin-left:.3rem;padding:.06rem .38rem;font-size:.66rem;font-weight:600;color:var(--ink-soft);}
  /* 住所: 市区町村は固定表示（プルダウン連動）＋続きだけ手入力。1つの入力欄に見えるよう囲う */
  .addr-combo{display:flex;align-items:stretch;border:1.5px solid var(--gray);border-radius:8px;background:var(--white);overflow:hidden;}
  .addr-combo:focus-within{border-color:var(--sea);}
  .addr-city{display:flex;align-items:center;padding:.7rem .6rem .7rem .85rem;background:var(--foam);color:var(--ink-soft);
    font-size:16px;font-weight:600;white-space:nowrap;border-right:1.5px dashed var(--gray);}
  .addr-city.is-empty{color:var(--ink-soft);opacity:.6;font-weight:400;}
  .addr-combo input{border:none!important;border-radius:0!important;background:transparent!important;flex:1;min-width:0;}
  .addr-combo input:focus{outline:none;}
  .row-addr{font-size:.78rem;color:var(--ink-soft);margin-top:.1rem;}
  .btn-del{background:#fff;border:1.5px solid #f0b4b4;color:var(--red);border-radius:7px;padding:.3rem .6rem;
    font-size:.75rem;font-weight:700;cursor:pointer;touch-action:manipulation;}
  .btn-del:hover{background:#fff4f4;}
  .bm-history-note{padding:.55rem .7rem;background:#fff8ef;border-bottom:1px dashed var(--gray);font-size:.78rem;color:#6b4d20;line-height:1.6;}
  .bm-history-note .bhn-head{display:flex;align-items:flex-start;gap:.5rem;margin-bottom:.35rem;}
  /* 「✏️編集」の下に「🚫NG」を縦に並べる（店長指定 2026-08-22） */
  /* 「編集」と「NG」は横並び1行（店長指定 2026-08-25） */
  .bm-history-note .bhn-actions{display:flex;flex-direction:row;align-items:center;gap:.35rem;flex:0 0 auto;flex-wrap:nowrap;}
  .bm-history-note .bhn-title{font-weight:700;font-size:.76rem;color:#6b4d20;flex:1;min-width:0;}
  .bm-history-note .bhn-sub{margin-left:.4rem;font-weight:500;font-size:.68rem;color:#9a7a45;}
  .bm-history-note .bhn-btn{border:1.5px solid #d8c3a0;background:#fff;color:#6b4d20;border-radius:7px;
    padding:.22rem .6rem;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-history-note .bhn-btn:hover{background:#fdf3e3;}
  .bm-history-note .bhn-btn.primary{background:var(--deep);border-color:var(--deep);color:#fff;}
  .bm-history-note .bhn-main{font-weight:600;color:#5c3f18;}
  /* 1件＝「日付＋キャスト名」の小見出し＋本文。新しいものが上に積まれる */
  .bm-history-note .bhn-entry + .bhn-entry{margin-top:.45rem;padding-top:.4rem;border-top:1px dotted #e4d3b4;}
  .bm-history-note .bhn-stamp{font-size:.68rem;font-weight:700;color:#a2833f;letter-spacing:.02em;margin-bottom:.1rem;}
  .bm-history-note .bhn-stamp.old{color:#b7a184;font-weight:600;}
  /* その予約でキャストをNGにした印。メモが無くてもこの行だけ出る */
  .bm-freehotel-note{margin:.35rem 0 0;font-size:.72rem;line-height:1.5;color:var(--ink-soft);}
  /* 領収証: 予約モーダルのトグル（メール欄の右）。
     左右とも「ラベル＋操作」の2段にして、ボタンの高さをメール欄とぴったり合わせる */
  .bm-mail-row{display:flex;align-items:stretch;gap:1.1rem;}
  .bm-mail-row .bm-mail-input{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}
  .bm-mail-row .bm-mail-input label{display:block;}
  .bm-mail-row .bm-mail-input input{width:100%;flex:1;}
  .bm-receipt-wrap{flex:0 0 auto;display:flex;flex-direction:column;}
  .bm-receipt-btn{flex:1;border:1px solid #d8c3a0;background:#fff;color:#6b4d20;border-radius:9px;
    padding:10px 14px;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1.2;}
  .bm-receipt-btn:hover{background:#fdf3e3;}
  .bm-receipt-btn.is-on{background:#a33a3a;border-color:#a33a3a;color:#fff;}
  @media (max-width:640px){
    .bm-mail-row{flex-wrap:wrap;gap:.7rem;}
    .bm-receipt-wrap{width:100%;}
    .bm-receipt-spacer{display:none;}
    .bm-receipt-btn{width:100%;padding:.7rem .8rem;font-size:16px;}
  }
  .bm-history-note .bhn-ng{display:inline-block;margin-left:.4rem;padding:.05rem .4rem;border-radius:999px;
    background:#fdeaea;border:1px solid #e6b8b8;color:#a33a3a;font-size:.66rem;font-weight:700;letter-spacing:0;}
  .bm-history-note .bhn-body{white-space:pre-wrap;}
  .bm-history-note .bhn-empty{color:#9a7a45;font-size:.74rem;}
  .bm-history-note .bhn-ta{width:100%;border:1.5px solid #d8c3a0;border-radius:8px;padding:.45rem .55rem;
    font-size:16px;line-height:1.5;background:#fff;color:var(--ink);resize:vertical;}
  .bm-history-note .bhn-actions{display:flex;justify-content:flex-end;gap:.4rem;margin-top:.4rem;}
  /* 移行情報は補助情報だが、読めないと意味がないのでコントラストは確保する */
  .bm-history-note .bhn-meta{white-space:pre-wrap;margin-top:.45rem;padding-top:.4rem;
    border-top:1px dotted #d8c3a0;font-size:.72rem;line-height:1.55;color:#8a6a3a;}
  .bm-history-row{padding:.5rem .7rem;border-bottom:1px dashed var(--gray);}
  .bm-history-row:last-child{border-bottom:none;}
  /* PC/スマホともに必ず1行に収める: 日付/曜日/時刻/担当・料金・ステータスは固定表示、コース名が幅不足時に省略される */
  .bm-history-row .bm-hr-top{display:flex;align-items:baseline;font-size:.83rem;color:var(--ink);}
  .bm-history-row .bm-hr-date{color:var(--ink-soft);font-weight:500;flex-shrink:0;white-space:nowrap;}
  .bm-history-row .bm-hr-sep{color:var(--ink-soft);margin:0 .15rem;flex-shrink:0;}
  .bm-history-row .bm-hr-time{color:var(--deep);font-weight:700;flex-shrink:0;white-space:nowrap;}
  .bm-history-row .bm-hr-course{color:var(--sea);font-weight:600;margin-left:.4rem;flex:0 999 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bm-history-row .bm-hr-meta{margin-left:.6rem;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem;color:var(--ink-soft);}
  .bm-history-row .bm-hr-status{flex-shrink:0;margin-left:.5rem;padding:.1rem .5rem;border-radius:20px;font-size:.7rem;background:var(--foam);color:var(--ink-soft);font-weight:700;white-space:nowrap;}
  .bm-history-row .bm-hr-status.ok{background:rgba(58,154,96,.13);color:var(--green);}
  .bm-history-row .bm-hr-status.ng{background:rgba(220,53,69,.1);color:var(--red);}
  .bm-history-row .bm-hr-memo{font-size:.74rem;color:#7a5a2a;margin-top:.25rem;line-height:1.5;}
  .bm-history-empty{padding:.7rem;font-size:.8rem;color:var(--ink-soft);text-align:center;}
  /* ご利用履歴の表（旧システムの一覧に合わせた見せ方。狭い画面は横スクロール） */
  /* 横に長い表なので掴んで動かせる（PC）。掴んでいる間はカーソルを変えて分かるようにする */
  .hist-tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch;max-height:min(46vh,320px);cursor:grab;}
  .hist-tbl-wrap.tl-dragging{cursor:grabbing;user-select:none;}
  /* モーダルの中身も掴んで動かせる（縦に長いまとめ画面など）。掴んでいる間だけカーソルを変える */
  .modal.tl-dragging{cursor:grabbing;user-select:none;}
  .hist-tbl{width:100%;border-collapse:collapse;font-size:.78rem;white-space:nowrap;}
  .hist-tbl th{position:sticky;top:0;z-index:1;background:var(--deep);color:#fff;font-weight:700;
               padding:.4rem .55rem;text-align:left;font-size:.72rem;letter-spacing:.02em;}
  .hist-tbl td{padding:.4rem .55rem;border-bottom:1px dashed var(--gray);vertical-align:top;color:var(--ink);}
  .hist-tbl tr:last-child td{border-bottom:none;}
  .hist-tbl tr.is-legacy td{background:#fcfbf9;}
  .hist-tbl tr.clickable{cursor:pointer;}
  .hist-tbl tr.clickable:hover td{background:var(--foam);}
  .hist-tbl .ht-date{color:var(--ink-soft);font-weight:600;white-space:nowrap;}
  /* 西暦は月日の邪魔をしないよう小さく添える（旧システムの履歴は数年分あるため必要） */
  .hist-tbl .ht-year{color:var(--gray);font-weight:600;font-size:.82em;margin-right:.28em;}
  .hist-tbl .ht-course{color:var(--sea);font-weight:600;}
  .hist-tbl .ht-price{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;}
  .hist-tbl .ht-memo{white-space:pre-wrap;color:#7a5a2a;min-width:11rem;max-width:20rem;}
  .hist-tbl .ht-place{color:var(--ink-soft);}
  .hist-tbl .ht-trans{font-weight:600;color:var(--ink-soft);}
  .hist-tbl .ht-shop{color:var(--ink-soft);font-size:.72rem;}
  .hist-tbl .ht-kind{font-weight:700;font-size:.7rem;padding:.1rem .45rem;border-radius:20px;
                     background:var(--foam);color:var(--ink-soft);white-space:nowrap;}
  .hist-tbl .ht-kind.ok{background:rgba(58,154,96,.13);color:var(--green);}
  .hist-tbl .ht-kind.ng{background:rgba(220,53,69,.1);color:var(--red);}
  .hist-tbl .ht-old{font-size:.62rem;color:var(--ink-soft);border:1px solid var(--gray);border-radius:4px;padding:0 .25rem;margin-left:.25rem;}
  /* 予約一覧に混ぜた旧システムの利用履歴（読み取り専用なので少し落とす） */
  .bk-row .ht-old{font-size:.62rem;color:var(--ink-soft);border:1px solid var(--gray);border-radius:4px;padding:0 .25rem;margin-left:.25rem;vertical-align:middle;}
  .bk-row.is-legacy{background:#fbfbfa;cursor:default;}
  .bk-row.is-legacy .bd-date,.bk-row.is-legacy .bi-name{color:var(--ink-soft);}
  /* 手入力のホテル名: 普段は畳む。中身が入っているときは開いた状態で復元する */
  .bm-freehotel{margin-bottom:1.1rem;}
  .bm-freehotel > summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;
    color:var(--sea);font-size:.82rem;font-weight:600;padding:.25rem 0;user-select:none;}
  .bm-freehotel > summary::-webkit-details-marker{display:none;}
  .bm-freehotel > summary::before{content:'＋';font-weight:700;}
  .bm-freehotel[open] > summary::before{content:'−';}
  .bm-freehotel[open] > summary{margin-bottom:.4rem;}
  .bm-freehotel > summary:hover{text-decoration:underline;}
  /* ホテル選択: ネイティブ矢印の予約幅が広くスマホでホテル名が見切れるため、細いカスタム矢印に置き換えて文字幅を確保 */
  .modal-body select.bm-tight-select{-webkit-appearance:none!important;appearance:none!important;padding-right:1.6rem!important;background-color:var(--white)!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23173842' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right .55rem center!important;background-size:10px 6px!important;}
  /* 予約編集モーダル: PCは左=お客様と場所／右=料金の2段組み。項目の大きさは据え置きで横に広げるだけ。
     1180px未満（タブレット・スマホ）では従来どおり1列に戻る */
  .bm-cols{min-width:0;}
  @media (min-width:1180px){
    .modal.bm-modal{max-width:1120px!important;}
    .bm-modal .bm-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem;align-items:start;}
    .bm-modal .bm-col{min-width:0;}
    .bm-modal .bm-col + .bm-col{border-left:1px solid var(--gray);padding-left:1.5rem;}
  }
  /* 開始時刻の 時／分。Windowsはネイティブ矢印が太く「33」が欠けるので、細い矢印に置き換えて数字の幅を確保する */
  .modal-body select.bm-time-select{-webkit-appearance:none!important;appearance:none!important;
    padding-left:.45rem!important;padding-right:1rem!important;text-align:center!important;text-align-last:center!important;
    font-variant-numeric:tabular-nums;background-color:var(--white)!important;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23173842' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;
    background-repeat:no-repeat!important;background-position:right .3rem center!important;background-size:9px 5px!important;}
  .modal-body select.bm-time-select option{text-align:left;}
  /* シフト編集の終了時刻「時 分」は必ず1行。表示の出し入れで display が消えても崩れないよう
     インラインではなくCSSで持つ（JSが style.display='' に戻すため・店長指摘 2026-08-22） */
  #smEndTimeWrap{display:flex;gap:.3rem;align-items:center;}
  #smEndTimeWrap[style*="display: none"]{display:none!important;}
  /* コース欄の金額メモ（指名方法の下の空きを使う）。上=基本コース／下=組み合わせ／計 */
  .bm-ccalc{margin-top:.45rem;border:1.5px solid var(--gray);border-radius:8px;background:linear-gradient(180deg,#fbfdfe,var(--white));
            padding:.4rem .6rem;font-size:.82rem;line-height:1.5;}
  .bm-ccalc-r{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;}
  .bm-ccalc-r > span{color:var(--ink-soft);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .bm-ccalc-r > b{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;}
  .bm-ccalc-r.bm-cc-off > span,.bm-ccalc-r.bm-cc-off > b{color:var(--ink-soft);font-weight:600;opacity:.6;}
  /* 日付欄は「年なし・曜日つき」＋本日/前日の目印を重ねて出す（店長要望 2026-08-16）。
     ネイティブの表示を透明にして上に載せる。クリックは下の input に通るのでカレンダーは従来どおり開く */
  .bm-date-wrap{position:relative;display:block;}
  .bm-date-wrap input[type="date"]{color:transparent;-webkit-text-fill-color:transparent;}
  .bm-date-wrap input[type="date"]::-webkit-datetime-edit,
  .bm-date-wrap input[type="date"]::-webkit-date-and-time-value{color:transparent;-webkit-text-fill-color:transparent;}
  .bm-date-disp{position:absolute;left:.85rem;top:50%;transform:translateY(-50%);pointer-events:none;
    display:flex;align-items:center;gap:.4rem;font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;color:var(--deep);white-space:nowrap;}
  .bm-date-disp .bmd-pill{padding:.08rem .4rem;border-radius:50px;font-size:.66rem;font-weight:800;font-family:'Zen Maru Gothic',sans-serif;}
  .bm-date-disp .bmd-pill.is-today{background:#ffe6d8;color:#b3421a;}
  .bm-date-disp .bmd-pill.is-adv{background:#dceaf5;color:#1f5c85;}
  /* 延長の行。狭いときは「貸出のひと組」ごと下へ折り返す（1文字ずつ縦に潰れて読めなかった・店長指摘 2026-08-18） */
  .bm-ext-row{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;}
  .bm-ext-label{font-weight:600;color:var(--ink);white-space:nowrap;}
  .bm-ext-info{margin-top:0!important;white-space:nowrap;}
  .bm-lend-group{margin-left:auto;display:inline-flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;}
  /* バスタオル貸出チェック（延長の右）。貸出中は色が付いて気づける（店長要望 2026-08-16） */
  .bm-towel{display:inline-flex;align-items:center;gap:.35rem;flex-shrink:0;cursor:pointer;
    padding:.4rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.85rem;font-weight:700;color:var(--ink-soft);white-space:nowrap;}
  .bm-towel input{width:18px;height:18px;cursor:pointer;}
  .bm-towel:has(input:checked){border-color:#e0a23f;background:#fff8e8;color:#8a5a12;}
  /* 回収済みになったら貸出のチェックは「記録」に変わるので、色を落として貸出中と見分ける（店長指摘 2026-08-16） */
  .bm-towel.is-returned:has(input:checked){border-color:#bcd9c4;background:#f2faf4;color:#3f7a52;}
  /* 貸出品の今の状態（貸出中／回収済み）。クリックで切り替えられる */
  .bm-lend-state{display:none;align-items:center;gap:.3rem;flex-shrink:0;cursor:pointer;
    padding:.4rem .6rem;border:1.5px solid #e0a23f;border-radius:8px;background:#fff8e8;color:#8a5a12;
    font-size:.85rem;font-weight:800;white-space:nowrap;font-family:'Zen Maru Gothic',sans-serif;}
  .bm-lend-state.is-done{border-color:#7cbf94;background:#eef8f1;color:#2f6b45;}
  /* 開始予定は予約で一番大事なので、ラベル・枠ともはっきり出す（店長要望 2026-08-16） */
  .bm-start-label{color:var(--coral-deep,#c2410c)!important;font-weight:800!important;}
  .bm-start-label::after{content:'必ず確認';margin-left:.4rem;padding:.06rem .34rem;border-radius:50px;
    background:#ffe6d8;color:#b3421a;font-size:.62rem;font-weight:800;vertical-align:middle;}
  .bm-start-field .bm-time-select{border-color:var(--coral,#e2725b)!important;background:#fff8f4;font-weight:800;color:var(--deep);}
  .bm-start-field .bm-time-select:focus{border-color:var(--coral-deep,#c2410c)!important;background:#fff;}
  .bm-ccalc-sum{margin-top:.3rem;padding-top:.3rem;border-top:1px dashed var(--gray);}
  .bm-ccalc-sum > span{color:var(--ink);}
  .bm-ccalc-sum > b{font-size:1rem;color:var(--sea);}
  .modal-body textarea{resize:vertical;min-height:70px;font-family:'Zen Maru Gothic';}
  .modal-body input:focus,.modal-body select:focus,.modal-body textarea:focus{outline:none;border-color:var(--sea);}
  /* オーダー詳細 行 */
  .od-row{display:grid;grid-template-columns:96px 1fr;gap:.7rem;padding:.4rem 0;align-items:start;}
  .od-row .od-label{color:var(--ink-soft);font-size:.85rem;font-weight:600;padding-top:.1rem;}
  .od-row .od-value{color:var(--deep);font-size:.95rem;font-weight:600;line-height:1.5;word-break:break-word;}
  .od-row .od-value.muted{color:var(--ink-soft);font-weight:400;}
  @media (max-width:640px){
    .od-row{grid-template-columns:84px 1fr;}
    .od-row .od-label{font-size:.8rem;}
    .od-row .od-value{font-size:.9rem;}
  }
  .em-status{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;}
  .em-status .sbtn{padding:.7rem .4rem;border-radius:10px;font-size:.82rem;font-weight:700;border:1.5px solid var(--gray);background:#f6f8f9;color:var(--ink-soft);cursor:pointer;transition:all .2s;line-height:1.3;text-align:center;}
  .em-status .sbtn.active{color:#fff;}
  .em-status .sbtn.v-visited.active{background:var(--visited);border-color:var(--visited);}
  .em-status .sbtn.v-inquiry.active{background:var(--inquiry);border-color:var(--inquiry);}
  .em-status .sbtn.v-unavailable.active{background:var(--unavailable);border-color:var(--unavailable);}
  .em-status .sbtn.v-unset.active{background:#aab2b7;border-color:#aab2b7;color:#fff;}
  /* 支払方法の選択中はグレーではなく明瞭な色（ティール）で */
  /* 権限ボタンは選択が一目で分かるよう役割ごとの濃色にする（灰色系だと選択が弱かった・店長指摘 2026-08-07） */
  .em-status .sbtn[data-role].active,.em-status .sbtn[data-es-role].active{color:#fff;box-shadow:0 3px 8px rgba(0,0,0,.18);}
  .em-status .sbtn[data-role="staff"].active,.em-status .sbtn[data-es-role="staff"].active{background:#12667e;border-color:#12667e;}
  .em-status .sbtn[data-role="driver"].active,.em-status .sbtn[data-es-role="driver"].active{background:#2d6733;border-color:#2d6733;}
  .em-status .sbtn[data-role="office"].active,.em-status .sbtn[data-es-role="office"].active{background:#573c78;border-color:#573c78;}
  .em-status .sbtn[data-role="manager"].active,.em-status .sbtn[data-es-role="manager"].active{background:#b06a12;border-color:#b06a12;}
  .em-status .sbtn[data-role="owner"].active,.em-status .sbtn[data-es-role="owner"].active{background:#a2461d;border-color:#a2461d;}
  .em-status .sbtn[data-pay-btn].active{background:var(--sea);border-color:var(--sea);color:#fff;box-shadow:0 3px 8px rgba(29,122,156,.35);}
  /* 支払方法は4つを1行に。振込・未設定はほぼ使わないので幅も文字も小さくする（店長要望 2026-08-08） */
  .bm-pay-row .sbtn{padding-left:.3rem;padding-right:.3rem;white-space:nowrap;}
  .bm-pay-row .bm-pay-rare{font-size:.78rem;}
  .sm-presets{display:flex;flex-wrap:wrap;gap:.35rem .9rem;margin:.4rem 0 .6rem;}
  .sm-presets label{display:flex;align-items:center;gap:.4rem;font-weight:600;font-size:.9rem;cursor:pointer;white-space:nowrap;}
  .modal-footer{padding:1rem 1.6rem 1.4rem;border-top:1px solid var(--gray);display:flex;gap:.7rem;justify-content:flex-end;}
  .btn-primary{background:var(--coral);color:#fff;border:none;padding:.7rem 1.6rem;border-radius:50px;font-weight:600;font-size:.92rem;}
  .btn-primary:hover{background:var(--deep);}
  .btn-secondary{background:transparent;color:var(--ink-soft);border:1.5px solid var(--gray);padding:.7rem 1.4rem;border-radius:50px;font-size:.92rem;}
  /* コピー用ボタン。丸ではなく角丸の四角＋コピーアイコンで「押すとコピーできる」と分かるように */
  .bm-copy-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:10px;padding:.6rem 1rem;font-weight:700;
    color:var(--deep);border-color:var(--gray);background:#fff;}
  .bm-copy-btn svg{width:1.05em;height:1.05em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
  .bm-copy-btn:hover{border-color:var(--sea);color:var(--sea);background:var(--foam);}
  .bm-copy-btn:active{transform:translateY(1px);}
  .bm-copy-cust{color:var(--sea);border-color:var(--sea);}
  .bm-copy-cust:hover{background:var(--foam);}
  /* コピー直後の合図。押した手応えが無いと二度押ししてしまうため */
  .bm-copy-btn.is-copied{background:#e8f7ee;border-color:#3a9a60;color:#2d7a4a;}
  .btn-secondary:hover{background:var(--foam);}

  /* ============== Timeline View (1日 × 24時間 × スタッフ) ============== */
  /* 左右に散らさず、同じ幅の間隔で左から詰める（店長要望 2026-08-16） */
  .tl-toolbar{background:#fff;padding:.6rem .7rem;border-bottom:1px solid var(--gray);display:flex;justify-content:flex-start;align-items:center;flex-wrap:wrap;gap:.7rem;}
  /* タイトル + 新規予約ボタンを横並びに */
  .tl-toolbar .tl-title-row{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;}
  .tl-toolbar .tl-title{font-size:1.15rem;font-weight:700;color:var(--deep);}
  .tl-toolbar .tl-title .tl-sub{display:block;font-size:.72rem;color:var(--ink-soft);font-weight:400;margin-top:.2rem;letter-spacing:.05em;}
  /* いま見ているのが「今日」かどうかを一目で（店長要望 2026-08-11） */
  .tl-toolbar .tl-title .tl-todaypill{display:inline-block;margin-left:.45rem;padding:.1rem .5rem;border-radius:9999px;
    background:var(--coral,#e2725b);color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.06em;vertical-align:.12em;}
  .tl-toolbar .tl-nav.is-today input[type="date"]{border-color:var(--coral,#e2725b);background:#fff5f1;font-weight:700;color:var(--deep);}
  .tl-toolbar .tl-nav button#tlToday:disabled{background:var(--coral,#e2725b);color:#fff;border-color:var(--coral,#e2725b);
    font-weight:700;opacity:1;cursor:default;}
  .tl-toolbar .tl-nav button#tlToday:disabled:hover{background:var(--coral,#e2725b);color:#fff;}
  .tl-toolbar .tl-nav{display:flex;gap:.7rem;align-items:center;flex-wrap:wrap;}
  /* 検索群はタイトルのすぐ右に置く（画面が広いほど右端へ離れていくと目線が飛ぶため）。
     新規追加ボタンだけは従来どおり右端に逃がす */
  #view-customers .tl-toolbar,#view-bookings .tl-toolbar{justify-content:flex-start;gap:1rem;}
  #view-customers .tl-toolbar .tl-nav,#view-bookings .tl-toolbar .tl-nav{flex:1;}
  #view-customers .tl-toolbar .tl-nav #cuAddNew,
  #view-bookings .tl-toolbar .tl-nav #bkAddNew{margin-left:auto;}
  .tl-toolbar .tl-nav button{background:var(--foam);border:1.5px solid var(--gray);padding:.45rem .8rem;border-radius:8px;font-size:.85rem;cursor:pointer;}
  .tl-toolbar .tl-nav button:hover{background:var(--aqua);color:#fff;border-color:var(--aqua);}
  .tl-toolbar .tl-nav input[type="date"]{padding:.42rem .5rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;font-family:'Outfit';min-width:158px;}
  /* 日付は「年」「先頭の/」を隠す webkit ハックがSafariで効かず「/08/15」のまま残っていたため撤去。
     代わりに入力欄の文字を透明にし、その上に曜日つきの表示(8/15(土))を重ねる（店長指摘 2026-08-16）。
     クリックは下の input にそのまま通るので、タップすれば従来通りカレンダーが開く */
  .tl-date-wrap{position:relative;display:inline-flex;}
  /* iOS は color だけでは日付の文字が消えず、重ねた表示と二重になる（店長指摘 2026-08-17）。
     -webkit-text-fill-color と ::-webkit-date-and-time-value まで指定して確実に隠す */
  .tl-date-wrap input[type="date"]{color:transparent;-webkit-text-fill-color:transparent;}
  .tl-date-wrap input[type="date"]::-webkit-datetime-edit,
  .tl-date-wrap input[type="date"]::-webkit-date-and-time-value{color:transparent;-webkit-text-fill-color:transparent;}
  /* 表示は「8/15（土）」だけなので、他の日付欄(158px)より詰められる（店長要望 2026-08-16） */
  #tlDatePicker{min-width:0;width:120px;padding-left:.55rem;padding-right:1.7rem;}
  .tl-date-disp{position:absolute;left:.55rem;top:50%;transform:translateY(-50%);pointer-events:none;
    font-family:'Outfit',sans-serif;font-size:.86rem;font-weight:600;color:var(--deep);white-space:nowrap;}
  .tl-toolbar .tl-nav.is-today .tl-date-disp{font-weight:700;}
  /* 電話番号の照会ボタン（新規受付のときだけ表示・店長要望 2026-08-16） */
  .bm-phone-lookup-btn{flex:none;background:var(--foam);border:1.5px solid var(--aqua);color:var(--sea);
    border-radius:8px;padding:.55rem .7rem;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-phone-lookup-btn:hover{background:var(--sea);color:#fff;border-color:var(--sea);}
  .bm-phone-lookup-btn:disabled{opacity:.5;cursor:default;}
  /* 予約管理: ステータスフィルタ + 検索を見やすく */
  .tl-toolbar .tl-nav select#bkFilterStatus{padding:.7rem 2rem .7rem 1rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.95rem;background:var(--white);color:var(--deep);min-width:140px;font-weight:600;}
  @media(max-width:780px){
    .tl-toolbar .tl-nav select#bkFilterStatus{width:100%;font-size:16px;padding:.85rem 2rem .85rem 1rem;}
    #view-bookings .tl-nav{flex-direction:column;align-items:stretch;gap:.5rem;width:100%;}
    #view-bookings .tl-nav input[type="search"]{width:100%;}
  }
  /* 詳細度: .tl-toolbar .tl-nav button{background:--foam}(0,2,1) に負けないよう button.tl-add(0,3,1) で上書き */
  .tl-toolbar button.tl-add,.tl-toolbar .tl-nav button.tl-add{background:var(--sea);color:#fff;border:none;padding:.55rem 1.3rem;border-radius:50px;font-size:.88rem;font-weight:600;cursor:pointer;}
  .tl-toolbar button.tl-add:hover{background:var(--deep);color:#fff;border-color:transparent;}

  /* クイック電話受付 */
  .tl-phone-quick{display:flex;gap:.7rem;flex-wrap:wrap;align-items:center;background:var(--foam);border:1.5px dashed var(--aqua);border-radius:12px;padding:.4rem .6rem;}
  .tl-phone-quick .pq-label{font-size:.72rem;color:var(--sea);font-weight:700;letter-spacing:.06em;align-self:center;}
  /* 更新ボタン（クイック予約の枠の外・単独で置く・店長要望 2026-08-16） */
  .tl-toolbar button.tl-reload{background:#fff;color:var(--sea);border:1.5px solid var(--aqua);border-radius:8px;
    padding:.55rem .9rem;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1.2;align-self:center;}
  .tl-toolbar button.tl-reload:hover{background:var(--sea);color:#fff;border-color:var(--sea);}
  .tl-toolbar button.tl-reload:disabled{opacity:.5;cursor:default;}
  .tl-phone-quick .pq-row{display:flex;gap:.3rem;align-items:center;}
  .tl-phone-quick .pq-row label{font-size:.78rem;color:var(--ink-soft);}
  .tl-phone-quick .pq-row input{padding:.42rem .65rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;font-family:'Outfit';width:160px;letter-spacing:.04em;}
  .tl-phone-quick .pq-row input:focus{outline:none;border-color:var(--sea);background:#fff;}
  .tl-phone-quick .pq-row button{background:var(--sea);color:#fff;border:none;padding:.42rem .85rem;border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:600;}
  .tl-phone-quick .pq-row button:hover{background:var(--deep);}

  /* 左右パディングは撤去: sticky スタッフ列の左に中身が透けるバグの原因 (schedule.css と同対応) */
  .tl-wrap{padding:1.2rem 0;max-width:1800px;margin:0 auto;overflow-x:auto;}
  /* 掴んで動かしている間だけ。文字が選択されると青くなって見づらいので止める（店長要望 2026-08-08）。
     タイムラインとタブバーで共用 */
  .tl-dragging{cursor:grabbing;user-select:none;-webkit-user-select:none;}
  .tl-dragging *{cursor:grabbing!important;}

  /* ===== 上部を固定（店長要望 2026-08-24）=====
     日付バー(.tl-toolbar) はページの追従、見出し行(.tl-head) はタイムライン枠の中で追従。
     縦スクロールを .tl-wrap の中に閉じ込めることで、受付リストも画面から消えなくなる。
     ※ .tl-wrap は overflow-x:auto ＝ それ自体がスクロール枠なので、
        中の sticky を効かせるには「縦もこの枠でスクロールさせる」必要がある */
  #view-timeline .tl-toolbar{position:sticky;top:var(--hdr-h, 68px);z-index:95;}
  /* 枠の上余白を残すと、そこを通り抜ける行が見出しの上にチラ見えする（店長指摘 2026-08-24）→ 0にする
     高さは「画面 − ヘッダー − 日付バー」。210px 決め打ちだとスマホで日付バーが背が高く、
     枠の下がページの底より下に出てしまい最後の行まで届かなかった（店長指摘 2026-08-27）。
     --tl-stick は admin.js が実測して入れる（画面幅・向きが変わるたび取り直す） */
  #view-timeline .tl-split .tl-wrap{max-height:calc(100dvh - var(--tl-stick, 210px));overflow:auto;overscroll-behavior:contain;padding-top:0;-webkit-overflow-scrolling:touch;}
  /* 行が下をくぐるので、見出しは必ず不透明＋影で境目を作る */
  #view-timeline .tl-head{position:sticky;top:0;z-index:58;background:var(--deep);box-shadow:0 3px 8px rgba(10,61,82,.35);}
  #view-timeline .tl-head.staff-col{z-index:62;background:#072b3a;}   /* 左上の角は縦横どちらの固定より前面 */
  body[data-theme="soft"] #view-timeline .tl-head{background:#2d4a52;}
  body[data-theme="soft"] #view-timeline .tl-head.staff-col{background:#243d44;}
  /* 受付リストの見出しを「キャスト」の見出しと同じ高さ・同じ位置に揃える（店長要望 2026-08-24）。
     枠の上余白を0にしたぶん、パネル側の下げ幅（枠線1px）も取り直す */
  #view-timeline .tl-head,
  #view-timeline .recv-head{min-height:44px;box-sizing:border-box;}
  #view-timeline .tl-head{display:flex;align-items:center;}
  #view-timeline .recv-panel{margin-top:-1px;}

  /* ===== 受付リスト（着信履歴）左パネル ＋ タイムライン 2カラム ===== */
  .tl-split{display:flex;gap:.5rem;align-items:flex-start;padding:0;}
  .tl-split .tl-wrap{flex:1;min-width:0;max-width:none;margin:0;padding:.35rem 0 .6rem;}
  /* 受付リストはタイムラインと頭を揃える（追従で固定すると見出しの高さがずれる・店長指摘 2026-08-16）。
     枠線1px ぶん下がるので margin-top を 1px 引く */
  .recv-panel{flex:0 0 352px;width:352px;background:var(--white);border:1px solid var(--gray);border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(10,61,82,.06);display:flex;flex-direction:column;max-height:calc(100vh - 120px);position:static;margin-top:calc(.35rem - 1px);}
  .recv-head{background:var(--deep);color:#fff;padding:.6rem .9rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-shrink:0;}
  .recv-title{font-size:.95rem;font-weight:700;letter-spacing:.02em;}
  .recv-title .recv-sub{font-size:.72rem;font-weight:500;opacity:.85;margin-left:.35rem;}
  .recv-count{font-size:.74rem;font-weight:600;background:rgba(255,255,255,.16);padding:.2rem .55rem;border-radius:50px;white-space:nowrap;}
  .recv-count b{font-family:'Outfit';font-size:.92rem;}
  /* 電話番号は幅を固定し、余りは顧客名側へ。番号と名前の間があきすぎないように（店長要望 2026-08-16） */
  /* 顧客名は5文字ぶん(72px)を必ず確保。時間・電話・状態は内容ぶんまで詰める（店長要望 2026-08-16） */
  .recv-colhead,.recv-row{display:grid;grid-template-columns:34px 112px minmax(72px,1fr) 48px 46px;gap:.25rem;align-items:center;}
  .recv-colhead{background:var(--foam);color:var(--sea);font-size:.68rem;font-weight:700;padding:.42rem .6rem;border-bottom:1px solid var(--gray);letter-spacing:.02em;flex-shrink:0;}
  .recv-list{overflow-y:auto;flex:1;}
  .recv-row{padding:.5rem .6rem;border-bottom:1px solid var(--foam);font-size:.8rem;transition:background .12s;}
  .recv-row:hover{background:var(--foam);}
  /* 新着の着信は10秒だけ点滅で知らせる（店長要望 2026-08-16）。
     色は常時付けておき（見落とし防止）、その上で1秒周期で明滅させる。10秒後にJSがクラスを外す */
  .recv-row.is-new{background:#ffd9a8;box-shadow:inset 3px 0 0 #f0862b;animation:recvNew 1s ease-in-out 10;}
  .recv-row.is-new .rr-time{color:#b3421a;font-weight:800;}
  .recv-row.is-new .rr-name{color:#8a3410;}
  @keyframes recvNew{
    0%,100%{background:#ffc888;box-shadow:inset 3px 0 0 #e2691a;}
    50%{background:#fff7ec;box-shadow:inset 3px 0 0 #f8c799;}
  }
  .recv-row .rr-time{font-family:'Outfit';font-size:.78rem;color:var(--ink-soft);}
  .recv-row .rr-phone{font-family:'Outfit';font-weight:600;color:var(--deep);letter-spacing:0;white-space:nowrap;font-size:.82rem;}
  /* 掛け直しをまとめた行の回数バッジ（1回だけの着信には出ない） */
  .recv-row .rr-cnt{display:inline-block;margin-left:.3rem;padding:.05rem .32rem;border-radius:50px;
    background:var(--foam);color:var(--sea);font-size:.66rem;font-weight:700;vertical-align:middle;}
  .recv-row:hover .rr-cnt{background:#fff;}
  .recv-row .rr-name{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.84rem;font-weight:700;}
  /* クラス名は is-empty。素の empty だと下の共通ルール .loading,.empty{padding:3rem 1rem} に当たり、
     顧客名が空の行だけ縦に約3倍伸びる（店長指摘 2026-08-13）*/
  .recv-row .rr-name.is-empty{color:var(--ink-soft);opacity:.55;font-weight:400;}
  .recv-state{font-size:.66rem;font-weight:700;text-align:center;padding:.16rem .2rem;border-radius:50px;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;}   /* キャスト名が長くても列幅は変えない（店長要望 2026-08-16） */
  .recv-state.s-none{background:transparent;color:var(--ink-soft);opacity:.5;}
  .recv-state.s-inquiry{background:#fff3d6;color:#a86b00;}
  .recv-state.s-reserved{background:#d8f3e0;color:#1c7c46;}
  .recv-act{background:var(--sea);color:#fff;border:none;border-radius:6px;padding:.34rem 0;font-size:.72rem;font-weight:700;cursor:pointer;text-align:center;}
  .recv-act:hover{background:var(--deep);}
  .recv-act.edit{background:var(--coral);color:#5a2c17;}
  .recv-act.edit:hover{background:#f2895f;}
  .recv-empty{padding:2.2rem 1rem;text-align:center;color:var(--ink-soft);font-size:.82rem;line-height:1.7;}
  @media(max-width:1100px){
    .tl-split{flex-direction:column;padding:0 .6rem;}
    .recv-panel{flex:none;width:100%;max-height:none;position:static;margin-top:.6rem;}
    /* スマホでは受付リストを2行ぶんに抑え、残りはこの中でスクロール。
       空いたぶんタイムラインを広く見せる（店長要望 2026-08-25） */
    .recv-list{max-height:96px;}
    .tl-split .tl-wrap{padding:.6rem 0;width:100%;}
    /* スマホは枠の底を画面の底にぴったり合わせる（下の行に届かなくなるため余白を作らない） */
    /* さらに overscroll-behavior は解除する。contain のままだと枠を下までスクロールしたあと
       指がそこに乗っている限りページ側が動かず、枠の下側（＝立川秘密基地の行）が
       画面の外に隠れたまま出てこない（店長指摘 2026-08-28） */
    #view-timeline .tl-split .tl-wrap{padding-bottom:0;overscroll-behavior:auto;}
  }
  /* キャスト管理画面（biyobu.com/cosmenote/）の専用URL・暗証番号（店長要望 2026-08-11） */
  .sr-access{margin-top:.45rem;padding-top:.45rem;border-top:1px dashed var(--gray);display:flex;flex-direction:column;gap:.35rem;}
  .sra-url{display:flex;gap:.3rem;align-items:center;}
  .sra-url-in{flex:1;min-width:0;padding:.3rem .45rem;border:1.5px solid var(--gray);border-radius:7px;
    font-size:.74rem;font-family:'Outfit';background:var(--foam);color:var(--ink);}
  .sra-copy{flex:0 0 auto;padding:.28rem .5rem;border:1.5px solid var(--gray);border-radius:7px;background:#fff;cursor:pointer;font-size:.8rem;}
  .sra-copy:hover{background:var(--foam);}
  .sra-line{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;}
  .sra-pin{font-size:.74rem;font-weight:700;color:var(--ink-soft);}
  .sra-pin.is-set{color:#2f6b34;}
  .sra-pin.is-locked{color:#c0392b;}
  .sra-note{font-weight:400;color:var(--ink-soft);font-size:.72rem;}
  .sra-pin-in{width:5.2em;padding:.28rem .45rem;border:1.5px solid var(--gray);border-radius:7px;
    font-size:16px;font-weight:700;letter-spacing:.32em;text-align:center;font-family:'Outfit';background:#fff;}
  .sra-btn{padding:.24rem .55rem;font-size:.72rem;font-weight:700;border:1.5px solid var(--sea);color:var(--sea);
    background:#fff;border-radius:50px;cursor:pointer;white-space:nowrap;}
  .sra-btn:hover{background:var(--sea);color:#fff;}
  .sra-btn.is-warn{border-color:var(--coral,#e2725b);color:var(--coral,#e2725b);}
  .sra-btn.is-warn:hover{background:var(--coral,#e2725b);color:#fff;}
  .sra-btn:disabled{opacity:.5;cursor:default;}
  /* ⚠ キャストからの報告（店長要望 2026-08-11） */
  .tl-toolbar .tl-nav button.tl-rep-btn{background:#fdece7;border-color:var(--coral,#e2725b);color:#a2402a;font-weight:700;}
  .tl-toolbar .tl-nav button.tl-rep-btn:hover{background:var(--coral,#e2725b);color:#fff;}
  .tl-rep-btn b{font-family:'Outfit';font-size:1rem;margin:0 .1rem;}
  .cr-item{border:1.5px solid var(--gray);border-radius:12px;padding:.8rem .9rem;margin-bottom:.7rem;background:#fff;}
  .cr-item.is-done{opacity:.62;background:var(--foam);}
  .cr-top{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;font-size:.88rem;color:var(--ink-soft);}
  .cr-lv{font-size:.78rem;font-weight:700;padding:.16rem .55rem;border-radius:50px;white-space:nowrap;}
  .cr-lv.lv-ng{background:#fbe0dc;color:#a2402a;}
  .cr-lv.lv-caution{background:#fdf0d8;color:#8a5a12;}
  .cr-cust{font-size:1.02rem;font-weight:700;color:var(--deep);margin-top:.3rem;}
  .cr-reason{margin-top:.4rem;background:var(--foam);border-radius:8px;padding:.55rem .7rem;
    font-size:.92rem;line-height:1.8;white-space:pre-wrap;color:var(--ink);}
  /* 4つのボタンは幅で折り返すと不ぞろいになるので、2列ずつの格子でそろえる */
  .cr-acts{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;margin-top:.7rem;}
  @media(max-width:560px){ .cr-acts{grid-template-columns:repeat(2,1fr);} }
  .cr-acts button{padding:.5rem .4rem;font-size:.82rem;font-weight:700;border-radius:50px;cursor:pointer;
    border:1.5px solid var(--sea);color:var(--sea);background:#fff;white-space:nowrap;}
  .cr-acts button:hover{background:var(--sea);color:#fff;}
  .cr-acts button.is-ng{border-color:#c0392b;color:#c0392b;}
  .cr-acts button.is-ng:hover{background:#c0392b;color:#fff;}
  .cr-acts button:disabled{opacity:.5;cursor:default;}
  .cr-done-note{margin-top:.5rem;font-size:.8rem;color:var(--ink-soft);}
  #castRepFoot{justify-content:space-between;align-items:center;}
  .cr-allsw{display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--ink-soft);cursor:pointer;}
  .cr-allsw input{width:16px;height:16px;margin:0;cursor:pointer;}
  /* 顧客カルテの中の報告履歴 */
  .cm-reports{margin-top:.6rem;}
  .cm-rep{border-left:3px solid #e2725b;background:#fdf6f3;border-radius:0 8px 8px 0;padding:.5rem .7rem;margin-bottom:.45rem;}
  .cm-rep-h{font-size:.8rem;color:var(--ink-soft);display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;}
  .cm-rep-b{font-size:.9rem;line-height:1.75;white-space:pre-wrap;color:var(--ink);margin-top:.2rem;}

  /* キャスト一覧の並び替え（店長要望 2026-08-11: CTRL と同じ 入店順・出勤頻度順＋あいうえお順） */
  .sb-sort{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:0 0 .8rem;}
  .sb-sort label{font-size:.85rem;font-weight:700;color:var(--ink-soft);}
  .sb-sort select{padding:.4rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.88rem;
    font-weight:600;background:var(--white);color:var(--ink);}
  .sb-sort-note{font-size:.78rem;color:var(--ink-soft);}

  /* 👥 キャスト管理（role=staff 一覧。.staff-table/.staff-row を流用） */
  #view-staffboard .staff-main{max-width:1060px;}
  #staffBoard{overflow-x:auto;}
  /* 🪪 キャスト専用マイページ */
  #view-therapist .staff-main{max-width:760px;}
  .th-grid{display:grid;gap:1rem;}
  .th-card{background:#fff;border:1.5px solid var(--gray);border-radius:14px;padding:1rem 1.1rem;}
  .th-card-h{font-weight:700;color:var(--deep);margin-bottom:.7rem;}
  .th-book{display:flex;align-items:center;gap:.7rem;padding:.5rem 0;border-top:1px solid var(--foam);}
  .th-book:first-of-type{border-top:none;}
  .th-book.tappable{cursor:pointer;border-radius:8px;transition:background .12s;}
  .th-book.tappable:hover{background:var(--foam);}
  .th-book-chev{color:var(--aqua);font-size:1.4rem;line-height:1;flex-shrink:0;font-weight:700;}
  .th-book-seq{display:inline-block;font-size:.7rem;font-weight:700;color:var(--sea);background:var(--foam);border-radius:6px;padding:.05rem .45rem;margin-bottom:.2rem;}
  .mc-card{border:1.5px solid var(--gray);border-radius:12px;padding:.7rem .9rem;margin-bottom:.55rem;cursor:pointer;transition:border-color .12s;}
  .mc-card:hover{border-color:var(--sea);}
  .mc-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;}
  .mc-name{font-weight:700;color:var(--deep);}
  .mc-meta{font-size:.78rem;color:var(--ink-soft);white-space:nowrap;}
  .mc-chev{color:var(--aqua);font-weight:700;font-size:1.1rem;}
  .mc-detail{margin-top:.6rem;border-top:1px solid var(--gray);padding-top:.4rem;}
  .mc-bk{padding:.35rem 0;font-size:.85rem;border-top:1px solid var(--foam);}
  .mc-bk:first-child{border-top:none;}
  .mc-bk-date{color:var(--sea);font-weight:700;}
  .mc-bk-note{color:var(--ink-soft);font-size:.8rem;margin-top:.15rem;}
  .th-book-time{font-weight:700;color:var(--sea);min-width:3em;}
  .th-book-main{flex:1;min-width:0;}
  .th-book-st{font-size:.78rem;color:var(--ink-soft);white-space:nowrap;}
  .th-svc{display:inline-block;margin-top:.3rem;font-size:.72rem;font-weight:700;padding:.1rem .5rem;border-radius:999px;background:#eef1f3;color:var(--ink-soft);}
  /* リピーターバッジ（キャストのマイページ）。ご新規=金 / リピ=緑 / 自分との関係=薄地 */
  /* マイページ💬チャットの受付ON/OFF（店長指定 2026-09-02: ONの子だけ指名ピッカーに出す） */
  .th-chat-visrow{margin:0 0 .55rem;display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;}
  .th-chat-vis{display:inline-flex;align-items:center;gap:.4rem;font-size:.84rem;font-weight:700;cursor:pointer;
    border:1.5px solid var(--gray);border-radius:50px;padding:.35rem .8rem;background:#fff;color:var(--ink-soft);}
  .th-chat-vis input{width:1.05rem;height:1.05rem;accent-color:var(--coral);}
  .th-chat-vis.on{border-color:var(--coral);background:#fdece7;color:#a2402a;}
  /* 前日までに入っていた予約・事前予約の印（店長要望 2026-09-02） */
  .th-adv{display:inline-block;margin:.3rem .3rem 0 0;font-size:.72rem;font-weight:800;padding:.1rem .5rem;border-radius:999px;
    background:#fdece7;color:#a2402a;border:1px solid #f0bda3;}
  .th-rep{display:inline-block;margin:.3rem .3rem 0 0;font-size:.72rem;font-weight:700;padding:.1rem .5rem;border-radius:999px;background:#e4f1e2;color:#2d6733;}
  .th-rep.new{background:#fbf1d6;color:#75540c;}
  .th-rep.me{background:#eef1f3;color:var(--ink-soft);font-weight:600;}
  .th-svc.live{background:#d6f1f6;color:#1d7a8c;}
  .th-svc.done{background:#d9efd5;color:#3a7547;}
  .th-svc-btn{flex-shrink:0;font-size:.82rem;padding:.45rem .9rem;}
  .th-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;text-align:center;}
  .th-stats > div{background:var(--foam);border-radius:10px;padding:.7rem .3rem;display:flex;flex-direction:column;gap:.2rem;}
  .th-num{font-weight:800;color:var(--deep);font-size:1.15rem;}
  .th-lbl{font-size:.75rem;color:var(--ink-soft);}
  .th-att-row{display:flex;align-items:center;gap:.7rem;margin-bottom:.9rem;}
  .th-att-badge{display:inline-block;font-weight:800;font-size:.95rem;padding:.3rem .9rem;border-radius:999px;}
  .th-att-badge.on{background:#d9efd5;color:#2f7a45;}
  .th-att-badge.off{background:#f1f1f1;color:#888;}
  .th-att-badge.tentative{background:#fff0c8;color:#a06f1d;}
  .th-att-badge.none{background:#eef1f3;color:var(--ink-soft);}
  .th-att-time{color:var(--ink-soft);font-size:.9rem;font-weight:700;}
  .th-tp-label{font-size:.8rem;color:var(--ink-soft);font-weight:700;margin-bottom:.4rem;}
  .th-att-note{font-size:.78rem;color:var(--ink-soft);margin:.6rem 0 0;}
  .th-nav{display:flex;gap:.4rem;margin-bottom:.8rem;}
  .th-nav-btn{flex:1;padding:.45rem .3rem;border:1.5px solid var(--gray);border-radius:8px;background:#fff;color:var(--ink-soft);font-size:.82rem;font-weight:700;cursor:pointer;transition:.15s;}
  .th-nav-btn:hover:not(:disabled){border-color:var(--sea);color:var(--sea);}
  .th-nav-btn.active{background:var(--sea);border-color:var(--sea);color:#fff;}
  .th-nav-btn:disabled{opacity:.4;cursor:default;}
  .sbf-row{display:grid;grid-template-columns:96px 200px minmax(230px,1fr) 190px;border:1px solid #aeb8be;margin-bottom:7px;background:#fff;font-size:.82rem;min-width:640px;}
  .sbf-row > div{border-right:1px solid #aeb8be;display:flex;flex-direction:column;}
  .sbf-row > div:last-child{border-right:none;}
  .sbf-photo{background:#e8edf0;}
  .sbf-photo img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
  .sbf-noimg{flex:1;min-height:120px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:#8a989f;}
  .sbf-badges{display:flex;border-top:1px solid #aeb8be;}
  .sbf-badges span{flex:1;text-align:center;font-size:.72rem;font-weight:700;padding:3px 0;border-right:1px solid #aeb8be;}
  .sbf-badges span:last-child{border-right:none;}
  .bg-new{background:#fff34d;color:#d00;}
  .bg-d{background:#e6ebee;color:#667;}
  .sbf-stats{color:#fff;}
  .sbf-stats.c-on{background:#5bb06a;}
  .sbf-stats.c-off{background:#9aa7ad;}
  .sbf-stats > div{padding:.32rem .4rem;text-align:center;font-weight:700;border-bottom:1px solid rgba(255,255,255,.45);}
  .sbf-name{font-size:1.02rem;}
  .sbf-unsent{color:#fff0a6;font-size:.74rem;font-weight:700;}
  .sbf-in{background:#fff;padding:3px;}
  .sbf-in input{width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;height:22px;font-size:.8rem;}
  .sbf-shift{background:#ededed;}
  .sbf-sh-head{background:#d6d6d6;padding:.32rem;text-align:center;font-weight:700;color:#333;border-bottom:1px solid #aeb8be;}
  .sbf-sh-row{display:flex;gap:5px;padding:5px;border-bottom:1px solid #aeb8be;align-items:center;}
  .sbf-sel{flex:1;padding:3px;border:1px solid #999;border-radius:4px;font-size:.8rem;background:#fff;color:#333;}
  .sbf-mail{background:#fff;border:1px solid #888;border-radius:4px;padding:3px 10px;font-size:.8rem;cursor:pointer;white-space:nowrap;}
  .sbf-sh-labels{display:flex;}
  .sbf-sh-labels span{flex:1;text-align:center;background:#c0c0c0;color:#333;font-size:.72rem;font-weight:600;padding:3px;border-right:1px solid #aeb8be;}
  .sbf-sh-labels span:last-child{border-right:none;}
  .sbf-notes{flex:1;background:#ffff66;min-height:56px;padding:5px;color:#d00;font-size:.78rem;white-space:pre-wrap;}
  .sbf-acc-head{background:#d6d6d6;text-align:center;font-weight:700;color:#333;padding:.32rem;border-bottom:1px solid #aeb8be;}
  .sbf-acc-row{display:flex;justify-content:space-between;padding:.32rem .5rem;border-bottom:1px solid #aeb8be;font-weight:700;color:#333;}
  .sbf-acc-row .r{color:#d00;}
  /* 24時間軸: スタッフ列 + 24時間スロット */
  /* 1時間セル幅は公開スケジュール (/schedule/) と揃える: PC=96px / mobile=72px */
  /* overflow:hidden は sticky 列を無効化するので避ける (角丸は border-radius のみで適用) */
  /* スタッフ列は 受/完 バッジのぶんだけ広げてある（200→224px・店長指摘 2026-08-07） */
  /* 1時間の幅は 96px → 144px（店長要望 2026-08-08: ホテル名や送迎の名前が入りきらない）。
     min-width = スタッフ列224 + 24時間×144 + すき間25 = 3705 */
  .tl-grid{display:grid;grid-template-columns:224px repeat(24, minmax(144px, 1fr));gap:1px;background:var(--gray);border-radius:12px;min-width:3705px;position:relative;}
  /* 現在時刻の縦線（当日のみ・1分ごとに動く）。控えめな薄ピンクで邪魔しない（店長要望 2026-08-13） */
  /* 中央に出す確認ダイアログ（ブラウザ既定の confirm は上部固定で位置を変えられないため自前） */
  .ops-confirm-ov{position:fixed;inset:0;background:rgba(7,43,58,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:2000;padding:1rem;}
  .ops-confirm{background:#fff;border-radius:18px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(7,43,58,.4);overflow:hidden;animation:opsConfirmIn .14s ease-out;}
  @keyframes opsConfirmIn{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}
  .ops-confirm-body{padding:1.5rem 1.6rem 1rem;font-size:1rem;line-height:1.7;color:var(--ink,#2e2724);}
  .ops-confirm-line{min-height:1.2em;word-break:break-word;}
  .ops-confirm-btns{display:flex;gap:.6rem;justify-content:flex-end;padding:.4rem 1.4rem 1.4rem;}
  .ops-confirm-btns button{border:none;border-radius:50px;padding:.6rem 1.5rem;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;}
  .ops-confirm-cancel{background:var(--foam,#f6e7de);color:#7a5340;}
  .ops-confirm-ok{background:var(--sea,#b06a3a);color:#fff;box-shadow:0 3px 10px rgba(176,106,58,.3);}
  .ops-confirm-btns button:hover{filter:brightness(1.05);}
  .tl-nowline{position:absolute;top:0;bottom:0;width:2px;background:repeating-linear-gradient(rgba(224,80,135,.62) 0 3px,transparent 3px 7px);z-index:6;pointer-events:none;}
  .tl-nowline::before{content:'';position:absolute;top:0;left:-3px;width:8px;height:8px;border-radius:50%;background:rgba(224,80,135,.95);}
  /* 事前予約のお約束（出勤確認の連絡・到着見込みの連絡） */
  .bm-prep{background:linear-gradient(135deg,#f7f2ff,#fdfbff);border:1.5px solid #d9cdf0;border-radius:12px;padding:.85rem .9rem;margin-top:1.4rem;}
  .bm-prep > label{color:#5b3f8a;margin-bottom:.6rem;}
  .bm-prep-line{display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;}
  .bm-prep-lbl{font-size:.78rem;color:var(--ink-soft);font-weight:700;width:5.4rem;flex:none;}
  .bm-prep-m,.bm-prep-k{border:1.5px solid var(--gray);background:#fff;border-radius:50px;padding:.35rem .85rem;font-size:.82rem;font-weight:700;color:var(--ink-soft);cursor:pointer;}
  .bm-prep-m.is-on,.bm-prep-k.is-on{background:#6b4a9e;border-color:transparent;color:#fff;}
  /* 入力欄は幅を絞る。他の欄と同じ100%幅だと1行に収まらず縦に伸びてしまう */
  /* width を指定しないと .modal-body select{width:100%} を拾って枠いっぱいに広がり、時と分が縦に並ぶ */
  .bm-prep .bm-prep-sel{flex:none;width:auto;padding:.4rem .5rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.95rem;font-family:inherit;background:#fff;cursor:pointer;min-width:3.6rem;}
  .bm-prep .bm-prep-colon{font-weight:800;color:var(--ink-soft);}
  .bm-prep-line:last-child{margin-bottom:0;}
  @media(max-width:520px){.bm-prep-lbl{width:100%;}}
  /* タイムラインカードの連絡アラート。💳未 と同じ位置に置き、カードの形は変えない */
  .tl-booking .bk-prewarn{font-size:.66rem;font-weight:700;padding:.02rem .22rem;border-radius:4px;white-space:nowrap;flex:none;cursor:pointer;}
  /* 未対応のあいだは点滅させて気づけるようにする（店長要望 2026-08-10）。
     色が付いた状態が基準なので、アニメが止まっても読める＝可視性はアニメ依存にしない */
  @keyframes bkPreBlink{0%,100%{opacity:1;}50%{opacity:.28;}}
  .tl-booking .bk-prewarn.is-due{background:#c0392b;color:#fff;animation:bkPreBlink .8s ease-in-out infinite;}
  .tl-booking .bk-prewarn.is-wait{background:#6b4a9e;color:#fff;animation:bkPreBlink 1.5s ease-in-out infinite;}
  /* LINE で連絡するぶんは LINE の緑。電話は紫のまま（店長要望 2026-08-10） */
  .tl-booking .bk-prewarn.is-wait.is-line{background:#06c755;}

  /* 時刻の見出しはマスの左端＝その時刻ちょうどの位置なので左寄せにする（店長要望 2026-08-10） */
  .tl-head{background:var(--deep);color:#fff;padding:.55rem .5rem;font-size:.78rem;text-align:left;font-weight:600;letter-spacing:.04em;}
  /* スタッフ列は横スクロール時に左端固定 (公開スケジュールと同じ挙動) */
  .tl-head.staff-col{background:#072b3a;text-align:left;padding-left:.9rem;display:flex;align-items:center;font-size:.85rem;position:sticky;left:0;z-index:60;box-shadow:6px 0 12px -2px rgba(10,61,82,.35);isolation:isolate;transform:translateZ(0);}
  .tl-head .tl-hour{font-family:'Outfit';font-size:.9rem;font-weight:700;display:block;line-height:1;}
  .tl-head .tl-hour.next-day{color:var(--aqua-light);}
  .tl-staff{background:var(--white);padding:.22rem .25rem;font-weight:600;color:var(--deep);font-size:.9rem;display:flex;flex-direction:column;justify-content:center;gap:.14rem;position:sticky;left:0;z-index:55;box-shadow:6px 0 12px -2px rgba(10,61,82,.18);isolation:isolate;transform:translateZ(0);}
  .tl-staff-body{display:flex;flex-direction:row;align-items:center;gap:.28rem;}
  .tl-staff-info{display:flex;flex-direction:column;align-items:stretch;justify-content:center;flex:1;min-width:0;gap:.06rem;}
  .tl-staff-left{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem;width:64px;flex-shrink:0;}
  .tl-att-sel{width:100%;font-size:.68rem;font-weight:700;color:#fff;border:none;border-radius:50px;padding:.22rem 1.05rem .22rem .55rem;cursor:pointer;-webkit-appearance:none;appearance:none;text-align:center;text-align-last:center;box-shadow:0 1px 3px rgba(10,61,82,.2);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23fff' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .5rem center;}
  .tl-att-sel.tl-att-available{background-color:#1d7a9c;}
  .tl-att-sel.tl-att-done{background-color:#6b6b6b;}
  .tl-att-sel.tl-att-off{background-color:#c0392b;}
  .tl-att-sel.tl-att-tentative{background-color:#a0aab4;}
  .tl-staff-left .tl-staff-name{font-size:.78rem;word-break:break-word;text-align:center;}
  /* 時間・件数・預り金・報酬・入金分の全行に下線（最後の行にも引く）。
     線は金額側だけ。写真・名前・出勤ボタンの後ろには通さない（店長指定 2026-08-16） */
  .tl-m{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem;font-size:.72rem;line-height:1.25;
        padding-bottom:.16rem;margin-bottom:.1rem;position:relative;}
  /* 線が薄くて行の区切りが読み取れなかったので、太さと濃さを上げる（店長指摘 2026-09-01）。
     var(--gray)=#e2e8ec は背景と差が出ないため、この線だけ直に指定する */
  .tl-m::after{content:'';position:absolute;left:0;right:-.25rem;bottom:0;z-index:0;
        border-bottom:1.5px dashed #9fb1bd;}
  .tl-staff-left{position:relative;z-index:1;}
  body[data-theme="soft"] .tl-m::after{border-bottom-color:#a9b7a9;}
  .tl-m-l{color:var(--ink-soft);font-weight:600;flex-shrink:0;}
  /* 報酬・入金分がその日ぶん終わっている印（店長要望 2026-08-29） */
  .tl-m-ok{font-size:.78em;margin-right:.15em;}
  .tl-m.is-done .tl-m-v{color:#2e9e5b;}
  /* 件数行: 左に「貴重品」「釣銭」のトグル、件数は右寄せ（店長要望 2026-08-16） */
  .tl-m-count .tl-m-flags{display:flex;gap:.25rem;align-items:center;min-width:0;}
  .tl-m-count .tl-m-v{margin-left:auto;}
  .tl-flag{flex:0 0 auto;border:1.5px solid var(--gray);background:#fff;color:var(--ink-soft);
    border-radius:50px;padding:.06rem .38rem;font-size:.64rem;font-weight:700;line-height:1.45;cursor:pointer;
    font-family:inherit;white-space:nowrap;}
  .tl-flag:hover{border-color:var(--sea);color:var(--sea);}
  /* 預かり中（まだ戻っていない）＝オレンジ／ 済み＝緑（店長要望 2026-08-16） */
  .tl-flag.is-on{background:#e2725b;border-color:#e2725b;color:#fff;box-shadow:0 1px 3px rgba(226,114,91,.35);}
  .tl-flag.is-on:hover{background:#cf6049;border-color:#cf6049;color:#fff;}
  .tl-flag.is-done{background:#2e9e5b;border-color:#2e9e5b;color:#fff;}
  .tl-flag.is-done:hover{background:#27884e;border-color:#27884e;color:#fff;}
  .tl-m-v{font-weight:800;color:var(--deep);font-family:'Outfit',sans-serif;white-space:nowrap;text-align:right;}
  .tl-m-card{font-size:.86em;} /* 入金分のカードぶん（💳）。色は親(入金分=coral)を継承 */
  /* 時間行: 数値の上に置き、薄い区切り線でスケジュールと金額を分ける */
  .tl-m-time .tl-m-l{color:var(--deep);}
  .tl-m-time .tl-m-v{font-size:.82rem;letter-spacing:.01em;}
  /* 「今」「終」の印が入っても列からはみ出さないよう、この行だけ余白を詰める（店長指摘 2026-08-22） */
  .tl-m-time{gap:.2rem;}
  .tl-m-time .tl-endtype{margin-left:.18em;padding:0 .24em;}
  .tl-m-time .tl-m-wave{margin:0 .08em;}
  /* サイト・媒体に出していない出勤（CTRLで「OPSのみ」を選んだ日） */
  .tl-m-private .tl-m-l{color:#7d4a95;}
  .tl-m-private .tl-m-v{color:#7d4a95;font-size:.72rem;letter-spacing:.02em;}
  .tl-m-wave{margin:0 .15em;color:var(--ink-soft);font-weight:600;}
  /* 受/完＝終了時刻の意味。受付できるかの判断に使うので、時刻のすぐ後ろに小さく強めの色で出す */
  .tl-endtype{display:inline-block;margin-left:.25em;padding:0 .3em;border-radius:4px;font-size:.82em;font-weight:800;line-height:1.4;white-space:nowrap;}
  .tl-endtype-accept{background:#ddeff4;color:#0d5e70;}
  .tl-endtype-finish{background:#fde9d9;color:#8a4a12;}
  /* まとめのコピー / メール操作 */
  .cs-actions{display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem;flex-wrap:wrap;}
  .cs-act-btn{border:1.5px solid var(--sea);color:var(--sea);background:#fff;border-radius:50px;padding:.35rem .9rem;font-size:.82rem;font-weight:700;cursor:pointer;touch-action:manipulation;}
  .cs-act-btn:hover{background:var(--foam,#f6e7de);}
  .cs-act-msg{font-size:.8rem;font-weight:700;color:var(--green,#3a9a60);}
  /* 担当者カードごとのコピー/メール */
  .cs-hcard-actions{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.55rem;padding-top:.5rem;border-top:1px dashed var(--gray);}
  /* お客様行の担当キャスト名 */
  .cs-item-cast{font-size:.74rem;font-weight:700;color:var(--deep);background:#f1ece6;padding:.03rem .4rem;border-radius:5px;}
  /* 勤務実績: 出勤予定（シフト）。ドライバーが何時から出られるか把握用 */
  .cs-work-sched{display:block;font-size:.72rem;font-weight:700;color:var(--coral);margin-top:.1rem;}
  /* 勤務実績モーダルは1名1行で読めるように（店長要望 2026-08-29） */
  #workLogModal .cs-work-name{display:flex;align-items:baseline;gap:.4rem;flex:1 1 9.5em;min-width:7em;}
  #workLogModal .cs-work-sched{display:inline;margin-top:0;white-space:nowrap;}
  #workLogModal .cs-work-row{flex-wrap:nowrap;}
  /* スマホ: 1行に入りきらず右へはみ出していた。名前を1行目にして下に入力欄を折り返す。
     モーダル自体も下端貼り付き（ボトムシート）だと読みづらいので真ん中に出す（店長指摘 2026-09-01） */
  @media (max-width:560px){
    #workLogModal .cs-work-row{flex-wrap:wrap!important;row-gap:.3rem;padding:.5rem 0;border-top:1px solid rgba(10,61,82,.09);}
    #workLogModal .cs-work-row:first-of-type{border-top:none;}
    #workLogModal .cs-work-name{flex:0 0 100%!important;min-width:0!important;white-space:normal;}
    #workLogModal .cs-work-row select{padding:.3rem .2rem!important;}
    #workLogModal .cs-work-km{width:3.8em!important;}
    #workLogModal .cs-work-hours{margin-left:auto;}
    #workLogModal .modal-body{overflow-x:hidden;}
  }
  @media (max-width:480px){
    #workLogModal.modal-overlay{align-items:center!important;padding:.7rem!important;}
    #workLogModal .modal{width:100%!important;max-width:100%!important;
      border-radius:18px!important;max-height:86dvh!important;}
  }
  /* 開始と終了がそろったら「5.5H」を出す */
  .cs-work-hours{flex:0 0 auto;min-width:3.4em;text-align:right;font-family:'Outfit';font-weight:700;font-size:.82rem;color:var(--sea);}
  .cs-work-row.is-off .cs-work-hours{color:var(--ink-soft);opacity:.5;}
  /* 報酬モーダル: 渡す人の選択＋メール */
  .rwd-giver-row{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem;padding:.5rem .6rem;background:var(--foam,#f6e7de);border-radius:10px;}
  .rwd-giver-l{font-size:.82rem;font-weight:700;color:var(--deep);}
  .rwd-giver-sel{flex:1;min-width:120px;padding:.4rem .5rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;font-family:inherit;background:#fff;}
  .rwd-mail-btn{border:1.5px solid var(--sea);color:var(--sea);background:#fff;border-radius:50px;padding:.4rem .8rem;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;}
  .rwd-mail-btn:hover{background:#fff3ec;}
  /* 現金まとめ: 誰が持っているか一目で分かるよう、保有ありは枠を強調し役割バッジを添える */
  .cs-holder{border:1px solid var(--gray);border-radius:10px;padding:.6rem;margin-bottom:.5rem;background:#fff;}
  .cs-holder.has-cash{border-color:#f0b699;background:#fffaf6;box-shadow:0 1px 4px rgba(190,90,30,.12);}
  /* カード決済ぶんの報酬を現金から立て替えると手元がマイナスになる（店長指定 2026-08-08）。
     「渡しすぎ」ではなく「立て替え中」なので、警告色より落ち着いた赤枠にする */
  .cs-holder.is-minus{border-color:#e2a09a;background:#fdf6f5;box-shadow:0 1px 4px rgba(160,50,40,.12);}
  /* 上がった人（終了）は落ち着かせて下へ。いま動いている人を目立たせるため（店長要望 2026-08-16） */
  .cs-holder.is-finished{background:#f6f7f8;border-color:#d8dde0;box-shadow:none;opacity:.85;}
  .cs-finish{margin-left:auto;flex:none;padding:.28rem .8rem;border:1.5px solid var(--sea);border-radius:50px;
    background:#fff;color:var(--sea);font-size:.8rem;font-weight:800;cursor:pointer;touch-action:manipulation;font-family:inherit;}
  .cs-finish:hover{background:var(--sea);color:#fff;}
  .cs-finish.is-done{border-color:#9aa3a8;color:#5a6268;background:#eceeef;}
  .cs-finished-sec{margin-top:1rem;padding-top:.7rem;border-top:2px dashed var(--gray);}
  .cs-finished-title{font-weight:800;color:var(--ink-soft);font-size:.88rem;margin-bottom:.5rem;}
  .cs-minus-note{margin-left:.35rem;font-size:.72rem;font-weight:700;color:#c0392b;
    background:#fbe6e3;padding:.05rem .4rem;border-radius:5px;}
  .cs-role{display:inline-block;padding:.05rem .4rem;border-radius:5px;font-size:.7rem;font-weight:700;margin-left:.1rem;}
  .cs-role-office{background:#efe9f8;color:#573c78;}
  .cs-role-driver{background:#e4f1e2;color:#2d6733;}
  .cs-role-cast{background:#eef8fa;color:#12667e;}
  /* 現金＋クレジット併用: 現金額だけ入れれば残りは自動。入力は1つに絞る */
  .bm-split{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-top:.5rem;
    padding:.6rem .7rem;border:1.5px solid #cfe0ea;border-radius:10px;background:#f4fafd;}
  .bm-split label{font-weight:700;font-size:.86rem;margin:0!important;}
  .bm-split input{width:8em;padding:.4rem .55rem;border:1.5px solid var(--gray);border-radius:8px;
    font-size:1rem;font-weight:700;text-align:right;}
  .bm-split-note{flex-basis:100%;font-size:.8rem;font-weight:600;color:var(--ink-soft);}
  .bm-split-note.over{color:#c0392b;}
  /* 指名料マスタ: 指名料とキャスト報酬を並べて、別物だと分かるようにする */
  .ms-nom-grid{display:grid;grid-template-columns:auto auto auto;gap:.5rem 1.2rem;align-items:center;justify-content:start;}
  .ms-nom-h{font-size:.8rem;font-weight:700;color:var(--ink-soft);}
  .ms-nom-l{font-weight:700;}
  .ms-nom-grid input{width:7em;padding:.45rem .6rem;border:1.5px solid var(--gray);border-radius:8px;
    font-size:1rem;font-weight:700;text-align:right;margin-right:.25rem;}
  /* 受け渡しの流れ: 現金が誰の手を通って今ここにあるか（店長要望 2026-08-08） */
  .cs-chain{font-size:.72rem;color:var(--ink-soft);font-weight:600;margin-top:.1rem;}
  .cs-arrow{color:#c2410c;font-weight:700;}
  /* 渡したぶん: もう手元に無いので、金額は控えめにして保有分と読み間違えないようにする */
  /* 渡し終えて ¥0 になった人。普段は畳んでおき、受け渡しの確認が要るときだけ開く */
  .cs-settled{margin:.2rem 0 1rem;}
  .cs-settled > summary{cursor:pointer;font-size:.8rem;font-weight:700;color:var(--ink-soft);padding:.35rem 0;}
  .cs-settled > summary:hover{color:var(--sea);}
  .cs-gave-head{margin-top:.45rem;padding-top:.35rem;border-top:1.5px dashed var(--gray);
    font-size:.78rem;font-weight:700;color:#2d6733;display:flex;align-items:baseline;gap:.35rem;flex-wrap:wrap;}
  .cs-gave-note{font-size:.7rem;font-weight:600;color:var(--ink-soft);}
  .cs-gave-row{font-size:.78rem;padding:.15rem 0;display:flex;justify-content:space-between;gap:.4rem;color:var(--ink-soft);}
  .cs-gave-row b{font-weight:600;}
  .cs-gave-to{color:#2d6733;font-weight:700;white-space:nowrap;}
  /* 受け取った報酬: 預り金から出ていったぶん。渡したぶんと区別できるよう色を分ける */
  .cs-reward-head{margin-top:.45rem;padding-top:.35rem;border-top:1.5px dashed var(--gray);
    font-size:.78rem;font-weight:700;color:#8a4a12;display:flex;align-items:baseline;gap:.35rem;flex-wrap:wrap;}
  .cs-reward-from{color:#8a4a12;font-weight:700;white-space:nowrap;}
  /* 誰からまとめて預かったか（受け取り集計） */
  .cs-recv-head{margin-top:.4rem;padding:.3rem .5rem;background:#eef6f0;border-radius:8px;
    font-size:.8rem;font-weight:700;color:#2c7d59;display:flex;align-items:baseline;gap:.35rem;flex-wrap:wrap;}
  /* 受け取った時刻。同じ人でも別々の受け渡しを見分けられるよう、金額のすぐ後ろに小さく出す */
  .cs-recv-at{font-size:.72rem;font-weight:700;color:#1f6b4a;background:#d8ede0;border-radius:6px;padding:.05rem .35rem;}
  /* 各やり取りの右に、その時点の手持ち額（店長要望 2026-08-15）。最後の行が「いま持っている」と一致する */
  .cs-bal{margin-left:auto;font-size:.8rem;font-weight:800;font-family:'Outfit',sans-serif;white-space:nowrap;}
  .cs-bal.is-plus{color:#c2410c;}
  .cs-bal.is-zero{color:var(--ink-soft);}
  .cs-bal.is-minus{color:#c0392b;}
  /* まだ渡していない報酬（渡し忘れ防止） */
  .cs-unpaid{background:#fdecec;border:1.5px solid #f0b8b8;border-radius:10px;padding:.5rem .7rem;margin-bottom:.7rem;}
  .cs-unpaid-title{font-size:.82rem;font-weight:800;color:#b3261e;margin-bottom:.25rem;}
  .cs-unpaid-row{display:flex;justify-content:space-between;gap:.5rem;font-size:.86rem;font-weight:700;color:#7a1f18;padding:.12rem 0;}
  /* 勤務実績: 一日の締めのついでに入れる場所。行が増えるので詰めて置く */
  /* 現金まとめの中から次の人へ渡す（店長要望 2026-08-11） */
  .cs-handoff{display:flex;gap:.4rem;align-items:center;margin-top:.5rem;padding-top:.5rem;border-top:1px dashed var(--gray);}

  .cs-handoff select{flex:1 1 auto;min-width:0;width:auto!important;padding:.4rem .5rem!important;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:var(--white);
    color:var(--ink);font-weight:600;}
  .cs-handoff-go{flex:0 0 auto;padding:.42rem .7rem;font-weight:700;font-size:.82rem;background:var(--sea);color:#fff;border:none;border-radius:8px;white-space:nowrap;cursor:pointer;}
  .cs-handoff-go:disabled{opacity:.5;}
  /* 「◯◯ から受け取る」＝渡すボタンと同じ形。色だけ落として見分けられるように（店長要望 2026-08-22） */
  .cs-recv-go{flex:0 0 auto;padding:.42rem .7rem;font-weight:700;font-size:.82rem;background:#eef4f6;
        color:var(--deep);border:1.5px solid #cfe0e6;border-radius:8px;white-space:nowrap;cursor:pointer;}
  .cs-recv-go:hover{background:#e3edf1;}
  .cs-recv-go:disabled{opacity:.5;}
  /* 金額だけの受け渡し（つり銭など）。予約ごとの受け渡しの下に置く（店長要望 2026-08-14） */
  .cs-amt{flex-wrap:wrap;border-top-style:dotted;}
  .cs-amt input{width:auto!important;min-width:0;padding:.4rem .5rem!important;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:var(--white);
    color:var(--ink);font-weight:600;}
  .cs-amt .cs-amt-yen{flex:0 0 5.5rem;text-align:right;font-family:'Outfit';font-weight:700;}
  .cs-amt .cs-amt-note{flex:1 1 7rem;}
  .cs-amt-go{flex:0 0 auto;padding:.42rem .7rem;font-weight:700;font-size:.82rem;background:var(--sea);color:#fff;border:none;border-radius:8px;white-space:nowrap;cursor:pointer;}
  .cs-amt-go:disabled{opacity:.5;}
  /* 受け渡し記録の取り消し（打ち間違い用）。行の右端に小さく */
  .cs-tr-del{margin-left:auto;flex:none;width:20px;height:20px;line-height:1;border:none;border-radius:50%;background:rgba(0,0,0,.08);color:var(--ink-soft);font-size:.8rem;cursor:pointer;}
  .cs-tr-del:hover{background:#f4c7c3;color:#8b2f24;}
  .cs-work{margin-top:1rem;border:1.5px solid var(--gray);border-radius:12px;padding:.7rem .8rem;background:var(--foam);}
  .cs-work-head{font-weight:700;font-size:.9rem;margin-bottom:.5rem;display:flex;align-items:baseline;gap:.4rem;flex-wrap:wrap;}
  .cs-work-row{display:flex;align-items:center;gap:.35rem;padding:.25rem 0;flex-wrap:nowrap;}
  .cs-work-name{flex:1 1 5.5em;min-width:4.2em;font-weight:700;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  /* .modal-body input{width:100%} が効いて入力欄が横いっぱいに伸び、名前が潰れて右へはみ出していた
     （店長指摘 2026-08-11）。この行だけは幅を固定したいので !important で押さえる */
  .cs-work-row input{padding:.3rem .35rem!important;border:1.5px solid var(--gray);border-radius:7px;font-size:16px;font-weight:600;background:var(--white);}
  /* 時刻は15分刻みの自前select（input[type=time] の step はピッカーに効かないため） */
  .cs-work-row select{flex:0 0 auto!important;width:auto!important;min-width:0;padding:.3rem .35rem!important;
    border:1.5px solid var(--gray);border-radius:7px;font-size:16px;font-weight:600;background:var(--white);color:var(--ink);}
  .cs-work-colon{flex:0 0 auto;font-weight:700;color:var(--ink-soft);margin:0 -.1rem;}
  .cs-work-km{flex:0 0 auto!important;width:4.2em!important;min-width:0;text-align:right;}
  /* 狭い画面では名前を1行目に折り返す（横スクロールを出さない） */
  @media (max-width:430px){
    .cs-work-row{flex-wrap:wrap;}
    .cs-work-name{flex:0 0 100%;}
  }
  .cs-work-sep,.cs-work-unit{flex:0 0 auto;font-size:.8rem;color:var(--ink-soft);}
  /* 「休」= シフトに入っていたのに出ていない人。空欄（未入力）と区別するための印（店長要望 2026-08-19） */
  .cs-work-off{flex:0 0 auto;width:1.9rem;height:1.9rem;padding:0;border:1.5px solid var(--gray);border-radius:8px;
    background:var(--white);color:var(--ink-soft);font-weight:800;font-size:.82rem;line-height:1;cursor:pointer;}
  .cs-work-off.is-on{border-color:#c98b8b;background:#fdeeee;color:#a33a3a;}
  .cs-work-row.is-off .cs-work-name{color:#a33a3a;}
  .cs-work-row.is-off select,.cs-work-row.is-off input{opacity:.45;}
  .cs-work-foot{display:flex;align-items:center;gap:.7rem;margin-top:.6rem;}
  button.tl-staff-sales.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;-webkit-tap-highlight-color:rgba(232,93,47,.25);}
  button.tl-staff-sales.tl-m .tl-m-l,button.tl-staff-sales.tl-m .tl-m-v{color:var(--coral);}
  /* 預り金（青・クリックで受け渡し履歴） */
  button.tl-staff-held.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;text-align:left;-webkit-tap-highlight-color:rgba(29,122,156,.2);}
  button.tl-staff-held.tl-m .tl-m-v{text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:2px;}
  button.tl-staff-held.tl-m .tl-m-l,button.tl-staff-held.tl-m .tl-m-v{color:var(--sea);}
  /* 報酬（緑・背景/枠なし）。預り金=青・報酬=緑・入金分=コーラルで色分け */
  button.tl-staff-reward.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;-webkit-tap-highlight-color:rgba(58,154,96,.2);}
  button.tl-staff-reward.tl-m .tl-m-l,button.tl-staff-reward.tl-m .tl-m-v{color:var(--green);}
  /* 受け渡しの流れ表示 */
  .chain-flow{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;margin:.45rem 0 .1rem;}
  .chain-node{display:inline-flex;flex-direction:column;align-items:center;background:var(--foam);border:1px solid var(--aqua-light);border-radius:8px;padding:.2rem .5rem;font-size:.82rem;font-weight:700;color:var(--deep);line-height:1.2;}
  .chain-node small{font-size:.6rem;font-weight:600;color:var(--ink-soft);}
  .chain-node.start{background:#eef9fb;border-color:var(--aqua);}
  /* 個人の色を決めていない人（キャスト・ドライバー）は送迎ボタンと同じ黄色（店長指定 2026-08-16） */
  .chain-node.r-office{background:#efe9f8;border-color:#c3b2e0;color:#573c78;}
  .chain-node.r-driver,.chain-node.r-cast{background:#ffd76a;border-color:#e6b93f;color:#5a4200;}
  .chain-node.shop{background:#e9f7ee;border-color:#8ed3a6;color:#2e7d4f;}
  /* 現在の保有者を強調（オレンジのピル＋影） */
  .chain-node.now{background:var(--coral);border-color:var(--coral-deep);color:#fff;box-shadow:0 2px 8px rgba(224,116,60,.4);}
  .chain-node.now small{color:#fff;opacity:.95;}
  .chain-arrow{color:var(--ink-soft);font-weight:700;}
  .chain-ctrl{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin-top:.5rem;}
  /* 「いま持っている人」バッジ（受け渡し操作行の先頭） */
  .chain-now-badge{display:inline-flex;align-items:center;gap:.2rem;background:#fff3ee;border:1.5px solid var(--coral);color:var(--coral-deep);font-size:.82rem;font-weight:700;padding:.28rem .6rem;border-radius:50px;}
  .chain-now-badge b{color:var(--coral-deep);}
  .tl-staff .role-mini{font-size:.7rem;color:var(--coral);font-weight:600;}
  /* 「時間」を 出勤時間 ⇄ 今から遊べる時間（即姫） で交互に出す（店長要望 2026-08-20）。
     2つを同じマスに重ねて置き、見せる方だけ切り替える＝行の高さが行き来しない
     （消す方を display:none にすると、切り替わるたびにカードの背丈が動く） */
  .tl-m-alt{display:grid;grid-template-columns:minmax(0,1fr);}   /* マスを行の幅いっぱいに（既定だと中身の幅で止まり、右寄せが効かなかった） */
  .tl-m-alt .tl-alt-a{grid-area:1/1;display:flex;justify-content:space-between;
        align-items:baseline;gap:.4rem;min-width:0;}
  /* 遊べる時刻の行はラベルなし。ふつうのブロックにして右寄せ（flexだと右端まで届かなかった） */
  .tl-m-alt .tl-alt-b{grid-area:1/1;display:block;width:100%;text-align:right;}
  .tl-m-alt .tl-alt-b .tl-m-v{display:block;width:100%;text-align:right;}
  /* パッと入れ替えず、右から左へ流れるように切り替える（見続けても疲れないように・店長指定 2026-08-22）。
     出ていく方は左へ抜け、入ってくる方は右から入る（どちらの向きの切替でも流れが同じになる） */
  .tl-m-alt .tl-alt-a,.tl-m-alt .tl-alt-b{transition:opacity .7s ease-in-out,transform .7s ease-in-out;
        pointer-events:none;}
  .tl-m-alt .tl-alt-b{opacity:0;transform:translateX(18px);}
  .tl-m-alt.show-b .tl-alt-a{opacity:0;transform:translateX(-18px);}
  .tl-m-alt.show-b .tl-alt-b{opacity:1;transform:none;}
  .tl-m-alt.show-b .tl-alt-b,
  .tl-m-alt:not(.show-b) .tl-alt-a{animation:tlSlideFromRight .7s ease-in-out;}
  @keyframes tlSlideFromRight{from{opacity:0;transform:translateX(18px);}to{opacity:1;transform:none;}}
  /* 「0:00〜遊べる」は出勤時間とまったく同じ色・大きさ。右寄せ・囲みなし（店長指定 2026-08-21） */
  /* 「今」バッジと同じ赤。日本語が混ざるぶん大きく見えるので、出勤時間の数字と揃うよう少し下げる */
  .tl-play-hm{color:var(--red);font-weight:800;text-align:right;font-size:.78rem;}
  /* 遊べる時間・「今」はクリックでその場で変えられる（店長要望 2026-08-22） */
  .tl-m-alt.show-b .tl-alt-b .tl-play-hm{pointer-events:auto;cursor:pointer;}
  .tl-nowmark{cursor:pointer;}
  /* もう遊べる人は切り替えず、出勤時間の「受」の隣に「今」を出しっぱなし（店長指定 2026-08-21） */
  .tl-m-alt.is-nowmode .tl-alt-a{opacity:1 !important;transform:none !important;}
  .tl-m-alt.is-nowmode .tl-alt-b{opacity:0 !important;}
  .tl-nowmark{display:inline-block;margin-left:.18em;padding:0 .22em;border-radius:4px;font-size:.74em;
        font-weight:800;line-height:1.4;white-space:nowrap;background:var(--red);color:#fff;
        transform-origin:center;animation:tlNowPop 3.4s ease-in-out infinite;}
  /* ゆっくり薄くなって、ポンと戻る（チカチカさせない・店長指定 2026-08-21） */
  @keyframes tlNowPop{
    0%{opacity:1;transform:scale(1);}
    55%{opacity:.15;transform:scale(.94);}
    68%{opacity:1;transform:scale(1.16);}
    78%{transform:scale(.98);}
    86%,100%{opacity:1;transform:scale(1);}
  }
  .tl-nowmark[hidden]{display:none;}
  /* 即姫を受付終了にしている人の印。「今」と同じ形で色だけ落とす（店長要望 2026-08-22） */
  .tl-endmark{display:inline-block;margin-left:.18em;padding:0 .22em;border-radius:4px;font-size:.74em;
        font-weight:800;line-height:1.4;white-space:nowrap;background:#7b8794;color:#fff;cursor:pointer;}
  .tl-staff-thumb{display:block;width:50px;height:50px;flex-shrink:0;border-radius:8px;object-fit:cover;margin:0;border:1.5px solid var(--gray);}
  .tl-staff-thumb-ph{display:flex;align-items:center;justify-content:center;width:50px;height:50px;flex-shrink:0;border-radius:8px;margin:0;background:var(--aqua-light);color:var(--deep);font-weight:800;font-size:1.3rem;}
  .tl-staff-name{font-weight:700;line-height:1.15;}
  .tl-staff-time{font-size:.66rem;color:var(--ink-soft);margin-top:.12rem;white-space:nowrap;font-weight:600;}
  .tl-staff-unassigned{background:linear-gradient(135deg,#f7f2ea,#fff0e5);color:var(--coral);}
  .tl-staff-unassigned .role-mini{color:var(--ink-soft);}
  /* スタッフ行はrelativeで予約ブロックをabsolute配置 */
  .tl-row-track{display:contents;}
  /* 行エリア: スタッフ列(col1)の右(col2/-1)。予約は中の独立レイヤーで描画し z-index:1 で固定列(z55)の下層に閉じ込め＝透け防止 (schedule方式) */
  .tl-row-area{grid-column:2 / -1;position:relative;display:grid;grid-template-columns:repeat(24, minmax(144px, 1fr));gap:1px;z-index:1;}
  /* キャストごとの行の切れ目をはっきり出す（店長要望 2026-08-24）。
     1pxのgapだけだと隣の行と溶けて「どのキャストのタイムラインか」を目で追えなかった。
     左の固定列(.tl-staff)と右の行エリア(.tl-row-area)の両方に同じ太さで入れて、
     画面の端から端まで1本の線に見せる（行の高さも揃う） */
  /* 半透明だと下の白背景と混ざって結局グレーに見えるので、必ず不透明色で引く（店長指摘 2026-08-24） */
  .tl-staff, .tl-row-area{border-bottom:1px solid var(--sea);}
  /* 空きマスはダブルクリックで新規予約。touch-action:manipulation でダブルタップズームを抑える */
  .tl-cell{background:var(--white);min-height:94px;cursor:pointer;transition:background .15s;position:relative;touch-action:manipulation;user-select:none;}
  .tl-cell:hover{background:var(--foam);}
  .tl-cell.shift-bg{background:linear-gradient(180deg,#eaf6f9,#f4fbfd);}
  /* 予約ブロックは、各スタッフの最初のセルに配置して absolute で広げる */
  .tl-bk-wrap{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;}
  /* ===== 立川秘密基地（別システム）の出勤行。自店のキャストと見間違えないよう、色を落として区別する ===== */
  .tl-staff.hk-head{flex-direction:row;align-items:center;justify-content:space-between;gap:.5rem;
    background:linear-gradient(90deg,#eef1f4,#f7f9fa);border-top:2px solid var(--gray);}
  .hk-head-t{font-size:.82rem;font-weight:800;color:var(--ink-soft);white-space:nowrap;}
  .hk-head-n{font-size:.78rem;font-weight:700;color:var(--ink-soft);display:inline-flex;align-items:center;gap:.5rem;}
  /* 秘密基地の管理画面への入口（オーダー登録/お仕事登録）。別タブで開くリンク（店長要望 2026-09-01） */
  .hk-add{display:inline-block;margin-top:.25rem;padding:.22rem .6rem;font-size:.7rem;font-weight:800;
    border:1.5px solid #f0761a;color:#c95c0a;background:#fff;border-radius:50px;text-decoration:none;white-space:nowrap;}
  .hk-add:hover{background:#f0761a;color:#fff;}
  .tl-booking.hk-bk{cursor:pointer;}
  /* 秘密基地オーダーモーダル。アドミの予約モーダルと見間違えないようオレンジの帯を敷く */
  #hkOrderModal .modal{border-top:5px solid #f0761a;}
  #hkOrderModal .mh-title{color:#c95c0a;}
  .hko-sec{margin:.85rem 0 .3rem;font-size:.8rem;font-weight:800;color:#c95c0a;border-bottom:1.5px dashed #f2c39f;padding-bottom:.25rem;}
  .hko-row{display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;margin:.4rem 0;}
  .hko-row label.hko-l{flex:0 0 5.4em;font-size:.8rem;font-weight:700;color:var(--ink-soft);}
  /* .modal-body select{width:100%} を打ち消す（年月日・時分が縦に並び、ラベルが潰れていた） */
  #hkOrderModal .modal-body select{width:auto;padding:.5rem .6rem;}
  #hkOrderModal .modal-body input:not([type="checkbox"]):not([type="radio"]){width:auto;padding:.5rem .6rem;}
  .hko-row input[type="text"],.hko-row input[type="tel"]{flex:1 1 8rem;min-width:0;}
  .hko-gap{flex:0 0 .6rem;}
  .hko-radio{display:inline-flex;align-items:center;gap:.25rem;font-size:.85rem;font-weight:600;
    border:1.5px solid var(--gray);border-radius:50px;padding:.3rem .7rem;cursor:pointer;background:#fff;}
  .hko-radio input{accent-color:#f0761a;}
  .hko-radio:has(input:checked){border-color:#f0761a;background:#fff4ec;color:#c95c0a;}
  .hko-check{display:inline-flex;align-items:center;gap:.3rem;font-size:.84rem;font-weight:600;cursor:pointer;}
  .hko-check input{width:1.05rem;height:1.05rem;accent-color:#f0761a;}
  .hko-course-row{display:flex;gap:.5rem;align-items:center;margin:.35rem 0;padding:.35rem 0;border-bottom:1px dashed var(--gray);}
  .hko-course-row .hko-ckind{flex:0 0 auto;font-size:.68rem;font-weight:800;color:#c95c0a;background:#fff4ec;border:1px solid #f2c39f;border-radius:6px;padding:.08rem .4rem;}
  .hko-course-row .hko-cname{flex:1 1 auto;min-width:0;font-size:.86rem;font-weight:700;white-space:normal;}
  .hko-course-del{flex:0 0 auto;width:1.7rem;height:1.7rem;border:none;border-radius:50%;background:rgba(0,0,0,.08);color:var(--ink-soft);cursor:pointer;line-height:1;}
  .hko-course-del:hover{background:#f4c7c3;color:#8b2f24;}
  /* 縦積みフィールド（向こうのフォームと同じ「ラベルの下に入力」） */
  .hko-field{margin:.6rem 0;}
  .hko-field>label{display:block;font-size:.78rem;font-weight:700;color:var(--ink-soft);margin-bottom:.28rem;}
  .hko-req{color:#c0392b;font-weight:700;font-size:.9em;margin-left:.15em;}
  #hkOrderModal .hko-field>input:not([type="checkbox"]):not([type="radio"]),
  #hkOrderModal .hko-field>select{width:100%;}
  /* オプションは丸チップを横に並べてコンパクトに（店長指摘 2026-09-01） */
  .hko-opts{display:flex;flex-wrap:wrap;gap:.4rem;margin:.3rem 0 .5rem;}
  .hko-opt-chip{border:1.5px solid var(--gray);border-radius:50px;padding:.3rem .7rem;background:#fff;font-size:.82rem;}
  .hko-opt-chip:has(input:checked){border-color:#f0761a;background:#fff4ec;color:#c95c0a;}
  /* 電話番号照会の結果（秘密基地の顧客管理から） */
  .hko-tel-hit{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.45rem;
    padding:.5rem .7rem;background:var(--foam);border:1.5px solid var(--aqua-light);border-radius:10px;}
  .hko-tel-hit .hko-tel-info{flex:1 1 12rem;min-width:0;display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap;font-size:.84rem;}
  .hko-tel-hit .hko-tel-info b{font-size:.95rem;color:var(--deep);}
  .hko-tel-hit .hko-tel-info span{color:var(--ink-soft);font-size:.78rem;}
  .hko-tel-none{margin-top:.45rem;padding:.45rem .7rem;background:#fdf6f3;border:1.5px dashed #f2c39f;border-radius:10px;
    font-size:.82rem;color:#a2461d;font-weight:600;}
  .hko-copybtn{padding:.38rem .8rem;font-size:.78rem;font-weight:700;border:1.5px solid var(--sea);color:var(--sea);
    background:#fff;border-radius:50px;cursor:pointer;white-space:nowrap;}
  .hko-copybtn:hover{background:var(--sea);color:#fff;}
  .hko-total{margin-top:.9rem;padding:.6rem .8rem;background:#fff4ec;border:1.5px solid #f2c39f;border-radius:10px;
    font-size:.92rem;color:var(--ink);line-height:1.9;}
  .hko-total b{font-family:'Outfit';font-size:1.1em;color:#c95c0a;}
  .hko-trash{background:#fff;border:1.5px solid var(--red);color:var(--red);padding:.5rem 1.1rem;border-radius:50px;
    font-weight:700;font-size:.84rem;cursor:pointer;}
  .hko-trash:hover{background:var(--red);color:#fff;}
  .hko-foot{display:flex;gap:.7rem;align-items:center;margin-top:1rem;flex-wrap:wrap;}
  .hko-save{background:#f0761a;color:#fff;border:none;padding:.55rem 1.5rem;border-radius:50px;font-weight:800;font-size:.9rem;cursor:pointer;}
  .hko-save:hover{background:#c95c0a;}
  .hko-save:disabled{opacity:.5;}
  .hko-open-hk{font-size:.76rem;color:var(--ink-soft);text-decoration:underline;}
  .hko-note{font-size:.74rem;color:var(--ink-soft);}
  #hkOrderModal textarea{width:100%;min-height:3.2em;padding:.45rem .55rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;}
  .tl-staff.hk-staff{background:#fafbfc;}
  .tl-staff.hk-staff .tl-staff-name{color:var(--ink-soft);}
  .hk-thumb{background:#e6eaee !important;color:var(--ink-soft) !important;}
  .tl-staff .role-mini.hk-mini{color:var(--ink-soft);}
  .tl-cell.hk-cell{cursor:default;min-height:70px;}
  .tl-cell.hk-cell.shift-bg{background:linear-gradient(180deg,#eef1f4,#f7f9fa);}
  .hk-busy{position:absolute;top:4px;bottom:4px;border-radius:6px;background:#b9c3cc;color:#fff;
    font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;
    white-space:nowrap;overflow:hidden;}
  /* 向こうの画面と同じ塗り分け: お仕事＝オレンジ / 講習会など＝濃いグレー */
  .hk-busy.is-job{background:#f0761a;box-shadow:0 1px 4px rgba(240,118,26,.4);}
  .hk-busy.is-other{background:#7b8794;}
  /* スタッフ列の「お仕事」表示 */
  .hk-job-row{display:flex;flex-wrap:wrap;gap:.3rem;}
  .hk-job{display:inline-block;font-size:.72rem;font-weight:800;padding:.06rem .4rem;border-radius:999px;
    background:#fdece0;color:#c2560b;white-space:nowrap;}
  .hk-job.hk-job-none{background:#eef1f4;color:var(--ink-soft);font-weight:700;}
  .hk-job.hk-job-now{background:#f0761a;color:#fff;animation:hkNow 1.4s ease-in-out infinite;}
  @keyframes hkNow{0%,100%{opacity:1}50%{opacity:.55}}
  /* 予約バーの詳細ふきだし（店長要望 2026-08-08: ブラウザ標準の title は小さすぎ情報も足りない）。
     バーに重ならないよう body 直下に出し、画面端では左右・上下を反転させる */
  .bk-tip{position:fixed;z-index:1200;max-width:min(92vw,420px);background:#fff;color:var(--ink);
    border:1.5px solid var(--gray);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.22);
    padding:.75rem .9rem;font-size:.92rem;line-height:1.6;pointer-events:none;opacity:0;transition:opacity .1s;}
  .bk-tip.show{opacity:1;}
  .bk-tip-head{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;
    padding-bottom:.45rem;margin-bottom:.5rem;border-bottom:1.5px solid var(--gray);}
  .bk-tip-time{font-family:'Outfit';font-size:1.25rem;font-weight:800;color:var(--deep);letter-spacing:.02em;}
  .bk-tip-name{font-size:1.05rem;font-weight:800;}
  .bk-tip-badge{font-size:.74rem;font-weight:700;padding:.1rem .5rem;border-radius:999px;border:1.5px solid currentColor;color:var(--deep);}
  .bk-tip-r{display:grid;grid-template-columns:4.6em 1fr;gap:.1rem .7rem;}
  .bk-tip-l{color:var(--ink-soft);font-weight:600;font-size:.86rem;}
  .bk-tip-v{font-weight:700;word-break:break-word;}
  /* 市区町村・補足（交通費込み等）は本文より一段弱く。読む順序を主→従にする */
  .bk-tip-city,.bk-tip-sub{color:var(--ink-soft);font-weight:600;font-size:.86rem;}
  .bk-tip-note{margin-top:.5rem;padding-top:.5rem;border-top:1.5px dashed var(--gray);
    font-size:.86rem;font-weight:600;color:#a5342f;white-space:pre-wrap;}
  /* スタッフ間メモ（キャストには出さない）。予約メモと区別できるよう色を変える */
  .bk-tip-note.is-staff{background:#fff3f3;color:#8a2b2b;}
  .bk-tip-ok{color:#2f7a46;font-weight:800;}
  .bk-tip-warn{color:#b3600c;font-weight:800;}
  .bk-paywarn{flex:0 0 auto;background:#eda72c;color:#4a2c00;font-size:.62rem;font-weight:800;
    padding:0 .25rem;border-radius:4px;line-height:1.5;white-space:nowrap;cursor:pointer;}
  /* 決済が済んだら消さずに「確認ずみ」を出す（店長要望 2026-08-22） */
  .bk-paywarn.is-paid{background:#d8f0e0;color:#1f6b41;}
  /* 領収証: 渡すまで点滅、渡したら点灯のまま（店長要望 2026-08-23） */
  .bk-receipt{flex:0 0 auto;background:#a33a3a;color:#fff;font-size:.62rem;font-weight:800;
    padding:0 .3rem;border-radius:4px;line-height:1.5;white-space:nowrap;cursor:pointer;
    animation:bkReceiptBlink 1.1s steps(1,end) infinite;}
  .bk-receipt.is-given{background:#d8f0e0;color:#1f6b41;animation:none;opacity:1;}
  @keyframes bkReceiptBlink{0%,49%{opacity:1}50%,100%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){
    /* 視差効果を減らす設定でも見落とさないよう、点滅の代わりに枠を強調する */
    .bk-receipt{animation:none;box-shadow:0 0 0 2px #f5c2c2;}
  }
  /* 貸出品（バスタオル・ローター等）。回収するまで出す。押すと回収済み（店長要望 2026-08-16） */
  .bk-lend{flex:0 0 auto;background:#5b4bd6;color:#fff;font-size:.62rem;font-weight:800;
    padding:0 .3rem;border-radius:4px;line-height:1.5;white-space:nowrap;cursor:pointer;
    box-shadow:0 0 0 1px rgba(255,255,255,.5) inset;}
  .bk-lend:hover{background:#4838c2;}
  /* 回収したら消さずに「🧺✓」を残す（決済・領収証と同じ見せ方・店長要望 2026-08-23） */
  .bk-lend.is-returned{background:#d8f0e0;color:#1f6b41;box-shadow:none;}
  .bk-lend.is-returned:hover{background:#c6e8d4;}
  /* 左右の枠は決済ライン（決済前=橙 / 決済後=濃緑）用の受け皿。既定は透明なので、
     現金のバーは地のグラデーションがそのまま透けて見た目は変わらない。
     全バーに同じ幅を持たせることで、カードのバーだけ幅がズレるのを防いでいる（店長要望 2026-08-08） */
  .tl-booking{position:absolute;background:linear-gradient(135deg,#e0743c,#c9551f);color:#fff;border-radius:6px;padding:2px;border-left:7px solid transparent;border-right:3.5px solid transparent;font-size:.72rem;line-height:1.25;overflow:hidden;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.15);z-index:2;display:flex;flex-direction:column;gap:1px;}
  .tl-booking:hover{z-index:3;box-shadow:0 4px 10px rgba(0,0,0,.25);}
  .tl-booking.s-inquiry{background:linear-gradient(135deg,#8fb4d9,#5f8fc2);color:#fff;}
  .tl-booking.s-reserved{background:linear-gradient(135deg,#e0743c,#c9551f);}
  .tl-booking.s-pre_reserved{background:linear-gradient(135deg,#c799d0,#9b6db0);color:#fff;}
  .tl-booking.s-on_hold{background:linear-gradient(135deg,#ffcc66,#f4a833);color:#5a3500;}
  .tl-booking.s-pending{background:linear-gradient(135deg,#ffcc66,#f4a833);color:#5a3500;}
  .tl-booking.s-cancelled{background:#cdd2d6;color:#fff;text-decoration:line-through;}
  .tl-booking.s-completed{background:linear-gradient(135deg,#5cc28a,var(--green));}
  /* 接客中（始）= completed かつ未終了 → ティールで「進行中」を表現。終了（確）= 緑 */
  .tl-booking.s-completed:not(.svc-ended){background:linear-gradient(135deg,#36b3c7,#2487a0);}
  .tl-booking.svc-ended{background:linear-gradient(135deg,#5cc28a,var(--green));}  /* 終(終了)=グリーン */
  .tl-booking.s-no_show{background:linear-gradient(135deg,#e07474,#c44848);color:#fff;}
  /* 1段目: 時間（開始=左 / 〜=中央 / 終了=右、クリックでプルダウン微調整）。枠で操作可と示す */
  /* 白文字＋半透明チップ（背景色を濃くしてコントラスト確保） */
  /* 1段目（時間）: 反転帯（白地＋濃紺文字）。左右上はブロック端まで全幅 */
  .tl-booking .bk-top{display:flex;align-items:center;cursor:pointer;background:#fff;color:var(--deep);margin:-2px -2px 2px -2px;border-radius:5px 5px 0 0;padding:3px 6px;font-family:'Outfit';font-weight:800;font-size:.8rem;letter-spacing:.01em;}
  .tl-booking .bk-top:hover{background:#eef3f5;}
  .tl-booking .bk-st{flex-shrink:0;}
  .tl-booking .bk-dash{flex:1;text-align:center;}
  .tl-booking .bk-et{flex-shrink:0;}
  /* 2段目: お客様名（クリックで編集）＋ 始ボタン（右寄せ・経理連動） */
  .tl-booking .bk-mid{display:flex;align-items:center;justify-content:space-between;gap:3px;}
  .tl-booking .bk-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;flex:1;min-width:0;border:1px solid rgba(255,255,255,.6);border-radius:4px;padding:1px 5px;color:#fff;}
  .tl-booking .bk-name:hover{background:rgba(255,255,255,.2);}
  .tl-booking .bk-meet{flex-shrink:0;border:1px solid rgba(255,255,255,.85);border-radius:4px;background:transparent;color:#fff;font-size:.66rem;font-weight:700;line-height:1;padding:2px 7px;cursor:pointer;}
  .tl-booking .bk-meet.on{background:#fff;color:#1f7a45;border-color:#fff;}
  /* 中段: 接客ライフサイクル select（未/始/終）。状態で色分け、白ふち・角丸ピル */
  .tl-booking .bk-svc-sel{flex-shrink:0;border:1px solid rgba(255,255,255,.85);border-radius:5px;font-size:.66rem;font-weight:700;line-height:1;padding:2px 15px 2px 6px;cursor:pointer;color:#fff;-webkit-appearance:none;appearance:none;text-align:center;background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23fff' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .35rem center;}
  .tl-booking .bk-svc-sel.svc-started,.tl-booking .bk-svc-sel.svc-ended{background-color:#fff;color:#1f7a45;border-color:#fff;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%231f7a45' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
  .tl-booking .bk-svc-sel option{color:#173842;background:#fff;}
  /* 3段目: 地名（市区町村・接尾辞なし、中央揃え） */
  .tl-booking .bk-place{font-size:.66rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#fff;cursor:pointer;}
  /* 4段目: 場所（ご自宅 / ホテル名、中央揃え） */
  .tl-booking .bk-venue{font-size:.64rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#fff;opacity:.95;cursor:pointer;}
  /* ホテル: 名前は左詰めで省略、部屋番号は右端に固定 */
  .tl-booking .bk-venue.has-room{display:flex;align-items:center;justify-content:space-between;gap:.25rem;text-align:left;}
  .tl-booking .bk-venue.has-room .bk-venue-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  /* 部屋番号は名前が省略されても必ず読める大きさで目立たせる（店長要望 2026-08-16）。
     セルは専用で、クリックするとその場で登録・修正できる（ホテル名は従来どおり住所コピー） */
  .tl-booking .bk-venue.has-room .bk-venue-room{flex:none;font-weight:900;font-size:.86rem;font-family:'Outfit',sans-serif;
    letter-spacing:.02em;line-height:1;padding:.06rem .34rem;border-radius:6px;background:rgba(255,255,255,.92);color:#0a3d52;
    box-shadow:0 1px 3px rgba(0,0,0,.18);cursor:pointer;}
  .tl-booking .bk-venue.has-room .bk-venue-room:hover{background:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.85);}
  /* 未入力のときは「部屋番」を控えめに出す（押せることが分かる程度に） */
  .tl-booking .bk-venue.has-room .bk-venue-room.is-empty{font-weight:700;font-size:.62rem;letter-spacing:0;
    background:rgba(255,255,255,.28);color:inherit;opacity:.85;box-shadow:none;border:1px dashed rgba(255,255,255,.7);}
  .tl-booking .bk-venue.has-room .bk-venue-room.is-empty:hover{background:rgba(255,255,255,.5);opacity:1;box-shadow:none;}
  body[data-theme="soft"] .tl-booking .bk-venue.has-room .bk-venue-room{background:rgba(255,255,255,.96);color:#243d44;}
  body[data-theme="soft"] .tl-booking .bk-venue.has-room .bk-venue-room.is-empty{background:rgba(0,0,0,.05);color:inherit;border-color:rgba(0,0,0,.25);}
  /* 住所コピーできることが分かるよう、触れたら下線 */
  .tl-booking .bk-place:hover,.tl-booking .bk-venue:hover{text-decoration:underline dotted;text-underline-offset:2px;}
  /* 5段目: ドライバー名（左=行き / 右=帰り、クリックで送迎コピー） */
  .tl-booking .bk-bottom{display:flex;gap:2px;}
  .tl-booking .bk-go,.tl-booking .bk-back{flex:1;min-width:0;border:none;border-radius:4px;background:rgba(255,255,255,.25);color:#fff;font-size:.64rem;font-weight:700;line-height:1.15;padding:2px 3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
  .tl-booking .bk-go:hover,.tl-booking .bk-back:hover{background:rgba(255,255,255,.42);}
  /* 「キャスト」は地に対してハッキリ出す。薄くすると送迎ボタンの明るい地に沈む（店長指摘 2026-08-11）。
     既定テーマ＝濃い地なので白＋影／目に優しい配色＝明るい地なのでカードの濃い文字色を継ぐ。
     ※ 補色（緑地に赤紫など）も試したが読みづらいとの判断で取りやめ（2026-08-11） */
  .tl-booking .bk-self{opacity:1;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.55);}
  body[data-theme="soft"] .tl-booking .bk-self{color:inherit;text-shadow:none;}
  /* 送迎がまだ決まっていないぶん。「キャスト」と言い切らず「-」で置く。
     薄いと見落とすので、線を1本引いてハッキリ出す（店長要望 2026-08-10） */
  .tl-booking .bk-drv-undecided{opacity:1;font-weight:700;font-size:0;line-height:1;}
  .tl-booking .bk-drv-undecided::before{content:'';display:inline-block;width:14px;height:2.5px;
    border-radius:2px;background:currentColor;vertical-align:middle;}
  /* 送迎メール送信済み: 金色で明示（ドライバー変更でリセット） */
  .tl-booking .bk-go.mailed,.tl-booking .bk-back.mailed{background:#ffd76a;color:#5a4200;}
  .tl-booking .bk-go.mailed:hover,.tl-booking .bk-back.mailed:hover{background:#ffcf4d;}
  /* 時間微調整プルダウン */
  .tl-time-pop{position:absolute;z-index:1200;background:#fff;border:1.5px solid var(--gray);border-radius:10px;box-shadow:0 8px 24px rgba(10,61,82,.18);padding:.6rem;}
  .tl-time-pop .ttp-head{display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-bottom:.4rem;}
  .tl-time-pop .ttp-label{font-size:.72rem;color:var(--ink-soft);}
  .tl-time-pop .ttp-close{background:transparent;border:none;font-size:1.2rem;line-height:1;color:var(--ink-soft);cursor:pointer;padding:0 .25rem;border-radius:6px;}
  .tl-time-pop .ttp-close:hover{background:var(--foam);color:var(--ink);}
  .tl-time-pop .ttp-sel{border:1.5px solid var(--gray);background:var(--white);border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:1rem;color:var(--deep);cursor:pointer;font-family:'Zen Maru Gothic';min-width:160px;display:block;}
  /* 開始時刻: 時と分を別に選ぶ（分は1分刻み） */
  .tl-time-pop .ttp-time{display:flex;align-items:center;gap:.35rem;}
  .tl-time-pop .ttp-time .ttp-sel{min-width:0;flex:1;text-align:center;padding:.45rem .35rem;}
  .tl-time-pop .ttp-c{font-weight:800;color:var(--ink-soft);}
  .tl-time-pop .ttp-apply{margin-top:.5rem;width:100%;border:1.5px solid var(--sea);background:var(--sea);color:#fff;border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.85rem;cursor:pointer;}
  .tl-time-pop .ttp-apply:hover{filter:brightness(1.08);}
  .tl-time-pop .ttp-apply:disabled{opacity:.6;cursor:default;}
  /* 💳未 から開く「決済を確認した」 */
  .tl-time-pop .ttp-card-chk{display:flex;align-items:center;gap:.5rem;margin-top:.5rem;padding:.5rem .6rem;
        border:1.5px solid var(--gray);border-radius:8px;font-weight:700;font-size:.9rem;cursor:pointer;white-space:nowrap;}
  .tl-time-pop .ttp-card-chk input{width:18px;height:18px;}
  /* いま選ばれているフラグ（押しても何も起きない印） */
  .tl-time-pop .ttp-apply.is-cur{background:#fff;color:var(--deep);border-color:var(--gray);}
  /* 「この時刻で始」＝接客開始まで一気に。開始は経理に計上されるので緑で区別する */
  .tl-time-pop .ttp-start{margin-top:.4rem;border-color:#1f7a45;background:#1f7a45;}
  /* 即姫（最速で遊べる時間）まで更新するボタン。媒体に出る操作なので枠線つきで区別（店長要望 2026-08-18） */
  .tl-time-pop .ttp-sep{margin:.55rem 0 .1rem;border-top:1px dashed var(--gray);}
  .tl-time-pop .ttp-play{box-shadow:inset 0 0 0 2px #fff, 0 0 0 2px var(--coral,#e8896b);}
  .tl-time-pop .ttp-playhint{margin-top:.45rem;text-align:center;font-size:.9rem;font-weight:800;
    color:var(--coral-deep,#c2410c);background:#fff3ec;border:1.5px solid #f3c4ae;border-radius:8px;padding:.3rem .5rem;line-height:1.4;}
  .tl-time-pop .ttp-playhint b{font-family:'Outfit',sans-serif;font-size:1.25rem;margin-left:.2rem;vertical-align:-1px;}
  .tl-time-pop .ttp-mail{margin-top:.5rem;width:100%;border:1.5px solid var(--coral,#e8896b);background:var(--coral,#e8896b);color:#fff;border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.85rem;cursor:pointer;}
  .tl-time-pop .ttp-mail:hover{filter:brightness(1.08);}
  .tl-time-pop .ttp-copy{margin-top:.4rem;width:100%;border:1.5px solid var(--sea);background:var(--sea);color:#fff;border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.85rem;cursor:pointer;}
  .tl-time-pop .ttp-copy:hover{filter:brightness(1.08);}
  /* 部屋番号ポップ: 入力欄を広く、保存ボタンは小さく（店長指摘 2026-08-16） */
  .tl-time-pop .ttp-room-row{display:flex;gap:.4rem;align-items:center;}
  .tl-time-pop .ttp-room-inp{width:120px;flex:0 0 120px;padding:.45rem .55rem;border:1.5px solid var(--gray);
    border-radius:8px;font-size:16px;font-family:'Outfit',sans-serif;font-weight:700;text-align:center;letter-spacing:.04em;}
  .tl-time-pop .ttp-room-inp:focus{outline:none;border-color:var(--sea);}
  .tl-time-pop .ttp-room-save{flex:0 0 auto;border:1.5px solid var(--sea);background:var(--sea);color:#fff;border-radius:8px;
    padding:.45rem .8rem;font-weight:700;font-size:.85rem;cursor:pointer;white-space:nowrap;}
  .tl-time-pop .ttp-room-save:hover{filter:brightness(1.08);}
  .tl-time-pop .ttp-room-save:disabled{opacity:.5;cursor:default;}
  /* 貴重品・釣銭ポップ: 「誰が」を2つ選んで保存（店長要望 2026-08-16） */
  .tl-time-pop .ttp-hk-info{font-size:.82rem;font-weight:700;color:var(--deep);margin-bottom:.2rem;max-width:20em;}
  .tl-time-pop .ttp-hk-place{font-size:.78rem;color:var(--ink-soft);margin-bottom:.5rem;max-width:20em;line-height:1.4;}
  .tl-time-pop .ttp-mail{margin-top:.45rem;width:100%;border:1.5px solid var(--sea);background:#fff;color:var(--sea);border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Zen Maru Gothic';}
  .tl-time-pop .ttp-mail:hover{background:var(--sea);color:#fff;}
  /* 秘密基地のバー: 詳細な場所と送迎の割り当て */
  /* 秘密基地のお仕事は、アドミの予約カードと同じ見た目にする（店長要望 2026-08-29）。
     自店の予約と取り違えないよう、左に🏠の色の帯だけ足す */
  /* 市区町村を打って探す入力欄（店長要望 2026-08-30） */
  .city-search{position:relative;flex:1;min-width:0;}
  .city-search-inp{width:100%;box-sizing:border-box;padding:.55rem .6rem;border:1.5px solid var(--gray);
    border-radius:8px;font-size:16px;font-family:'Zen Maru Gothic';background:var(--white);color:var(--deep);
    text-overflow:ellipsis;}
  /* 入力例が欄からはみ出さないように少しだけ小さく（店長指摘 2026-08-30） */
  .city-search-inp::placeholder{font-size:.86rem;}
  .city-search-inp:focus{outline:none;border-color:var(--sea);}
  .city-search-list{display:none;position:absolute;z-index:1300;left:0;right:0;top:calc(100% + 2px);
    max-height:16rem;overflow:auto;background:#fff;border:1.5px solid var(--gray);border-radius:10px;
    box-shadow:0 8px 24px rgba(10,61,82,.18);padding:.2rem;}
  .city-search-list.is-open{display:block;}
  .city-search-item{display:block;width:100%;text-align:left;border:none;background:transparent;
    padding:.5rem .6rem;border-radius:7px;font-size:.95rem;cursor:pointer;font-family:'Zen Maru Gothic';color:var(--ink);}
  .city-search-item:hover,.city-search-item.is-on{background:var(--foam);color:var(--deep);font-weight:700;}
  .tl-booking.hk-bk{border-left:5px solid #f0761a;}
  /* 利用エリアと詳細な場所は1行に。エリアは丸囲み（店長要望 2026-08-29） */
  .tl-booking.hk-bk .hk-venue{display:flex;align-items:center;justify-content:center;gap:.3rem;
    color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .tl-booking.hk-bk .hk-area{flex:0 0 auto;background:#f0761a;color:#fff;font-weight:700;
    border-radius:999px;padding:0 .5rem;line-height:1.5;font-size:.9em;}
  .tl-time-pop .ttp-lend-items{font-size:.82rem;font-weight:700;color:var(--deep);margin:0 0 .5rem;max-width:16em;line-height:1.4;}
  .tl-time-pop .ttp-undo{margin-top:.35rem;width:100%;border:1.5px solid var(--gray);background:var(--white);color:var(--ink-soft);border-radius:8px;padding:.4rem .6rem;font-weight:700;font-size:.8rem;cursor:pointer;font-family:'Zen Maru Gothic';}
  .tl-time-pop .ttp-undo:hover{background:var(--foam);color:var(--ink);}
  .tl-time-pop .ttp-flag-row{display:flex;align-items:center;gap:.45rem;margin-bottom:.4rem;}
  .tl-time-pop .ttp-flag-l{flex:0 0 5.5em;font-size:.78rem;font-weight:700;color:var(--ink-soft);}
  .tl-time-pop .ttp-flag-row .ttp-sel{flex:1;min-width:150px;margin:0;}

  /* ============================================================
     目に優しい配色（body[data-theme="soft"]）
     一日中見るタイムライン向け。予約ブロックを「濃い塗り＋白文字」から
     「淡い地＋濃い同系色の文字＋左4pxの色帯」へ反転する。
     ・純白の地と純黒の文字を避ける（眩しさ・にじみを減らす）
     ・罫線を弱め、升目のうるささを落とす
     ・高彩度は「今の時間」の1か所だけに絞る
     ヘッダーの 🌿 ボタンで従来配色に戻せる（localStorage に保存）
     ============================================================ */
  body[data-theme="soft"]{background:#f6f7f5;color:#23292b;}
  body[data-theme="soft"] .tl-grid{background:#e4e7e4;}
  body[data-theme="soft"] .tl-cell{background:#fdfdfc;}
  body[data-theme="soft"] .tl-cell:hover{background:#eef1ed;}
  body[data-theme="soft"] .tl-cell.shift-bg{background:linear-gradient(180deg,#edf3ef,#f8faf8);}
  body[data-theme="soft"] .tl-head{background:#2d4a52;}
  body[data-theme="soft"] .tl-head.staff-col{background:#243d44;}
  body[data-theme="soft"] .tl-head .tl-hour.next-day{color:#a9ccd1;}
  body[data-theme="soft"] .tl-staff:not(.tl-staff-unassigned){background:#fdfdfc;color:#23292b;}
  /* 未割当行は目印なので色は残す（彩度だけ落とす） */
  body[data-theme="soft"] .tl-staff-unassigned{background:linear-gradient(135deg,#f7f3ec,#fdf1e8);color:#c06a44;}
  body[data-theme="soft"] .tl-toolbar{background:#fbfbfa;}
  /* 今この時間の列（本日を見ているときだけ付く）。画面で唯一の高彩度 */
  .tl-head.is-now{background:#c4503f;position:relative;}
  .tl-head.is-now::after{content:'';position:absolute;left:0;right:0;bottom:-2px;height:2px;background:#c4503f;}
  body[data-theme="soft"] .tl-head.is-now{background:#c4503f;}

  /* 予約ブロック本体 */
  /* 状態ごとに色相をはっきり分ける（店長指定 2026-08-06「各フラグがはっきりわかるように」）。
     地は薄く・文字は同系の濃色にして読みやすさを保ちつつ、左帯を太く濃くして遠目でも状態が分かるようにする。
     色相の割り当て: 問合せ=灰 / 予約=金 / 事前予約=紫 / 保留=橙 / 接客中=ローズ / 終了=緑 /
                     キャンセル=薄灰＋取り消し線 / 無連絡=赤
     ※ 接客中と終了はいちばん取り違えたくないので、暖色（進行中）と緑（終わり）で分ける */
  /* 開始＝太いライン、終了＝その半分の太さ。どちらも同じ濃さで、始まりと終わりの時刻を目で追えるように
     （店長要望 2026-08-08）。色は各ステータスの border-color が左右まとめて上書きする */
  body[data-theme="soft"] .tl-booking{background:#f1f2f0;color:#3a4247;
    border-left:7px solid #9aa3a0;border-right:3.5px solid #9aa3a0;
    box-shadow:0 1px 3px rgba(20,30,25,.10);
    /* こちらのテーマは地が明るく文字が濃いので、影は要らない（店長指摘 2026-08-11）。
       既定テーマの白文字用に敷いた text-shadow がそのまま効いてボヤけていた */
    text-shadow:none;}
  body[data-theme="soft"] .tl-booking *{text-shadow:none;}
  body[data-theme="soft"] .tl-booking:hover{box-shadow:0 3px 10px rgba(20,30,25,.22);}
  body[data-theme="soft"] .tl-booking.s-inquiry{background:#eef1f2;color:#4e5a61;border-color:#7b8b93;}
  body[data-theme="soft"] .tl-booking.s-reserved{background:#fbf1d6;color:#75540c;border-color:#d3a021;}
  body[data-theme="soft"] .tl-booking.s-pre_reserved{background:#f2ecf9;color:#56386f;border-color:#8f5fb0;}
  body[data-theme="soft"] .tl-booking.s-on_hold,
  body[data-theme="soft"] .tl-booking.s-pending{background:#fde9d9;color:#8a4a12;border-color:#e08636;}
  body[data-theme="soft"] .tl-booking.s-completed{background:#fde6ec;color:#97244b;border-color:#d84470;}
  body[data-theme="soft"] .tl-booking.svc-ended{background:#e4f1e2;color:#2f6b34;border-color:#4f9c52;}
  body[data-theme="soft"] .tl-booking.s-cancelled{background:#f2f2f0;color:#8b918d;border-color:#c3c8c4;}
  body[data-theme="soft"] .tl-booking.s-no_show{background:#fae4e1;color:#93342a;border-color:#c8503f;}
  /* 休憩・私用は status='confirmed' で保存される。予約と混ざらないよう地の色を土色系にする */
  body[data-theme="soft"] .tl-booking.s-confirmed{background:#efece4;color:#6f665a;border-color:#a99f8c;}
  /* カード決済の予約は、両サイドのラインで決済前／決済後を示す（店長要望 2026-08-08）。
     地の色は従来どおりステータス（接客中/終了など）を表すので、両方が同時に見える。
     現金・振込の予約はラインもステータス色のままなので、色が混ざることはない。
     ※ 上のステータス指定と同じ強さなので、必ずこの順（あと）に置くこと */
  body[data-theme="soft"] .tl-booking.pay-unconfirmed{border-color:#eda72c;}   /* 決済前＝橙 */
  /* 決済後はあえて「とても濃い緑」。地の色と最も差が付くので、
     どれがクレカのお客様かが一目で分かる（店長要望 2026-08-08） */
  body[data-theme="soft"] .tl-booking.pay-confirmed{border-color:#0e4429;}     /* 決済後＝濃緑 */
  /* 既定テーマ（濃い地色）にも同じ決済ラインを入れる。地が濃いぶん、より濃い色を使う。
     ステータス指定は border-color を触らないので、この位置で効く */
  .tl-booking.pay-unconfirmed{border-color:#e08c00;}
  .tl-booking.pay-confirmed{border-color:#08301b;}
  /* カード決済（併用ふくむ）の予約は「帰り＝お迎え担当」のボタンだけ黒縁で囲む。
     お預かりが現金でない（＝現金を受け取らない）ことが、受け渡しの相手のところで分かる（店長要望 2026-08-14）。
     outline なのでボタンの大きさは変わらない */
  .tl-booking.pay-card .bk-back{outline:2px solid #111;outline-offset:-1px;}

  /* ── 既定テーマの文字色（店長要望 2026-08-10）──
     2026-08-08 に全ステータスを黒文字にしたが、地色が濃いカード（予約・終了など）では
     黒が地に沈んで読みにくかった。「黒の反対は白」との指摘どおり、濃い地は白文字に戻す。
     地が明るいもの（保留・キャンセル）は黒系のまま。
     白文字のコントラストを補うため、文字に薄い影を敷いて地から浮かせる。 */
  .tl-booking{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45);}
  .tl-booking .bk-top{text-shadow:none;}                       /* 時間帯は白地なので影は不要 */
  .tl-booking.s-on_hold,
  .tl-booking.s-pending{color:#5a3500;text-shadow:none;}       /* 黄色＝明るい地なので濃い文字 */
  .tl-booking.s-cancelled{color:#5a6066;text-shadow:none;}     /* 薄いグレー地 */
  .tl-booking.s-cancelled .bk-name{border-color:rgba(0,0,0,.28);}
  .tl-booking.s-on_hold .bk-go,.tl-booking.s-on_hold .bk-back,
  .tl-booking.s-pending .bk-go,.tl-booking.s-pending .bk-back,
  .tl-booking.s-cancelled .bk-go,.tl-booking.s-cancelled .bk-back{background:rgba(255,255,255,.6);}
  /* 中の部品は白文字が直接指定されているので、明るい地のときだけ親の濃い色を継がせる */
  .tl-booking.s-on_hold .bk-name,.tl-booking.s-on_hold .bk-place,.tl-booking.s-on_hold .bk-venue,
  .tl-booking.s-on_hold .bk-go,.tl-booking.s-on_hold .bk-back,.tl-booking.s-on_hold .bk-svc-sel,
  .tl-booking.s-pending .bk-name,.tl-booking.s-pending .bk-place,.tl-booking.s-pending .bk-venue,
  .tl-booking.s-pending .bk-go,.tl-booking.s-pending .bk-back,.tl-booking.s-pending .bk-svc-sel,
  .tl-booking.s-cancelled .bk-name,.tl-booking.s-cancelled .bk-place,.tl-booking.s-cancelled .bk-venue,
  .tl-booking.s-cancelled .bk-go,.tl-booking.s-cancelled .bk-back,.tl-booking.s-cancelled .bk-svc-sel{color:inherit;}
  .tl-booking.s-on_hold .bk-name,.tl-booking.s-pending .bk-name{border-color:rgba(0,0,0,.28);}
  .tl-booking.s-on_hold .bk-svc-sel,.tl-booking.s-pending .bk-svc-sel,.tl-booking.s-cancelled .bk-svc-sel{border-color:rgba(0,0,0,.4);
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23000' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}

  /* 中の部品は白文字前提だったので、地の色を継ぐように置き換える */
  body[data-theme="soft"] .tl-booking .bk-top{background:rgba(255,255,255,.66);color:inherit;}
  body[data-theme="soft"] .tl-booking .bk-top:hover{background:rgba(255,255,255,.95);}
  body[data-theme="soft"] .tl-booking .bk-name{color:inherit;border-color:rgba(0,0,0,.16);}
  body[data-theme="soft"] .tl-booking .bk-name:hover{background:rgba(255,255,255,.65);}
  body[data-theme="soft"] .tl-booking .bk-place,
  body[data-theme="soft"] .tl-booking .bk-venue{color:inherit;}
  body[data-theme="soft"] .tl-booking .bk-meet{color:inherit;border-color:currentColor;}
  body[data-theme="soft"] .tl-booking .bk-meet.on{background:#1f7a45;color:#fff;border-color:#1f7a45;}
  body[data-theme="soft"] .tl-booking .bk-svc-sel{color:inherit;border-color:currentColor;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555c60' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
  /* 始（接客中）と終（終了）は同じ緑だと見分けが付かないので、始=ローズ・終=緑で分ける */
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-started,
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-ended{color:#fff;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23fff' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-started{background-color:#c33a63;border-color:#c33a63;}
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-ended{background-color:#3f8a4a;border-color:#3f8a4a;}
  body[data-theme="soft"] .tl-booking .bk-go,
  body[data-theme="soft"] .tl-booking .bk-back{background:rgba(255,255,255,.62);color:inherit;}
  body[data-theme="soft"] .tl-booking .bk-go:hover,
  body[data-theme="soft"] .tl-booking .bk-back:hover{background:rgba(255,255,255,.95);}
  body[data-theme="soft"] .tl-booking .bk-go.mailed,
  body[data-theme="soft"] .tl-booking .bk-back.mailed{background:#f0c23f;color:#4a3600;}
  body[data-theme="soft"] .tl-booking .bk-go.mailed:hover,
  body[data-theme="soft"] .tl-booking .bk-back.mailed:hover{background:#e8b526;}
  /* 一覧・カード類も地と罫線だけ合わせる（文字色は元のまま＝読みやすさは変えない） */
  body[data-theme="soft"] .bk-list,
  body[data-theme="soft"] .cu-table,
  body[data-theme="soft"] .staff-card,
  body[data-theme="soft"] .card{background:#fdfdfc;}
  body[data-theme="soft"] .bkt-row,
  body[data-theme="soft"] .cu-row{border-bottom-color:#e7eae7;}
  /* 配色切り替えボタン */
  .btn-theme{background:transparent;border:1.5px solid var(--gray);border-radius:8px;padding:.3rem .5rem;
    font-size:.95rem;line-height:1;cursor:pointer;}
  .btn-theme:hover{background:var(--foam);}
  @media(max-width:600px){.btn-theme{display:none;}}

  /* ============== Booking View ============== */
  /* ===== 🔒 端末とログイン（スタッフ管理タブの中） ===== */
  .dev-lead{font-size:.82rem;color:var(--ink-soft);line-height:1.8;margin:.2rem 0 .8rem;}
  .dev-row{display:grid;grid-template-columns:1fr auto;gap:.8rem;align-items:center;
    padding:.7rem .9rem;border-bottom:1px solid var(--gray);}
  .dev-row:last-child{border-bottom:none;}
  .dev-card{background:var(--white);border-radius:14px;box-shadow:0 3px 12px rgba(10,61,82,.05);padding:.3rem .2rem;}
  .dev-name{font-weight:800;color:var(--deep);display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;}
  .dev-tag{font-size:.66rem;font-weight:800;padding:.06rem .4rem;border-radius:50px;}
  .dev-tag.is-owner{background:#fef3c7;color:#92400e;}
  .dev-tag.is-grant{background:#dcfce7;color:#166534;}
  .dev-tag.is-none{background:#fee2e2;color:#991b1b;}
  .dev-meta{font-size:.74rem;color:var(--ink-soft);margin-top:.2rem;line-height:1.7;}
  .dev-acts{display:flex;gap:.4rem;flex-wrap:wrap;justify-content:flex-end;}
  .dev-btn{padding:.35rem .75rem;border:1.5px solid var(--gray);border-radius:8px;background:#fff;color:var(--ink-soft);
    font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;}
  .dev-btn.is-go{border-color:var(--sea);color:var(--sea);}
  .dev-btn.is-danger{border-color:var(--coral);color:var(--coral);}
  @media(max-width:640px){
    .dev-row{grid-template-columns:1fr;}
    .dev-acts{justify-content:flex-start;}
  }
  /* ===== 📦 備品 ===== */
  .sup-lend{background:var(--white);border-radius:14px;padding:.8rem 1rem;margin-bottom:1rem;box-shadow:0 3px 12px rgba(10,61,82,.05);}
  .sup-lend-head{font-weight:800;color:var(--deep);margin-bottom:.55rem;}
  .sup-lend-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem;}
  .sup-lend-row select{padding:.45rem .55rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;
    font-weight:700;color:var(--ink);background:var(--white);}
  #supUserCast,#supUserStaff,#supItem{min-width:11rem;}
  #supQty{width:5rem;}
  .sup-lend-msg{min-height:1.2rem;font-size:.85rem;font-weight:700;color:var(--green);}
  .sup-lend-msg.is-err{color:var(--coral);}
  .sup-card{background:var(--white);border-radius:14px;padding:.5rem;box-shadow:0 3px 12px rgba(10,61,82,.05);margin-bottom:1rem;}
  .sup-card-head{display:flex;align-items:baseline;gap:.5rem;padding:.6rem .8rem .4rem;font-weight:800;color:var(--deep);}
  .sup-card-head small{font-weight:700;font-size:.76rem;color:var(--ink-soft);}
  .sup-row{display:grid;grid-template-columns:1fr 5.5rem 5.5rem 6.5rem;gap:.5rem;align-items:center;
    padding:.55rem .8rem;border-bottom:1px solid var(--gray);}
  .sup-row:last-child{border-bottom:none;}
  .sup-row.head{font-size:.76rem;font-weight:800;color:var(--ink-soft);padding-top:.3rem;padding-bottom:.3rem;}
  .sup-name{font-weight:700;color:var(--deep);display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;}
  .sup-kind{font-size:.66rem;font-weight:800;padding:.06rem .38rem;border-radius:50px;}
  .sup-kind.is-set{background:#efe9f8;color:#573c78;}
  .sup-kind.is-each{background:var(--foam);color:var(--sea);}
  .sup-num{text-align:right;font-family:'Outfit',sans-serif;font-weight:800;font-size:1rem;color:var(--deep);}
  .sup-num.is-lent{color:var(--coral);}
  .sup-num.is-zero{color:var(--ink-soft);}
  .sup-stock-in{width:4.5rem;padding:.3rem .4rem;border:1.5px solid var(--gray);border-radius:8px;
    font-size:16px;font-weight:700;text-align:right;background:var(--white);color:var(--ink);}
  .sup-person{padding:.55rem .8rem;border-bottom:1px solid var(--gray);}
  .sup-person:last-child{border-bottom:none;}
  .sup-person-name{font-weight:800;color:var(--deep);display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem;}
  .sup-person-name .role-mini{font-size:.7rem;color:var(--ink-soft);font-weight:700;}
  .sup-loan{display:flex;align-items:center;gap:.5rem;padding:.28rem 0;flex-wrap:wrap;}
  .sup-loan-name{flex:1;min-width:8rem;font-weight:700;color:var(--ink);}
  .sup-loan-days{font-size:.74rem;font-weight:700;color:var(--ink-soft);}
  .sup-loan-days.is-long{color:var(--coral);}
  .sup-ret{padding:.28rem .7rem;border:1.5px solid var(--sea);border-radius:8px;background:#fff;color:var(--sea);
    font-size:.82rem;font-weight:800;cursor:pointer;touch-action:manipulation;}
  .sup-empty{padding:1.2rem .8rem;text-align:center;color:var(--ink-soft);font-weight:700;}
  @media(max-width:640px){
    .sup-row{grid-template-columns:1fr 3.8rem 3.8rem 5.4rem;gap:.35rem;padding:.5rem .55rem;}
    .sup-stock-in{width:3.6rem;}
  }
  .bk-list{background:var(--white);border-radius:14px;padding:.5rem;box-shadow:0 3px 12px rgba(10,61,82,.05);}
  .bk-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:.9rem;padding:.9rem 1.1rem;border-bottom:1px solid var(--gray);align-items:center;}
  @media(max-width:780px){.bk-row{grid-template-columns:1fr;}}
  .bk-row:last-child{border-bottom:none;}
  .bk-date-col{text-align:center;background:var(--foam);border-radius:10px;padding:.5rem .7rem;min-width:75px;}
  .bk-date-col .bd-date{font-family:'Outfit';font-size:1.3rem;font-weight:700;color:var(--deep);line-height:1;}
  .bk-date-col .bd-time{font-family:'Outfit';font-size:.85rem;color:var(--sea);margin-top:.3rem;}
  .bk-info .bi-name{font-size:1rem;font-weight:700;color:var(--ink);}
  .bk-info .bi-meta{font-size:.84rem;color:var(--ink-soft);margin-top:.2rem;display:flex;flex-wrap:wrap;gap:.5rem 1rem;}
  .bk-status{padding:.3rem .7rem;border-radius:50px;font-size:.75rem;font-weight:700;}
  .bk-status.s-inquiry{background:#e0ecf7;color:#3d6693;}
  .bk-status.s-reserved{background:#fde2d6;color:#a04830;}
  .bk-status.s-pre_reserved{background:#ede0f4;color:#6d4a85;}
  .bk-status.s-on_hold{background:#fff0c8;color:#a06f1d;}
  .bk-status.s-pending{background:#fff0c8;color:#a06f1d;}
  .bk-status.s-confirmed{background:#fde2d6;color:#a04830;}
  .bk-status.s-completed{background:#d9efd5;color:#3a7547;}  /* 終(終了)=グリーン。始(接客中)は下行でティール上書き */
  .bk-status.s-completed:not(.svc-ended){background:#d6f1f6;color:#1d7a8c;}  /* 接客中(始)=ティール、接客完了(確)は緑のまま */
  .bk-status.s-cancelled{background:#f1f1f1;color:#888;}
  .bk-status.s-no_show{background:#fde5e1;color:#a04030;}
  .bk-status.s-other{background:#f1f1f1;color:#888;}
  /* 旧履歴の「完了」は接客ライフサイクル(始/確)を持たないので、常に完了色(緑) */
  .bkt-row.is-legacy .bk-status.s-completed{background:#d9efd5;color:#3a7547;}

  /* 予約一覧の表組み（日付/時間/お客様/キャスト/分/場所/金額/状態）。
     .bk-row はマスタ一覧でも使い回しているので、予約一覧だけ .bkt-* で独立させる */
  .bkt-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .bkt{min-width:1020px;}
  .bkt-head,.bkt-row{display:grid;
    grid-template-columns:4.6rem 5.6rem minmax(6rem,1.1fr) 7.4rem minmax(4.5rem,.75fr) 4.6rem minmax(9rem,1.6fr) 6rem 5.6rem 3.6rem;
    gap:.75rem;align-items:center;padding:.6rem .9rem;}
  .bkt-head{background:var(--foam);border-radius:8px;
    font-size:.72rem;font-weight:700;color:var(--ink-soft);letter-spacing:.04em;padding-top:.45rem;padding-bottom:.45rem;}
  .bkt-head .c{text-align:center;} .bkt-head .r{text-align:right;}
  .bkt-row{border-bottom:1px solid var(--gray);cursor:pointer;transition:background .15s;}
  .bkt-row:last-child{border-bottom:none;}
  .bkt-row:hover{background:var(--foam);}
  .bkt-row.is-legacy{background:#fbfbfa;}
  .bkt-row.is-legacy:hover{background:#f4f6f5;}
  .bkt-row>div{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bkt-date{font-family:'Outfit';font-size:.98rem;font-weight:700;color:var(--deep);font-variant-numeric:tabular-nums;}
  .bkt-date small{font-family:'Zen Maru Gothic';font-size:.72rem;font-weight:600;color:var(--ink-soft);margin-left:.1em;}
  .bkt-time{font-family:'Outfit';font-size:.92rem;font-weight:600;color:var(--sea);font-variant-numeric:tabular-nums;}
  .bkt-time small{font-size:.8rem;color:var(--ink-soft);font-weight:500;}
  .bkt-cust{font-size:.95rem;font-weight:700;color:var(--ink);}
  .bkt-tel{font-family:'Outfit';font-size:.85rem;color:var(--ink-soft);font-variant-numeric:tabular-nums;letter-spacing:.01em;}
  /* 旧履歴の詳細モーダル（読み取り専用） */
  #legacyDetailModal .modal-footer{justify-content:space-between;align-items:center;}
  #legacyDetailModal .lg-note{font-size:.78rem;color:var(--ink-soft);}
  #legacyDetailModal .mh-title .ht-old{margin-left:.35rem;}
  .lg-memo{white-space:pre-wrap;color:#7a5a2a;}
  .bkt-cast{font-size:.88rem;font-weight:600;color:var(--deep);}
  .bkt-min{text-align:center;color:var(--ink-soft);}
  .bkt-min b{font-family:'Outfit';font-size:.98rem;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
  .bkt-min small{font-size:.72rem;margin-left:.05em;}
  .bkt-min .bkt-tag{display:block;font-size:.66rem;color:var(--sea);line-height:1.2;}
  .bkt-place{font-size:.85rem;color:var(--ink-soft);}
  .bkt-price{text-align:right;font-family:'Outfit';font-size:.95rem;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
  .bkt-st{overflow:visible!important;}
  .bkt-st .bk-status{display:inline-block;padding:.22rem .5rem;font-size:.68rem;white-space:nowrap;}
  .bkt-act{text-align:right;overflow:visible!important;}
  .bkt-row.is-legacy .bkt-date,.bkt-row.is-legacy .bkt-cust,.bkt-row.is-legacy .bkt-price{color:var(--ink-soft);}
  @media(max-width:780px){
    .bkt{min-width:820px;}
    .bkt-head,.bkt-row{gap:.55rem;padding:.55rem .6rem;}
    .bkt-cust{font-size:.9rem;} .bkt-place{font-size:.8rem;}
  }

  /* ============== Customer View ============== */
  .cu-table{background:var(--white);border-radius:14px;padding:.5rem;box-shadow:0 3px 12px rgba(10,61,82,.05);}
  .cu-row{display:grid;grid-template-columns:1fr 1fr auto auto;gap:.9rem;padding:.85rem 1.1rem;border-bottom:1px solid var(--gray);align-items:center;cursor:pointer;transition:background .15s;}
  .cu-row:hover{background:var(--foam);}
  .cu-row:last-child{border-bottom:none;}
  @media(max-width:780px){.cu-row{grid-template-columns:1fr;}}
  .cu-name{font-weight:700;font-size:1rem;color:var(--ink);}
  .cu-name .kana{font-size:.78rem;color:var(--ink-soft);font-weight:400;margin-left:.4rem;}
  .cu-contact{font-size:.85rem;color:var(--ink-soft);}
  /* NG登録（出禁・要注意・キャスト別NG） */
  .ng-badge{display:inline-block;font-size:.68rem;font-weight:700;padding:.1rem .5rem;border-radius:50px;margin-left:.4rem;vertical-align:middle;white-space:nowrap;}
  .ng-badge.lv2{background:#fdecee;color:var(--red);border:1px solid #f5c2c7;}
  .ng-badge.lv1{background:#fff4e6;color:#b1601f;border:1px solid #f5d5b0;}
  .ng-badge.cast{background:#f2f1fb;color:#5a4bad;border:1px solid #d6d2f0;}
  .ng-box{margin-top:.9rem;padding:.85rem .9rem;border:1.5px solid #f5d5b0;border-radius:12px;background:#fffaf3;}
  .ng-box.is-ng{border-color:#f5c2c7;background:#fef7f8;}
  .ng-cast-list{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.45rem;}
  .ng-cast-list:empty{display:none;}
  .ng-chip{display:inline-flex;align-items:center;gap:.35rem;background:#fff;border:1.5px solid #d6d2f0;color:#5a4bad;font-size:.82rem;font-weight:600;padding:.3rem .5rem .3rem .7rem;border-radius:50px;}
  .ng-chip button{border:none;background:none;color:#8d86bd;font-size:1rem;line-height:1;cursor:pointer;padding:0 .1rem;}
  .ng-chip button:hover{color:var(--red);}
  /* 予約モーダルの警告帯（キャスト注意事項と同じ場所に積む） */
  .bm-ng-alert{display:none;margin-bottom:.6rem;padding:.6rem .8rem;border-radius:10px;font-size:.85rem;font-weight:600;line-height:1.5;}
  .bm-ng-alert.lv2{background:#fdecee;border:1.5px solid #f5c2c7;color:#a12530;}
  .bm-ng-alert.lv1{background:#fff4e6;border:1.5px solid #f5d5b0;color:#8a4a12;}
  .cu-visits{text-align:center;font-family:'Outfit';font-size:.92rem;color:var(--sea);font-weight:600;}
  .cu-visits b{font-size:1.3rem;color:var(--deep);}
  .cu-actions{display:flex;gap:.4rem;}
  .cu-actions button{padding:.4rem .8rem;border-radius:7px;font-size:.78rem;border:1.5px solid var(--gray);background:#fff;color:var(--ink-soft);cursor:pointer;}
  .cu-actions button:hover{background:var(--sea);color:#fff;border-color:var(--sea);}

  /* ============== Shift View (10日タイムテーブル + チェック式入力) ============== */
  /* ステータスチップ群 (出勤/仮/休み/未登録 4択) */
  .sh-tt-row .sh-tt-stchips{display:inline-flex;gap:.3rem;flex-wrap:wrap;}
  .sh-tt-row .sh-tt-stchip{display:inline-flex;align-items:center;gap:.25rem;padding:.4rem .75rem;border:1.5px solid var(--gray);border-radius:50px;font-size:.85rem;font-weight:600;color:var(--ink-soft);background:#fff;cursor:pointer;user-select:none;transition:all .15s;}
  /* PC=フルラベル表示、モバイル=省略ラベル表示 (デフォルト PC) */
  .sh-tt-row .sh-tt-stchip .lbl-short{display:none;}
  .sh-tt-row .sh-tt-stchip:hover{border-color:var(--coral);}
  /* 選択中は淡いグラデ+白抜きだと読みにくいので、濃い単色で塗る（OPSは各所読みやすさ優先） */
  .sh-tt-row .sh-tt-stchip.is-on{color:#fff;border-color:transparent;box-shadow:0 2px 7px rgba(0,0,0,.22);}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="available"]{background:#2d7a4a;}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="tentative"]{background:#c07a12;}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="off"]{background:#4a4e53;}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="unreg"]{background:#8b969d;font-style:italic;}
  /* 未登録は背景を薄く + 時刻入力をプレースホルダー扱い (時刻は事前入力可能) */
  .sh-tt-row.is-unreg{background:linear-gradient(90deg,#fafafa,#fff);}
  .sh-tt-row.is-unreg .sh-tt-24h,.sh-tt-row.is-unreg .sh-tt-start,.sh-tt-row.is-unreg .sh-tt-end,.sh-tt-row.is-unreg .sh-tt-memo{opacity:.7;}
  .sh-tt-row.is-unreg .sh-tt-24h:hover,.sh-tt-row.is-unreg .sh-tt-start:focus,.sh-tt-row.is-unreg .sh-tt-end:focus,.sh-tt-row.is-unreg .sh-tt-memo:focus{opacity:1;}
  .sh-tt-row.is-off-only .sh-tt-24h,.sh-tt-row.is-off-only .sh-tt-start,.sh-tt-row.is-off-only .sh-tt-end{display:none;}
  .sh-toolbar{background:#fff;padding:1rem 1.5rem;border-bottom:1px solid var(--gray);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.7rem;}
  .sh-toolbar select{padding:.45rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;}
  /* 一括設定バー。タイムテーブルの直前に置き、表示中の10日ぶんへまとめて反映する */
  .sh-bulk{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;background:var(--foam);
    border-bottom:1px solid var(--gray);padding:.7rem 1.5rem;}
  .sh-bulk-title{font-weight:700;color:var(--deep);font-size:.88rem;white-space:nowrap;}
  .sh-bulk-chips{display:inline-flex;gap:.3rem;}
  .sh-bulk select{padding:.4rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.85rem;background:#fff;}
  .sh-bulk .btn-primary{padding:.45rem 1rem;font-size:.85rem;}
  /* 一括設定バーのチップ。行内のチップ用CSSは .sh-tt-row 配下にしか効かないので、
     ここで別に指定する（当たっておらず、押しても見た目が変わらなかった・店長指摘 2026-08-07） */
  .sh-bulk .sh-tt-stchip{display:inline-flex;align-items:center;gap:.25rem;padding:.4rem .8rem;border:1.5px solid var(--gray);
    border-radius:50px;font-size:.85rem;font-weight:700;color:var(--ink-soft);background:#fff;cursor:pointer;user-select:none;transition:all .15s;}
  .sh-bulk .sh-tt-stchip:hover{border-color:var(--sea);color:var(--ink);}
  /* 選択中は地を塗って白抜き＋少し持ち上げる。どれを選んでいるか一目で分かるように */
  .sh-bulk .sh-tt-stchip.is-on{color:#fff;border-color:transparent;box-shadow:0 2px 7px rgba(0,0,0,.22);transform:translateY(-1px);}
  .sh-bulk .sh-tt-stchip.is-on[data-bulk-status="available"]{background:#2d7a4a;}
  .sh-bulk .sh-tt-stchip.is-on[data-bulk-status="tentative"]{background:#c07a12;}
  .sh-bulk .sh-tt-stchip.is-on[data-bulk-status="off"]{background:#4a4e53;}
  /* 選択中の色を入れないと、白文字＋白地で文字が消える（店長指摘 2026-08-16） */
  .sh-bulk .sh-tt-stchip.is-on[data-bulk-status="unreg"]{background:#8b969d;font-style:italic;}
  @media(max-width:640px){
    .sh-bulk{padding:.6rem .8rem;}
    .sh-bulk-title{width:100%;}
    .sh-bulk select{flex:1;min-width:0;}
  }
  .sh-mode-btn{background:#fff;color:var(--ink-soft);border:none;padding:.5rem 1rem;font-size:.84rem;font-weight:600;cursor:pointer;transition:all .15s;}
  .sh-mode-btn:hover{background:var(--foam);}
  .sh-mode-btn.is-active{background:var(--deep);color:#fff;}
  .sh-mode-btn + .sh-mode-btn{border-left:1.5px solid var(--gray);}
  /* カレンダー (月表示) — タイムテーブルとは別レイアウト */
  .sh-calendar{display:grid;grid-template-columns:repeat(7, 1fr);gap:.4rem;padding:1rem;max-width:1100px;margin:0 auto;}
  .sh-dow-head{background:var(--deep);color:#fff;padding:.4rem;text-align:center;font-size:.78rem;letter-spacing:.05em;border-radius:6px;}
  .sh-dow-head.sun{background:#a04050;}
  .sh-dow-head.sat{background:#2a5a8a;}
  .sh-day{background:#fff;border-radius:8px;padding:.6rem;min-height:90px;cursor:pointer;transition:all .15s;border:1.5px solid transparent;}
  .sh-day:hover{border-color:var(--aqua);background:var(--foam);}
  .sh-day.other-month{opacity:.35;}
  .sh-day.today{border-color:var(--coral);}
  .sh-day .sd-date{font-family:'Outfit';font-weight:700;font-size:1rem;color:var(--deep);}
  .sh-day .sd-date.sun{color:#c44;}
  .sh-day .sd-date.sat{color:#27a;}
  .sh-day .sd-shifts{margin-top:.3rem;display:flex;flex-direction:column;gap:.15rem;}
  /* グラデーション+白文字は読みにくいので、地は薄く・文字は濃い同系色に統一（店長指摘 2026-08-07「OPSは各所見やすく」） */
  .sh-shift-pill{font-size:.72rem;font-weight:700;padding:.18rem .45rem;border-radius:5px;line-height:1.35;
    background:#ddeff4;color:#0d5e70;border-left:3px solid #1d7a9c;}
  .sh-shift-pill.s-off{background:#eceeef;color:#5a6268;border-left-color:#9aa3a8;}
  .sh-shift-pill.s-tentative{background:#fde9d9;color:#8a4a12;border-left-color:#e08636;}
  .sh-timetable{padding:1rem 1.5rem;max-width:1100px;margin:0 auto;}
  .sh-timetable.is-grid{max-width:1600px;}
  @media(max-width:760px){.sh-timetable{padding:.7rem;}}
  .sh-tt-row{display:grid;grid-template-columns:130px 120px 60px 120px 120px 1fr 90px;gap:.6rem;align-items:center;padding:.7rem .85rem;background:#fff;border-radius:10px;margin-bottom:.5rem;box-shadow:0 1px 4px rgba(10,61,82,.06);transition:all .15s;border-left:4px solid transparent;}
  .sh-tt-row .sh-tt-24h{display:flex;align-items:center;justify-content:center;gap:.25rem;font-size:.78rem;font-weight:600;color:var(--deep);cursor:pointer;user-select:none;padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;background:#fff;}
  .sh-tt-row .sh-tt-24h:hover{border-color:var(--coral);}
  .sh-tt-row .sh-tt-24h input{margin:0;cursor:pointer;}
  .sh-tt-row.is-24h .sh-tt-24h{background:linear-gradient(135deg,var(--coral),#e87a4f);color:#fff;border-color:transparent;}
  .sh-tt-row.is-24h .sh-tt-start,.sh-tt-row.is-24h .sh-tt-end{pointer-events:none;background:#f5f5f5;color:#999;}
  .sh-tt-row:hover{box-shadow:0 2px 8px rgba(10,61,82,.12);}
  .sh-tt-row.today{border-left-color:var(--coral);background:linear-gradient(90deg,#fff5ef,#fff);}
  .sh-tt-row.dow-sun .sh-tt-date{color:#c44;}
  .sh-tt-row.dow-sat .sh-tt-date{color:#27a;}
  .sh-tt-row.is-off{opacity:.55;}
  .sh-tt-row.is-off .sh-tt-start,.sh-tt-row.is-off .sh-tt-end{pointer-events:none;background:#f5f5f5;color:#999;}
  .sh-tt-date{font-weight:700;font-size:.94rem;color:var(--deep);font-family:'Outfit';display:flex;align-items:baseline;gap:.4rem;}
  .sh-tt-date .dow{font-size:.74rem;color:var(--ink-soft);font-weight:500;}
  .sh-tt-date .ymd{font-size:.72rem;color:var(--ink-soft);font-weight:500;}
  .sh-tt-row select,.sh-tt-row input[type=text]{padding:.55rem .7rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.88rem;width:100%;background:#fff;cursor:pointer;color:var(--deep);font-weight:600;}
  .sh-tt-row select:focus,.sh-tt-row input[type=text]:focus{outline:none;border-color:var(--coral);}
  .sh-tt-row .sh-tt-state{font-weight:700;}
  .sh-tt-row .sh-tt-state.s-available{color:var(--green);}
  .sh-tt-row .sh-tt-state.s-off{color:var(--ink-soft);background:#f0f0f0;}
  .sh-tt-row .sh-tt-state.s-tentative{color:#c47b00;background:#fff7e6;}
  .sh-tt-row .sh-tt-memo{font-size:.84rem;font-weight:500;}
  .sh-tt-row .sh-tt-status-cell{display:flex;align-items:center;justify-content:flex-end;gap:.35rem;min-width:0;}
  .sh-tt-row .sh-tt-status-cell .sh-saving{font-size:.72rem;color:var(--coral);font-weight:600;}
  .sh-tt-row .sh-tt-status-cell .sh-saved{font-size:.72rem;color:var(--green);font-weight:600;}
  .sh-tt-row .sh-tt-status-cell .sh-clear{font-size:.7rem;color:var(--ink-soft);background:none;border:1px solid var(--gray);padding:.3rem .5rem;border-radius:6px;cursor:pointer;}
  .sh-tt-row .sh-tt-status-cell .sh-clear:hover{color:var(--red);border-color:var(--red);}

  /* 内勤・送迎シフトの一覧グリッド（スタッフ×10日）。CTRL の女性出勤グリッドと同じ見え方に揃える */
  .sh-grid-wrap{overflow-x:auto;background:#fff;border:1.5px solid var(--gray);border-radius:12px;box-shadow:0 1px 4px rgba(10,61,82,.06);}
  .sh-grid{border-collapse:separate;border-spacing:0;width:100%;font-size:.85rem;}
  .sh-grid th,.sh-grid td{border-bottom:1px solid var(--gray);border-right:1px solid var(--gray);padding:.35rem .3rem;text-align:center;white-space:nowrap;}
  .sh-grid tr:last-child td{border-bottom:none;}
  .sh-grid th{background:var(--foam);color:var(--deep);font-weight:700;font-size:.8rem;position:sticky;top:0;z-index:2;}
  .sh-grid .sg-name{text-align:left;padding-left:.7rem;padding-right:.7rem;position:sticky;left:0;background:#fff;z-index:1;min-width:9.5rem;}
  .sh-grid th.sg-name{background:var(--foam);z-index:3;}
  .sh-grid tbody tr:hover .sg-name{background:var(--sand);}
  .sh-grid .sg-name .sg-who{font-weight:700;color:var(--deep);background:none;border:none;padding:0;font-size:.9rem;cursor:pointer;text-align:left;}
  .sh-grid .sg-name .sg-who:hover{color:var(--coral);text-decoration:underline;}
  .sh-grid .sg-role{display:block;font-size:.68rem;color:var(--ink-soft);font-weight:600;}
  .sh-grid th .sg-dow{display:block;font-size:.7rem;font-weight:600;}
  .sh-grid th .sg-num{display:block;font-size:.68rem;color:var(--ink-soft);font-weight:600;}
  .sh-grid th.sg-sat a,.sh-grid th.sg-sat{color:#27a;}
  .sh-grid th.sg-sun a,.sh-grid th.sg-sun{color:#c44;}
  .sh-grid th.is-today{background:#fff1e9;box-shadow:inset 0 -3px 0 var(--coral);}
  .sh-grid td.sg-c{cursor:pointer;min-width:5.6rem;line-height:1.15;transition:background .12s;}
  .sh-grid td.sg-c:hover{background:var(--foam);}
  .sh-grid td.sg-c.is-today{background:#fffaf7;}
  .sh-grid td.sg-c .sg-t{display:block;font-weight:700;font-size:.86rem;color:var(--deep);font-family:'Outfit';}
  /* 24H・早番・遅番は日本語なので Outfit ではなく本文の書体で（店長要望 2026-08-28） */
  .sh-grid td.sg-c .sg-t.sg-kubun{font-family:inherit;font-size:.92rem;letter-spacing:.04em;}
  .sh-grid td.sg-c .sg-t2{display:block;font-size:.72rem;color:var(--ink-soft);font-weight:600;font-family:'Outfit';}
  .sh-grid td.sg-c .sg-un{color:var(--unset);font-size:1rem;font-weight:700;}
  .sh-grid td.sg-c .sg-memo{display:block;font-size:.66rem;color:var(--ink-soft);max-width:6.5rem;overflow:hidden;text-overflow:ellipsis;margin:0 auto;}
  .sh-grid td.s-available{background:#eefaf2;}
  .sh-grid td.s-available:hover{background:#dff5e8;}
  .sh-grid td.s-tentative{background:#fff8e8;}
  .sh-grid td.s-tentative .sg-t{color:#a86a00;}
  .sh-grid td.s-off{background:#f3f4f5;color:var(--ink-soft);font-weight:700;}
  .sh-grid td.sg-total{font-weight:700;color:var(--deep);background:var(--foam);border-right:none;}
  .sh-grid td.sg-total small{font-weight:600;color:var(--ink-soft);font-size:.7rem;}
  .sh-grid th.sg-total{border-right:none;}
  .sh-grid-legend{display:flex;flex-wrap:wrap;gap:.9rem;align-items:center;margin-top:.7rem;font-size:.78rem;color:var(--ink-soft);}
  .sh-grid-legend i{display:inline-block;width:.85rem;height:.85rem;border-radius:3px;border:1px solid var(--gray);vertical-align:-2px;margin-right:.3rem;}
  .sh-grid-legend i.lg-available{background:#eefaf2;}
  .sh-grid-legend i.lg-tentative{background:#fff8e8;}
  .sh-grid-legend i.lg-off{background:#f3f4f5;}
  .sh-grid-legend i.lg-unreg{background:#fff;}
  @media(max-width:760px){
    .sh-grid td.sg-c{min-width:4.6rem;}
    .sh-grid .sg-name{min-width:6.5rem;}
    .sh-grid td.sg-c .sg-memo{display:none;}
  }

  /* 共通: empty */
  .view-empty{text-align:center;padding:3rem 1rem;color:var(--ink-soft);}
  .view-empty .ve-icon{font-size:2.4rem;margin-bottom:.7rem;opacity:.6;}

  /* ドラッグ並び替え */
  .drag-handle{cursor:grab;color:var(--ink-soft);padding:.5rem .35rem;font-size:1.3rem;letter-spacing:-.35em;user-select:none;line-height:1;align-self:center;}
  .drag-handle:hover{color:var(--sea);}
  .drag-handle:active{cursor:grabbing;}
  .bk-row.sortable.dragging{opacity:.35;}
  .bk-row.sortable.drag-over-top{border-top:3px solid var(--coral);}
  .bk-row.sortable.drag-over-bottom{border-bottom:3px solid var(--coral);}

  /* Toast */
  .toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:var(--deep);color:#fff;padding:.85rem 1.6rem;border-radius:50px;font-size:.9rem;opacity:0;pointer-events:none;transition:opacity .25s, transform .25s;z-index:300;box-shadow:0 10px 30px rgba(0,0,0,.3);}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(-10px);}
  .toast.err{background:var(--red);}
  .toast.ok{background:var(--green);}

  /* Loading / Empty */
  .loading,.empty{text-align:center;padding:3rem 1rem;color:var(--ink-soft);}
  .spinner{display:inline-block;width:22px;height:22px;border:3px solid rgba(91,188,212,.25);border-top-color:var(--sea);border-radius:50%;animation:spin .8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}

  /* ============== モバイル対応（レスポンシブ） ============== */
  @media (max-width: 780px) {
    /* ヘッダー: ロゴ・タブ・ユーザー情報が1行で競合するため各要素を縮小 */
    .header-inner{padding:.5rem .7rem!important;gap:.5rem!important;}
    .header-inner .logo .name{font-size:1rem!important;letter-spacing:.18em!important;}
    .header-inner .logo svg{width:22px;height:22px;}
    .header-inner .logo .badge{font-size:.55rem;padding:.12rem .4rem;margin-left:.2rem!important;}
    #userEmail{font-size:.7rem;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;}
    .btn-logout{padding:.35rem .7rem;font-size:.75rem;}

    /* タブ: 横スクロール可 (HTMLが .tab-nav なのでそちらに合わせる) */
    .tab-nav{overflow-x:auto;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
    .tab-nav::-webkit-scrollbar{display:none;}
    .tab-btn{padding:.7rem .8rem!important;font-size:.8rem!important;white-space:nowrap;flex-shrink:0;}
  }
  /* 狭い画面: タブの表示幅を確保するため、ロゴのCTRLバッジと氏名表示を省略（店長のモード切替表示は維持） */
  @media (max-width: 480px) {
    .logo .badge{display:none;}
    #userEmail{display:none;}
    .header-right .user-menu.has-modes #userEmail{display:inline-block;max-width:44px;}

    /* モーダル */
    .modal-overlay{padding:0!important;align-items:flex-end;}
    .modal{max-width:100%!important;width:100%!important;border-radius:16px 16px 0 0!important;max-height:92dvh!important;}
    .modal-header{padding:1rem 1.1rem .5rem!important;}
    .modal.draggable .modal-header{padding-right:3.4rem!important;}
    /* スマホでは _ と × を小さく */
    .modal.draggable .modal-minimize{font-size:1rem!important;top:.7rem!important;right:1.9rem!important;padding:.15rem .3rem!important;}
    .modal.draggable .modal-close{font-size:1.05rem!important;top:.7rem!important;right:.4rem!important;padding:.15rem .3rem!important;}
    .modal-header .mh-title{font-size:1rem;}
    /* ヘッダー内 担当/ステータス: スマホでは縮小して×と被らせない */
    .bm-head-ss{padding:0 .35rem!important;gap:.3rem!important;}
    .bm-head-ss select{max-width:90px!important;font-size:.74rem!important;padding:.35rem .4rem!important;}
    .modal-body{padding:.8rem 1rem!important;}
    .modal-footer{padding:.7rem 1rem!important;flex-wrap:wrap;}
    .modal-footer .btn-primary,.modal-footer .btn-secondary{flex:1;min-width:0;padding:.7rem 1rem;font-size:.88rem;}
    /* 透過モーダル（予約モーダル）はドラッグせずに全画面 */
    .modal-overlay.transparent .modal{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important;width:96%!important;max-width:96%!important;max-height:92dvh!important;}

    /* 入力欄: iOS自動ズーム防止 + タッチ最適化 */
    .field input,.field select,.field textarea{font-size:16px!important;padding:.7rem .8rem!important;}
    .field label{font-size:.85rem;margin-bottom:.3rem;}
    /* モーダル内のペアは2列維持（縦伸び防止） */
    .modal-body div[style*="grid-template-columns"]{grid-template-columns:1fr 1fr!important;gap:.5rem .5rem!important;}
    /* 日付｜開始｜終了 は例外で3列を維持（1行表示のため）。文字サイズ(iOS自動ズーム防止のため16px維持)はそのまま、余白だけ詰めて幅を確保 */
    /* スマホの予約編集まわり（店長指摘 2026-08-25）
       ・日付は1行ぶん使い、開始予定/終了予定を下の段に大きく置く（開始が窮屈で読みづらかった）
       ・延長とバスタオル貸出は必ず1行
       ・メール欄と領収証ボタンも1行
       ・下の合計バーが途中で切れないよう高さを広げる */
    #bmDateTimeRow{grid-template-columns:1fr 1fr!important;gap:.4rem .5rem!important;}
    #bmDateTimeRow > .field:first-child{grid-column:1 / -1;}
    #bmDateTimeRow select{font-size:16px!important;padding:.6rem .3rem!important;}
    #bmDateTimeRow .field label{font-size:.74rem!important;}
    .bm-ext-row{flex-wrap:nowrap!important;gap:.35rem!important;align-items:center;}
    .bm-ext-row .bm-ext-info{display:none;}            /* 「1回 +30分 / +¥8,800」は幅を食うので隠す */
    .bm-ext-row .bm-lend-group{margin-left:auto;flex-shrink:0;}
    .bm-ext-row .bm-towel{white-space:nowrap;}
    .bm-mail-row{flex-wrap:nowrap!important;gap:.5rem!important;align-items:flex-end;}
    .bm-mail-row .bm-receipt-wrap{width:auto!important;}
    .bm-receipt-spacer{display:block!important;}
    .bm-mail-row .bm-receipt-btn{width:auto!important;font-size:.76rem!important;padding:.6rem .5rem!important;}
    .bm-summary-bar .bm-sum-main{max-height:9em!important;}
    #bmDateTimeRow input,#bmDateTimeRow select,#bmDateTimeRow #bmEndDisplay{padding:.6rem .35rem!important;}
    #bmDateTimeRow .field label{font-size:.7rem;margin-bottom:.2rem;white-space:nowrap;}
    #bmDateTimeRow .time-input{gap:.1rem!important;}
    #bmDateTimeRow .time-input span{font-size:.7rem;flex-shrink:0;}
    /* 市区町村｜訪問先タイプ は例外で1列積み（訪問先タイプの3択を1行表示するための横幅確保） */
    #bmLocTypeRow{grid-template-columns:1fr!important;}
    /* ホテル選択｜部屋番号 も例外で1列積み（ホテル名が長いと見切れるため全幅確保、部屋番号は下に回す） */
    #bmHotelRoomRow,#bmHotelRoomRow-2{grid-template-columns:1fr!important;}
    /* コース｜指名方法 も例外で1列積み（コース名(料金付き)が長いと見切れるため全幅確保） */
    #bmCourseNominationRow,#bmCourseNominationRow-2{grid-template-columns:1fr!important;}
    /* 開始時刻は「時select 時 分select 分」を必ず1段で */
    .modal-body .time-input[style*="grid-template-columns"]{grid-template-columns:1fr auto 1fr auto!important;gap:.35rem!important;}
    /* ステータスボタン群は2列 */
    .em-status[style*="grid-template-columns"]{grid-template-columns:1fr 1fr!important;}
    .sbtn{padding:.6rem .5rem;font-size:.82rem;}

    /* タイムライン: スタッフ列を sticky + 横スクロール (モバイル) */
    .tl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:.4rem 0;scroll-padding-inline-end:60px;}
    /* セル幅をモバイル用に縮小して画面内に多くの時間帯を表示, 角丸縮小で最終列の見切れ防止 */
    .tl-grid{grid-template-columns:206px repeat(24, minmax(72px, 1fr))!important;min-width:1959px;border-radius:4px!important;}
    .tl-row-area{grid-template-columns:repeat(24, minmax(72px, 1fr))!important;}
    /* 営業日終端マーカー (最終列 09:00 = 翌10:00 まで) を見やすく */
    .tl-grid > .tl-head:last-child,
    .tl-grid > .tl-cell:nth-child(25n){box-shadow:inset 1px 0 0 rgba(255,154,118,.5);}
    .tl-head.staff-col,.tl-staff{position:sticky;left:0;z-index:55;background:var(--white);transform:translateZ(0);}
    .tl-head.staff-col{background:var(--deep);}
    .tl-head{font-size:.7rem;padding:.35rem .15rem;}
    .tl-head .tl-hour{font-size:.72rem;}
    .tl-staff{padding:.2rem .22rem;font-size:.74rem;flex-direction:column;gap:.08rem;}
    .tl-staff-body{flex-direction:row;gap:.18rem;}
    .tl-staff-left{width:54px;}
    .tl-m{font-size:.64rem;}
    .tl-m-time .tl-m-v{font-size:.66rem;}
    .tl-m-time .tl-m-wave{margin:0 .04em;}
    .tl-staff .role-mini{font-size:.58rem;}
    .tl-staff-thumb,.tl-staff-thumb-ph{width:44px;height:44px;margin-bottom:0;}
    .tl-staff-thumb-ph{font-size:1rem;}
    .tl-staff-time{font-size:.62rem;}
    /* 横スクロール可ヒント */
    .tl-scroll-hint{display:block;font-size:.72rem;color:var(--ink-soft);text-align:center;padding:.3rem 0 .1rem;}
    .tl-toolbar{flex-wrap:wrap;gap:.5rem;padding:.5rem .7rem;}
    .tl-toolbar .tl-title{font-size:1rem;}
    .tl-toolbar .tl-sub{font-size:.7rem;display:block;margin-top:.2rem;}
    /* 前日/日付/今日/翌日/まとめ を1段に収める: 日付の年を消した分 input を詰めボタンも小さく */
    .tl-nav{gap:.3rem;flex-wrap:wrap;}
    .tl-nav button,.tl-add{padding:.45rem .55rem;font-size:.78rem;}
    .tl-toolbar .tl-nav input[type="date"]{padding:.4rem .4rem;font-size:.82rem;width:auto;max-width:106px;min-width:0;flex:0 0 auto;}
    /* タイムラインの日付ナビ（前日/日付/今日/翌日/💰まとめ）は5要素あり折返しやすいため、
       折り返さず横スクロールで1行を維持（ボタン等はさらに詰める） */
    #view-timeline .tl-toolbar .tl-nav{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
    #view-timeline .tl-toolbar .tl-nav::-webkit-scrollbar{display:none;}
    #view-timeline .tl-toolbar .tl-nav button{flex-shrink:0;padding:.45rem .5rem;}
    #view-timeline .tl-toolbar .tl-nav input[type="date"]{flex-shrink:0;}
    #view-timeline .tl-toolbar .tl-nav button#tlCashSummary,
    #view-timeline .tl-toolbar .tl-nav button#tlWorkLog{margin-left:0!important;}
    /* タイムライン日付ヘッダー */
    #tlTitle{font-size:.95rem;}
    /* クイック電話ブロック: ラベル(📞のみ)＋①②を全部1行に収める */
    .tl-phone-quick{flex-direction:row;flex-wrap:nowrap;align-items:center;gap:.25rem;padding:.4rem .45rem;width:100%;box-sizing:border-box;}
    .tl-toolbar button.tl-reload{flex:0 0 auto;padding:.45rem .6rem;font-size:.78rem;}
    .tl-phone-quick .pq-row{flex:1 1 0;min-width:0;gap:.15rem;}
    .tl-phone-quick .pq-row label{flex-shrink:0;font-size:.72rem;}
    .tl-phone-quick .pq-row input{font-size:16px;width:auto;flex:1;min-width:0;padding:.35rem .3rem;}
    .tl-phone-quick .pq-row button{padding:.35rem .5rem;font-size:.72rem;flex-shrink:0;}

    /* 予約バー */
    .tl-booking{font-size:.62rem;padding:.18rem .3rem;}
    .tl-booking .bk-time{font-size:.6rem;}
    .tl-booking .bk-hotel{display:none;}

    /* 一覧系の bk-row（予約・コース等） */
    .bk-row,.cu-row{padding:.7rem .8rem;}
    .bi-name{font-size:.95rem;}
    .bi-meta{font-size:.78rem;flex-wrap:wrap;gap:.3rem;}

    /* 見出し＋ボタンが1行に詰め込まれて画面外に切れるので、見出しは1行使って
       ボタンは下に並べる（店長指摘 2026-09-01） */
    .staff-head{align-items:center;gap:.5rem;margin-bottom:1rem;}
    .staff-head h2{width:100%;font-size:1.05rem;}
    .staff-head .btn-primary-coral{padding:.5rem 1rem;font-size:.82rem;}
    .staff-head .btn-ghost{padding:.45rem .85rem;font-size:.78rem;}

    /* スタッフテーブル */
    .staff-row{padding:.7rem .8rem;}
    .staff-row .sr-name{font-size:.92rem;}
    .staff-row .sr-actions{flex-wrap:wrap;gap:.3rem;}
    .staff-row .sr-actions button{padding:.4rem .7rem;font-size:.76rem;}

    /* ホテル管理 フィルタ + 一覧 */
    .hotel-row{padding:.7rem .8rem;font-size:.85rem;}
    .hotel-row .row-name{font-size:.95rem;}
    .filter-inner{padding:.6rem;}
    .filter-inner input,.filter-inner select{font-size:16px;padding:.6rem;}

    /* チャット既存対応はOK、ただし入力欄サイズ */
    .ca-reply textarea{font-size:16px;}

    /* 統計カード */
    .stats-inner .stat{padding:.6rem;}
    .stats-inner .stat .num{font-size:1.4rem;}
    .stats-inner .stat .lbl{font-size:.7rem;}

    /* シフトカレンダー */
    .sh-grid{grid-template-columns:repeat(7,1fr);}
    .sh-day{min-height:60px;padding:.3rem;font-size:.78rem;}

    /* シフトタイムテーブル: モバイルは 2 列 + 日付/メモは横幅一杯 */
    .sh-toolbar{padding:.7rem .8rem;flex-direction:column;align-items:stretch;}
    .sh-toolbar .tl-nav{flex-wrap:wrap;justify-content:flex-start;gap:.4rem;}
    .sh-toolbar .tl-nav button{padding:.45rem .7rem;font-size:.8rem;}
    .sh-mode-btn{padding:.45rem .7rem;font-size:.78rem;}
    .sh-timetable{padding:.6rem .5rem;}
    .sh-tt-row{grid-template-columns:1fr 1fr;gap:.4rem .5rem;padding:.7rem .75rem;border-radius:12px;}
    /* 行順 (上から): 1=日付+24H / 2=開始|終了 / 3=出仮休未チップ / 4=メモ */
    .sh-tt-row .sh-tt-date{grid-column:1;grid-row:1;font-size:1rem;border-bottom:1px solid var(--gray);padding-bottom:.4rem;margin-bottom:.15rem;display:flex;align-items:center;gap:.4rem;}
    .sh-tt-row .sh-tt-24h{grid-column:2;grid-row:1;align-self:center;justify-self:end;margin:0 0 .55rem;border:1px solid var(--gray);border-radius:6px;padding:.3rem .65rem;font-size:.78rem;line-height:1;background:#fff;}
    .sh-tt-row .sh-tt-start{grid-column:1;grid-row:2;}
    .sh-tt-row .sh-tt-end{grid-column:2;grid-row:2;}
    .sh-tt-row .sh-tt-stchips{grid-column:1 / -1;grid-row:3;flex-wrap:nowrap;gap:.25rem;justify-content:space-between;}
    .sh-tt-row .sh-tt-stchip{flex:1 1 0;justify-content:center;padding:.45rem .35rem;font-size:.78rem;min-width:0;}
    .sh-tt-row .sh-tt-stchip .lbl-full{display:none;}
    .sh-tt-row .sh-tt-stchip .lbl-short{display:inline;}
    .sh-tt-row .sh-tt-memo{grid-column:1 / -1;grid-row:4;}
    .sh-tt-row .sh-tt-status-cell{grid-column:1 / -1;grid-row:5;justify-content:space-between;min-height:24px;}
    .sh-tt-row select,.sh-tt-row input[type=text]{font-size:16px!important;padding:.55rem .6rem;}

    /* 最小化チップ */
    .min-card{max-width:200px;padding:.5rem .9rem;font-size:.78rem;}
    .min-card .mc-name{max-width:90px;}
  }

  /* タッチ最適化（全画面で） */
  button,select,input[type="checkbox"],input[type="radio"]{touch-action:manipulation;}
</style>
</head>
<body data-theme="soft">
<script>
// 配色の切り替え。既定は「目に優しい配色(soft)」。🌿 ボタンで従来配色に戻せる。
// 描画前に適用したいのでここに置く（後ろだと一瞬ちらつく）。
(function () {
  try { if (localStorage.getItem('opsTheme') === 'classic') document.body.dataset.theme = ''; } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('btnTheme');
    if (!b) return;
    var sync = function () {
      var soft = document.body.dataset.theme === 'soft';
      b.textContent = soft ? '🌿' : '🎨';
      b.title = soft ? '目に優しい配色（押すと従来の配色に戻します）' : '従来の配色（押すと目に優しい配色にします）';
    };
    sync();
    b.addEventListener('click', function () {
      var soft = document.body.dataset.theme === 'soft';
      document.body.dataset.theme = soft ? '' : 'soft';
      try { localStorage.setItem('opsTheme', soft ? 'classic' : 'soft'); } catch (e) {}
      sync();
    });
  });
})();
</script>

<header>
  <div class="header-inner">
    <a href="/ctrl/index.php" class="logo" title="CTRL のダッシュボードへ戻る">
      <span class="name en">Admi</span>
      <span class="badge en">CTRL</span>
    </a>
    <nav class="tab-nav">
      <button class="tab-btn" data-view="therapist" style="display:none;">🪪 マイページ</button>
      <button class="tab-btn" data-view="myclients" style="display:none;">👤 お客様</button>
      <button class="tab-btn active" data-view="timeline">📅 タイムライン</button>
      <button class="tab-btn" data-view="bookings">予約管理</button>
      <button class="tab-btn" data-view="customers">顧客管理</button>
      <button class="tab-btn" data-view="shifts">内勤・送迎シフト</button>
      <button class="tab-btn" data-view="chat" style="display:none;">💬 チャット<span id="chatUnreadBadge" class="tab-badge" style="display:none;">0</span></button>
      <button class="tab-btn" data-view="staffboard" style="display:none;">👥 キャスト管理</button>
      <button class="tab-btn" data-view="supplies">📦 備品</button>
      <button class="tab-btn" data-view="staff" style="display:none;">スタッフ管理</button>
      <button class="tab-btn" data-view="payroll" style="display:none;">💰 経理</button>
      <button class="tab-btn" data-view="settlement" style="display:none;">💴 入金</button>
      <button class="tab-btn" data-view="courses">マスタ</button>
      <button class="tab-btn" data-view="permissions">権限管理</button>
    </nav>
    <div class="header-right">
      <div class="user-menu" id="userMenu">
        <button type="button" class="user-name-btn" id="userNameBtn">
          <span class="email" id="userEmail">読込中...</span>
          <span class="user-caret" id="userCaret" style="display:none;">▾</span>
        </button>
        <div class="user-dropdown" id="userDropdown">
          <button type="button" class="user-dd-item" data-mode="manager">🏢 マネージャー管理</button>
          <button type="button" class="user-dd-item" data-mode="therapist">💆 キャスト管理</button>
        </div>
      </div>
      <button class="btn-theme" id="btnTheme" type="button" title="配色を切り替え（目に優しい配色 / 従来の配色）">🌿</button>
      <button class="btn-logout" id="btnLogout">ログアウト</button>
    </div>
  </div>
</header>

<!-- ========== 入口ビュー（店長: マネージャー管理 / キャスト管理 の2択） ========== -->
<div class="view" id="view-entry">
  <div class="entry-wrap">
    <h2 class="entry-title">管理メニュー</h2>
    <p class="entry-sub">操作する画面を選んでください</p>
    <div class="entry-cards">
      <button type="button" class="entry-card" data-mode="manager">
        <span class="entry-ico">🏢</span>
        <span class="entry-name">マネージャー管理</span>
        <span class="entry-desc">タイムライン・予約・顧客・経理など管理者業務</span>
      </button>
      <button type="button" class="entry-card" data-mode="therapist">
        <span class="entry-ico">💆</span>
        <span class="entry-name">キャスト管理</span>
        <span class="entry-desc">自分の予約・お客様・シフト・入金（マイページ）</span>
      </button>
    </div>
  </div>
</div>

<!-- ========== タイムラインビュー（1日 × 24時間 × スタッフ） ========== -->
<div class="view active" id="view-timeline">
  <div class="tl-toolbar">
    <div class="tl-title-row">
      <div class="tl-title" id="tlTitle">タイムライン<span class="tl-sub">営業日 10:00〜翌10:00</span></div>
      <button class="tl-add" id="tlAddBooking">＋ 新規受付</button>
    </div>
    <button type="button" id="tlReload" class="tl-reload" title="タイムラインを読み直す">⟳ 更新</button>
    <div class="tl-phone-quick">
      <div class="pq-row">
        <label>①</label>
        <input type="tel" id="pq1" placeholder="電話番号" inputmode="tel" autocomplete="off">
        <button data-pq="1" aria-label="①で予約">▶</button>
      </div>
      <div class="pq-row">
        <label>②</label>
        <input type="tel" id="pq2" placeholder="電話番号" inputmode="tel" autocomplete="off">
        <button data-pq="2" aria-label="②で予約">▶</button>
      </div>
    </div>
    <div class="tl-nav">
      <button id="tlToday">本日</button>
      <span class="tl-date-wrap">
        <input type="date" id="tlDatePicker">
        <span class="tl-date-disp" id="tlDateDisp" aria-hidden="true"></span>
      </span>
      <button id="tlPrev">◀ 前日</button>
      <button id="tlNext">翌日 ▶</button>
      <button id="tlCashSummary">💰 まとめ</button>
      <button id="tlWorkLog" title="勤務実績" aria-label="勤務実績">🚗</button>
      <button id="tlCastReports" class="tl-rep-btn" type="button" hidden>⚠ キャストからの報告 <b id="tlCastRepN">0</b>件</button>
    </div>
  </div>
  <div class="tl-split">
    <aside class="recv-panel" id="recvPanel">
      <div class="recv-head">
        <span class="recv-title">【受付リスト】<span class="recv-sub">着信履歴</span></span>
        <span class="recv-count">対象 <b id="recvCount">0</b> 件</span>
      </div>
      <div class="recv-colhead">
        <span>時間</span><span>電話番号</span><span>顧客名</span><span>状態</span><span>操作</span>
      </div>
      <div class="recv-list" id="recvList"><div class="recv-empty">読み込み中…</div></div>
    </aside>
    <div class="tl-wrap">
      <div id="timelineGrid"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
    </div>
  </div>
</div>

<!-- ========== 予約管理ビュー ========== -->
<div class="view" id="view-bookings">
  <div class="tl-toolbar">
    <div class="tl-title">予約一覧</div>
    <div class="tl-nav">
      <select id="bkFilterStatus">
        <option value="">全ステータス</option>
        <option value="inquiry">問合せ</option>
        <option value="reserved">予約</option>
        <option value="pre_reserved">事前予約</option>
        <option value="on_hold">保留</option>
        <option value="completed">接客完了</option>
        <option value="cancelled">キャンセル（全て）</option>
        <option value="no_show">無連絡</option>
        <option value="break">💤 休憩</option>
      </select>
      <input type="search" id="bkKeyword" placeholder="顧客名・ホテル・住所で検索" style="padding:.7rem 1rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;">
      <button class="tl-add" id="bkAddNew">+ 新規予約</button>
    </div>
  </div>
  <div class="staff-main" style="max-width:1200px;">
    <div id="bookingList" class="bk-list"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>
</div>

<!-- ========== 顧客管理ビュー ========== -->
<div class="view" id="view-customers">
  <div class="tl-toolbar">
    <div class="tl-title">顧客一覧</div>
    <div class="tl-nav">
      <input type="search" id="cuKeyword" placeholder="名前・電話・メール・住所で検索" style="padding:.5rem .8rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;">
      <select id="cuSort" title="並び順" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:#fff;">
        <option value="recent">最近の利用順</option>
        <option value="count">利用回数順</option>
      </select>
      <!-- 利用日で絞る（OPSの予約＋旧システムの利用履歴の両方を見る）。空欄なら絞らない -->
      <input type="date" id="cuVisitDate" title="この日に利用があったお客様" style="padding:.45rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:#fff;">
      <button type="button" id="cuVisitClear" title="日付の絞り込みを解除" style="display:none;padding:.45rem .7rem;border:1.5px solid var(--gray);border-radius:8px;background:#fff;font-size:.85rem;cursor:pointer;">✕ 日付</button>
      <select id="cuNg" title="NG絞り込み" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:#fff;">
        <option value="">全員</option>
        <option value="ng">NG登録のみ</option>
        <option value="memo">NG・注意（メモ含む）</option>
      </select>
      <button class="tl-add" id="cuAddNew">+ 新規顧客</button>
    </div>
  </div>
  <div class="staff-main" style="max-width:1200px;">
    <div id="customerList" class="cu-table"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>
</div>

<!-- ========== シフト管理ビュー ========== -->
<div class="view" id="view-shifts">
  <div class="sh-toolbar">
    <div class="tl-title" id="shTitle">内勤・送迎シフト</div>
    <div class="tl-nav">
      <div class="sh-mode-toggle" role="tablist" style="display:inline-flex;border:1.5px solid var(--gray);border-radius:8px;overflow:hidden;">
        <button id="shModeTimetable" class="sh-mode-btn is-active" role="tab" type="button">📋 タイムテーブル</button>
        <button id="shModeCalendar" class="sh-mode-btn" role="tab" type="button">📅 カレンダー</button>
      </div>
      <!-- 内勤スタッフ以上は全スタッフぶんを組めるので、owner-only は付けない（表示は loadShifts が制御） -->
      <select id="shStaffFilter" style="display:none;"><option value="">全スタッフ</option></select>
      <button id="shPrev">← 前へ</button>
      <button id="shToday">今日から</button>
      <button id="shNext">次へ →</button>
    </div>
  </div>
  <!-- 一括設定: 同じ時間の日が多いので、表示中の10日ぶんをまとめて登録する（店長要望 2026-08-07） -->
  <div class="sh-bulk" id="shBulk" style="display:none;">
    <span class="sh-bulk-title">まとめて設定</span>
    <!-- 一覧グリッド表示のときだけ出す対象スタッフ。個人表示のときは上のスタッフ選択が対象 -->
    <select id="shBulkStaff" style="display:none;" title="まとめて設定する対象スタッフ"></select>
    <div class="sh-bulk-chips" id="shBulkStatus">
      <button type="button" class="sh-tt-stchip is-on" data-bulk-status="available">🟢 出勤</button>
      <button type="button" class="sh-tt-stchip" data-bulk-status="tentative">🟡 仮</button>
      <button type="button" class="sh-tt-stchip" data-bulk-status="off">⚫ 休み</button>
      <!-- 各行のチップと同じ4択にそろえる（まとめて登録を消す・店長要望 2026-08-16） -->
      <button type="button" class="sh-tt-stchip" data-bulk-status="unreg">○ 未登録</button>
    </div>
    <label class="sh-tt-24h" title="10:00〜翌10:00 (24時間)"><input type="checkbox" id="shBulk24h">24H</label>
    <label class="sh-tt-24h" title="10:00〜19:00"><input type="checkbox" id="shBulkEarly">早番</label>
    <label class="sh-tt-24h" title="19:00〜翌10:00"><input type="checkbox" id="shBulkLate">遅番</label>
    <select id="shBulkStart"></select>
    <span id="shBulkTilde" style="color:var(--ink-soft);">〜</span>
    <select id="shBulkEnd"></select>
    <select id="shBulkDays">
      <option value="all">表示中の10日すべて</option>
      <option value="weekday">平日のみ（月〜金）</option>
      <option value="weekend">土日のみ</option>
      <option value="unreg">未登録の日だけ</option>
    </select>
    <button type="button" class="btn-primary" id="shBulkApply">この内容で反映</button>
  </div>
  <div id="shTimetable" class="sh-timetable"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  <div id="shCalendar" class="sh-calendar" style="display:none;"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
</div>

<!-- ========== コース管理ビュー ========== -->
<div class="view" id="view-courses">
  <!-- ホテル管理（旧タブ→マスタ内へ移動。クリックで view-hotel に切替） -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">🏨 ホテル管理<span class="tl-sub">対応ホテルの公開状況・実績・交通費を管理</span></div>
    <div class="tl-nav">
      <button class="tl-add" id="openHotelMgr" type="button">ホテル管理を開く →</button>
    </div>
  </div>

  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">コース管理<span class="tl-sub">予約モーダルで選べるコースを編集</span></div>
    <div class="tl-nav">
      <button class="tl-add" id="coAddNew">+ コース追加</button>
    </div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div id="courseList" class="bk-list"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>

  <!-- オプション管理（ローター・バイブ等。予約モーダルで選ぶと合計に加算される） -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">オプション管理<span class="tl-sub">予約モーダルで選べるオプションを編集</span></div>
    <div class="tl-nav">
      <button class="tl-add" id="opAddNew">+ オプション追加</button>
    </div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div id="optionList" class="bk-list"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>

  <!-- 入室方法マスタ -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">入室方法マスタ<span class="tl-sub">ホテル編集モーダルの入室方法プルダウンを編集</span></div>
    <div class="tl-nav">
      <button class="tl-add" id="emaAddNew" type="button" style="background:var(--coral);color:#fff;border:none;padding:.55rem 1.3rem;border-radius:50px;font-size:.88rem;font-weight:600;cursor:pointer;">+ 入室方法追加</button>
    </div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div id="entryMethodList" class="bk-list"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>

  <!-- 事務所の住所（ルート案内の既定の出発地） -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">事務所の住所<span class="tl-sub">予約画面のルート案内で、出発地の初期値に使います</span></div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div class="bk-list" style="padding:1rem 1.1rem;">
      <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;">
        <input type="text" id="officeAddress" placeholder="例: 東京都立川市曙町2-11-2"
               style="flex:1;min-width:240px;padding:.65rem .8rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.95rem;">
        <button class="btn-edit" id="officeAddressSave" type="button">保存</button>
      </div>
      <p class="hint" style="margin-top:.5rem;">
        キャストがいまいる場所を入れ直せば、そこからのルートに切り替わります（入れた場所はその端末が覚えます）。
      </p>
    </div>
  </div>

  <!-- 自宅の交通費はページ分離（店長要望 2026-08-08: 町名一覧を見ながら設定したいのでホテル管理と同じ方式） -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">🏠 自宅の交通費<span class="tl-sub">自宅・オフィスの交通費を市区町村・町名ごとに設定（ホテルはホテルマスタの交通費）</span></div>
    <div class="tl-nav">
      <button class="tl-add" id="openCityFeeMgr" type="button">自宅の交通費を開く →</button>
    </div>
  </div>

  <!-- 料金の全体設定。ほぼ変更しないので一番下へ（店長要望 2026-08-08）。
       クレジットは手数料をお客様の合計に上乗せして受け取る。キャストの報酬は決済方法で変わらない -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">💳 クレジット手数料<span class="tl-sub">お客様の合計に上乗せする率。キャストの報酬には影響しません</span></div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div class="card card-pad" style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;">
      <label for="msCardSurcharge" style="font-weight:700;">お客様への上乗せ率</label>
      <input type="number" id="msCardSurcharge" min="0" max="100" step="0.1" style="width:7em;padding:.45rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:1rem;font-weight:700;text-align:right;">
      <span style="font-weight:700;">%</span>
      <button class="btn-primary" type="button" id="msCardSurchargeSave" style="padding:.45rem 1rem;font-size:.85rem;">保存</button>
      <span id="msCardSurchargeMsg" style="font-size:.82rem;color:var(--ink-soft);"></span>
    </div>
    <p style="font-size:.8rem;color:var(--ink-soft);margin:.5rem 0 0;line-height:1.7;">
      例）10% のとき、コース¥11,000＋交通費¥1,100 のクレジット決済ならお客様の合計は ¥13,310 になります。<br>
      変更しても過去の予約に保存済みの手数料額は変わりません（これから作る予約に適用されます）。
    </p>
  </div>

  <!-- 指名料。損益タブから移設・ほぼ変更しないので一番下へ（店長要望 2026-08-08） -->
  <div class="tl-toolbar" style="margin-top:2rem;">
    <div class="tl-title">🎯 指名料<span class="tl-sub">お客様にいただく金額と、そのうちキャストへ支払う報酬</span></div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div class="card card-pad">
      <!-- 指名料とキャスト報酬は別物。報酬はコース報酬・機動ボーナスと合算されて報酬タブに出る（店長要望 2026-08-08） -->
      <div class="ms-nom-grid">
        <div class="ms-nom-h"></div>
        <div class="ms-nom-h">お客様の指名料</div>
        <div class="ms-nom-h">キャスト報酬</div>

        <div class="ms-nom-l">初指名</div>
        <div><input type="number" id="msNomFirst" min="0" step="100">円</div>
        <div><input type="number" id="msNomRewFirst" min="0" step="100">円</div>

        <div class="ms-nom-l">本指名</div>
        <div><input type="number" id="msNomRegular" min="0" step="100">円</div>
        <div><input type="number" id="msNomRewRegular" min="0" step="100">円</div>

        <div class="ms-nom-l">フリー</div>
        <div><input type="number" id="msNomFree" min="0" step="100">円</div>
        <div><input type="number" id="msNomRewFree" min="0" step="100">円</div>
      </div>
      <div style="display:flex;align-items:center;gap:.8rem;margin-top:1rem;">
        <button class="btn-primary" type="button" id="msNomSave" style="padding:.45rem 1rem;font-size:.85rem;">保存</button>
        <span id="msNomMsg" style="font-size:.82rem;color:var(--ink-soft);"></span>
      </div>
    </div>
  </div>

</div>

<!-- ========== 売上の保有者モーダル（タイムラインの「売上」クリック・ビュー外に配置） ========== -->
<div class="modal-overlay" id="holderModal">
  <div class="modal" style="max-width:560px;">
    <div class="modal-header">
      <h3 id="holderModalTitle">売上の保有</h3>
      <button class="modal-close" data-close="holderModal">×</button>
    </div>
    <div class="modal-body" id="holderModalBody"></div>
  </div>
</div>

<div class="modal-overlay" id="driverModal">
  <div class="modal" style="max-width:620px;">
    <div class="modal-header">
      <h3 id="driverModalTitle">🚗 ドライバー</h3>
      <button class="modal-close" data-close="driverModal">×</button>
    </div>
    <div class="modal-body" id="driverModalBody"></div>
  </div>
</div>

<div class="modal-overlay" id="chainModal">
  <div class="modal" style="max-width:600px;">
    <div class="modal-header">
      <h3 id="chainModalTitle">預り金の受け渡し</h3>
      <button class="modal-close" data-close="chainModal">×</button>
    </div>
    <div class="modal-body" id="chainModalBody"></div>
  </div>
</div>

<!-- ========== 報酬モーダル（報酬のありか・誰が本人に渡したか） ========== -->
<div class="modal-overlay" id="rewardModal">
  <div class="modal" style="max-width:600px;">
    <div class="modal-header">
      <h3 id="rewardModalTitle">報酬</h3>
      <button class="modal-close" data-close="rewardModal">×</button>
    </div>
    <div class="modal-body" id="rewardModalBody"></div>
  </div>
</div>

<!-- ========== 現金まとめモーダル（未回収預り金 + 未払い報酬） ========== -->
<div class="modal-overlay" id="cashSummaryModal">
  <div class="modal" style="max-width:600px;">
    <div class="modal-header">
      <h3>💰 まとめ</h3>
      <button class="modal-close" data-close="cashSummaryModal">×</button>
    </div>
    <div class="modal-body" id="cashSummaryBody"></div>
  </div>
</div>

<!-- ========== 勤務実績モーダル（まとめから独立・店長要望 2026-08-29） ========== -->
<div class="modal-overlay" id="workLogModal">
  <div class="modal" style="max-width:780px;">
    <div class="modal-header">
      <h3>🚗 勤務実績</h3>
      <button class="modal-close" data-close="workLogModal">×</button>
    </div>
    <div class="modal-body" id="workLogBody"></div>
  </div>
</div>

<!-- ========== 🏠 立川秘密基地 オーダー登録/編集（OPSから直接入力・店長要望 2026-09-01） ========== -->
<div class="modal-overlay" id="hkOrderModal">
  <div class="modal" style="max-width:660px;">
    <div class="modal-header">
      <div><div class="mh-title" id="hkOrderTitle">🏠 立川秘密基地 オーダー</div></div>
      <button class="modal-close" data-close="hkOrderModal">×</button>
    </div>
    <div class="modal-body" id="hkOrderBody"></div>
  </div>
</div>

<!-- ========== 駅 編集モーダル ========== -->
<div class="modal-overlay" id="stationModal">
  <div class="modal" style="max-width:460px;">
    <div class="modal-header">
      <div><div class="mh-title" id="stTitle">駅編集</div></div>
      <button class="modal-close" data-close="stationModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field"><label>駅名</label><div id="stName" style="font-weight:700;color:var(--deep);padding:.5rem 0;"></div></div>
      <div class="field">
        <label for="stBaseFee">基本交通費（円）</label>
        <input type="text" inputmode="numeric" data-money placeholder="例: 1100"id="stBaseFee">
        <span class="hint">この駅エリアの基本交通費。0=無料、+距離追加(1km超 +¥550/km)</span>
      </div>
      <div class="field">
        <label for="stFareTachikawa">立川駅からの運賃（円）</label>
        <input type="text" inputmode="numeric" data-money placeholder="例: 220"id="stFareTachikawa">
        <span class="hint">参考用。空欄=未設定</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="stationModal">キャンセル</button>
      <button class="btn-primary" id="stSave">保存</button>
    </div>
  </div>
</div>

<!-- ========== 入室方法 追加/編集モーダル ========== -->
<div class="modal-overlay" id="entryMethodModal">
  <div class="modal" style="max-width:460px;">
    <div class="modal-header">
      <div><div class="mh-title" id="emaTitle">新規入室方法</div></div>
      <button class="modal-close" data-close="entryMethodModal">×</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="emaCode">
      <div class="field"><label for="emaLabel">表示ラベル</label><input type="text" id="emaLabel" placeholder="例: フロントで呼び出し"></div>
      <div class="field"><label><input type="checkbox" id="emaIsActive" checked style="width:auto;margin-right:.4rem;"> この入室方法を有効にする</label><span class="hint">並び順は一覧でドラッグして変更できます</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="emaDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" data-close="entryMethodModal">キャンセル</button>
      <button class="btn-primary" id="emaSave">保存</button>
    </div>
  </div>
</div>

<!-- ========== コース 追加/編集モーダル ========== -->
<div class="modal-overlay" id="courseModal">
  <div class="modal" style="max-width:480px;">
    <div class="modal-header">
      <div><div class="mh-title" id="coTitle">新規コース</div></div>
      <button class="modal-close" data-close="courseModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field"><label for="coName">コース名</label><input type="text" id="coName" placeholder="例: 60分コース"></div>
      <!-- 時間・料金・報酬は1行（入力が短く、横並びの方が関係が見やすい） -->
      <div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:.7rem;">
        <div class="field"><label for="coDuration">時間（分）</label><input type="number" id="coDuration" min="5" step="5" placeholder="60"></div>
        <div class="field"><label for="coPrice">コース料金（円）</label><input type="text" inputmode="numeric" data-money placeholder="18000"id="coPrice"></div>
        <div class="field"><label for="coCastReward">キャスト報酬（円）</label><input type="text" inputmode="numeric" data-money placeholder="9000"id="coCastReward"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field">
          <label for="coHotelPrice">ホテル料金（円）</label>
          <input type="text" inputmode="numeric" data-money placeholder="11000" id="coHotelPrice">
        </div>
        <div class="field">
          <label for="coHotelCastReward">ホテル料金のキャスト報酬（円）</label>
          <input type="text" inputmode="numeric" data-money placeholder="7000" id="coHotelCastReward">
        </div>
      </div>
      <p class="hint" style="margin:-.7rem 0 1.1rem;">
        予約で「🏨 ホテル料金」にチェックを入れたとき、料金と報酬をこの値に置き換えます。
        <b>料金が空欄のコースはホテル料金の対象外</b>になり、予約側でチェックできません（お泊りコースなど）。
        報酬だけ空欄なら通常の報酬をそのまま使います。
      </p>
      <div class="field">
        <label for="coBonusCourse">＋10分のときのコース</label>
        <select id="coBonusCourse"><option value="">なし（終了時刻を10分のばすだけ）</option></select>
        <span class="hint">媒体・LINE予約にチェックが入って＋10分が付くとき、このコースに差し替えます（コース名・料金・報酬もそのコースの値になります）</span>
      </div>
      <div class="field"><label><input type="checkbox" id="coIsActive" checked style="width:auto;margin-right:.4rem;"> このコースを有効にする（予約モーダルで選択可能）</label><span class="hint">並び順は一覧でドラッグして変更できます</span></div>
      <div class="field"><label><input type="checkbox" id="coIsCombinable" checked style="width:auto;margin-right:.4rem;"> 組み合わせコースの部品に使う</label><span class="hint">180分以上を「90＋90」のように組むときの材料にします。延長・お泊りなど単独で使うコースは外してください</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="coDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" data-close="courseModal">キャンセル</button>
      <button class="btn-primary" id="coSave">保存</button>
    </div>
  </div>
</div>

<!-- ========== オプション 作成/編集モーダル ========== -->
<div class="modal-overlay" id="optionModal">
  <div class="modal" style="max-width:480px;">
    <div class="modal-header">
      <div><div class="mh-title" id="opTitle">新規オプション</div></div>
      <button class="modal-close" data-close="optionModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field"><label for="opName">オプション名</label><input type="text" id="opName" placeholder="例: ローター"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="opPrice">料金（円）</label><input type="text" inputmode="numeric" data-money placeholder="1000" id="opPrice"></div>
        <div class="field"><label for="opCastReward">キャスト報酬（円）</label><input type="text" inputmode="numeric" data-money placeholder="500" id="opCastReward">
          <span class="hint">空欄なら店の取り分（報酬に加算しません）</span></div>
      </div>
      <div class="field"><label><input type="checkbox" id="opIsActive" checked style="width:auto;margin-right:.4rem;"> このオプションを有効にする（予約モーダルで選択可能）</label><span class="hint">並び順は一覧でドラッグして変更できます</span></div>
      <div class="field"><label><input type="checkbox" id="opIsLendable" style="width:auto;margin-right:.4rem;"> 🧺 貸出品（回収が必要）</label><span class="hint">チェックすると、この品を貸した予約はタイムラインに 🧺 が出ます。回収すると消えます</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="opDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" data-close="optionModal">キャンセル</button>
      <button class="btn-primary" id="opSave">保存</button>
    </div>
  </div>
</div>

<!-- ========== 予約 作成/編集モーダル（ドラッグ可能 + 背景透過） ========== -->
<div class="modal-overlay transparent" id="bookingModal">
  <div class="modal draggable bm-modal" style="max-width:600px;">
    <div class="modal-header">
      <div style="flex-shrink:0;">
        <div class="mh-title" id="bmTitle">新規予約</div>
        <div class="mh-sub" id="bmSub"></div>
      </div>
      <div class="bm-head-ss" style="display:flex;gap:.4rem;align-items:center;flex:1;justify-content:center;padding:0 .9rem;">
        <select id="bmAdminId" title="担当キャスト"><option value="">キャストは？</option></select>
        <select id="bmStatus" title="ステータス">
          <option value="inquiry">問合せ</option>
          <option value="reserved">予約</option>
          <option value="pre_reserved">事前予約</option>
          <option value="on_hold">保留</option>
          <!-- ここは「予約そのものの状態」だけを扱う。接客が終わったかはタイムラインの「終」で分かるので
               接客完了は選択肢に出さない。接客完了の予約は「予約」と表示し、保存時に元の状態へ戻す（admin.js bmKeptStatus） -->
          <option value="cancelled:shop">お店都合キャンセル</option>
          <option value="cancelled:customer">お客様都合キャンセル</option>
          <option value="cancelled:therapist">キャスト都合キャンセル</option>
          <option value="cancelled:other">その他キャンセル</option>
          <option value="no_show">無連絡</option>
          <option value="break">💤 休憩・私用</option>
        </select>
      </div>
      <button class="modal-minimize" title="最小化(フッターへ)" data-minimize="bookingModal">＿</button>
      <button class="modal-close" data-close="bookingModal">×</button>
      <!-- 担当キャストの注意事項。固定ヘッダーの中の2行目（スクロールしても残る） -->
      <div id="bmCastAlert" class="bm-cast-alert-head" style="display:none;"></div>
    </div>
    <div class="modal-body">
      <!-- NG登録の警告。電話番号で顧客が当たった瞬間・担当を選んだ瞬間に一番上で目に入る位置 -->
      <div id="bmNgAlert" class="bm-ng-alert"></div>
      <div id="bmNgCastAlert" class="bm-ng-alert"></div>
      <label id="bmBreakModeLabel" style="display:none;align-items:center;gap:.5rem;font-weight:700;font-size:.88rem;cursor:pointer;background:linear-gradient(135deg,#fff8ef,#ffeada);color:#a85a3a;padding:.55rem .75rem;border-radius:10px;margin-bottom:1rem;border:1px solid #f3c9a8;">
        <input type="checkbox" id="bmBreakMode"> 💤 休憩・私用予定として登録(公開ページには「ご予約済」のみ表示)
      </label>
      <input type="hidden" id="bmCustomerId" value="">
      <!-- PCでは左=お客様と場所／右=料金の2段組み。狭い画面では今までどおり1列に戻る（.bm-cols） -->
      <div class="bm-cols">
      <div class="bm-col">
      <!-- 電話番号 | お名前 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field bm-customer-only">
          <label for="bmCustomerPhone">電話番号</label>
          <div style="display:flex;align-items:center;gap:.4rem;">
            <input type="tel" id="bmCustomerPhone" placeholder="090-1234-5678" inputmode="tel" style="flex:1;min-width:0;">
            <!-- 新規受付のときだけ出す。既存のお客様が電話で当たれば、その場でお名前・履歴を表示する（店長要望 2026-08-16） -->
            <button type="button" id="bmPhoneLookup" class="bm-phone-lookup-btn" title="電話番号でお客様を照会">🔍 照会</button>
          </div>
        </div>
        <div class="field bm-customer-only">
          <label for="bmCustomerName">お名前</label>
          <div style="display:flex;align-items:center;gap:.5rem;">
            <input type="text" id="bmCustomerName" placeholder="山田 太郎" style="flex:1;min-width:0;">
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">様</span>
          </div>
        </div>
      </div>
      <!-- ご新規様バッジ。電話で照合して当店の利用実績が無いときだけ出す（会員様は履歴が出るので不要） -->
      <div id="bmNewBadge" style="display:none;margin:-.4rem 0 1.1rem;padding:.5rem .8rem;border-radius:8px;
           background:linear-gradient(135deg,#fff6e5,#fff);border:1.5px solid #e8b96a;color:#8a5a12;font-size:.85rem;font-weight:700;">
        🌟 ご新規様 <span style="font-weight:500;opacity:.85;">— 当店のご利用が初めてのお客様です</span>
      </div>
      <!-- リピーター履歴（電話番号で顧客がヒットしたときのみ表示・読み取り専用） -->
      <div class="bm-customer-only" id="bmHistoryWrap" style="display:none;margin:-.4rem 0 1.1rem;">
        <button type="button" id="bmHistoryToggle" class="bm-history-toggle" aria-expanded="false">
          <span>🔁</span>
          <span id="bmHistorySummary" style="flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          <span class="bm-history-chev">▾</span>
        </button>
        <div id="bmHistoryPanel" class="bm-history-panel" style="display:none;"></div>
      </div>
      <!-- 日付 | 開始 | 終了 -->
      <div id="bmDateTimeRow" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;">
        <div class="field"><label for="bmDate">日付</label>
          <div class="bm-date-wrap">
            <input type="date" id="bmDate" class="bm-date" style="width:100%;box-sizing:border-box;">
            <span class="bm-date-disp" id="bmDateDisp" aria-hidden="true"></span>
          </div>
        </div>
        <div class="field bm-start-field">
          <label class="bm-start-label">開始予定</label>
          <div class="time-input" style="display:flex;gap:.3rem;align-items:center;">
            <select id="bmStartHour" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">時</span>
            <select id="bmStartMin" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">分</span>
          </div>
        </div>
        <div class="field">
          <label id="bmEndLabel">終了予定</label>
          <div id="bmEndDisplay" style="padding:.7rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;background:var(--foam);color:var(--deep);font-family:'Outfit';font-weight:700;letter-spacing:.04em;">—</div>
          <input type="hidden" id="bmEnd">
        </div>
      </div>
      <!-- 市区町村のエリア切替（メイン=多摩／23区／埼玉／神奈川。いずれも立川駅から近い順） -->
      <div class="field" id="bmCityRegionField">
        <label>市区町村のエリア</label>
        <div style="display:flex;gap:.3rem;background:var(--foam);padding:.4rem;border-radius:10px;">
          <label class="loc-tab"><input type="radio" name="bmCityRegion" value="main" checked><span>メイン</span></label>
          <label class="loc-tab"><input type="radio" name="bmCityRegion" value="tokyo23"><span>23区</span></label>
          <label class="loc-tab"><input type="radio" name="bmCityRegion" value="saitama"><span>埼玉</span></label>
          <label class="loc-tab"><input type="radio" name="bmCityRegion" value="kanagawa"><span>神奈川</span></label>
        </div>
      </div>
      <!-- 市区町村 | 訪問先タイプ -->
      <!-- 市区町村は訪問先タイプを切り替えても残す（ホテル→自宅に変えるたびに選び直すのが手間なため） -->
      <!-- 市区町村は選ぶだけなので狭く、訪問先タイプ（4択）に幅を回す（店長要望 2026-08-08） -->
      <div id="bmLocTypeRow" class="bm-loctype-row">
        <div class="field" id="bmCityField">
          <label for="bmCity">市区町村</label>
          <!-- 町名は市区町村を選ぶと右に出る。自宅の交通費を町単位で変えるため（店長要望 2026-08-08）。
               町名一覧が無い市区町村では出ない -->
          <div style="display:flex;gap:.4rem;">
            <select id="bmCity" style="flex:1;min-width:0;"><option value="">— すべて —</option></select>
            <select id="bmTown" style="flex:1;min-width:0;display:none;"><option value="">町名（任意）</option></select>
          </div>
          <!-- 自宅で町名を選んでいないと交通費が全域の値のままになる。選び忘れを防ぐ注意（店長要望 2026-08-24） -->
          <p class="bm-town-hint" id="bmTownHint" style="display:none;">▲ 町名も選んでください(交通費は町名計算)</p>
        </div>
        <div class="field">
          <label>訪問先タイプ</label>
          <div style="display:flex;gap:.3rem;background:var(--foam);padding:.4rem;border-radius:10px;">
            <label class="loc-tab"><input type="radio" name="bmLocType" value="loveho" checked><span>ラブホ</span></label>
            <label class="loc-tab"><input type="radio" name="bmLocType" value="hotel"><span>ホテル</span></label>
            <label class="loc-tab"><input type="radio" name="bmLocType" value="home"><span>自宅</span></label>
            <label class="loc-tab"><input type="radio" name="bmLocType" value="other"><span>その他</span></label>
          </div>
        </div>
      </div>

      <!-- ホテル -->
      <div class="loc-section" data-loc="hotel">
        <div id="bmHotelRoomRow" style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
          <div class="field">
            <label for="bmHotelId">ホテル選択</label>
            <select id="bmHotelId" class="bm-tight-select"><option value="">— 選択しない(下に手入力) —</option></select>
          </div>
          <div class="field">
            <label for="bmRoom">部屋番号</label>
            <input type="text" id="bmRoom" placeholder="例: 305">
          </div>
        </div>
        <!-- 選んだホテルの住所・TEL・入室方法と地図リンク（ドライバーへの案内用） -->
        <div id="bmHotelAddr" class="bm-hotel-addr" style="display:none;"></div>
        <!-- リストに無いホテルを打つのは稀なので、普段は畳んでおく（クリックで開く） -->
        <details class="field bm-freehotel" id="bmHotelNameWrap">
          <summary>ホテル名を手入力（リストにない場合）</summary>
          <input type="text" id="bmHotelName" placeholder="例: ○○ホテル立川店">
          <!-- お客様が直前にホテルを決めることが多いので、未定でも保存できる（店長要望 2026-08-24） -->
          <p class="bm-freehotel-note">ホテルが決まっていなければ、選ばず空欄のままで大丈夫です。<br>
            市区町村を入れた形（例: <b>立川市ラブホテル</b>）で記録され、決まってから直せます。</p>
        </details>
      </div>

      <!-- 自宅・オフィス -->
      <div class="loc-section" data-loc="home" style="display:none;">
        <!-- 過去に使ったご自宅住所が2つ以上あるお客様は、ここで選び替える（既定は直近・店長要望 2026-08-14） -->
        <div class="field bm-past-addr" id="bmPastAddrField" style="display:none;">
          <label for="bmPastAddr">過去のご利用住所</label>
          <select id="bmPastAddr"></select>
        </div>
        <!-- 住所と建物は1行に並べる（番地までと建物名を分けて打つほうが速い・店長判断 2026-08-04） -->
        <div class="bm-home-row">
          <div class="field">
            <label for="bmHomeAddress">住所</label>
            <input type="text" id="bmHomeAddress" placeholder="例: 立川市曙町1-1-1">
          </div>
          <div class="field">
            <label for="bmHomeBuilding">建物名・部屋番号・階数など</label>
            <input type="text" id="bmHomeBuilding" placeholder="例: ○○マンション 305号室">
          </div>
        </div>
        <!-- 打った住所をその場で地図で確かめられるように（店長要望 2026-08-09） -->
        <div id="bmHomeMapLinks" class="bm-hotel-addr" style="display:none;"></div>
        <!-- リピーターの「よく使う場所」を自動入力したときの案内（手入力したら消える） -->
        <span class="hint" id="bmUsualLocNote" style="display:none;color:#1d6b39;font-weight:600;margin-top:-.6rem;margin-bottom:1.1rem;"></span>
      </div>

      <!-- その他 -->
      <div class="loc-section" data-loc="other" style="display:none;">
        <div class="field">
          <label for="bmOtherLoc">場所の詳細</label>
          <textarea id="bmOtherLoc" placeholder="場所の詳細を自由に記入"></textarea>
        </div>
        <div id="bmOtherMapLinks" class="bm-hotel-addr" style="display:none;"></div>
      </div>

      </div><!-- /.bm-col 左（お客様・日時・場所） -->
      <div class="bm-col"><!-- 右（媒体・コース・料金） -->
      <!-- 流入媒体・予約経路。どれかにチェックが入ると＋10分(無料)（アドミの特典。既定は未チェック） -->
      <div class="field bm-media-field" id="bmMediaField">
        <label class="bm-media-label">媒体</label>
        <div class="bm-media-list">
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="fujoho"><span>情報局</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="ekichika"><span>駅ちか</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="heaven"><span>ヘブン</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="fuzoku"><span>風じゃ</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="deli"><span>デリじゃ</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="other"><span>その他</span></label>
          <!-- 2行目: LINE と ＋10分 を並べて中央に置く（店長要望 2026-08-08: 1行ぶんコンパクトに・中央揃え） -->
          <div class="bm-media-row2">
            <label class="bm-media is-line" title="チェックが入ると＋10分(無料)"><input type="checkbox" name="bmMedia" value="line"><span>LINE</span></label>
            <label id="bmPlus10Field" class="bm-plus10">
              <input type="checkbox" id="bmPlus10"><span>＋10分（無料）</span>
            </label>
          </div>
        </div>
        <span class="bm-plus10-note">媒体・LINEにチェックを入れると自動で付きます（媒体を見ていないお客様などは外せます）</span>
      </div>
      <label id="bmHotelFirstField" style="display:flex;align-items:center;gap:.5rem;padding:.4rem .7rem;background:linear-gradient(135deg,#eef4ff,#fff);border:1.5px solid #9db8e8;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#28468a;margin-top:.2rem;">
        <input type="checkbox" id="bmHotelFirst" style="width:18px;height:18px;cursor:pointer;">
        <span>🏨 ホテル料金 <b id="bmHotelFirstAmt"></b><span id="bmHotelFirstHint" style="font-weight:500;opacity:.8;"></span><span id="bmHotelFirstWarn" class="bm-hf-warn" style="display:none;"></span></span>
      </label>
      <div id="bmCourseNominationRow" style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field" id="bmCourseField"><label for="bmCourse">コース</label>
          <select id="bmCourse" class="bm-tight-select">
            <option value="">選択</option>
            <option value="60">60分コース</option>
            <option value="90">90分コース</option>
            <option value="120">120分コース</option>
          </select>
          <!-- 180分以上は単独コースが無く「90＋90」のように組み合わせる運用。2本目をここで選ぶ -->
          <select id="bmCourse2" class="bm-tight-select" style="margin-top:.4rem;">
            <option value="">＋ 組み合わせなし</option>
          </select>
          <span class="hint" id="bmComboNote" style="display:none;color:var(--sea);"></span>
        </div>
        <div class="field" id="bmNominationField">
          <label for="bmNomination">指名方法</label>
          <select id="bmNomination">
            <option value="">選択</option>
            <option value="first">初指名</option>
            <option value="regular">本指名</option>
            <option value="free">フリー</option>
          </select>
          <!-- 履歴から「そのキャストと初対面か」を見て、初指名/本指名の取り違えに気づけるようにする -->
          <span class="hint" id="bmNomHint" style="display:none;color:#8a5a12;font-weight:600;"></span>
          <!-- 左のコース欄（上＝基本コース／下＝組み合わせ）の金額をその場で読めるようにする -->
          <div class="bm-ccalc" id="bmCourseCalc" style="display:none;">
            <div id="bmCcRows"></div>
            <div class="bm-ccalc-r bm-ccalc-sum"><span>計</span><b id="bmCcTotal">—</b></div>
          </div>
        </div>
      </div>
      <div class="field" id="bmBreakDurField" style="display:none;"><label for="bmBreakDur">休憩時間</label>
        <select id="bmBreakDur">
          <option value="">選択</option>
          <option value="30">30分</option>
          <option value="60">60分</option>
          <option value="90">90分</option>
          <option value="120">120分</option>
          <option value="custom">カスタム</option>
        </select>
        <div id="bmBreakCustomMinWrap" style="display:none;margin-top:.5rem;">
          <input type="number" id="bmBreakCustomMin" min="5" max="600" step="5" placeholder="休憩分数を入力" style="width:12em;">
          <span class="hint" style="margin-top:.3rem;">5分単位 / カスタムの場合のみ</span>
        </div>
      </div>
      <!-- オプション（ローター・バイブ等）。選ぶと合計に加算される。マスタは「マスタ」タブで編集。
           注文は稀なので普段は畳んでおく。選ばれていれば開いた状態で出す（店長要望 2026-08-09） -->
      <details class="field bm-opt-field bm-opt-acc" id="bmOptionField">
        <summary>OP<span class="bm-media-note" id="bmOptionSum"></span></summary>
        <div class="bm-media-list bm-opt-list" id="bmOptionList"><span class="hint">オプションが登録されていません（マスタタブで追加できます）</span></div>
      </details>

      <!-- 「延長30分 ✕ 0」で内容が分かるので見出しは置かない（コンパクト化・店長指定 2026-08-06） -->
      <div class="field" id="bmExtField">
        <div class="bm-ext-row">
          <span class="bm-ext-label">延長30分 ✕</span>
          <select id="bmExtCount" style="max-width:6em;">
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
            <option value="8">8</option>
            <option value="9">9</option>
            <option value="10">10</option>
          </select>
          <span class="hint bm-ext-info" id="bmExtInfo"></span>
          <!-- 貸出品は回収忘れが困るので、延長の右の空きに置いて必ず目に入るようにする（店長要望 2026-08-16）。
               チェックと状態は1組で折り返す（バラバラに崩れて読みづらかった・店長指摘 2026-08-18） -->
          <span class="bm-lend-group">
            <label class="bm-towel" id="bmTowelWrap" title="バスタオルを貸し出す（回収忘れ防止）">
              <input type="checkbox" id="bmTowelLent"> 🛁 バスタオル貸出
            </label>
            <button type="button" class="bm-lend-state" id="bmLendState"></button>
          </span>
        </div>
      </div>
      <!-- コース料金 | 指名料 | 交通費 の3列。お客様への最終確認で内訳をそのまま読み上げられるように
           指名料も並べる（店長要望 2026-08-08）。指名料は指名方法に連動する自動表示で、直接は編集しない -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.7rem;">
        <div class="field"><label for="bmPrice">コース料金(円)</label><input type="text" inputmode="numeric" data-money id="bmPrice"></div>
        <div class="field"><label for="bmNominationFeeView">指名料(円)</label>
          <input type="text" id="bmNominationFeeView" readonly tabindex="-1"
                 style="background:var(--foam);color:var(--deep);font-weight:700;cursor:default;"
                 title="指名方法に応じて自動で決まります（マスタで金額を変更できます）">
        </div>
        <div class="field"><label for="bmTransport">交通費(円)</label>
          <select id="bmTransport"><option value="0">なし(¥0)</option><option value="1100">¥1,100</option><option value="1650">¥1,650</option><option value="2200">¥2,200</option><option value="2750">¥2,750</option><option value="3300">¥3,300</option><option value="3850">¥3,850</option><option value="4400">¥4,400</option><option value="4950">¥4,950</option><option value="5500">¥5,500</option><option value="6050">¥6,050</option><option value="6600">¥6,600</option><option value="7150">¥7,150</option><option value="7700">¥7,700</option><option value="8250">¥8,250</option><option value="8800">¥8,800</option><option value="9350">¥9,350</option><option value="9900">¥9,900</option><option value="10450">¥10,450</option><option value="11000">¥11,000</option></select>
        </div>
      </div>
      <!-- 以前ご案内した交通費と違うときの注意。狭い列に入れると3行に折れるので、
           コース料金〜交通費の行の下に1行で出す（店長指定 2026-08-25） -->
      <p class="bm-fee-hint" id="bmFeeHint" style="display:none;"></p>
      <div class="field" id="bmBreakCityField" style="display:none;"><label for="bmBreakCity">エリア (公開タイムライン表示用)</label>
        <input type="text" id="bmBreakCity" placeholder="立川市" autocomplete="off" style="width:14em;">
        <span class="hint" style="margin-top:.3rem;">未入力なら「立川」と表示されます。例: 八王子市 → 八王子</span>
      </div>
      <!-- キャンペーン割引 — チェックでコース料金 10%OFF -->
      <label id="bmCampaignField" style="display:none;align-items:center;gap:.5rem;padding:.6rem .8rem;background:linear-gradient(135deg,#ffeef0,#fff);border:1.5px solid #f0a0ad;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#a82a44;margin-top:-.2rem;">
        <input type="checkbox" id="bmCampaign" style="width:18px;height:18px;cursor:pointer;">
        <span>🎁 キャンペーン割引 <b>コース料金 10%OFF</b> <span id="bmCampaignAmt" style="font-weight:500;opacity:.8;"></span></span>
      </label>
      <!-- ホテル料金 — ホテル利用×そのキャストと初対面で、コース管理の「ホテル料金」に置き換える。
           組み合わせは一番長い1本だけ。ホテル料金を設定していないコース（お泊り等）は対象外。
           担当・訪問先・お客様が決まると自動でチェックが入る（手で触ったら以後は自動で動かさない） -->
      <!-- スタンプ特典 — コース料金(キャンペーン割引後)から特典時間ぶんを按分割引。特典時間≥コース時間なら全額無料 -->
      <!-- スタンプ特典 | 深夜料金 を横並び2列に（店長要望 2026-08-08: 横幅を半分ずつ） -->
      <div id="bmStampLateRow" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:-.2rem;">
      <div id="bmStampField" style="display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem;min-width:0;background:linear-gradient(135deg,#fff0f6,#fff);border:1.5px solid #e7a6c4;border-radius:8px;font-size:.88rem;font-weight:600;color:#9a3a6a;flex-wrap:nowrap;">
        <span style="white-space:nowrap;">🎟️ スタンプ</span>
        <select id="bmStampReward" style="flex:1;min-width:0;font-size:.85rem;padding:.25rem .4rem;border-radius:6px;border:1px solid #e7a6c4;background:#fff;color:#9a3a6a;font-weight:600;cursor:pointer;">
          <option value="">なし</option>
          <option value="30">30分</option>
          <option value="60">60分</option>
          <option value="90">90分</option>
        </select>
        <span id="bmStampAmt" style="font-weight:500;opacity:.85;white-space:nowrap;"></span>
      </div>
      <!-- 深夜料金 (23:00〜翌5:00) — チェックで合計に +¥3,300 -->
      <label id="bmLateNightField" style="display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem;min-width:0;background:linear-gradient(135deg,#fff5e8,#fff);border:1.5px solid #f0c98e;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#7a4a00;flex-wrap:nowrap;">
        <input type="checkbox" id="bmLateNight" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
        <span style="white-space:nowrap;" title="23:00〜翌5:00">🌙 深夜 <b>+¥3,300</b></span>
      </label>
      </div>
      <div class="field" id="bmPaymentField">
        <label>支払方法</label>
        <input type="hidden" id="bmPayment" data-pay-hidden value="cash">
        <div class="em-status bm-pay-row" style="grid-template-columns:1fr 1fr 1.35fr .7fr .7fr;">
          <button class="sbtn v-unset active" data-pay-btn data-pay="cash" type="button">💴 現金</button>
          <button class="sbtn v-unset" data-pay-btn data-pay="credit" type="button">💳 クレジット</button>
          <!-- 稀に現金とカードを分けて払うお客様がいる（店長要望 2026-08-08） -->
          <button class="sbtn v-unset" data-pay-btn data-pay="split" type="button">🧾 現金＋クレジット</button>
          <button class="sbtn v-unset bm-pay-rare" data-pay-btn data-pay="bank" type="button">🏦 振込</button>
          <button class="sbtn v-unset bm-pay-rare" data-pay-btn data-pay="" type="button">未設定</button>
        </div>
        <!-- 併用のときだけ出る。現金で受け取る額を入れると、残りが自動でクレジットになる -->
        <div class="bm-split" id="bmSplitWrap" style="display:none;">
          <label for="bmCashAmount">現金で受け取る額</label>
          <input type="text" inputmode="numeric" data-money id="bmCashAmount" placeholder="例 10000">
          <span>円</span>
          <div class="bm-split-note" id="bmSplitNote"></div>
        </div>
        <!-- 稀に決済が通らないことがあるため、通ったかどうかを1件ずつ記録する -->
        <label class="bm-card-paid" id="bmCardPaidWrap" style="display:none;">
          <input type="checkbox" id="bmCardPaid">
          <span>✅ 決済を確認した</span>
          <span class="bm-card-paid-at" id="bmCardPaidAt"></span>
        </label>
      </div>
      <!-- 微調整用の手入力オーバーライド（空欄なら従来通り自動計算。入力すると合計・報酬をその値に置き換える） -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="bmDepositOverride">預り金(手入力・自動計算を上書き)</label><input type="text" inputmode="numeric" data-money id="bmDepositOverride" placeholder="空欄なら自動計算"></div>
        <div class="field"><label for="bmRewardOverride">報酬(手入力・自動計算を上書き)</label><input type="text" inputmode="numeric" data-money id="bmRewardOverride" placeholder="空欄なら自動計算"></div>
      </div>
      <!-- 合計 (コース料金 + 交通費 + 深夜料金) — 自動計算。預り金の手入力があればそちらを優先表示 -->
      <div id="bmTotalRow" style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.7rem 1rem;background:linear-gradient(135deg,var(--foam),#fff);border:1.5px solid var(--aqua-light);border-radius:10px;margin-top:-.2rem;">
        <span style="font-weight:700;color:var(--deep);font-size:.95rem;">💰 合計</span>
        <span id="bmTotal" style="font-family:'Outfit',sans-serif;font-weight:700;font-size:1.2rem;color:var(--deep);">¥0</span>
      </div>
      <div id="bmCardFeeNote" class="bm-card-fee" style="display:none;"></div>
      <div id="bmCancelNote" style="display:none;font-size:.78rem;font-weight:700;margin-top:.35rem;text-align:right;"></div>
      <!-- キャンセル時のみ -->
      <div class="field" id="bmCancelWrap" style="display:none;">
        <!-- 理由はステータス欄で選ぶ（店長指定 2026-08-15）。この select は保存値の保持用に残し、画面には出さない -->
        <label for="bmCancelType" style="display:none;">キャンセル理由</label>
        <select id="bmCancelType" style="display:none;">
          <option value="customer">お客様都合</option>
          <option value="shop">店都合</option>
          <option value="therapist">キャスト都合</option>
          <option value="other">その他</option>
        </select>
        <textarea id="bmCancelReason" placeholder="詳細(任意)" style="margin-top:.4rem;"></textarea>
        <div style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:120px;">
            <label for="bmCancelFee" style="font-size:.78rem;">キャンセル料（円）</label>
            <input type="text" inputmode="numeric" data-money placeholder="例: 9900" style="width:100%;box-sizing:border-box;"id="bmCancelFee">
          </div>
          <div style="flex:1;min-width:120px;">
            <label for="bmCancelReward" style="font-size:.78rem;">うちキャスト報酬（円）</label>
            <input type="text" inputmode="numeric" data-money placeholder="例: 4950" style="width:100%;box-sizing:border-box;"id="bmCancelReward">
          </div>
        </div>
        <div style="font-size:.74rem;color:var(--ink-soft);margin-top:.3rem;">※「お客様都合」のときのみ売上・報酬に計上されます（他の理由は計上しません）</div>
      </div>
      <!-- 事前予約のときだけ出す「お約束の連絡」。①出勤確認が取れたら連絡 ②到着見込みを連絡（店長要望 2026-08-10） -->
      <div class="field bm-prep" id="bmPreWrap" style="display:none;">
        <label>📞 事前予約のお約束</label>
        <div class="bm-prep-line">
          <span class="bm-prep-lbl">連絡手段</span>
          <button type="button" class="bm-prep-m" data-prep-method="tel">☎ 電話</button>
          <button type="button" class="bm-prep-m" data-prep-method="line">💬 LINE</button>
          <input type="hidden" id="bmPreMethod" value="">
        </div>
        <div class="bm-prep-line">
          <span class="bm-prep-lbl">内容</span>
          <button type="button" class="bm-prep-k" data-prep-kind="confirm">出勤確認が取れたら連絡</button>
          <button type="button" class="bm-prep-k" data-prep-kind="eta">到着見込みの時刻を連絡</button>
          <input type="hidden" id="bmPreKind" value="">
        </div>
        <div class="bm-prep-line">
          <span class="bm-prep-lbl">連絡する時刻</span>
          <select id="bmPreDueH" class="bm-prep-sel" title="時"><option value="">--</option><?php for ($h = 0; $h < 24; $h++) printf('<option value="%02d">%d</option>', $h, $h); ?></select>
          <span class="bm-prep-colon">:</span>
          <select id="bmPreDueM" class="bm-prep-sel" title="分"><option value="">--</option><?php for ($m = 0; $m < 60; $m += 5) printf('<option value="%02d">%02d</option>', $m, $m); ?></select>
        </div>
      </div>
      <div class="field"><label for="bmNotes">この予約のメモ <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">キャスト・ドライバーへ</span></label><textarea id="bmNotes" placeholder="キャストやドライバーに伝えたいこと（この予約かぎり）"></textarea></div>
      <div class="field bm-customer-only bm-mail-row">
        <div class="bm-mail-input">
          <label for="bmCustomerEmail">メール(任意)</label>
          <input type="email" id="bmCustomerEmail" placeholder="example@gmail.com">
        </div>
        <!-- 領収証が必要なお客様。押すとタイムラインで🧾が点滅し、渡し忘れを防ぐ（店長要望 2026-08-23） -->
        <div class="bm-receipt-wrap">
          <label class="bm-receipt-spacer" aria-hidden="true">&nbsp;</label><!-- メール欄と高さを揃えるための空ラベル -->
          <button type="button" id="bmReceiptBtn" class="bm-receipt-btn" aria-pressed="false"
            title="領収証が必要なお客様。タイムラインで🧾が点滅します">🧾 領収証が必要</button>
          <input type="hidden" id="bmReceiptNeeded" value="0">
        </div>
      </div>
      </div><!-- /.bm-col 右 -->
      </div><!-- /.bm-cols -->
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="bmDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <!-- コピーボタンだと分かるよう、四角が重なった定番のコピーアイコンを付ける（店長要望 2026-08-10） -->
      <button class="btn-secondary bm-copy-btn" id="bmCopyText" type="button" title="スタッフ用: 電話・送迎・メモ等も含む詳細をコピー">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>スタッフ用</button>
      <button class="btn-secondary bm-copy-btn bm-copy-cust" id="bmCopyCustomerText" type="button" title="お客様送信用: 予約確認の文面をコピー">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>お客様用</button>
      <button class="btn-secondary" data-close="bookingModal">閉じる</button>
      <button class="btn-primary" id="bmSave">保存</button>
    </div>
    <!-- 予約内容サマリーバー（モーダル下端に固定・入力に連動して自動更新） -->
    <div id="bmFooterSummary" class="bm-summary-bar">
      <span id="bmSummaryMain" class="bm-sum-main"></span>
      <span id="bmSummaryTotal" class="bm-sum-total"></span>
      <!-- 下まで送らなくても保存できるように、この帯にも保存を置く（店長要望 2026-08-25） -->
      <button type="button" class="btn-primary bm-sum-save" id="bmSaveMini">保存</button>
    </div>
  </div>
</div>

<!-- ========== 旧システムの利用履歴 詳細（読み取り専用） モーダル ==========
     旧履歴は編集できないデータなので、予約編集ページと同じ見た目で中身だけ見せる -->
<div class="modal-overlay" id="legacyDetailModal">
  <div class="modal" style="max-width:560px;">
    <div class="modal-header">
      <div><div class="mh-title">📋 ご利用内容 <span class="ht-old">旧</span></div><div class="mh-sub" id="lgSub"></div></div>
      <button class="modal-close" data-close="legacyDetailModal">×</button>
    </div>
    <div class="modal-body" id="lgBody"></div>
    <div class="modal-footer">
      <span class="lg-note">旧システムから取り込んだ記録のため編集できません</span>
      <button class="btn-secondary" data-close="legacyDetailModal">閉じる</button>
    </div>
  </div>
</div>

<!-- ========== オーダー詳細（キャスト用） モーダル ========== -->
<div class="modal-overlay" id="orderDetailModal">
  <div class="modal" style="max-width:520px;">
    <div class="modal-header">
      <div><div class="mh-title">📋 オーダー詳細</div><div class="mh-sub" id="odSub"></div></div>
      <button class="modal-close" data-close="orderDetailModal">×</button>
    </div>
    <div class="modal-body">
      <div class="od-row"><div class="od-label">日時</div><div class="od-value" id="odDateTime"></div></div>
      <div class="od-row"><div class="od-label">コース</div><div class="od-value" id="odCourse"></div></div>
      <div class="od-row"><div class="od-label">料金</div><div class="od-value" id="odPrice"></div></div>
      <div class="od-row"><div class="od-label">交通費</div><div class="od-value" id="odTransport"></div></div>
      <hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">
      <div class="od-row"><div class="od-label">顧客名</div><div class="od-value" id="odCustomerName"></div></div>
      <div class="od-row" id="odPhoneRow"><div class="od-label">電話</div><div class="od-value" id="odCustomerPhone"></div></div>
      <hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">
      <div class="od-row"><div class="od-label">訪問先</div><div class="od-value" id="odLocation"></div></div>
      <div class="od-row" id="odRoomRow" style="display:none;"><div class="od-label">部屋番号</div><div class="od-value" id="odRoom"></div></div>
      <hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">
      <div class="od-row" style="gap:1.6rem;flex-wrap:wrap;">
        <span style="white-space:nowrap;font-size:.9rem;">🚗 行き　<b id="odGo" style="font-weight:600;"></b></span>
        <span style="white-space:nowrap;font-size:.9rem;">🚙 帰り　<b id="odBack" style="font-weight:600;"></b></span>
      </div>
      <hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">
      <div class="od-row" style="flex-direction:column;align-items:stretch;gap:.4rem;">
        <div class="od-label">お仕事メモ</div>
        <textarea id="odNoteEdit" rows="3" placeholder="お客様の好み・申し送りなどを記録（この予約に保存されます）" style="width:100%;box-sizing:border-box;"></textarea>
      </div>
      <!-- キャスト個別のお客様メモ。予約単位ではなくお客様に紐づく自分専用メモ（他のキャストからは見えない） -->
      <div class="od-row" id="odCastNoteRow" style="display:none;flex-direction:column;align-items:stretch;gap:.4rem;">
        <div class="od-label">🗒 私のお客様メモ <span style="font-weight:500;font-size:.7rem;color:var(--ink-soft);">このお客様についての自分専用メモ（他のキャストには見えません）</span></div>
        <textarea id="odCastNote" rows="2" placeholder="例: 会話は控えめが好み / 猫を飼っている" style="width:100%;box-sizing:border-box;"></textarea>
        <button class="btn-secondary" type="button" id="odCastNoteSave" style="align-self:flex-end;font-size:.8rem;">メモを保存</button>
      </div>
      <div class="od-row" style="margin-top:.7rem;"><div class="od-label">ステータス</div><div class="od-value" id="odStatus"></div></div>
      <hr style="border:0;border-top:1px solid var(--gray);margin:.7rem 0;">
      <div class="od-row" style="flex-direction:column;align-items:stretch;gap:.5rem;">
        <div class="od-label">カウンセリングシート</div>
        <div id="odSheetPreview" style="display:none;">
          <a id="odSheetLink" href="#" target="_blank" rel="noopener">
            <img id="odSheetImg" src="" alt="カウンセリングシート" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--gray);display:block;">
          </a>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <input type="file" id="odSheetFile" accept="image/*" style="display:none;">
          <button class="btn-secondary" type="button" id="odSheetUploadBtn" style="font-size:.82rem;">📷 画像を選択</button>
          <span id="odSheetFileName" style="font-size:.8rem;color:var(--ink-soft);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">未選択</span>
        </div>
        <button class="btn-primary" type="button" id="odSheetSave" style="font-size:.82rem;display:none;">⬆ アップロード</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="odCopyText" type="button" style="margin-right:auto;">📋 テキストコピー</button>
      <button class="btn-secondary" data-close="orderDetailModal">閉じる</button>
      <button class="btn-primary" id="odSaveNote" type="button">💾 メモを保存</button>
      <button class="btn-primary" id="odComplete" style="display:none;">✓ 接客完了にする</button>
    </div>
  </div>
</div>

<!-- ========== 顧客 モーダル ========== -->
<div class="modal-overlay" id="customerModal">
  <div class="modal" style="max-width:560px;">
    <div class="modal-header">
      <div><div class="mh-title" id="cmTitle">新規顧客</div></div>
      <button class="modal-close" data-close="customerModal">×</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="cmName">お名前</label><input type="text" id="cmName"></div>
        <div class="field"><label for="cmKana">カナ</label><input type="text" id="cmKana" placeholder="ヤマダ タロウ"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="cmPhone">電話番号</label><input type="text" id="cmPhone"></div>
        <div class="field"><label for="cmPhone2">電話番号 2（2台持ちの方）</label><input type="text" id="cmPhone2" placeholder="任意"></div>
      </div>
      <div class="field"><label for="cmEmail">メール</label><input type="text" id="cmEmail"></div>
      <div class="field"><label for="cmGender">性別</label>
        <select id="cmGender"><option value="">未設定</option><option value="male">男性</option><option value="female">女性</option><option value="other">その他</option></select>
      </div>
      <div class="field"><label for="cmLocation">よく使う場所</label><input type="text" id="cmLocation" placeholder="例: 立川駅前のホテル○○"></div>
      <div class="field"><label for="cmLocation2">よく使う場所 2</label><input type="text" id="cmLocation2" placeholder="任意（自宅とセカンドハウスなど）"></div>
      <div class="field cm-reports" id="cmReports"></div>
      <div class="field"><label for="cmNotes">お客様メモ <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">キャストには伝えない</span></label><textarea id="cmNotes" placeholder="苦手なプレイ、好み、注意点など（このお客様にずっと付くメモ）"></textarea></div>
      <!-- NG登録: 予約を取る瞬間に赤帯で出るので、メモに文章で書くより先にこちらへ -->
      <div class="ng-box" id="cmNgBox">
        <div class="field">
          <label for="cmNgLevel">NG登録</label>
          <select id="cmNgLevel">
            <option value="0">通常のお客様</option>
            <option value="1">要注意（受けるが気をつける）</option>
            <option value="2">出禁（お店として受けない）</option>
          </select>
        </div>
        <div class="field" id="cmNgReasonField" style="display:none;">
          <label for="cmNgReason">理由 <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">予約のときに一緒に出ます</span></label>
          <input type="text" id="cmNgReason" placeholder="例: キャンセル料未払・無理やり脱がす行為">
        </div>
        <div class="field">
          <label>NGキャスト <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">このお客様に出さない女性</span></label>
          <div id="cmNgCastList" class="ng-cast-list"></div>
          <select id="cmNgCastAdd"><option value="">＋ キャストを追加</option></select>
        </div>
      </div>
      <!-- 誓約書 アップロード -->
      <div class="field" id="cmPledgeField">
        <label>誓約書</label>
        <div id="cmPledgeList" style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.6rem;"></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
          <label class="cm-pledge-cam" for="cmPledgeCam" style="display:inline-flex;align-items:center;gap:.4rem;background:var(--coral);color:#fff;padding:.6rem 1.1rem;border-radius:50px;font-weight:600;font-size:.86rem;cursor:pointer;">📷 写真を撮影</label>
          <input type="file" id="cmPledgeCam" accept="image/*" capture="environment" style="display:none;">
          <label class="cm-pledge-file" for="cmPledgeFile" style="display:inline-flex;align-items:center;gap:.4rem;background:var(--sea);color:#fff;padding:.6rem 1.1rem;border-radius:50px;font-weight:600;font-size:.86rem;cursor:pointer;">📁 ファイルから選択</label>
          <input type="file" id="cmPledgeFile" accept="image/*" style="display:none;">
        </div>
        <span class="hint" style="display:block;margin-top:.4rem;font-size:.78rem;color:var(--ink-soft);">JPEG/PNG、自動的に最大1600px長辺へ縮小して保存します</span>
      </div>
      <div id="cmMemberWrap" style="margin-top:1rem;display:none;">
        <label style="display:block;font-weight:700;color:var(--deep);font-size:.88rem;margin-bottom:.35rem;">🎫 会員証（スタンプカード）URL</label>
        <div id="cmMemberRow" style="display:none;gap:.4rem;">
          <input type="text" id="cmMemberUrl" readonly style="flex:1;font-size:.82rem;padding:.55rem .6rem;border:1px solid var(--gray);border-radius:8px;background:var(--foam,#f4f9fa);color:var(--deep);" value="">
          <button type="button" id="cmMemberCopy" class="btn-secondary" style="white-space:nowrap;color:var(--sea);border-color:var(--sea);">📋 コピー</button>
        </div>
        <button type="button" id="cmMemberBtn" class="btn-secondary" style="width:100%;color:var(--sea);border-color:var(--sea);">🎫 会員証URLを発行</button>
        <span class="hint" style="display:block;margin-top:.4rem;font-size:.78rem;color:var(--ink-soft);">お客様にLINE等で送ると、スタンプ状況をご覧いただけます</span>
      </div>
      <div id="cmHistory" style="margin-top:1rem;display:none;">
        <h2 style="font-size:.95rem;color:var(--deep);font-weight:700;margin-bottom:.5rem;">過去のご利用</h2>
        <div id="cmHistoryList" style="font-size:.85rem;color:var(--ink-soft);"></div>
      </div>
      <!-- キャストがそれぞれ書いた自分用のお客様メモ。内勤スタッフ以上のみ閲覧（キャスト同士は見えない） -->
      <div id="cmCastNotes" style="margin-top:1rem;display:none;">
        <h2 style="font-size:.95rem;color:var(--deep);font-weight:700;margin-bottom:.5rem;">🗒 キャストのお客様メモ</h2>
        <div id="cmCastNotesList" style="font-size:.85rem;color:var(--ink-soft);"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="cmDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" data-close="customerModal">キャンセル</button>
      <button class="btn-primary" id="cmSave">保存</button>
    </div>
  </div>
</div>

<!-- ========== 定型文 管理 モーダル ========== -->
<div class="modal-overlay" id="chatTplModal">
  <div class="modal" style="max-width:560px;">
    <div class="modal-header">
      <div><div class="mh-title">📋 定型文の管理</div><div class="mh-sub">チャット返信でよく使う文章を登録できます（この端末に保存）</div></div>
    </div>
    <div class="modal-body">
      <div id="ctEditList" style="margin-bottom:1rem;"></div>
      <div class="field">
        <label>タイトル（一覧に表示される短い名前）</label>
        <input type="text" id="ctTitle" placeholder="例: ご挨拶 / 予約確定">
      </div>
      <div class="field">
        <label>本文</label>
        <textarea id="ctBody" rows="4" placeholder="チャットに挿入される文章を入力"></textarea>
        <input type="hidden" id="ctEditId" value="">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="chatTplModal">閉じる</button>
      <button class="btn-primary" id="ctSave">＋ 追加する</button>
    </div>
  </div>
</div>

<!-- ========== シフト モーダル ========== -->
<div class="modal-overlay" id="shiftModal">
  <div class="modal" style="max-width:480px;">
    <div class="modal-header">
      <div><div class="mh-title" id="smTitle">シフト登録</div><div class="mh-sub" id="smSub"></div></div>
      <button class="modal-close" data-close="shiftModal">×</button>
    </div>
    <div class="modal-body">
      <!-- 内勤スタッフ以上なら他人のシフトも組めるので owner 限定にしない（表示は openShiftModal が制御） -->
      <div class="field" id="smStaffField" style="display:none;">
        <label for="smStaff">対象スタッフ</label>
        <select id="smStaff"></select>
      </div>
      <!-- よく使う時間はチェックだけで入る（店長要望 2026-08-25）。どれかを選ぶと状態も「出勤」になる -->
      <div class="sm-presets">
        <label><input type="checkbox" id="sm24h"> 24時間（10:00〜翌10:00）</label>
        <label title="10:00〜19:00"><input type="checkbox" id="smEarly"> 早番</label>
        <label title="19:00〜翌10:00"><input type="checkbox" id="smLate"> 遅番</label>
      </div>
      <div id="smTimeRow" style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="smStartH">開始時刻</label>
          <div class="time-input" style="display:flex;gap:.3rem;align-items:center;">
            <select id="smStartH" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">時</span>
            <select id="smStartM" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">分</span>
          </div>
        </div>
        <div class="field"><label for="smEndMode">終了時刻</label>
          <select id="smEndMode" style="margin-bottom:.4rem;padding:.4rem;border:1.5px solid var(--gray);border-radius:8px;font-family:inherit;font-weight:600;">
            <option value="time">時刻を指定</option>
            <option value="undecided">未定</option>
            <option value="last">ラスト</option>
          </select>
          <div class="time-input" id="smEndTimeWrap">
            <select id="smEndH" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">時</span>
            <select id="smEndM" class="bm-time-select" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">分</span>
          </div>
        </div>
      </div>
      <div class="field"><label for="smStatus">状態</label>
        <select id="smStatus">
          <option value="undecided">未定</option>
          <option value="available">出勤</option>
          <option value="tentative">仮（要調整）</option>
          <option value="off">休み</option>
        </select>
        <span class="hint">未定は登録しません（カレンダーにも出ません）。既に入っていれば消えます。</span>
      </div>
      <div class="field"><label for="smNote">メモ</label><textarea id="smNote"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="smDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" data-close="shiftModal">キャンセル</button>
      <button class="btn-primary" id="smSave">保存</button>
    </div>
  </div>
</div>

<!-- ホテル管理 ビュー -->
<div class="view" id="view-hotel">
<div style="padding:.2rem 0 .6rem;"><button class="btn-secondary" id="hotelBackToMaster" type="button" style="padding:.45rem .9rem;font-size:.88rem;">← マスタへ戻る</button></div>

<section class="stats">
  <div class="stats-inner">
    <div class="stat"><div class="num visited" id="statVisited">-</div><div class="lbl">実績あり</div></div>
    <div class="stat"><div class="num inquiry" id="statInquiry">-</div><div class="lbl">要問合せ</div></div>
    <div class="stat"><div class="num unavailable" id="statUnavailable">-</div><div class="lbl">不可</div></div>
    <div class="stat"><div class="num unset" id="statUnset">-</div><div class="lbl">未設定</div></div>
    <div class="stat"><div class="num" id="statTotal">-</div><div class="lbl">合計</div></div>
  </div>
</section>

<section class="filter-bar">
  <div class="filter-inner">
    <!-- タイプ絞り込み・並び替え（店長要望 2026-08-08） -->
    <select id="fHotelType">
      <option value="">タイプ: すべて</option>
      <option value="loveho">ラブホ</option>
      <option value="hotel">ホテル</option>
    </select>
    <select id="fCity"><option value="">全市区町村</option></select>
    <select id="fStatus">
      <option value="">ステータス: すべて</option>
      <option value="visited">実績あり</option>
      <option value="inquiry">要問合せ</option>
      <option value="unavailable">不可</option>
      <option value="unset">未設定</option>
    </select>
    <!-- 既定は名前順（あいうえお順）。ホテルは名前で探すので実績優先だと見つけにくい（店長要望 2026-08-10） -->
    <select id="fSort">
      <option value="name">並び順: あいうえお順</option>
      <option value="">実績優先</option>
      <option value="city">市区町村順</option>
      <option value="visited">案内実績が多い順</option>
      <option value="manual">自分の順番（ドラッグ）</option>
    </select>
    <input type="search" id="fKeyword" placeholder="ホテル名・住所で検索" enterkeyhint="search">
    <div class="reset-wrap"><button class="btn-reset" id="btnReset">クリア</button></div>
  </div>
</section>

<div class="bulk-bar" id="bulkBar">
  <div class="bulk-inner">
    <div class="bulk-info"><b id="bulkCount">0</b>件選択中</div>
    <div class="bulk-actions">
      <button class="btn-bulk-visited" data-bulk="visited">実績あり</button>
      <button class="btn-bulk-inquiry" data-bulk="inquiry">要問合せ</button>
      <button class="btn-bulk-unavailable" data-bulk="unavailable">不可</button>
      <button class="btn-bulk-unset" data-bulk="unset">未設定</button>
      <span class="bulk-sep"></span>
      <!-- 交通費の一括設定。予約モーダル・編集モーダルと同じ ¥1,100〜550円刻み（店長要望 2026-08-07 / ¥550 は廃止 2026-08-08） -->
      <select id="bulkFeeSelect" class="bulk-fee-select">
        <option value="">交通費を選択</option>
        <option value="unset">— 未設定に戻す —</option>
        <option value="0">🆓 無料（¥0）</option>
        <option value="1100">¥1,100</option><option value="1650">¥1,650</option><option value="2200">¥2,200</option><option value="2750">¥2,750</option><option value="3300">¥3,300</option><option value="3850">¥3,850</option><option value="4400">¥4,400</option><option value="4950">¥4,950</option><option value="5500">¥5,500</option><option value="6050">¥6,050</option><option value="6600">¥6,600</option><option value="7150">¥7,150</option><option value="7700">¥7,700</option><option value="8250">¥8,250</option><option value="8800">¥8,800</option><option value="9350">¥9,350</option><option value="9900">¥9,900</option><option value="10450">¥10,450</option><option value="11000">¥11,000</option>
      </select>
      <button class="btn-bulk-fee" id="btnBulkFee" disabled>交通費を設定</button>
      <button class="btn-bulk-delete" id="btnBulkDelete">リストから削除</button>
      <button class="btn-bulk-clear" id="btnBulkClear">選択解除</button>
    </div>
  </div>
</div>

<main class="main">
  <div class="results-bar">
    <!-- 今の絞り込み結果を丸ごとチェックする（一括設定・一括削除の対象を素早く選ぶため） -->
    <label class="select-all-wrap"><input type="checkbox" id="selectAllHotels"><span>全て選択</span></label>
    <div class="count"><b id="resultCount">0</b>件のホテル</div>
    <div class="count" id="filterNote"></div>
    <button id="btnHotelAdd" class="btn-edit" style="margin-left:auto;">＋ ホテルを追加</button>
  </div>
  <div id="hotelList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
</main>

</div>
<!-- /view-hotel -->

<!-- 🏠 自宅の交通費 ビュー（マスタ内から開く。店長要望 2026-08-08: 町名一覧を見ながら設定） -->
<div class="view" id="view-cityfee">
  <div style="padding:.2rem 0 .6rem;"><button class="btn-secondary" id="cityFeeBackToMaster" type="button" style="padding:.45rem .9rem;font-size:.88rem;">← マスタへ戻る</button></div>
  <div class="tl-toolbar">
    <div class="tl-title">🏠 自宅の交通費<span class="tl-sub">まず市区町村（全域）で一括 → 変えたい町だけ選び直す。予約の自宅で市区町村・町名を選ぶとこの金額が入ります</span></div>
  </div>
  <div class="staff-main" style="max-width:1000px;">
    <!-- エリアタブは予約モーダルと同じ4区分（メイン=多摩／23区／埼玉／神奈川） -->
    <div style="display:flex;gap:.3rem;background:var(--foam);padding:.4rem;border-radius:10px;max-width:460px;" id="cfRegionTabs">
      <label class="loc-tab"><input type="radio" name="cfRegion" value="main" checked><span>メイン</span></label>
      <label class="loc-tab"><input type="radio" name="cfRegion" value="tokyo23"><span>23区</span></label>
      <label class="loc-tab"><input type="radio" name="cfRegion" value="saitama"><span>埼玉</span></label>
      <label class="loc-tab"><input type="radio" name="cfRegion" value="kanagawa"><span>神奈川</span></label>
    </div>
    <div id="cfCityChips" style="display:flex;flex-wrap:wrap;gap:.4rem;margin:.9rem 0;"></div>
    <div id="cfTownPanel"></div>
  </div>
</div>
<!-- /view-cityfee -->

<!-- 🚉 駅マスタ ビュー（マスタ内から開く） -->
<!-- 📦 備品ビュー: 事務所にある数と、誰に貸しているかを常に見えるようにする。
     黙って無くなるのを防ぐのが目的なので、貸出中は必ず「誰が・いつから」を出す（店長要望 2026-08-16） -->
<div class="view" id="view-supplies">
  <div class="tl-toolbar">
    <div class="tl-title">📦 備品<span class="tl-sub">事務所の数と貸出中。お仕事セットは1人1セット、その他は都度貸出</span></div>
    <button type="button" class="tl-reload" id="supReload" title="読み直す">⟳ 更新</button>
  </div>
  <div class="staff-main" style="max-width:1000px;">
    <div class="sup-lend">
      <div class="sup-lend-head">貸し出す</div>
      <div class="sup-lend-row">
        <select id="supUserCast" title="キャストから選ぶ"></select>
        <select id="supUserStaff" title="スタッフから選ぶ"></select>
        <button type="button" class="btn-primary" id="supLendSet">🧰 お仕事セットを貸す</button>
      </div>
      <div class="sup-lend-row">
        <select id="supItem"></select>
        <select id="supQty"></select>
        <button type="button" class="btn-secondary" id="supLendOne">この備品を貸す</button>
      </div>
      <div class="sup-lend-msg" id="supMsg"></div>
    </div>
    <div id="supStock"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
    <div id="supLoans"></div>
  </div>
</div>
<!-- /view-supplies -->

<div class="view" id="view-stations">
  <div style="padding:.2rem 0 .6rem;"><button class="btn-secondary" id="stationBackToMaster" type="button" style="padding:.45rem .9rem;font-size:.88rem;">← マスタへ戻る</button></div>
  <div class="tl-toolbar">
    <div class="tl-title">🚉 駅マスタ・基本交通費<span class="tl-sub">立川から往復運賃の安い順。各駅の基本交通費を設定（交通費シミュレーション用）</span></div>
  </div>
  <div class="staff-main" style="max-width:900px;">
    <div id="stationList" class="bk-list"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </div>
</div>
<!-- /view-stations -->

<!-- 💬 チャット ビュー
     お客様対応は YobuChat の店舗受信箱をそのまま使う（店長要望 2026-08-08）。
     独自に作り直すと本家との機能差が出るため、/chat/{slug}/ を iframe で読み込む方式にした
     （chat.html は frame-ancestors * で埋込許可済み。埋込は iframe 統一という YobuChat の方針とも一致）。
     下の旧UI(caLegacyUi)は ylka から移植したまま API が無く動かない残骸。JS が
     getElementById で参照するため消さずに隠してある。 -->
<div class="view" id="view-chat">
  <main class="chat-admin">
    <div class="chat-admin-head">
      <h2>💬 チャット</h2>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
        <button class="btn-secondary" id="caFrameReload" type="button" title="受信箱を読み込み直す">↻ 更新</button>
        <a class="btn-secondary" id="caFrameOpen" href="<?= htmlspecialchars(OPS_CHAT_URL, ENT_QUOTES) ?>" target="_blank" rel="noopener" style="text-decoration:none;">別タブで開く ↗</a>
      </div>
    </div>
    <iframe id="caFrame" title="YobuChat 店舗受信箱"
            data-src="<?= htmlspecialchars(OPS_CHAT_URL, ENT_QUOTES) ?>"
            style="width:100%;height:calc(100dvh - 210px);min-height:520px;border:1.5px solid var(--gray);border-radius:12px;background:#fff;display:block;"></iframe>
    <details style="margin:.7rem 0 0;font-size:.83rem;color:var(--ink-soft);">
      <summary style="cursor:pointer;font-weight:700;color:var(--deep);">⚙ 受信箱URLの設定（受信チャットが出ないとき）</summary>
      <p style="margin:.5rem 0;line-height:1.8;">
        チャットは <b>yobuho.com</b>、この管理画面は <b>admi2888.com</b> と別のサイトのため、
        ログイン情報が枠の中に引き継がれません。そのままだとお客様側の画面が出ます。<br>
        <b>手順:</b> 右上の「別タブで開く ↗」で受信チャットを開く →
        見出しの「🔗 管理画面用URL」を押してコピー → 下に貼って保存。以降はこの枠に受信チャットが出ます。
      </p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
        <input type="url" id="caInboxUrl" placeholder="https://yobuho.com/chat/xxxxxxxx/?owner_token=…"
               style="flex:1;min-width:18rem;padding:.5rem .7rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.85rem;">
        <button class="btn-primary" id="caInboxUrlSave" type="button" style="padding:.5rem 1rem;font-size:.85rem;">保存</button>
      </div>
      <p style="margin:.5rem 0 0;line-height:1.7;">
        通知の設定・受付時間・定型文も、この枠の中の「設定」から変更できます。
      </p>
    </details>
    <div class="chat-admin-grid" id="caLegacyUi" style="display:none;">
      <!-- 左ペイン: 受信箱 -->
      <div class="ca-inbox" id="caInbox">
        <div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>
      </div>
      <!-- 右ペイン: メッセージ + 返信 -->
      <div class="ca-thread">
        <div class="ca-thread-head" id="caThreadHead">
          <button class="ca-back-mobile" id="caBackMobile" type="button" aria-label="受信箱に戻る">← 受信箱</button>
          <span id="caThreadTitle">セッションを選択してください</span>
        </div>
        <div class="ca-messages" id="caMessages"></div>
        <div class="ca-reply" id="caReply" style="display:none;">
          <div class="ca-tpl-panel" id="caTplPanel" style="display:none;"></div>
          <button class="ca-tpl-btn" id="caTplBtn" type="button" title="定型文">📋</button>
          <textarea id="caReplyText" placeholder="返信を入力…" rows="2"></textarea>
          <button class="btn-primary" id="caReplySend">送信</button>
        </div>
      </div>
    </div>
  </main>
</div>

<!-- チャット設定モーダル -->
<div class="modal-overlay" id="chatSettingsModal">
  <div class="modal" style="max-width:520px;">
    <div class="modal-header">
      <div><div class="mh-title">チャット設定</div></div>
      <button class="modal-close" data-close="chatSettingsModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="csWelcome">ウェルカムメッセージ</label>
        <textarea id="csWelcome" rows="3" placeholder="訪問者が最初に見るメッセージ"></textarea>
      </div>
      <div class="field">
        <label for="csNotifyEmail">通知メール送信先</label>
        <input type="email" id="csNotifyEmail" placeholder="relux@ylka.jp">
      </div>
      <div class="field">
        <label>受付時間（空欄=24時間）</label>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <input type="time" id="csReceptionStart" style="flex:1;">
          <span>〜</span>
          <input type="time" id="csReceptionEnd" style="flex:1;">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="chatSettingsModal">キャンセル</button>
      <button class="btn-primary" id="csSaveSettings">保存</button>
    </div>
  </div>
</div>

<!-- ⚠ キャストからの報告（未対応を確認して、お客様のNG設定に落とす） -->
<div class="modal-overlay" id="castRepModal">
  <div class="modal" style="max-width:44rem;">
    <div class="modal-header">
      <h3>⚠ キャストからの報告</h3>
      <button class="modal-close" data-close="castRepModal" aria-label="閉じる">×</button>
    </div>
    <div class="modal-body" id="castRepBody"><div class="loading"><span class="spinner"></span></div></div>
    <div class="modal-footer" id="castRepFoot">
      <label class="cr-allsw"><input type="checkbox" id="crShowAll"> 対応済みも表示</label>
      <button class="btn-secondary" data-close="castRepModal">閉じる</button>
    </div>
  </div>
</div>

<!-- 権限管理 ビュー (owner専用) -->
<div class="view" id="view-permissions">
  <main class="staff-main">
    <div class="staff-head">
      <h2>権限管理</h2>
      <button class="btn-primary-coral" id="permSave">変更を保存</button>
    </div>
    <p style="color:var(--ink-soft);font-size:.9rem;margin-bottom:1rem;">各タブを操作・閲覧できる権限を設定します（オーナーは常に全タブ操作可）。</p>
    <div class="perm-table" id="permTable">
      <div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>
    </div>
  </main>
</div>

<!-- 👥 キャスト管理 ビュー（当日の売上・件数・報酬・出勤） -->
<div class="view" id="view-staffboard">
  <main class="staff-main">
    <div class="staff-head">
      <h2>👥 キャスト管理</h2>
      <a class="btn-primary-coral" href="/ctrl/girls.php" style="text-decoration:none;">＋ キャストを登録（CTRL）</a>
      <button class="btn-ghost" id="btnSyncCasts" type="button" title="CTRL で登録・編集した内容をここに取り込みます">🔄 CTRL から取り込み</button>
    </div>
    <div class="sb-sort">
      <label for="sbSort">並び順</label>
      <select id="sbSort">
        <option value="manual">手動（ドラッグで並べ替え）</option>
        <option value="in_date">入店順（新しい順）</option>
        <option value="work">出勤頻度順（多い順）</option>
        <option value="kana">あいうえお順</option>
      </select>
      <span class="sb-sort-note" id="sbSortNote"></span>
    </div>
    <div class="staff-table" id="staffBoard"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </main>
</div>

<!-- 🪪 キャスト専用マイページ -->
<div class="view" id="view-therapist">
  <main class="staff-main">
    <div class="staff-head" style="margin-bottom:1rem;">
      <h2>🪪 マイページ <span id="thDateLabel" style="font-size:.9rem;color:var(--ink-soft);font-weight:500;"></span></h2>
    </div>
    <div id="therapistHome"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </main>
</div>

<!-- スタッフ管理 ビュー -->
<div class="view" id="view-staff">
  <main class="staff-main">
    <div class="staff-head">
      <h2>スタッフ管理</h2>
      <button class="btn-primary-coral" id="btnAddStaff">＋ スタッフを追加</button>
    </div>
    <div class="staff-table" id="staffTable">
      <div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>
    </div>
    <!-- ログイン端末（CTRL は誰でも開けるので、許可・解除はここで行う・店長要望 2026-08-17） -->
    <div class="staff-head" style="margin-top:2rem;">
      <h2>🔒 端末とログイン</h2>
      <button class="btn-secondary" id="btnDevReload" type="button" style="padding:.45rem .9rem;font-size:.85rem;">⟳ 更新</button>
    </div>
    <p class="dev-lead">
      登録した端末からしかログインできません。1台目も含めて、ここで「次のログインを許可」を押してから、
      本人に<b>10分以内</b>にログインしてもらうと、その端末が登録されます。
    </p>
    <div id="devTable"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </main>
</div>

<!-- 💰 報酬 ビュー -->
<div class="view" id="view-payroll">
  <main class="staff-main">
    <div class="staff-head" style="flex-wrap:wrap;gap:.6rem;">
      <h2>💰 経理</h2>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <div style="display:flex;gap:.4rem;">
          <button class="sbtn v-unset ac-range" data-range="this-month" type="button">今月</button>
          <button class="sbtn v-unset ac-range" data-range="last-month" type="button">先月</button>
          <button class="sbtn v-unset ac-range" data-range="this-week" type="button">今週</button>
          <button class="sbtn v-unset ac-range" data-range="today" type="button">本日</button>
          <button class="sbtn v-unset ac-range" data-range="yesterday" type="button">前日</button>
          <button class="sbtn v-unset ac-range" data-range="tomorrow" type="button">翌日</button>
        </div>
        <input type="date" id="acFrom" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;">
        <span style="color:var(--ink-soft);">〜</span>
        <input type="date" id="acTo" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;">
        <button class="btn-primary-coral" id="acApply" type="button">表示</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin:.2rem 0 1rem;">
      <div id="acPeriodLabel" style="font-weight:700;color:var(--deep);font-size:1.05rem;"></div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:.4rem;">
        <label style="font-size:.85rem;color:var(--ink-soft);">キャスト</label>
        <select id="acTherapist" style="padding:.45rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;max-width:55vw;">
          <option value="">全体</option>
        </select>
      </div>
    </div>

    <!-- サブナビ -->
    <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:1.1rem;border-bottom:1.5px solid var(--gray);">
      <button class="ac-tab active" data-ac="summary" type="button">📊 損益</button>
      <button class="ac-tab" data-ac="sales" type="button">💴 売上</button>
      <button class="ac-tab" data-ac="payroll" type="button">👤 報酬</button>
      <button class="ac-tab" data-ac="settle" type="button">✅ 精算確認</button>
      <button class="ac-tab" data-ac="expenses" type="button">🧾 経費</button>
    </div>

    <!-- 📊 損益サマリー -->
    <div class="ac-panel" id="ac-summary">
      <div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>
    </div>

    <!-- 💴 売上 -->
    <div class="ac-panel" id="ac-sales" style="display:none;">
      <div class="loading"><span class="spinner"></span><br><br>読み込み中...</div>
    </div>

    <!-- 👤 報酬 -->
    <div class="ac-panel" id="ac-payroll" style="display:none;">
      <p style="color:var(--ink-soft);font-size:.85rem;margin-bottom:1rem;">対象 = <b>完了</b>予約のみ。報酬 = <b>マスタでコースごとに設定したキャスト報酬</b> ＋ 延長 ＋ オプション ＋ 指名料の報酬 ＋ 機動ボーナス（交通費）＋ 深夜料金。<b>機動ボーナス</b>＝行き帰りともキャストの移動なら交通費の全額（例 ¥1,650→¥1,650）、片道だけキャストの移動ならその半分を50円単位に切り上げ（例 ¥1,650→¥850）。送迎した片道はお店の取り分。<b>深夜料金</b>＝帰りのお迎えがあった場合は全額お店、お迎えなしは全額キャスト。</p>
      <div id="payTotal" style="margin-bottom:1rem;"></div>
      <div id="payResult"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
    </div>

    <!-- ✅ 集金（入金チェック） -->
    <div class="ac-panel" id="ac-settle" style="display:none;">
      <p style="color:var(--ink-soft);font-size:.85rem;margin-bottom:.8rem;">予約1件ごとの <b>店入金額（預り金 − 報酬）</b>。「店舗で受領」で1件ずつ受領を記録できます。</p>
      <div id="settleSummary" style="margin-bottom:1rem;"></div>
      <div style="display:flex;gap:.4rem;margin-bottom:.8rem;">
        <button class="sbtn v-unset settle-filter active" data-sf="unsettled" type="button">未精算</button>
        <button class="sbtn v-unset settle-filter" data-sf="settled" type="button">受領</button>
        <button class="sbtn v-unset settle-filter" data-sf="all" type="button">すべて</button>
      </div>
      <div id="settleList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
    </div>

    <!-- 🧾 経費 -->
    <div class="ac-panel" id="ac-expenses" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;">
        <div id="expTotal" style="font-weight:700;color:var(--deep);"></div>
        <button class="btn-primary-coral" id="expAdd" type="button">＋ 経費を追加</button>
      </div>
      <div id="expList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
    </div>
  </main>
</div>

<!-- 👤 担当したお客様（キャスト本人） -->
<div class="view" id="view-myclients">
  <main class="staff-main" style="max-width:760px;">
    <div class="staff-head"><h2>👤 担当したお客様</h2></div>
    <p style="color:var(--ink-soft);font-size:.85rem;margin:.2rem 0 .7rem;">自分が担当したお客様の来店履歴・お仕事メモを確認できます（電話番号は表示されません）。</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem;">
      <input type="search" id="mcKeyword" placeholder="お名前で検索" style="flex:1;min-width:140px;box-sizing:border-box;padding:.6rem .8rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;">
      <input type="date" id="mcDate" title="日付で絞り込み" style="box-sizing:border-box;padding:.55rem .6rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;">
    </div>
    <div id="mcList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </main>
</div>

<!-- 💴 入金（スタッフ本人） -->
<div class="view" id="view-settlement">
  <main class="staff-main">
    <div class="staff-head" style="flex-wrap:wrap;gap:.6rem;">
      <h2>💴 預り金</h2>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <div style="display:flex;gap:.4rem;">
          <button class="sbtn v-unset ms-range" data-range="this-month" type="button">今月</button>
          <button class="sbtn v-unset ms-range" data-range="last-month" type="button">先月</button>
          <button class="sbtn v-unset ms-range" data-range="this-week" type="button">今週</button>
          <button class="sbtn v-unset ms-range" data-range="today" type="button">本日</button>
          <button class="sbtn v-unset ms-range" data-range="yesterday" type="button">前日</button>
          <button class="sbtn v-unset ms-range" data-range="tomorrow" type="button">翌日</button>
        </div>
        <input type="date" id="msFrom" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;">
        <span style="color:var(--ink-soft);">〜</span>
        <input type="date" id="msTo" style="padding:.5rem .6rem;border:1.5px solid var(--gray);border-radius:8px;">
        <button class="btn-primary-coral" id="msApply" type="button">表示</button>
      </div>
    </div>
    <p style="color:var(--ink-soft);font-size:.85rem;margin-bottom:.8rem;">予約1件ごとの <b>店入金額（預り金 − 報酬）</b>と、<b>精算状況</b>を確認できます（精算確定は店舗側で行います）。</p>
    <div id="msSummary" style="margin-bottom:1rem;"></div>
    <div id="msList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  </main>
</div>

<!-- 経費 追加/編集モーダル -->
<div class="modal-overlay" id="expenseModal">
  <div class="modal" style="max-width:460px;">
    <div class="modal-header">
      <div><div class="mh-title" id="expTitle">経費を追加</div></div>
      <button class="modal-close" data-close="expenseModal">×</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="expDate">日付</label><input type="date" id="expDate"></div>
        <div class="field"><label for="expAmount">金額（円）</label><input type="text" inputmode="numeric" data-money placeholder="10000"id="expAmount"></div>
      </div>
      <div class="field">
        <label for="expCategory">カテゴリ</label>
        <select id="expCategory">
          <option value="広告費">広告費</option>
          <option value="家賃">家賃</option>
          <option value="水道光熱費">水道光熱費</option>
          <option value="車両費">車両費（ガソリン・駐車場等）</option>
          <option value="備品">備品・消耗品</option>
          <option value="通信費">通信費</option>
          <option value="外注費">外注費</option>
          <option value="その他">その他</option>
        </select>
      </div>
      <div class="field"><label for="expVendor">支払先（任意）</label><input type="text" id="expVendor" placeholder="例: らくらくマッサージなび"></div>
      <div class="field"><label for="expMemo">メモ（任意）</label><textarea id="expMemo" rows="2" placeholder="内容・備考"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="expDelete" style="display:none;margin-right:auto;color:#c0392b;border-color:#e8b4ad;">削除</button>
      <button class="btn-secondary" data-close="expenseModal">キャンセル</button>
      <button class="btn-primary" id="expSave">保存</button>
    </div>
  </div>
</div>

<!-- スタッフ追加モーダル -->
<div class="modal-overlay" id="createStaffModal">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="mh-title" id="csTitle">スタッフを追加</div>
        <div class="mh-sub">メールアドレスと初期パスワードを設定します</div>
      </div>
      <button class="modal-close" data-close="createStaffModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="csName">表示名</label>
        <input type="text" id="csName" placeholder="例: 山田 太郎">
      </div>
      <div class="field">
        <label for="csLoginId">ログインID</label>
        <input type="text" id="csLoginId" placeholder="例: yamada（半角英数字）" autocapitalize="off" autocorrect="off" spellcheck="false">
        <span class="hint">このIDとパスワードでログインします（メールとは別でOK）</span>
      </div>
      <div class="field">
        <label for="csEmail">メールアドレス（任意）</label>
        <input type="text" id="csEmail" placeholder="example@gmail.com">
        <span class="hint">送迎メール・通知の送信先。あとで設定しても構いません</span>
      </div>
      <div class="field">
        <label for="csPassword">初期パスワード（8文字以上）</label>
        <div class="field-row">
          <input type="text" id="csPassword" placeholder="自動生成または手動入力">
          <button type="button" id="csGenPw">自動生成</button>
        </div>
        <span class="hint">追加後、スタッフ本人がログイン後に変更できます</span>
      </div>
      <div class="field" id="csRoleField">
        <label>権限</label>
        <div class="em-status" style="grid-template-columns:repeat(auto-fit,minmax(96px,1fr));">
          <button class="sbtn v-visited active" data-role-btn data-role="staff" type="button">キャスト</button>
          <button class="sbtn v-unset" data-role-btn data-role="driver" type="button">ドライバー</button>
          <button class="sbtn v-unset" data-role-btn data-role="office" type="button">内勤スタッフ</button>
          <button class="sbtn v-inquiry" data-role-btn data-role="manager" type="button">管理者</button>
          <button class="sbtn v-unavailable" data-role-btn data-role="owner" type="button">オーナー</button>
        </div>
      </div>
      <div class="field" id="csConcurrentField">
        <label>兼任（主となる権限とは別に、複数の業務を兼ねる場合はチェック）</label>
        <input type="checkbox" id="csIsTherapist" hidden>
        <label id="csOfficeRow" style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
          <input type="checkbox" id="csIsOffice" style="width:18px;height:18px;cursor:pointer;">
          <span>🪪 内勤業務も兼任する</span>
        </label>
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
          <input type="checkbox" id="csCanDrive" style="width:18px;height:18px;cursor:pointer;">
          <span>🚗 送迎ドライバーも兼任する</span>
        </label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="createStaffModal">キャンセル</button>
      <button class="btn-primary" id="csSave">追加</button>
    </div>
  </div>
</div>

<!-- スタッフ編集モーダル -->
<div class="modal-overlay" id="editStaffModal">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="mh-title" id="esTitle">スタッフ編集</div>
        <div class="mh-sub" id="esSub"></div>
      </div>
      <button class="modal-close" data-close="editStaffModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="esName">表示名</label>
        <input type="text" id="esName" placeholder="例: 山田 太郎">
      </div>
      <div class="field" id="esCastNotesField">
        <label for="esCastNotes">⚠️ 注意事項 <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">予約を取る前に確認すること</span></label>
        <textarea id="esCastNotes" rows="3" placeholder="例: 猫アレルギー / 犬NG / 喫煙者NG / 自宅NG"></textarea>
        <span class="hint">担当キャストに選ぶと、予約画面に赤で表示されます</span>
      </div>
      <div class="field" id="esDiaryField">
        <label>📖 写メ日記 <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">キャスト本人がスマホから開けます</span></label>
        <input type="text" id="esDiaryUrl" placeholder="日記投稿ページのURL（https://…）" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="field-row" style="margin-top:.4rem;gap:.5rem;">
          <input type="text" id="esDiaryLogin" placeholder="ログインID" autocapitalize="off" autocorrect="off" spellcheck="false">
          <input type="text" id="esDiaryPass" placeholder="パスワード" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <span class="hint">登録すると、キャストの画面からワンタップで日記ページを開けます</span>
      </div>
      <div class="field" id="esSelfConfirmField">
        <label style="display:flex;align-items:center;gap:.55rem;cursor:pointer;">
          <input type="checkbox" id="esSelfConfirm" style="width:18px;height:18px;cursor:pointer;">
          <span>🕒 出勤確認ボタンを表示する</span>
        </label>
        <span class="hint">キャストの画面に「出勤確認」ボタンを出します（既定は非表示）。出さない方には、順番待ちのご案内メッセージが表示されます</span>
      </div>
      <div class="field">
        <label for="esLoginId">ログインID</label>
        <input type="text" id="esLoginId" placeholder="例: yamada（半角英数字）" autocapitalize="off" autocorrect="off" spellcheck="false">
        <span class="hint">このIDとパスワードでログインします。変更したら本人に伝えてください</span>
      </div>
      <div class="field">
        <label for="esEmail">メールアドレス（任意）</label>
        <input type="email" id="esEmail" placeholder="example@gmail.com">
        <span class="hint">送迎情報・通知の送信先。ログインIDとは別に設定できます</span>
      </div>
      <div class="field">
        <label>サムネイル写真</label>
        <div style="display:flex;gap:.8rem;align-items:center;">
          <div id="esThumbPreview" style="width:64px;height:80px;border-radius:12px;background:var(--foam);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--ink-soft);font-size:.7rem;">なし</div>
          <div style="flex:1;">
            <input type="file" id="esThumbFile" accept="image/*" style="display:block;font-size:.85rem;">
            <button type="button" id="esThumbRemove" style="margin-top:.4rem;background:transparent;border:1.5px solid var(--gray);color:var(--ink-soft);padding:.3rem .8rem;border-radius:7px;font-size:.78rem;cursor:pointer;">削除</button>
          </div>
        </div>
        <span class="hint">PNG/JPG/WebP、512px推奨。自動でリサイズします</span>
      </div>
      <!-- 権限・兼任・歩合率は「スタッフ管理」専用。キャスト編集では出さない。
           admi のキャストは全員 role=staff 固定で、報酬はマスタのコース別
           「キャスト報酬」で決まるため歩合率(%)は使わない。 -->
      <div id="esStaffOnlyFields" style="display:none;">
        <div class="field">
          <label>権限</label>
          <div class="em-status" style="grid-template-columns:repeat(auto-fit,minmax(96px,1fr));">
            <button class="sbtn v-visited" data-es-role="staff" type="button">キャスト</button>
            <button class="sbtn v-unset" data-es-role="driver" type="button">ドライバー</button>
            <button class="sbtn v-unset" data-es-role="office" type="button">内勤スタッフ</button>
            <button class="sbtn v-inquiry" data-es-role="manager" type="button">管理者</button>
            <button class="sbtn v-unavailable" data-es-role="owner" type="button">オーナー</button>
          </div>
          <span class="hint" id="esRoleHint"></span>
        </div>
        <div class="field" id="esColorField">
          <label for="esColor">🎨 預り金カードの色</label>
          <div style="display:flex;align-items:center;gap:.6rem;">
            <select id="esColor" style="flex:1;">
              <option value="">なし（既定の色のまま）</option>
              <option value="#ff4f9a">ピンク</option>
              <option value="#d81b60">チェリーピンク</option>
              <option value="#e3799f">ペールピンク</option>
              <option value="#d16ba5">ローズ</option>
              <option value="#b04a6a">ワイン</option>
              <option value="#e0705a">コーラル</option>
              <option value="#c05d20">テラコッタ</option>
              <option value="#4a9a6f">グリーン</option>
              <option value="#2e7d74">ディープティール</option>
              <option value="#8a6bbf">パープル</option>
              <option value="#5a6472">チャコール</option>
            </select>
            <span id="esColorPreview" style="width:34px;height:24px;border-radius:6px;border:1.5px solid var(--gray);background:transparent;flex-shrink:0;"></span>
          </div>
        </div>
        <div class="field" id="esConcurrentField">
          <label>兼任（主となる権限とは別に、複数の業務を兼ねる場合はチェック）</label>
          <input type="checkbox" id="esIsTherapist" hidden>
          <label id="esOfficeRow" style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
            <input type="checkbox" id="esIsOffice" style="width:18px;height:18px;cursor:pointer;">
            <span>🪪 内勤業務も兼任する</span>
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
            <input type="checkbox" id="esCanDrive" style="width:18px;height:18px;cursor:pointer;">
            <span>🚗 送迎ドライバーも兼任する</span>
          </label>
        </div>
      </div>
      <div class="field" id="esCastNote" style="display:none;">
        <span class="hint">プロフィール（名前・写真・入店日など）の編集は <a href="/ctrl/girls.php">CTRL のキャスト管理</a> から。ここでの変更は運営画面の表示にだけ使われます。<br>報酬は「マスタ」タブのコースごとに設定した<strong>キャスト報酬</strong>で計算されます。</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="editStaffModal">キャンセル</button>
      <button class="btn-primary" id="esSave">保存</button>
    </div>
  </div>
</div>

<!-- パスワード再発行モーダル -->
<div class="modal-overlay" id="resetPwModal">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="mh-title">パスワード再発行</div>
        <div class="mh-sub" id="rpTarget"></div>
      </div>
      <button class="modal-close" data-close="resetPwModal">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="rpPassword">新しいパスワード（8文字以上）</label>
        <div class="field-row">
          <input type="text" id="rpPassword" placeholder="自動生成または手動入力">
          <button type="button" id="rpGenPw">自動生成</button>
        </div>
        <span class="hint">変更後、スタッフ本人にこのパスワードを共有してください</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="resetPwModal">キャンセル</button>
      <button class="btn-primary" id="rpSave">変更</button>
    </div>
  </div>
</div>

<!-- 編集モーダル -->
<div class="modal-overlay" id="editModal">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="mh-title" id="emTitle"></div>
        <div class="mh-sub" id="emSub"></div>
      </div>
      <button class="modal-close" id="emClose">×</button>
    </div>
    <div class="modal-body">
      <!-- ホテルそのものの情報（ops_hotels）。ここまでは新規追加でも使う -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field">
          <label for="emName">ホテル名</label>
          <input type="text" id="emName" placeholder="例: シティ">
        </div>
        <div class="field">
          <label for="emNameKana">読み仮名</label>
          <input type="text" id="emNameKana" placeholder="（自動）">
          <span class="hint">あいうえお順の並びに使います。カタカナ・ひらがなの名前は自動なので空欄でOK</span>
        </div>
      </div>
      <div class="field">
        <label for="emHotelType">タイプ</label>
        <!-- 一覧の絞り込みは「ラブホ / ホテル」の2択。ラブホ以外はすべて「ホテル」に含まれる -->
        <select id="emHotelType">
          <option value="love_hotel">🛏 ラブホ</option>
          <option value="city">🏨 シティホテル</option>
          <option value="business">🏨 ビジネスホテル</option>
          <option value="ryokan">🏯 旅館</option>
          <option value="minshuku">🏠 民宿</option>
          <option value="other">その他</option>
        </select>
        <span class="hint">ラブホ以外は一覧の「タイプ: ホテル」でまとめて絞り込めます</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field">
          <label for="emCity">市区町村</label>
          <!-- 手入力だと打ち間違いで絞り込みから漏れるためプルダウン。都道府県はここから決まる -->
          <select id="emCity"><option value="">— 選択 —</option></select>
          <span class="hint">予約画面の絞り込みに使います</span>
        </div>
        <div class="field">
          <label for="emTel">電話番号</label>
          <input type="tel" id="emTel" placeholder="例: 042-527-8383">
        </div>
      </div>
      <div class="field">
        <label for="emAddress">住所</label>
        <!-- 市区町村は上のプルダウンが正。ここでは編集させず、続きの町名・番地だけ手入力する -->
        <div class="addr-combo">
          <span class="addr-city" id="emAddrCity">市区町村を選択</span>
          <input type="text" id="emAddress" placeholder="例: 曙町2-21-15">
        </div>
        <div id="emMapLinks" style="margin-top:.45rem;"></div>
        <span class="hint">灰色の部分は上の市区町村と連動します。都道府県付きで貼り付けても自動で振り分けます</span>
      </div>
      <div class="field">
        <label>対応ステータス</label>
        <div class="em-status" id="emStatus">
          <button class="sbtn v-visited" data-status="visited">実績あり</button>
          <button class="sbtn v-inquiry" data-status="inquiry">要問合せ</button>
          <button class="sbtn v-unavailable" data-status="unavailable">不可</button>
          <button class="sbtn v-unset" data-status="">未設定</button>
        </div>
        <span class="hint">未設定・不可は公開一覧から除外されます</span>
      </div>
      <div class="field">
        <label>入室方法（複数選択可）</label>
        <input type="hidden" id="emEntry">
        <div id="emEntryChips" class="em-entry-chips"></div>
        <span class="hint">キャストが当日どう入室するかの案内（複数選択可、コース管理タブで編集）</span>
      </div>
      <input type="hidden" id="emRoomRec">
      <div class="field">
        <label for="emTransportFee">交通費</label>
        <!-- 予約モーダルの交通費と同じ ¥1,100〜550円刻み。無料(0円)と未設定(表示なし)は別物 -->
        <select id="emTransportFee">
          <option value="">— 未設定（表示なし）—</option>
          <option value="0">🆓 無料（¥0）</option>
          <option value="1100">¥1,100</option><option value="1650">¥1,650</option><option value="2200">¥2,200</option><option value="2750">¥2,750</option><option value="3300">¥3,300</option><option value="3850">¥3,850</option><option value="4400">¥4,400</option><option value="4950">¥4,950</option><option value="5500">¥5,500</option><option value="6050">¥6,050</option><option value="6600">¥6,600</option><option value="7150">¥7,150</option><option value="7700">¥7,700</option><option value="8250">¥8,250</option><option value="8800">¥8,800</option><option value="9350">¥9,350</option><option value="9900">¥9,900</option><option value="10450">¥10,450</option><option value="11000">¥11,000</option>
        </select>
        <span class="hint">ホテルを選ぶと、予約画面の交通費にこの金額が初期値で入ります</span>
      </div>
      <!-- 公開ガイドノートは ylka の公開ページ用。アドミには公開ページが無いので出さない
           （店長指定 2026-08-10）。DBの値は残すので、必要になれば戻せる -->
      <div class="field">
        <label for="emMemo">内部メモ（非公開）</label>
        <textarea id="emMemo" placeholder="管理画面でのみ閲覧。連絡先・特記事項など"></textarea>
        <span class="hint">管理画面でのみ確認可能</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="emCancel">キャンセル</button>
      <button class="btn-primary" id="emSave">保存</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
<div class="min-dock" id="minDock"></div>

<script>window.__APP_VERSION__='<?= htmlspecialchars($APP_VERSION, ENT_QUOTES, 'UTF-8') ?>';</script>
<script src="/ctrl/ops/admin.js?v=<?= htmlspecialchars($APP_VERSION, ENT_QUOTES, 'UTF-8') ?>"></script>

</body>
</html>
