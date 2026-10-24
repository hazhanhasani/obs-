export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 220) throw new Error('Invalid URL');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.search || url.port || url.pathname !== '/') throw new Error('HTTPS hostname only');
  const host = url.hostname;
  if (!/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ||
      host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part)) ||
      /\.(local|localhost|internal|invalid|test|example)$/i.test(host)) {
    throw new Error('Public DNS hostname required');
  }
  return url.origin;
}
export const validBridgeToken = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
export const validAction = (channel, action) =>
  typeof channel === 'string' && /^[a-z][a-z0-9_-]{2,39}$/.test(channel) &&
  (action === 'start' || action === 'stop');
