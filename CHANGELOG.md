# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [semantic versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release. Everything below shipped together since there was no prior
published version to diff against.

### Added

- `normalizeAmount` — parses currency amount strings with inconsistent
  decimal/thousands separators, currency symbols or ISO codes, and negative
  notations (leading `-`, trailing `-`, accounting parentheses) into a
  signed integer cents value.
- `LocaleHint` option (`'us' | 'eu'`) to resolve separator ambiguity exactly
  instead of guessing, for callers who know where the string came from.
- `formatCurrency` — the inverse direction, rendering a cents value back
  into a display string with comma thousands / period decimal and a
  currency symbol or ISO code suffix.
- Currency detection covering the major symbols (`$ € £ ¥ ₹ ₩ ₽ ₺ ₫ ₪ ₴ ₦ ฿
  R$`) and about 40 ISO 4217 codes.
- Table-driven test suite in `src/normalizeAmount.test.ts` covering the
  documented separator, sign, and currency rules.
- Seeded fuzz test in `src/normalizeAmount.fuzz.test.ts` checking that the
  parser either throws `AmountParseError` or returns an internally
  consistent, round-trippable result for malformed input.

### Fixed

- `normalizeAmount` and `formatCurrency` now render a leading `-` for
  negative zero amounts (e.g. `(0.00)`), which previously formatted as
  `0.00` because `-0 < 0` is `false` in JavaScript.
- `normalizeAmount` now recognizes a negative sign on either side of the
  currency marker (`$-5.00`, `USD (500.00)`), not just outside it. Sign
  detection previously ran once on the raw string before the currency was
  stripped, so a sign written between the currency and the digits fell
  through to the numeric parser and threw `AmountParseError`.
