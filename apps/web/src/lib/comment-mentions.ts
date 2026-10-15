export function mentionPresent(body: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(body);
}
