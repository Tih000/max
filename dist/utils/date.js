"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TZ = void 0;
exports.now = now;
exports.toDayjs = toDayjs;
exports.formatDate = formatDate;
exports.formatRange = formatRange;
exports.startOfDay = startOfDay;
exports.endOfDay = endOfDay;
exports.startOfWeek = startOfWeek;
exports.endOfWeek = endOfWeek;
exports.addMinutes = addMinutes;
exports.addDays = addDays;
exports.differenceInMinutes = differenceInMinutes;
const dayjs_1 = __importDefault(require("dayjs"));
const duration_1 = __importDefault(require("dayjs/plugin/duration"));
const isoWeek_1 = __importDefault(require("dayjs/plugin/isoWeek"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
dayjs_1.default.extend(duration_1.default);
dayjs_1.default.extend(isoWeek_1.default);
exports.DEFAULT_TZ = "Europe/Moscow";
function now(tz = exports.DEFAULT_TZ) {
    return (0, dayjs_1.default)().tz(tz).toDate();
}
function toDayjs(date, tz = exports.DEFAULT_TZ) {
    return (0, dayjs_1.default)(date).tz(tz);
}
function formatDate(date, tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).format("DD.MM.YYYY HH:mm");
}
function formatRange(from, to, tz = exports.DEFAULT_TZ) {
    const start = toDayjs(from, tz);
    const end = toDayjs(to, tz);
    const sameDay = start.isSame(end, "day");
    if (sameDay) {
        return `${start.format("DD.MM.YYYY")} ${start.format("HH:mm")}–${end.format("HH:mm")}`;
    }
    return `${start.format("DD.MM.YYYY HH:mm")} — ${end.format("DD.MM.YYYY HH:mm")}`;
}
function startOfDay(date = new Date(), tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).startOf("day").toDate();
}
function endOfDay(date = new Date(), tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).endOf("day").toDate();
}
function startOfWeek(date = new Date(), tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).startOf("isoWeek").toDate();
}
function endOfWeek(date = new Date(), tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).endOf("isoWeek").toDate();
}
function addMinutes(date, minutes, tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).add(minutes, "minute").toDate();
}
function addDays(date, days, tz = exports.DEFAULT_TZ) {
    return toDayjs(date, tz).add(days, "day").toDate();
}
function differenceInMinutes(a, b) {
    return (0, dayjs_1.default)(a).diff((0, dayjs_1.default)(b), "minute");
}
//# sourceMappingURL=date.js.map