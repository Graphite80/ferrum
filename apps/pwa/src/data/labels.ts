// One set is a set. Every screen that counts them said "1 sets", which reads as
// a template that was never finished — so the wording lives in one place rather
// than in an inline ternary each screen is free to forget.
export function formatSetCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'set' : 'sets'}`;
}
