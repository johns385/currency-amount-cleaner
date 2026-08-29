import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAmount, AmountParseError } from './normalizeAmount.ts';

// Deterministic PRNG so a fuzz failure always reproduces from the same seed
// instead of only showing up intermittently. (mulberry32)
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Digits and separators dominate so most strings look amount-shaped; the
// rest is currency noise and stray punctuation that should make the parser
// give up cleanly rather than crash. Capped at 12 characters so any digit
// run stays well inside Number's exact-integer range -- this test is about
// the parser's robustness, not about tripping float precision.
const ALPHABET = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '.', ',', '-', '+', '(', ')', ' ', '_',
  String.fromCharCode(160), // NBSP
  '$', '€', '£', '¥', '₹', '₩', 'R',
  'U', 'S', 'D', 'E', 'P', 'L', 'N', 'A', 'B', 'x',
];

function randomAmountLikeString(rand: () => number): string {
  const length = 1 + Math.floor(rand() * 12);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return out;
}

const SEED = 20260830;
const ITERATIONS = 5000;

test('normalizeAmount either throws AmountParseError or returns an internally consistent result', () => {
  const rand = mulberry32(SEED);

  for (let i = 0; i < ITERATIONS; i++) {
    const input = randomAmountLikeString(rand);
    let result;
    try {
      result = normalizeAmount(input);
    } catch (err) {
      assert.ok(
        err instanceof AmountParseError,
        `input ${JSON.stringify(input)} threw ${(err as Error)?.constructor?.name ?? typeof err}: ${(err as Error)?.message}`,
      );
      continue;
    }

    assert.ok(
      Number.isInteger(result.cents),
      `input ${JSON.stringify(input)} produced non-integer cents ${result.cents}`,
    );

    if (result.negative) {
      assert.ok(result.cents <= 0, `input ${JSON.stringify(input)} marked negative but cents is ${result.cents}`);
    } else {
      assert.ok(result.cents >= 0, `input ${JSON.stringify(input)} marked positive but cents is ${result.cents}`);
    }

    assert.match(
      result.formatted,
      /^-?\d+\.\d{2}$/,
      `input ${JSON.stringify(input)} produced malformed formatted string ${JSON.stringify(result.formatted)}`,
    );

    if (result.currency !== null) {
      assert.match(
        result.currency,
        /^[A-Z]{3}$/,
        `input ${JSON.stringify(input)} produced malformed currency ${JSON.stringify(result.currency)}`,
      );
    }

    // The formatted string never has a thousands separator or a currency
    // marker, so feeding it back in is unambiguous -- it should reproduce
    // the exact same cents value every time.
    const reparsed = normalizeAmount(result.formatted);
    assert.equal(
      reparsed.cents,
      result.cents,
      `input ${JSON.stringify(input)} did not round-trip through its own formatted output ${JSON.stringify(result.formatted)}`,
    );
  }
});
