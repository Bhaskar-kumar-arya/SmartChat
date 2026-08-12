const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');

if (!parentPort) {
  throw new Error('This plugin must be run inside a Node.js Worker thread.');
}

const manifest = require('./manifest.json');
const runtime = new WorkerPluginRuntime(parentPort, manifest);
const ctx = runtime.getContext();

// --- Constants ---
const CLIENT_ID = '31639bab-6a5c-4f74-bdbd-86c0fc225262';
const REDIRECT_URI = 'https://auth.codetantra.com';
const SCOPE = 'User.Read openid profile offline_access';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const CODETANTRA_CALLBACK_ID = '30yekkmun1fe72gk79u';
const BASE_URL = 'https://iiitb.codetantra.com';
const MEETINGS_API_URL = `${BASE_URL}/secure/rest/dd/mf`;
const OTP_SUBMIT_URL = `${BASE_URL}/secure/rest/dd/muap`;
const RELAY_HEADER = '[CODETANTRA_OTP_RELAY]';
const AUTO_AUTH_INTERVAL_MS = 20 * 60 * 1000; // 20 Minutes

let cachedSession = null;
let cachedSessionExpiresAt = 0;

ctx.onActivate(async () => {
  ctx.log.info('CodeTantra OTP Relay Plugin activated');

  // Initial session warm-up & class fetch
  ensureActiveSession().then(async (session) => {
    if (session) {
      await fetchMeetings();
    }
  }).catch(err => {
    ctx.log.warn('Initial CodeTantra session warm-up deferred:', err.message);
  });

  // Background Proactive Re-Auth Timer (every 20 mins)
  setInterval(async () => {
    ctx.log.info('🔄 [Auto-Auth] 20 mins elapsed. Renewing session and updating meetings...');
    try {
      const session = await ensureActiveSession(true);
      if (session) {
        await fetchMeetings();
      }
    } catch (err) {
      ctx.log.error('⚠️ [Auto-Auth] Proactive session renewal failed:', err);
    }
  }, AUTO_AUTH_INTERVAL_MS);

  // Register message incoming event handler
  if (ctx.events) {
    ctx.events.on('message:incoming', async (evt) => {
      ctx.log.info(`[CodeTantra Relay] 📩 Event received: message:incoming (chatJid: ${evt?.chatJid}, sender: ${evt?.senderJid}, fromMe: ${evt?.fromMe})`);
      try {
        await handleIncomingMessage(evt);
      } catch (err) {
        ctx.log.error('[CodeTantra Relay] Error handling incoming message:', err);
      }
    });
  }
});

// --- Storage Helpers ---

async function getStoredTokens() {
  if (!ctx.storage) return null;
  return await ctx.storage.get('codetantra_tokens');
}

async function saveTokens(tokens) {
  if (!ctx.storage) return;
  await ctx.storage.set('codetantra_tokens', tokens);
}

async function getTargetGroupJid() {
  if (!ctx.storage) return null;
  return await ctx.storage.get('targetGroupJid');
}

async function getAttendanceLogs() {
  if (!ctx.storage) return [];
  const logs = await ctx.storage.get('attendance_logs');
  return Array.isArray(logs) ? logs : [];
}

async function logAttendance(entry) {
  if (!ctx.storage) return;
  const logs = await getAttendanceLogs();
  logs.unshift({
    timestamp: new Date().toISOString(),
    epoch: Math.floor(Date.now() / 1000),
    ...entry
  });
  await ctx.storage.set('attendance_logs', logs.slice(0, 100));
}

// Token Refresh via Microsoft OAuth
async function refreshTokens(refreshToken) {
  ctx.log.info('[OAuth] Refreshing tokens with Microsoft endpoint...');
  try {
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('grant_type', 'refresh_token');
    params.append('scope', SCOPE);
    params.append('refresh_token', refreshToken);

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': REDIRECT_URI
      },
      body: params.toString()
    });

    if (!res.ok) {
      const errText = await res.text();
      ctx.log.error('[OAuth] Token refresh failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    if (data.refresh_token || refreshToken) {
      const newTokens = {
        access_token: data.access_token,
        id_token: data.id_token,
        refresh_token: data.refresh_token || refreshToken,
        expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
      };
      await saveTokens(newTokens);
      ctx.log.info('[OAuth] New tokens acquired successfully.');
      return newTokens;
    }
    return null;
  } catch (err) {
    ctx.log.error('[OAuth] Exception during refreshTokens:', err);
    return null;
  }
}

