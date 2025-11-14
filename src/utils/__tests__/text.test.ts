import { sanitizeText, truncate, formatBulletList, formatMaterials, shortenUrl } from '../text';

describe('text utils', () => {
  describe('sanitizeText', () => {
    it('должен удалять лишние пробелы', () => {
      expect(sanitizeText('  hello   world  ')).toBe('hello world');
    });

    it('должен обрабатывать null и undefined', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
    });

    it('должен обрабатывать пустую строку', () => {
      expect(sanitizeText('')).toBe('');
    });

    it('должен нормализовать множественные пробелы', () => {
      expect(sanitizeText('hello    world   test')).toBe('hello world test');
    });
  });

  describe('truncate', () => {
    it('должен обрезать длинный текст', () => {
      const longText = 'a'.repeat(100);
      const result = truncate(longText, 50);
      expect(result.length).toBe(50);
      expect(result).toMatch(/^a+\.\.\.$/);
    });

    it('не должен обрезать короткий текст', () => {
      const shortText = 'hello world';
      expect(truncate(shortText, 50)).toBe(shortText);
    });

    it('должен использовать дефолтную длину 4000', () => {
      const text = 'a'.repeat(5000);
      const result = truncate(text);
      expect(result.length).toBe(4000);
    });
  });

  describe('formatBulletList', () => {
    it('должен форматировать список с буллетами', () => {
      const items = ['item1', 'item2', 'item3'];
      const result = formatBulletList(items);
      expect(result).toBe('• item1\n• item2\n• item3');
    });

    it('должен обрабатывать пустой массив', () => {
      expect(formatBulletList([])).toBe('');
    });
  });

  describe('formatMaterials', () => {
    it('должен форматировать материалы со ссылками', () => {
      const materials = [
        { title: 'Test Material', link: 'https://example.com' },
        { title: 'Another Material', link: 'https://test.com' },
      ];
      const result = formatMaterials(materials);
      expect(result).toContain('[**Test Material**](https://example.com)');
      expect(result).toContain('[**Another Material**](https://test.com)');
    });

    it('должен форматировать материалы без ссылок', () => {
      const materials = [
        { title: 'Material 1', link: null },
        { title: 'Material 2' },
      ];
      const result = formatMaterials(materials);
      expect(result).toContain('**Material 1**');
      expect(result).toContain('**Material 2**');
    });

    it('должен добавлять описание, если есть', () => {
      const materials = [
        { title: 'Test', link: 'https://example.com', description: 'Test description' },
      ];
      const result = formatMaterials(materials);
      expect(result).toContain('Test description');
    });

    it('должен добавлять https:// к ссылкам без протокола', () => {
      const materials = [
        { title: 'Test', link: 'example.com' },
      ];
      const result = formatMaterials(materials);
      expect(result).toContain('https://example.com');
    });
  });

  describe('shortenUrl', () => {
    it('не должен сокращать короткие URL', () => {
      const url = 'https://example.com';
      expect(shortenUrl(url, 50)).toBe(url);
    });

    it('должен сокращать длинные URL', () => {
      const url = 'https://example.com/very/long/path/that/exceeds/maximum/length';
      const result = shortenUrl(url, 30);
      expect(result.length).toBeLessThanOrEqual(33); // 30 + "..."
      expect(result).toContain('...');
    });

    it('должен обрабатывать невалидные URL', () => {
      const invalidUrl = 'not a valid url but very long string that needs to be truncated';
      const result = shortenUrl(invalidUrl, 20);
      expect(result.length).toBeLessThanOrEqual(23);
      expect(result).toContain('...');
    });

    it('должен использовать дефолтную длину 50', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(100);
      const result = shortenUrl(longUrl);
      expect(result.length).toBeLessThanOrEqual(53);
    });
  });
});
