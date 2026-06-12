// RESEND_API_KEY must be set as a secret in Cloudflare Workers dashboard
// (Settings → Variables & Secrets → Add Secret → RESEND_API_KEY)
const TO_EMAILS = ['ashleyedwards305@gmail.com', 'hi@soulandlunawellness.com'];
const FROM = 'Ta.Garden <hello@soulandlunawellness.com>';

const ROOM_RATES = {
  'The River Room':   { monthly: 340, nightly: 25 },
  'The Balcony Room': { monthly: 400, nightly: 30 },
  'The Sky Suite':    { monthly: 680, nightly: 50 },
};

const DEFAULT_PROPERTIES = [
  {
    id: 'ta-garden',
    name: 'Ta.Garden',
    location: 'Cam Nam Island, Hội An, Vietnam',
    type: 'coliving',
    color: '#86a2a6',
    rooms: ['The River Room', 'The Balcony Room', 'The Sky Suite'],
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

    const BASE = '/sanctuaries/ta-garden';
    let p = url.pathname;
    if (p === BASE || p.startsWith(BASE + '/')) {
      p = p.slice(BASE.length) || '/';
    }
    const m = request.method;

    if (p === '/api/enquire'               && m === 'POST')  return handleEnquiry(request, env, cors, ctx);
    if (p === '/api/availability'           && m === 'GET')   return handleAvailability(request, env, cors);

    // Admin routes
    if (p === '/api/admin/debug'            && m === 'GET')   return adminDebug(request, env, cors);
    if (p === '/api/admin/enquiries'        && m === 'GET')   return safeCall(() => adminListEnquiries(request, env, cors), cors);
    if (p === '/api/admin/enquiry'          && m === 'PATCH') return safeCall(() => adminUpdateEnquiry(request, env, cors), cors);
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
    if (p === '/api/guest/request-login'    && m === 'POST')  return safeCall(() => handleGuestRequestLogin(request, env, cors, ctx), cors);
    if (p === '/api/guest/verify-token'     && m === 'GET')   return handleGuestVerifyToken(request, env, cors);

    // Payments
    if (p === '/api/admin/record-payment'   && m === 'POST')  return safeCall(() => adminRecordPayment(request, env, cors), cors);
    if (p === '/api/admin/record-payment'   && m === 'DELETE') return safeCall(() => adminDeletePayment(request, env, cors), cors);
    if (p === '/api/admin/payments'         && m === 'GET')   return safeCall(() => adminGetPayments(request, env, cors), cors);

    // Email automation
    if (p === '/api/admin/send-emails'     && m === 'POST')   return safeCall(() => adminRunEmails(request, env, cors), cors);

    // Room listings (public read, admin write)
    if (p === '/api/rooms'                 && m === 'GET')    return handleRoomsGet(request, env, cors);
    if (p === '/api/admin/rooms'           && m === 'GET')    return safeCall(() => adminGetRooms(request, env, cors), cors);
    if (p === '/api/admin/room'            && m === 'POST')   return safeCall(() => adminSaveRoom(request, env, cors), cors);

    // Serve static assets with no-cache for HTML
    if (!env.ASSETS) {
      return new Response('ASSETS binding not configured — redeploy via: npx wrangler deploy', { status: 503 });
    }
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.headers.get('content-type')?.includes('text/html')) {
      const res = new Response(assetRes.body, assetRes);
      res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res;
    }
    return assetRes;
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
  const enquiries = val ? JSON.parse(val) : [];
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
  enquiries[idx].status = status;
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  return Response.json({ success: true }, { headers: cors });
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

  const { enquiryId, propertyId = 'ta-garden', action, customMessage } = await request.json();
  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = val ? JSON.parse(val) : [];
  const idx = enquiries.findIndex(e => e.id === enquiryId);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const enq = enquiries[idx];
  const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
  enquiries[idx].status = newStatus;
  await env.BOOKINGS.put(key, JSON.stringify(enquiries));

  const origin = new URL(request.url).origin;
  const html    = action === 'confirm' ? buildConfirmEmail(enq, customMessage, origin, propertyId) : buildDeclineEmail(enq, customMessage);
  const subject = action === 'confirm'
    ? `Your booking at Ta.Garden is confirmed — ${enq.room}`
    : `Re: Your enquiry at Ta.Garden — ${enq.room}`;

  await resend(FROM, enq.email, subject, html, null, env);
  return Response.json({ success: true, status: newStatus }, { headers: cors });
}

