/** VS Code may expose translated manifest text as { value, original } rather than a string. */
export function manifestLabel(text: unknown, fallback: string): string {
  if (typeof text === "string" && text.trim()) return text;
  if (text && typeof text === "object" && !Array.isArray(text)) {
    const localized = text as {value?: unknown; original?: unknown};
    for (const candidate of [localized.value, localized.original]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}
