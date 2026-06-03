const RESEND_API_KEY = 're_Tu3YJdBj_KKyLdGr93ByYaE4FZ13J5Nku';
const TO_EMAILS = ['ashleyedwards305@gmail.com', 'hi@soulandlunawellness.com'];
const FROM = 'Ta.Garden Enquiries <onboarding@resend.dev>';

// Adjust nightly rates here for short stays
const ROOM_RATES = {
  'The River Room':   { monthly: 350, nightly: 25, vnd_monthly: '8,750,000' },
  'The Balcony Room': { monthly: 400, nightly: 30, vnd_monthly: '10,000,000' },
  'The Sky Suite':    { monthly: 680, nightly: 50, vnd_monthly: '17,000,000' },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/api/enquire'            && request.method === 'POST')   return handleEnquiry(request, env, cors);
    if (url.pathname === '/api/availability'        && request.method === 'GET')    return handleAvailability(env, cors);
    if (url.pathname === '/api/admin/enquiries'     && request.method === 'GET')    return handleListEnquiries(request, env, cors);
    if (url.pathname === '/api/admin/enquiry'       && request.method === 'PATCH')  return handleUpdateEnquiry(request, env, cors);
    if (url.pathname === '/api/admin/block'         && request.method === 'POST')   return handleBlock(request, env, cors);
    if (url.pathname === '/api/admin/unblock'       && request.method === 'POST')   return handleUnblock(request, env, cors);

    return env.ASSETS.fetch(request);
  },
};

// ── Enquiry ─────────────────────────────────────────────────────────────────

async function handleEnquiry(request, env, cors) {
  try {
    const { name, email, phone, room, stayType, checkIn, checkOut, message } = await request.json();
    if (!name || !email || !room || !checkIn) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
    }

    const price    = calcPrice(room, stayType, checkIn, checkOut);
    const dateInfo = stayType === 'monthly'
      ? `Move-in: ${fmt(checkIn)}  →  Move-out: ${fmt(checkOut) || 'TBD'}`
      : `Check-in: ${fmt(checkIn)}  →  Check-out: ${fmt(checkOut)}`;
    const stayLabel = stayType === 'monthly' ? 'Monthly Stay' : 'Short Stay';

    // Store enquiry in KV
    if (env.BOOKINGS) {
      const existing = await env.BOOKINGS.get('enquiries');
      const enquiries = existing ? JSON.parse(existing) : [];
      enquiries.unshift({
        id: `enq_${Date.now()}`,
        name, email, phone: phone || '', room, stayType,
        checkIn, checkOut: checkOut || null, message: message || '',
        price: price ? price.total : null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      // Keep last 200 enquiries
      await env.BOOKINGS.put('enquiries', JSON.stringify(enquiries.slice(0, 200)));
    }

    const adminHtml = buildAdminEmail({ name, email, phone, room, stayType, stayLabel, dateInfo, checkIn, checkOut, message, price });
    const guestHtml = buildGuestEmail({ name, room, stayLabel, dateInfo });

    await Promise.all([
      ...TO_EMAILS.map(to => resend(FROM, to, `New Enquiry — ${room}`, adminHtml, email)),
      resend('Ta.Garden <onboarding@resend.dev>', email, 'We received your enquiry — Ta.Garden', guestHtml),
    ]);

    return Response.json({ success: true }, { headers: cors });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to send' }, { status: 500, headers: cors });
  }
}

// ── Availability ─────────────────────────────────────────────────────────────

async function handleAvailability(env, cors) {
  try {
    if (!env.BOOKINGS) return Response.json({ blocked: [] }, { headers: cors });

    const [blockedVal, enquiriesVal] = await Promise.all([
      env.BOOKINGS.get('blocked_ranges'),
      env.BOOKINGS.get('enquiries'),
    ]);

    const blocked   = blockedVal   ? JSON.parse(blockedVal)   : [];
    const enquiries = enquiriesVal ? JSON.parse(enquiriesVal) : [];

    // Add confirmed bookings to blocked ranges so calendar shows them as unavailable
    const confirmedBlocks = enquiries
      .filter(e => e.status === 'confirmed' && e.checkIn && e.checkOut)
      .map(e => ({
        id: e.id,
        start: e.checkIn,
        end: e.checkOut,
        reason: `Booked — ${e.name}`,
        roomId: roomKey(e.room),
      }));

    return Response.json({ blocked: [...blocked, ...confirmedBlocks] }, { headers: cors });
  } catch {
    return Response.json({ blocked: [] }, { headers: cors });
  }
}

// ── Admin: list enquiries ─────────────────────────────────────────────────────

async function handleListEnquiries(request, env, cors) {
  const auth = request.headers.get('x-admin-secret');
  if (!auth || auth !== env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }
  if (!env.BOOKINGS) return Response.json({ enquiries: [], blocked: [] }, { headers: cors });

  const [eVal, bVal] = await Promise.all([
    env.BOOKINGS.get('enquiries'),
    env.BOOKINGS.get('blocked_ranges'),
  ]);

  return Response.json({
    enquiries: eVal ? JSON.parse(eVal) : [],
    blocked:   bVal ? JSON.parse(bVal) : [],
  }, { headers: cors });
}

// ── Admin: update enquiry status ──────────────────────────────────────────────

async function handleUpdateEnquiry(request, env, cors) {
  const auth = request.headers.get('x-admin-secret');
  if (!auth || auth !== env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id, status } = await request.json();
  const val = await env.BOOKINGS.get('enquiries');
  const enquiries = val ? JSON.parse(val) : [];
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  enquiries[idx].status = status;
  await env.BOOKINGS.put('enquiries', JSON.stringify(enquiries));
  return Response.json({ success: true }, { headers: cors });
}

// ── Admin: block / unblock ────────────────────────────────────────────────────

async function handleBlock(request, env, cors) {
  const auth = request.headers.get('x-admin-secret');
  if (!auth || auth !== env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { start, end, reason, roomId } = await request.json();
  const val = await env.BOOKINGS.get('blocked_ranges');
  const ranges = val ? JSON.parse(val) : [];
  const id = `block_${Date.now()}`;
  ranges.push({ id, start, end, reason: reason || 'Blocked', roomId: roomId || 'all' });
  await env.BOOKINGS.put('blocked_ranges', JSON.stringify(ranges));
  return Response.json({ success: true, id }, { headers: cors });
}

async function handleUnblock(request, env, cors) {
  const auth = request.headers.get('x-admin-secret');
  if (!auth || auth !== env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }
  if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });

  const { id } = await request.json();
  const val = await env.BOOKINGS.get('blocked_ranges');
  const ranges = val ? JSON.parse(val) : [];
  await env.BOOKINGS.put('blocked_ranges', JSON.stringify(ranges.filter(r => r.id !== id)));
  return Response.json({ success: true }, { headers: cors });
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

  const whatsappLink = phone
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
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;width:120px;border-bottom:1px solid rgba(136,145,125,0.15);">Guest</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);font-weight:400;">${name}</td></tr>
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Email</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);"><a href="mailto:${email}" style="color:#a0856c;text-decoration:none;">${email}</a></td></tr>
      ${phone ? `<tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">WhatsApp</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);"><a href="https://wa.me/${phone.replace(/[^0-9]/g,'')}" style="color:#25D366;text-decoration:none;">${phone}</a></td></tr>` : ''}
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Check-in</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${fmt(checkIn)}</td></tr>
      <tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Check-out</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${checkOut ? fmt(checkOut) : '—'}</td></tr>
      ${price ? `<tr><td style="padding:10px 0;font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Duration</td><td style="padding:10px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${price.duration}</td></tr>` : ''}
    </table>
    ${message ? `<div style="padding:16px;background:#fff;border-left:3px solid #a0856c;margin-bottom:20px;"><div style="font-size:10px;letter-spacing:0.13em;text-transform:uppercase;color:#88917d;margin-bottom:8px;">Message from ${name.split(' ')[0]}</div><div style="font-size:14px;line-height:1.75;color:#1a1a18;">${message}</div></div>` : ''}
    <div>
      ${whatsappLink}
      <a href="mailto:${email}?subject=Re: ${encodeURIComponent(room)} — Ta.Garden" style="display:inline-block;padding:12px 26px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;">Email ${name.split(' ')[0]}</a>
    </div>
  </div>
  <div style="padding:12px 28px;background:#e8e2dc;text-align:center;">
    <span style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#88917d;">Ta.Garden · Cam Nam Island, Hội An</span>
  </div>
