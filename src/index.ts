import { App } from "./app";
import { logger } from "./logger";

const app = new App();

async function bootstrap() {
  try {
    await app.init();
    await app.start();
  } catch (error) {
    logger.error("Не удалось запустить приложение", {
      location: "index.bootstrap",
      error,
    });
    process.exit(1);
  }
}

bootstrap();

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  logger.system(`Получен сигнал завершения: ${signal}`);
  try {
    await app.stop();
    process.exit(0);
  } catch (error) {
    logger.error("Ошибка при завершении работы", {
      location: "index.gracefulShutdown",
      error,
    });
    process.exit(1);
  }
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

