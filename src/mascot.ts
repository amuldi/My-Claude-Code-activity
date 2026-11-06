/**
 * A small pixel crab in the spirit of the Claude Code welcome screen,
 * drawn on a 16 × 7 grid ('#' = filled, '.' = empty; the empty pixels in
 * rows 1–2 are its eyes).
 */
export const MASCOT: readonly string[] = [
  '..############..',
  '..##.######.##..',
  '..##.######.##..',
  '################',
  '..############..',
  '...#.#....#.#...',
  '...#.#....#.#...',
];

export const MASCOT_COLS = 16;
export const MASCOT_ROWS = MASCOT.length;
