/* terrain.js — shared rectangular-cell terrain coverage */
(function () {
  const MG = window.MG;
  const Terrain = (MG.Terrain = {});

  Terrain.CELL_WIDTH = 48;
  Terrain.CELL_HEIGHT = 32;

  function occupied(grid, cols, rows, x, y, kind) {
    return x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === kind ? 1 : 0;
  }

  Terrain.coverageGrid = function (grid, cols, rows, x, y, kind) {
    const center = occupied(grid, cols, rows, x, y, kind);
    const vertex = (vx, vy) => (
      occupied(grid, cols, rows, vx - 1, vy - 1, kind) +
      occupied(grid, cols, rows, vx, vy - 1, kind) +
      occupied(grid, cols, rows, vx - 1, vy, kind) +
      occupied(grid, cols, rows, vx, vy, kind)
    ) / 4;
    // Shared vertices and edge midpoints keep both sides of each seam equal.
    // The semantic center preserves isolated cells, narrow strips and holes.
    return [
      vertex(x, y), (center + occupied(grid, cols, rows, x, y - 1, kind)) / 2, vertex(x + 1, y),
      (center + occupied(grid, cols, rows, x - 1, y, kind)) / 2, center, (center + occupied(grid, cols, rows, x + 1, y, kind)) / 2,
      vertex(x, y + 1), (center + occupied(grid, cols, rows, x, y + 1, kind)) / 2, vertex(x + 1, y + 1),
    ];
  };

  Terrain.sampleCoverage = function (coverage, u, v) {
    const col = u < 0.5 ? 0 : 1, row = v < 0.5 ? 0 : 1;
    const x = u * 2 - col, y = v * 2 - row;
    const i = row * 3 + col;
    const top = coverage[i] + (coverage[i + 1] - coverage[i]) * x;
    const bottom = coverage[i + 3] + (coverage[i + 4] - coverage[i + 3]) * x;
    const value = top + (bottom - top) * y;
    const t = Math.max(0, Math.min(1, (value - 0.35) / 0.3));
    return t * t * (3 - 2 * t);
  };
})();
