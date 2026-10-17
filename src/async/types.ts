export interface TaskContext {
  readonly signal: AbortSignal;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
}
