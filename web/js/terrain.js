/* terrain.js — shared rectangular-cell terrain coverage */
(function () {
  const MG = window.MG;
  const Terrain = (MG.Terrain = {});

  Terrain.CELL_WIDTH = 48;
  Terrain.CELL_HEIGHT = 32;

  function occupied(grid, cols, rows, x, y, kind) {
    return x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === kind ? 1 : 0;
  }

  Terrain.cornerCoverages = function (grid, cols, rows, x, y, kind) {
    const vertex = (vx, vy) => (
      occupied(grid, cols, rows, vx - 1, vy - 1, kind) +
      occupied(grid, cols, rows, vx, vy - 1, kind) +
      occupied(grid, cols, rows, vx - 1, vy, kind) +
      occupied(grid, cols, rows, vx, vy, kind)
    ) / 4;
    return [vertex(x, y), vertex(x + 1, y), vertex(x, y + 1), vertex(x + 1, y + 1)];
  };

  Terrain.sampleCoverage = function (corners, u, v) {
    const top = corners[0] + (corners[1] - corners[0]) * u;
    const bottom = corners[2] + (corners[3] - corners[2]) * u;
    const value = top + (bottom - top) * v;
    const t = Math.max(0, Math.min(1, (value - 0.35) / 0.3));
    return t * t * (3 - 2 * t);
  };
})();
