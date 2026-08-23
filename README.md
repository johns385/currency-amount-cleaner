# currency-amount-cleaner

Every system that ingests currency amounts from the outside world — CSV
imports, pasted invoice lines, third-party APIs, users typing into a form —
ends up with a pile of strings that all mean "the same kind of thing" but
look nothing alike:

```
$1,234.56
1.234,56
(500.00)
USD 1,234.5
1_000.50
42.90-
```

The first four are the same ambiguity in different clothes: is the comma a
thousands separator or a decimal point? The parenthesized one is accounting
notation for negative. The trailing minus is a ledger-export convention.
None of this is exotic — it's what you get the first time you point a
formatter at real data instead of numbers you typed yourself.

This library takes one of these strings and turns it into a canonical,
signed integer number of cents, plus whatever currency it could figure out.
Cents instead of a float, so summing or comparing amounts downstream doesn't
run into `0.1 + 0.2` territory.

## Usage

```ts
import { normalizeAmount } from './src/normalizeAmount.ts';

normalizeAmount('$1,234.56');
// { cents: 123456, currency: 'USD', negative: false, formatted: '1234.56' }

normalizeAmount('(500.00)');
// { cents: -50000, currency: null, negative: true, formatted: '-500.00' }

normalizeAmount('1.234,56'); // European decimal comma
// { cents: 123456, currency: null, negative: false, formatted: '1234.56' }

normalizeAmount('not an amount');
// throws AmountParseError
```

If you know where the string came from, pass a locale hint to resolve the
separator ambiguity exactly instead of guessing:

```ts
normalizeAmount('1,234', { locale: 'us' });
// { cents: 123400, currency: null, negative: false, formatted: '1234.00' }

normalizeAmount('1,234', { locale: 'eu' });
// { cents: 123, currency: null, negative: false, formatted: '1.23' }
```

## How the ambiguous cases are resolved

Without a locale hint there's no signal in a bare string, so the parser
falls back to rules that match the common case over the rare one:

- If both `,` and `.` appear, the rightmost one is the decimal point and the
  other is a thousands separator (`1.234,56` and `1,234.56` both mean
  1234.56).
- If only one separator appears once and is followed by exactly three
  digits, it's treated as thousands grouping, not a decimal (`1,000` is one
  thousand, not one-point-oh-oh-oh). This is a guess, and it's wrong for the
  rare currency that prices things to three decimal places.
- A separator that repeats (`1.234.567`) can only be a thousands separator.
- Parentheses, a leading `-`, and a trailing `-` all mean negative.

Passing `{ locale: 'us' }` or `{ locale: 'eu' }` skips all of the guessing
above: the decimal and thousands separator roles are fixed by the hint, so
`1,5` under `'us'` is 1500 (comma is thousands, digit count doesn't matter)
and under `'eu'` is 150 (comma is the decimal point). A hint that
contradicts the actual input (e.g. `{ locale: 'eu' }` on `1,234.56`) throws
`AmountParseError` rather than silently misreading it.

These rules and their edge cases are what the test suite in
`src/normalizeAmount.test.ts` is for — it's table-driven specifically so
each awkward input gets its own named case instead of being folded into one
big assertion.

## Running the tests

Requires Node 22.6+ for native TypeScript execution — no build step, no
dependencies:

```
npm test
```

## Status

Early skeleton. Currency detection covers major symbols (`$ € £ ¥ ₹ ₩ ₽ ₺ ₫
₪ ₴ ₦ ฿ R$`) and about 40 ISO codes; anything else comes back with
`currency: null` rather than a guess. Symbols shared by more than one
currency in practice (`kr`, `Fr`) are left unmapped on purpose.
