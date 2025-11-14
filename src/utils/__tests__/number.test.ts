import { toInt, toBigInt } from '../number';

describe('number utils', () => {
  describe('toInt', () => {
    it('должен конвертировать число в целое', () => {
      expect(toInt(42)).toBe(42);
      expect(toInt(42.7)).toBe(42);
      expect(toInt(-10)).toBe(-10);
    });

    it('должен конвертировать строку в число', () => {
      expect(toInt('42')).toBe(42);
      expect(toInt('42.7')).toBe(42);
      expect(toInt('-10')).toBe(-10);
    });

    it('должен конвертировать bigint в number', () => {
      expect(toInt(BigInt(42))).toBe(42);
      expect(toInt(BigInt(999999999))).toBe(999999999);
    });

    it('должен возвращать undefined для невалидных значений', () => {
      expect(toInt(null)).toBeUndefined();
      expect(toInt(undefined)).toBeUndefined();
      expect(toInt('')).toBeUndefined();
      expect(toInt('abc')).toBeUndefined();
      expect(toInt(NaN)).toBeUndefined();
      expect(toInt(Infinity)).toBeUndefined();
    });

    it('должен обрабатывать пустую строку', () => {
      expect(toInt('   ')).toBeUndefined();
    });
  });

  describe('toBigInt', () => {
    it('должен конвертировать bigint в bigint', () => {
      expect(toBigInt(BigInt(42))).toBe(BigInt(42));
      expect(toBigInt(BigInt(999999999999))).toBe(BigInt(999999999999));
    });

    it('должен конвертировать число в bigint', () => {
      expect(toBigInt(42)).toBe(BigInt(42));
      expect(toBigInt(-10)).toBe(BigInt(-10));
    });

    it('должен конвертировать строку в bigint', () => {
      expect(toBigInt('42')).toBe(BigInt(42));
      expect(toBigInt('-10')).toBe(BigInt(-10));
      expect(toBigInt('999999999999')).toBe(BigInt(999999999999));
    });

    it('должен возвращать undefined для невалидных значений', () => {
      expect(toBigInt(null)).toBeUndefined();
      expect(toBigInt(undefined)).toBeUndefined();
      expect(toBigInt('')).toBeUndefined();
      expect(toBigInt('abc')).toBeUndefined();
      expect(toBigInt('42.5')).toBeUndefined();
      expect(toBigInt(NaN)).toBeUndefined();
      expect(toBigInt(Infinity)).toBeUndefined();
    });

    it('должен обрабатывать пустую строку', () => {
      expect(toBigInt('   ')).toBeUndefined();
    });
  });
});

