/** Fields a caller may change on an existing row (the primary key never changes). */
export type Patch<T, K extends keyof T> = Partial<Omit<T, K>>;

/** Ascending comparator over one or more string keys (ISO days and instants sort lexically). */
export function byKeys<T>(...keys: ((row: T) => string)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  };
}
