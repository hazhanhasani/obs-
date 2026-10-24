import { EndpointError } from 'sdk';
import { isOwner } from '../lib/config.js';
import { validAction } from '../lib/validation.js';
import { controlStream } from '../lib/bridge.js';
export default async function (input, ctx) {
  if (!isOwner(ctx?.initData?.user?.id)) throw new EndpointError('Access denied');
  if (!validAction(input?.channel, input?.operation)) throw new EndpointError('Invalid action');
  try {
    await controlStream(input.channel, input.operation);
    return { ok: true };
  } catch {
    throw new EndpointError('Engine unreachable; command failed');
  }
}
