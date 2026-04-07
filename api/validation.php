<?php
/**
 * validation.php — 投稿コンテンツバリデーション（共通）
 *
 * validateComment($comment, $posterName) を呼び出すと:
 * - errors: ブロック理由（URL/メール/電話/LINE） → 投稿拒否
 * - flags: フラグ理由（NGワード） → 投稿は通すがコメントにフラグ付与
 */

/**
 * @param string|null $comment コメント本文
 * @param string|null $posterName 投稿者名
 * @return array ['errors' => string[], 'flags' => string[]]
 */
function validateComment(?string $comment, ?string $posterName): array {
    $errors = [];
    $flags = [];
    $targets = array_filter([$comment, $posterName]);

    foreach ($targets as $text) {
        // URL検出
        if (preg_match('/https?:\/\/|www\./i', $text)) {
            $errors[] = 'URLの記載は禁止されています';
        }
        // メールアドレス検出
        if (preg_match('/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', $text)) {
            $errors[] = 'メールアドレスの記載は禁止されています';
        }
        // 電話番号検出（携帯・フリーダイヤル・連続数字10桁以上）
        if (preg_match('/0[789]0[\-\s]?\d{4}[\-\s]?\d{4}|0120[\-\s]?\d{3}[\-\s]?\d{3}|\d{10,}/', $text)) {
            $errors[] = '電話番号の記載は禁止されています';
        }
        // SNS ID検出（LINE, X/Twitter, Instagram等）
        if (preg_match('/@[a-zA-Z0-9_]{3,}|line\.me\/|instagram\.com\/|twitter\.com\/|x\.com\//i', $text)) {
            $errors[] = 'SNSアカウントID等の記載は禁止されています';
        }
    }

    // NGワード検出（フラグのみ、ブロックしない）
    if ($targets) {
        $ngWords = loadNgWords();
        $combined = implode(' ', $targets);
        $matched = [];
        foreach ($ngWords as $word) {
            if ($word && mb_stripos($combined, $word) !== false) {
                $matched[] = $word;
            }
        }
        if ($matched) {
            $flags[] = '[要確認] NGワード検出: ' . implode(', ', array_slice($matched, 0, 3));
        }
    }

    // errors の重複排除
    $errors = array_unique($errors);

    return ['errors' => array_values($errors), 'flags' => array_values($flags)];
}

/**
 * NGワードリスト読み込み（キャッシュ付き）
 */
function loadNgWords(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $path = __DIR__ . '/ng-words.json';
    if (!file_exists($path)) return $cache = [];
    $data = json_decode(file_get_contents($path), true);
    return $cache = is_array($data) ? $data : [];
}

/**
 * NGワードリスト保存
 */
function saveNgWords(array $words): bool {
    $path = __DIR__ . '/ng-words.json';
    $words = array_values(array_unique(array_filter(array_map('trim', $words))));
    sort($words);
    return file_put_contents($path, json_encode($words, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false;
}
