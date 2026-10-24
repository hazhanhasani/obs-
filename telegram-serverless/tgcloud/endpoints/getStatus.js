import { EndpointError } from 'sdk';
import { isOwner } from '../lib/config.js';
import { loadConnection, getStatus } from '../lib/bridge.js';
export default async function (_input, ctx) {
  if (!isOwner(ctx?.initData?.user?.id)) throw new EndpointError('Access denied');
  const cfg = await loadConnection();
  if (!cfg) return { connected: false, channels: [], system: null };
  try {
    const status = await getStatus();
    return { connected: true, baseUrl: cfg.baseUrl, ...status };
  } catch {
    throw new EndpointError('Stream engine is offline or unauthorized');
  }
}
