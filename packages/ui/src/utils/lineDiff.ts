/** Above this many line pairs a diff costs more than the marks are worth. */
const MAX_DIFF_CELLS = 1_000_000;

/**
 * The lines of `current` that are not in `original`, as ascending 1-based line
 * numbers, by a longest common subsequence of the two texts' lines. An edited
 * line and an added one both count; a removed line leaves nothing to mark.
 */
export const getChangedLines = (
  original: string,
  current: string,
): number[] => {
  const before = original.split("\n");
  const after = current.split("\n");
  if (before.length * after.length > MAX_DIFF_CELLS) return [];

  // table[i][j]: how many lines `before[i..]` and `after[j..]` share, in order.
  const columns = after.length + 1;
  const table = new Uint32Array((before.length + 1) * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        before[i] === after[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }

  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (j < after.length) {
    if (i < before.length && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (
      i < before.length &&
      table[(i + 1) * columns + j] >= table[i * columns + j + 1]
    ) {
      i += 1;
    } else {
      changed.push(j + 1);
      j += 1;
    }
  }
  return changed;
};
