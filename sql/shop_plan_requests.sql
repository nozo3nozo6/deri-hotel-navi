-- プラン申込管理テーブル
CREATE TABLE IF NOT EXISTS shop_plan_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    plan_id INT NOT NULL,
    requested_areas JSON,
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    admin_note TEXT,
    contract_id INT,
    agreed_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shop (shop_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
