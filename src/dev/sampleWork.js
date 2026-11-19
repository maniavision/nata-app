// Made-up support data for the dev-only /work/preview route; never shipped in a production build.
// Mirrors the shapes of the public.support_* RPCs, and the actions change this in-memory copy.

const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const IMG = '/images/nata-hero-handover.jpg';

let api = null;

export function sampleWorkApi() {
  if (api) return api;
  const state = {
    problems: [
      {
        dispute_id: 'p1',
        request_id: 'r1',
        reason: 'damaged',
        details: 'The box arrived crushed and one of the two jars of shea butter had leaked.',
        status: 'open',
        resolution: '',
        reported_by: 'sender',
        reporter_name: 'Adaeze Okafor',
        sender_name: 'Adaeze Okafor',
        sender_phone: '+234 803 000 0000',
        traveler_name: 'Kwame Mensah',
        traveler_phone: '+1 202 555 0143',
        route: 'Lagos → Houston',
        item_name: 'Shea butter (2 jars)',
        amount: 4200,
        currency: 'NGN',
        payment_status: 'held',
        payout_status: '',
        paid_at: ago(120),
        picked_up_at: ago(96),
        delivered_at: ago(20),
        created_at: ago(6),
        resolved_at: null,
      },
      {
        dispute_id: 'p2',
        request_id: 'r2',
        reason: 'not_received',
        details: '',
        status: 'under_review',
        resolution: 'Asked the traveler for the handover photo.',
        reported_by: 'sender',
        reporter_name: 'Marie Diallo',
        sender_name: 'Marie Diallo',
        sender_phone: '+221 77 000 00 00',
        traveler_name: 'Ibrahima Sow',
        traveler_phone: '+33 6 00 00 00 00',
        route: 'Dakar → Paris',
        item_name: 'Documents',
        amount: 3.39,
        currency: 'EUR',
        payment_status: 'released',
        payout_status: '',
        paid_at: ago(240),
        picked_up_at: ago(200),
        delivered_at: null,
        created_at: ago(30),
        resolved_at: null,
      },
    ],
    resolvedProblems: [
      {
        dispute_id: 'p0',
        request_id: 'r0',
        reason: 'wrong_item',
        details: 'Got someone else’s parcel.',
        status: 'resolved',
        resolution: 'Traveler swapped the parcels the next day.',
        reported_by: 'traveler',
        reporter_name: 'Kofi Boateng',
        sender_name: 'Ama Owusu',
        sender_phone: '',
        traveler_name: 'Kofi Boateng',
        traveler_phone: '',
        route: 'Accra → London',
        item_name: 'Kente cloth',
        amount: 3.39,
        currency: 'GBP',
        payment_status: 'released',
        payout_status: '',
        paid_at: ago(500),
        picked_up_at: ago(480),
        delivered_at: ago(400),
        created_at: ago(410),
        resolved_at: ago(380),
      },
    ],
    reports: [
      {
        id: 'c1',
        reason: 'scam',
        note: 'Asked me to pay outside the app before meeting.',
        message_body: 'Send the money to this number first, then I take the parcel.',
        status: 'open',
        review_note: '',
        created_at: ago(3),
        reviewed_at: null,
        conversation_id: 'conv1',
        request_id: 'r3',
        reporter_id: 'u1',
        reporter_name: 'Fatou Ndiaye',
        reported_id: 'u2',
        reported_name: 'John Doe',
        reported_count: 2,
        blocked: true,
      },
    ],
    reviewedReports: [],
    ids: [
      {
        user_id: 'u5',
        first_name: 'Chinedu',
        last_name: 'Eze',
        id_document_type: 'passport',
        id_document_path: 'u5/passport.jpg',
        review_reason: 'name_mismatch',
        failures: 3,
        submitted_at: ago(14),
        selfie_path: 'u5/selfie.jpg',
        face_match_attempts: 2,
      },
      {
        user_id: 'u6',
        first_name: 'Aïcha',
        last_name: 'Traoré',
        id_document_type: 'national_id',
        id_document_path: 'u6/id.jpg',
        review_reason: 'unreadable',
        failures: 5,
        submitted_at: ago(40),
        selfie_path: null,
        face_match_attempts: 0,
      },
    ],
    tickets: [
      {
        trip_id: 't1',
        traveler_id: 'u7',
        first_name: 'Yaw',
        last_name: 'Asante',
        departure_city: 'Accra',
        arrival_city: 'New York',
        departure_date: day(5),
        arrival_date: day(6),
        airline: 'Delta',
        booking_reference: 'K7XQ2P',
        ticket_receipt_path: 'u7/ticket.jpg',
        review_reason: 'date_mismatch',
        requested_at: ago(9),
      },
    ],
    failed: [
      {
        kind: 'refund',
        id: 'f1',
        request_id: 'r9',
        person_name: 'Grace Achieng',
        amount: 3.12,
        currency: 'USD',
        reason: 'card_declined',
        updated_at: ago(50),
      },
    ],
    locked: [],
    activity: [
      { action: 'id_verified', subject: 'Member verified · Esi Mensah', admin_name: 'Fortune N.', created_at: ago(26) },
      { action: 'resolved', subject: 'Problem resolved · Kente cloth', admin_name: 'Fortune N.', created_at: ago(380) },
    ],
  };

  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
  const log = (action, subject) =>
    state.activity.unshift({ action, subject: `x · ${subject}`, admin_name: 'You (preview)', created_at: new Date().toISOString() });
  const take = (list, pred) => {
    const i = state[list].findIndex(pred);
    return i < 0 ? null : state[list].splice(i, 1)[0];
  };

  api = {
    summary: () =>
      wait({
        open_problems: state.problems.length,
        open_reports: state.reports.length,
        id_reviews: state.ids.length,
        ticket_reviews: state.tickets.length,
        failed_payments: state.failed.length,
        locked_deliveries: state.locked.length,
      }),
    activity: () => wait([...state.activity]),
    problems: (open) => wait([...(open ? state.problems : state.resolvedProblems)]),
    photos: () =>
      wait([
        { kind: 'pickup', url: IMG },
        { kind: 'handover', url: IMG },
        { kind: 'sender', url: IMG },
      ]),
    resolve: (id, note) => {
      const p = take('problems', (x) => x.dispute_id === id);
      state.resolvedProblems.unshift({ ...p, status: 'resolved', resolution: note, resolved_at: new Date().toISOString() });
      log('resolved', p.item_name);
      return wait();
    },
    refund: (id, note) => {
      const p = take('problems', (x) => x.dispute_id === id);
      state.resolvedProblems.unshift({
        ...p,
        status: 'resolved',
        resolution: note,
        payment_status: 'refunded',
        resolved_at: new Date().toISOString(),
      });
      log('refunded', p.sender_name);
      return wait();
    },
    failed: () => wait([...state.failed]),
    retry: (kind, id) => {
      const f = take('failed', (x) => x.id === id);
      log(kind === 'refund' ? 'refund_retried' : 'payout_retried', f.person_name);
      return wait('pending');
    },
    locked: () => wait([...state.locked]),
    unlock: (requestId) => {
      take('locked', (x) => x.request_id === requestId);
      log('unlocked', requestId);
      return wait();
    },
    reports: (open) => wait([...(open ? state.reports : state.reviewedReports)]),
    reportMessages: () =>
      wait([
        { id: 'm1', author_id: 'u1', body: 'Hi! Can we meet at the airport on Friday?', has_photo: false, created_at: ago(5) },
        { id: 'm2', author_id: 'u2', body: 'Send the money to this number first, then I take the parcel.', has_photo: false, created_at: ago(4) },
        { id: 'm3', author_id: 'u1', body: '', has_photo: true, created_at: ago(3.5) },
      ]),
    reviewReport: (id, note) => {
      const r = take('reports', (x) => x.id === id);
      state.reviewedReports.unshift({ ...r, status: 'reviewed', review_note: note, reviewed_at: new Date().toISOString() });
      log('report_reviewed', r.reported_name);
      return wait();
    },
    idReviews: () => wait([...state.ids]),
    idUrl: () => wait(IMG),
    reviewId: (userId, approve) => {
      const r = take('ids', (x) => x.user_id === userId);
      log(approve ? (r.selfie_path ? 'id_verified' : 'id_approved') : 'id_rejected', `${r.first_name} ${r.last_name}`);
      return wait();
    },
    ticketReviews: () => wait([...state.tickets]),
    ticketUrl: () => wait(IMG),
    reviewTicket: (tripId, approve) => {
      const r = take('tickets', (x) => x.trip_id === tripId);
      log(approve ? 'ticket_approved' : 'ticket_rejected', `${r.first_name} ${r.last_name}`);
      return wait();
    },
  };
  return api;
}
