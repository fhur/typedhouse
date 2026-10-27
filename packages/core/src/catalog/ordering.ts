/** Ordering is a builder instruction; these entries never resolve to SQL Calls. */
export const orderingCatalog = Object.freeze([
  Object.freeze({ name: 'asc', direction: 'asc', deterministic: true }),
  Object.freeze({ name: 'desc', direction: 'desc', deterministic: true }),
] as const);