</div>`;
}

function buildGuestEmail({ name, room, stayLabel, dateInfo }) {
  return `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">Cam Nam Island · Hội An, Vietnam</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${name.split(' ')[0]},</p>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 14px;">Thank you for your enquiry about <strong>${room}</strong>. We've received your message and will be in touch within 24 hours.</p>
    <div style="background:#fff;padding:16px;border:1px solid rgba(136,145,125,0.2);margin:20px 0;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:10px;">Your Request</div>
      <div style="font-size:14px;color:#1a1a18;margin-bottom:4px;">${room} &nbsp;·&nbsp; ${stayLabel}</div>
      <div style="font-size:13px;color:#88917d;">${dateInfo}</div>
    </div>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;">We look forward to welcoming you to Ta.Garden.</p>
    <p style="font-size:14px;color:#4a4a45;margin:0;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">Questions? hi@soulandlunawellness.com</div>
  </div>
</div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcPrice(room, stayType, checkIn, checkOut) {
  const rates = ROOM_RATES[room];
  if (!rates || !checkIn || !checkOut) return null;

  const days = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (days <= 0) return null;

  if (stayType === 'monthly') {
    const months = Math.round((days / 30) * 10) / 10; // 1 decimal
    const total  = Math.round(months * rates.monthly);
    return {
      duration: `${days} days (~${months} month${months !== 1 ? 's' : ''})`,
      rate: `$${rates.monthly}/month`,
      breakdown: `${months} mo × $${rates.monthly}`,
      total,
    };
  } else {
    const nights = days;
    return {
      duration: `${nights} night${nights !== 1 ? 's' : ''}`,
      rate: `$${rates.nightly}/night`,
      breakdown: `${nights} × $${rates.nightly}`,
      total: nights * rates.nightly,
    };
  }
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
