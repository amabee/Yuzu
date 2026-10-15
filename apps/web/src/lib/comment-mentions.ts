export function mentionPresent(body: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(body);
}

export function activeMention(
  body: string,
  caret: number,
  selectedNames: string[] = [],
) {
  const match = /(?:^|[\s([{])@([^@\n]{0,80})$/u.exec(body.slice(0, caret));
  if (!match || selectedNames.some((name) => match[1]!.startsWith(`${name} `)))
    return null;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}
