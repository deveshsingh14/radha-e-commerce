/* ============================================================
   Masonry feed that keeps the sort order readable.
   CSS multi-columns fill column 1 top-to-bottom before column 2, so a
   "Price: low → high" list read down a column. Here each card goes into
   the currently SHORTEST column: the first row reads left → right and
   every card starts at or below the card before it, so the order reads
   across and down — the Pinterest look stays.
   ============================================================ */

// Same breakpoints the CSS columns used: desktop ≤5 columns of ≥240px,
// tablet ≤3 of ≥170px, phone 2.
function masonryColumnCount(viewportWidth, containerWidth) {
  if (viewportWidth <= 480) return 2;
  const tablet = viewportWidth <= 880;
  const min = tablet ? 170 : 240, gap = tablet ? 12 : 16, max = tablet ? 3 : 5;
  return Math.max(1, Math.min(max, Math.floor((containerWidth + gap) / (min + gap))));
}

// Places items one by one into the shortest column (ties → leftmost).
// place(item, columnIndex) must put the item there and return its height.
function placeInColumns(items, n, place) {
  const heights = new Array(n).fill(0);
  const columnOf = [];
  for (const item of items) {
    let c = 0;
    for (let i = 1; i < n; i++) if (heights[i] < heights[c] - 0.5) c = i;
    heights[c] += place(item, c);
    columnOf.push(c);
  }
  return columnOf;
}

if (typeof module !== "undefined" && module.exports) module.exports = { masonryColumnCount, placeInColumns };
