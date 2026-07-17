<?php
// ==========================================================================
// _html-text.php — お知らせHTML → プレーンテキスト抽出（媒体投稿・コピペ用）
//   ★ ctrl/news-edit.php の「📋 コピペ用テキスト」タブの htmlToPlainText(JS) と同一アルゴリズム。
//     タブはブラウザ内の「保存前の編集中テキスト」を即時変換する必要があるため JS、
//     API(bot向け)はサーバー側のため PHP と、実行環境の都合で二重実装になっている。
//     ⚠️ どちらかを変更したら必ずもう片方も合わせること（受け入れテストで実データ一致を検証済み）。
//   仕様: references/CLAUDE-NEWS-API.md §3.1
//     - <style>/<script>/HTMLコメント/<img> を除去
//     - <br>・ブロック要素 → 改行、<hr> → 罫線、連続空行は圧縮
//     - <a> はリンク文言の次行に URL を併記（$withUrls=false ならURL全削除＝コピペ用タブと同じ）
//     - &nbsp;→半角空白、実体参照はデコード（絵文字維持）
// ==========================================================================
declare(strict_types=1);

/**
 * @param string $html     お知らせ本文HTML
 * @param bool   $withUrls true=リンクURLを文言の次行に併記（情報局速報用・仕様既定）
 *                         false=URLを全削除（コピペ用タブと同一。URL不可の媒体向け）
 */
function news_html_to_text(string $html, bool $withUrls = true): string {
    $doc = new DOMDocument();
    // UTF-8を明示（XML宣言トリック）。壊れたHTMLでも黙って読む
    @$doc->loadHTML('<?xml encoding="utf-8"?><div id="__news_root">' . $html . '</div>',
        LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    $root = $doc->getElementById('__news_root');
    if (!$root) return '';

    $block = '/^(div|p|h[1-6]|li|tr|section|article|header|footer|blockquote|pre|table|ul|ol|figure)$/i';
    $out = '';
    $walk = function (DOMNode $node) use (&$walk, &$out, $block, $withUrls) {
        foreach ($node->childNodes as $n) {
            if ($n->nodeType === XML_TEXT_NODE) {
                // JS側の n.nodeValue.replace(/\s+/g,' ') と同じ（JSの\sはnbsp含むため先にnbsp→空白）
                $out .= preg_replace('/\s+/u', ' ', str_replace("\u{00A0}", ' ', $n->nodeValue));
                continue;
            }
            if ($n->nodeType !== XML_ELEMENT_NODE) continue;   // コメント等は無視
            $tag = strtolower($n->nodeName);
            if ($tag === 'style' || $tag === 'script') continue;
            if ($tag === 'br')  { $out .= "\n"; continue; }
            if ($tag === 'hr')  { $out .= "\n────────\n"; continue; }
            if ($tag === 'img') { continue; }
            $isBlock = (bool)preg_match($block, $tag);
            if ($isBlock) $out .= "\n";
            $walk($n);
            if ($tag === 'a' && $withUrls) {
                $href = $n instanceof DOMElement ? $n->getAttribute('href') : '';
                if (preg_match('#^https?://#i', $href)) $out .= "\n" . $href;
            }
            if ($isBlock) $out .= "\n";
        }
    };
    $walk($root);

    if (!$withUrls) {
        // 本文中の裸URLも削除（文字クラスは chat.js linkify と同じ＝日本語を巻き込まない）
        $out = preg_replace('#https?://[A-Za-z0-9\-._~:/?\#\[\]@!$&\'()*+,;=%]+#i', '', $out);
        $out = preg_replace('#\bwww\.[A-Za-z0-9\-._~:/?\#\[\]@!$&\'()*+,;=%]+#i', '', $out);
    }
    $out = str_replace("\u{00A0}", ' ', $out);
    $out = preg_replace('/[ \t]{2,}/', ' ', $out);
    $lines = array_map('trim', explode("\n", $out));
    $out = implode("\n", $lines);
    $out = preg_replace("/\n{3,}/", "\n\n", $out);
    return trim($out);
}

/**
 * HTML本文からURLだけを除去する（駅ちか用: CSS・レイアウトは残すがURLは掲載不可）。
 *   - <a> は <span> に変換（style/class 等の見た目属性は維持・href/target/rel だけ捨てる）
 *     ＝ボタン風にデザインされたリンクも見た目そのまま文言だけ残る
 *   - テキスト中の裸URL(http(s)://・www.)も削除（文字クラスは chat.js linkify と同じ）
 *   - それ以外のタグ・インラインCSS・<style> はそのまま
 */
function news_html_strip_urls(string $html): string {
    if (trim($html) === '') return '';
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?><div id="__news_root">' . $html . '</div>',
        LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    $root = $doc->getElementById('__news_root');
    if (!$root) return $html;

    // <a> → <span>（子孫のaも含めて全部。NodeListはliveなので配列化してから処理）
    $anchors = [];
    foreach ($root->getElementsByTagName('a') as $a) $anchors[] = $a;
    foreach ($anchors as $a) {
        $span = $doc->createElement('span');
        foreach ($a->attributes as $attr) {
            if (in_array(strtolower($attr->name), ['href', 'target', 'rel'], true)) continue;
            $span->setAttribute($attr->name, $attr->value);
        }
        while ($a->firstChild) $span->appendChild($a->firstChild);
        $a->parentNode->replaceChild($span, $a);
    }

    // テキストノード中の裸URLを削除（<style>/<script>内は触らない＝CSSのurl()等を壊さない）
    $xp = new DOMXPath($doc);
    foreach ($xp->query('//text()[not(ancestor::style) and not(ancestor::script)]', $root) as $t) {
        $v = preg_replace('#https?://[A-Za-z0-9\-._~:/?\#\[\]@!$&\'()*+,;=%]+#i', '', $t->nodeValue);
        $v = preg_replace('#\bwww\.[A-Za-z0-9\-._~:/?\#\[\]@!$&\'()*+,;=%]+#i', '', $v);
        if ($v !== $t->nodeValue) $t->nodeValue = $v;
    }

    // ルートの中身だけをHTMLとして書き出し
    $out = '';
    foreach ($root->childNodes as $child) $out .= $doc->saveHTML($child);
    return $out;
}
