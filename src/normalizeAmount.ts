// Turns messy, human- or export-generated currency strings into a canonical
// integer-cents value. Cents (not floats) avoid the 0.1 + 0.2 problem when
// callers go on to sum or compare amounts.

export interface NormalizedAmount {
  /** Signed integer number of minor units (cents). Negative when the amount is negative. */
  cents: number;
  /** ISO 4217 code if one could be detected from a symbol or code in the input, else null. */
  currency: string | null;
  negative: boolean;
  /** Canonical decimal string, e.g. "-1234.56". Always has exactly two fraction digits. */
  formatted: string;
}

export class AmountParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountParseError';
  }
}

// 'us': '.' is the decimal point, ',' is thousands grouping (1,234.56).
// 'eu': ',' is the decimal point, '.' is thousands grouping (1.234,56).
export type LocaleHint = 'us' | 'eu';

export interface NormalizeAmountOptions {
  /**
   * When a string has a single separator with a digit count that doesn't
   * disambiguate it (e.g. "1,5" or "1,234"), the parser normally guesses.
   * Passing a locale hint makes that decision exact instead of guessed, and
   * also overrides the "rightmost separator is the decimal point" rule used
   * when both separators are present.
   */
  locale?: LocaleHint;
}

// Only symbols that map unambiguously to one currency in practice. "kr" and
// "Fr" are left out on purpose -- several currencies share them (SEK/NOK/DKK,
// CHF/XOF/...) and a wrong guess is worse than none.
const SYMBOL_TO_CODE: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  '₽': 'RUB',
  '₺': 'TRY',
  '₫': 'VND',
  '₪': 'ILS',
  '₴': 'UAH',
  '₦': 'NGN',
  '฿': 'THB',
  'R$': 'BRL',
};

// Extending this is cheap and low-risk as long as each code is unambiguous
// on its own; get it wrong and we'd silently mislabel currencies, which is
// worse than leaving them null.
const KNOWN_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR',
  'KRW', 'RUB', 'TRY', 'VND', 'ILS', 'UAH', 'NGN', 'THB', 'BRL',
  'SEK', 'NOK', 'DKK', 'PLN', 'MXN', 'ZAR', 'SGD', 'HKD', 'NZD',
  'IDR', 'MYR', 'PHP', 'AED', 'SAR', 'CZK', 'HUF', 'RON', 'EGP',
  'PKR', 'KES', 'COP', 'ARS', 'CLP', 'PEN', 'BDT',
]);

const NBSP = String.fromCharCode(160);

export function normalizeAmount(raw: string, options?: NormalizeAmountOptions): NormalizedAmount {
  const cleaned = raw.split(NBSP).join(' ').trim();
  if (cleaned === '') {
    throw new AmountParseError('cannot parse amount: input is empty');
  }

  const { negative, rest: afterSign } = extractSign(cleaned);
  const { currency, rest: afterCurrency } = extractCurrency(afterSign);
  const numeric = afterCurrency.replace(/[\s_]/g, '');

  const { intPart: rawIntPart, fracPart: rawFracPart } = splitIntegerFraction(numeric, options?.locale);

  if (rawIntPart === '' && rawFracPart === '') {
    throw new AmountParseError(`cannot parse amount: ${JSON.stringify(raw)}`);
  }
  const intPart = rawIntPart === '' ? '0' : rawIntPart;

  if (!/^\d+$/.test(intPart) || (rawFracPart !== '' && !/^\d+$/.test(rawFracPart))) {
    throw new AmountParseError(`cannot parse amount: ${JSON.stringify(raw)}`);
  }

  const magnitude = Number(intPart) * 100 + fractionToCents(rawFracPart);
  const cents = negative ? -magnitude : magnitude;

  return {
    cents,
    currency,
    negative,
    formatted: formatCents(cents, negative),
  };
}

function extractSign(input: string): { negative: boolean; rest: string } {
  let s = input.trim();
  let negative = false;

  // Accounting notation: (500.00) means -500.00.
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Trailing minus shows up in ledger exports, e.g. "42.90-".
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1).trim();
  }

  return { negative, rest: s };
}

function extractCurrency(input: string): { currency: string | null; rest: string } {
  const trimmed = input.trim();

  const leadingCode = trimmed.match(/^([A-Za-z]{3})(?=\s|$)/);
  if (leadingCode && KNOWN_CODES.has(leadingCode[1].toUpperCase())) {
    return { currency: leadingCode[1].toUpperCase(), rest: trimmed.slice(leadingCode[0].length).trim() };
  }

  const trailingCode = trimmed.match(/(?:^|\s)([A-Za-z]{3})$/);
  if (trailingCode && KNOWN_CODES.has(trailingCode[1].toUpperCase())) {
    return { currency: trailingCode[1].toUpperCase(), rest: trimmed.slice(0, trimmed.length - trailingCode[0].length).trim() };
  }

  // Longest symbol first, so a multi-char symbol like "R$" is tried before
  // the bare "$" it contains -- otherwise "5R$" would match "$" alone and
  // leave a stray "R" behind.
  for (const symbol of Object.keys(SYMBOL_TO_CODE).sort((a, b) => b.length - a.length)) {
    if (trimmed.startsWith(symbol)) {
      return { currency: SYMBOL_TO_CODE[symbol], rest: trimmed.slice(symbol.length).trim() };
    }
    if (trimmed.endsWith(symbol)) {
      return { currency: SYMBOL_TO_CODE[symbol], rest: trimmed.slice(0, trimmed.length - symbol.length).trim() };
    }
  }

  return { currency: null, rest: trimmed };
}

