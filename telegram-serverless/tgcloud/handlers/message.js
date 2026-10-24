import { api } from 'sdk';
import { isOwner, OWNER_USER_ID } from '../lib/config.js';
import { getStatus } from '../lib/bridge.js';
export default async function (message) {
  if (message.chat?.type !== 'private' || !message.from?.id) return;
  const chatId = message.chat.id, userId = message.from.id;
  if ((message.text || '').trim() === '/id') {
    await api.sendMessage({ chat_id: chatId, text: 'Your Telegram user ID: ' + userId });
    return;
  }
  if (!isOwner(userId)) {
    await api.sendMessage({
      chat_id: chatId,
      text: OWNER_USER_ID ? 'Access denied.' : 'Owner ID is not configured. Send /id for your ID.',
    });
    return;
  }
  let label = '🎥 StreamCore control\n';
  try {
    const status = await getStatus();
    label += status.channels.map(c => (c.running ? '🟢 ' : '⚪ ') + c.name).join('\n') || 'No channels';
  } catch { label += 'Engine offline or not configured. Open the Mini App.'; }
  await api.sendMessage({
    chat_id: chatId,
    text: label,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Refresh', callback_data: 'sc:refresh' }],
        [{ text: '▶️ Main ON', callback_data: 'sc:start:main' },
         { text: '⏹ Main OFF', callback_data: 'sc:stop:main' }],
      ],
    },
  });
}
