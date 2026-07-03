export function composePostText(text: string, personalComment?: string) {
  if (!personalComment?.trim()) return text;
  return `${text}\n\nSuy nghĩ cá nhân: ${personalComment.trim()}`;
}