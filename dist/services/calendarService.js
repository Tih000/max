"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarService = exports.CalendarService = void 0;
const ics_1 = require("ics");
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../db");
const logger_1 = require("../logger");
const date_1 = require("../utils/date");
const ids_1 = require("../utils/ids");
class CalendarService {
    async exportUserCalendar(userId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const tasks = await db_1.prisma.task.findMany({
            where: {
                OR: [{ assigneeId: normalizedUserId }, { createdByUserId: normalizedUserId }],
                dueDate: {
                    not: null,
                    lte: (0, date_1.addDays)(new Date(), 60),
                },
            },
            orderBy: { dueDate: "asc" },
        });
        if (tasks.length === 0) {
            return null;
        }
        const events = tasks
            .filter((task) => task.dueDate)
            .map((task) => {
            const dueDate = task.dueDate;
            return {
                title: task.title,
                description: task.description ?? "",
                start: this.toIcsArray(dueDate),
                duration: { hours: 1 },
            };
        });
        const { value, error } = (0, ics_1.createEvents)(events);
        if (error) {
            logger_1.logger.error("Не удалось сгенерировать ICS", { error, location: "exportUserCalendar" });
            return null;
        }
        const summary = tasks
            .map((task) => `${task.title} — дедлайн ${(0, date_1.formatDate)(task.dueDate)}`)
            .join("\n");
        return {
            ics: value,
            filename: `max-assistant-${normalizedUserId}.ics`,
            summary,
        };
    }
    async exportUserCalendarToExcel(userId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const tasks = await db_1.prisma.task.findMany({
            where: {
                OR: [{ assigneeId: normalizedUserId }, { createdByUserId: normalizedUserId }],
                dueDate: {
                    not: null,
                    lte: (0, date_1.addDays)(new Date(), 60),
                },
            },
            orderBy: { dueDate: "asc" },
        });
        if (tasks.length === 0) {
            return null;
        }
        // Создаем новую книгу Excel
        const workbook = new exceljs_1.default.Workbook();
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
            if (!task.dueDate)
                return;
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
                const maxLength = Math.max(column.header?.length || 0, ...worksheet.getColumn(column.key).values
                    .filter((v) => v !== undefined && v !== null)
                    .map((v) => String(v).length));
                column.width = Math.min(maxLength + 2, 50);
            }
        });
        // Генерируем буфер
        const buffer = await workbook.xlsx.writeBuffer();
        const summary = tasks
            .map((task) => `${task.title} — дедлайн ${(0, date_1.formatDate)(task.dueDate)}`)
            .join("\n");
        return {
            buffer: Buffer.from(buffer),
            filename: `max-assistant-${normalizedUserId}.xlsx`,
            summary,
        };
    }
    translatePriority(priority) {
        const translations = {
            low: "Низкий",
            medium: "Средний",
            high: "Высокий",
        };
        return translations[priority] || priority;
    }
    translateStatus(status) {
        const translations = {
            open: "Открыта",
            completed: "Выполнена",
            cancelled: "Отменена",
        };
        return translations[status] || status;
    }
    toIcsArray(date) {
        return [
            date.getUTCFullYear(),
            date.getUTCMonth() + 1,
            date.getUTCDate(),
            date.getUTCHours(),
            date.getUTCMinutes(),
        ];
    }
}
exports.CalendarService = CalendarService;
exports.calendarService = new CalendarService();
//# sourceMappingURL=calendarService.js.map