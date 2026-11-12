/**
 * Builds an API path from a template literal. Every interpolated value is percent-encoded with
 * encodeURIComponent, so an entity name with `/`, `?`, `#`, `%` or a space stays one path segment
 * (or one query value); the literal parts are kept as written. This is the only place a value
 * is encoded. An undefined or null value throws instead of becoming the text "undefined".
 */
export function apiPath(literals: TemplateStringsArray, ...values: unknown[]): string {
  let path = literals[0];
  values.forEach((value, i) => {
    if (value === undefined || value === null) {
      throw new Error(`apiPath: value ${i} of "${literals.join('${}')}" is ${value}`);
    }
    path += encodeURIComponent(String(value)) + literals[i + 1];
  });
  return path;
}
