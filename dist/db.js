"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
exports.prisma = new client_1.PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
});
async function connectDatabase() {
    try {
        await exports.prisma.$connect();
        logger_1.logger.system("База данных подключена");
    }
    catch (error) {
        logger_1.logger.error("Не удалось подключиться к базе данных", {
            location: "db.connectDatabase",
            error,
        });
        throw error;
    }
}
async function disconnectDatabase() {
    await exports.prisma.$disconnect();
    logger_1.logger.system("База данных отключена");
}
//# sourceMappingURL=db.js.map