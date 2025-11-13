export function toIdString(value: number | string | bigint | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toString();
}

export function ensureIdString(
  value: number | string | bigint | null | undefined,
  fallback = "0",
): string {
  const id = toIdString(value);
  return id ?? fallback;
}

export function idStringToNumber(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

