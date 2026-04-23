/** Unique prefix so parallel runs / retries do not collide on slug/email. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
