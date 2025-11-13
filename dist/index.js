"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const logger_1 = require("./logger");
const app = new app_1.App();
async function bootstrap() {
    try {
        await app.init();
        await app.start();
    }
    catch (error) {
        logger_1.logger.error("Не удалось запустить приложение", {
            location: "index.bootstrap",
            error,
        });
        process.exit(1);
    }
}
bootstrap();
const gracefulShutdown = async (signal) => {
    logger_1.logger.system(`Получен сигнал завершения: ${signal}`);
    try {
        await app.stop();
        process.exit(0);
    }
    catch (error) {
        logger_1.logger.error("Ошибка при завершении работы", {
            location: "index.gracefulShutdown",
            error,
        });
        process.exit(1);
    }
};
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
//# sourceMappingURL=index.js.map