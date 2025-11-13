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
export declare class CalendarService {
    exportUserCalendar(userId: number | string): Promise<CalendarResult | null>;
    exportUserCalendarToExcel(userId: number | string): Promise<ExcelResult | null>;
    private translatePriority;
    private translateStatus;
    private toIcsArray;
}
export declare const calendarService: CalendarService;
export {};
//# sourceMappingURL=calendarService.d.ts.map