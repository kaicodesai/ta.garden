// RESEND_API_KEY must be set as a secret in Cloudflare Workers dashboard
// (Settings → Variables & Secrets → Add Secret → RESEND_API_KEY)
const TO_EMAILS = ['ashleyedwards305@gmail.com', 'hi@soulandlunawellness.com'];
const FROM = 'Ta.Garden <hello@soulandlunawellness.com>';
const STRIPE_USD = 'https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02';
const STRIPE_VND = 'https://buy.stripe.com/28E6oHeeA3CJ9spehC53O03';

const ROOM_RATES = {
  'The River Room':   { monthly: 340, nightly: 25 },
  'The Balcony Room': { monthly: 400, nightly: 30 },
  'The Sky Suite':    { monthly: 680, nightly: 50 },
  'First Floor Room': { monthly: 200, nightly: 0, vndOnly: true, internal: true },
};

const DEFAULT_PROPERTIES = [
  {
    id: 'ta-garden',
    name: 'Ta.Garden',
    location: 'Cam Nam Island, Hội An, Vietnam',
    type: 'coliving',
    color: '#86a2a6',
    rooms: ['The River Room', 'The Balcony Room', 'The Sky Suite', 'First Floor Room'],
    icalUrl: null,
    active: true,
  },
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runEmailAutomation(env));
  },

  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (err) {
      console.error('Worker unhandled exception:', err);
      return Response.json({ error: err.message, stack: err.stack, url: request.url }, { status: 500 });
    }
  },
};

async function handleFetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, PATCH, PUT',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const p = url.pathname;
    const m = request.method;

    if (p === '/api/enquire'               && m === 'POST')  return handleEnquiry(request, env, cors, ctx);
    if (p === '/api/availability'           && m === 'GET')   return handleAvailability(request, env, cors);

    // Admin routes
    if (p === '/api/admin/debug'            && m === 'GET')   return adminDebug(request, env, cors);
    if (p === '/api/admin/enquiries'        && m === 'GET')   return safeCall(() => adminListEnquiries(request, env, cors), cors);
    if (p === '/api/admin/enquiry'          && m === 'PATCH')  return safeCall(() => adminUpdateEnquiry(request, env, cors), cors);
    if (p === '/api/admin/enquiry'          && m === 'DELETE') return safeCall(() => adminDeleteEnquiry(request, env, cors), cors);
    if (p === '/api/admin/properties'       && m === 'GET')   return adminListProperties(request, env, cors);
    if (p === '/api/admin/property'         && m === 'POST')  return safeCall(() => adminSaveProperty(request, env, cors), cors);
    if (p === '/api/admin/property'         && m === 'DELETE')return safeCall(() => adminDeleteProperty(request, env, cors), cors);
    if (p === '/api/admin/notify'           && m === 'POST')  return safeCall(() => adminNotify(request, env, cors), cors);
    if (p === '/api/admin/note'             && m === 'POST')  return safeCall(() => adminSaveNote(request, env, cors), cors);
    if (p === '/api/admin/block'            && m === 'POST')  return safeCall(() => adminBlock(request, env, cors), cors);
    if (p === '/api/admin/unblock'          && m === 'POST')  return safeCall(() => adminUnblock(request, env, cors), cors);
    if (p === '/api/admin/ical-sync'        && m === 'POST')  return safeCall(() => adminIcalSync(request, env, cors), cors);
    if (p === '/api/admin/onboarding'       && m === 'PATCH') return safeCall(() => adminUpdateOnboarding(request, env, cors), cors);
    if (p === '/api/admin/guest-profile'    && m === 'GET')   return safeCall(() => adminGetGuestProfile(request, env, cors), cors);

    // Gallery (public read, admin write)
    if (p === '/api/gallery'               && m === 'GET')    return handleGalleryGet(request, env, cors);
    if (p === '/api/admin/gallery'         && m === 'POST')   return safeCall(() => adminGalleryAdd(request, env, cors), cors);
    if (p === '/api/admin/gallery'         && m === 'DELETE') return safeCall(() => adminGalleryDelete(request, env, cors), cors);

    // Guest portal (public — ID is the auth token)
    if (p === '/api/guest'                  && m === 'GET')   return handleGuestGet(request, env, cors);
    if (p === '/api/guest/submit'           && m === 'POST')  return handleGuestSubmit(request, env, cors, ctx);
    if (p === '/api/guest/sign-contract'   && m === 'POST')  return safeCall(() => handleGuestSignContract(request, env, cors), cors);
    if (p === '/api/guest/request-login'    && m === 'POST')  return safeCall(() => handleGuestRequestLogin(request, env, cors, ctx), cors);
    if (p === '/api/guest/verify-token'     && m === 'GET')   return handleGuestVerifyToken(request, env, cors);

    // Payments
    if (p === '/api/admin/record-payment'   && m === 'POST')  return safeCall(() => adminRecordPayment(request, env, cors), cors);
    if (p === '/api/admin/record-payment'   && m === 'DELETE') return safeCall(() => adminDeletePayment(request, env, cors), cors);
    if (p === '/api/admin/payments'         && m === 'GET')   return safeCall(() => adminGetPayments(request, env, cors), cors);

    // Electricity billing
    if (p === '/api/admin/electricity'      && m === 'POST')  return safeCall(() => adminPostElectricity(request, env, cors), cors);
    if (p === '/api/admin/electricity'      && m === 'GET')   return safeCall(() => adminGetElectricity(request, env, cors), cors);
    if (p === '/api/admin/electricity'      && m === 'DELETE') return safeCall(() => adminDeleteElectricity(request, env, cors), cors);
    if (p === '/api/admin/electricity'      && m === 'PATCH') return safeCall(() => adminMarkElectricityPaid(request, env, cors), cors);
    if (p === '/api/guest/electricity'      && m === 'GET')   return safeCall(() => guestGetElectricity(request, env, cors), cors);

    // Email automation
    if (p === '/api/admin/send-emails'     && m === 'POST')   return safeCall(() => adminRunEmails(request, env, cors), cors);

    // Room listings (public read, admin write)
    if (p === '/api/rooms'                 && m === 'GET')    return handleRoomsGet(request, env, cors);
    if (p === '/api/admin/rooms'           && m === 'GET')    return safeCall(() => adminGetRooms(request, env, cors), cors);
    if (p === '/api/admin/room'            && m === 'POST')   return safeCall(() => adminSaveRoom(request, env, cors), cors);

    // Test inquiry (admin only)
    if (p === '/api/admin/test-inquiry'    && m === 'POST')   return safeCall(() => adminCreateTestInquiry(request, env, cors, ctx), cors);
    if (p === '/api/admin/reset-test'      && m === 'POST')   return safeCall(() => adminResetTest(request, env, cors), cors);
    if (p === '/api/admin/setup-colt'      && m === 'POST')   return safeCall(() => adminSetupColt(request, env, cors), cors);
    if (p === '/api/admin/kv-inspect'      && m === 'GET')    return safeCall(() => adminKvInspect(request, env, cors), cors);
    if (p === '/api/admin/kv-repair'       && m === 'POST')   return safeCall(() => adminKvRepair(request, env, cors), cors);
    if (p === '/api/admin/export'          && m === 'GET')    return safeCall(() => adminExportData(request, env, cors), cors);
    if (p === '/api/admin/test-email'      && m === 'POST')   return safeCall(() => adminTestEmail(request, env, cors), cors);

    // Direct booking links
    if (p === '/api/admin/booking-link'    && m === 'POST')   return safeCall(() => adminCreateBookingLink(request, env, cors), cors);
    if (p === '/api/admin/booking-links'   && m === 'GET')    return safeCall(() => adminListBookingLinks(request, env, cors), cors);
    if (p === '/api/admin/direct-booking'  && m === 'POST')   return safeCall(() => adminDirectBooking(request, env, cors, ctx), cors);
    if (p === '/api/admin/activity-log'    && m === 'GET')    return safeCall(() => adminGetActivityLog(request, env, cors), cors);
    if (p === '/api/admin/contract'        && m === 'GET')    return safeCall(() => adminGetContract(request, env, cors), cors);
    if (p === '/api/admin/send-contract'   && m === 'POST')   return safeCall(() => adminSendContract(request, env, cors), cors);
    if (p.startsWith('/api/booking-link/') && p.endsWith('/confirm') && m === 'POST') return safeCall(() => handleBookingLinkConfirm(request, env, cors, ctx), cors);
    if (p.startsWith('/api/booking-link/') && m === 'GET')    return handleBookingLinkGet(request, env, cors);

    // Redirect /guest → /guest.html (keeps query string intact)
    if (p === '/guest') return Response.redirect(`${url.origin}/guest.html${url.search}`, 301);

    // Static files are served automatically by Cloudflare before the worker runs.
    // This fallback only triggers for unmatched paths with no static file.
    return new Response('Not found', { status: 404 });
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkAuth(request, env) {
  const h = request.headers.get('x-admin-secret');
  if (!h) return false;
  // Check Cloudflare env secret first (set in Workers dashboard → Settings → Variables & Secrets)
  if (env.ADMIN_SECRET) return h.trim() === env.ADMIN_SECRET.trim();
  // Fallback: KV-stored password (for backwards compatibility)
  if (!env.BOOKINGS) return false;
  const stored = await env.BOOKINGS.get('admin_password');
  return !!stored && h.trim() === stored.trim();
}

async function adminDebug(request, env, cors) {
  const kvPassword = env.BOOKINGS ? await env.BOOKINGS.get('admin_password') : null;
  const enqRaw   = env.BOOKINGS ? await env.BOOKINGS.get('enquiries') : null;
  const propsRaw = env.BOOKINGS ? await env.BOOKINGS.get('properties') : null;
  const enquiries = enqRaw  ? JSON.parse(enqRaw)  : [];
  const props     = propsRaw ? JSON.parse(propsRaw) : null;
  return Response.json({
    kvSet:              !!env.BOOKINGS,
    adminSecretEnvSet:  !!env.ADMIN_SECRET,
    resendKeyEnvSet:    !!env.RESEND_API_KEY,
    passwordInKV:       !!kvPassword,
    authMethod:         env.ADMIN_SECRET ? 'env.ADMIN_SECRET' : (kvPassword ? 'KV admin_password' : 'NONE — set ADMIN_SECRET in Cloudflare'),
    enquiryCount:       enquiries.length,
    latestEnquiry:      enquiries[0] ? { id: enquiries[0].id, name: enquiries[0].name, createdAt: enquiries[0].createdAt, status: enquiries[0].status } : null,
    propertiesInKV:     !!propsRaw,
    firstPropertyId:    props ? props[0]?.id : 'using default (ta-garden)',
  }, { headers: cors });
}

function unauthorized(cors) {
  return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
}

async function safeCall(fn, cors) {
  try {
    return await fn();
  } catch (err) {
    console.error('Admin route error:', err);
    return Response.json({ error: String(err), stack: err?.stack }, { status: 500, headers: cors });
  }
}

// ── Safe JSON parse ───────────────────────────────────────────────────────────

function safeJsonParse(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('safeJsonParse failed:', e.message, '| raw preview:', String(raw).slice(0, 200));
    return fallback;
  }
}

// ── KV key helpers ────────────────────────────────────────────────────────────

function enquiriesKey(propId) {
  return propId === 'ta-garden' ? 'enquiries' : `enquiries__${propId}`;
}

function blockedKey(propId) {
  return propId === 'ta-garden' ? 'blocked_ranges' : `blocked__${propId}`;
}

function icalKey(propId) {
  return `ical__${propId}`;
}

// ── Activity log helpers ──────────────────────────────────────────────────────

async function appendLog(env, enqId, entry) {
  if (!env?.BOOKINGS || !enqId) return;
  try {
    const raw = await env.BOOKINGS.get(`log_${enqId}`);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift({ ...entry, at: new Date().toISOString() });
    await env.BOOKINGS.put(`log_${enqId}`, JSON.stringify(log.slice(0, 200)));
  } catch (e) {
    console.error('appendLog error:', e.message);
  }
}

async function sendAndLog(env, enqId, type, to, subject, html, replyTo) {
  const res = await resend(FROM, to, subject, html, replyTo || null, env);
  const status = res?.ok ? 'sent' : 'failed';
  await appendLog(env, enqId, { type, to, subject, emailStatus: status });
  return res;
}

// ── Public: enquiry submission ────────────────────────────────────────────────

async function handleEnquiry(request, env, cors, ctx) {
  try {
    const { name, email, phone, room, stayType, checkIn, checkOut, message, propertyId = 'ta-garden' } = await request.json();
    if (!name || !email || !room) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
    }

    const price    = calcPrice(room, stayType, checkIn, checkOut);
    const dateInfo = checkIn
      ? (stayType === 'monthly'
          ? `Move-in: ${fmt(checkIn)}  →  Move-out: ${fmt(checkOut) || 'TBD'}`
          : `Check-in: ${fmt(checkIn)}  →  Check-out: ${fmt(checkOut) || 'TBD'}`)
      : 'Dates: flexible / TBD';
    const stayLabel = stayType === 'monthly' ? 'Monthly Stay' : 'Short Stay';

    if (env.BOOKINGS) {
      const key = enquiriesKey(propertyId);
      const existing = await env.BOOKINGS.get(key);
      const enquiries = existing ? JSON.parse(existing) : [];
      const enqId = `enq_${Date.now()}`;
      enquiries.unshift({
        id: enqId,
        propertyId, name, email, phone: phone || '', room,
        stayType, checkIn, checkOut: checkOut || null,
        message: message || '', price: price ? price.total : null,
        status: 'pending', createdAt: new Date().toISOString(),
        onboarding: { paymentReceived: false, contractSigned: false, passportUploaded: false, visaUploaded: false },
      });
      await env.BOOKINGS.put(key, JSON.stringify(enquiries.slice(0, 200)));
      // Store property index so guest portal can look up by ID alone
      await env.BOOKINGS.put(`enq_idx_${enqId}`, propertyId);
    }

    // Send emails in background — never block or fail the submission response
    const adminHtml = buildAdminEmail({ name, email, phone, room, stayType, stayLabel, dateInfo, checkIn, checkOut, message, price });
    const guestHtml = buildGuestEmail({ name, room, stayLabel, dateInfo, message });
    const emailWork = Promise.all([
      ...TO_EMAILS.map(to => resend(FROM, to, `New Enquiry — ${room} (${name})`, adminHtml, email, env)),
      resend(FROM, email, 'We received your enquiry — Ta.Garden', guestHtml, null, env),
    ]).catch(err => console.error('Email send error:', err));
    if (ctx?.waitUntil) ctx.waitUntil(emailWork);

    return Response.json({ success: true }, { headers: cors });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to save enquiry' }, { status: 500, headers: cors });
  }
}

// ── Public: availability ──────────────────────────────────────────────────────

async function handleAvailability(request, env, cors) {
  try {
    const propId = new URL(request.url).searchParams.get('property') || 'ta-garden';
    if (!env.BOOKINGS) return Response.json({ blocked: [] }, { headers: cors });

    const [bVal, eVal, iVal] = await Promise.all([
      env.BOOKINGS.get(blockedKey(propId)),
      env.BOOKINGS.get(enquiriesKey(propId)),
      env.BOOKINGS.get(icalKey(propId)),
    ]);

    const blocked   = bVal ? JSON.parse(bVal) : [];
    const enquiries = eVal ? JSON.parse(eVal) : [];
    const icalEvts  = iVal ? JSON.parse(iVal) : [];

    const confirmedBlocks = enquiries
      .filter(e => e.status === 'confirmed' && e.checkIn && e.checkOut)
      .map(e => ({ id: e.id, start: e.checkIn, end: e.checkOut, reason: `Booked — ${e.name}`, roomId: roomKey(e.room) }));

    const icalBlocks = icalEvts.map(e => ({
      id: `ical_${e.start}`, start: e.start, end: e.end,
      reason: e.summary || 'Airbnb Booking', roomId: 'all',
    }));

    return Response.json({ blocked: [...blocked, ...confirmedBlocks, ...icalBlocks] }, { headers: cors });
  } catch {
    return Response.json({ blocked: [] }, { headers: cors });
  }
}

// ── Admin: list all enquiries + blocked dates ─────────────────────────────────

async function adminListEnquiries(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ enquiries: [], blocked: [], icalEvents: [] }, { headers: cors });

  const propId = new URL(request.url).searchParams.get('property') || 'ta-garden';

  const [eVal, bVal, iVal] = await Promise.all([
    env.BOOKINGS.get(enquiriesKey(propId)),
    env.BOOKINGS.get(blockedKey(propId)),
    env.BOOKINGS.get(icalKey(propId)),
  ]);

  const safeParse = (val) => {
    if (!val) return [];
    try { return JSON.parse(val); } catch { return []; }
  };

  return Response.json({
    enquiries:  safeParse(eVal),
    blocked:    safeParse(bVal),
    icalEvents: safeParse(iVal),
  }, { headers: cors });
}

// ── Admin: update enquiry status ──────────────────────────────────────────────

async function adminUpdateEnquiry(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, status, propertyId = 'ta-garden' } = await request.json();
  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = safeJsonParse(val);
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
  enquiries[idx].status = status;
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  return Response.json({ success: true }, { headers: cors });
}

