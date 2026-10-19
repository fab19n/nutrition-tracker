/** True when the typed text satisfies `requireTyping` (always true when nothing is required). */
export function typingMatches(typed: string, requireTyping?: string): boolean {
  return !requireTyping || typed.trim() === requireTyping;
}