// ── Admin: save internal note ─────────────────────────────────────────────────

async function adminSaveNote(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, note, propertyId = 'ta-garden' } = await request.json();
  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = val ? JSON.parse(val) : [];
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
  const ranges = val ? JSON.parse(val) : [];
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
  const ranges = val ? JSON.parse(val) : [];
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
  const list = val ? JSON.parse(val) : [];
  const enq = list.find(e => e.id === enquiryId);
  if (!enq) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  const [profileRaw, paymentsRaw] = await Promise.all([
    env.BOOKINGS.get(`guest__${enquiryId}`),
    env.BOOKINGS.get(`payments__${enquiryId}`),
  ]);
  const profile  = profileRaw  ? JSON.parse(profileRaw)  : null;
  const payments = paymentsRaw ? JSON.parse(paymentsRaw) : [];

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
    profileSubmitted: !!profile,
    profile: profile ? {
      fullName: profile.fullName, nationality: profile.nationality,
      dateOfBirth: profile.dateOfBirth, passportNumber: profile.passportNumber,
      homeAddress: profile.homeAddress, emergencyName: profile.emergencyName,
      emergencyPhone: profile.emergencyPhone, emergencyRelation: profile.emergencyRelation,
      passportUploaded: !!profile.passport, visaUploaded: !!profile.visa,
      submittedAt: profile.submittedAt,
    } : null,
    payments,
  }, { headers: cors });
}

async function handleGuestSubmit(request, env, cors, ctx) {
  try {
    const { id, propertyId = 'ta-garden', fullName, dateOfBirth, nationality, passportNumber, homeAddress, emergencyName, emergencyPhone, passport, visa } = await request.json();
    if (!id || !fullName) return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
    if (!env.BOOKINGS) return Response.json({ error: 'Storage unavailable' }, { status: 503, headers: cors });

    const profile = { fullName, dateOfBirth, nationality, passportNumber, homeAddress, emergencyName, emergencyPhone, passport: passport || null, visa: visa || null, submittedAt: new Date().toISOString() };
    await env.BOOKINGS.put(`guest__${id}`, JSON.stringify(profile));

    // Update onboarding flags on the enquiry
    const key = enquiriesKey(propertyId);
    const val = await env.BOOKINGS.get(key);
    const enquiries = val ? JSON.parse(val) : [];
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

// ── Admin: update onboarding checklist ────────────────────────────────────────

async function adminUpdateOnboarding(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, propertyId = 'ta-garden', field, value } = await request.json();
  const ALLOWED = ['paymentReceived', 'contractSigned', 'passportUploaded', 'visaUploaded'];
  if (!ALLOWED.includes(field)) return Response.json({ error: 'Invalid field' }, { status: 400, headers: cors });

  const key = enquiriesKey(propertyId);
  const val = await env.BOOKINGS.get(key);
  const enquiries = val ? JSON.parse(val) : [];
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

  const raw = await env.BOOKINGS.get(`guest__${id}`);
  if (!raw) return Response.json({ profile: null }, { headers: cors });
  return Response.json({ profile: JSON.parse(raw) }, { headers: cors });
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
    const enquiries = val ? JSON.parse(val) : [];
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
  const payments = raw ? JSON.parse(raw) : [];
  const id = `pay_${Date.now()}`;
  payments.unshift({ id, amount: Number(amount), currency, date: date || new Date().toISOString().split('T')[0], note: note || '', recordedAt: new Date().toISOString() });
  await env.BOOKINGS.put(key, JSON.stringify(payments));
  return Response.json({ success: true, id }, { headers: cors });
}

async function adminDeletePayment(request, env, cors) {
  if (!await checkAuth(request, env)) return unauthorized(cors);
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { enquiryId, id } = await request.json();
  if (!enquiryId || !id) return Response.json({ error: 'enquiryId and id required' }, { status: 400, headers: cors });

  const key = `payments__${enquiryId}`;
  const raw = await env.BOOKINGS.get(key);
  const payments = raw ? JSON.parse(raw) : [];
  await env.BOOKINGS.put(key, JSON.stringify(payments.filter(p => p.id !== id)));
  return Response.json({ success: true }, { headers: cors });
}

// ── Public: gallery ───────────────────────────────────────────────────────────

async function handleGalleryGet(request, env, cors) {
  const room = new URL(request.url).searchParams.get('room') || 'river-room';
  if (!env.BOOKINGS) return Response.json({ images: [] }, { headers: cors });
  const raw = await env.BOOKINGS.get(`gallery__${room}`);
  const images = raw ? JSON.parse(raw) : [];
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
  const images = raw ? JSON.parse(raw) : [];
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
  const images = raw ? JSON.parse(raw) : [];
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

    const enquiries = JSON.parse(raw);
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
    }

    if (changed) await env.BOOKINGS.put(key, JSON.stringify(enquiries));
  }

  return { sent, skipped, errors, date: todayStr };
}