// Splits a cleaned numeric string into integer and fraction digit strings.
// The hard part: "1,234" is 1234 in the US and 1.234 in much of Europe. If
// the caller passed a locale hint, the branch above resolves that exactly.
// Otherwise we're guessing from the string alone. When both separators are
// present the rightmost one wins as the decimal point (nobody writes
// "1.234,567.89"). When only one is present and it's followed by exactly
// three digits, we guess thousands grouping over decimal -- that matches
// plain whole-dollar amounts ("1,000") far more often than it misreads a
// genuine three-decimal amount, which is rare for currency.
function splitIntegerFraction(numStr: string, locale?: LocaleHint): { intPart: string; fracPart: string } {
  if (locale) {
    const decimalChar = locale === 'us' ? '.' : ',';
    const thousandsChar = locale === 'us' ? ',' : '.';
    const decimalIndex = numStr.lastIndexOf(decimalChar);
    if (decimalIndex === -1) {
      return { intPart: numStr.split(thousandsChar).join(''), fracPart: '' };
    }
    const intPart = numStr.slice(0, decimalIndex).split(thousandsChar).join('');
    const fracPart = numStr.slice(decimalIndex + 1);
    return { intPart, fracPart };
  }

  const hasComma = numStr.includes(',');
  const hasPeriod = numStr.includes('.');

  if (hasComma && hasPeriod) {
    const decimalIndex = Math.max(numStr.lastIndexOf(','), numStr.lastIndexOf('.'));
    const decimalChar = numStr[decimalIndex];
    const thousandsChar = decimalChar === ',' ? '.' : ',';
    const intPart = numStr.slice(0, decimalIndex).split(thousandsChar).join('');
    const fracPart = numStr.slice(decimalIndex + 1);
    return { intPart, fracPart };
  }

  const sep = hasComma ? ',' : hasPeriod ? '.' : null;
  if (sep === null) {
    return { intPart: numStr, fracPart: '' };
  }

  const parts = numStr.split(sep);
  if (parts.length > 2) {
    // Separator repeats, so it can only be thousands grouping: "1.234.567".
    return { intPart: parts.join(''), fracPart: '' };
  }

  const [left, right] = parts as [string, string];
  const looksLikeThousandsGroup = right.length === 3 && left.length > 0;
  if (looksLikeThousandsGroup) {
    return { intPart: left + right, fracPart: '' };
  }
  return { intPart: left, fracPart: right };
}

// Collapses a fraction digit string of any length down to a rounded cents
// value, so "9" -> 90 and "3456" -> 35 (rounding on the third digit).
function fractionToCents(frac: string): number {
  if (frac === '') return 0;
  if (frac.length === 1) return Number(frac) * 10;

  const cents = Number(frac.slice(0, 2));
  const rest = frac.slice(2);
  if (rest !== '' && Number(rest[0]) >= 5) {
    return cents + 1;
  }
  return cents;
}

// Takes the sign as a separate flag rather than reading it off `cents`
// because "-0.00" (e.g. from "(0.00)") normalizes to a cents value of -0,
// and -0 < 0 is false in JS -- deriving the sign from the number alone
// would silently drop it.
function formatCents(cents: number, negative: boolean): string {
  const sign = negative ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, '0')}`;
}

// One-way lookup for display: a currency that has an unambiguous symbol in
// SYMBOL_TO_CODE gets that symbol back; everything else falls back to its
// ISO code. "R$" comes from the same table, so BRL displays as "R$1.00"
// rather than "1.00 BRL".
const CODE_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_TO_CODE).map(([symbol, code]) => [code, symbol]),
);

// Always uses "," for thousands and "." for the decimal point, regardless of
// where the amount originally came from -- this is a display format for a
// canonical cents value, not a re-render of the input string, so there's no
// locale to preserve.
function groupThousands(digits: string): string {
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) {
      result += ',';
    }
    result += digits[i];
  }
  return result;
}

/**
 * Renders an integer cents value back into a human-facing display string,
 * e.g. formatCurrency(123456, 'USD') -> "$1,234.56".
 *
 * This is the inverse of normalizeAmount in spirit but not in exactness:
 * normalizeAmount accepts whatever separator convention the input used,
 * while formatCurrency always emits comma thousands / period decimal, since
 * the cents value itself carries no memory of where it came from.
 */
export function formatCurrency(cents: number, currency?: string | null): string {
  if (!Number.isInteger(cents)) {
    throw new AmountParseError(`cannot format amount: cents must be an integer, got ${cents}`);
  }

  // Object.is check catches -0, which "cents < 0" misses (-0 < 0 is false
  // in JS) but which a caller may pass deliberately to mean "negative, zero
  // amount" -- e.g. round-tripping a value produced by normalizeAmount.
  const sign = cents < 0 || Object.is(cents, -0) ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const amount = `${groupThousands(String(dollars))}.${String(remainder).padStart(2, '0')}`;

  if (!currency) {
    return `${sign}${amount}`;
  }

  const symbol = CODE_TO_SYMBOL[currency];
  if (symbol) {
    return `${sign}${symbol}${amount}`;
  }
  return `${sign}${amount} ${currency}`;
}