// Login to CodeTantra using ID token to get session cookies
async function loginToCodeTantra(idToken) {
  ctx.log.info('[CodeTantra Login] Exchanging ID token with CodeTantra callback...');
  try {
    const loginUrl = `${REDIRECT_URI}/r/oa/${CODETANTRA_CALLBACK_ID}/${idToken}/microsoft`;
    let cookieMap = new Map();

    let res = await fetch(loginUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      redirect: 'manual'
    });

    const parseAndSaveCookies = (response) => {
      const getSetCookie = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') || ''];
      
      for (const headerStr of getSetCookie) {
        if (!headerStr) continue;
        const parts = headerStr.split(',').flatMap(p => p.split(';'));
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.includes('=') && !trimmed.toLowerCase().startsWith('path=') && !trimmed.toLowerCase().startsWith('domain=') && !trimmed.toLowerCase().startsWith('expires=')) {
            const [k, v] = trimmed.split('=');
            if (k && v) cookieMap.set(k.trim(), v.trim());
          }
        }
      }
    };

    parseAndSaveCookies(res);

    const location = res.headers.get('location');
    if (location) {
      const followUrl = location.startsWith('http') ? location : `https://iiitb.codetantra.com${location}`;
      const cookieStr = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
      
      const res2 = await fetch(followUrl, {
        method: 'GET',
        headers: {
          'Cookie': cookieStr,
          'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        },
        redirect: 'manual'
      });
      parseAndSaveCookies(res2);
    }

    const finalCookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    ctx.log.info('[CodeTantra Login] Cookies acquired:', finalCookies ? `YES (${cookieMap.size} cookies)` : 'NO');
    
    return {
      success: cookieMap.size > 0 || true,
      cookies: finalCookies
    };
  } catch (err) {
    ctx.log.error('Failed to log in to CodeTantra:', err);
    return { success: false, cookies: '', error: err.message };
  }
}

// Returns fast pre-authenticated session (or renews if forced/expired)
async function ensureActiveSession(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSession && cachedSession.success && now < cachedSessionExpiresAt) {
    return cachedSession;
  }

  let tokens = await getStoredTokens();
  if (!tokens || !tokens.refresh_token) {
    ctx.log.warn('[Session] No stored refresh token found.');
    return null;
  }

  const refreshed = await refreshTokens(tokens.refresh_token);
  if (refreshed) {
    tokens = refreshed;
  } else if (!tokens.id_token) {
    ctx.log.error('[Session] Token refresh returned no id_token.');
    return null;
  }

  const loginRes = await loginToCodeTantra(tokens.id_token);
  if (loginRes.success) {
    cachedSession = loginRes;
    cachedSessionExpiresAt = now + AUTO_AUTH_INTERVAL_MS;
    ctx.log.info('✅ CodeTantra Session active & cached.');
    return cachedSession;
  }
  return null;
}

function toMs(ts) {
  if (!ts) return 0;
  const num = Number(ts);
  if (isNaN(num)) return 0;
  return num < 1e11 ? num * 1000 : num;
}

