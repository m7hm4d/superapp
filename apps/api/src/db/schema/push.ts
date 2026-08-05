import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * توكنات Expo Push — النطاق الضيق (الخطة): حدثان فقط،
 * طلب جديد للمخبز ودفعة معروضة للسائق. الباقي socket.
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(), // ExponentPushToken[...]
    platform: text('platform'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_tokens_user_idx').on(t.userId)],
);
