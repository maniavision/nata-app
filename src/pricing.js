// The delivery price, in US dollars: the same formula as the app
// (carrywise_app lib/services/delivery_pricing.dart) and the database
// (nata.delivery_cost_usd), so the estimate matches what a sender is shown.
//
// cost = 5.00 + distanceKm × 0.0123456789 + weightKg × 3.00 + 750 ÷ hours
// The cost is rounded up to whole dollars; the fee is 10% of that, rounded up.

export const BASE_COST = 5;
export const COST_PER_KM = 0.0123456789;
export const COST_PER_KG = 3;
export const URGENCY_FACTOR = 750;
export const MINIMUM_HOURS = 24;
export const FEE_RATE = 0.1;

const EARTH_RADIUS_KM = 6371;

// Distance in kilometres between two latitude / longitude points (Haversine).
export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2) - rad(lat1);
  const dLon = rad(lon2) - rad(lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

// Rounds half up; the nudge keeps 27.485 (stored as 27.48499…) from rounding down.
function roundHalfUp(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f + 1e-9) / f;
}

// Rounds up to a whole amount; the allowance keeps 3.0000000000000004 at 3.
export const ceilWhole = (value) => Math.ceil(value - 1e-9);

// Hours from today to the departure day, counted in whole UTC days like the app.
// A flight today is priced as 24 hours.
export function hoursUntilDeparture(departureDate, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = departureDate.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
  return Math.max(days * 24, MINIMUM_HOURS);
}

// Every part of the price, for showing the breakdown.
export function quote({ distanceKm, weightKg, hours }) {
  const distanceCost = distanceKm * COST_PER_KM;
  const weightCost = weightKg * COST_PER_KG;
  const urgencyCost = roundHalfUp(URGENCY_FACTOR / hours, 4);
  const exactCost = roundHalfUp(BASE_COST + distanceCost + weightCost + urgencyCost, 2);
  const costUsd = ceilWhole(exactCost);
  const feeUsd = ceilWhole(costUsd * FEE_RATE);
  return { distanceKm, weightKg, hours, distanceCost, weightCost, urgencyCost, exactCost, costUsd, feeUsd, totalUsd: costUsd + feeUsd };
}

// The currencies a member can pick in the app (PreferencesService), with the app's
// rates provider. Converted amounts are rounded up to whole units, the cost and the
// fee each on their own, like RequestPricing in the app.
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'XOF'];
export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

// XOF and XAF are the same money (both pegged to the euro at one rate).
const SAME_VALUE = { XOF: 'XAF', XAF: 'XOF' };

// Units of `currency` per US dollar from the provider's `rates`, or null if unknown.
export function rateFor(rates, currency) {
  if (currency === 'USD') return 1;
  const direct = rates?.[currency];
  if (direct > 0) return direct;
  const alt = rates?.[SAME_VALUE[currency]];
  return alt > 0 ? alt : null;
}

// The quote's cost, fee and total in a currency at `rate`.
export function convertQuote(q, rate) {
  const cost = ceilWhole(q.costUsd * rate);
  const fee = ceilWhole(q.feeUsd * rate);
  return { cost, fee, total: cost + fee };
}

// A whole amount written as the app writes it: "$95", "€88", "XOF 57,300".
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£' };
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function writePrice(amount, currency) {
  const text = WHOLE.format(amount);
  return SYMBOLS[currency] ? `${SYMBOLS[currency]}${text}` : `${currency} ${text}`;
}
