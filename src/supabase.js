import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when the env vars are missing, so the site still renders and the login page can say so.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

// Countries offered in the phone field. `keepZero` marks numbering plans where a leading 0
// is part of the number (Congo-Brazzaville 06 877 7804 is +242 06 877 7804); elsewhere it is
// a trunk prefix only dialled at home and is dropped (Nigeria 0803… is +234 803…).
export const COUNTRIES = [
  { iso: 'US', dial: '1', flag: '🇺🇸' },
  { iso: 'CA', dial: '1', flag: '🇨🇦' },
  { iso: 'GB', dial: '44', flag: '🇬🇧' },
  { iso: 'FR', dial: '33', flag: '🇫🇷' },
  { iso: 'BE', dial: '32', flag: '🇧🇪' },
  { iso: 'CH', dial: '41', flag: '🇨🇭' },
  { iso: 'DE', dial: '49', flag: '🇩🇪' },
  { iso: 'BJ', dial: '229', flag: '🇧🇯' },
  { iso: 'BF', dial: '226', flag: '🇧🇫' },
  { iso: 'CM', dial: '237', flag: '🇨🇲' },
  { iso: 'CG', dial: '242', flag: '🇨🇬', keepZero: true },
  { iso: 'CI', dial: '225', flag: '🇨🇮', keepZero: true },
  { iso: 'CD', dial: '243', flag: '🇨🇩' },
  { iso: 'GA', dial: '241', flag: '🇬🇦', keepZero: true },
  { iso: 'GH', dial: '233', flag: '🇬🇭' },
  { iso: 'KE', dial: '254', flag: '🇰🇪' },
  { iso: 'MW', dial: '265', flag: '🇲🇼' },
  { iso: 'MZ', dial: '258', flag: '🇲🇿' },
  { iso: 'NG', dial: '234', flag: '🇳🇬' },
  { iso: 'RW', dial: '250', flag: '🇷🇼' },
  { iso: 'SN', dial: '221', flag: '🇸🇳' },
  { iso: 'TZ', dial: '255', flag: '🇹🇿' },
  { iso: 'UG', dial: '256', flag: '🇺🇬' },
  { iso: 'ZM', dial: '260', flag: '🇿🇲' },
];

export function toE164(country, localNumber) {
  let digits = localNumber.replace(/\D/g, '');
  if (!country.keepZero) digits = digits.replace(/^0+/, '');
  return `+${country.dial}${digits}`;
}

// Supabase answers a login for an unknown number (shouldCreateUser: false) with these.
export function isAccountNotFound(error) {
  const msg = (error?.message ?? '').toLowerCase();
  return msg.includes('signups not allowed') || error?.code === 'otp_disabled' || error?.code === 'user_not_found';
}
