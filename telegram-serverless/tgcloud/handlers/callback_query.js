import { api } from 'sdk';
import { isOwner } from '../lib/config.js';
import { getStatus, controlStream } from '../lib/bridge.js';
export default async function (query) {
  if (!query?.id) return;
  if (!isOwner(query.from?.id)) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Access denied', show_alert: true });
    return;
  }
  if (!['sc:refresh','sc:start:main','sc:stop:main'].includes(query.data)) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown action' });
    return;
  }
  try {
    if (query.data !== 'sc:refresh') {
      await controlStream('main', query.data === 'sc:start:main' ? 'start' : 'stop');
    }
    const status = await getStatus();
    const main = status.channels.find(c => c.id === 'main');
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: main?.running ? 'Engine is running' : 'Engine stopped or starting',
    });
  } catch {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Engine unavailable', show_alert: true });
  }
}
