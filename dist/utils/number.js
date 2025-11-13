"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toInt = toInt;
function toInt(value) {
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
//# sourceMappingURL=number.js.map