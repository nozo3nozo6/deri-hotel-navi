<?php
// キャッシュバスターは admin.js の更新時刻から自動生成する。
// 固定文字列(?v=20260716b)のままだと、admin.js を直しても各端末が古いJSを
// 掴み続ける（2026-08-02: 出勤トグルの「終了」が反映されない事象の原因）。
// CTRL 本体の admin.css / list.js と同じ filemtime 方式に揃えた。
$APP_VERSION = (string)(@filemtime(__DIR__ . '/../admin.js') ?: '1');
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
  .staff-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.3rem;}
  .staff-head h2{font-size:1.2rem;font-weight:700;color:var(--deep);}
  .btn-primary-coral{background:var(--coral);color:#fff;border:none;padding:.6rem 1.4rem;border-radius:50px;font-size:.9rem;font-weight:600;cursor:pointer;}
  .btn-primary-coral:hover{background:var(--deep);}
  .staff-table{background:var(--white);border-radius:14px;padding:.5rem;box-shadow:0 4px 14px rgba(10,61,82,.05);}
  .staff-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:.9rem;padding:.9rem 1.1rem;border-bottom:1px solid var(--gray);align-items:center;}
  /* スマホ: スタッフ行をカード型に組み替え (横並び→2段) */
  @media(max-width:780px){
    .staff-row{
      grid-template-columns: auto auto 1fr !important;
      grid-template-areas: 'drag thumb info' 'actions actions actions' !important;
      gap:.5rem .6rem!important;
      padding:.7rem .8rem!important;
      align-items:center;
    }
    .staff-row .drag-handle{grid-area:drag;}
    .staff-row > img,.staff-row > div[style*="border-radius:10px"]{grid-area:thumb;}
    .staff-row .sr-role{grid-area:thumb;display:none;}
    .staff-row .sr-info{grid-area:info;min-width:0;}
    .staff-row .sr-info .sr-name{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;}
    .staff-row .sr-meta{display:none;}
    .staff-row .sr-actions{
      grid-area:actions;
      display:flex!important;flex-direction:row!important;flex-wrap:wrap;gap:.4rem;
      justify-self:stretch!important;width:100%;
    }
    .staff-row .sr-actions button{flex:1;min-width:0;writing-mode:horizontal-tb!important;white-space:nowrap;font-size:.78rem;padding:.5rem .3rem!important;}
  }
  .staff-row:last-child{border-bottom:none;}
  .sr-role{padding:.3rem .7rem;border-radius:50px;font-size:.74rem;font-weight:700;letter-spacing:.06em;white-space:nowrap;}
  .sr-role.owner{background:linear-gradient(135deg,var(--coral),#e87a4f);color:#fff;}
  .sr-role.manager{background:linear-gradient(135deg,#a8e0ea,#5bbcd4);color:#fff;}
  .sr-role.staff{background:var(--foam);color:var(--sea);border:1px solid rgba(91,188,212,.4);}

  /* 権限管理テーブル (ロールは5列: owner/manager/office/staff/driver) */
  .perm-table{background:#fff;border-radius:14px;padding:1rem;box-shadow:0 4px 14px rgba(10,61,82,.05);overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .perm-row{display:grid;grid-template-columns:minmax(150px,1fr) repeat(5,72px);gap:.6rem;padding:.85rem 1rem;border-bottom:1px solid var(--gray);align-items:center;min-width:580px;}
  .perm-row.header .perm-cell{text-align:center;line-height:1.2;}
  @media(max-width:780px){
    .perm-table{padding:.55rem;}
    .perm-row{grid-template-columns:128px repeat(5,56px);gap:.3rem;padding:.6rem .35rem;min-width:max-content;}
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

  /* Hotel List */
  .main{padding:1.5rem;max-width:1600px;margin:0 auto;}
  .results-bar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.9rem;padding:0 .2rem;}
  .results-bar .count{color:var(--ink-soft);font-size:.92rem;}
  .results-bar .count b{color:var(--deep);font-family:'Outfit';font-weight:700;font-size:1.1rem;margin:0 .15rem;}

  .hotel-row{background:var(--white);border-radius:14px;padding:1rem 1.2rem;margin-bottom:.55rem;display:grid;grid-template-columns:auto auto 1fr auto;gap:.9rem;align-items:center;box-shadow:0 3px 12px rgba(10,61,82,.05);transition:all .2s;border:1.5px solid transparent;}
  .hotel-row:hover{box-shadow:0 6px 18px rgba(10,61,82,.1);}
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
  .row-meta .badge-mini{background:var(--foam);color:var(--sea);padding:.1rem .5rem;border-radius:6px;font-size:.72rem;font-weight:600;}

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
  .modal-header{padding:1.4rem 1.6rem 1rem;border-bottom:1px solid var(--gray);position:sticky;top:0;background:#fff;border-radius:20px 20px 0 0;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;}
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
  .modal-body input::placeholder,.modal-body textarea::placeholder{color:var(--ink-soft);opacity:.45;font-weight:400;}
  /* 未選択の select（先頭の「選択」「— すべて —」等）も入力例と同じ扱いで薄く */
  .modal-body select:has(option[value=""]:checked){color:var(--ink-soft);font-weight:400;}
  /* 日付入力: 年は表示しない（内部値はYYYY-MM-DDのまま保持）*/
  .bm-date::-webkit-datetime-edit-year-field{display:none;}
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
  /* ＋10分は自動で入るが、媒体を見ていないお客様など外したい場合があるのでチェックで操作できる */
  .bm-plus10{display:inline-flex;align-items:center;gap:.3rem;margin-left:.6rem;padding:.15rem .55rem;
    border:1.5px solid #9ad8bb;background:#f2fbf6;border-radius:999px;cursor:pointer;
    font-size:.76rem;font-weight:700;color:#0d7a4a;vertical-align:middle;}
  .bm-plus10 input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#0d7a4a;}
  .bm-plus10:has(input:checked){background:#d9f3e4;border-color:#4bb583;}
  /* 幅がバラバラだと段ごとに端がずれて読みにくいので、等幅の升目に並べる */
  /* PC・スマホとも2行に収める: 1行目=媒体6つ / 2行目=LINE予約（全幅）。
     狭い画面でも折り返さないよう、文字と余白を詰めて6列を維持する */
  .bm-media-list{display:grid;grid-template-columns:repeat(6,1fr);gap:.4rem;}
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
  /* ホテル料金の適用条件の注意（チェックする前に気づけるように） */
  .bm-hf-warn{display:block;margin-top:.2rem;font-size:.74rem;font-weight:600;color:#6b7f9e;line-height:1.5;}
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
  /* 住所からの地図リンク（案内・場所確認用。別タブで開く） */
  .cu-loc{margin-top:.2rem;font-size:.78rem;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cu-last{margin-left:.6rem;font-size:.74rem;color:var(--ink-soft);}
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
  .bm-history-note .bhn-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;}
  .bm-history-note .bhn-title{font-weight:700;font-size:.76rem;color:#6b4d20;flex:1;min-width:0;}
  .bm-history-note .bhn-sub{margin-left:.4rem;font-weight:500;font-size:.68rem;color:#9a7a45;}
  .bm-history-note .bhn-btn{border:1.5px solid #d8c3a0;background:#fff;color:#6b4d20;border-radius:7px;
    padding:.22rem .6rem;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .bm-history-note .bhn-btn:hover{background:#fdf3e3;}
  .bm-history-note .bhn-btn.primary{background:var(--deep);border-color:var(--deep);color:#fff;}
  .bm-history-note .bhn-main{white-space:pre-wrap;font-weight:600;color:#5c3f18;}
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
  .hist-tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch;max-height:min(46vh,320px);}
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
  /* ホテル選択: ネイティブ矢印の予約幅が広くスマホでホテル名が見切れるため、細いカスタム矢印に置き換えて文字幅を確保 */
  .modal-body select.bm-tight-select{-webkit-appearance:none!important;appearance:none!important;padding-right:1.6rem!important;background-color:var(--white)!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23173842' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right .55rem center!important;background-size:10px 6px!important;}
  .bm-date::-webkit-datetime-edit-text:first-child{display:none;}
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
  .em-status .sbtn[data-pay-btn].active{background:var(--sea);border-color:var(--sea);color:#fff;box-shadow:0 3px 8px rgba(29,122,156,.35);}
  .modal-footer{padding:1rem 1.6rem 1.4rem;border-top:1px solid var(--gray);display:flex;gap:.7rem;justify-content:flex-end;}
  .btn-primary{background:var(--coral);color:#fff;border:none;padding:.7rem 1.6rem;border-radius:50px;font-weight:600;font-size:.92rem;}
  .btn-primary:hover{background:var(--deep);}
  .btn-secondary{background:transparent;color:var(--ink-soft);border:1.5px solid var(--gray);padding:.7rem 1.4rem;border-radius:50px;font-size:.92rem;}
  .btn-secondary:hover{background:var(--foam);}

  /* ============== Timeline View (1日 × 24時間 × スタッフ) ============== */
  .tl-toolbar{background:#fff;padding:1rem 1.5rem;border-bottom:1px solid var(--gray);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.7rem;}
  /* タイトル + 新規予約ボタンを横並びに */
  .tl-toolbar .tl-title-row{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;}
  .tl-toolbar .tl-title{font-size:1.15rem;font-weight:700;color:var(--deep);}
  .tl-toolbar .tl-title .tl-sub{display:block;font-size:.72rem;color:var(--ink-soft);font-weight:400;margin-top:.2rem;letter-spacing:.05em;}
  .tl-toolbar .tl-nav{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;}
  /* 検索群はタイトルのすぐ右に置く（画面が広いほど右端へ離れていくと目線が飛ぶため）。
     新規追加ボタンだけは従来どおり右端に逃がす */
  #view-customers .tl-toolbar,#view-bookings .tl-toolbar{justify-content:flex-start;gap:1rem;}
  #view-customers .tl-toolbar .tl-nav,#view-bookings .tl-toolbar .tl-nav{flex:1;}
  #view-customers .tl-toolbar .tl-nav #cuAddNew,
  #view-bookings .tl-toolbar .tl-nav #bkAddNew{margin-left:auto;}
  .tl-toolbar .tl-nav button{background:var(--foam);border:1.5px solid var(--gray);padding:.45rem .8rem;border-radius:8px;font-size:.85rem;cursor:pointer;}
  .tl-toolbar .tl-nav button:hover{background:var(--aqua);color:#fff;border-color:var(--aqua);}
  .tl-toolbar .tl-nav input[type="date"]{padding:.42rem .7rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;font-family:'Outfit';}
  /* 日付の年(2026)は不要 → 年フィールドと年直後の区切りを非表示にして MM/DD だけ表示 */
  #tlDatePicker::-webkit-datetime-edit-year-field{display:none;}
  #tlDatePicker::-webkit-datetime-edit-text:first-of-type{display:none;}
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
  .tl-phone-quick{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;background:var(--foam);border:1.5px dashed var(--aqua);border-radius:12px;padding:.5rem .7rem;}
  .tl-phone-quick .pq-label{font-size:.72rem;color:var(--sea);font-weight:700;letter-spacing:.06em;align-self:center;}
  .tl-phone-quick .pq-row{display:flex;gap:.3rem;align-items:center;}
  .tl-phone-quick .pq-row label{font-size:.78rem;color:var(--ink-soft);}
  .tl-phone-quick .pq-row input{padding:.42rem .65rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;font-family:'Outfit';width:160px;letter-spacing:.04em;}
  .tl-phone-quick .pq-row input:focus{outline:none;border-color:var(--sea);background:#fff;}
  .tl-phone-quick .pq-row button{background:var(--sea);color:#fff;border:none;padding:.42rem .85rem;border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:600;}
  .tl-phone-quick .pq-row button:hover{background:var(--deep);}

  /* 左右パディングは撤去: sticky スタッフ列の左に中身が透けるバグの原因 (schedule.css と同対応) */
  .tl-wrap{padding:1.2rem 0;max-width:1800px;margin:0 auto;overflow-x:auto;}

  /* ===== 受付リスト（着信履歴）左パネル ＋ タイムライン 2カラム ===== */
  .tl-split{display:flex;gap:1rem;align-items:flex-start;padding:0 1.2rem;}
  .tl-split .tl-wrap{flex:1;min-width:0;max-width:none;margin:0;padding:1.2rem 0;}
  .recv-panel{flex:0 0 380px;width:380px;background:var(--white);border:1px solid var(--gray);border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(10,61,82,.06);display:flex;flex-direction:column;max-height:calc(100vh - 170px);position:sticky;top:1rem;margin-top:1.2rem;}
  .recv-head{background:var(--deep);color:#fff;padding:.6rem .9rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-shrink:0;}
  .recv-title{font-size:.95rem;font-weight:700;letter-spacing:.02em;}
  .recv-title .recv-sub{font-size:.72rem;font-weight:500;opacity:.85;margin-left:.35rem;}
  .recv-count{font-size:.74rem;font-weight:600;background:rgba(255,255,255,.16);padding:.2rem .55rem;border-radius:50px;white-space:nowrap;}
  .recv-count b{font-family:'Outfit';font-size:.92rem;}
  .recv-colhead,.recv-row{display:grid;grid-template-columns:42px minmax(0,1fr) 58px 46px 54px;gap:.3rem;align-items:center;}
  .recv-colhead{background:var(--foam);color:var(--sea);font-size:.68rem;font-weight:700;padding:.42rem .6rem;border-bottom:1px solid var(--gray);letter-spacing:.02em;flex-shrink:0;}
  .recv-list{overflow-y:auto;flex:1;}
  .recv-row{padding:.5rem .6rem;border-bottom:1px solid var(--foam);font-size:.8rem;transition:background .12s;}
  .recv-row:hover{background:var(--foam);}
  .recv-row .rr-time{font-family:'Outfit';font-size:.78rem;color:var(--ink-soft);}
  .recv-row .rr-phone{font-family:'Outfit';font-weight:600;color:var(--deep);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.82rem;}
  .recv-row .rr-name{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.78rem;}
  .recv-row .rr-name.empty{color:var(--ink-soft);opacity:.55;}
  .recv-state{font-size:.66rem;font-weight:700;text-align:center;padding:.16rem .2rem;border-radius:50px;white-space:nowrap;}
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
    .recv-panel{flex:none;width:100%;max-height:320px;position:static;margin-top:.6rem;}
    .tl-split .tl-wrap{padding:.6rem 0;width:100%;}
  }
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
  .tl-grid{display:grid;grid-template-columns:200px repeat(24, minmax(96px, 1fr));gap:1px;background:var(--gray);border-radius:12px;min-width:2529px;}
  .tl-head{background:var(--deep);color:#fff;padding:.55rem .35rem;font-size:.78rem;text-align:center;font-weight:600;letter-spacing:.04em;}
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
     線はキャスト欄の左端から右端まで通す。border だと右半分（金額側）にしか引けないので、
     擬似要素をセル幅いっぱいに伸ばし、写真・名前・出勤ボタンはその上に重ねる */
  .tl-m{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem;font-size:.72rem;line-height:1.25;
        padding-bottom:.16rem;margin-bottom:.1rem;position:relative;}
  .tl-m::after{content:'';position:absolute;left:calc(-64px - .53rem);right:-.25rem;bottom:0;z-index:0;
        border-bottom:1px solid var(--gray);}
  .tl-staff-left{position:relative;z-index:1;}
  body[data-theme="soft"] .tl-m::after{border-bottom-color:#dfe3df;}
  .tl-m-l{color:var(--ink-soft);font-weight:600;flex-shrink:0;}
  .tl-m-v{font-weight:800;color:var(--deep);font-family:'Outfit',sans-serif;white-space:nowrap;text-align:right;}
  /* 時間行: 数値の上に置き、薄い区切り線でスケジュールと金額を分ける */
  .tl-m-time .tl-m-l{color:var(--deep);}
  .tl-m-time .tl-m-v{font-size:.82rem;letter-spacing:.01em;}
  /* サイト・媒体に出していない出勤（CTRLで「OPSのみ」を選んだ日） */
  .tl-m-private .tl-m-l{color:#7d4a95;}
  .tl-m-private .tl-m-v{color:#7d4a95;font-size:.72rem;letter-spacing:.02em;}
  .tl-m-wave{margin:0 .15em;color:var(--ink-soft);font-weight:600;}
  button.tl-staff-sales.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;-webkit-tap-highlight-color:rgba(232,93,47,.25);}
  button.tl-staff-sales.tl-m .tl-m-l,button.tl-staff-sales.tl-m .tl-m-v{color:var(--coral);}
  /* 預り金（青・クリックで受け渡し履歴） */
  button.tl-staff-held.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;text-align:left;-webkit-tap-highlight-color:rgba(29,122,156,.2);}
  button.tl-staff-held.tl-m .tl-m-v{text-decoration:underline dotted;text-underline-offset:2px;}
  button.tl-staff-held.tl-m .tl-m-l,button.tl-staff-held.tl-m .tl-m-v{color:var(--sea);}
  /* 報酬（緑・背景/枠なし）。預り金=青・報酬=緑・入金分=コーラルで色分け */
  button.tl-staff-reward.tl-m{background:transparent;border:none;padding:0;cursor:pointer;width:100%;-webkit-tap-highlight-color:rgba(58,154,96,.2);}
  button.tl-staff-reward.tl-m .tl-m-l,button.tl-staff-reward.tl-m .tl-m-v{color:var(--green);}
  /* 受け渡しの流れ表示 */
  .chain-flow{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;margin:.45rem 0 .1rem;}
  .chain-node{display:inline-flex;flex-direction:column;align-items:center;background:var(--foam);border:1px solid var(--aqua-light);border-radius:8px;padding:.2rem .5rem;font-size:.82rem;font-weight:700;color:var(--deep);line-height:1.2;}
  .chain-node small{font-size:.6rem;font-weight:600;color:var(--ink-soft);}
  .chain-node.start{background:#eef9fb;border-color:var(--aqua);}
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
  .tl-staff-thumb{display:block;width:50px;height:50px;flex-shrink:0;border-radius:8px;object-fit:cover;margin:0;border:1.5px solid var(--gray);}
  .tl-staff-thumb-ph{display:flex;align-items:center;justify-content:center;width:50px;height:50px;flex-shrink:0;border-radius:8px;margin:0;background:var(--aqua-light);color:var(--deep);font-weight:800;font-size:1.3rem;}
  .tl-staff-name{font-weight:700;line-height:1.15;}
  .tl-staff-time{font-size:.66rem;color:var(--ink-soft);margin-top:.12rem;white-space:nowrap;font-weight:600;}
  .tl-staff-unassigned{background:linear-gradient(135deg,#f7f2ea,#fff0e5);color:var(--coral);}
  .tl-staff-unassigned .role-mini{color:var(--ink-soft);}
  /* スタッフ行はrelativeで予約ブロックをabsolute配置 */
  .tl-row-track{display:contents;}
  /* 行エリア: スタッフ列(col1)の右(col2/-1)。予約は中の独立レイヤーで描画し z-index:1 で固定列(z55)の下層に閉じ込め＝透け防止 (schedule方式) */
  .tl-row-area{grid-column:2 / -1;position:relative;display:grid;grid-template-columns:repeat(24, minmax(96px, 1fr));gap:1px;z-index:1;}
  .tl-cell{background:var(--white);min-height:94px;cursor:pointer;transition:background .15s;position:relative;}
  .tl-cell:hover{background:var(--foam);}
  .tl-cell.shift-bg{background:linear-gradient(180deg,#eaf6f9,#f4fbfd);}
  /* 予約ブロックは、各スタッフの最初のセルに配置して absolute で広げる */
  .tl-bk-wrap{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;}
  .tl-booking{position:absolute;background:linear-gradient(135deg,#e0743c,#c9551f);color:#fff;border-radius:6px;padding:2px;font-size:.72rem;line-height:1.25;overflow:hidden;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.15);z-index:2;display:flex;flex-direction:column;gap:1px;}
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
  /* 住所コピーできることが分かるよう、触れたら下線 */
  .tl-booking .bk-place:hover,.tl-booking .bk-venue:hover{text-decoration:underline dotted;text-underline-offset:2px;}
  /* 5段目: ドライバー名（左=行き / 右=帰り、クリックで送迎コピー） */
  .tl-booking .bk-bottom{display:flex;gap:2px;}
  .tl-booking .bk-go,.tl-booking .bk-back{flex:1;min-width:0;border:none;border-radius:4px;background:rgba(255,255,255,.25);color:#fff;font-size:.64rem;font-weight:700;line-height:1.15;padding:2px 3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
  .tl-booking .bk-go:hover,.tl-booking .bk-back:hover{background:rgba(255,255,255,.42);}
  .tl-booking .bk-self{opacity:.8;font-weight:600;}
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
  /* 「この時刻で始」＝接客開始まで一気に。開始は経理に計上されるので緑で区別する */
  .tl-time-pop .ttp-start{margin-top:.4rem;border-color:#1f7a45;background:#1f7a45;}
  .tl-time-pop .ttp-mail{margin-top:.5rem;width:100%;border:1.5px solid var(--coral,#e8896b);background:var(--coral,#e8896b);color:#fff;border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.85rem;cursor:pointer;}
  .tl-time-pop .ttp-mail:hover{filter:brightness(1.08);}
  .tl-time-pop .ttp-copy{margin-top:.4rem;width:100%;border:1.5px solid var(--sea);background:var(--sea);color:#fff;border-radius:8px;padding:.45rem .6rem;font-weight:700;font-size:.85rem;cursor:pointer;}
  .tl-time-pop .ttp-copy:hover{filter:brightness(1.08);}

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
  body[data-theme="soft"] .tl-booking{background:#f1f2f0;color:#3a4247;border-left:4px solid #9aa3a0;
    box-shadow:0 1px 3px rgba(20,30,25,.10);}
  body[data-theme="soft"] .tl-booking:hover{box-shadow:0 3px 9px rgba(20,30,25,.20);}
  body[data-theme="soft"] .tl-booking.s-inquiry{background:#eef1f5;color:#3f5164;border-left-color:#7d94ab;}
  body[data-theme="soft"] .tl-booking.s-reserved{background:#fdeee4;color:#8f4318;border-left-color:#d9743c;}
  body[data-theme="soft"] .tl-booking.s-pre_reserved{background:#f4ecf8;color:#5b3f73;border-left-color:#9b6db0;}
  body[data-theme="soft"] .tl-booking.s-on_hold,
  body[data-theme="soft"] .tl-booking.s-pending{background:#fdf4dd;color:#6f5210;border-left-color:#e0a92f;}
  body[data-theme="soft"] .tl-booking.s-completed{background:#e4f1ee;color:#1b6152;border-left-color:#2e9c81;}
  body[data-theme="soft"] .tl-booking.svc-ended{background:#e9f0e2;color:#3a6330;border-left-color:#5c9a48;}
  body[data-theme="soft"] .tl-booking.s-cancelled{background:#f1f1ef;color:#767d79;border-left-color:#b9beba;}
  body[data-theme="soft"] .tl-booking.s-no_show{background:#fbebe9;color:#98392f;border-left-color:#cd6357;}
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
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-started,
  body[data-theme="soft"] .tl-booking .bk-svc-sel.svc-ended{background-color:#1f7a45;color:#fff;border-color:#1f7a45;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23fff' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
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
  .sh-tt-row .sh-tt-stchip.is-on[data-status="available"]{background:linear-gradient(135deg,#5fc28e,var(--green));color:#fff;border-color:transparent;box-shadow:0 2px 6px rgba(58,154,96,.3);}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="tentative"]{background:linear-gradient(135deg,#f7c25c,#e6a93a);color:#fff;border-color:transparent;box-shadow:0 2px 6px rgba(230,169,58,.3);}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="off"]{background:linear-gradient(135deg,#7a7e83,#4a4e53);color:#fff;border-color:transparent;box-shadow:0 2px 6px rgba(0,0,0,.2);}
  .sh-tt-row .sh-tt-stchip.is-on[data-status="unreg"]{background:linear-gradient(135deg,#d8dde2,#a8b2b8);color:#fff;border-color:transparent;box-shadow:0 2px 6px rgba(0,0,0,.15);font-style:italic;}
  /* 未登録は背景を薄く + 時刻入力をプレースホルダー扱い (時刻は事前入力可能) */
  .sh-tt-row.is-unreg{background:linear-gradient(90deg,#fafafa,#fff);}
  .sh-tt-row.is-unreg .sh-tt-24h,.sh-tt-row.is-unreg .sh-tt-start,.sh-tt-row.is-unreg .sh-tt-end,.sh-tt-row.is-unreg .sh-tt-memo{opacity:.7;}
  .sh-tt-row.is-unreg .sh-tt-24h:hover,.sh-tt-row.is-unreg .sh-tt-start:focus,.sh-tt-row.is-unreg .sh-tt-end:focus,.sh-tt-row.is-unreg .sh-tt-memo:focus{opacity:1;}
  .sh-tt-row.is-off-only .sh-tt-24h,.sh-tt-row.is-off-only .sh-tt-start,.sh-tt-row.is-off-only .sh-tt-end{display:none;}
  .sh-toolbar{background:#fff;padding:1rem 1.5rem;border-bottom:1px solid var(--gray);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.7rem;}
  .sh-toolbar select{padding:.45rem .85rem;border:1.5px solid var(--gray);border-radius:8px;font-size:.9rem;}
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
  .sh-shift-pill{font-size:.7rem;padding:.15rem .4rem;border-radius:5px;background:linear-gradient(135deg,var(--aqua),var(--sea));color:#fff;line-height:1.3;}
  .sh-shift-pill.s-off{background:#cdd2d6;color:#fff;}
  .sh-shift-pill.s-tentative{background:#ffd9bf;color:#a45;}
  .sh-timetable{padding:1rem 1.5rem;max-width:1100px;margin:0 auto;}
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
    .modal-header{padding:1rem 1.1rem .8rem!important;}
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
    #bmDateTimeRow{grid-template-columns:1fr 1fr 1fr!important;gap:.3rem!important;}
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
    .tl-grid{grid-template-columns:184px repeat(24, minmax(72px, 1fr))!important;min-width:1937px;border-radius:4px!important;}
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
    #view-timeline .tl-toolbar .tl-nav button#tlCashSummary{margin-left:0!important;}
    /* タイムライン日付ヘッダー */
    #tlTitle{font-size:.95rem;}
    /* クイック電話ブロック: ラベル(📞のみ)＋①②を全部1行に収める */
    .tl-phone-quick{flex-direction:row;flex-wrap:nowrap;align-items:center;gap:.25rem;padding:.4rem .45rem;width:100%;box-sizing:border-box;}
    .tl-phone-quick .pq-label{flex:0 0 auto;font-size:.7rem;}
    .tl-phone-quick .pq-label .pq-txt{display:none;}
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
      <button class="tab-btn" data-view="courses">マスタ</button>
      <button class="tab-btn" data-view="chat" style="display:none;">💬 チャット<span id="chatUnreadBadge" class="tab-badge" style="display:none;">0</span></button>
      <button class="tab-btn" data-view="staffboard" style="display:none;">👥 キャスト管理</button>
      <button class="tab-btn" data-view="payroll" style="display:none;">💰 経理</button>
      <button class="tab-btn" data-view="settlement" style="display:none;">💴 入金</button>
      <button class="tab-btn" data-view="staff" style="display:none;">スタッフ管理</button>
      <button class="tab-btn owner-only" data-view="permissions">権限管理</button>
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
        <span class="entry-desc">タイムライン・予約・顧客・経理など店長業務</span>
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
    <div class="tl-phone-quick">
      <span class="pq-label"><span class="pq-ico">📞</span><span class="pq-txt"> クイック予約</span></span>
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
      <button id="tlPrev">◀ 前日</button>
      <input type="date" id="tlDatePicker">
      <button id="tlToday">今日</button>
      <button id="tlNext">翌日 ▶</button>
      <button id="tlCashSummary" style="margin-left:.3rem;">💰 まとめ</button>
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
        <option value="cancelled">キャンセル</option>
        <option value="no_show">無連絡</option>
        <option value="break">💤 休憩</option>
      </select>
      <input type="search" id="bkKeyword" placeholder="顧客名・ホテルで検索" style="padding:.7rem 1rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;">
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
      <input type="search" id="cuKeyword" placeholder="名前・電話・メールで検索" style="padding:.5rem .8rem;border:1.5px solid var(--gray);border-radius:8px;font-size:16px;">
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
      <select id="shStaffFilter" class="owner-only" style="display:none;"><option value="">全スタッフ</option></select>
      <button id="shPrev">← 前へ</button>
      <button id="shToday">今日から</button>
      <button id="shNext">次へ →</button>
    </div>
  </div>
  <div id="shTimetable" class="sh-timetable"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
  <div id="shCalendar" class="sh-calendar" style="display:none;"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
</div>

<!-- ========== コース管理ビュー ========== -->
<div class="view" id="view-courses">
  <!-- ホテル管理（旧タブ→マスタ内へ移動。クリックで view-hotel に切替） -->
  <div class="tl-toolbar">
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
      <h3>💰 現金まとめ</h3>
      <button class="modal-close" data-close="cashSummaryModal">×</button>
    </div>
    <div class="modal-body" id="cashSummaryBody"></div>
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
      <div class="field">
        <label for="coHotelPrice">ホテル料金（円）</label>
        <input type="text" inputmode="numeric" data-money placeholder="11000" id="coHotelPrice">
        <span class="hint">予約で「🏨 ホテル料金」にチェックを入れたとき、この料金に置き換えます（空欄なら通常料金から一律 −¥5,500）</span>
      </div>
      <div class="field">
        <label for="coBonusCourse">＋10分のときのコース</label>
        <select id="coBonusCourse"><option value="">なし（終了時刻を10分のばすだけ）</option></select>
        <span class="hint">媒体・LINE予約にチェックが入って＋10分が付くとき、このコースに差し替えます（コース名・料金・報酬もそのコースの値になります）</span>
      </div>
      <div class="field"><label><input type="checkbox" id="coIsActive" checked style="width:auto;margin-right:.4rem;"> このコースを有効にする（予約モーダルで選択可能）</label><span class="hint">並び順は一覧でドラッグして変更できます</span></div>
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
  <div class="modal draggable" style="max-width:600px;">
    <div class="modal-header">
      <div style="flex-shrink:0;">
        <div class="mh-title" id="bmTitle">新規予約</div>
        <div class="mh-sub" id="bmSub"></div>
      </div>
      <div class="bm-head-ss" style="display:flex;gap:.4rem;align-items:center;flex:1;justify-content:center;padding:0 .9rem;">
        <select id="bmAdminId" title="担当キャスト"><option value="">担当 —</option></select>
        <select id="bmStatus" title="ステータス">
          <option value="inquiry">問合せ</option>
          <option value="reserved">予約</option>
          <option value="pre_reserved">事前予約</option>
          <option value="on_hold">保留</option>
          <option value="completed">接客完了</option>
          <option value="cancelled">キャンセル</option>
          <option value="no_show">無連絡</option>
          <option value="break">💤 休憩・私用</option>
        </select>
      </div>
      <button class="modal-minimize" title="最小化(フッターへ)" data-minimize="bookingModal">＿</button>
      <button class="modal-close" data-close="bookingModal">×</button>
    </div>
    <div class="modal-body">
      <!-- NG登録の警告。電話番号で顧客が当たった瞬間・担当を選んだ瞬間に一番上で目に入る位置 -->
      <div id="bmNgAlert" class="bm-ng-alert"></div>
      <div id="bmNgCastAlert" class="bm-ng-alert"></div>
      <!-- 担当キャストの注意事項。担当を選んだ瞬間に一番上で目に入る位置に置く -->
      <div id="bmCastAlert" class="bm-cast-alert" style="display:none;"></div>
      <label id="bmBreakModeLabel" style="display:none;align-items:center;gap:.5rem;font-weight:700;font-size:.88rem;cursor:pointer;background:linear-gradient(135deg,#fff8ef,#ffeada);color:#a85a3a;padding:.55rem .75rem;border-radius:10px;margin-bottom:1rem;border:1px solid #f3c9a8;">
        <input type="checkbox" id="bmBreakMode"> 💤 休憩・私用予定として登録(公開ページには「ご予約済」のみ表示)
      </label>
      <input type="hidden" id="bmCustomerId" value="">
      <!-- 電話番号 | お名前 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field bm-customer-only">
          <label for="bmCustomerPhone">電話番号</label>
          <input type="tel" id="bmCustomerPhone" placeholder="090-1234-5678" inputmode="tel">
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
          <input type="date" id="bmDate" class="bm-date" style="width:100%;box-sizing:border-box;">
        </div>
        <div class="field">
          <label>開始</label>
          <div class="time-input" style="display:flex;gap:.3rem;align-items:center;">
            <select id="bmStartHour" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">時</span>
            <select id="bmStartMin" style="flex:1;min-width:0;"></select>
            <span style="font-weight:700;color:var(--ink-soft);flex-shrink:0;">分</span>
          </div>
        </div>
        <div class="field">
          <label id="bmEndLabel">終了 (自動計算)</label>
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
      <div id="bmLocTypeRow" style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field" id="bmCityField">
          <label for="bmCity">市区町村</label>
          <select id="bmCity"><option value="">— すべて —</option></select>
        </div>
        <div class="field">
          <label>訪問先タイプ</label>
          <div style="display:flex;gap:.3rem;background:var(--foam);padding:.4rem;border-radius:10px;">
            <label class="loc-tab"><input type="radio" name="bmLocType" value="hotel" checked><span>ホテル</span></label>
            <label class="loc-tab"><input type="radio" name="bmLocType" value="home"><span>自宅・オフィス</span></label>
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
        <div class="field">
          <label for="bmHotelName">ホテル名(手入力 / リストにない場合)</label>
          <input type="text" id="bmHotelName" placeholder="例: ○○ホテル立川店">
        </div>
      </div>

      <!-- 自宅・オフィス -->
      <div class="loc-section" data-loc="home" style="display:none;">
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
        <!-- リピーターの「よく使う場所」を自動入力したときの案内（手入力したら消える） -->
        <span class="hint" id="bmUsualLocNote" style="display:none;color:#1d6b39;font-weight:600;margin-top:-.6rem;margin-bottom:1.1rem;"></span>
      </div>

      <!-- その他 -->
      <div class="loc-section" data-loc="other" style="display:none;">
        <div class="field">
          <label for="bmOtherLoc">場所の詳細</label>
          <textarea id="bmOtherLoc" placeholder="場所の詳細を自由に記入"></textarea>
        </div>
      </div>

      <!-- 流入媒体・予約経路。どれかにチェックが入ると＋10分(無料)（アドミの特典。既定は未チェック） -->
      <div class="field bm-media-field" id="bmMediaField">
        <label class="bm-media-label">媒体<label id="bmPlus10Field" class="bm-plus10" title="お店が初めてのお客様の媒体経由、またはLINE予約に＋10分。手で外せます"><input type="checkbox" id="bmPlus10"><span>＋10分（無料）</span></label></label>
        <div class="bm-media-list">
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="fujoho"><span>情報局</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="ekichika"><span>駅ちか</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="heaven"><span>ヘブン</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="fuzoku"><span>風じゃ</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="deli"><span>デリじゃ</span></label>
          <label class="bm-media"><input type="checkbox" name="bmMedia" value="other"><span>その他</span></label>
          <label class="bm-media is-line" title="チェックが入ると＋10分(無料)"><input type="checkbox" name="bmMedia" value="line"><span>LINE</span></label>
        </div>
      </div>
      <label id="bmHotelFirstField" style="display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem;background:linear-gradient(135deg,#eef4ff,#fff);border:1.5px solid #9db8e8;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#28468a;margin-top:.2rem;">
        <input type="checkbox" id="bmHotelFirst" style="width:18px;height:18px;cursor:pointer;">
        <span>🏨 ホテル料金 <b id="bmHotelFirstAmt">−¥5,500</b> <span id="bmHotelFirstHint" style="font-weight:500;opacity:.8;"></span><span id="bmHotelFirstWarn" class="bm-hf-warn" style="display:none;"></span></span>
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
      <!-- オプション（ローター・バイブ等）。選ぶと合計に加算される。マスタは「マスタ」タブで編集 -->
      <div class="field" id="bmOptionField">
        <label class="bm-media-label">オプション<span class="bm-media-note" id="bmOptionSum"></span></label>
        <div class="bm-media-list" id="bmOptionList"><span class="hint">オプションが登録されていません（マスタタブで追加できます）</span></div>
      </div>

      <div class="field" id="bmExtField"><label>延長（追加加算）</label>
        <div style="display:flex;align-items:center;gap:.5rem;">
          <span style="font-weight:600;color:var(--ink);white-space:nowrap;">延長30分 ✕</span>
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
          <span class="hint" id="bmExtInfo" style="margin-top:0;"></span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="bmPrice">コース料金(円)</label><input type="text" inputmode="numeric" data-money id="bmPrice"></div>
        <div class="field"><label for="bmTransport">交通費(円)</label>
          <select id="bmTransport"><option value="0">なし(¥0)</option><option value="550">¥550</option><option value="1100">¥1,100</option><option value="1650">¥1,650</option><option value="2200">¥2,200</option><option value="2750">¥2,750</option><option value="3300">¥3,300</option><option value="3850">¥3,850</option><option value="4400">¥4,400</option><option value="4950">¥4,950</option><option value="5500">¥5,500</option><option value="6050">¥6,050</option><option value="6600">¥6,600</option><option value="7150">¥7,150</option><option value="7700">¥7,700</option><option value="8250">¥8,250</option><option value="8800">¥8,800</option><option value="9350">¥9,350</option><option value="9900">¥9,900</option><option value="10450">¥10,450</option><option value="11000">¥11,000</option></select>
        </div>
      </div>
      <div class="field" id="bmBreakCityField" style="display:none;"><label for="bmBreakCity">エリア (公開タイムライン表示用)</label>
        <input type="text" id="bmBreakCity" placeholder="立川市" autocomplete="off" style="width:14em;">
        <span class="hint" style="margin-top:.3rem;">未入力なら「立川」と表示されます。例: 八王子市 → 八王子</span>
      </div>
      <!-- キャンペーン割引 — チェックでコース料金 10%OFF -->
      <label id="bmCampaignField" style="display:none;align-items:center;gap:.5rem;padding:.6rem .8rem;background:linear-gradient(135deg,#ffeef0,#fff);border:1.5px solid #f0a0ad;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#a82a44;margin-top:-.2rem;">
        <input type="checkbox" id="bmCampaign" style="width:18px;height:18px;cursor:pointer;">
        <span>🎁 キャンペーン割引 <b>コース料金 10%OFF</b> <span id="bmCampaignAmt" style="font-weight:500;opacity:.8;"></span></span>
      </label>
      <!-- 初回ホテル特別料金 — ホテル利用×そのキャストと初対面で コース料金から一律5,500円引き。
           コースが何分でも、90+90の組み合わせでも 1予約につき1回だけ。担当・訪問先・お客様が
           決まると自動でチェックが入る（手で触ったら以後は自動で動かさない） -->
      <!-- スタンプ特典 — コース料金(キャンペーン割引後)から特典時間ぶんを按分割引。特典時間≥コース時間なら全額無料 -->
      <div id="bmStampField" style="display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem;background:linear-gradient(135deg,#fff0f6,#fff);border:1.5px solid #e7a6c4;border-radius:8px;font-size:.88rem;font-weight:600;color:#9a3a6a;margin-top:-.2rem;">
        <span>🎟️ スタンプ特典</span>
        <select id="bmStampReward" style="font-size:.85rem;padding:.25rem .5rem;border-radius:6px;border:1px solid #e7a6c4;background:#fff;color:#9a3a6a;font-weight:600;cursor:pointer;">
          <option value="">なし</option>
          <option value="30">30分</option>
          <option value="60">60分</option>
          <option value="90">90分</option>
        </select>
        <span id="bmStampAmt" style="font-weight:500;opacity:.85;margin-left:auto;"></span>
      </div>
      <!-- 深夜料金 (23:00〜翌5:00) — チェックで合計に +¥3,300 -->
      <label id="bmLateNightField" style="display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem;background:linear-gradient(135deg,#fff5e8,#fff);border:1.5px solid #f0c98e;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;color:#7a4a00;margin-top:-.2rem;">
        <input type="checkbox" id="bmLateNight" style="width:18px;height:18px;cursor:pointer;">
        <span>🌙 深夜料金 <b>+¥3,300</b> <span style="font-weight:500;opacity:.8;">(23:00〜翌5:00)</span></span>
      </label>
      <div class="field" id="bmPaymentField">
        <label>支払方法</label>
        <input type="hidden" id="bmPayment" data-pay-hidden value="cash">
        <div class="em-status" style="grid-template-columns:1fr 1fr;">
          <button class="sbtn v-unset active" data-pay-btn data-pay="cash" type="button">💴 現金</button>
          <button class="sbtn v-unset" data-pay-btn data-pay="credit" type="button">💳 クレジット</button>
          <button class="sbtn v-unset" data-pay-btn data-pay="bank" type="button">🏦 銀行振込</button>
          <button class="sbtn v-unset" data-pay-btn data-pay="" type="button">未設定</button>
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
        <label for="bmCancelType">キャンセル理由</label>
        <select id="bmCancelType">
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
      <div class="field"><label for="bmNotes">この予約のメモ <span style="font-weight:500;font-size:.72rem;color:var(--ink-soft);">キャスト・ドライバーへ</span></label><textarea id="bmNotes" placeholder="キャストやドライバーに伝えたいこと（この予約かぎり）"></textarea></div>
      <div class="field bm-customer-only">
        <label for="bmCustomerEmail">メール(任意)</label>
        <input type="email" id="bmCustomerEmail" placeholder="example@gmail.com">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="bmDelete" style="margin-right:auto;display:none;color:var(--red);border-color:var(--red);">削除</button>
      <button class="btn-secondary" id="bmCopyText" type="button" title="スタッフ用: 電話・送迎・メモ等も含む詳細">スタッフ用</button>
      <button class="btn-secondary" id="bmCopyCustomerText" type="button" title="お客様送信用: 予約確認の文面をコピー" style="color:var(--sea,#1d7a9c);border-color:var(--sea,#1d7a9c);">お客様用</button>
      <button class="btn-secondary" data-close="bookingModal">閉じる</button>
      <button class="btn-primary" id="bmSave">保存</button>
    </div>
    <!-- 予約内容サマリーバー（モーダル下端に固定・入力に連動して自動更新） -->
    <div id="bmFooterSummary" class="bm-summary-bar">
      <span id="bmSummaryMain" class="bm-sum-main"></span>
      <span id="bmSummaryTotal" class="bm-sum-total"></span>
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
      <div class="field owner-only" id="smStaffField" style="display:none;">
        <label for="smStaff">対象スタッフ</label>
        <select id="smStaff"></select>
      </div>
      <label style="display:flex;align-items:center;gap:.5rem;font-weight:600;margin:.4rem 0 .6rem;cursor:pointer;font-size:.9rem;">
        <input type="checkbox" id="sm24h"> 24時間（10:00〜翌10:00）
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="field"><label for="smStart">開始時刻</label><input type="time" id="smStart" value="10:00"></div>
        <div class="field"><label for="smEnd">終了時刻</label><input type="time" id="smEnd" value="22:00"></div>
      </div>
      <div class="field"><label for="smStatus">状態</label>
        <select id="smStatus">
          <option value="available">出勤可</option>
          <option value="tentative">仮（要調整）</option>
          <option value="off">休み</option>
        </select>
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
    <select id="fCity"><option value="">全市区町村</option></select>
    <select id="fStatus">
      <option value="">ステータス: すべて</option>
      <option value="visited">実績あり</option>
      <option value="inquiry">要問合せ</option>
      <option value="unavailable">不可</option>
      <option value="unset">未設定</option>
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
      <button class="btn-bulk-delete" id="btnBulkDelete">リストから削除</button>
      <button class="btn-bulk-clear" id="btnBulkClear">選択解除</button>
    </div>
  </div>
</div>

<main class="main">
  <div class="results-bar">
    <div class="count"><b id="resultCount">0</b>件のホテル</div>
    <div class="count" id="filterNote"></div>
    <button id="btnHotelAdd" class="btn-edit" style="margin-left:auto;">＋ ホテルを追加</button>
  </div>
  <div id="hotelList"><div class="loading"><span class="spinner"></span><br><br>読み込み中...</div></div>
</main>

</div>
<!-- /view-hotel -->

<!-- 🚉 駅マスタ ビュー（マスタ内から開く） -->
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

<!-- 💬 チャット ビュー (owner専用) -->
<div class="view" id="view-chat">
  <main class="chat-admin">
    <div class="chat-admin-head">
      <h2>💬 チャット</h2>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
        <label style="font-size:.85rem;color:var(--ink-soft);display:flex;align-items:center;gap:.4rem;cursor:pointer;">
          <input type="checkbox" id="caOnlineToggle" style="width:18px;height:18px;cursor:pointer;">
          <span>オンライン受付</span>
        </label>
        <button class="btn-secondary" id="caPushBtn" type="button" title="この端末でチャット通知を受け取る">🔔 通知をON</button>
        <button class="btn-secondary" id="caSettings">⚙️ 設定</button>
      </div>
    </div>
    <div class="chat-admin-grid">
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
          <button class="sbtn v-unset ac-range" data-range="today" type="button">今日</button>
          <button class="sbtn v-unset ac-range" data-range="yesterday" type="button">前日</button>
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
      <p style="color:var(--ink-soft);font-size:.85rem;margin-bottom:1rem;">対象 = <b>完了</b>予約のみ。報酬 = <b>マスタでコースごとに設定したキャスト報酬</b> ＋ 交通費（自走分）＋ 深夜料金。<b>交通費</b>＝送迎した片道は片道850円〜がお店、行き帰り両方送迎なら全額お店。<b>深夜料金</b>＝帰りのお迎えがあった場合は全額お店、お迎えなしは全額キャスト。</p>
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
          <button class="sbtn v-unset ms-range" data-range="today" type="button">今日</button>
          <button class="sbtn v-unset ms-range" data-range="yesterday" type="button">前日</button>
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
        <label for="csEmail">メールアドレス</label>
        <input type="text" id="csEmail" placeholder="example@gmail.com">
        <span class="hint">このアドレスでログインします</span>
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
          <button class="sbtn v-inquiry" data-role-btn data-role="manager" type="button">店長</button>
          <button class="sbtn v-unavailable" data-role-btn data-role="owner" type="button">オーナー</button>
        </div>
      </div>
      <div class="field">
        <label>兼任（主となる権限とは別に、複数の業務を兼ねる場合はチェック）</label>
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.3rem;">
          <input type="checkbox" id="csIsTherapist" style="width:18px;height:18px;cursor:pointer;">
          <span>💆 キャスト業務も兼任する</span>
        </label>
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
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
      <div class="field">
        <label for="esEmail">メールアドレス（ログインID兼 送迎メール送信先）</label>
        <input type="email" id="esEmail" placeholder="example@gmail.com">
        <span class="hint">送迎情報のメール送信先になります。変更するとログインIDも変わります</span>
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
            <button class="sbtn v-inquiry" data-es-role="manager" type="button">店長</button>
            <button class="sbtn v-unavailable" data-es-role="owner" type="button">オーナー</button>
          </div>
          <span class="hint" id="esRoleHint"></span>
        </div>
        <div class="field">
          <label>兼任（主となる権限とは別に、複数の業務を兼ねる場合はチェック）</label>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.3rem;">
            <input type="checkbox" id="esIsTherapist" style="width:18px;height:18px;cursor:pointer;">
            <span>💆 キャスト業務も兼任する</span>
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;margin-top:.5rem;">
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
      <div class="field">
        <label for="emName">ホテル名</label>
        <input type="text" id="emName" placeholder="例: シティ">
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
        <!-- 予約モーダルの交通費と同じ550円刻み。無料(0円)と未設定(表示なし)は別物 -->
        <select id="emTransportFee">
          <option value="">— 未設定（表示なし）—</option>
          <option value="0">🆓 無料（¥0）</option>
          <option value="550">¥550</option><option value="1100">¥1,100</option><option value="1650">¥1,650</option><option value="2200">¥2,200</option><option value="2750">¥2,750</option><option value="3300">¥3,300</option><option value="3850">¥3,850</option><option value="4400">¥4,400</option><option value="4950">¥4,950</option><option value="5500">¥5,500</option><option value="6050">¥6,050</option><option value="6600">¥6,600</option><option value="7150">¥7,150</option><option value="7700">¥7,700</option><option value="8250">¥8,250</option><option value="8800">¥8,800</option><option value="9350">¥9,350</option><option value="9900">¥9,900</option><option value="10450">¥10,450</option><option value="11000">¥11,000</option>
        </select>
        <span class="hint">ホテルを選ぶと、予約画面の交通費にこの金額が初期値で入ります</span>
      </div>
      <div class="field">
        <label for="emGuide">公開ガイドノート</label>
        <textarea id="emGuide" placeholder="例: フロントに「YLKAから」とお伝えください"></textarea>
        <span class="hint">公開ページに表示される呼び方ガイド</span>
      </div>
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