function buildArrivalReminderEmail(enq) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5efe8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border:1px solid rgba(136,145,125,0.15);">
    <div style="background:#2a2520;padding:32px 36px;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Ta.Garden</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;line-height:1.3;">Your arrival is in 2 days</div>
    </div>
    <div style="padding:36px;">
      <p style="margin:0 0 20px;font-size:15px;color:#2a2520;line-height:1.7;">Hi ${enq.name.split(' ')[0]},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a534c;line-height:1.8;">We're looking forward to welcoming you to Ta.Garden on <strong style="color:#2a2520;">${fmt(enq.checkIn)}</strong>. A few things to know before you arrive:</p>

      <div style="background:#f5efe8;padding:20px 24px;margin:24px 0;border-left:3px solid #c17a4a;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#88917d;margin-bottom:12px;">Arrival Details</div>
        <div style="font-size:13px;color:#2a2520;line-height:2;">
          <div><strong>Check-in:</strong> From 2:00 PM</div>
          <div><strong>Address:</strong> Ta.Garden, Cam Nam Island, Hội An</div>
          <div><strong>Your room:</strong> ${enq.room}</div>
        </div>
      </div>

      <p style="margin:0 0 16px;font-size:14px;color:#5a534c;line-height:1.8;">We'll meet you at the home, show you around, and hand over your keys. If your plans change or you're running late, just send a message — Ashley is always reachable on WhatsApp.</p>
      <p style="margin:0 0 24px;font-size:14px;color:#5a534c;line-height:1.8;">Is there anything you need before you arrive? Just reply to this email.</p>
      <p style="margin:0;font-size:14px;color:#5a534c;">See you soon,<br><span style="color:#2a2520;font-weight:500;">Ashley &amp; the Ta.Garden team</span></p>
    </div>
    <div style="padding:20px 36px;border-top:1px solid rgba(136,145,125,0.12);text-align:center;">
      <div style="font-size:11px;color:#88917d;letter-spacing:0.06em;">Ta.Garden &nbsp;·&nbsp; Cam Nam Island, Hội An, Vietnam<br>A Soul &amp; Luna Property</div>
    </div>
  </div>
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
          <div><strong>Checkout time:</strong> By 11:00 AM</div>
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

// ── Email builders ────────────────────────────────────────────────────────────