// Fetch active meetings from CodeTantra API
async function fetchMeetings(targetDateMs = null) {
  ctx.log.info('[Meetings Fetch] Starting meeting retrieval...');
  const session = await ensureActiveSession();
  if (!session) {
    ctx.log.error('[Meetings Fetch] Session is null or unauthenticated.');
    if (ctx.storage) await ctx.storage.set('codetantra_meetings_log', 'Unauthenticated: Please log in under Account Auth.');
    return { success: false, error: 'NOT_AUTHENTICATED', meetings: [] };
  }

  try {
    const baseTime = (targetDateMs && !isNaN(targetDateMs)) ? Number(targetDateMs) : Date.now();
    const baseDate = new Date(baseTime);
    const dayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
    
    // Fetch 14 days prior to 21 days in future to cover past & upcoming schedule
    const minDate = dayStart - (14 * 24 * 60 * 60 * 1000);
    const maxDate = dayStart + (21 * 24 * 60 * 60 * 1000);

    const payload = {
      minDate: minDate,
      maxDate: maxDate,
      filters: { showSelf: true, status: 'started,ended,scheduled,upcoming,ongoing,completed' }
    };

    ctx.log.info('[Meetings Fetch] Sending POST request to:', MEETINGS_API_URL);

    const res = await fetch(MEETINGS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': session.cookies,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    ctx.log.info('[Meetings Fetch] HTTP Response Status:', res.status);

    if (!res.ok) {
      const errTxt = await res.text();
      ctx.log.error('[Meetings Fetch] Response error text:', errTxt);
      if (ctx.storage) await ctx.storage.set('codetantra_meetings_log', `HTTP Error ${res.status}: ${errTxt.substring(0, 100)}`);
      return { success: false, error: `HTTP ${res.status}`, meetings: [] };
    }

    const data = await res.json();
    ctx.log.info('[Meetings Fetch] API Response data parsed. Keys:', Object.keys(data));

    if (!data || !Array.isArray(data.ref)) {
      ctx.log.warn('[Meetings Fetch] data.ref is not an array. Raw response:', JSON.stringify(data).substring(0, 200));
      if (ctx.storage) {
        await ctx.storage.set('codetantra_meetings', []);
        await ctx.storage.set('codetantra_meetings_log', `No classes array in API response (${new Date().toLocaleTimeString()})`);
      }
      return { success: true, meetings: [] };
    }

    const meetings = [];
    data.ref.forEach(m => {
      const rawTitle = m.title || 'Untitled Meeting';
      const status = m.status || 'unknown';

      if (m.extra?.recurrence?.slots?.length > 0) {
        m.extra.recurrence.slots.forEach(slot => {
          const meetingId = slot.id || m._id;
          const startTimeMs = toMs(slot.start || slot.startTime || m.startTime);
          const endTimeMs = toMs(slot.end || slot.endTime || m.endTime) || (startTimeMs ? startTimeMs + (60 * 60 * 1000) : 0);
          const dateStr = startTimeMs ? new Date(startTimeMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          const displayTitle = dateStr ? `${rawTitle} (${dateStr})` : rawTitle;

          meetings.push({
            id: meetingId,
            title: rawTitle,
            displayTitle: displayTitle,
            status: status,
            startTime: startTimeMs,
            endTime: endTimeMs,
            url: `${BASE_URL}/secure/tla/mi.jsp?s=m&m=${meetingId}`
          });
        });
      } else {
        const meetingId = m._id;
        const startTimeMs = toMs(m.startTime);
        const endTimeMs = toMs(m.endTime) || (startTimeMs ? startTimeMs + (60 * 60 * 1000) : 0);
        const dateStr = startTimeMs ? new Date(startTimeMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const displayTitle = dateStr ? `${rawTitle} (${dateStr})` : rawTitle;

        meetings.push({
          id: meetingId,
          title: rawTitle,
          displayTitle: displayTitle,
          status: status,
          startTime: startTimeMs,
          endTime: endTimeMs,
          url: `${BASE_URL}/secure/tla/mi.jsp?s=m&m=${meetingId}`
        });
      }
    });

    ctx.log.info(`[Meetings Fetch] Successfully retrieved ${meetings.length} meetings.`);

    if (ctx.storage) {
      await ctx.storage.set('codetantra_meetings', meetings);
      await ctx.storage.set('codetantra_meetings_log', `Loaded ${meetings.length} classes at ${new Date().toLocaleTimeString()}`);
    }

    return { success: true, meetings };
  } catch (err) {
    ctx.log.error('[Meetings Fetch] Exception:', err);
    if (ctx.storage) await ctx.storage.set('codetantra_meetings_log', `Error: ${err.message}`);
    return { success: false, error: err.message, meetings: [] };
  }
}

// Submit OTP to CodeTantra API
async function submitOtpToCodeTantra(meetingId, otp, meetingUrl, title = 'Class Attendance') {
  ctx.log.info(`[OTP Submit] Submitting OTP ${otp} for meeting ${meetingId}...`);
  const session = await ensureActiveSession();
  if (!session) {
    ctx.log.error('[OTP Submit] Session unauthenticated.');
    return { success: false, message: 'Not authenticated with CodeTantra' };
  }

  try {
    const referer = meetingUrl || `${BASE_URL}/secure/tla/mi.jsp?s=m&m=${meetingId}`;
    const res = await fetch(OTP_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': referer,
        'Cookie': session.cookies,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      body: JSON.stringify({ code: otp, mid: meetingId })
    });

    if (!res.ok) {
      ctx.log.error('[OTP Submit] HTTP error:', res.status);
      return { success: false, message: `HTTP Error ${res.status}` };
    }

    const data = await res.json();
    ctx.log.info('[OTP Submit] Response:', JSON.stringify(data));

    const msg = data.msg || '';
    const result = data.result;

    if (result === 0 || msg.toLowerCase().includes('success') || (result === -1 && msg.toLowerCase().includes('already'))) {
      const isAlready = result === -1 && msg.toLowerCase().includes('already');
      const statusText = isAlready ? 'Already Marked' : 'Success';
      
      await logAttendance({
        title,
        id: meetingId,
        value: otp,
        status: statusText
      });

      return { success: true, message: msg || statusText };
    } else {
      await logAttendance({
        title,
        id: meetingId,
        value: otp,
        status: `Failed: ${msg}`
      });

      return { success: false, message: msg || 'Submission failed' };
    }
  } catch (err) {
    ctx.log.error('Error submitting OTP:', err);
    return { success: false, message: err.message };
  }
}

// Send OTP broadcast payload to Target Group Chat
async function broadcastOtpToGroup(targetGroupJid, meetingId, otp, meetingTitle, meetingUrl) {
  if (!ctx.messages || !targetGroupJid) return false;

  // IMPORTANT: Do NOT include a full https:// URL in the broadcast payload.
  // Baileys (with generateHighQualityLinkPreview:true) scans message text for URLs
  // and fetches them to build link previews — causing ~2-3s delay per message.
  // Instead, store only the path fragment; receivers reconstruct the full URL.
  const meetingPath = `/secure/tla/mi.jsp?s=m&m=${meetingId}`;

  const payload = {
    type: 'CODETANTRA_OTP_RELAY',
    otp: otp,
    meetingId: meetingId,
    meetingTitle: meetingTitle,
    meetingPath: meetingPath,
    timestamp: Date.now()
  };

  const textMessage = `${RELAY_HEADER}\n${JSON.stringify(payload, null, 2)}`;
  
  try {
    await ctx.messages.send(targetGroupJid, textMessage);
    return true;
  } catch (err) {
    ctx.log.error('Failed to send OTP broadcast to group:', err);
    return false;
  }
}

// Handle incoming messages for automatic OTP detection & submission
async function handleIncomingMessage(evt) {
  if (!evt) return;

  // Always log incoming message to persistent storage audit trail
  if (ctx.storage) {
    try {
      const logs = (await ctx.storage.get('incoming_message_log')) || [];
      const entry = {
        timestamp: new Date().toISOString(),
        senderJid: evt.senderJid || 'unknown',
        chatJid: evt.chatJid || 'unknown',
        fromMe: Boolean(evt.fromMe),
        snippet: evt.textContent ? evt.textContent.slice(0, 100) : '[No Text]',
        hasRelayHeader: Boolean(evt.textContent && evt.textContent.includes(RELAY_HEADER))
      };
      logs.unshift(entry);
      await ctx.storage.set('incoming_message_log', logs.slice(0, 100));
    } catch (err) {
      ctx.log.warn('[CodeTantra Relay] Failed to write incoming_message_log to storage:', err);
    }
  }

  if (!evt.textContent) {
    ctx.log.info('[CodeTantra Relay] Incoming message skipped: empty text content');
    return;
  }
  if (evt.fromMe) {
    ctx.log.info('[CodeTantra Relay] Incoming message skipped: sent by self');
    return;
  }

  const targetJid = await getTargetGroupJid();
  if (!targetJid) {
    ctx.log.info('[CodeTantra Relay] Incoming message skipped: target group JID not set');
    return;
  }
  if (evt.chatJid !== targetJid) {
    ctx.log.info(`[CodeTantra Relay] Incoming message skipped: chatJid '${evt.chatJid}' does not match target group JID '${targetJid}'`);
    return;
  }

  ctx.log.info(`[CodeTantra Relay] 📥 Target group message received from ${evt.senderJid}: "${evt.textContent.slice(0, 100)}"`);

  if (!evt.textContent.includes(RELAY_HEADER)) {
    ctx.log.info('[CodeTantra Relay] Target group message skipped: does not contain CODETANTRA_OTP_RELAY header');
    return;
  }

  try {
    const jsonStr = evt.textContent.substring(evt.textContent.indexOf(RELAY_HEADER) + RELAY_HEADER.length).trim();
    const data = JSON.parse(jsonStr);

    if (data.type === 'CODETANTRA_OTP_RELAY' && data.otp && data.meetingId) {
      const otp = String(data.otp).trim();
      const meetingId = String(data.meetingId).trim();
      const meetingTitle = data.meetingTitle || 'CodeTantra Class';
      // Reconstruct full URL from path fragment (avoids link preview fetch on sender side)
      const meetingUrl = data.meetingUrl ||
        (data.meetingPath ? `${BASE_URL}${data.meetingPath}` : `${BASE_URL}/secure/tla/mi.jsp?s=m&m=${meetingId}`);

      if (!/^\d{6}$/.test(otp)) {
        ctx.log.warn(`[CodeTantra Relay] Invalid OTP format in payload: '${otp}'`);
        return;
      }

      ctx.log.info(`🎯 Instant OTP capture: ${otp} for meeting ${meetingId} in target group`);

      const res = await submitOtpToCodeTantra(meetingId, otp, meetingUrl, meetingTitle);

      const msgId = evt.messageId || evt.id || (evt.processed && evt.processed.id) || (evt.enriched && evt.enriched.id);
      if (ctx.messages && ctx.messages.react && msgId) {
        const emoji = res.success ? '✅' : '❌';
        await ctx.messages.react(evt.chatJid, msgId, emoji);
      }

      if (ctx.ui && ctx.ui.toast) {
        if (res.success) {
          ctx.ui.toast(`✅ Attendance marked for ${meetingTitle} (OTP: ${otp})`, 'success');
        } else {
          ctx.ui.toast(`❌ OTP Submission failed for ${meetingTitle}: ${res.message}`, 'error');
        }
      }
    } else {
      ctx.log.warn('[CodeTantra Relay] Message contained RELAY_HEADER but payload structure was invalid:', data);
    }
  } catch (err) {
    ctx.log.error('Failed to parse or process incoming OTP relay message:', err);
  }
}

// --- Slash Commands & Chat Actions ---

async function handleRelayOtpFlow(cmdCtx) {
  const targetJid = await getTargetGroupJid();
  
  if (!targetJid) {
    if (ctx.ui && ctx.ui.toast) {
      ctx.ui.toast('⚠️ Target Group Chat is not configured yet. Please open the CodeTantra Panel to select a target group.', 'warning');
    }
    await ctx.ui?.openPanel?.('codetantra-dashboard');
    return;
  }

  const meetingsRes = await fetchMeetings();
  if (!meetingsRes.success || meetingsRes.meetings.length === 0) {
    if (ctx.ui && ctx.ui.toast) {
      ctx.ui.toast('❌ No active meetings found or not authenticated with CodeTantra.', 'error');
    }
    return;
  }

  const meetingOptions = meetingsRes.meetings.map(m => ({
    label: `${m.title} [${m.status}]`,
    value: m.id
  }));

  const formResult = await ctx.ui.showForm({
    title: 'Relay CodeTantra OTP',
    fields: [
      {
        id: 'meetingId',
        type: 'select',
        label: 'Select Class / Meeting',
        required: true,
        options: meetingOptions,
        defaultValue: meetingOptions[0]?.value
      },
      {
        id: 'otp',
        type: 'text',
        label: '6-Digit OTP',
        placeholder: 'e.g. 123456',
        required: true
      }
    ]
  });

  if (!formResult || !formResult.meetingId || !formResult.otp) return;

  const otp = String(formResult.otp).trim();
  const selectedMeeting = meetingsRes.meetings.find(m => m.id === formResult.meetingId);
  const meetingTitle = selectedMeeting ? selectedMeeting.title : 'CodeTantra Class';
  const meetingUrl = selectedMeeting ? selectedMeeting.url : '';

  if (!/^\d{6}$/.test(otp)) {
    if (ctx.ui && ctx.ui.toast) {
      ctx.ui.toast('❌ Invalid OTP format. Must be a 6-digit number.', 'error');
    }
    return;
  }

  ctx.log.info(`Broadcasting and submitting OTP ${otp} for meeting ${formResult.meetingId}`);
  
  const [selfRes, broadcastRes] = await Promise.all([
    submitOtpToCodeTantra(formResult.meetingId, otp, meetingUrl, meetingTitle),
    broadcastOtpToGroup(targetJid, formResult.meetingId, otp, meetingTitle, meetingUrl)
  ]);

  if (ctx.ui && ctx.ui.toast) {
    if (selfRes.success && broadcastRes) {
      ctx.ui.toast(`🚀 OTP ${otp} submitted for self and broadcasted to group!`, 'success');
    } else if (selfRes.success) {
      ctx.ui.toast(`✅ OTP submitted for self, but broadcast failed.`, 'warning');
    } else {
      ctx.ui.toast(`❌ Failed to submit OTP for self: ${selfRes.message}`, 'error');
    }
  }
}

ctx.contributions.registerSlashCommand('relay-otp', handleRelayOtpFlow);
ctx.contributions.registerChatAction('action.codetantra.relay-otp', handleRelayOtpFlow);

ctx.contributions.registerSlashCommand('codetantra', async () => {
  if (ctx.ui && ctx.ui.openPanel) {
    await ctx.ui.openPanel('codetantra-dashboard');
  }
});

if (ctx.contributions.registerAITool) {
  ctx.contributions.registerAITool('codetantra_refresh_meetings', async () => {
    ctx.log.info('[AITool] Live meetings refresh requested');
    const res = await fetchMeetings();
    return { text: res.success ? `Success: ${res.meetings.length} classes loaded` : `Failed: ${res.error}` };
  });

  ctx.contributions.registerAITool('codetantra_submit_otp', async (args) => {
    const meetingId = String(args.meetingId || '').trim();
    const otp = String(args.otp || '').trim();
    const title = String(args.meetingTitle || 'Class Attendance').trim();
    if (!meetingId || !otp) {
      return { text: 'Error: meetingId and otp are required.' };
    }
    const res = await submitOtpToCodeTantra(meetingId, otp, '', title);
    return { text: res.success ? `Success: ${res.message}` : `Failed: ${res.message}` };
  });
}

if (ctx.ai && ctx.ai.registerTool) {
  ctx.ai.registerTool({
    name: 'codetantra_refresh_meetings',
    description: 'Refreshes live meetings schedule from CodeTantra API',
    schema: {
      type: 'object',
      properties: {}
    }
  }).catch(err => ctx.log.error('Failed to register codetantra_refresh_meetings in ToolRegistry:', err.message));

  ctx.ai.registerTool({
    name: 'codetantra_submit_otp',
    description: 'Submits CodeTantra OTP for a class meeting via Node background session',
    schema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string' },
        otp: { type: 'string' },
        meetingTitle: { type: 'string' }
      },
      required: ['meetingId', 'otp']
    }
  }).catch(err => ctx.log.error('Failed to register codetantra_submit_otp in ToolRegistry:', err.message));
}



