import { table, integer, text } from 'sdk/db';
// Owner-only private configuration. Never send bridgeToken to client or GitHub.
export const connection = table('streamcore_connection', {
  id: integer('id').primaryKey(),
  baseUrl: text('base_url').notNull(),
  bridgeToken: text('bridge_token').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
