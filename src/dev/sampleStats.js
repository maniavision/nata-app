// Made-up figures for the dev-only /dashboard/preview route; never shipped in a production build.
// Mirrors the shape of public.dashboard_stats(p_year, p_month).

const pad = (n) => String(n).padStart(2, '0');

// Deterministic "transactions" per UTC day, growing from launch (14 months ago) to today.
function dailyCount(date, launch, now) {
  if (date < launch || date > now) return 0;
  const days = (date - launch) / 86400000;
  const seed = (date.getUTCDate() * 7 + date.getUTCMonth() * 3) % 5;
  return Math.max(0, Math.round(days / 90 + seed - 1));
}

export function sampleStats(year = null, month = null) {
  const now = new Date();
  const launch = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1));
  const days = [];
  for (let d = new Date(launch); d <= now; d = new Date(d.getTime() + 86400000)) {
    const count = dailyCount(d, launch, now);
    days.push({ date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, count, volume_usd: count * 46, revenue_usd: count * 4.6 });
  }
  const inPeriod = (key) => (!year || key.startsWith(String(year))) && (!month || key.slice(5, 7) === pad(month));
  const monthsOf = (list) => {
    const map = new Map();
    list.forEach((d) => {
      const k = d.date.slice(0, 7);
      const m = map.get(k) ?? { date: k, count: 0, volume_usd: 0, revenue_usd: 0 };
      m.count += d.count;
      m.volume_usd += d.volume_usd;
      m.revenue_usd += d.revenue_usd;
      map.set(k, m);
    });
    return map;
  };
  const allMonths = monthsOf(days);

  let unit = 'month';
  let points;
  if (month) {
    unit = 'day';
    const len = new Date(Date.UTC(year, month, 0)).getUTCDate();
    points = Array.from({ length: len }, (_, i) => {
      const key = `${year}-${pad(month)}-${pad(i + 1)}`;
      return days.find((d) => d.date === key) ?? { date: key, count: 0, volume_usd: 0, revenue_usd: 0 };
    });
  } else {
    const keys = year
      ? Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`)
      : Array.from({ length: 24 }, (_, i) => {
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23 + i, 1));
          return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
        });
    points = keys.map((k) => allMonths.get(k) ?? { date: k, count: 0, volume_usd: 0, revenue_usd: 0 });
  }

  const years = {};
  days.forEach((d) => {
    const y = Number(d.date.slice(0, 4));
    years[y] ??= { year: y, count: 0, volume_usd: 0, revenue_usd: 0 };
    years[y].count += d.count;
    years[y].volume_usd += d.volume_usd;
    years[y].revenue_usd += d.revenue_usd;
  });
  const periodTx = days.filter((d) => inPeriod(d.date));
  const txTotal = periodTx.reduce((s, d) => s + d.count, 0);

  // Users and trips scale with the share of all transactions that fall in the period.
  const share = !year ? 1 : txTotal / Math.max(1, days.reduce((s, d) => s + d.count, 0));
  const scale = (n) => Math.round(n * share);
  const countries = [
    ['NG', 312, 201], ['CG', 228, 140], ['US', 164, 97], ['CI', 121, 66], ['FR', 98, 61], ['CM', 74, 38],
    ['GH', 61, 35], ['GB', 55, 33], ['SN', 47, 21], ['CD', 39, 14], ['CA', 28, 17], ['KE', 21, 9],
    ['BE', 14, 6], ['RW', 9, 4], [null, 9, 0],
  ]
    .map(([country, t, v]) => ({ country: country ?? '??', total: scale(t), verified: scale(v) }))
    .filter((c) => c.total > 0);
  const usersTotal = countries.reduce((s, c) => s + c.total, 0);
  const verified = countries.reduce((s, c) => s + c.verified, 0);

  return {
    generated_at: now.toISOString(),
    period: { year, month },
    years_available: [...new Set([launch.getUTCFullYear(), now.getUTCFullYear()])].sort((a, b) => b - a),
    users_all_time: 1280,
    users: {
      total: usersTotal,
      verified,
      pending: scale(96),
      not_verified: usersTotal - verified - scale(96),
      new_this_month: 142,
    },
    users_by_country: countries,
    trips: { total: scale(418), live: scale(63), completed: scale(297), cancelled: scale(58) },
    transactions: { total: txTotal, volume_usd: txTotal * 46, revenue_usd: txTotal * 4.6 },
    revenue_by_country: [
      ['NG', 0.31], ['US', 0.22], ['FR', 0.14], ['CG', 0.11], ['GB', 0.08], ['CI', 0.06], ['CM', 0.05], [null, 0.03],
    ].map(([country, part]) => ({
      country: country ?? '??',
      count: Math.round(txTotal * part),
      revenue_usd: Math.round(txTotal * 4.6 * part * 100) / 100,
    })),
    transactions_by_year: Object.values(years),
    transactions_series: { unit, points },
  };
}

export function sampleFeedback() {
  const now = Date.now();
  const at = (h) => new Date(now - h * 3600000).toISOString();
  return [
    { id: '1', first_name: 'Amara', last_name: 'Diallo', source: 'review_traveler', message: 'It would help to see the traveler\'s arrival time, not only the date.', created_at: at(3) },
    { id: '2', first_name: 'Kwame', last_name: 'Mensah', source: 'review_sender', message: 'Let me message the sender before accepting, to ask about the box size.', created_at: at(20) },
    { id: '3', first_name: 'Chloé', last_name: 'Martin', source: 'review_traveler', message: 'Paiement par mobile money très rapide. Ajoutez Wave au Sénégal svp !', created_at: at(46) },
    { id: '4', first_name: 'David', last_name: 'Okafor', source: 'review_traveler', message: 'Great experience. A reminder the day before pickup would be nice.', created_at: at(80) },
    { id: '5', first_name: null, last_name: null, source: 'review_sender', message: 'The handover code screen could be bigger for older recipients.', created_at: at(150) },
  ];
}

export function sampleRoutes() {
  const at = (d) => new Date(Date.now() - d * 86400000).toISOString();
  return [
    ['Lagos', 'NG', 'London', 'GB', 41, 3, 60], ['Paris', 'FR', 'Brazzaville', 'CG', 33, 0, 52],
    ['Accra', 'GH', 'New York', 'US', 27, 2, 48], ['Abidjan', 'CI', 'Paris', 'FR', 22, 1, 45],
    ['Houston', 'US', 'Lagos', 'NG', 19, 0, 40], ['Douala', 'CM', 'Brussels', 'BE', 14, 1, 33],
    ['Dakar', 'SN', 'Paris', 'FR', 11, 0, 29], ['Kinshasa', 'CD', 'Brussels', 'BE', 9, 0, 20],
    ['Nairobi', 'KE', 'London', 'GB', 6, 1, 12], ['Toronto', 'CA', 'Accra', 'GH', 4, 0, 5],
  ].map(([fc, fco, tc, tco, members, live, days]) => ({
    from_city: fc, from_country: fco, to_city: tc, to_country: tco, members, live_trips: live, first_saved: at(days),
  }));
}

// Same shape as public.staff_metrics(p_year, p_month); figures are invented.
function sampleMetrics(year = null, month = null) {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(monday.getTime() - (11 - i) * 7 * 86400000));
  const iso = (d) => d.toISOString().slice(0, 10);
  const scale = year ? (month ? 0.12 : 0.85) : 1;
  const n = (v) => Math.round(v * scale);
  const route = (fc, fco, tc, tco, extra) => ({ from_city: fc, from_country: fco, to_city: tc, to_country: tco, ...extra });
  return {
    generated_at: now.toISOString(),
    period: { year, month },
    health: {
      deliveries_by_week: weeks.map((w, i) => ({ date: iso(w), count: Math.round(8 + i * 2.1 + ((i * 7) % 5)) })),
      escrow_usd: 2840,
      escrow_count: 37,
      owed_usd: 1912.5,
      owed_count: 24,
    },
    funnel: {
      requested: n(620), accepted: n(452), paid: n(371), picked_up: n(348), delivered: n(331),
      declined: n(41), expired_unanswered: n(96), expired_unpaid: n(52),
      cancelled_before_payment: n(31), cancelled_after_payment: n(12), open: n(44),
      median_hours: { to_accept: 6.4, to_pay: 2.1, to_pickup: 31, to_deliver: 52 },
    },
    routes: {
      by_requests: [
        route('Lagos', 'NG', 'London', 'GB', { requests: n(88), delivered: n(61), live_trips: 6 }),
        route('Paris', 'FR', 'Brazzaville', 'CG', { requests: n(64), delivered: n(40), live_trips: 0 }),
        route('Accra', 'GH', 'New York', 'US', { requests: n(51), delivered: n(37), live_trips: 3 }),
        route('Houston', 'US', 'Lagos', 'NG', { requests: n(44), delivered: n(18), live_trips: 0 }),
        route('Abidjan', 'CI', 'Paris', 'FR', { requests: n(39), delivered: n(30), live_trips: 2 }),
        route('Douala', 'CM', 'Brussels', 'BE', { requests: n(25), delivered: n(19), live_trips: 1 }),
      ],
      by_trips: [
        route('London', 'GB', 'Lagos', 'NG', { trips: n(54), requests: n(12) }),
        route('Lagos', 'NG', 'London', 'GB', { trips: n(41), requests: n(88) }),
        route('Paris', 'FR', 'Dakar', 'SN', { trips: n(33), requests: n(4) }),
        route('Accra', 'GH', 'New York', 'US', { trips: n(28), requests: n(51) }),
        route('Brussels', 'BE', 'Kinshasa', 'CD', { trips: n(21), requests: n(9) }),
      ],
      alerts_total: 312,
      alerts_unmatched: 118,
      active_travelers_30d: 146,
      active_senders_30d: 289,
    },
    payments: {
      by_method: [
        { method: 'card', provider: 'stripe', attempts: n(240), succeeded: n(226), failed: n(10), pending: n(4) },
        { method: 'mobile_money', provider: 'pawapay', attempts: n(198), succeeded: n(171), failed: n(21), pending: n(6) },
        { method: 'apple_pay', provider: 'stripe', attempts: n(61), succeeded: n(60), failed: n(1), pending: 0 },
      ],
      mobile_money: [
        { country: 'NG', network: 'MTN_MOMO_NGA', provider: 'pawapay', attempts: n(72), succeeded: n(66), failed: n(6) },
        { country: 'CG', network: 'MTN_MOMO_COG', provider: 'pawapay', attempts: n(54), succeeded: n(43), failed: n(10) },
        { country: 'GH', network: 'MTN_MOMO_GHA', provider: 'pawapay', attempts: n(41), succeeded: n(38), failed: n(3) },
        { country: 'KE', network: 'MPESA_KEN', provider: 'pawapay', attempts: n(31), succeeded: n(24), failed: n(2) },
      ],
      payouts_open: [
        { status: 'pending', count: 17, amount_usd: 1244, oldest_hours: 30, older_than_day: 4 },
        { status: 'sending', count: 4, amount_usd: 300.5, oldest_hours: 3, older_than_day: 0 },
        { status: 'failed', count: 3, amount_usd: 368, oldest_hours: 140, older_than_day: 3 },
      ],
      payout_failures: [
        { reason: 'PAWAPAY_WALLET_OUT_OF_FUNDS', count: 2 },
        { reason: 'RECIPIENT_NOT_FOUND', count: 1 },
      ],
      refunds: { count: n(23), amount_usd: n(1460), failed: 1, waiting: 2 },
      owed_by_currency: [
        { currency: 'USD', payouts_owed: 1120, payouts: 11 },
        { currency: 'NGN', payouts_owed: 690000, payouts: 7 },
        { currency: 'XAF', payouts_owed: 182000, payouts: 6 },
      ],
      escrow_by_currency: [
        { currency: 'USD', held: 1650, payments: 19 },
        { currency: 'NGN', held: 1100000, payments: 11 },
        { currency: 'XAF', held: 210000, payments: 7 },
      ],
    },
    trust: {
      deliveries: n(331), reports: n(9), reports_open: 3, reports_oldest_open_hours: 62,
      traveler_rating: 4.82, traveler_reviews: n(244), delivered_reviewed: n(244),
      identity: { passed: 412, rejected: 38, waiting: 17, oldest_waiting_hours: 41, median_hours_to_decide: 0.2 },
      locked_deliveries: 1,
    },
    growth: {
      signups_by_week: weeks.map((w, i) => {
        const c = 40 + i * 6 + ((i * 11) % 9);
        return { date: iso(w), count: c, verified: Math.round(c * 0.58), posted_trip: Math.round(c * 0.21), sent_request: Math.round(c * 0.34) };
      }),
      signups: n(1280), signups_verified: n(742), signups_posted_trip: n(270), signups_sent_request: n(431),
      repeat_senders: { with_delivery: 214, repeat_60d: 71, eligible: 150 },
      repeat_travelers: { with_delivery: 133, repeat_60d: 58, eligible: 96 },
    },
  };
}

function sampleFloat() {
  return {
    checked_at: new Date().toISOString(),
    stripe: { mode: 'test', available: [{ currency: 'USD', amount: 2310.4 }], pending: [{ currency: 'USD', amount: 410 }] },
    pawapay: {
      mode: 'sandbox',
      balances: [
        { country: 'NGA', currency: 'NGN', provider: null, amount: 520000 },
        { country: 'COG', currency: 'XAF', provider: null, amount: 260000 },
      ],
    },
  };
}

// Same shape as public.staff_kpis(p_year, p_month); figures are invented.
function sampleKpis() {
  const now = new Date();
  const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const weekly = [3, 5, 4, 8, 7, 11, 9, 14, 13, 18, 21, 16];
  const monthly = [0, 0, 0, 0, 0, 2, 9, 18, 26, 41, 63, 38];
  const route = (from_city, from_country, to_city, to_country) => ({ from_city, from_country, to_city, to_country });
  return {
    generated_at: now.toISOString(),
    period: { year: null, month: null },
    management: {
      revenue_usd: 612.4,
      connections: 197,
      list_usd: 611.9,
      paid_requests: 197,
      refunded_connections: 6,
      revenue_by_week: weekly.map((n, i) => ({
        date: new Date(week.getTime() - (11 - i) * 7 * 864e5).toISOString().slice(0, 10),
        count: n,
        revenue_usd: Math.round(n * 3.1 * 100) / 100,
      })),
      revenue_by_month: monthly.map((n, i) => ({
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)).toISOString().slice(0, 7),
        count: n,
        revenue_usd: Math.round(n * 3.1 * 100) / 100,
      })),
      revenue_by_currency: [
        { currency: 'EUR', count: 88, amount: 268.4, usd: 289.1 },
        { currency: 'XOF', count: 51, amount: 211600, usd: 351.3 },
        { currency: 'USD', count: 34, amount: 104.2, usd: 104.2 },
        { currency: 'GBP', count: 24, amount: 74.6, usd: 94.5 },
      ],
      revenue_by_corridor: [
        { ...route('Paris', 'FR', 'Abidjan', 'CI'), count: 41, usd: 149.2 },
        { ...route('Paris', 'FR', 'Dakar', 'SN'), count: 33, usd: 120.1 },
        { ...route('London', 'GB', 'Lagos', 'NG'), count: 19, usd: 81.5 },
        { ...route('Abidjan', 'CI', 'Dakar', 'SN'), count: 22, usd: 76.9 },
        { ...route('Brussels', 'BE', 'Kinshasa', 'CD'), count: 12, usd: 44.3 },
      ],
      match: { groups: 412, matched: 268, waiting: 31, requests: 1060, requests_accepted: 402 },
      corridors: [
        { ...route('Paris', 'FR', 'Abidjan', 'CI'), live_trips: 14, open_requests: 22, alerts: 31, demand: 53 },
        { ...route('Paris', 'FR', 'Dakar', 'SN'), live_trips: 11, open_requests: 9, alerts: 12, demand: 21 },
        { ...route('Washington, D.C.', 'US', 'Accra', 'GH'), live_trips: 0, open_requests: 4, alerts: 9, demand: 13 },
        { ...route('London', 'GB', 'Lagos', 'NG'), live_trips: 6, open_requests: 5, alerts: 4, demand: 9 },
        { ...route('Lyon', 'FR', 'Douala', 'CM'), live_trips: 3, open_requests: 0, alerts: 0, demand: 0 },
      ],
      repeat_senders: { people: 230, repeat: 61, eligible: 74, eligible_repeat: 23 },
      repeat_travelers: { people: 118, repeat: 40, eligible: 39, eligible_repeat: 15 },
      safety: { deliveries: 171, problems: 4, problems_resolved: 3, chat_reports: 7, chat_reports_reviewed: 6 },
    },
    growth: {
      signups: 1240,
      verified: 702,
      posted_trip: 164,
      sent_request: 311,
      active: 431,
      funnel: { requested: 1060, accepted: 402, paid: 197, picked_up: 180, delivered: 171, reviewed: 96 },
      alerts: { saved: 210, active: 188, sent: 642, led_to_request: 77 },
      by_country: [
        { country: 'FR', signups: 412, verified: 260, active: 170, paying: 81, connections: 96, revenue_usd: 315.2 },
        { country: 'CI', signups: 233, verified: 120, active: 70, paying: 30, connections: 38, revenue_usd: 120.4 },
        { country: 'SN', signups: 188, verified: 101, active: 52, paying: 18, connections: 24, revenue_usd: 71.9 },
        { country: 'GB', signups: 104, verified: 66, active: 39, paying: 17, connections: 24, revenue_usd: 94.5 },
        { country: '??', signups: 52, verified: 3, active: 2, paying: 0, connections: 0, revenue_usd: 0 },
      ],
    },
    operations: {
      identity: {
        median_hours_to_verified: 0.4,
        verified: 702,
        face_checked: 760,
        face_passed: 541,
        face_no_score: 96,
        face_attempts: 1302,
        approved_by_team: 161,
        waiting: 12,
        oldest_waiting_hours: 52,
      },
      support: {
        problems_open: 1,
        problems_oldest_hours: 30,
        problems_first_action_hours: 3.5,
        problems_resolution_hours: 26,
        reports_open: 1,
        reports_oldest_hours: 6,
        reports_review_hours: 4.2,
        id_reviews_open: 12,
        id_reviews_oldest_hours: 52,
        id_reviews_decision_hours: 18,
      },
      payments_by_provider: [
        { provider: 'stripe', attempts: 140, failed: 9, stuck: 0, refunds: 4, refunds_failed: 0, refunds_waiting: 0 },
        { provider: 'pawapay', attempts: 96, failed: 21, stuck: 2, refunds: 2, refunds_failed: 1, refunds_waiting: 1 },
        { provider: 'flutterwave', attempts: 18, failed: 3, stuck: 0, refunds: 0, refunds_failed: 0, refunds_waiting: 0 },
      ],
      handover: { deliveries: 171, with_pickup_photo: 158, with_sender_photo: 22, picked_up: 180, picked_up_with_sender_photo: 41 },
    },
    product: {
      times: { accept_median: 5.2, accept_p90: 31, deliver_median: 20, deliver_p90: 70, end_to_end_median: 140, accepted: 402, delivered: 171 },
      cancellations: {
        total: 58,
        by_stage: [
          { stage: 'pending', sender: 29, traveler: 0, nata: 0, total: 29 },
          { stage: 'accepted', sender: 11, traveler: 6, nata: 0, total: 17 },
          { stage: 'paid', sender: 3, traveler: 7, nata: 0, total: 10 },
          { stage: 'picked_up', sender: 0, traveler: 1, nata: 1, total: 2 },
        ],
      },
      ratings: { count: 182, average: 4.62, under_4: 14, traveler_average: 4.68, traveler_count: 101, sender_average: 4.55, sender_count: 81 },
    },
  };
}

export const sampleMetricsDemo = {
  metrics: sampleMetrics,
  kpis: sampleKpis,
  years: () => {
    const y = new Date().getUTCFullYear();
    return [y, y - 1];
  },
  float: sampleFloat,
};
