import { formatDate, addMinutes, addDays, startOfDay, endOfDay, differenceInMinutes } from '../date';

describe('date utils', () => {
  const testDate = new Date('2024-01-15T14:30:00Z');

  describe('formatDate', () => {
    it('должен форматировать дату в правильном формате', () => {
      const result = formatDate(testDate);
      // Формат: DD.MM.YYYY HH:mm
      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    });

    it('должен обрабатывать строковые даты', () => {
      const result = formatDate('2024-01-15T14:30:00Z');
      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    });
  });

  describe('addMinutes', () => {
    it('должен добавлять минуты к дате', () => {
      const result = addMinutes(testDate, 30);
      const diff = differenceInMinutes(result, testDate);
      expect(diff).toBe(30);
    });

    it('должен вычитать минуты при отрицательном значении', () => {
      const result = addMinutes(testDate, -15);
      const diff = differenceInMinutes(result, testDate);
      expect(diff).toBe(-15);
    });
  });

  describe('addDays', () => {
    it('должен добавлять дни к дате', () => {
      const result = addDays(testDate, 7);
      const diff = Math.floor((result.getTime() - testDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diff).toBe(7);
    });

    it('должен вычитать дни при отрицательном значении', () => {
      const result = addDays(testDate, -3);
      const diff = Math.floor((result.getTime() - testDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diff).toBe(-3);
    });
  });

  describe('startOfDay', () => {
    it('должен возвращать начало дня', () => {
      const result = startOfDay(testDate);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
    });
  });

  describe('endOfDay', () => {
    it('должен возвращать конец дня', () => {
      const result = endOfDay(testDate);
      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
    });
  });

  describe('differenceInMinutes', () => {
    it('должен вычислять разницу в минутах', () => {
      const date1 = new Date('2024-01-15T14:00:00Z');
      const date2 = new Date('2024-01-15T14:30:00Z');
      expect(differenceInMinutes(date2, date1)).toBe(30);
    });

    it('должен возвращать отрицательное значение, если первая дата раньше', () => {
      const date1 = new Date('2024-01-15T14:30:00Z');
      const date2 = new Date('2024-01-15T14:00:00Z');
      expect(differenceInMinutes(date2, date1)).toBe(-30);
    });
  });
});
