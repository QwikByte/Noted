/** Text wörtlich in einen regulären Ausdruck einsetzen (Sonderzeichen wie . * ( maskieren) */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