async function adminDeleteEnquiry(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, propertyId = 'ta-garden' } = await request.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });

  const key = enquiriesKey(propertyId);
  const enquiries = safeJsonParse(await env.BOOKINGS.get(key));
  const enq = enquiries.find(e => e.id === id);
  if (!enq) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const kept = enquiries.filter(e => e.id !== id);
  await env.BOOKINGS.put(key, JSON.stringify(kept));

  // Clean up all associated KV keys
  await Promise.all([
    env.BOOKINGS.delete(`enq_idx_${id}`),
    env.BOOKINGS.delete(`log_${id}`),
    env.BOOKINGS.delete(`contract_${id}`),
    env.BOOKINGS.delete(`payments__${id}`),
    env.BOOKINGS.delete(`guest__${id}`),
    env.BOOKINGS.delete(`electricity__${id}`),
  ]);

  // Remove from blocked ranges if this enquiry blocked calendar dates
  const blocked = safeJsonParse(await env.BOOKINGS.get(blockedKey(propertyId)));
  const cleanedBlocked = blocked.filter(b => b.enqId !== id);
  await env.BOOKINGS.put(blockedKey(propertyId), JSON.stringify(cleanedBlocked));

  return Response.json({ success: true, message: `Enquiry ${id} and all associated data deleted.` }, { headers: cors });
}

// ── Admin: properties CRUD ────────────────────────────────────────────────────

async function adminListProperties(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ properties: DEFAULT_PROPERTIES }, { headers: cors });

  const val = await env.BOOKINGS.get('properties');
  const properties = val ? JSON.parse(val) : DEFAULT_PROPERTIES;
  return Response.json({ properties }, { headers: cors });
}

async function adminSaveProperty(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const prop = await request.json();
  if (!prop.id || !prop.name) return Response.json({ error: 'id and name required' }, { status: 400, headers: cors });

  const val  = await env.BOOKINGS.get('properties');
  const list = val ? JSON.parse(val) : [...DEFAULT_PROPERTIES];
  const idx  = list.findIndex(p => p.id === prop.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...prop };
  else list.push({ rooms: [], type: 'rental', color: '#86a2a6', active: true, icalUrl: null, ...prop });

  await env.BOOKINGS.put('properties', JSON.stringify(list));
  return Response.json({ success: true }, { headers: cors });
}

async function adminDeleteProperty(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id } = await request.json();
  if (id === 'ta-garden') return Response.json({ error: 'Cannot delete default property' }, { status: 400, headers: cors });

  const val  = await env.BOOKINGS.get('properties');
  const list = val ? JSON.parse(val) : [...DEFAULT_PROPERTIES];
  await env.BOOKINGS.put('properties', JSON.stringify(list.filter(p => p.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

// ── Admin: notify guest (confirm / decline) ───────────────────────────────────

async function adminNotify(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { enquiryId, propertyId = 'ta-garden', action, customMessage, rentUsd, rentVnd, depositAmount } = await request.json();
  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = safeJsonParse(val);
  const idx = enquiries.findIndex(e => e.id === enquiryId);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const enq = enquiries[idx];
  const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
  enquiries[idx].status = newStatus;
  if (action === 'confirm') {
    if (rentUsd) enquiries[idx].rentUsd = Number(rentUsd);
    if (rentVnd) enquiries[idx].rentVnd = Number(rentVnd);
    if (depositAmount) enquiries[idx].depositAmount = Number(depositAmount);
  }
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));

  const origin = new URL(request.url).origin;
  const customRates = { rentUsd: rentUsd || enquiries[idx].rentUsd, rentVnd: rentVnd || enquiries[idx].rentVnd, depositAmount: depositAmount || enquiries[idx].depositAmount };
  const html    = action === 'confirm' ? buildConfirmEmail(enq, customMessage, origin, propertyId, customRates) : buildDeclineEmail(enq, customMessage);
  const subject = action === 'confirm'
    ? `Your booking at Ta.Garden is confirmed — ${enq.room}`
    : `Re: Your enquiry at Ta.Garden — ${enq.room}`;

  await sendAndLog(env, enquiryId, action === 'confirm' ? 'confirmation_email' : 'decline_email', enq.email, subject, html, null);
  if (action === 'confirm') {
    const isColt = enq.room === 'First Floor Room';
    const contractHtml = isColt ? buildColtContractEmail(enq) : buildContractEmail(enq, customRates);
    await env.BOOKINGS.put(`contract_${enquiryId}`, contractHtml);
    await appendLog(env, enquiryId, { type: 'booking_confirmed', note: 'Booking confirmed — confirmation email sent. Contract saved to portal, not yet emailed.' });
  } else {
    await appendLog(env, enquiryId, { type: 'booking_declined', note: 'Booking declined by admin.' });
  }
  return Response.json({ success: true, status: newStatus }, { headers: cors });
}

// ── Admin: save internal note ─────────────────────────────────────────────────

async function adminSaveNote(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, note, propertyId = 'ta-garden' } = await request.json();
  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = safeJsonParse(val);
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx >= 0) {
    enquiries[idx].note = note;
    await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  }
  return Response.json({ success: true }, { headers: cors });
}

// ── Admin: block / unblock ────────────────────────────────────────────────────

async function adminBlock(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { start, end, reason, roomId, propertyId = 'ta-garden' } = await request.json();
  const key    = blockedKey(propertyId);
  const val    = await env.BOOKINGS.get(key);
  const ranges = safeJsonParse(val);
  const id     = `block_${Date.now()}`;
  ranges.push({ id, start, end, reason: reason || 'Blocked', roomId: roomId || 'all' });
  await env.BOOKINGS.put(key, JSON.stringify(ranges));
  return Response.json({ success: true, id }, { headers: cors });
}

async function adminUnblock(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, propertyId = 'ta-garden' } = await request.json();
  const key    = blockedKey(propertyId);
  const val    = await env.BOOKINGS.get(key);
  const ranges = safeJsonParse(val);
  await env.BOOKINGS.put(key, JSON.stringify(ranges.filter(r => r.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

// ── Admin: iCal sync from Airbnb ──────────────────────────────────────────────

async function adminIcalSync(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { propertyId, icalUrl } = await request.json();
  if (!icalUrl) return Response.json({ error: 'No iCal URL provided' }, { status: 400, headers: cors });

  try {
    const propVal = await env.BOOKINGS.get('properties');
    const props   = propVal ? JSON.parse(propVal) : [...DEFAULT_PROPERTIES];
    const pIdx    = props.findIndex(p => p.id === propertyId);
    if (pIdx >= 0) { props[pIdx].icalUrl = icalUrl; await env.BOOKINGS.put('properties', JSON.stringify(props)); }

    const res  = await fetch(icalUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TaGardenAdmin/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text   = await res.text();
    const events = parseICal(text);

    await env.BOOKINGS.put(icalKey(propertyId), JSON.stringify(events));
    return Response.json({ success: true, count: events.length, events }, { headers: cors });
  } catch (err) {
    return Response.json({ error: `Failed to fetch iCal: ${err.message}` }, { status: 502, headers: cors });
  }
}

// ── iCal parser ───────────────────────────────────────────────────────────────

function parseICal(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT');
  blocks.slice(1).forEach(block => {
    const get = (field) => {
      const m = block.match(new RegExp(field + '[^:]*:([^\r\n]+)'));
      return m ? m[1].trim() : null;
    };
    const normalizeDate = (d) => {
      if (!d) return null;
      if (d.includes('T')) d = d.split('T')[0];
      if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
      return d;
    };
    const start   = normalizeDate(get('DTSTART'));
    const end     = normalizeDate(get('DTEND'));
    const summary = get('SUMMARY') || 'Airbnb Booking';
    if (start && end && start !== end) events.push({ start, end, summary });
  });
  return events;
}

// ── Guest portal (public) ─────────────────────────────────────────────────────

async function handleGuestGet(request, env, cors) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const propId = params.get('p') || 'ta-garden';
  if (!id || !env.BOOKINGS) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
  return guestPortalData(id, propId, env, cors);
}

async function guestPortalData(enquiryId, propId, env, cors) {
  const val = await env.BOOKINGS.get(enquiriesKey(propId));
  const list = safeJsonParse(val);
  const enq = list.find(e => e.id === enquiryId);
  if (!enq) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const [profileRaw, paymentsRaw, electricityRaw] = await Promise.all([
    env.BOOKINGS.get(`guest__${enquiryId}`),
    env.BOOKINGS.get(`payments__${enquiryId}`),
    env.BOOKINGS.get(`electricity__${enquiryId}`),
  ]);
  const profile     = profileRaw     ? JSON.parse(profileRaw)     : null;
  const payments    = paymentsRaw    ? JSON.parse(paymentsRaw)    : [];
  const electricity = electricityRaw ? JSON.parse(electricityRaw) : [];

  return Response.json({
    enquiryId: enq.id,
    propId,
    name: enq.name,
    email: enq.email,
    room: enq.room,
    stayType: enq.stayType,
    checkIn: enq.checkIn,
    checkOut: enq.checkOut,
    status: enq.status,
    onboarding: enq.onboarding || {},
    signedAt: enq.signedAt || null,
    rentUsd: enq.rentUsd || null,
    depositAmount: enq.depositAmount || null,
    profileSubmitted: !!profile,
    profile: profile ? {
      fullName: profile.fullName, nationality: profile.nationality,
      dateOfBirth: profile.dateOfBirth, passportNumber: profile.passportNumber,
      homeAddress: profile.homeAddress, emergencyName: profile.emergencyName,
      emergencyPhone: profile.emergencyPhone, emergencyRelation: profile.emergencyRelation,
      passportUploaded: !!profile.passport, visaUploaded: !!profile.visa,
      submittedAt: profile.submittedAt,
      son: profile.son || null,
    } : null,
    payments,
    electricity,
  }, { headers: cors });
}

async function handleGuestSubmit(request, env, cors, ctx) {
  try {
    const { id, propertyId = 'ta-garden', fullName, dateOfBirth, nationality, passportNumber, homeAddress, emergencyName, emergencyPhone, passport, visa, sonFullName, sonDateOfBirth, sonNationality, sonPassportNumber, sonPassportExpiry, sonVisa } = await request.json();
    if (!id || !fullName) return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
    if (!env.BOOKINGS) return Response.json({ error: 'Storage unavailable' }, { status: 503, headers: cors });

    const profile = { fullName, dateOfBirth, nationality, passportNumber, homeAddress, emergencyName, emergencyPhone, passport: passport || null, visa: visa || null, submittedAt: new Date().toISOString(), son: (sonFullName || sonDateOfBirth) ? { fullName: sonFullName || null, dateOfBirth: sonDateOfBirth || null, nationality: sonNationality || null, passportNumber: sonPassportNumber || null, passportExpiry: sonPassportExpiry || null, visa: sonVisa || null } : null };
    await env.BOOKINGS.put(`guest__${id}`, JSON.stringify(profile));

    // Update onboarding flags on the enquiry
    const key = enquiriesKey(propertyId);
    const val = await env.BOOKINGS.get(key);
    const enquiries = safeJsonParse(val);
    const idx = enquiries.findIndex(e => e.id === id);
    if (idx >= 0) {
      enquiries[idx].onboarding = {
        ...((enquiries[idx].onboarding) || {}),
        passportUploaded: !!passport,
        visaUploaded: !!visa,
      };
      await env.BOOKINGS.put(key, JSON.stringify(enquiries));
    }

    // Notify admin
    const enq = idx >= 0 ? enquiries[idx] : { name: fullName, room: 'Unknown' };
    const adminHtml = `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px;background:#f5f0eb;">
      <h2 style="font-weight:300;margin-bottom:16px;">Guest Profile Submitted</h2>
      <p><strong>${fullName}</strong> has submitted their guest profile for <strong>${enq.room || ''}</strong>.</p>
      <ul style="font-size:14px;line-height:2;margin-top:12px;">
        <li>Nationality: ${nationality || '—'}</li>
        <li>Passport: ${passportNumber || '—'}</li>
        <li>DOB: ${dateOfBirth || '—'}</li>
        <li>Emergency contact: ${emergencyName || '—'} (${emergencyPhone || '—'})</li>
        <li>Passport photo: ${passport ? 'Uploaded ✓' : 'Not uploaded'}</li>
        <li>Visa document: ${visa ? 'Uploaded ✓' : 'Not uploaded'}</li>
      </ul>
      <p style="margin-top:16px;font-size:13px;color:#88917d;">Log in to the admin dashboard to view documents.</p>
    </div>`;
    const emailWork = Promise.all(
      TO_EMAILS.map(to => resend(FROM, to, `Guest profile submitted — ${fullName}`, adminHtml, null, env))
    ).catch(err => console.error('Email error:', err));
    if (ctx?.waitUntil) ctx.waitUntil(emailWork);

    return Response.json({ success: true }, { headers: cors });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Submission failed' }, { status: 500, headers: cors });
  }
}

async function handleGuestSignContract(request, env, cors) {
  const { id, propertyId = 'ta-garden', signature } = await request.json().catch(() => ({}));
  if (!id || !signature) return Response.json({ error: 'id and signature are required' }, { status: 400, headers: cors });
  if (!env.BOOKINGS) return Response.json({ error: 'Storage unavailable' }, { status: 503, headers: cors });

  const key = enquiriesKey(propertyId);
  const enquiries = safeJsonParse(await env.BOOKINGS.get(key));
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx < 0) return Response.json({ error: 'Booking not found' }, { status: 404, headers: cors });

  const enq = enquiries[idx];
  if (!enq.onboarding?.paymentReceived) {
    return Response.json({ error: 'Contract is locked until your deposit is confirmed. Please check back once your payment has been verified.' }, { status: 403, headers: cors });
  }
  if (enq.onboarding?.contractSigned) {
    return Response.json({ error: 'Contract already signed.' }, { status: 409, headers: cors });
  }

  const signedAt = new Date().toISOString();
  enquiries[idx].signature  = signature;
  enquiries[idx].signedAt   = signedAt;
  enquiries[idx].onboarding = { ...(enq.onboarding || {}), contractSigned: true };
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));

  // Rebuild contract with actual signature and send
  const rates = { rentUsd: enq.rentUsd, rentVnd: enq.rentVnd, depositAmount: enq.depositAmount };
  const contractHtml = enq.room === 'First Floor Room'
    ? buildColtContractEmail({ ...enq, signature, signedAt })
    : buildContractEmail({ ...enq, signature, signedAt }, rates);
  await env.BOOKINGS.put(`contract_${id}`, contractHtml);

  await sendAndLog(env, id, 'contract_email', enq.email, `Your Ta.Garden Rental Agreement — ${enq.room}`, contractHtml, null);
  await appendLog(env, id, { type: 'contract_signed', note: `Guest e-signed contract: "${signature}"` });

  await Promise.all(TO_EMAILS.map(to =>
    resend(FROM, to, `Contract signed — ${enq.name} (${enq.room})`,
      `<p style="font-family:Georgia,serif;max-width:600px;margin:24px auto;"><strong>${enq.name}</strong> has signed their rental agreement for <strong>${enq.room}</strong>.<br><br>Signed at: ${new Date(signedAt).toLocaleString()}</p>`,
      null, env)
  ));

  return Response.json({ success: true, message: 'Contract signed. A copy has been emailed to you.' }, { headers: cors });
}

// ── Admin: update onboarding checklist ────────────────────────────────────────

async function adminUpdateOnboarding(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, propertyId = 'ta-garden', field, value } = await request.json();
  const ALLOWED = ['paymentReceived', 'contractSigned', 'passportUploaded', 'visaUploaded'];
  if (!ALLOWED.includes(field)) return Response.json({ error: 'Invalid field' }, { status: 400, headers: cors });

  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = safeJsonParse(val);
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  enquiries[idx].onboarding = { ...(enquiries[idx].onboarding || {}), [field]: value };
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  return Response.json({ success: true }, { headers: cors });
}

// ── Admin: get guest profile ──────────────────────────────────────────────────

async function adminGetGuestProfile(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });

  const [profileRaw, logRaw, contractRaw] = await Promise.all([
    env.BOOKINGS.get(`guest__${id}`),
    env.BOOKINGS.get(`log_${id}`),
    env.BOOKINGS.get(`contract_${id}`),
  ]);
  return Response.json({
    profile: profileRaw ? JSON.parse(profileRaw) : null,
    log: logRaw ? JSON.parse(logRaw) : [],
    hasContract: !!contractRaw,
  }, { headers: cors });
}

async function adminGetActivityLog(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });
  const raw = await env.BOOKINGS.get(`log_${id}`);
  return Response.json({ log: raw ? JSON.parse(raw) : [] }, { headers: cors });
}

