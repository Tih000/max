"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeText = sanitizeText;
exports.truncate = truncate;
exports.formatBulletList = formatBulletList;
exports.formatMaterials = formatMaterials;
exports.shortenUrl = shortenUrl;
function sanitizeText(input) {
    if (!input) {
        return "";
    }
    return input.replace(/\s+/g, " ").trim();
}
function truncate(text, maxLength = 4000) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 3)}...`;
}
function formatBulletList(items) {
    return items.map((item) => `• ${item}`).join("\n");
}
/**
 * Форматирует материалы в том же формате, что и в разделе "Материалы"
 * @param materials - Массив материалов
 * @returns Отформатированный список материалов
 */
function formatMaterials(materials) {
    const materialsList = materials.map((m) => {
        const parts = [];
        // Если есть ссылка, делаем название кликабельной ссылкой в Markdown
        if (m.link) {
            // Убеждаемся, что ссылка имеет протокол
            let linkUrl = m.link.trim();
            if (!linkUrl.startsWith("http://") && !linkUrl.startsWith("https://")) {
                linkUrl = `https://${linkUrl}`;
            }
            parts.push(`[**${m.title}**](${linkUrl})`);
        }
        else {
            parts.push(`**${m.title}**`);
        }
        // Добавляем краткую сводку, если есть
        if (m.description) {
            parts.push(`   ${m.description}`);
        }
        return parts.join("\n");
    });
    return formatBulletList(materialsList);
}
/**
 * Сокращает длинную ссылку для отображения
 * @param url - URL для сокращения
 * @param maxLength - Максимальная длина (по умолчанию 50)
 * @returns Сокращенная ссылка
 */
function shortenUrl(url, maxLength = 50) {
    if (!url || url.length <= maxLength) {
        return url;
    }
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        const pathname = urlObj.pathname;
        // Если hostname + pathname короче maxLength, возвращаем их
        const fullPath = hostname + pathname;
        if (fullPath.length <= maxLength - 10) {
            return fullPath;
        }
        // Сокращаем pathname
        if (pathname.length > 20) {
            const shortPath = pathname.substring(0, 15) + "...";
            return hostname + shortPath;
        }
        // Сокращаем hostname, если он слишком длинный
        if (hostname.length > maxLength - 10) {
            return hostname.substring(0, maxLength - 10) + "...";
        }
        return hostname + pathname.substring(0, maxLength - hostname.length - 3) + "...";
    }
    catch {
        // Если это не валидный URL, просто обрезаем строку
        return url.substring(0, maxLength - 3) + "...";
    }
}
//# sourceMappingURL=text.js.map