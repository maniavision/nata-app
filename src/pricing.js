// The suggested delivery price, in US dollars: the same formula as the app's
// "Estimate a delivery" page (carrywise_app lib/screens/cost_estimate_screen.dart).
// It is only a guide: sender and traveler agree on the price in the chat, and
// Nata's flat fee is separate.
//
// cost = 5.00 + distanceKm × 0.0123456789 + weightKg × 3.00 + 750 ÷ hours
// A trip is taken to be a week away. Within one country the cost is 65% less in
// Africa and 45% less anywhere else. The result is rounded up to whole dollars.

export const BASE_COST = 5;
export const COST_PER_KM = 0.0123456789;
export const COST_PER_KG = 3;
export const URGENCY_FACTOR = 750;
export const ASSUMED_HOURS = 7 * 24;
export const KG_PER_LB = 0.45359237;
export const MAX_WEIGHT_KG = 999;

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

// How much less a trip within one country costs, in percent.
export const localDiscountPercent = (continent) => (continent === 'AF' ? 65 : 45);

// Every part of the suggested price, for showing the breakdown.
export function suggestPrice({ distanceKm, weightKg, discountPercent = 0 }) {
  const distanceCost = distanceKm * COST_PER_KM;
  const weightCost = weightKg * COST_PER_KG;
  const urgencyCost = roundHalfUp(URGENCY_FACTOR / ASSUMED_HOURS, 4);
  const exactCost = roundHalfUp(BASE_COST + distanceCost + weightCost + urgencyCost, 2);
  const priceUsd = ceilWhole((exactCost * (100 - discountPercent)) / 100);
  return { distanceKm, distanceCost, weightCost, urgencyCost, exactCost, discountPercent, priceUsd };
}

// The currencies a member can pick in the app (PreferencesService), with the app's
// rates provider. Converted amounts are rounded up to whole units, as in the app.
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

// A whole amount written as the app writes it: "$95", "€88", "XOF 57,300".
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£' };
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function writePrice(amount, currency) {
  const text = WHOLE.format(amount);
  return SYMBOLS[currency] ? `${SYMBOLS[currency]}${text}` : `${currency} ${text}`;
}
