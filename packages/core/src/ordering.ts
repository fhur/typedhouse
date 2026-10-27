import type { Expr } from './expr.js';
import type { Mode } from './types.js';

/** An immutable sort instruction, not a scalar expression. */
export class Ordering<M extends Mode = 'row'> {
  readonly mode: M;
  constructor(readonly expr: Expr<unknown, string, M>, readonly dir: 'asc' | 'desc', readonly nulls?: 'first' | 'last') {
    this.mode = expr.mode;
    Object.freeze(this);
  }
  nullsFirst(): Ordering<M> { return new Ordering(this.expr, this.dir, 'first'); }
  nullsLast(): Ordering<M> { return new Ordering(this.expr, this.dir, 'last'); }
}
