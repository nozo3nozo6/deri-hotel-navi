// =========================================================
// NotificationRouter
// - DO から通知チャネルを抽象化. email, (将来) line, push 等を登録可能.
// - 現状は yobuho.com/api/chat-notify.php にfetchして既存のPHPメール送信を流用.
// =========================================================

import type { Env, ShopStatus, ChatMessage } from './types';

export interface NotifyContext {
  shop: ShopStatus;
  session_id: number;
  session_token: string;
  nickname?: string;
  message: ChatMessage;
  first_in_session: boolean;
}

export type NotifyHandler = (ctx: NotifyContext, env: Env) => Promise<void>;

export class NotificationRouter {
  private handlers: Map<string, NotifyHandler> = new Map();

  register(type: string, handler: NotifyHandler) {
    this.handlers.set(type, handler);
  }

  async notify(channels: string[], ctx: NotifyContext, env: Env): Promise<void> {
    await Promise.all(
      channels.map(async (ch) => {
        const h = this.handlers.get(ch);
        if (!h) return;
        try {
          await h(ctx, env);
        } catch (e) {
          console.error(`notify(${ch}) failed`, e);
        }
      })
    );
  }
}

// ===== email ハンドラ =====
// yobuho.com/api/chat-notify.php を POST で叩く（PHP側で既存の mail() に流す）
export const emailHandler: NotifyHandler = async (ctx, env) => {
  const { shop, message, session_token, first_in_session, nickname } = ctx;

  // notify_mode チェック
  if (shop.notify_mode === 'off') return;
  if (shop.notify_mode === 'first' && !first_in_session) return;

  const to = shop.notify_email || shop.email;
  if (!to) return;

  const body = {
    secret: env.CHAT_NOTIFY_SECRET || '',
    to,
    shop_name: shop.shop_name,
    shop_slug: shop.slug,
    session_token,
    nickname: nickname || 'ゲスト',
    message: message.message,
    sent_at: message.sent_at,
  };

  const url = `${env.NOTIFY_BASE_URL}/api/chat-notify.php`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`chat-notify.php returned ${res.status}`);
  }
};

// デフォルトのルーターを組み立てる
export function buildDefaultRouter(): NotificationRouter {
  const r = new NotificationRouter();
  r.register('email', emailHandler);
  // 将来: r.register('line', lineHandler);
  //       r.register('push', webPushHandler);
  return r;
}
