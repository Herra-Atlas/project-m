type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  let out = '';
  for (const v of values) {
    if (!v) continue;
    out += out ? ' ' + v : v;
  }
  return out;
}
