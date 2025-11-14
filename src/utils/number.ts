export function toInt(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
}

export function toBigInt(value: unknown): bigint | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    return undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      // Проверяем, что строка представляет целое число
      if (/^-?\d+$/.test(value.trim())) {
        return BigInt(value.trim());
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

