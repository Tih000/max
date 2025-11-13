import dayjs from "dayjs";
export declare const DEFAULT_TZ = "Europe/Moscow";
export declare function now(tz?: string): Date;
export declare function toDayjs(date: Date | string | number, tz?: string): dayjs.Dayjs;
export declare function formatDate(date: Date | string | number, tz?: string): string;
export declare function formatRange(from: Date, to: Date, tz?: string): string;
export declare function startOfDay(date?: Date, tz?: string): Date;
export declare function endOfDay(date?: Date, tz?: string): Date;
export declare function startOfWeek(date?: Date, tz?: string): Date;
export declare function endOfWeek(date?: Date, tz?: string): Date;
export declare function addMinutes(date: Date, minutes: number, tz?: string): Date;
export declare function addDays(date: Date, days: number, tz?: string): Date;
export declare function differenceInMinutes(a: Date, b: Date): number;
//# sourceMappingURL=date.d.ts.map