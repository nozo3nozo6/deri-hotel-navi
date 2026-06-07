-- ============================================================
-- ylka.jp マスタデータ（yobuho_db から完全コピー）
-- 注: 後で ylka.jp 用に絞り込み・編集可能
-- ============================================================

SET NAMES utf8mb4;

-- --- room_types (7 rows) ---
TRUNCATE TABLE `room_types`;
INSERT INTO `room_types` (`id`, `label`, `sort_order`) VALUES
  (1, 'シングル', 1),
  (2, 'セミダブル', 2),
  (3, 'ダブル', 3),
  (4, 'ツイン', 4),
  (5, '和室', 5),
  (6, 'その他', 7),
  (7, 'スイート', 6);

-- --- can_call_reasons (15 rows) ---
TRUNCATE TABLE `can_call_reasons`;
INSERT INTO `can_call_reasons` (`id`, `label`, `sort_order`) VALUES
  (1, '直通', 1),
  (2, 'ｶｰﾄﾞｷｰ必須', 4),
  (3, 'EVﾌﾛﾝﾄ階ｽｷｯﾌﾟ', 3),
  (4, 'ﾌﾛﾝﾄ相談', 14),
  (5, 'お店からのﾉｳﾊｳ秘', 10),
  (6, 'ﾊﾞｽﾀｵﾙ依頼推奨', 11),
  (7, '玄関待ち合わせ', 5),
  (8, '深夜玄関待合', 6),
  (9, '2名予約必須', 12),
  (10, 'その他', 15),
  (11, 'ｴﾚﾍﾞｰﾀｰ待ち合わせ', 8),
  (12, 'ロビー待ち合わせ', 7),
  (13, 'ﾌﾛﾝﾄ有人', 13),
  (18, '日中直通', 2),
  (19, '一緒にチェックイン', 9);

-- --- cannot_call_reasons (4 rows) ---
TRUNCATE TABLE `cannot_call_reasons`;
INSERT INTO `cannot_call_reasons` (`id`, `label`, `sort_order`) VALUES
  (1, 'フロントSTOP', 1),
  (2, '防犯カメラ確認', 2),
  (3, '深夜外出NG', 3),
  (4, 'その他', 4);

-- --- shop_service_options (1 rows) ---
TRUNCATE TABLE `shop_service_options`;
INSERT INTO `shop_service_options` (`id`, `name`, `sort_order`, `is_active`) VALUES
  (1, 'バスタオル貸出', 1, NULL);

-- --- contract_plans (8 rows) ---
TRUNCATE TABLE `contract_plans`;
INSERT INTO `contract_plans` (`id`, `name`, `price`, `description`, `slots_city`, `slots_detail_area`, `slots_spot`, `slots_prefecture`, `slots_region`, `slots_national`, `sort_order`, `cast_limit`) VALUES
  (1, '無料プラン', 0, 'テキスト表示のみ（リンクなし）', 0, 0, 0, 0, 0, 0, 1, 0),
  (2, '市区町村プラン', 11000, '市区町村エリアに掲載（1枠）', 1, 0, 0, 0, 0, 0, 3, 10),
  (3, 'ブロックプラン', 55000, 'ブロック（複数市区町村の広域）に掲載（1枠）', 0, 0, 1, 0, 0, 0, 5, 50),
  (4, '都道府県プラン', 77000, '都道府県全域に掲載（1枠）', 0, 0, 0, 1, 0, 0, 6, 70),
  (8, 'エリアプラン', 33000, 'エリア（繁華街・地域）に掲載（1枠）', 0, 1, 0, 0, 0, 0, 4, 30),
  (9, '投稿リンクプラン', 5500, '口コミ内の店舗名リンク化+サムネイル表示', 0, 0, 0, 0, 0, 0, 2, 5),
  (10, '全国プラン', 165000, '全国全エリアに掲載（1枠）', 0, 0, 0, 0, 0, 1, 8, 150),
  (13, '地方プラン', 110000, '地方（関東・関西等）全域に掲載（1枠）', 0, 0, 0, 0, 1, 0, 7, 100);
