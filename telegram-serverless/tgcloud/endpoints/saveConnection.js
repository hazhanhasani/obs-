import { db, EndpointError } from 'sdk';
import { connection } from '../schema.js';
import { isOwner } from '../lib/config.js';
import { normalizeBaseUrl, validBridgeToken } from '../lib/validation.js';
export default async function (input, ctx) {
  if (!isOwner(ctx?.initData?.user?.id)) throw new EndpointError('Access denied');
  let baseUrl;
  try { baseUrl = normalizeBaseUrl(input?.baseUrl); }
  catch { throw new EndpointError('Enter a valid public HTTPS domain'); }
  if (!validBridgeToken(input?.token)) throw new EndpointError('Bridge token must be 64 hex characters');
  const bridgeToken = input.token;
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.insert(connection)
    .values({ id: 1, baseUrl, bridgeToken, updatedAt })
    .onConflictDoUpdate({ target: connection.id, set: { baseUrl, bridgeToken, updatedAt } })
    .run();
  return { ok: true, baseUrl };
}
