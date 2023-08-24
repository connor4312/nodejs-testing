export const last = <T>(it: Iterable<T>): T | undefined => {
  let last: T | undefined;
  for (const item of it) {
    last = item;
  }
  return last;
};
