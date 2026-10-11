/** Keep thrown strings and platform errors readable without assuming an Error instance. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
