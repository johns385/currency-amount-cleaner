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

const SYMBOL_TO_CODE: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
};

// Deliberately small. Extending this is cheap and low-risk; get it wrong and
// we'd silently mislabel currencies, which is worse than leaving them null.
const KNOWN_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR']);

const NBSP = String.fromCharCode(160);

export function normalizeAmount(raw: string): NormalizedAmount {
  const cleaned = raw.split(NBSP).join(' ').trim();
  if (cleaned === '') {
    throw new AmountParseError('cannot parse amount: input is empty');
  }

  const { negative, rest: afterSign } = extractSign(cleaned);
  const { currency, rest: afterCurrency } = extractCurrency(afterSign);
  const numeric = afterCurrency.replace(/[\s_]/g, '');

  const { intPart: rawIntPart, fracPart: rawFracPart } = splitIntegerFraction(numeric);

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
    formatted: formatCents(cents),
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

  for (const symbol of Object.keys(SYMBOL_TO_CODE)) {
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
// The hard part: "1,234" is 1234 in the US and 1.234 in much of Europe, and
// we get no locale hint from the string itself. When both separators are
// present the rightmost one wins as the decimal point (nobody writes
// "1.234,567.89"). When only one is present and it's followed by exactly
// three digits, we guess thousands grouping over decimal -- that matches
// plain whole-dollar amounts ("1,000") far more often than it misreads a
// genuine three-decimal amount, which is rare for currency.
function splitIntegerFraction(numStr: string): { intPart: string; fracPart: string } {
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

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, '0')}`;
}
