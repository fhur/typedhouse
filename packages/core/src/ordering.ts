import type { Expr } from './expr.js';
import type { Mode } from './types.js';

/** An immutable sort key, normally created with an expression's `asc()` or `desc()`.
 * Return it from `orderBy()` or `thenBy()`; it cannot be projected as a scalar column.
 */
export class Ordering<M extends Mode = 'row'> {
  readonly mode: M;
  constructor(readonly expr: Expr<unknown, string, M>, readonly dir: 'asc' | 'desc', readonly nulls?: 'first' | 'last') {
    this.mode = expr.mode;
    Object.freeze(this);
  }
  /** Place NULL before non-null values, keeping the current ascending/descending direction.
   * @example
   * ```ts
   * from(parts).orderBy(p => p.mpn.asc().nullsFirst());
   * ```
   */
  nullsFirst(): Ordering<M> { return new Ordering(this.expr, this.dir, 'first'); }
  /** Place NULL after non-null values, keeping the current ascending/descending direction.
   * @example
   * ```ts
   * from(parts).orderBy(p => p.mpn.desc().nullsLast());
   * ```
   */
  nullsLast(): Ordering<M> { return new Ordering(this.expr, this.dir, 'last'); }
}
