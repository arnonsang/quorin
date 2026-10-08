export type PathSegment = string | number;
export type PathInput = string | readonly PathSegment[];

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type TupleIndex<K> = K extends `${infer N extends number}` ? N : never;

export type Path<T, D extends number = 8> = [D] extends [never]
  ? never
  : T extends Primitive | ((...args: never[]) => unknown)
    ? never
    : T extends readonly unknown[]
      ? number extends T['length']
        ? readonly [number] | readonly [number, ...Path<T[number], Prev[D]>]
        : {
            [K in keyof T & `${number}`]: readonly [TupleIndex<K>] | readonly [TupleIndex<K>, ...Path<T[K], Prev[D]>];
          }[keyof T & `${number}`]
      : {
          [K in keyof T & string]-?: readonly [K] | readonly [K, ...Path<NonNullable<T[K]>, Prev[D]>];
        }[keyof T & string];

type Step<T, H> = unknown extends T
  ? unknown
  : T extends readonly unknown[]
    ? H extends number
      ? number extends T['length']
        ? T[number] | undefined
        : `${H}` extends keyof T
          ? T[`${H}`]
          : undefined
      : undefined
    : T extends Primitive | ((...args: never[]) => unknown)
      ? undefined
      : H extends string
        ? string extends keyof T
          ? T[string] | undefined
          : H extends keyof T
            ? T[H]
            : undefined
        : undefined;

export type PathValue<T, P, D extends number = 8> = [D] extends [never]
  ? unknown
  : P extends readonly []
    ? T
    : P extends readonly [infer H, ...infer R]
      ? PathValue<Step<T, H>, R, Prev[D]>
      : unknown;

export type SplitPath<S extends string, D extends number = 8> = string extends S
  ? string[]
  : [D] extends [never]
    ? string[]
    : S extends `${infer H}.${infer R}`
      ? [H, ...SplitPath<R, Prev[D]>]
      : [S];

export type ResolvePath<P> = P extends string ? SplitPath<P> : P;

export type IsLiteralPath<P> = P extends string
  ? string extends P
    ? false
    : true
  : P extends readonly unknown[]
    ? number extends P['length']
      ? false
      : true
    : false;
