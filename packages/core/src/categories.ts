import type { Category } from './model';

/** Default categories created with every project. `key` is used to translate the name. */
export const DEFAULT_CATEGORIES: readonly { id: string; key: string; name: string }[] = [
  { id: 'food', key: 'food', name: 'Food' },
  { id: 'groceries', key: 'groceries', name: 'Groceries' },
  { id: 'transport', key: 'transport', name: 'Transport' },
  { id: 'fuel', key: 'fuel', name: 'Fuel' },
  { id: 'accommodation', key: 'accommodation', name: 'Accommodation' },
  { id: 'tickets', key: 'tickets', name: 'Tickets & Entry' },
  { id: 'shopping', key: 'shopping', name: 'Shopping' },
  { id: 'medical', key: 'medical', name: 'Medical' },
  { id: 'tips', key: 'tips', name: 'Tips' },
  { id: 'other', key: 'other', name: 'Other' },
];

export function defaultCategories(): { categories: Record<string, Category>; order: string[] } {
  const categories: Record<string, Category> = {};
  for (const c of DEFAULT_CATEGORIES) categories[c.id] = { id: c.id, key: c.key, name: c.name, hidden: false };
  return { categories, order: DEFAULT_CATEGORIES.map((c) => c.id) };
}
