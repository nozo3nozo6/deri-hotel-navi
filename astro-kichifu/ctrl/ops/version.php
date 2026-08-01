<?php
// version.php — admin.js の更新時刻を返す。
//   admin.js の checkAppVersion() が起動時に読み、HTML に埋まった __APP_VERSION__ と
//   食い違っていたら「古いHTMLを掴んでいる」と判断して1回だけ強制リロードする。
//   キー名は必ず "v"（admin.js が data.v を見ている。移植時に "version" にしていて
//   自動更新が無言で効かなくなっていた＝2026-08-02 の反映されない事象の一因）。
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
echo json_encode(['v' => (string)(@filemtime(__DIR__ . '/admin.js') ?: '1')]);
