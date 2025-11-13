export declare function sanitizeText(input?: string | null): string;
export declare function truncate(text: string, maxLength?: number): string;
export declare function formatBulletList(items: string[]): string;
/**
 * Форматирует материалы в том же формате, что и в разделе "Материалы"
 * @param materials - Массив материалов
 * @returns Отформатированный список материалов
 */
export declare function formatMaterials(materials: Array<{
    title: string;
    link?: string | null;
    description?: string | null;
}>): string;
/**
 * Сокращает длинную ссылку для отображения
 * @param url - URL для сокращения
 * @param maxLength - Максимальная длина (по умолчанию 50)
 * @returns Сокращенная ссылка
 */
export declare function shortenUrl(url: string, maxLength?: number): string;
//# sourceMappingURL=text.d.ts.map