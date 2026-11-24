/** One viewport plus overscan, independent of the number of retained matches. */
export function searchWindow(total: number, height: number, scrollTop: number, rowHeight = 26): {start: number; end: number; offset: number; height: number} {
  const count = Math.max(0, Math.floor(total));
  const size = Number.isFinite(rowHeight) ? Math.max(20, rowHeight) : 26;
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const visible = Number.isFinite(height) ? Math.max(1, Math.ceil(height / size)) : 1;
  const start = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(top / size) - 10));
  return {start, end: Math.min(count, start + Math.min(200, visible + 20)), offset: start * size, height: count * size};
}
