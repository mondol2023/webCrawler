/** Escape a string so it matches literally inside a RegExp / Mongo $regex. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
