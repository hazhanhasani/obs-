import { db, fetch } from 'sdk';
import { eq } from 'sdk/db';
import { connection } from '../schema.js';
import { validAction } from './validation.js';

export async function loadConnection() {
  return await db.select().from(connection).where(eq(connection.id, 1)).get();
}
export async function requestEngine(path, method = 'GET') {
  const cfg = await loadConnection();
  if (!cfg) throw new Error('NOT_CONNECTED');
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: { Authorization: 'Bearer ' + cfg.bridgeToken, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('ENGINE_UNAVAILABLE');
  return await res.json();
}
export async function getStatus() {
  return await requestEngine('/api/cloud/overview');
}
export async function controlStream(channel, operation) {
  if (!validAction(channel, operation)) throw new Error('INVALID_ACTION');
  return await requestEngine('/api/cloud/channels/' + channel + '/' + operation, 'POST');
}
