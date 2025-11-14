import type { Task } from "@prisma/client";
import { createEvents } from "ics";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { logger } from "../logger";
import { addDays, formatDate } from "../utils/date";
import { toInt } from "../utils/number";

type CalendarResult = {
  ics: string;
  filename: string;
  summary: string;
};

type ExcelResult = {
  buffer: Buffer;
  filename: string;
  summary: string;
};

export class CalendarService {
  async exportUserCalendar(userId: number | string): Promise<CalendarResult | null> {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) {
      throw new Error("Не удалось определить ID пользователя");
    }
    const tasks: Task[] = await prisma.task.findMany({
      where: {
        OR: [{ assigneeId: normalizedUserId }, { createdByUserId: normalizedUserId }],
        dueDate: {
          not: null,
          lte: addDays(new Date(), 60),
        },
      },
      orderBy: { dueDate: "asc" },
    });

    if (tasks.length === 0) {
      return null;
    }

    const events = tasks
      .filter((task) => task.dueDate)
      .map((task: Task) => {
        const dueDate = task.dueDate!;
        return {
          title: task.title,
          description: task.description ?? "",
          start: this.toIcsArray(dueDate),
          duration: { hours: 1 },
        };
      });

    const { value, error } = createEvents(events);
    if (error) {
      logger.error("Не удалось сгенерировать ICS", { error, location: "exportUserCalendar" });
      return null;
    }

    const summary = tasks
      .map((task: Task) => `${task.title} — дедлайн ${formatDate(task.dueDate!)}`)
      .join("\n");

    return {
      ics: value!,
      filename: `max-assistant-${normalizedUserId}.ics`,
      summary,
    };
  }

  async exportUserCalendarToExcel(userId: number | string): Promise<ExcelResult | null> {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) {
      throw new Error("Не удалось определить ID пользователя");
    }
    const tasks: Task[] = await prisma.task.findMany({
      where: {
        OR: [{ assigneeId: normalizedUserId }, { createdByUserId: normalizedUserId }],
        dueDate: {
          not: null,
          lte: addDays(new Date(), 60),
        },
      },
      orderBy: { dueDate: "asc" },
    });

    if (tasks.length === 0) {
      return null;
    }

    // Создаем новую книгу Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Важные даты");

    // Настраиваем колонки
    worksheet.columns = [
      { header: "Дата", key: "date", width: 15 },
      { header: "Время", key: "time", width: 10 },
      { header: "Название задачи", key: "title", width: 40 },
      { header: "Описание", key: "description", width: 50 },
      { header: "Ответственный", key: "assignee", width: 20 },
      { header: "Создатель", key: "creator", width: 20 },
      { header: "Приоритет", key: "priority", width: 12 },
      { header: "Статус", key: "status", width: 12 },
    ];

    // Стили для заголовков
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Добавляем данные
    tasks.forEach((task) => {
      if (!task.dueDate) return;

      const dueDate = task.dueDate;

      worksheet.addRow({
        date: dueDate, // ExcelJS автоматически форматирует Date объекты
        time: dueDate, // Используем тот же Date для времени
        title: task.title,
        description: task.description || "",
        assignee: task.assigneeName || "",
        creator: task.createdByName || "",
        priority: this.translatePriority(task.priority),
        status: this.translateStatus(task.status),
      });
    });

    // Форматируем даты и время
    worksheet.getColumn("date").numFmt = "dd.mm.yyyy";
    worksheet.getColumn("time").numFmt = "hh:mm";

    // Автоматическая ширина колонок
    worksheet.columns.forEach((column) => {
      if (column.key) {
        const maxLength = Math.max(
          column.header?.length || 0,
          ...(worksheet.getColumn(column.key).values as (string | number | undefined)[])
            .filter((v): v is string | number => v !== undefined && v !== null)
            .map((v) => String(v).length),
        );
        column.width = Math.min(maxLength + 2, 50);
      }
    });

    // Генерируем буфер
    const buffer = await workbook.xlsx.writeBuffer();

    const summary = tasks
      .map((task: Task) => `${task.title} — дедлайн ${formatDate(task.dueDate!)}`)
      .join("\n");

    return {
      buffer: Buffer.from(buffer),
      filename: `max-assistant-${normalizedUserId}.xlsx`,
      summary,
    };
  }

  private translatePriority(priority: string): string {
    const translations: Record<string, string> = {
      low: "Низкий",
      medium: "Средний",
      high: "Высокий",
    };
    return translations[priority] || priority;
  }

  private translateStatus(status: string): string {
    const translations: Record<string, string> = {
      open: "Открыта",
      completed: "Выполнена",
      cancelled: "Отменена",
    };
    return translations[status] || status;
  }

  private toIcsArray(date: Date) {
    return [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
    ] as [number, number, number, number, number];
  }
}

export const calendarService = new CalendarService();