async function adminGetContract(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response('id required', { status: 400, headers: cors });
  const html = await env.BOOKINGS.get(`contract_${id}`);
  if (!html) return new Response('Contract not found', { status: 404, headers: cors });
  return new Response(html, { status: 200, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
}

async function adminSendContract(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { id } = await request.json().catch(() => ({}));
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });

  const [contractHtml, enqIdxRaw] = await Promise.all([
    env.BOOKINGS.get(`contract_${id}`),
    env.BOOKINGS.get(`enq_idx_${id}`),
  ]);
  if (!contractHtml) return Response.json({ error: 'Contract not found. Create a booking first.' }, { status: 404, headers: cors });

  const propertyId = enqIdxRaw || 'ta-garden';
  const enquiries = safeJsonParse(await env.BOOKINGS.get(enquiriesKey(propertyId)));
  const enq = enquiries.find(e => e.id === id);
  if (!enq) return Response.json({ error: 'Enquiry not found' }, { status: 404, headers: cors });

  const res = await sendAndLog(env, id, 'contract_email', enq.email, `Your Ta.Garden Rental Agreement — ${enq.room}`, contractHtml, null);
  if (!res?.ok) return Response.json({ success: false, error: 'Email send failed' }, { status: 500, headers: cors });

  return Response.json({ success: true, message: `Contract sent to ${enq.email}.` }, { headers: cors });
}

// ── Guest: magic link login ───────────────────────────────────────────────────

async function handleGuestRequestLogin(request, env, cors, ctx) {
  const { email } = await request.json().catch(() => ({}));
  if (!email) return Response.json({ error: 'Email required' }, { status: 400, headers: cors });
  if (!env.BOOKINGS) return Response.json({ error: 'Storage unavailable' }, { status: 503, headers: cors });

  const propsRaw = await env.BOOKINGS.get('properties');
  const props = propsRaw ? JSON.parse(propsRaw) : DEFAULT_PROPERTIES;

  let foundEnq = null, foundPropId = null;
  for (const prop of props) {
    const val = await env.BOOKINGS.get(enquiriesKey(prop.id));
    const enquiries = safeJsonParse(val);
    const match = enquiries.find(e => e.email?.toLowerCase() === email.toLowerCase() && e.status !== 'cancelled');
    if (match) { foundEnq = match; foundPropId = prop.id; break; }
  }

  if (foundEnq) {
    const token = crypto.randomUUID().replace(/-/g, '');
    await env.BOOKINGS.put(`magic__${token}`, JSON.stringify({ enquiryId: foundEnq.id, propId: foundPropId }), { expirationTtl: 3600 });
    const origin = new URL(request.url).origin;
    const loginUrl = `${origin}/guest.html?token=${token}`;
    const emailWork = resend(FROM, email, 'Your Ta.Garden portal link', buildMagicLinkEmail(foundEnq.name, loginUrl), null, env)
      .catch(err => console.error('Magic link email error:', err));
    if (ctx?.waitUntil) ctx.waitUntil(emailWork);
  }

  return Response.json({ success: true }, { headers: cors });
}

async function handleGuestVerifyToken(request, env, cors) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !env.BOOKINGS) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });

  const raw = await env.BOOKINGS.get(`magic__${token}`);
  if (!raw) return Response.json({ error: 'Token expired or invalid' }, { status: 401, headers: cors });

  const { enquiryId, propId } = JSON.parse(raw);
  await env.BOOKINGS.delete(`magic__${token}`);
  return guestPortalData(enquiryId, propId, env, cors);
}

// ── Admin: payments ───────────────────────────────────────────────────────────

async function adminGetPayments(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });
  const raw = await env.BOOKINGS.get(`payments__${id}`);
  return Response.json({ payments: raw ? JSON.parse(raw) : [] }, { headers: cors });
}

async function adminRecordPayment(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { enquiryId, amount, currency = 'VND', date, note } = await request.json();
  if (!enquiryId || !amount) return Response.json({ error: 'enquiryId and amount required' }, { status: 400, headers: cors });

  const key = `payments__${enquiryId}`;
  const raw = await env.BOOKINGS.get(key);
  const payments = safeJsonParse(raw);
  const id = `pay_${Date.now()}`;
  const payDate = date || new Date().toISOString().split('T')[0];
  payments.unshift({ id, amount: Number(amount), currency, date: payDate, note: note || '', recordedAt: new Date().toISOString() });
  await env.BOOKINGS.put(key, JSON.stringify(payments));
  await appendLog(env, enquiryId, { type: 'payment_recorded', note: `${Number(amount).toLocaleString()} ${currency} recorded${note ? ' — ' + note : ''} (${payDate})` });
  return Response.json({ success: true, id }, { headers: cors });
}

