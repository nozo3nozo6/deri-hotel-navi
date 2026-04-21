// =========================================================
// YobuChat DO 型定義
// PHP側 chat-api.php の okBatch() 形状と一致させる（WS push時も同形）
// =========================================================

export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  NOTIFY_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  CHAT_NOTIFY_SECRET?: string;
  CHAT_SYNC_SECRET?: string;
}

// ===== メッセージ =====

export type SenderType = 'visitor' | 'shop';

export interface ChatMessage {
  id: number;                   // DO内の連番 (session単位)
  session_id: number;           // DO内のセッション連番
  sender_type: SenderType;
  message: string;
  client_msg_id?: string;       // 冪等化用 (UUID v4)
  sent_at: string;              // ISO8601
  read_at?: string | null;      // 相手が既読にした時刻
}

// ===== セッション =====

export type SessionStatus = 'open' | 'closed';

export interface ChatSession {
  id: number;                   // DO内のセッション連番
  session_token: string;        // クライアント側localStorageのUUID
  visitor_hash: string;         // IP+UA ハッシュ
  nickname?: string;
  lang?: string;
  started_at: string;
  last_activity_at: string;
  last_visitor_heartbeat_at?: string;
  last_owner_heartbeat_at?: string;
  closed_at?: string | null;
  status: SessionStatus;
  source: 'portal' | 'widget' | 'standalone';
  notified_at?: string | null;  // 初回メール通知済み
  blocked: boolean;
  // キャスト指名 (?cast=<shop_casts.id>): 有効なら cast_id/cast_name がセットされる.
  // shop_cast_id = shop_casts.id, cast_id = casts.id (通知ルーティング用)
  shop_cast_id?: string | null;
  cast_id?: string | null;
  cast_name?: string | null;
}

// ===== 店舗ステータス =====

export interface ShopStatus {
  shop_id: string;              // UUID
  is_online: boolean;
  last_online_at?: string;
  notify_mode: 'first' | 'every' | 'off';
  notify_min_interval_minutes: number;
  auto_off_minutes: number;
  reception_start?: string;     // HH:MM
  reception_end?: string;       // HH:MM
  welcome_message?: string;
  reservation_hint?: string;
  notify_email?: string;
  slug: string;
  shop_name: string;
  email: string;
}

// ===== 統一バッチレスポンス (okBatch形状) =====

export interface BatchResponse {
  ok: boolean;
  messages: ChatMessage[];
  status: SessionStatus | null;
  shop_online: boolean | null;
  last_read_own_id: number;
  server_time: string;          // ISO8601
  // 余剰フィールド (マージ可)
  sessions?: any[];
  is_blocked?: boolean;
  session_token?: string;
  [k: string]: unknown;
}

// ===== can-connect プリゲート =====

export type CanConnectReason =
  | 'ok'
  | 'outside_hours'
  | 'closed'
  | 'blocked'
  | 'not_found'
  | 'disabled';

export interface CanConnectResult {
  ok: boolean;
  reason: CanConnectReason;
  welcome_message?: string;
  reservation_hint?: string;
  next_reception_start?: string;
  shop_name?: string;
  shop_online?: boolean;
}

// ===== DO 内部の WebSocket 接続メタ =====

export type WsRole = 'visitor' | 'owner';

export interface WsAttachment {
  role: WsRole;
  session_id?: number;          // visitor: 自分のセッションID / owner: 選択中セッションID
  session_token?: string;       // visitor のみ
  device_token?: string;        // owner のみ
  last_since_id: number;
  connected_at: number;         // UNIX ms
  heartbeat_at: number;         // UNIX ms
}
