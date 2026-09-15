import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAmount, formatCurrency, AmountParseError, type NormalizedAmount } from './normalizeAmount.ts';

interface Case {
  input: string;
  expected: Pick<NormalizedAmount, 'cents' | 'currency' | 'negative'>;
}

// Each row targets one specific piece of messiness. When one of these fails
// it should be obvious from the input alone which rule broke.
const cases: Case[] = [
  { input: '$1,234.56', expected: { cents: 123456, currency: 'USD', negative: false } },
  { input: '1.234,56', expected: { cents: 123456, currency: null, negative: false } },
  { input: '(500.00)', expected: { cents: -50000, currency: null, negative: true } },
  { input: '1000', expected: { cents: 100000, currency: null, negative: false } },
  { input: '1,000', expected: { cents: 100000, currency: null, negative: false } },
  { input: '1,00', expected: { cents: 100, currency: null, negative: false } },
  { input: 'USD 1,234.5', expected: { cents: 123450, currency: 'USD', negative: false } },
  { input: '€ 1.234,5', expected: { cents: 123450, currency: 'EUR', negative: false } },
  { input: '£5', expected: { cents: 500, currency: 'GBP', negative: false } },
  { input: '-42.9', expected: { cents: -4290, currency: null, negative: true } },
  { input: '42.9-', expected: { cents: -4290, currency: null, negative: true } },
  { input: '1_000.50', expected: { cents: 100050, currency: null, negative: false } },
  { input: '1 234,56', expected: { cents: 123456, currency: null, negative: false } },
  { input: '  100.00  ', expected: { cents: 10000, currency: null, negative: false } },
  { input: '1.234.567', expected: { cents: 123456700, currency: null, negative: false } },
  { input: '12.3456', expected: { cents: 1235, currency: null, negative: false } },
  { input: '.5', expected: { cents: 50, currency: null, negative: false } },
  { input: '₩10,000', expected: { cents: 1000000, currency: 'KRW', negative: false } },
  { input: 'R$5,00', expected: { cents: 500, currency: 'BRL', negative: false } },
  { input: '5R$', expected: { cents: 500, currency: 'BRL', negative: false } },
  { input: 'PLN 1,50', expected: { cents: 150, currency: 'PLN', negative: false } },
  { input: '100 SEK', expected: { cents: 10000, currency: 'SEK', negative: false } },
  { input: '(0.00)', expected: { cents: -0, currency: null, negative: true } },
  { input: '-0.00', expected: { cents: -0, currency: null, negative: true } },
];

for (const { input, expected } of cases) {
  test(`normalizeAmount(${JSON.stringify(input)})`, () => {
    const result = normalizeAmount(input);
    assert.equal(result.cents, expected.cents);
    assert.equal(result.currency, expected.currency);
    assert.equal(result.negative, expected.negative);
    assert.equal(result.formatted, `${result.negative ? '-' : ''}${Math.abs(result.cents / 100).toFixed(2)}`);
  });
}

test('throws on empty input', () => {
  assert.throws(() => normalizeAmount(''), AmountParseError);
  assert.throws(() => normalizeAmount('   '), AmountParseError);
});

test('throws when there are no digits at all', () => {
  assert.throws(() => normalizeAmount('not a number'), AmountParseError);
});

test('throws on stray punctuation with no digits', () => {
  assert.throws(() => normalizeAmount('$-'), AmountParseError);
});

// Without a hint these are guesses (see splitIntegerFraction). With one,
// the separator's role is fixed regardless of digit count or position.
interface LocaleCase {
  input: string;
  locale: 'us' | 'eu';
  expected: Pick<NormalizedAmount, 'cents' | 'currency' | 'negative'>;
}

const localeCases: LocaleCase[] = [
  { input: '1,234', locale: 'us', expected: { cents: 123400, currency: null, negative: false } },
  { input: '1,234', locale: 'eu', expected: { cents: 123, currency: null, negative: false } },
  { input: '1.234', locale: 'us', expected: { cents: 123, currency: null, negative: false } },
  { input: '1.234', locale: 'eu', expected: { cents: 123400, currency: null, negative: false } },
  { input: '1,5', locale: 'us', expected: { cents: 1500, currency: null, negative: false } },
  { input: '1,5', locale: 'eu', expected: { cents: 150, currency: null, negative: false } },
  { input: '$1,234.56', locale: 'us', expected: { cents: 123456, currency: 'USD', negative: false } },
  { input: '1.234.567', locale: 'eu', expected: { cents: 123456700, currency: null, negative: false } },
];

for (const { input, locale, expected } of localeCases) {
  test(`normalizeAmount(${JSON.stringify(input)}, { locale: ${JSON.stringify(locale)} })`, () => {
    const result = normalizeAmount(input, { locale });
    assert.equal(result.cents, expected.cents);
    assert.equal(result.currency, expected.currency);
    assert.equal(result.negative, expected.negative);
  });
}

test('locale hint that contradicts the actual format throws instead of misparsing', () => {
  assert.throws(() => normalizeAmount('1,234.56', { locale: 'eu' }), AmountParseError);
});

interface FormatCase {
  cents: number;
  currency?: string | null;
  expected: string;
}

const formatCases: FormatCase[] = [
  { cents: 123456, currency: 'USD', expected: '$1,234.56' },
  { cents: 123456, currency: null, expected: '1,234.56' },
  { cents: -50000, currency: null, expected: '-500.00' },
  { cents: 0, currency: 'EUR', expected: '€0.00' },
  { cents: 500, currency: 'BRL', expected: 'R$5.00' },
  { cents: 150, currency: 'PLN', expected: '1.50 PLN' },
  { cents: -150, currency: 'PLN', expected: '-1.50 PLN' },
  { cents: 100000000, currency: 'USD', expected: '$1,000,000.00' },
  { cents: 9, currency: undefined, expected: '0.09' },
  { cents: -0, currency: null, expected: '-0.00' },
];

for (const { cents, currency, expected } of formatCases) {
  test(`formatCurrency(${cents}, ${JSON.stringify(currency)})`, () => {
    assert.equal(formatCurrency(cents, currency), expected);
  });
}

test('formatCurrency rejects non-integer cents', () => {
  assert.throws(() => formatCurrency(12.5, 'USD'), AmountParseError);
});

test('formatCurrency round-trips through normalizeAmount for known symbols', () => {
  const { cents, currency } = normalizeAmount('$1,234.56');
  assert.equal(formatCurrency(cents, currency), '$1,234.56');
});
