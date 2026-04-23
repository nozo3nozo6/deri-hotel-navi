// =========================================================
// MySQL 同期レイヤー (DO → yobuho.com chat-sync.php)
// - DO が session/message を書くたびに fire-and-forget POST
// - admin.html / shop-admin.html から過去チャット履歴を見れる状態を保つ
// - 失敗しても DO の動作は止めない (waitUntil でバックグラウンド)
// =========================================================

import type { Env, ChatSession, ChatMessage } from './types';

export class MysqlSync {
  constructor(private env: Env) {}

  private get baseUrl(): string {
    return this.env.NOTIFY_BASE_URL || 'https://yobuho.com';
  }

  private get secret(): string {
    return this.env.CHAT_SYNC_SECRET || '';
  }

  async upsertSession(shopId: string, sess: ChatSession): Promise<void> {
    await this.post('upsert-session', {
      shop_id: shopId,
      session_token: sess.session_token,
      visitor_hash: sess.visitor_hash,
      nickname: sess.nickname || null,
      lang: sess.lang || null,
      started_at: sess.started_at,
      last_activity_at: sess.last_activity_at,
      last_visitor_heartbeat_at: sess.last_visitor_heartbeat_at || null,
      last_owner_heartbeat_at: sess.last_owner_heartbeat_at || null,
      closed_at: sess.closed_at || null,
      status: sess.status,
      source: sess.source,
      notified_at: sess.notified_at || null,
      blocked: sess.blocked ? 1 : 0,
      cast_id: sess.cast_id || null,
    });
  }

  async upsertMessage(sessionToken: string, m: ChatMessage): Promise<void> {
    // client_msg_id が無い古い msg は同期しない (UNIQUE制約のため)
    if (!m.client_msg_id) return;
    await this.post('upsert-message', {
      session_token: sessionToken,
      client_msg_id: m.client_msg_id,
      sender_type: m.sender_type,
      message: m.message,
      sent_at: m.sent_at,
      read_at: m.read_at || null,
    });
  }

  async markRead(sessionToken: string, readerType: 'visitor' | 'shop', upToSentAt: string): Promise<void> {
    await this.post('mark-read', {
      session_token: sessionToken,
      reader: readerType,
      up_to_sent_at: upToSentAt,
    });
  }

  /**
   * adopt 時のリロード空白バグ対策: DO storage 空で既存 token が来た時に
   * MySQL から履歴を取り寄せて DO storage に backfill する.
   * 返り値: { messages: [{id, sender_type, message, client_msg_id?, sent_at, read_at?, nickname?}],
   *          session: {nickname, status, blocked, started_at, last_activity_at, closed_at, cast_id} | null }
   */
  async fetchHistory(sessionToken: string): Promise<{ messages: any[]; session: any } | null> {
    if (!this.secret) return null;
    const url = `${this.baseUrl}/api/chat-sync.php?action=get-history`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Secret': this.secret,
        },
        body: JSON.stringify({ session_token: sessionToken }),
      });
      if (!res.ok) {
        console.warn(`chat-sync(get-history) returned ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      if (!data?.ok) return null;
      return { messages: Array.isArray(data.messages) ? data.messages : [], session: data.session || null };
    } catch (e) {
      console.error('chat-sync(get-history) failed', e);
      return null;
    }
  }

  private async post(action: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.secret) {
      console.warn('CHAT_SYNC_SECRET not set, skipping mirror');
      return;
    }
    // Kill-switch: PHP が authoritative になった後 (Day 4+) はミラー不要.
    // wrangler secret put CHAT_SYNC_DISABLE_MIRROR=1 で即時停止、差し戻しは delete.
    if (this.env.CHAT_SYNC_DISABLE_MIRROR === '1') {
      return;
    }
    const url = `${this.baseUrl}/api/chat-sync.php?action=${action}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Secret': this.secret,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`chat-sync(${action}) returned ${res.status}`);
      }
    } catch (e) {
      console.error(`chat-sync(${action}) failed`, e);
    }
  }
}
