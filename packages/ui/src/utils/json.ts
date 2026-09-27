/** Job payloads arrive as objects or as JSON strings, depending on the adapter. */
export const parseUnknownJson = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const isEmptyData = (data: unknown): boolean => {
  if (data === null || data === undefined) return true;
  if (typeof data === "object" && Object.keys(data as object).length === 0) {
    return true;
  }
  return false;
};

/** Parsed, with an empty object or null collapsed to null so a section can skip itself. */
export const parseDataOrNull = (value: unknown): unknown => {
  const parsed = parseUnknownJson(value);
  return isEmptyData(parsed) ? null : parsed;
};
