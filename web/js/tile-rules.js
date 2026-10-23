/* tile-rules.js — directional terrain topology shared by atlas and renderer */
(function () {
  const Rules = (window.MG.TileRules = {});
  Rules.DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const OFFSETS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

  Rules.normalize = function (mask) {
    let result = mask & 85;
    for (let i = 1; i < 8; i += 2) {
      const sides = (1 << (i - 1)) | (1 << ((i + 1) % 8));
      if ((mask & sides) === sides) result |= mask & (1 << i);
    }
    return result;
  };

  const common = [124, 241, 199, 31, 28, 112, 193, 7, 1, 4, 16, 64, 17, 68, 0, 253, 247, 223, 127, 221];
  Rules.MASKS = common.concat(Array.from({ length: 256 }, (_, i) => i)
    .filter((mask) => mask !== 255 && Rules.normalize(mask) === mask && !common.includes(mask)));

  Rules.maskAt = function (kinds, cols, rows, x, y, kind) {
    let mask = 0;
    OFFSETS.forEach(([dx, dy], bit) => {
      const nx = x + dx, ny = y + dy;
      const inside = nx >= 0 && ny >= 0 && nx < cols && ny < rows;
      // Boundary rock continues outside the map; its inward face seals the map.
      if (inside ? kinds[ny * cols + nx] === kind : kind === "wall") mask |= 1 << bit;
    });
    return Rules.normalize(mask);
  };

  Rules.coverage = function (mask) {
    const m = Rules.normalize(mask), bit = (n) => (m >> n) & 1;
    return [bit(7), bit(0), bit(1), bit(6), 1, bit(2), bit(5), bit(4), bit(3)];
  };

  Rules.junctionCoverage = function (kinds, cols, rows, x, y, kind) {
    const at = (nx, ny) => nx >= 0 && ny >= 0 && nx < cols && ny < rows ? kinds[ny * cols + nx] : kind === "wall" ? "wall" : "floor";
    const shared = (labels) => {
      const materials = new Set(labels.filter((value) => value !== "floor"));
      if (materials.size <= 1) return labels.every((value) => value === kind) ? 1 : 0;
      return labels.filter((value) => value === kind).length / labels.length;
    };
    const vertex = (vx, vy) => shared([at(vx - 1, vy - 1), at(vx, vy - 1), at(vx - 1, vy), at(vx, vy)]);
    const center = at(x, y);
    return [vertex(x, y), shared([center, at(x, y - 1)]), vertex(x + 1, y),
      shared([center, at(x - 1, y)]), center === kind ? 1 : 0, shared([center, at(x + 1, y)]),
      vertex(x, y + 1), shared([center, at(x, y + 1)]), vertex(x + 1, y + 1)];
  };

  Rules.describe = function (mask) {
    const connected = Rules.DIRECTIONS.filter((_, bit) => mask & (1 << bit));
    return "same material at " + (connected.join("+") || "none (isolated center)") + "; floor at all other neighbors";
  };
})();
