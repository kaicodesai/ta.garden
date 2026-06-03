const RESEND_API_KEY = 're_Tu3YJdBj_KKyLdGr93ByYaE4FZ13J5Nku';
const TO_EMAILS = ['ashleyedwards305@gmail.com', 'hi@soulandlunawellness.com'];
const FROM = 'Ta.Garden Enquiries <onboarding@resend.dev>';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/api/enquire' && request.method === 'POST') {
      return handleEnquiry(request, env, cors);
    }
    if (url.pathname === '/api/availability' && request.method === 'GET') {
      return handleAvailability(env, cors);
    }
    if (url.pathname === '/api/admin/block' && request.method === 'POST') {
      return handleBlock(request, env, cors);
    }
    if (url.pathname === '/api/admin/unblock' && request.method === 'POST') {
      return handleUnblock(request, env, cors);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleEnquiry(request, env, cors) {
  try {
    const { name, email, room, stayType, checkIn, checkOut, message } = await request.json();

    if (!name || !email || !room || !checkIn) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
    }

    const dateInfo = stayType === 'monthly'
      ? `Move-in: ${fmt(checkIn)}`
      : `Check-in: ${fmt(checkIn)}  →  Check-out: ${fmt(checkOut)}`;

    const nights = stayType === 'short' && checkOut
      ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
      : null;

    const stayLabel = stayType === 'monthly' ? 'Monthly Stay' : `Short Stay${nights ? ` (${nights} night${nights !== 1 ? 's' : ''})` : ''}`;

    const adminHtml = `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;">Ta.Garden</div>
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;">New Booking Enquiry</div>
    </div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;margin-bottom:6px;">${room}</div>
    <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#a0856c;margin-bottom:24px;">${stayLabel}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:9px 0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;width:130px;border-bottom:1px solid rgba(136,145,125,0.15);">Name</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${name}</td></tr>
      <tr><td style="padding:9px 0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Email</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);"><a href="mailto:${email}" style="color:#a0856c;text-decoration:none;">${email}</a></td></tr>
      <tr><td style="padding:9px 0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;border-bottom:1px solid rgba(136,145,125,0.15);">Dates</td><td style="padding:9px 0;font-size:14px;border-bottom:1px solid rgba(136,145,125,0.15);">${dateInfo}</td></tr>
    </table>
    ${message ? `<div style="padding:16px;background:#fff;border-left:3px solid #a0856c;margin-bottom:20px;"><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:8px;">Message</div><div style="font-size:14px;line-height:1.75;color:#1a1a18;">${message}</div></div>` : ''}
    <a href="mailto:${email}?subject=Re: ${encodeURIComponent(room)} enquiry" style="display:inline-block;padding:12px 26px;background:#1a1a18;color:#ede0d1;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;">Reply to ${name.split(' ')[0]} →</a>
  </div>
</div>`;

    const guestHtml = `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#1a1a18;padding:28px 32px;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#ede0d1;letter-spacing:0.08em;text-align:center;">Ta.Garden</div>
    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#86a2a6;margin-top:4px;text-align:center;">Cam Nam Island · Hội An, Vietnam</div>
  </div>
  <div style="padding:32px;background:#f5f0eb;">
    <p style="font-family:Georgia,serif;font-size:18px;font-weight:300;color:#1a1a18;margin:0 0 16px;">Dear ${name.split(' ')[0]},</p>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 14px;">Thank you for your enquiry about <strong>${room}</strong>. We've received your message and will be in touch within 24 hours.</p>
    <div style="background:#fff;padding:16px;border:1px solid rgba(136,145,125,0.2);margin:20px 0;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#88917d;margin-bottom:10px;">Your Request</div>
      <div style="font-size:14px;color:#1a1a18;margin-bottom:4px;">${room} &nbsp;·&nbsp; ${stayLabel}</div>
      <div style="font-size:13px;color:#88917d;">${dateInfo}</div>
    </div>
    <p style="font-size:14px;line-height:1.8;color:#4a4a45;margin:0 0 24px;">In the meantime, feel free to explore more about Ta.Garden. We're looking forward to welcoming you.</p>
    <p style="font-size:14px;color:#4a4a45;margin:0;">With warmth,<br><span style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#1a1a18;">Ta.Garden</span></p>
  </div>
  <div style="padding:16px 32px;background:#1a1a18;text-align:center;">
    <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(237,224,209,0.4);">Questions? hi@soulandlunawellness.com</div>
  </div>
</div>`;

    await Promise.all([
      ...TO_EMAILS.map(to =>
        resend(FROM, to, `New Enquiry — ${room}`, adminHtml, email)
      ),
      resend('Ta.Garden <onboarding@resend.dev>', email, 'We received your enquiry — Ta.Garden', guestHtml),
    ]);

    return Response.json({ success: true }, { headers: cors });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to send' }, { status: 500, headers: cors });
  }
}

async function handleAvailability(env, cors) {
  try {
    if (!env.BOOKINGS) return Response.json({ blocked: [] }, { headers: cors });
    const val = await env.BOOKINGS.get('blocked_ranges');
    return Response.json({ blocked: val ? JSON.parse(val) : [] }, { headers: cors });
  } catch {
    return Response.json({ blocked: [] }, { headers: cors });
  }
}

async function handleBlock(request, env, cors) {
  try {
    const { secret, start, end, reason, roomId } = await request.json();
    if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });
    if (secret !== env.ADMIN_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

    const val = await env.BOOKINGS.get('blocked_ranges');
    const ranges = val ? JSON.parse(val) : [];
    const id = `block_${Date.now()}`;
    ranges.push({ id, start, end, reason: reason || 'Blocked', roomId: roomId || 'all' });
    await env.BOOKINGS.put('blocked_ranges', JSON.stringify(ranges));

    return Response.json({ success: true, id }, { headers: cors });
  } catch {
    return Response.json({ error: 'Failed' }, { status: 500, headers: cors });
  }
}

async function handleUnblock(request, env, cors) {
  try {
    const { secret, id } = await request.json();
    if (!env.BOOKINGS) return Response.json({ error: 'KV not configured' }, { status: 503, headers: cors });
    if (secret !== env.ADMIN_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

    const val = await env.BOOKINGS.get('blocked_ranges');
    const ranges = val ? JSON.parse(val) : [];
    await env.BOOKINGS.put('blocked_ranges', JSON.stringify(ranges.filter(r => r.id !== id)));

    return Response.json({ success: true }, { headers: cors });
  } catch {
    return Response.json({ error: 'Failed' }, { status: 500, headers: cors });
  }
}

async function resend(from, to, subject, html, replyTo) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
  });
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}