async function adminDeletePayment(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { enquiryId, id } = await request.json();
  if (!enquiryId || !id) return Response.json({ error: 'enquiryId and id required' }, { status: 400, headers: cors });

  const key = `payments__${enquiryId}`;
  const raw = await env.BOOKINGS.get(key);
  const payments = safeJsonParse(raw);
  await env.BOOKINGS.put(key, JSON.stringify(payments.filter(p => p.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

// ── Electricity billing ───────────────────────────────────────────────────────

async function adminPostElectricity(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { enquiryId, period, amountVnd, note } = await request.json();
  if (!enquiryId || !period || !amountVnd) return Response.json({ error: 'enquiryId, period, and amountVnd required' }, { status: 400, headers: cors });

  const key = `electricity__${enquiryId}`;
  const bills = safeJsonParse(await env.BOOKINGS.get(key));
  const id = `elec_${Date.now()}`;
  const amountUsd = Math.round((Number(amountVnd) / 25000) * 100) / 100;
  bills.unshift({ id, period, amountVnd: Number(amountVnd), amountUsd, note: note || '', status: 'unpaid', postedAt: new Date().toISOString() });
  await env.BOOKINGS.put(key, JSON.stringify(bills));
  await appendLog(env, enquiryId, { type: 'electricity_posted', note: `Electricity bill posted: ${Number(amountVnd).toLocaleString()} VND for ${period}` });
  return Response.json({ success: true, id }, { headers: cors });
}

async function adminGetElectricity(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });
  const raw = await env.BOOKINGS.get(`electricity__${id}`);
  return Response.json({ bills: safeJsonParse(raw) }, { headers: cors });
}

async function adminDeleteElectricity(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { enquiryId, id } = await request.json();
  if (!enquiryId || !id) return Response.json({ error: 'enquiryId and id required' }, { status: 400, headers: cors });
  const key = `electricity__${enquiryId}`;
  const bills = safeJsonParse(await env.BOOKINGS.get(key));
  await env.BOOKINGS.put(key, JSON.stringify(bills.filter(b => b.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

async function adminMarkElectricityPaid(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { enquiryId, id, status } = await request.json();
  if (!enquiryId || !id) return Response.json({ error: 'enquiryId and id required' }, { status: 400, headers: cors });
  const key = `electricity__${enquiryId}`;
  const bills = safeJsonParse(await env.BOOKINGS.get(key));
  const idx = bills.findIndex(b => b.id === id);
  if (idx >= 0) { bills[idx].status = status || 'paid'; bills[idx].paidAt = new Date().toISOString(); }
  await env.BOOKINGS.put(key, JSON.stringify(bills));
  await appendLog(env, enquiryId, { type: 'electricity_paid', note: `Electricity bill marked as ${status || 'paid'} for ${bills[idx]?.period || ''}` });
  return Response.json({ success: true }, { headers: cors });
}

async function guestGetElectricity(request, env, cors) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ bills: [] }, { headers: cors });
  const raw = await env.BOOKINGS.get(`electricity__${id}`);
  return Response.json({ bills: safeJsonParse(raw) }, { headers: cors });
}

// ── Public: gallery ───────────────────────────────────────────────────────────

async function handleGalleryGet(request, env, cors) {
  const room = new URL(request.url).searchParams.get('room') || 'river-room';
  if (!env.BOOKINGS) return Response.json({ images: [] }, { headers: cors });
  const raw = await env.BOOKINGS.get(`gallery__${room}`);
  const images = safeJsonParse(raw);
  return Response.json({ images }, { headers: cors });
}

// ── Admin: gallery management ─────────────────────────────────────────────────

async function adminGalleryAdd(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { room, data, alt } = await request.json();
  if (!room || !data) return Response.json({ error: 'room and data required' }, { status: 400, headers: cors });

  const key = `gallery__${room}`;
  const raw = await env.BOOKINGS.get(key);
  const images = safeJsonParse(raw);
  const id = `img_${Date.now()}`;
  images.push({ id, data, alt: alt || '' });
  await env.BOOKINGS.put(key, JSON.stringify(images));
  return Response.json({ success: true, id }, { headers: cors });
}

async function adminGalleryDelete(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { room, id } = await request.json();
  if (!room || !id) return Response.json({ error: 'room and id required' }, { status: 400, headers: cors });

  const key = `gallery__${room}`;
  const raw = await env.BOOKINGS.get(key);
  const images = safeJsonParse(raw);
  await env.BOOKINGS.put(key, JSON.stringify(images.filter(img => img.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

// ── Room listings ─────────────────────────────────────────────────────────────

function toRoomSlug(name) {
  return name.toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function handleRoomsGet(request, env, cors) {
  const propId = new URL(request.url).searchParams.get('prop') || 'ta-garden';
  if (!env.BOOKINGS) return Response.json({ rooms: [] }, { headers: cors });

  const propsRaw = await env.BOOKINGS.get('properties');
  const props = propsRaw ? JSON.parse(propsRaw) : DEFAULT_PROPERTIES;
  const prop = props.find(p => p.id === propId);
  if (!prop) return Response.json({ rooms: [] }, { headers: cors });

  const rooms = (await Promise.all(
    (prop.rooms || []).map(async (roomName) => {
      const raw = await env.BOOKINGS.get(`room__${propId}__${toRoomSlug(roomName)}`);
      if (!raw) return null;
      const { notes, status, ...pub } = JSON.parse(raw);
      if (status === 'inactive') return null;
      return pub;
    })
  )).filter(Boolean);

  return Response.json({ rooms }, { headers: cors });
}

async function adminGetRooms(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const propId = new URL(request.url).searchParams.get('prop') || 'ta-garden';
  if (!env.BOOKINGS) return Response.json({ rooms: {} }, { headers: cors });

  const propsRaw = await env.BOOKINGS.get('properties');
  const props = propsRaw ? JSON.parse(propsRaw) : DEFAULT_PROPERTIES;
  const prop = props.find(p => p.id === propId);
  if (!prop) return Response.json({ rooms: {} }, { headers: cors });

  const rooms = {};
  await Promise.all(
    (prop.rooms || []).map(async (roomName) => {
      const raw = await env.BOOKINGS.get(`room__${propId}__${toRoomSlug(roomName)}`);
      if (raw) rooms[roomName] = JSON.parse(raw);
    })
  );
  return Response.json({ rooms }, { headers: cors });
}

async function adminSaveRoom(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { propId = 'ta-garden', name, ...rest } = await request.json();
  if (!name) return Response.json({ error: 'name required' }, { status: 400, headers: cors });

  const slug = toRoomSlug(name);
  const raw = await env.BOOKINGS.get(`room__${propId}__${slug}`);
  const existing = raw ? JSON.parse(raw) : {};
  await env.BOOKINGS.put(`room__${propId}__${slug}`, JSON.stringify({ ...existing, name, ...rest, updatedAt: new Date().toISOString() }));
  return Response.json({ success: true, slug }, { headers: cors });
}

// ── Email automation (cron + manual trigger) ──────────────────────────────────

async function adminRunEmails(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const result = await runEmailAutomation(env);
  return Response.json(result, { headers: cors });
}

async function runEmailAutomation(env) {
  if (!env.BOOKINGS) return { sent: 0, skipped: 0, errors: [] };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const dateStr = (daysOffset) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + daysOffset);
    return d.toISOString().split('T')[0];
  };

  const propsRaw = await env.BOOKINGS.get('properties');
  const props = propsRaw ? JSON.parse(propsRaw) : DEFAULT_PROPERTIES;

  let sent = 0, skipped = 0;
  const errors = [];

  for (const prop of props) {
    const key = enquiriesKey(prop.id);
    const raw = await env.BOOKINGS.get(key);
    if (!raw) continue;

    const enquiries = safeJsonParse(raw);
    let changed = false;

    for (const enq of enquiries) {
      if (enq.status !== 'confirmed' || !enq.email) continue;

      if (!enq.autoEmails) enq.autoEmails = {};
      const ae = enq.autoEmails;

      // 2 days before arrival
      if (enq.checkIn === dateStr(2) && !ae.arrivalReminder) {
        try {
          await resend(FROM, enq.email, `Your stay at Ta.Garden starts in 2 days`, buildArrivalReminderEmail(enq), null, env);
          ae.arrivalReminder = new Date().toISOString();
          changed = true; sent++;
        } catch (e) { errors.push(`arrivalReminder ${enq.id}: ${e.message}`); }
      }

      // Day of checkout
      if (enq.checkOut === todayStr && !ae.checkoutReminder) {
        try {
          await resend(FROM, enq.email, `Checkout day — thank you for staying at Ta.Garden`, buildCheckoutReminderEmail(enq), null, env);
          ae.checkoutReminder = new Date().toISOString();
          changed = true; sent++;
        } catch (e) { errors.push(`checkoutReminder ${enq.id}: ${e.message}`); }
      }

      // 3 days after checkout
      if (enq.checkOut === dateStr(-3) && !ae.reviewRequest) {
        try {
          await resend(FROM, enq.email, `How was your stay at Ta.Garden?`, buildReviewRequestEmail(enq), null, env);
          ae.reviewRequest = new Date().toISOString();
          changed = true; sent++;
        } catch (e) { errors.push(`reviewRequest ${enq.id}: ${e.message}`); }
      }

      // Monthly payment reminder — send 5 days before their due day (same day of month as check-in)
      // Applies to: ongoing stays (no checkOut) OR monthly stays still active
      const isOngoing = !enq.checkOut || enq.checkOut > todayStr;
      const dueDay = enq.checkIn ? new Date(enq.checkIn + 'T00:00:00Z').getUTCDate() : 1;
      const reminderDay = dueDay <= 5 ? (dueDay - 5 + 28) : (dueDay - 5); // send 5 days before
      if (enq.stayType === 'monthly' && isOngoing && today.getUTCDate() === reminderDay) {
        // Due date is dueDay of next month (or this month if dueDay > today)
        const nm = today.getUTCDate() < dueDay ? today.getUTCMonth() + 1 : today.getUTCMonth() + 2;
        const nextYear  = nm > 12 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
        const normNm    = nm > 12 ? 1 : nm;
        const reminderKey = `payReminder_${nextYear}_${String(normNm).padStart(2,'0')}`;
        if (!ae[reminderKey]) {
          try {
            const dueDate = `${nextYear}-${String(normNm).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;
            const rentUsd = enq.rentUsd || ROOM_RATES[enq.room]?.monthly;
            const stripeUrl = enq.stripeUrl || 'https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02';
            await resend(FROM, enq.email, `Monthly rent due ${fmt(dueDate)} — Ta.Garden`, buildMonthlyReminderGuestEmail(enq, dueDate, rentUsd, stripeUrl), null, env);
            // Also notify admin with calendar link
            const gcalUrl = buildGCalLink(`Rent Due — ${enq.name} (${enq.room})`, dueDate, `$${rentUsd || '?'} monthly rent due. Guest: ${enq.email}`);
            const adminHtml = buildMonthlyReminderAdminEmail(enq, dueDate, rentUsd, gcalUrl);
            await Promise.all(TO_EMAILS.map(to => resend(FROM, to, `Payment reminder: ${enq.name} — ${enq.room} — ${fmt(dueDate)}`, adminHtml, null, env)));
            ae[reminderKey] = new Date().toISOString();
            changed = true; sent++;
          } catch (e) { errors.push(`monthlyReminder ${enq.id}: ${e.message}`); }
        }
      }
    }

    if (changed) await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  }

  return { sent, skipped, errors, date: todayStr };
}

function buildGCalLink(title, dateStr, details) {
  const d = dateStr.replace(/-/g, '');
  const next = new Date(dateStr);
  next.setUTCDate(next.getUTCDate() + 1);
  const d2 = next.toISOString().split('T')[0].replace(/-/g,'');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${d2}&details=${encodeURIComponent(details)}`;
}

function buildMonthlyReminderGuestEmail(enq, dueDate, rentUsd, stripeUrl) {
  const first = enq.name.split(' ')[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#86a2a6;padding:24px 32px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#fff;">Ta.Garden</p></td>
      <td align="right"><p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:rgba(255,255,255,0.8);letter-spacing:0.15em;text-transform:uppercase;">Payment Reminder</p></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 32px;" class="pad">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;color:#3a3a2a;">Hi ${first},</p>
    <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#3a3a2a;line-height:1.6;">This is a friendly reminder that your monthly rent is due on <strong>${fmt(dueDate)}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Room</p></td>
          <td align="right"><p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#3a3a2a;">${enq.room}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Amount Due</p></td>
          <td align="right"><p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#3a3a2a;">${rentUsd ? `$${rentUsd}` : 'As agreed'}</p></td>
        </tr></table>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:0 6px 0 0;" align="center">
        <a href="${stripeUrl}" style="display:inline-block;padding:15px 28px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Pay in USD →</a>
      </td>
      <td style="padding:0 0 0 6px;" align="center">
        <a href="${STRIPE_VND}" style="display:inline-block;padding:15px 28px;background:#2d5a27;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Pay in VND →</a>
      </td>
    </tr></table>
    <p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#88917d;text-align:center;">Thank you for being part of Ta.Garden 🌿</p>
  </td></tr>
  <tr><td style="background:#3a3a2a;padding:16px 32px;text-align:center;" class="pad">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#88917d;">Ta.Garden · Cam Nam Island · Hội An, Vietnam</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildMonthlyReminderAdminEmail(enq, dueDate, rentUsd, gcalUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#3a3a2a;padding:20px 32px;" class="pad">
    <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#c8b89a;">Ta.Garden Admin — Payment Reminder</p>
  </td></tr>
  <tr><td style="padding:24px 32px;" class="pad">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;color:#3a3a2a;"><strong>${enq.name}</strong> has a payment due on <strong>${fmt(dueDate)}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;margin-bottom:20px;">
      ${[
        ['Guest', enq.name],
        ['Email', enq.email],
        ['Room', enq.room],
        ['Amount', rentUsd ? `$${rentUsd}` : 'As agreed'],
        ['Due Date', fmt(dueDate)],
      ].map(([k,v]) => `<tr><td style="padding:12px 16px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;width:40%;border-bottom:1px solid #e0d9d0;">${k}</td><td style="padding:12px 16px;font-size:14px;color:#3a3a2a;border-bottom:1px solid #e0d9d0;">${v}</td></tr>`).join('')}
    </table>
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#88917d;">A reminder email has been sent to the guest. A guest reminder email was sent automatically.</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td>
      <a href="${gcalUrl}" style="display:inline-block;padding:12px 24px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Add to Google Calendar</a>
    </td></tr></table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildArrivalReminderEmail(enq) {
  const firstName = enq.name.split(' ')[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Georgia,serif;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:24px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:32px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <!-- Header -->
  <tr><td style="background:#1a1a18;padding:28px 36px;">
    <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Ta.Garden</div>
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:300;color:#ede0d1;">You arrive in 2 days, ${firstName}.</div>
  </td></tr>

  <!-- Intro -->
  <tr><td class="pad" style="padding:32px 36px;background:#faf8f5;">
    <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:14px;color:#4a4a3a;line-height:1.8;">We're looking forward to welcoming you to <strong>${enq.room}</strong> on <strong>${fmt(enq.checkIn)}</strong>. Everything will be ready for you. Here's all you need to know before you arrive.</p>

    <!-- Check-in & Check-out -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ddd5c8;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:14px 20px;border-bottom:1px solid #f0ebe4;">
        <div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;margin-bottom:8px;">Check-in &amp; Check-out</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 16px 6px 0;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;vertical-align:top;"><strong style="color:#1a1a18;">Check-in</strong><br>From 2:00 PM on ${fmt(enq.checkIn)}<br><span style="font-size:12px;color:#88917d;">Need to arrive earlier? Just let us know — we'll do our best to accommodate.</span></td>
            <td style="padding:6px 0 6px 16px;border-left:1px solid #f0ebe4;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;vertical-align:top;"><strong style="color:#1a1a18;">Check-out</strong><br>By 12:00 PM on ${fmt(enq.checkOut || '')}<br><span style="font-size:12px;color:#88917d;">Need a little more time? Just message us — we're flexible when we can be.</span></td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Keys -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ddd5c8;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;margin-bottom:8px;">Your Keys</div>
        <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;line-height:1.8;">You'll receive your room key when you arrive. <strong style="color:#1a1a18;">Please leave your key inside the room when you check out</strong> — do not take it with you or leave it with anyone else.</p>
      </td></tr>
    </table>

    <!-- WiFi -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ddd5c8;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;margin-bottom:10px;">WiFi</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 20px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;"><span style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#88917d;display:block;margin-bottom:2px;">Network</span><strong style="font-size:16px;color:#1a1a18;font-family:Georgia,serif;">Thu An</strong></td>
            <td style="padding:0 0 0 20px;border-left:1px solid #f0ebe4;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;"><span style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#88917d;display:block;margin-bottom:2px;">Password</span><strong style="font-size:16px;color:#1a1a18;font-family:Georgia,serif;">123456789</strong></td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- House Notes -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ddd5c8;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;margin-bottom:12px;">A Few Things to Know</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${[
            ['Common Spaces', 'Our shared areas — kitchen, living spaces, garden — are for everyone. Please treat them with care and leave them as you found them.'],
            ['Quiet Hours', 'We ask that all guests keep noise to a minimum from <strong>9:00 PM onwards</strong>. This helps everyone rest and keeps the energy of the home peaceful.'],
            ['The Gate', 'Please <strong>close and latch the gate behind you</strong> every time you enter or leave. This keeps the home secure for everyone.'],
            ['On-Site Support', 'Colt, our house manager, lives on-site and is available for any questions about the house or major repairs. He\'s your first point of contact for anything practical.'],
          ].map(([title, text]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #f5f0eb;vertical-align:top;">
            <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:#1a1a18;margin-bottom:3px;">${title}</div>
            <div style="font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;line-height:1.7;">${text}</div>
          </td></tr>`).join('')}
          <tr><td style="padding:12px 0 0;">
            <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#1a1a18;font-style:italic;line-height:1.7;">Think of Ta.Garden as your home away from home. Make yourself comfortable, settle in, and let us know if there's anything at all you need.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <!-- Location -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ddd5c8;border-radius:6px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;margin-bottom:10px;">How to Find Us</div>
        <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;line-height:1.7;"><strong style="color:#1a1a18;">K570/24, Cam Nam Island, Hội An</strong></p>
        <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:12px;color:#88917d;line-height:1.6;">Google Maps cannot locate the street address — use the GPS coordinates below or the map link:</p>
        <p style="margin:0 0 12px;font-family:Georgia,serif;font-size:15px;color:#1a1a18;">15.867740, 108.355771</p>
        <a href="https://goo.gl/maps/78FMqsqrDY1dFiAE8" style="display:inline-block;padding:10px 20px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Open in Google Maps →</a>
      </td></tr>
    </table>

    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#4a4a3a;line-height:1.8;">Any questions before you arrive? Just reply to this email — we're here.<br><br>See you soon,<br><strong style="color:#1a1a18;">Ashley &amp; the Ta.Garden team</strong></p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1a1a18;padding:20px 36px;text-align:center;">
    <div style="font-size:11px;color:#88917d;font-family:Arial,sans-serif;letter-spacing:0.06em;">Ta.Garden &nbsp;·&nbsp; Cam Nam Island, Hội An, Vietnam &nbsp;·&nbsp; A Soul &amp; Luna Property</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

function buildCheckoutReminderEmail(enq) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5efe8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border:1px solid rgba(136,145,125,0.15);">
    <div style="background:#2a2520;padding:32px 36px;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Ta.Garden</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;line-height:1.3;">Checkout day — thank you</div>
    </div>
    <div style="padding:36px;">
      <p style="margin:0 0 20px;font-size:15px;color:#2a2520;line-height:1.7;">Hi ${enq.name.split(' ')[0]},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a534c;line-height:1.8;">Today is your checkout day. It's been a genuine pleasure having you at Ta.Garden.</p>

      <div style="background:#f5efe8;padding:20px 24px;margin:24px 0;border-left:3px solid #c17a4a;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#88917d;margin-bottom:12px;">Before You Go</div>
        <div style="font-size:13px;color:#2a2520;line-height:2;">
          <div><strong>Checkout time:</strong> By 12:00 PM</div>
          <div><strong>Keys:</strong> Leave on the kitchen table or hand to Ashley directly</div>
          <div><strong>Anything left behind?</strong> Message us and we'll hold it safely</div>
        </div>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#5a534c;line-height:1.8;">If you're not quite ready to leave Hội An, we're always happy to store your bags for the day. Just ask.</p>
      <p style="margin:0 0 24px;font-size:14px;color:#5a534c;line-height:1.8;">We hope your time here gave you what you came for. Safe travels wherever you're headed next.</p>
      <p style="margin:0;font-size:14px;color:#5a534c;">With warmth,<br><span style="color:#2a2520;font-weight:500;">Ashley &amp; the Ta.Garden team</span></p>
    </div>
    <div style="padding:20px 36px;border-top:1px solid rgba(136,145,125,0.12);text-align:center;">
      <div style="font-size:11px;color:#88917d;letter-spacing:0.06em;">Ta.Garden &nbsp;·&nbsp; Cam Nam Island, Hội An, Vietnam<br>A Soul &amp; Luna Property</div>
    </div>
  </div>
</body></html>`;
}

function buildReviewRequestEmail(enq) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5efe8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border:1px solid rgba(136,145,125,0.15);">
    <div style="background:#2a2520;padding:32px 36px;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Ta.Garden</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;line-height:1.3;">How was your stay?</div>
    </div>
    <div style="padding:36px;">
      <p style="margin:0 0 20px;font-size:15px;color:#2a2520;line-height:1.7;">Hi ${enq.name.split(' ')[0]},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a534c;line-height:1.8;">We hope you've landed safely and are settling back in. We loved having you at Ta.Garden and hope the home gave you what you were looking for.</p>
      <p style="margin:0 0 28px;font-size:14px;color:#5a534c;line-height:1.8;">If you have a moment, an honest review means the world to a small home like ours — it helps the right people find their way here.</p>

      <div style="text-align:center;margin:28px 0;">
        <a href="https://g.page/r/ta-garden-hoian/review" style="display:inline-block;padding:14px 36px;background:#2a2520;color:#ede0d1;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;text-decoration:none;">Leave a Review →</a>
      </div>

      <p style="margin:24px 0 0;font-size:14px;color:#5a534c;line-height:1.8;">And if anything wasn't quite right during your stay, please just reply to this email — we'd always rather hear it directly and have the chance to improve.</p>
      <p style="margin:16px 0 0;font-size:14px;color:#5a534c;">Until next time,<br><span style="color:#2a2520;font-weight:500;">Ashley &amp; the Ta.Garden team</span></p>
    </div>
    <div style="padding:20px 36px;border-top:1px solid rgba(136,145,125,0.12);text-align:center;">
      <div style="font-size:11px;color:#88917d;letter-spacing:0.06em;">Ta.Garden &nbsp;·&nbsp; Cam Nam Island, Hội An, Vietnam<br>A Soul &amp; Luna Property</div>
    </div>
  </div>
</body></html>`;
}

// ── Test inquiry ──────────────────────────────────────────────────────────────

async function adminCreateTestInquiry(request, env, cors, ctx) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { email = 'lightofkai777@gmail.com', name = 'Kai (Test)', room = 'The River Room', stayType = 'monthly' } = await request.json().catch(() => ({}));

  const enqId = `enq_test_${Date.now()}`;
  const key   = enquiriesKey('ta-garden');
  const existing = safeJsonParse(await env.BOOKINGS.get(key));

  // Remove any previous test inquiry with the same email to keep it clean
  const filtered = existing.filter(e => !(e.email === email && e.id.startsWith('enq_test_')));

  const enq = {
    id: enqId, propertyId: 'ta-garden',
    name, email, phone: '+1 555 000 0000', room, stayType,
    checkIn: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    checkOut: null,
    message: 'This is a test inquiry for development and testing purposes.',
    price: ROOM_RATES[room]?.monthly || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    onboarding: { paymentReceived: false, contractSigned: false, passportUploaded: false, visaUploaded: false },
    isTest: true,
  };
  filtered.unshift(enq);
  await env.BOOKINGS.put(key, JSON.stringify(filtered.slice(0, 200)));
  await env.BOOKINGS.put(`enq_idx_${enqId}`, 'ta-garden');

  // Send the standard enquiry emails so you can test the full flow
  const price    = calcPrice(room, stayType, enq.checkIn, enq.checkOut);
  const dateInfo = `Move-in: ${fmt(enq.checkIn)} → Ongoing`;
  const stayLabel = 'Monthly Stay';
  const adminHtml = buildAdminEmail({ name, email, phone: enq.phone, room, stayType, stayLabel, dateInfo, checkIn: enq.checkIn, checkOut: null, message: enq.message, price });
  const guestHtml = buildGuestEmail({ name, room, stayLabel, dateInfo, message: enq.message });
  const emailWork = Promise.all([
    ...TO_EMAILS.map(to => resend(FROM, to, `[TEST] New Enquiry — ${room} (${name})`, adminHtml, email, env)),
    resend(FROM, email, '[TEST] We received your enquiry — Ta.Garden', guestHtml, null, env),
  ]).catch(err => console.error('Test inquiry email error:', err));
  if (ctx?.waitUntil) ctx.waitUntil(emailWork);

  return Response.json({ success: true, enqId, message: `Test inquiry created for ${email}` }, { headers: cors });
}

async function adminTestEmail(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const key = env?.RESEND_API_KEY;
  if (!key) return Response.json({ success: false, error: 'RESEND_API_KEY secret is not set in this Worker environment.', fix: 'Go to Cloudflare Dashboard → Workers & Pages → ta-garden-landing → Settings → Variables & Secrets → add RESEND_API_KEY' }, { status: 500, headers: cors });

  const { to = 'lightofkai777@gmail.com' } = await request.json().catch(() => ({}));
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: '[DIAGNOSTIC] Ta.Garden email test',
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;">This is a diagnostic test email from Ta.Garden. If you received this, the Resend API key is working correctly.</p><p style="font-family:Arial,sans-serif;font-size:12px;color:#888;">Sent at ${new Date().toISOString()}</p>`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return Response.json({
    success: res.ok,
    status: res.status,
    resendResponse: body,
    keyPresent: true,
    keyPrefix: key.slice(0, 6) + '...',
  }, { headers: cors });
}

async function adminKvInspect(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const key = new URL(request.url).searchParams.get('key') || 'enquiries';
  const raw = await env.BOOKINGS.get(key);
  if (!raw) return Response.json({ key, status: 'empty', length: 0 }, { headers: cors });
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(raw); } catch (e) { parseError = e.message; }
  return Response.json({
    key,
    status: parseError ? 'corrupted' : 'ok',
    length: raw.length,
    preview: raw.slice(0, 500),
    parseError,
    count: Array.isArray(parsed) ? parsed.length : null,
  }, { headers: cors });
}

async function adminKvRepair(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { key = 'enquiries' } = await request.json().catch(() => ({}));
  const raw = await env.BOOKINGS.get(key);
  if (!raw) return Response.json({ key, status: 'empty — nothing to repair' }, { headers: cors });

  // Try to parse as-is
  try {
    JSON.parse(raw);
    return Response.json({ key, status: 'already valid JSON — no repair needed' }, { headers: cors });
  } catch {}

  // Try to salvage individual objects from a truncated array
  const salvaged = [];
  const objPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g;
  let match;
  while ((match = objPattern.exec(raw)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.id && obj.email) salvaged.push(obj);
    } catch {}
  }

  if (salvaged.length > 0) {
    await env.BOOKINGS.put(key, JSON.stringify(salvaged));
    return Response.json({ key, status: 'repaired', salvaged: salvaged.length, ids: salvaged.map(e => e.id) }, { headers: cors });
  }

  // Nothing salvageable — reset to empty array
  await env.BOOKINGS.put(key, '[]');
  return Response.json({ key, status: 'reset to empty — no valid entries could be salvaged', originalLength: raw.length }, { headers: cors });
}

async function adminExportData(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const propertyId = 'ta-garden';
  const [enquiriesRaw, blockedRaw] = await Promise.all([
    env.BOOKINGS.get(enquiriesKey(propertyId)),
    env.BOOKINGS.get(blockedKey(propertyId)),
  ]);

  const enquiries = safeJsonParse(enquiriesRaw);

  // For each enquiry, fetch associated data
  const enriched = await Promise.all(enquiries.map(async enq => {
    const [profileRaw, paymentsRaw, logRaw] = await Promise.all([
      env.BOOKINGS.get(`guest__${enq.id}`),
      env.BOOKINGS.get(`payments__${enq.id}`),
      env.BOOKINGS.get(`log_${enq.id}`),
    ]);
    return {
      ...enq,
      guestProfile: profileRaw ? JSON.parse(profileRaw) : null,
      payments: paymentsRaw ? JSON.parse(paymentsRaw) : [],
      activityLog: logRaw ? JSON.parse(logRaw) : [],
    };
  }));

  const exportData = {
    exportedAt: new Date().toISOString(),
    propertyId,
    enquiries: enriched,
    blockedDates: safeJsonParse(blockedRaw),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ta-garden-backup-${new Date().toISOString().slice(0,10)}.json"`,
    },
  });
}

async function adminSetupColt(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { name, email, checkIn } = await request.json();
  if (!name || !email) return Response.json({ error: 'name and email required' }, { status: 400, headers: cors });

  // Check if a First Floor Room booking already exists for this email
  const key = enquiriesKey('ta-garden');
  const enquiries = safeJsonParse(await env.BOOKINGS.get(key));
  const existing = enquiries.find(e => e.email?.toLowerCase() === email.toLowerCase() && e.room === 'First Floor Room' && e.status !== 'cancelled');
  if (existing) return Response.json({ error: 'A First Floor Room profile already exists for this email.' }, { status: 409, headers: cors });

  const enqId = `enq_${Date.now()}`;
  const enq = {
    id: enqId, propertyId: 'ta-garden',
    name, email, phone: '',
    room: 'First Floor Room',
    stayType: 'monthly',
    checkIn: checkIn || null,
    checkOut: null,
    message: 'House manager profile — created by admin.',
    price: 200,
    status: 'pending',
    createdAt: new Date().toISOString(),
    onboarding: { paymentReceived: false, contractSigned: false, passportUploaded: false, visaUploaded: false },
    rentUsd: 200,
    rentVnd: 5000000,
    depositAmount: 200,
    directBooking: true,
  };

  enquiries.unshift(enq);
  await env.BOOKINGS.put(key, JSON.stringify(enquiries.slice(0, 200)));
  await env.BOOKINGS.put(`enq_idx_${enqId}`, 'ta-garden');

  // Pre-build and save Colt's contract to KV (no email sent)
  const contractHtml = buildColtContractEmail(enq);
  await env.BOOKINGS.put(`contract_${enqId}`, contractHtml);
  await appendLog(env, enqId, { type: 'profile_created', note: 'House manager profile created by admin. No emails sent yet.' });

  return Response.json({ success: true, enqId, message: `Profile created for ${name}. Send confirmation when ready.` }, { headers: cors });
}

async function adminResetTest(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const TEST_EMAIL = 'lightofkai777@gmail.com';
  const key = enquiriesKey('ta-garden');
  const existing = safeJsonParse(await env.BOOKINGS.get(key));

  // Find all enquiries for the test email
  const toRemove = existing.filter(e => e.email === TEST_EMAIL);
  const kept     = existing.filter(e => e.email !== TEST_EMAIL);

  await env.BOOKINGS.put(key, JSON.stringify(kept));

  // Delete all associated KV keys for each removed enquiry
  await Promise.all(toRemove.flatMap(e => [
    env.BOOKINGS.delete(`enq_idx_${e.id}`),
    env.BOOKINGS.delete(`log_${e.id}`),
    env.BOOKINGS.delete(`contract_${e.id}`),
    env.BOOKINGS.delete(`payments__${e.id}`),
    env.BOOKINGS.delete(`guest__${e.id}`),
  ]));

  // Also clear the guest profile stored by email lookup
  await env.BOOKINGS.delete(`guest_email__${TEST_EMAIL}`);

  // Remove from blocked ranges if any enqId matches
  const removedIds = new Set(toRemove.map(e => e.id));
  const blocked = safeJsonParse(await env.BOOKINGS.get(blockedKey('ta-garden')));
  const cleanedBlocked = blocked.filter(b => !removedIds.has(b.enqId));
  await env.BOOKINGS.put(blockedKey('ta-garden'), JSON.stringify(cleanedBlocked));

  return Response.json({
    success: true,
    removed: toRemove.length,
    message: `Cleared ${toRemove.length} enquiry(ies) and all associated data for ${TEST_EMAIL}.`,
  }, { headers: cors });
}

// ── Direct booking links ──────────────────────────────────────────────────────

async function adminCreateBookingLink(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const { room, stayType = 'monthly', guestName = '', guestEmail = '', notes = '', stripeUrl = '', rentUsd, rentVnd, depositAmount, expiryDays = 60 } = await request.json();
  if (!room) return Response.json({ error: 'room is required' }, { status: 400, headers: cors });

  const token = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2,'0')).join('');
  const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString();
  const link = { token, room, stayType, guestName, guestEmail, notes, stripeUrl, rentUsd: rentUsd || null, rentVnd: rentVnd || null, depositAmount: depositAmount || null, expiresAt, createdAt: new Date().toISOString(), status: 'pending' };

  await env.BOOKINGS.put(`booking_link_${token}`, JSON.stringify(link), { expirationTtl: expiryDays * 86400 });

  // Keep an index of all links for admin listing
  const idx = safeJsonParse(await env.BOOKINGS.get('booking_links_idx'));
  idx.unshift({ token, room, guestName, guestEmail, createdAt: link.createdAt, status: 'pending' });
  await env.BOOKINGS.put('booking_links_idx', JSON.stringify(idx.slice(0, 100)));

  const url = `https://ta-garden.soulandlunawellness.com/book.html?t=${token}`;
  return Response.json({ token, url }, { headers: cors });
}

async function adminListBookingLinks(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  const idx = safeJsonParse(await env.BOOKINGS.get('booking_links_idx'));
  return Response.json({ links: idx }, { headers: cors });
}

async function handleBookingLinkGet(request, env, cors) {
  const token = new URL(request.url).pathname.replace('/api/booking-link/', '').split('/')[0];
  if (!token || !env.BOOKINGS) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const raw = await env.BOOKINGS.get(`booking_link_${token}`);
  if (!raw) return Response.json({ error: 'Link not found or expired' }, { status: 404, headers: cors });

  const link = JSON.parse(raw);
  if (new Date(link.expiresAt) < new Date()) return Response.json({ error: 'This link has expired' }, { status: 410, headers: cors });
  if (link.status === 'confirmed') return Response.json({ error: 'This booking has already been confirmed' }, { status: 410, headers: cors });

  const rates = ROOM_RATES[link.room] || null;
  return Response.json({
    room: link.room,
    stayType: link.stayType,
    guestName: link.guestName,
    guestEmail: link.guestEmail,
    notes: link.notes,
    rates,
    customRentUsd: link.rentUsd || null,
    customRentVnd: link.rentVnd || null,
    customDeposit: link.depositAmount || null,
  }, { headers: cors });
}

async function handleBookingLinkConfirm(request, env, cors, ctx) {
  const parts = new URL(request.url).pathname.split('/');
  const token = parts[parts.length - 2];

  const raw = token && env.BOOKINGS ? await env.BOOKINGS.get(`booking_link_${token}`) : null;
  if (!raw) return Response.json({ error: 'Link not found or expired' }, { status: 404, headers: cors });

  const link = JSON.parse(raw);
  if (new Date(link.expiresAt) < new Date()) return Response.json({ error: 'This link has expired' }, { status: 410, headers: cors });
  if (link.status === 'confirmed') return Response.json({ error: 'Already confirmed' }, { status: 410, headers: cors });

  const { name, email, phone, checkIn, checkOut, signature } = await request.json();
  if (!name || !email || !checkIn || !signature) {
    return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
  }

  const price = calcPrice(link.room, link.stayType, checkIn, checkOut);
  const rates  = ROOM_RATES[link.room] || {};
  const deposit = rates.monthly || 0;

  // Save as a confirmed enquiry
  const enqId = `enq_${Date.now()}`;
  const key = enquiriesKey('ta-garden');
  const enquiries = safeJsonParse(await env.BOOKINGS.get(key));
  const effectiveRentUsd = link.rentUsd || rates.monthly || null;
  enquiries.unshift({
    id: enqId, propertyId: 'ta-garden',
    name, email, phone: phone || '', room: link.room,
    stayType: link.stayType, checkIn, checkOut: checkOut || null,
    message: `Direct booking (link: ${token})`,
    price: price ? price.total : null,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    onboarding: { paymentReceived: false, contractSigned: false, passportUploaded: false, visaUploaded: false },
    bookingLinkToken: token,
    signature,
    signedAt: new Date().toISOString(),
    rentUsd: effectiveRentUsd,
    rentVnd: link.rentVnd || null,
    depositAmount: link.depositAmount || deposit || null,
    stripeUrl: link.stripeUrl || 'https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02',
  });
  await env.BOOKINGS.put(key, JSON.stringify(enquiries.slice(0, 200)));
  await env.BOOKINGS.put(`enq_idx_${enqId}`, 'ta-garden');

  // Block the dates
  const blocked = safeJsonParse(await env.BOOKINGS.get(blockedKey('ta-garden')));
  blocked.push({ start: checkIn, end: checkOut, label: `${name} — ${link.room}`, enqId });
  await env.BOOKINGS.put(blockedKey('ta-garden'), JSON.stringify(blocked));

  // Mark link confirmed
  link.status = 'confirmed';
  link.confirmedAt = new Date().toISOString();
  link.confirmedBy = { name, email, enqId };
  await env.BOOKINGS.put(`booking_link_${token}`, JSON.stringify(link));

  // Update index
  const idx = safeJsonParse(await env.BOOKINGS.get('booking_links_idx'));
  const li = idx.find(l => l.token === token);
  if (li) { li.status = 'confirmed'; li.confirmedAt = link.confirmedAt; }
  await env.BOOKINGS.put('booking_links_idx', JSON.stringify(idx));

  // Send emails
  const origin = new URL(request.url).origin;
  const guestPortalUrl = `${origin}/guest.html?id=${enqId}&p=ta-garden`;
  const dateRange = checkIn && checkOut ? `${fmt(checkIn)} → ${fmt(checkOut)}` : (checkIn ? `From ${fmt(checkIn)} (ongoing)` : 'TBD');
  const nights = (checkIn && checkOut) ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000) : 0;
  const months = link.stayType === 'monthly' ? (Math.round((nights / 30) * 10) / 10) : null;
  const totalStr = price ? `$${price.total}` : 'Monthly';
  const depositStr = `$${deposit}`;
  const effectiveStripe = link.stripeUrl || 'https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02';

  const guestHtml = buildDirectBookingGuestEmail({ name, room: link.room, stayType: link.stayType, checkIn, checkOut, dateRange, price, deposit, totalStr, depositStr, stripeUrl: effectiveStripe, guestPortalUrl });
  const adminHtml = buildDirectBookingAdminEmail({ name, email, phone, room: link.room, stayType: link.stayType, dateRange, price, deposit, totalStr, depositStr, signature, enqId });

  const contractRates = { rentUsd: link.rentUsd || rates?.monthly || null, rentVnd: link.rentVnd || null, depositAmount: link.depositAmount || deposit || null };
  const contractEnq = { name, email, phone: phone || '', room: link.room, stayType: link.stayType, checkIn, checkOut: checkOut || null, signature, rentUsd: contractRates.rentUsd, rentVnd: contractRates.rentVnd, depositAmount: contractRates.depositAmount };
  const contractHtml = buildContractEmail(contractEnq, contractRates);

  const emailWork = (async () => {
    await env.BOOKINGS.put(`contract_${enqId}`, contractHtml);
    await appendLog(env, enqId, { type: 'booking_confirmed', note: `Guest completed booking form (link token: ${token})` });
    await sendAndLog(env, enqId, 'confirmation_email', email, `Booking Confirmed — ${link.room} at Ta.Garden`, guestHtml, null);
    await sendAndLog(env, enqId, 'contract_email', email, `Your Ta.Garden Rental Agreement — ${link.room}`, contractHtml, null);
    await Promise.all(TO_EMAILS.map(to => resend(FROM, to, `Direct Booking Confirmed — ${link.room} (${name})`, adminHtml, email, env)));
  })().catch(err => console.error('Booking link email error:', err));
  if (ctx?.waitUntil) ctx.waitUntil(emailWork);

  return Response.json({ success: true, enqId, message: 'Booking confirmed! Check your email for next steps.' }, { headers: cors });
}

// ── Admin: direct booking (email-first, no link required) ────────────────────

async function adminDirectBooking(request, env, cors, ctx) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const {
    room, stayType = 'monthly', guestName, guestEmail, guestPhone = '',
    checkIn, checkOut, rentUsd, rentVnd, depositAmount, stripeUrl, notes = '',
  } = await request.json();

  if (!room || !guestName || !guestEmail || !checkIn) {
    return Response.json({ error: 'room, guestName, guestEmail, and checkIn are required' }, { status: 400, headers: cors });
  }

  const rates = ROOM_RATES[room] || {};
  const effectiveRentUsd = rentUsd ? Number(rentUsd) : (rates.monthly || null);
  const effectiveRentVnd = rentVnd ? Number(rentVnd) : null;
  const effectiveDeposit = depositAmount ? Number(depositAmount) : effectiveRentUsd;
  const effectiveStripe  = stripeUrl || 'https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02';

  const enqId = `enq_${Date.now()}`;
  const key   = enquiriesKey('ta-garden');
  const enquiries = safeJsonParse(await env.BOOKINGS.get(key));

  const enq = {
    id: enqId, propertyId: 'ta-garden',
    name: guestName, email: guestEmail, phone: guestPhone,
    room, stayType, checkIn, checkOut: checkOut || null,
    message: notes || 'Direct booking created by admin.',
    price: effectiveRentUsd,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    onboarding: { paymentReceived: false, contractSigned: false, passportUploaded: false, visaUploaded: false },
    rentUsd: effectiveRentUsd,
    rentVnd: effectiveRentVnd,
    depositAmount: effectiveDeposit,
    stripeUrl: effectiveStripe,
    directBooking: true,
  };

  enquiries.unshift(enq);
  await env.BOOKINGS.put(key, JSON.stringify(enquiries.slice(0, 200)));
  await env.BOOKINGS.put(`enq_idx_${enqId}`, 'ta-garden');

  // Block calendar dates
  const blocked = safeJsonParse(await env.BOOKINGS.get(blockedKey('ta-garden')));
  blocked.push({ start: checkIn, end: checkOut || null, label: `${guestName} — ${room}`, enqId });
  await env.BOOKINGS.put(blockedKey('ta-garden'), JSON.stringify(blocked));

  // Build and send emails
  const origin = new URL(request.url).origin;
  const guestPortalUrl = `${origin}/guest.html?id=${enqId}&p=ta-garden`;
  const dateRange = checkIn && checkOut ? `${fmt(checkIn)} → ${fmt(checkOut)}` : (checkIn ? `From ${fmt(checkIn)} (ongoing)` : 'TBD');
  const depositStr = `$${effectiveDeposit || effectiveRentUsd || '?'}`;
  const totalStr   = stayType === 'monthly' ? 'Monthly' : depositStr;
  const price      = calcPrice(room, stayType, checkIn, checkOut);

  const guestHtml  = buildDirectBookingGuestEmail({ name: guestName, room, stayType, checkIn, checkOut, dateRange, price, deposit: effectiveDeposit, totalStr, depositStr, stripeUrl: effectiveStripe, guestPortalUrl });
  const adminHtml  = buildDirectBookingAdminEmail({ name: guestName, email: guestEmail, phone: guestPhone, room, stayType, dateRange, price, deposit: effectiveDeposit, totalStr, depositStr, signature: guestName, enqId });
  const contractRates = { rentUsd: effectiveRentUsd, rentVnd: effectiveRentVnd, depositAmount: effectiveDeposit };
  const contractHtml  = room === 'First Floor Room'
    ? buildColtContractEmail({ ...enq, signature: guestName })
    : buildContractEmail({ ...enq, signature: guestName }, contractRates);

  const emailWork = (async () => {
    await env.BOOKINGS.put(`contract_${enqId}`, contractHtml);
    await appendLog(env, enqId, { type: 'booking_confirmed', note: 'Direct booking created by admin (email-first flow). Contract saved — not yet sent.' });
    await sendAndLog(env, enqId, 'confirmation_email', guestEmail, `Booking Confirmed — ${room} at Ta.Garden`, guestHtml, null);
    await Promise.all(TO_EMAILS.map(to => resend(FROM, to, `New Direct Booking — ${room} (${guestName})`, adminHtml, guestEmail, env)));
  })().catch(err => console.error('Direct booking email error:', err));
  if (ctx?.waitUntil) ctx.waitUntil(emailWork);

  return Response.json({ success: true, enqId, message: `Booking confirmed. Confirmation sent to ${guestEmail}. Send the contract manually once deposit is received.` }, { headers: cors });
}

// ── Email builders ────────────────────────────────────────────────────────────

function buildAdminEmail({ name, email, phone, room, stayType, stayLabel, dateInfo, checkIn, checkOut, message, price }) {
  const waBtn = phone
    ? `<a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="display:inline-block;padding:14px 24px;background:#25D366;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">WhatsApp ${name.split(' ')[0]}</a>&nbsp;`
    : '';

  const priceBlock = price ? `
<tr>
  <td style="background:#1a1a18;padding:0 0 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:18px 24px;vertical-align:middle;">
          <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;font-family:Arial,sans-serif;">Estimated Value</div>
          <div style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#ede0d1;">$${price.total.toLocaleString()}</div>
          <div style="font-size:12px;color:rgba(237,224,209,0.5);margin-top:4px;font-family:Arial,sans-serif;">${price.breakdown} &nbsp;·&nbsp; ${price.duration}</div>
        </td>
        <td style="padding:18px 24px;vertical-align:middle;text-align:right;">
          <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;font-family:Arial,sans-serif;">Rate</div>
          <div style="font-size:16px;color:#ede0d1;font-family:Arial,sans-serif;">${price.rate}</div>
        </td>
      </tr>
    </table>
  </td>
</tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Georgia,serif;}
@media only screen and (max-width:600px){
  .w600{width:100%!important;}
  .pad{padding:20px!important;}
  .price-right{display:none!important;}
  .btn{width:100%!important;display:block!important;text-align:center!important;margin-bottom:8px!important;}
}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e0d5;padding:20px 0;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a18;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:middle;">
            <div style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
            <div style="font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:#86a2a6;margin-top:3px;font-family:Arial,sans-serif;">New Booking Enquiry</div>
          </td>
          <td style="vertical-align:middle;text-align:right;">
            <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(237,224,209,0.35);font-family:Arial,sans-serif;">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  ${priceBlock}

  <!-- Body -->
  <tr>
    <td class="pad" style="padding:28px;background:#f5f0eb;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#1a1a18;margin-bottom:4px;">${room}</div>
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#a0856c;margin-bottom:20px;font-family:Arial,sans-serif;">${stayLabel}</div>

      <!-- Guest details table -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
        <tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;width:120px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">Guest</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">${name}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">Email</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;"><a href="mailto:${email}" style="color:#a0856c;text-decoration:none;">${email}</a></td>
        </tr>
        ${phone ? `<tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">WhatsApp</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;"><a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="color:#25D366;text-decoration:none;">${phone}</a></td>
        </tr>` : ''}
        <tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">Check-in</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">${fmt(checkIn)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">Check-out</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-family:Arial,sans-serif;">${checkOut ? fmt(checkOut) : '—'}</td>
        </tr>
        ${price ? `<tr>
          <td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;">Duration</td>
          <td style="padding:10px 0;font-size:14px;font-family:Arial,sans-serif;">${price.duration}</td>
        </tr>` : ''}
      </table>

      <!-- Message block -->
      <div style="background:#fff;border:1px solid rgba(160,133,108,0.3);border-left:4px solid #a0856c;padding:18px 20px;margin-bottom:20px;">
        <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;margin-bottom:10px;font-family:Arial,sans-serif;">Message from Guest</div>
        <div style="font-size:15px;line-height:1.8;color:#1a1a18;font-family:Arial,sans-serif;font-style:${message ? 'normal' : 'italic'};">${message || 'No message provided.'}</div>
      </div>

      <!-- CTA buttons -->
      ${waBtn}<a href="mailto:${email}?subject=Re: ${encodeURIComponent(room)}" style="display:inline-block;padding:14px 24px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Email ${name.split(' ')[0]}</a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1a1a18;padding:16px 24px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);font-family:Arial,sans-serif;">Questions? hi@soulandlunawellness.com</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildConfirmEmail(enq, customMessage, origin, propertyId, rates = {}) {
  const guestPortalUrl = origin ? `${origin}/guest.html?id=${enq.id}&p=${propertyId || 'ta-garden'}` : null;
  const price = calcPrice(enq.room, enq.stayType, enq.checkIn, enq.checkOut);
  const effectiveRentUsd = rates.rentUsd || ROOM_RATES[enq.room]?.monthly;
  const effectiveDeposit = rates.depositAmount || effectiveRentUsd;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Georgia,serif;}
@media only screen and (max-width:600px){
  .w600{width:100%!important;}
  .pad{padding:20px!important;}
  .stack-cell{display:block!important;width:100%!important;text-align:left!important;}
  .btn{display:block!important;text-align:center!important;margin-bottom:10px!important;}
}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e0d5;padding:20px 0;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a18;padding:28px 32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;font-family:Arial,sans-serif;">Booking Confirmed</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td class="pad" style="padding:32px;background:#f5f0eb;">
      <p style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;margin:0 0 20px;">Your booking is confirmed, ${enq.name.split(' ')[0]}.</p>

      <!-- Room + price card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid rgba(136,145,125,0.2);margin-bottom:24px;">
        <tr>
          <td class="stack-cell" style="padding:20px;vertical-align:top;">
            <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:4px;font-family:Arial,sans-serif;">Room</div>
            <div style="font-size:16px;font-family:Georgia,serif;">${enq.room}</div>
          </td>
          ${price ? `<td class="stack-cell" style="padding:20px;vertical-align:top;text-align:right;border-left:1px solid rgba(136,145,125,0.15);">
            <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:4px;font-family:Arial,sans-serif;">Estimated Total</div>
            <div style="font-size:24px;font-family:Georgia,serif;font-weight:300;">$${price.total.toLocaleString()}</div>
            <div style="font-size:11px;color:#88917d;font-family:Arial,sans-serif;">${price.breakdown}</div>
          </td>` : ''}
        </tr>
        <tr>
          <td colspan="2" style="border-top:1px solid rgba(136,145,125,0.15);padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:14px 20px;vertical-align:top;">
                  <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;margin-bottom:3px;font-family:Arial,sans-serif;">Check-in</div>
                  <div style="font-size:14px;font-family:Arial,sans-serif;">${fmt(enq.checkIn)}</div>
                </td>
                <td style="padding:14px 20px;vertical-align:top;border-left:1px solid rgba(136,145,125,0.15);">
                  <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;margin-bottom:3px;font-family:Arial,sans-serif;">Check-out</div>
                  <div style="font-size:14px;font-family:Arial,sans-serif;">${enq.checkOut ? fmt(enq.checkOut) : 'Ongoing'}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${effectiveRentUsd ? (() => { const firstMonthTotal = (effectiveRentUsd || 0) + (effectiveDeposit || 0); return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid rgba(136,145,125,0.2);margin-bottom:24px;">
  <tr>
    <td style="padding:14px 20px;border-bottom:1px solid rgba(136,145,125,0.15);">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;">Monthly Rent</td>
        <td style="text-align:right;font-size:14px;font-family:Georgia,serif;">$${effectiveRentUsd}${rates.rentVnd ? ` / ${Number(rates.rentVnd).toLocaleString()} VND` : ''}</td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:14px 20px;border-bottom:1px solid rgba(136,145,125,0.15);">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;">Security Deposit</td>
        <td style="text-align:right;font-size:14px;font-family:Georgia,serif;">$${effectiveDeposit} <span style="font-size:11px;color:#88917d;">(fully refunded on departure)</span></td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:14px 20px;background:#f5f0eb;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#1a1a18;font-family:Arial,sans-serif;font-weight:bold;">Total Due to Move In</td>
        <td style="text-align:right;font-size:18px;font-family:Georgia,serif;color:#1a1a18;">$${firstMonthTotal.toLocaleString()}</td>
      </tr></table>
      <div style="font-size:11px;color:#88917d;font-family:Arial,sans-serif;text-align:right;margin-top:3px;">First month's rent + security deposit</div>
    </td>
  </tr>
</table>`; })() : ''}

      ${customMessage ? `<div style="padding:16px;background:#fff;border-left:3px solid #86a2a6;margin-bottom:24px;font-size:14px;line-height:1.8;color:#1a1a18;font-family:Arial,sans-serif;">${customMessage.replace(/\n/g,'<br>')}</div>` : ''}

      <!-- Next steps -->
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#88917d;margin-bottom:12px;font-family:Arial,sans-serif;">Next Steps</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        ${[
          effectiveRentUsd ? `Pay your first month's rent ($${effectiveRentUsd}) + security deposit ($${effectiveDeposit}) to secure your room. Your deposit is fully refunded when you leave.` : 'Complete your first month\'s payment to secure your room.',
          'Review and sign the Ta.Garden House Agreement (sent separately once your payment is confirmed)',
          'Complete your guest profile — upload passport photo and visa details via your personal link below',
          'We\'ll confirm check-in details closer to your arrival date',
        ].map((step, i) => `<tr>
          <td width="36" style="padding:0 12px 10px 0;vertical-align:top;">
            <div style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:4px 8px;font-family:Arial,sans-serif;white-space:nowrap;">0${i+1}</div>
          </td>
          <td style="padding-bottom:10px;font-size:14px;line-height:1.6;color:#1a1a18;font-family:Arial,sans-serif;vertical-align:top;">${step}</td>
        </tr>`).join('')}
      </table>

      <!-- Location -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid rgba(136,145,125,0.2);margin-bottom:24px;">
        <tr>
          <td style="padding:16px 20px;border-bottom:1px solid rgba(136,145,125,0.15);">
            <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;">How to Find Us</div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 20px;">
            <div style="font-size:13px;color:#1a1a18;font-family:Arial,sans-serif;line-height:1.7;margin-bottom:10px;">
              <strong>K570/24</strong><br>
              Thành phố Đà Nẵng, Phường Hội An<br>
              Cam Nam Island, Vietnam
            </div>
            <div style="font-size:11px;color:#88917d;font-family:Arial,sans-serif;margin-bottom:4px;">GPS coordinates (recommended — Google Maps cannot find the street address directly):</div>
            <div style="font-size:13px;color:#1a1a18;font-family:Georgia,serif;margin-bottom:12px;">15.867740, 108.355771</div>
            <a href="https://goo.gl/maps/78FMqsqrDY1dFiAE8" style="display:inline-block;padding:10px 20px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;">Open in Google Maps →</a>
          </td>
        </tr>
      </table>

      <!-- Buttons -->
      ${guestPortalUrl ? `<a href="${guestPortalUrl}" class="btn" style="display:block;text-align:center;padding:16px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:10px;font-family:Arial,sans-serif;">Complete Guest Profile →</a>` : ''}
      ${effectiveDeposit ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;"><tr>
        <td style="padding:0 5px 0 0;">
          <a href="${enq.stripeUrl || STRIPE_USD}" style="display:block;text-align:center;padding:15px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Pay in USD${effectiveDeposit ? ` — $${effectiveDeposit}` : ''} →</a>
        </td>
        <td style="padding:0 0 0 5px;">
          <a href="${STRIPE_VND}" style="display:block;text-align:center;padding:15px;background:#2d5a27;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Pay in VND →</a>
        </td>
      </tr></table>` : ''}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1a1a18;padding:16px 32px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);font-family:Arial,sans-serif;">Questions? hi@soulandlunawellness.com</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function buildColtContractEmail(enq, effectiveDate) {
  const today = effectiveDate || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const sig = enq.signature || enq.name || 'Colt';
  const li = (text) => `<li style="margin-bottom:6px;">${text}</li>`;
  const h2 = (text) => `<h2 style="font-size:16px;color:#2d5a27;margin:24px 0 8px;padding-bottom:6px;border-bottom:2px solid #2d5a27;font-family:Arial,sans-serif;">${text}</h2>`;
  const p = (text, style='') => `<p style="font-size:13px;color:#3a3a2a;line-height:1.7;margin:0 0 10px;font-family:Arial,sans-serif;${style}">${text}</p>`;
  const ul = (items) => `<ul style="font-size:13px;color:#3a3a2a;line-height:1.7;margin:0 0 14px;padding-left:20px;font-family:Arial,sans-serif;">${items.map(li).join('')}</ul>`;
  const note = (text) => `<p style="font-size:12px;color:#88917d;line-height:1.6;margin:0 0 14px;font-style:italic;font-family:Arial,sans-serif;">${text}</p>`;
  const tableRow = (col1, col2) => `<tr><td style="padding:8px 12px;border:1px solid #c8d5c8;font-size:13px;color:#3a3a2a;font-family:Arial,sans-serif;background:#f5fbf5;">${col1}</td><td style="padding:8px 12px;border:1px solid #c8d5c8;font-size:13px;color:#3a3a2a;font-family:Arial,sans-serif;">${col2}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Arial,sans-serif;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="640" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:8px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="background:#2d5a27;padding:28px 36px;text-align:center;" class="pad">
    <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;color:#fff;letter-spacing:0.05em;">CONTRACT 1: GARDEN &amp; LANDSCAPING SERVICES</p>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);font-style:italic;">Independent Contractor Agreement</p>
    <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Effective Date: ${today}</p>
    <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Between: Soul &amp; Luna Wellness ("Employers") and Colt ("Contractor/Resident")</p>
  </td></tr>

  <tr><td style="padding:32px 36px;" class="pad">

    ${h2('1. Scope of Work')}
    ${p('The garden design and plan has been created by the Employers (Soul &amp; Luna Wellness). Colt\'s role is to execute that design as directed. Colt must not deviate from the Employers\' brief without written approval. The design has been developed with the following principles in mind: low maintenance, easy to clean, durable, cost-effective over time, incorporating existing trees and natural elements, and using materials such as bricks where appropriate. Execution responsibilities include:')}
    ${ul([
      'Receive and review the Employers\' garden brief before any work begins',
      'Confirm garden area measurements on-site and report to Employers within 3 days of contract signing',
      'Source and purchase all plants, seeds, soil, bricks, and materials as specified in the brief — no substitutions without written Employer approval',
      'Plant and establish the garden strictly according to the Employers\' design and layout — working around existing trees and incorporating specified materials',
      'Build any hardscape elements (paths, borders, brick edging) as directed by the Employers\' brief',
      'Ongoing watering, weeding, pruning, and general garden maintenance throughout the contract period',
      'Watering all plants in the common areas (living room, staircase, shelves) and the front yard on a regular basis — plants must be kept healthy and presentable at all times',
      'Keep all garden areas tidy and presentable at all times — guest-ready standard applies',
      'Send a weekly video update every Sunday, and immediately if any issue or concern arises',
    ])}

    ${h2('2. Timeline &amp; Completion')}
    ${p('The Employers will be absent from the property for approximately 2 months. The following milestones apply:')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      ${tableRow('Employer garden brief shared with Colt', 'Before contract signing')}
      ${tableRow('Garden measurements confirmed on-site', 'Within 3 days of contract signing')}
      ${tableRow('Materials sourced', 'Within 1 week of contract signing')}
      ${tableRow('Garden planted &amp; established', 'By end of Month 1 of absence')}
      ${tableRow('Weekly video update sent to Employers', 'Every Sunday (or immediately if issue arises)')}
      ${tableRow('Full deep clean coordinated with cleaning crew', 'No later than 1 week before Employers\' return')}
      ${tableRow('Final garden handover &amp; review', 'Upon Employers\' return (approx. 2 months)')}
    </table>

    ${h2('3. Compensation')}
    ${p('Payment terms for this contract are as follows:')}
    ${ul([
      'Residency Rate: 5,000,000 VND per month, paid on the 1st of each month by cash or bank transfer. This discounted rate reflects the 3,000,000 VND monthly subsidy extended by the Employers (market rate: 8,000,000 VND) as compensation for standard caretaking duties including cleaning coordination, guest check-ins, and day-to-day property oversight.',
      'Electricity: Not included in the monthly rent. Colt is responsible for his own electricity usage. A separate meter will be installed in Colt\'s room prior to the Employers\' departure. Colt will pay for his electricity usage directly based on meter readings.',
      'Garden Completion Bonus: 1,500,000 VND, paid upon the Employers\' return and satisfactory sign-off on the completed garden. This bonus is conditional on the garden being fully planted, maintained, and presented to Employers\' standard at time of review. It will not be paid if the garden is incomplete or below standard.',
      'Material Expenses: Garden materials and minor repair supplies will be reimbursed with receipts. Maximum 200,000 VND per individual purchase without prior written Employer approval. Any expense above this amount requires approval via text before purchase.',
    ])}
    ${note('Note: If garden work is not commenced or milestones are missed without communication, the garden completion bonus may be withheld in full or in part at the Employers\' discretion.')}

    ${h2('4. Standards &amp; Expectations')}
    ${ul([
      'All garden work must be completed to the standard described in the Employers\' brief — built to last, easy to maintain, and aesthetically aligned with the property',
      'Do not begin additional purchases or scope changes without written Employer approval',
      'Weekly video updates to be sent every Sunday. Additional photo or video updates required immediately if anything is out of the ordinary',
      'Any issues must be reported to Employers promptly — do not attempt to resolve problems silently or without communication',
    ])}

    ${h2('4b. Property Management &amp; Repairs')}
    ${p('In addition to garden duties, Colt is responsible for general property management during the Employers\' absence. This is a guest-facing boutique property and business — the property must be guest-ready at all times. Responsibilities include:')}
    ${ul([
      'Keeping all common areas, kitchen, bathrooms, staircase, entrance, and outdoor spaces clean and presentable at all times',
      'Coordinating with the professional cleaning crew for all standardised cleans — Colt is not expected to perform deep or standardised cleans himself, but must arrange and be present for them',
      'Identifying and managing minor repairs promptly — photograph and document before and after',
      'Reporting any major repairs or damage to Employers immediately with photos — no major work to be authorised without explicit Employer approval',
      'Welcoming guests on arrival, ensuring their room is clean and ready, and communicating any guest concerns to Employers within 2 hours',
      'Coordinating a full professional deep clean no later than one week before the Employers\' return',
    ])}
    ${note('Note: Standardised and deep cleans are carried out by the professional cleaning crew. Colt\'s role is to coordinate, facilitate access, and maintain the property at a guest-ready standard between cleans.')}

    ${h2('5. Termination')}
    ${p('Either party may terminate this contract with 7 days written notice. If Colt fails to perform duties without communication for more than 5 consecutive days, the contract is considered abandoned and the garden completion bonus will be forfeited.')}

    <!-- Contract 1 Signatures -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #2d5a27;padding-top:20px;margin:20px 0 40px;">
      <tr>
        <td style="width:50%;padding-right:16px;vertical-align:top;">
          <p style="margin:0 0 6px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;font-family:Arial,sans-serif;">Employer Signature — Soul &amp; Luna Wellness</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:15px;font-style:italic;color:#3a3a2a;">Kai Edwards</p>
          <p style="margin:0;font-size:11px;color:#88917d;font-family:Arial,sans-serif;">Date: ${today}</p>
        </td>
        <td style="width:50%;padding-left:16px;vertical-align:top;border-left:1px solid #ddd5c8;">
          <p style="margin:0 0 6px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;font-family:Arial,sans-serif;">Colt — Resident / Contractor Signature</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:15px;font-style:italic;color:#3a3a2a;">${sig}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#88917d;font-family:Arial,sans-serif;">Electronically signed · Date: ${today}</p>
        </td>
      </tr>
    </table>

    <!-- CONTRACT 2 HEADER -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -36px;width:calc(100% + 72px);">
      <tr><td style="background:#2d5a27;padding:24px 36px;text-align:center;">
        <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:20px;color:#fff;letter-spacing:0.05em;">CONTRACT 2: HOUSE RESIDENCY AGREEMENT</p>
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);font-style:italic;">Rules of Conduct &amp; Standards of Living</p>
        <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Effective Date: ${today} &nbsp;·&nbsp; Between: Soul &amp; Luna Wellness ("Employers") and Colt ("Contractor/Resident")</p>
      </td></tr>
    </table>
    <br>

    ${p('This agreement outlines the conditions under which Colt is permitted to reside at Ta.Garden. Residency is a privilege, not a right, and is contingent on continued compliance with all terms below.')}

    ${h2('1. Appearance &amp; Personal Standards')}
    ${ul([
      'Professional or neat clothing must be worn at all times within shared areas of the house',
      'Deodorant must be used daily — this is a non-negotiable condition of residency',
      'Personal hygiene standards appropriate to a shared living and guest-hosting environment must be maintained at all times',
    ])}

    ${h2('2. Smoking Policy')}
    ${ul([
      'Smoking is strictly prohibited inside the house at all times',
      'Smoking is prohibited in the front of the property or any area visible to guests or neighbours',
      'Smoking is only permitted in the designated backyard area',
      'Cigarette butts must be disposed of properly — no littering in the garden or yard',
    ])}

    ${h2('3. Cleanliness &amp; House Standards')}
    ${ul([
      'The house must be kept clean at all times, including common areas, kitchen, bathrooms, and any areas used by guests',
      'Dishes must be washed and put away within 24 hours of use',
      'Floors, surfaces, and bathrooms must be cleaned at minimum once per week between professional cleans',
      'Rubbish must be taken out the night before each collection day and must not be allowed to build up inside the property. Collection days are Tuesday, Thursday, Saturday, and Sunday — bins should be put out Monday, Wednesday, Friday, and Saturday evenings respectively',
      'Personal belongings must be kept tidy and contained to agreed personal space — no personal items left in guest or common areas',
      'All indoor plants in common areas (living room, staircase, shelves) and plants in the front yard must be watered regularly — plants must remain healthy and well-presented at all times. Wilting or neglected plants are considered a failure of property standards',
      'Standardised cleans are carried out by the professional cleaning crew on a set schedule — Colt must coordinate with the crew and facilitate access',
    ])}
    ${note('Note: Failure to maintain cleanliness standards between professional cleans, or failure to coordinate the cleaning crew, is grounds for termination of this agreement.')}

    ${h2('4. Guest Relations')}
    ${ul([
      'Guests staying at the property are to be treated with warmth, courtesy, and professionalism at all times',
      'Colt is expected to check in on guests periodically to ensure they have everything they need — politely, not intrusively',
      'Any guest complaints or issues must be communicated to the Employers immediately, within 2 hours of becoming aware',
      'Colt\'s personal conduct around guests must reflect positively on the property and the Soul &amp; Luna Wellness brand at all times',
    ])}

    ${h2('5. Wellness Requirement')}
    ${ul([
      'Colt is required to attend at least one (1) breathwork session per week for the duration of this agreement',
      'The Employers will arrange for a breathwork practitioner to come to the property and will cover the cost of these sessions — Colt\'s responsibility is to attend consistently',
      'Confirmation of attendance must be shared with Employers as part of the weekly Sunday video update',
      'If sessions are cancelled or unavailable in any given week, Colt must notify Employers and seek an alternative arrangement',
    ])}
    ${p('This requirement exists in support of Colt\'s wellbeing and is a condition of continued residency.')}

    ${h2('6. Communication')}
    ${ul([
      'Colt must be reachable by phone and text and must respond to Employer messages within 12 hours',
      'A weekly video update must be sent to Employers every Sunday covering: garden status, house cleanliness, guest updates, breathwork attendance, and any issues or concerns',
      'Additional photo or video updates are required immediately if anything is out of the ordinary — do not wait for Sunday if something needs attention',
      'Any issues with the property, guests, or personal circumstances must be communicated promptly — no surprises',
    ])}

    ${h2('7. Term &amp; Termination — Trial Period')}
    ${p('This agreement is in effect for the duration of the Employers\' absence (approximately 2 months).')}
    ${p('<strong>This is a formal trial period.</strong> Upon the Employers\' return, performance across all areas of this agreement will be reviewed. Renewal is not automatic — it is contingent on the Employers\' satisfaction with Colt\'s conduct, cleanliness, garden completion, property management, guest relations, son\'s conduct, and overall suitability as a resident and caretaker. Both parties acknowledge and accept this trial structure.')}
    ${p('Colt\'s residency may be terminated immediately, without notice, for any of the following:')}
    ${ul([
      'Smoking inside the house or in any area visible to guests or neighbours',
      'Failure to maintain cleanliness standards or coordinate professional cleans after one written warning',
      'Failure to attend breathwork sessions for 2 or more consecutive weeks without communication',
      'Misconduct toward guests or failure to maintain professionalism in a guest-facing context',
      'Failure to maintain personal hygiene or appearance standards after one written warning',
      'Any conduct toward guests or neighbours that is disrespectful, disruptive, or results in a formal complaint',
      'Using Ta.Garden as a social venue or gathering space, including allowing underage groups to congregate at the property',
      'Any conduct by Colt or his son that deters guests, damages the property\'s reputation, or results in a negative guest review attributable to Colt\'s actions or negligence',
      'Failure to fulfil property management, garden, or communication duties without reasonable explanation',
    ])}
    ${p('Upon termination, Colt will have 48 hours to vacate the property unless otherwise agreed.')}

    ${h2('8. Conduct, Neighbour Relations &amp; Guest Experience')}
    ${p('Ta.Garden is a guest-facing wellness property and a business. Colt\'s conduct at all times must reflect this:')}
    ${ul([
      'Colt must conduct himself in a respectful, professional, and courteous manner at all times — inside the home, in the yard, on the street, and in any interaction visible to guests or neighbours',
      'Colt must not engage in any behaviour that would make a guest feel uncomfortable, unsafe, or unwelcome — including loud arguments, aggressive conduct, or any behaviour unbecoming of a caretaker',
      'Colt must not engage in any activity that disturbs or creates conflict with neighbouring households — noise complaints or disputes are grounds for immediate termination',
      'Nothing in or around the property may be stored, displayed, or left in a state that deters guests or reflects poorly on the brand — this includes personal items, vehicles, tools, and outdoor spaces',
      'Quiet hours are 10:00pm to 7:00am — music, loud conversation, and audible activities must cease by 10:00pm without exception',
    ])}

    ${h2('9. Colt\'s Son — Conduct &amp; Visitor Policy')}
    ${p('Colt\'s son is permitted to reside at the property under the following conditions. Colt is fully responsible for his son\'s conduct at all times:')}
    ${ul([
      'Colt\'s son must be respectful and courteous to all guests and neighbours — rude, disruptive, or inappropriate behaviour is a serious breach of this agreement',
      'Quiet hours apply equally to Colt\'s son — no noise, running, shouting, or activity in shared or external areas after 10:00pm',
      'Ta.Garden is not to be used as a social venue for underage visitors. Colt\'s son may have one friend visit at a time with prior notice — groups, sleepovers, and regular underage gatherings are not permitted',
      'Colt\'s son\'s visitors are not permitted in guest areas or rooms without explicit Employer permission',
      'Any guest or neighbour complaint regarding Colt\'s son\'s conduct must be addressed immediately. A second complaint is grounds for review and may result in termination',
    ])}
    ${note('Note: Colt\'s son\'s presence at Ta.Garden is a privilege extended in good faith. Any pattern of disrespect, nuisance to guests, or use of the property as a social hangout will result in this privilege being reviewed or withdrawn.')}

    ${p('By signing below, Colt acknowledges having read, understood, and agreed to all conditions of residency at Ta.Garden.', 'font-style:italic;')}

    <!-- Contract 2 Signatures -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #2d5a27;padding-top:20px;margin-top:16px;">
      <tr>
        <td style="width:50%;padding-right:16px;vertical-align:top;">
          <p style="margin:0 0 6px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;font-family:Arial,sans-serif;">Employer Signature — Soul &amp; Luna Wellness</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:15px;font-style:italic;color:#3a3a2a;">Kai Edwards</p>
          <p style="margin:0;font-size:11px;color:#88917d;font-family:Arial,sans-serif;">Date: ${today}</p>
        </td>
        <td style="width:50%;padding-left:16px;vertical-align:top;border-left:1px solid #ddd5c8;">
          <p style="margin:0 0 6px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;font-family:Arial,sans-serif;">Colt — Resident / Contractor Signature</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:15px;font-style:italic;color:#3a3a2a;">${sig}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#88917d;font-family:Arial,sans-serif;">Electronically signed · Date: ${today}</p>
        </td>
      </tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#2d5a27;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.6);letter-spacing:0.1em;font-family:Arial,sans-serif;">Ta.Garden · Cam Nam Island · Hội An, Vietnam · ta-garden.soulandlunawellness.com</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildContractEmail(enq, rates = {}) {
  const rentUsd = rates.rentUsd || ROOM_RATES[enq.room]?.monthly || '___';
  const rentVnd = rates.rentVnd || '___';
  const deposit = rates.depositAmount || rentUsd;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const startDate = enq.checkIn ? fmt(enq.checkIn) : '___';
  const dueDay = enq.checkIn ? new Date(enq.checkIn + 'T00:00:00Z').getUTCDate() : null;
  const dueDayStr = dueDay ? `the ${ordinal(dueDay)} of each month` : 'the same day of each month as the tenancy start date';
  const sig = enq.signature || enq.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Arial,sans-serif;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#3a3a2a;padding:24px 32px;text-align:center;" class="pad">
    <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:20px;color:#c8b89a;letter-spacing:0.05em;">Ta.Garden</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#88917d;letter-spacing:0.2em;text-transform:uppercase;">Monthly Room Rental Agreement</p>
  </td></tr>
  <tr><td style="padding:32px;" class="pad">
    <p style="margin:0 0 6px;font-size:11px;color:#88917d;letter-spacing:0.12em;text-transform:uppercase;">A Soul &amp; Luna Property · Cam Nam Island, Hội An, Vietnam</p>
    <p style="margin:0 0 24px;font-size:11px;color:#88917d;">ta-garden.soulandlunawellness.com</p>

    <p style="margin:0 0 16px;font-size:14px;color:#3a3a2a;line-height:1.7;">This Monthly Room Rental Agreement is entered into between:</p>
    <p style="margin:0 0 6px;font-size:14px;color:#3a3a2a;"><strong>Landlord:</strong> Kai Edwards / Soul &amp; Luna Wellness</p>
    <p style="margin:0 0 24px;font-size:14px;color:#3a3a2a;"><strong>Tenant:</strong> ${enq.name}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd5c8;border-radius:6px;margin-bottom:24px;">
      ${[
        ['Tenant Full Name', enq.name],
        ['Email Address', enq.email],
        ['WhatsApp / Phone', enq.phone || '—'],
        ['Room', enq.room],
        ['Monthly Rent (USD)', `$${rentUsd}`],
        ['Monthly Rent (VND)', rentVnd !== '___' ? `${Number(rentVnd).toLocaleString()} VND` : '—'],
        ['Security Deposit', `$${deposit} (1 month's rent)`],
        ['Tenancy Start Date', startDate],
        ['Minimum Term', '1 month — renewable monthly'],
        ['Notice to Vacate', '15 days written notice required'],
      ].map((row, i, arr) => `<tr>
        <td style="padding:12px 16px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;width:45%;${i < arr.length-1 ? 'border-bottom:1px solid #e8e0d5;' : ''}">${row[0]}</td>
        <td style="padding:12px 16px;font-size:14px;color:#3a3a2a;${i < arr.length-1 ? 'border-bottom:1px solid #e8e0d5;' : ''}">${row[1]}</td>
      </tr>`).join('')}
    </table>

    ${[
      '1. PREMISES',
      'The Landlord agrees to rent to the Tenant the room described above, located at the property known as Ta.Garden, K570/24, Cam Nam Island, Hội An, Vietnam (the "Property"). The Tenant shall have access to shared common areas including kitchen, bathrooms, and outdoor spaces as designated by the Landlord.',
    ].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${[
      '2. TERM',
      `2.1 Commencement — The tenancy commences on ${startDate} on a month-to-month basis, renewable each month unless notice is given.`,
      '2.2 Renewal — The tenancy renews automatically each month unless either party provides 15 days written notice of termination prior to the renewal date.',
    ].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${['3. PAYMENT TERMS','3.1 Payment Method — All rent is paid monthly in advance via the Ta.Garden Guest Portal. Accepted methods: bank transfer or card via the portal.',`3.2 Due Date — Rent is due on ${dueDayStr} (matching the tenancy start date). A 3-day grace period applies. Payments more than 3 days late incur a 5% late fee.`,'3.3 Security Deposit — A security deposit equal to one (1) month\'s rent is held against damage, unpaid rent, or early departure. Returned within 14 days of move-out, less deductions.','3.4 Utilities — Electricity and water are metered and billed at the end of each calendar month based on actual usage. Utility charges are invoiced via the Ta.Garden Guest Portal and are due within 5 days of invoice. WiFi is included in the monthly rent.'].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${['4. HOUSE RULES','4.1 Guests — Overnight guests require prior approval. Maximum 1 overnight guest. Guest stays exceeding 3 consecutive nights require written consent.','4.2 Noise — Quiet hours are 10pm–7am. Loud music, parties, or disruptive behaviour is grounds for immediate termination.','4.3 Common Areas — Shared spaces to be kept clean and tidy. Dishes cleaned within 24 hours.','4.4 Smoking &amp; Substances — No indoor smoking. Illegal substances strictly prohibited. Violation = immediate termination without deposit refund.','4.5 Pets — No pets without prior written approval.','4.6 Alterations — No physical alterations without written consent.'].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${['5. VISA &amp; DOCUMENTATION','5.1 Passport Copy — Must be uploaded to the Guest Portal within 24 hours of move-in. Required for Vietnamese legal compliance.','5.2 Visa Responsibility — Tenant is solely responsible for maintaining a valid visa. Ta.Garden does not provide visa sponsorship.'].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    <p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;"><strong>6. PROPERTY MANAGER</strong> — The on-site Property Manager is Colt, reachable via WhatsApp for day-to-day matters. Landlord (Kai Edwards) contactable via the Guest Portal for billing, lease, or escalation matters.</p>

    ${[
      '7. MAINTENANCE &amp; REPAIRS',
      '7.1 Tenant Responsibilities — The Tenant shall keep the room clean and in good condition. Any damage beyond normal wear and tear will be deducted from the security deposit.',
      '7.2 Reporting — The Tenant must promptly report any maintenance issues or damage to the Property Manager via WhatsApp or the Guest Portal.',
      '7.3 Landlord Responsibilities — The Landlord shall maintain the property in habitable condition and attend to reasonable repair requests within a reasonable timeframe.',
    ].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${['8. TERMINATION','8.1 By Tenant — 15 days written notice via the Guest Portal or WhatsApp. Rent is due through the last day of the notice period.','8.2 By Landlord — 15 days written notice, or immediately for: non-payment, house rule violations, illegal activity, or misrepresentation.','8.3 Early Departure — If Tenant departs without 15 days notice, the security deposit is forfeited.'].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    ${[
      '9. ENTRY BY LANDLORD',
      '9.1 The Landlord or Property Manager may enter the Tenant\'s room with a minimum of 24 hours written notice for the purposes of inspection, maintenance, or repairs. In cases of emergency, entry may be made without prior notice.',
    ].map(s => `<p style="margin:0 0 10px;font-size:13px;color:#4a4a3a;line-height:1.7;">${s}</p>`).join('')}

    <p style="margin:0 0 24px;font-size:13px;color:#4a4a3a;line-height:1.7;"><strong>10. GOVERNING LAW</strong> — This Agreement is governed by the laws of the Socialist Republic of Vietnam.</p>

    <!-- Signatures -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #3a3a2a;padding-top:24px;margin-top:8px;">
      <tr>
        <td style="width:50%;padding-right:16px;vertical-align:top;">
          <p style="margin:0 0 8px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Landlord</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:16px;font-style:italic;color:#3a3a2a;">Kai Edwards</p>
          <p style="margin:0;font-size:11px;color:#88917d;">Soul &amp; Luna Wellness</p>
          <p style="margin:8px 0 0;font-size:11px;color:#88917d;">Date: ${today}</p>
        </td>
        <td style="width:50%;padding-left:16px;vertical-align:top;border-left:1px solid #e0d9d0;">
          <p style="margin:0 0 8px;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Tenant</p>
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:16px;font-style:italic;color:#3a3a2a;">${sig}</p>
          <p style="margin:0;font-size:11px;color:#88917d;">Electronically signed</p>
          <p style="margin:8px 0 0;font-size:11px;color:#88917d;">Date: ${today}</p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="background:#3a3a2a;padding:16px 32px;text-align:center;" class="pad">
    <p style="margin:0;font-size:10px;color:#88917d;letter-spacing:0.1em;">Ta.Garden · Cam Nam Island · Hội An, Vietnam · ta-garden.soulandlunawellness.com</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildMagicLinkEmail(name, loginUrl) {
  const first = name ? name.split(' ')[0] : 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e0d5;padding:20px 0;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr>
    <td style="background:#1a1a18;padding:28px 32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;font-family:Arial,sans-serif;">Cam Nam Island · Hội An, Vietnam</div>
    </td>
  </tr>
  <tr>
    <td class="pad" style="padding:32px;background:#f5f0eb;">
      <p style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Hello, ${first}.</p>
      <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;font-family:Arial,sans-serif;">Here is your secure login link for your Ta.Garden guest portal. This link is valid for 1 hour.</p>
      <a href="${loginUrl}" style="display:block;text-align:center;padding:16px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:20px;font-family:Arial,sans-serif;">Access My Portal →</a>
      <p style="font-size:12px;color:#88917d;line-height:1.7;border-top:1px solid rgba(136,145,125,0.2);padding-top:16px;font-family:Arial,sans-serif;">If the button doesn't work, copy this link:<br><span style="color:#86a2a6;word-break:break-all;">${loginUrl}</span></p>
      <p style="font-size:12px;color:#88917d;margin-top:12px;font-family:Arial,sans-serif;">Didn't request this? You can safely ignore this email.</p>
    </td>
  </tr>
  <tr>
    <td style="background:#1a1a18;padding:16px 32px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);font-family:Arial,sans-serif;">Questions? hi@soulandlunawellness.com</div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildDeclineEmail(enq, customMessage) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e0d5;padding:20px 0;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr>
    <td style="background:#1a1a18;padding:28px 32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;font-family:Arial,sans-serif;">Cam Nam Island · Hội An, Vietnam</div>
    </td>
  </tr>
  <tr>
    <td class="pad" style="padding:32px;background:#f5f0eb;">
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${enq.name.split(' ')[0]},</p>
      <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 16px;font-family:Arial,sans-serif;">Thank you so much for your interest in <strong>${enq.room}</strong> at Ta.Garden. We truly appreciate you taking the time to reach out.</p>
      ${customMessage
        ? `<div style="padding:16px;background:#fff;border-left:3px solid #a0856c;margin-bottom:20px;font-size:14px;line-height:1.8;color:#1a1a18;font-family:Arial,sans-serif;">${customMessage.replace(/\n/g,'<br>')}</div>`
        : `<p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 16px;font-family:Arial,sans-serif;">Unfortunately we're unable to accommodate your requested dates at this time.</p>`}
      <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;font-family:Arial,sans-serif;">We hope to welcome you to Ta.Garden at another time — please don't hesitate to reach out again.</p>
      <p style="font-size:14px;color:#4a4a45;margin:0;font-family:Arial,sans-serif;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
    </td>
  </tr>
  <tr>
    <td style="background:#1a1a18;padding:16px 32px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);font-family:Arial,sans-serif;">hi@soulandlunawellness.com</div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildGuestEmail({ name, room, stayLabel, dateInfo, message }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;font-family:Georgia,serif;}
@media only screen and (max-width:600px){
  .w600{width:100%!important;}
  .pad{padding:20px!important;}
}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8e0d5;padding:20px 0;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a18;padding:28px 32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;font-family:Arial,sans-serif;">Cam Nam Island · Hội An, Vietnam</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td class="pad" style="padding:32px;background:#f5f0eb;">
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${name.split(' ')[0]},</p>
      <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 14px;font-family:Arial,sans-serif;">Thank you for reaching out about <strong>${room}</strong> at Ta.Garden. We've received your enquiry and will be in touch within 24 hours via email or WhatsApp.</p>

      <!-- Summary card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid rgba(136,145,125,0.2);margin:20px 0;">
        <tr>
          <td style="padding:16px 20px;border-bottom:1px solid rgba(136,145,125,0.12);">
            <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:12px;font-family:Arial,sans-serif;">Your Enquiry Summary</div>
          </td>
        </tr>
        <tr>
          <td width="110" style="padding:10px 0 10px 20px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.12);font-family:Arial,sans-serif;vertical-align:top;">Room</td>
          <td style="padding:10px 20px 10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.12);font-family:Arial,sans-serif;">${room}</td>
        </tr>
        <tr>
          <td style="padding:10px 0 10px 20px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.12);font-family:Arial,sans-serif;vertical-align:top;">Stay Type</td>
          <td style="padding:10px 20px 10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.12);font-family:Arial,sans-serif;">${stayLabel}</td>
        </tr>
        <tr>
          <td style="padding:10px 0 ${message ? '10px' : '10px'} 20px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;${message ? 'border-bottom:1px solid rgba(136,145,125,0.12);' : ''}font-family:Arial,sans-serif;vertical-align:top;">Dates</td>
          <td style="padding:10px 20px 10px 0;font-size:14px;${message ? 'border-bottom:1px solid rgba(136,145,125,0.12);' : ''}font-family:Arial,sans-serif;">${dateInfo}</td>
        </tr>
        ${message ? `<tr>
          <td style="padding:10px 0 10px 20px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;font-family:Arial,sans-serif;vertical-align:top;">Message</td>
          <td style="padding:10px 20px 10px 0;font-size:14px;line-height:1.7;font-family:Arial,sans-serif;">${message}</td>
        </tr>` : ''}
      </table>

      <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 8px;font-family:Arial,sans-serif;">We look forward to welcoming you.</p>
      <p style="font-size:14px;color:#4a4a45;margin:0 0 24px;font-family:Arial,sans-serif;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
      <div style="border-top:1px solid rgba(136,145,125,0.2);padding-top:16px;font-size:12px;color:#88917d;line-height:1.7;font-family:Arial,sans-serif;">
        Questions? Reply to this email or reach us at <a href="mailto:hi@soulandlunawellness.com" style="color:#a0856c;">hi@soulandlunawellness.com</a>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1a1a18;padding:16px 32px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);font-family:Arial,sans-serif;">Soul &amp; Luna Wellness · Ta.Garden · Hội An, Vietnam</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildDirectBookingGuestEmail({ name, room, stayType, checkIn, checkOut, dateRange, price, deposit, totalStr, depositStr, stripeUrl, guestPortalUrl }) {
  const firstName = name.split(' ')[0];
  const stayLabel = stayType === 'monthly' ? 'Monthly Stay' : 'Short Stay';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){.w600{width:100%!important;}.pad{padding:20px!important;}}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="background:#86a2a6;padding:28px 32px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#fff;letter-spacing:0.05em;">Ta.Garden</p></td>
      <td align="right"><p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:rgba(255,255,255,0.8);letter-spacing:0.15em;text-transform:uppercase;">Booking Confirmed</p></td>
    </tr></table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:28px 32px 16px;" class="pad">
    <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#88917d;letter-spacing:0.1em;text-transform:uppercase;">Dear ${firstName},</p>
    <p style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:#3a3a2a;font-weight:normal;">Your booking is confirmed.</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#4a4a3a;line-height:1.7;">We're delighted to welcome you to Ta.Garden. Here are your reservation details:</p>
  </td></tr>

  <!-- Booking summary -->
  <tr><td style="padding:0 32px 24px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;">
      ${(() => {
        const rentAmt = typeof deposit === 'number' ? deposit : 0;
        const firstMonthTotal = deposit && price?.total ? deposit + (price.total - deposit) : (deposit ? deposit * 2 : null);
        const rows = [
          ['Room', room],
          ['Stay Type', stayLabel],
          ['Dates', dateRange],
          ['Monthly Rent', depositStr],
          ['Security Deposit', `${depositStr} <span style="font-size:11px;color:#88917d;">(fully refunded on departure)</span>`],
        ];
        if (deposit) rows.push(['Total Due to Move In', `<strong style="font-size:17px;color:#3a3a2a;">$${(deposit * 2).toLocaleString()}</strong> <span style="font-size:11px;color:#88917d;">first month + deposit</span>`]);
        return rows.map(([k, v], i, a) => `<tr><td style="padding:16px 20px;${i < a.length-1 ? 'border-bottom:1px solid #e0d9d0;' : ''}${i === a.length-1 ? 'background:rgba(0,0,0,0.04);border-radius:0 0 6px 6px;' : ''}">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;letter-spacing:0.1em;text-transform:uppercase;">${k}</p></td>
          <td align="right"><p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#3a3a2a;">${v}</p></td>
        </tr></table>
      </td></tr>`).join('');
      })()}
    </table>
  </td></tr>

  <!-- Pay deposit -->
  <tr><td style="padding:0 32px 24px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#3a3a2a;border-radius:6px;padding:20px 24px;">
      <tr><td>
        <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:13px;color:#c8b89a;letter-spacing:0.1em;text-transform:uppercase;">Step 1 — Secure Your Room</p>
        <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.85);line-height:1.6;">To move in, your first payment covers:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr><td style="padding:3px 0;font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.75);">• First month's rent — <strong style="color:#fff;">${depositStr}</strong></td></tr>
          <tr><td style="padding:3px 0;font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.75);">• Security deposit — <strong style="color:#fff;">${depositStr}</strong> <span style="color:rgba(255,255,255,0.45);font-size:12px;">(fully refunded when you leave)</span></td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="padding:0 6px 0 0;" align="center">
            <a href="${stripeUrl || STRIPE_USD}" style="display:inline-block;padding:13px 24px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Pay in USD →</a>
          </td>
          <td style="padding:0 0 0 6px;" align="center">
            <a href="${STRIPE_VND}" style="display:inline-block;padding:13px 24px;background:#5a7a56;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Pay in VND →</a>
          </td>
        </tr></table>
        <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.4);text-align:center;">Secure payment via Stripe · Choose your preferred currency</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Guest portal -->
  ${guestPortalUrl ? `<tr><td style="padding:0 32px 24px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;border:1px solid #ddd5c8;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:13px;color:#88917d;letter-spacing:0.1em;text-transform:uppercase;">Step 2 — Your Guest Portal</p>
        <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;line-height:1.7;">Your personal guest portal is where you manage everything about your stay:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          ${[
            ['✓', 'Sign your rental contract'],
            ['✓', 'Upload your passport &amp; visa copy (required within 24h of move-in)'],
            ['✓', 'View and track monthly payments'],
            ['✓', 'Update your profile and contact details'],
            ['✓', 'Message the team for any questions'],
          ].map(([icon, text]) => `<tr><td width="20" style="padding:4px 8px 4px 0;font-size:14px;color:#86a2a6;vertical-align:top;">${icon}</td><td style="padding:4px 0;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;line-height:1.5;">${text}</td></tr>`).join('')}
        </table>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${guestPortalUrl}" style="display:inline-block;padding:14px 32px;background:#86a2a6;color:#fff;text-decoration:none;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Open Your Guest Portal →</a>
        </td></tr></table>
        <p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-align:center;">Bookmark this link — it's your home base for your stay at Ta.Garden</p>
      </td></tr>
    </table>
  </td></tr>` : ''}

  <!-- What's next -->
  <tr><td style="padding:0 32px 24px;" class="pad">
    <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:13px;color:#88917d;letter-spacing:0.1em;text-transform:uppercase;">What happens next</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${[
        ['01', `Pay your first month's rent + security deposit via Stripe to secure your room. Your deposit is fully refunded when you leave.`],
        ['02', 'Open your Guest Portal to sign your contract and upload your documents'],
        ['03', 'We\'ll send you a payment reminder a few days before each monthly due date'],
        ['04', 'We\'ll reach out closer to your move-in date with arrival details'],
      ].map(([n, t]) => `<tr>
        <td width="32" style="padding:0 10px 12px 0;vertical-align:top;">
          <span style="display:inline-block;background:#3a3a2a;color:#c8b89a;font-size:9px;padding:3px 7px;font-family:Arial,sans-serif;letter-spacing:0.1em;">${n}</span>
        </td>
        <td style="padding-bottom:12px;font-family:Arial,sans-serif;font-size:13px;color:#4a4a3a;line-height:1.6;vertical-align:top;">${t}</td>
      </tr>`).join('')}
    </table>
  </td></tr>

  <!-- Location -->
  <tr><td style="padding:0 32px 28px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;border:1px solid #ddd5c8;">
      <tr><td style="padding:16px 20px;border-bottom:1px solid #ddd5c8;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;">How to Find Us</p>
      </td></tr>
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:13px;color:#3a3a2a;line-height:1.7;"><strong>K570/24</strong><br>Thành phố Đà Nẵng, Phường Hội An<br>Cam Nam Island, Vietnam</p>
        <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:11px;color:#88917d;line-height:1.6;">Google Maps cannot find the street address — use the GPS coordinates below or the map link:</p>
        <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:14px;color:#3a3a2a;">15.867740, 108.355771</p>
        <a href="https://goo.gl/maps/78FMqsqrDY1dFiAE8" style="display:inline-block;padding:10px 20px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-family:Arial,sans-serif;border-radius:4px;">Open in Google Maps →</a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#3a3a2a;padding:20px 32px;text-align:center;" class="pad">
    <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:13px;color:#c8b89a;">Ta.Garden</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#88917d;">Cam Nam Island · Hội An, Vietnam · <a href="https://ta-garden.soulandlunawellness.com" style="color:#88917d;">ta-garden.soulandlunawellness.com</a></p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildDirectBookingAdminEmail({ name, email, phone, room, stayType, dateRange, price, deposit, totalStr, depositStr, signature, enqId }) {
  const stayLabel = stayType === 'monthly' ? 'Monthly Stay' : 'Short Stay';
  const waBtn = phone
    ? `<a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="display:inline-block;padding:14px 24px;background:#25D366;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">WhatsApp ${name.split(' ')[0]}</a>&nbsp;`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body,table,td{margin:0;padding:0;}
body{background:#e8e0d5;}
@media only screen and (max-width:600px){
  .w600{width:100%!important;}
  .pad{padding:20px!important;}
}
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d5;padding:40px 16px;">
<tr><td align="center">
<table class="w600" width="600" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#3a3a2a;padding:24px 32px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#c8b89a;">Ta.Garden Admin</p></td>
      <td align="right"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;letter-spacing:0.1em;text-transform:uppercase;">Direct Booking Confirmed</p></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 32px 16px;" class="pad">
    <h2 style="margin:0 0 8px 0;font-family:Georgia,serif;font-size:22px;color:#3a3a2a;font-weight:normal;">New booking: ${room}</h2>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#88917d;">Guest confirmed via direct booking link</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px;" class="pad">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;border-radius:6px;">
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Guest</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${name}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Email</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${email}</p></td>
        </tr></table>
      </td></tr>
      ${phone ? `<tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Phone</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${phone}</p></td>
        </tr></table>
      </td></tr>` : ''}
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Room</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${room} — ${stayLabel}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Dates</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${dateRange}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Total</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${totalStr}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;border-bottom:1px solid #e0d9d0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Deposit</p></td>
          <td><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#3a3a2a;">${depositStr}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40%;"><p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#88917d;text-transform:uppercase;letter-spacing:0.1em;">Signature</p></td>
          <td><p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#3a3a2a;font-style:italic;">${signature}</p></td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;" class="pad">
    ${waBtn}
    <a href="mailto:${email}" style="display:inline-block;padding:14px 24px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Email ${name.split(' ')[0]}</a>
    <p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:12px;color:#88917d;">Enquiry ID: ${enqId} · Calendar dates have been automatically blocked</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcPrice(room, stayType, checkIn, checkOut) {
  const rates = ROOM_RATES[room];
  if (!rates || !checkIn || !checkOut) return null;
  const days = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (days <= 0) return null;
  if (stayType === 'monthly') {
    const months = Math.round((days / 30) * 10) / 10;
    return { duration: `${days} days (~${months} mo)`, rate: `$${rates.monthly}/month`, breakdown: `${months} mo × $${rates.monthly}`, total: Math.round(months * rates.monthly) };
  }
  return { duration: `${days} night${days !== 1 ? 's' : ''}`, rate: `$${rates.nightly}/night`, breakdown: `${days} × $${rates.nightly}`, total: days * rates.nightly };
}

function roomKey(name) {
  if (!name) return 'all';
  const n = name.toLowerCase();
  if (n.includes('river'))   return 'river-room';
  if (n.includes('balcony')) return 'balcony-room';
  if (n.includes('sky'))     return 'sky-suite';
  return 'all';
}

async function resend(from, to, subject, html, replyTo, env) {
  const key = env?.RESEND_API_KEY;
  if (!key) { console.error('RESEND_API_KEY not set'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo || undefined, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend error ${res.status} sending to ${to}: ${body}`);
  }
  return res;
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}
