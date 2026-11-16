/** Local time of day (24 h), for "last run" labels. Presentation only. */
export function formatTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
