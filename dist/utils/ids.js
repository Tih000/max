"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toIdString = toIdString;
exports.ensureIdString = ensureIdString;
exports.idStringToNumber = idStringToNumber;
function toIdString(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "string") {
        return value;
    }
    return value.toString();
}
function ensureIdString(value, fallback = "0") {
    const id = toIdString(value);
    return id ?? fallback;
}
function idStringToNumber(value) {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}
//# sourceMappingURL=ids.js.map