function buildAdminEmail({ name, email, phone, room, stayType, stayLabel, dateInfo, checkIn, checkOut, message, price }) {
  const priceBlock = price ? `
  <div style="background:#1a1a18;padding:20px 24px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Estimated Value</div>
      <div style="font-family:Georgia,serif;font-size:32px;font-weight:300;color:#ede0d1;">$${price.total.toLocaleString()}</div>
      <div style="font-size:12px;color:rgba(237,224,209,0.5);margin-top:4px;">${price.breakdown} &nbsp;·&nbsp; ${price.duration}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#86a2a6;margin-bottom:6px;">Rate</div>
      <div style="font-size:16px;color:#ede0d1;">${price.rate}</div>
    </div>
  </div>` : '';

  const waBtn = phone
    ? `<a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="display:inline-block;padding:12px 26px;background:#25D366;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;margin-right:8px;">WhatsApp ${name.split(' ')[0]}</a>`
    : '';

  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:24px 28px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:#86a2a6;margin-top:3px;">New Booking Enquiry</div>
    </div>
    <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(237,224,209,0.35);">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
  </div>
  <div style="padding:28px;background:#f5f0eb;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#1a1a18;margin-bottom:4px;">${room}</div>
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#a0856c;margin-bottom:20px;">${stayLabel}</div>
    ${priceBlock}
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;width:120px;border-bottom:1px solid rgba(136,145,125,0.15);">Guest</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${name}</td></tr>
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Email</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);"><a href="mailto:${email}" style="color:#a0856c;text-decoration:none;">${email}</a></td></tr>
      ${phone ? `<tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">WhatsApp</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);"><a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="color:#25D366;text-decoration:none;">${phone}</a></td></tr>` : ''}
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Check-in</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${fmt(checkIn)}</td></tr>
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Check-out</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${checkOut ? fmt(checkOut) : '—'}</td></tr>
      ${price ? `<tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;">Duration</td><td style="padding:10px 0;font-size:14px;">${price.duration}</td></tr>` : ''}
    </table>
    <div style="background:#fff;border:1px solid rgba(160,133,108,0.3);border-left:4px solid #a0856c;padding:18px 20px;margin-bottom:20px;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#88917d;margin-bottom:10px;">Message from Guest</div>
      <div style="font-size:15px;line-height:1.8;color:#1a1a18;font-style:${message ? 'normal' : 'italic'};">${message || 'No message provided.'}</div>
    </div>
    <div>${waBtn}<a href="mailto:${email}?subject=Re: ${encodeURIComponent(room)}" style="display:inline-block;padding:12px 26px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;">Email ${name.split(' ')[0]}</a></div>
  </div>
</div>`;
}

function buildConfirmEmail(enq, customMessage, origin, propertyId) {
  const guestPortalUrl = origin ? `${origin}/guest.html?id=${enq.id}&p=${propertyId || 'ta-garden'}` : null;
  const price = calcPrice(enq.room, enq.stayType, enq.checkIn, enq.checkOut);
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">Booking Confirmed</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;margin:0 0 20px;">Your booking is confirmed, ${enq.name.split(' ')[0]}.</p>
    <div style="background:#fff;border:1px solid rgba(136,145,125,0.2);padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:4px;">Room</div>
          <div style="font-size:16px;font-family:Georgia,serif;">${enq.room}</div>
        </div>
        ${price ? `<div style="text-align:right;">
          <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:4px;">Estimated Total</div>
          <div style="font-size:24px;font-family:Georgia,serif;font-weight:300;">$${price.total.toLocaleString()}</div>
          <div style="font-size:11px;color:#88917d;">${price.breakdown}</div>
        </div>` : ''}
      </div>
      <div style="border-top:1px solid rgba(136,145,125,0.15);padding-top:12px;display:flex;gap:32px;">
        <div><div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;margin-bottom:3px;">Check-in</div><div style="font-size:14px;">${fmt(enq.checkIn)}</div></div>
        <div><div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;margin-bottom:3px;">Check-out</div><div style="font-size:14px;">${fmt(enq.checkOut)}</div></div>
      </div>
    </div>
    ${customMessage ? `<div style="padding:16px;background:#fff;border-left:3px solid #86a2a6;margin-bottom:24px;font-size:14px;line-height:1.8;color:#1a1a18;">${customMessage.replace(/\n/g,'<br>')}</div>` : ''}
    <div style="margin-bottom:24px;">
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#88917d;margin-bottom:12px;">Next Steps</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px;"><span style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:3px 8px;flex-shrink:0;">01</span><span>Complete your first month's payment to secure your room</span></div>
        <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px;"><span style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:3px 8px;flex-shrink:0;">02</span><span>Review and sign the Ta.Garden House Agreement (sent separately)</span></div>
        <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px;"><span style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:3px 8px;flex-shrink:0;">03</span><span>Complete your guest profile — upload passport photo and visa details via your personal link below</span></div>
        <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px;"><span style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:3px 8px;flex-shrink:0;">04</span><span>We'll confirm check-in details closer to your arrival date</span></div>
      </div>
    </div>
    ${guestPortalUrl ? `<a href="${guestPortalUrl}" style="display:block;text-align:center;padding:15px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:10px;">Complete Guest Profile →</a>` : ''}
    <a href="https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02" style="display:block;text-align:center;padding:15px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;">Complete Payment via Stripe →</a>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">Questions? hi@soulandlunawellness.com</div>
  </div>
</div>`;
}

