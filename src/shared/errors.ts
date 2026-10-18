/** The message of a thrown value: an Error's message, anything else as a string. */
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
