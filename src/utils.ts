/**
 * A utility function to ensure that typescript unions are exhaustively checked.
 * This function will fail at compile time if a previously exhaustive check is
 * no longer exhaustive (in case a new value is added)
 *
 * @param _ the value that should have already been exhaustivly checked
 * @param message The error message to throw in case this code is reached during runtime
 */
export function assertUnreachable(_: never, message: string): never {
  throw new Error(message);
}
