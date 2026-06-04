const RESEND_API_KEY = 're_Tu3YJdBj_KKyLdGr93ByYaE4FZ13J5Nku';
const TO_EMAILS = ['ashleyedwards305@gmail.com', 'hi@soulandlunawellness.com'];
const FROM = 'Ta.Garden Enquiries <onboarding@resend.dev>';

const ROOM_RATES = {
  'The River Room':   { monthly: 350, nightly: 25 },
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
  async fetch(request, env, ctx) {
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
    if (p === '/api/admin/enquiries'        && m === 'GET')   return adminListEnquiries(request, env, cors);
    if (p === '/api/admin/enquiry'          && m === 'PATCH') return adminUpdateEnquiry(request, env, cors);
    if (p === '/api/admin/properties'       && m === 'GET')   return adminListProperties(request, env, cors);
    if (p === '/api/admin/property'         && m === 'POST')  return adminSaveProperty(request, env, cors);
    if (p === '/api/admin/property'         && m === 'DELETE')return adminDeleteProperty(request, env, cors);
    if (p === '/api/admin/notify'          && m === 'POST')  return adminNotify(request, env, cors);
    if (p === '/api/admin/note'            && m === 'POST')  return adminSaveNote(request, env, cors);
    if (p === '/api/admin/block'            && m === 'POST')  return adminBlock(request, env, cors);
    if (p === '/api/admin/unblock'          && m === 'POST')  return adminUnblock(request, env, cors);
    if (p === '/api/admin/ical-sync'        && m === 'POST')  return adminIcalSync(request, env, cors);

    return env.ASSETS.fetch(request);
  },
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkAuth(request, env) {
  const h = request.headers.get('x-admin-secret');
  if (!h || !env.BOOKINGS) return false;
  // Password stored in KV so it can be set via the Cloudflare dashboard
  const stored = await env.BOOKINGS.get('admin_password');
  return stored && h.trim() === stored.trim();
}

async function adminDebug(request, env, cors) {
  const stored   = env.BOOKINGS ? await env.BOOKINGS.get('admin_password') : null;
  const enqRaw   = env.BOOKINGS ? await env.BOOKINGS.get('enquiries') : null;
  const propsRaw = env.BOOKINGS ? await env.BOOKINGS.get('properties') : null;
  const enquiries = enqRaw  ? JSON.parse(enqRaw)  : [];
  const props     = propsRaw ? JSON.parse(propsRaw) : null;
  return Response.json({
    kvSet:           !!env.BOOKINGS,
    passwordInKV:    !!stored,
    passwordLength:  stored ? stored.length : 0,
    enquiryCount:    enquiries.length,
    latestEnquiry:   enquiries[0] ? { id: enquiries[0].id, name: enquiries[0].name, createdAt: enquiries[0].createdAt, status: enquiries[0].status } : null,
    propertiesInKV:  !!propsRaw,
    firstPropertyId: props ? props[0]?.id : 'using default (ta-garden)',
  }, { headers: cors });
}

function unauthorized(cors) {
  return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
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
      enquiries.unshift({
        id: `enq_${Date.now()}`,
        propertyId, name, email, phone: phone || '', room,
        stayType, checkIn, checkOut: checkOut || null,
        message: message || '', price: price ? price.total : null,
        status: 'pending', createdAt: new Date().toISOString(),
      });
      await env.BOOKINGS.put(key, JSON.stringify(enquiries.slice(0, 200)));
    }

    // Send emails in background — never block or fail the submission response
    const adminHtml = buildAdminEmail({ name, email, phone, room, stayType, stayLabel, dateInfo, checkIn, checkOut, message, price });
    const guestHtml = buildGuestEmail({ name, room, stayLabel, dateInfo, message });
    const emailWork = Promise.all([
      ...TO_EMAILS.map(to => resend(FROM, to, `New Enquiry — ${room} (${name})`, adminHtml, email)),
      resend('Ta.Garden <onboarding@resend.dev>', email, 'We received your enquiry — Ta.Garden', guestHtml),
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

  return Response.json({
    enquiries:  eVal ? JSON.parse(eVal) : [],
    blocked:    bVal ? JSON.parse(bVal) : [],
    icalEvents: iVal ? JSON.parse(iVal) : [],
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

  const html    = action === 'confirm' ? buildConfirmEmail(enq, customMessage) : buildDeclineEmail(enq, customMessage);
  const subject = action === 'confirm'
    ? `Your booking at Ta.Garden is confirmed — ${enq.room}`
    : `Re: Your enquiry at Ta.Garden — ${enq.room}`;

  await resend('Ta.Garden <onboarding@resend.dev>', enq.email, subject, html);
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
    // Save the iCal URL to the property config
    const propVal = await env.BOOKINGS.get('properties');
    const props   = propVal ? JSON.parse(propVal) : [...DEFAULT_PROPERTIES];
    const pIdx    = props.findIndex(p => p.id === propertyId);
    if (pIdx >= 0) { props[pIdx].icalUrl = icalUrl; await env.BOOKINGS.put('properties', JSON.stringify(props)); }

    // Fetch and parse the iCal feed
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

function buildConfirmEmail(enq, customMessage) {
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
        <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px;"><span style="background:#1a1a18;color:#ede0d1;font-size:10px;padding:3px 8px;flex-shrink:0;">03</span><span>We'll confirm check-in details closer to your arrival date</span></div>
      </div>
    </div>
    <a href="https://buy.stripe.com/7sY6oH1rO3CJeMJehC53O02" style="display:block;text-align:center;padding:15px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;">Complete Payment via Stripe →</a>
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

async function resend(from, to, subject, html, replyTo) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
  });
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}
