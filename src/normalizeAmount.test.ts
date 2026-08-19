import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAmount, AmountParseError, type NormalizedAmount } from './normalizeAmount.ts';

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
