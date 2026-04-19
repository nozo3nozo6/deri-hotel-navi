#!/usr/bin/env node
/**
 * YobuChat 2ファイル並存（本家 chat.html / 埋込 chat-widget-inline.template.html）の
 * 訪問者向けUIパリティを検証。
 *
 * 過去 chat.html にだけ言語セレクタ・フォントサイズ切替を追加して
 * 埋込版で機能欠落した事故を CI で検知するため。
 *
 * どちらか片方に欠けていると exit 1。
 * 新しい訪問者向けUIを chat.html に追加したら REQUIRED_VISITOR_FEATURES に1行追加すること。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHAT_HTML = path.join(ROOT, 'chat.html');
const WIDGET_TEMPLATE = path.join(ROOT, 'chat-widget-inline.template.html');
const I18N_JSON = path.join(ROOT, 'chat-i18n.json');

// 訪問者向けUIマーカー: chat.html と chat-widget-inline.template.html 両方に必須
// 片方に無い → CIで失敗 → 開発者がもう一方にも追加を強制される
const REQUIRED_VISITOR_FEATURES = [
  { name: '言語セレクタ',        chat: /id="lang-select"/,        widget: /id="ychat-lang-sel"/ },
  { name: 'フォントサイズ切替',  chat: /id="font-size-toggle"/,   widget: /id="ychat-fontsize-btn"/ },
  { name: 'オンライン状態ドット',chat: /id="chat-status-dot"/,    widget: /id="ychat-dot"/ },
  { name: 'メッセージ入力欄',    chat: /id="chat-input"/,         widget: /id="ychat-ta"/ },
  { name: '送信ボタン',          chat: /id="chat-send"/,          widget: /id="ychat-send"/ },
  { name: 'ショップ名表示',      chat: /id="chat-shop-name"/,     widget: /id="ychat-shopname"/ },
];

// i18n辞書の言語セットも一致させる
function checkLangParity(i18n) {
  const langs = Object.keys(i18n);
  if (!langs.includes('ja')) {
    return ['chat-i18n.json に "ja" が必須（フォールバック用）'];
  }
  const jaKeys = new Set(Object.keys(i18n.ja));
  const errors = [];
  for (const lang of langs) {
    if (lang === 'ja') continue;
    const langKeys = new Set(Object.keys(i18n[lang]));
    for (const k of jaKeys) {
      if (!langKeys.has(k)) errors.push(`chat-i18n.json: "${lang}" に "${k}" が欠落`);
    }
  }
  return errors;
}

function main() {
  const chat = fs.readFileSync(CHAT_HTML, 'utf8');
  const widget = fs.readFileSync(WIDGET_TEMPLATE, 'utf8');
  const i18n = JSON.parse(fs.readFileSync(I18N_JSON, 'utf8'));

  const errors = [];
  for (const f of REQUIRED_VISITOR_FEATURES) {
    const inChat = f.chat.test(chat);
    const inWidget = f.widget.test(widget);
    if (!inChat && !inWidget) {
      errors.push(`[${f.name}] chat.html / widget 両方で欠落 (${f.chat} / ${f.widget})`);
    } else if (!inChat) {
      errors.push(`[${f.name}] chat.html で欠落 (${f.chat})`);
    } else if (!inWidget) {
      errors.push(`[${f.name}] chat-widget-inline.template.html で欠落 (${f.widget})`);
    }
  }

  errors.push(...checkLangParity(i18n));

  if (errors.length) {
    console.error('✗ YobuChat パリティ違反:');
    errors.forEach(e => console.error('  -', e));
    console.error('');
    console.error('本家 chat.html / 埋込 chat-widget-inline.template.html に同じ訪問者向けUI要素が必要です。');
    console.error('機能追加・削除時は両方のファイルに反映してください。');
    process.exit(1);
  }

  console.log(`✓ YobuChat parity OK (${REQUIRED_VISITOR_FEATURES.length} visitor features, ${Object.keys(i18n).length} langs)`);
}

main();
