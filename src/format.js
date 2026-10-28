import { useMemo } from 'react';

// Number, money, date and country formatting for the staff pages, in the site's language.
export function useFormatters(lang) {
  return useMemo(() => {
    const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
    const number = new Intl.NumberFormat(locale);
    const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const usdCompact = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
    // Dates from the server are UTC calendar days/months; format them in UTC so they never shift.
    const monthShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    const monthLong = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const dayLong = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const regions = new Intl.DisplayNames([lang], { type: 'region' });
    const toDate = (key) => new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`);
    return {
      number: (n) => number.format(n),
      usd: (n) => usd.format(n),
      usdCompact: (n) => usdCompact.format(n),
      compact: (n) => compact.format(n),
      percent: (n) => percent.format(n),
      monthShort: (key) => monthShort.format(toDate(key)),
      monthName: (m) => monthName.format(new Date(Date.UTC(2000, m - 1, 1))),
      monthLong: (key) => monthLong.format(toDate(key)),
      dayLong: (key) => dayLong.format(toDate(key)),
      dateTime: (iso) => dateTime.format(new Date(iso)),
      country: (iso) => {
        try {
          return regions.of(iso);
        } catch {
          return iso;
        }
      },
    };
  }, [lang]);
}
