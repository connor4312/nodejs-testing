/**
 * Queue used to display test runner output. Some optimization to
 * avoid additional microtasks if the output can be displayed
 * synchronously.
 */
export class OutputQueue {
  private queue: (() => Promise<void> | void)[] = [];
  private drained?: Promise<void> | void;

  /** Enqueues a function to be called */
  public enqueue(fn: () => Promise<void> | void): void;
  /** Enqueues a function to be called with the result of `maybePromise` */
  public enqueue<T>(maybePromise: Promise<T> | T, fn: (value: T) => Promise<void> | void): void;

  public enqueue<T>(
    maybePromise: Promise<T> | T | (() => Promise<void> | void),
    fn?: (value: T) => Promise<void> | void,
  ) {
    if (fn === undefined) {
      this.queue.push(maybePromise as () => Promise<void> | void);
    } else {
      this.queue.push(() =>
        maybePromise instanceof Promise ? maybePromise.then(fn) : fn(maybePromise as T),
      );
    }

    if (this.queue.length === 1) {
      this.drained = this.runQueue();
    }
  }

  /** Waits untils all enqueued operations have resolved. */
  public async drain() {
    await this.drained;
  }

  private runQueue(): Promise<void> | void {
    while (this.queue.length) {
      const r = this.queue[0]();
      if (r instanceof Promise) {
        return r.finally(() => {
          this.queue.shift();
          return this.runQueue();
        });
      } else {
        this.queue.shift();
      }
    }
  }
}
