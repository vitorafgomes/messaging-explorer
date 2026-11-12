/** What the API answers when the broker refuses an operation because the entity is disabled for it. */
const ENTITY_DISABLED = 'The entity is disabled for this operation.';

/**
 * The text a failed message call shows: a 409 is the entity disabled for this operation, in the API's own
 * words; a 400 or 404 adds the API's message to the fallback; any other failure is the fallback.
 */
export function messageCallFailure(error: unknown, fallback: string): string {
  const { status, error: body } = (error ?? {}) as { status?: number; error?: { message?: unknown } | null };
  const said = typeof body?.message === 'string' && body.message.trim() ? body.message : null;
  if (status === 409) {
    return said ?? ENTITY_DISABLED;
  }
  return (status === 400 || status === 404) && said ? `${fallback}: ${said}` : fallback;
}
