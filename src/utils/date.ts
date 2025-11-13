import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import isoWeek from "dayjs/plugin/isoWeek";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(isoWeek);

export const DEFAULT_TZ = "Europe/Moscow";

export function now(tz = DEFAULT_TZ) {
  return dayjs().tz(tz).toDate();
}

export function toDayjs(date: Date | string | number, tz = DEFAULT_TZ) {
  return dayjs(date).tz(tz);
}

export function formatDate(date: Date | string | number, tz = DEFAULT_TZ) {
  return toDayjs(date, tz).format("DD.MM.YYYY HH:mm");
}

export function formatRange(from: Date, to: Date, tz = DEFAULT_TZ) {
  const start = toDayjs(from, tz);
  const end = toDayjs(to, tz);
  const sameDay = start.isSame(end, "day");

  if (sameDay) {
    return `${start.format("DD.MM.YYYY")} ${start.format("HH:mm")}–${end.format("HH:mm")}`;
  }

  return `${start.format("DD.MM.YYYY HH:mm")} — ${end.format("DD.MM.YYYY HH:mm")}`;
}

export function startOfDay(date = new Date(), tz = DEFAULT_TZ) {
  return toDayjs(date, tz).startOf("day").toDate();
}

export function endOfDay(date = new Date(), tz = DEFAULT_TZ) {
  return toDayjs(date, tz).endOf("day").toDate();
}

export function startOfWeek(date = new Date(), tz = DEFAULT_TZ) {
  return toDayjs(date, tz).startOf("isoWeek").toDate();
}

export function endOfWeek(date = new Date(), tz = DEFAULT_TZ) {
  return toDayjs(date, tz).endOf("isoWeek").toDate();
}

export function addMinutes(date: Date, minutes: number, tz = DEFAULT_TZ) {
  return toDayjs(date, tz).add(minutes, "minute").toDate();
}

export function addDays(date: Date, days: number, tz = DEFAULT_TZ) {
  return toDayjs(date, tz).add(days, "day").toDate();
}

export function differenceInMinutes(a: Date, b: Date) {
  return dayjs(a).diff(dayjs(b), "minute");
}