function buildMagicLinkEmail(name, loginUrl) {
  const first = name ? name.split(' ')[0] : 'there';
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">Cam Nam Island · Hội An, Vietnam</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Hello, ${first}.</p>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;">Here is your secure login link for your Ta.Garden guest portal. This link is valid for 1 hour.</p>
    <a href="${loginUrl}" style="display:block;text-align:center;padding:16px;background:#86a2a6;color:#fff;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:20px;">Access My Portal →</a>
    <p style="font-size:12px;color:#88917d;line-height:1.7;border-top:1px solid rgba(136,145,125,0.2);padding-top:16px;">If the button doesn't work, copy this link:<br><span style="color:#86a2a6;word-break:break-all;">${loginUrl}</span></p>
    <p style="font-size:12px;color:#88917d;margin-top:12px;">Didn't request this? You can safely ignore this email.</p>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">Questions? hi@soulandlunawellness.com</div>
  </div>
</div>`;
}

function buildDeclineEmail(enq, customMessage) {
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">Cam Nam Island · Hội An, Vietnam</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${enq.name.split(' ')[0]},</p>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 16px;">Thank you so much for your interest in <strong>${enq.room}</strong> at Ta.Garden. We truly appreciate you taking the time to reach out.</p>
    ${customMessage
      ? `<div style="padding:16px;background:#fff;border-left:3px solid #a0856c;margin-bottom:20px;font-size:14px;line-height:1.8;color:#1a1a18;">${customMessage.replace(/\n/g,'<br>')}</div>`
      : `<p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 16px;">Unfortunately we're unable to accommodate your requested dates at this time.</p>`}
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;">We hope to welcome you to Ta.Garden at another time — please don't hesitate to reach out again.</p>
    <p style="font-size:14px;color:#4a4a45;margin:0;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">hi@soulandlunawellness.com</div>
  </div>
</div>`;
}

function buildGuestEmail({ name, room, stayLabel, dateInfo, message }) {
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">Cam Nam Island · Hội An, Vietnam</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${name.split(' ')[0]},</p>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 14px;">Thank you for reaching out about <strong>${room}</strong> at Ta.Garden. We've received your enquiry and will be in touch within 24 hours via email or WhatsApp.</p>
    <div style="background:#fff;padding:20px;border:1px solid rgba(136,145,125,0.2);margin:20px 0;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:12px;">Your Enquiry Summary</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;width:100px;border-bottom:1px solid rgba(136,145,125,0.12);">Room</td><td style="padding:7px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.12);">${room}</td></tr>
        <tr><td style="padding:7px 0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.12);">Stay Type</td><td style="padding:7px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.12);">${stayLabel}</td></tr>
        <tr><td style="padding:7px 0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;${message?'border-bottom:1px solid rgba(136,145,125,0.12);':''}">Dates</td><td style="padding:7px 0;font-size:14px;${message?'border-bottom:1px solid rgba(136,145,125,0.12);':''}">${dateInfo}</td></tr>
        ${message ? `<tr><td style="padding:7px 0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#88917d;vertical-align:top;">Message</td><td style="padding:7px 0;font-size:14px;line-height:1.7;">${message}</td></tr>` : ''}
      </table>
    </div>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 8px;">We look forward to welcoming you.</p>
    <p style="font-size:14px;color:#4a4a45;margin:0 0 24px;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
    <div style="border-top:1px solid rgba(136,145,125,0.2);padding-top:16px;font-size:12px;color:#88917d;line-height:1.7;">
      Questions? Reply to this email or reach us at <a href="mailto:hi@soulandlunawellness.com" style="color:#a0856c;">hi@soulandlunawellness.com</a>
    </div>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">Soul &amp; Luna Wellness · Ta.Garden · Hội An, Vietnam</div>
  </div>
</div>`;
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
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
  });
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}
