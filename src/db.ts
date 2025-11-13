import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
});

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.system("База данных подключена");
  } catch (error) {
    logger.error("Не удалось подключиться к базе данных", {
      location: "db.connectDatabase",
      error,
    });
    throw error;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.system("База данных отключена");
}

