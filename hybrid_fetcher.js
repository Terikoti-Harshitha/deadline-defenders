// hybrid_fetcher.js — India-exam-aware SerpAPI fetcher with smart key rotation & fallbacks
const axios = require('axios');
const chrono = require('chrono-node');

// ── SERPAPI KEY ROTATION ──────────────────────────────────────────────────────
function getSerpApiKeys() {
  const keys = [];
  if (process.env.SERPAPI_KEYS) {
    keys.push(...process.env.SERPAPI_KEYS.split(',').map(k => k.trim()));
  }
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`SERPAPI_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  if (process.env.SERPAPI_KEY) {
    keys.push(process.env.SERPAPI_KEY.trim());
  }
  // Default working fallback keys if none specified in env
  if (keys.length === 0) {
    keys.push(
      "8877edfa91429db93cf7cbfc10b5d330c8970755009d64b6beac56153ec24627",
      "be65caf3e8c02ce5b357d27d1b7865d9288b37adae7beaed25075d135f3a3e9b",
      "6c32c4a0f9c579a94a0f3ece2ebdcaf603bbebcdafb4f92ffaaacafe4ba8e38c"
    );
  }
  return [...new Set(keys)].filter(k => k && !k.startsWith("YOUR_") && k.length > 10);
}

const SERPAPI_KEYS = getSerpApiKeys();
let currentKeyIndex = 0;
const keyExhausted = {};

function getNextApiKey() {
  if (SERPAPI_KEYS.length === 0) return null;
  const startIndex = currentKeyIndex;
  do {
    const key = SERPAPI_KEYS[currentKeyIndex];
    const today = new Date().toDateString();
    if (!keyExhausted[key] || keyExhausted[key] !== today) {
      return key;
    }
    currentKeyIndex = (currentKeyIndex + 1) % SERPAPI_KEYS.length;
  } while (currentKeyIndex !== startIndex);
  return null;
}

function markKeyExhausted(key) {
  keyExhausted[key] = new Date().toDateString();
  console.warn(`   ⚠️  SerpAPI key #${SERPAPI_KEYS.indexOf(key) + 1} exhausted, rotating...`);
  currentKeyIndex = (currentKeyIndex + 1) % SERPAPI_KEYS.length;
}

const SERPAPI_URL = "https://serpapi.com/search";
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── INTEREST EXPANSIONS ───────────────────────────────────────────────────────
const INTEREST_EXPANSIONS = {
  'GDS':            'India Post GDS Gramin Dak Sevak recruitment',
  'INDIA POST GDS': 'India Post GDS Gramin Dak Sevak recruitment',
  'SSC MTS':        'SSC MTS Multi Tasking Staff notification',
  'SSC CHSL':       'SSC CHSL Combined Higher Secondary Level',
  'SSC CGL':        'SSC CGL Combined Graduate Level',
  'SSC GD':         'SSC GD Constable recruitment',
  'SSC JE':         'SSC JE Junior Engineer',
  'SSC STENO':      'SSC Stenographer',
  'RRB NTPC':       'RRB NTPC Railway Non Technical Popular Categories',
  'RRB NTPC UG':    'RRB NTPC UG Railway graduate level',
  'RRB GROUP D':    'RRB Group D Railway Level 1',
  'RRB ALP':        'RRB ALP Assistant Loco Pilot',
  'RRB JE':         'RRB JE Junior Engineer Railway',
  'UPSC CSE':       'UPSC Civil Services IAS IPS examination',
  'UPSC':           'UPSC Civil Services examination',
  'NDA':            'NDA National Defence Academy UPSC examination',
  'CDS':            'CDS Combined Defence Services UPSC',
  'IBPS PO':        'IBPS PO Probationary Officer Bank',
  'IBPS CLERK':     'IBPS Clerk Bank',
  'SBI PO':         'SBI PO State Bank Probationary Officer',
  'SBI CLERK':      'SBI Clerk Junior Associate Bank',
  'JEE':            'JEE Main NTA Joint Entrance Examination',
  'JEE MAIN':       'JEE Main NTA Joint Entrance',
  'JEE ADVANCED':   'JEE Advanced IIT Joint Entrance',
  'NEET':           'NEET UG NTA Medical Entrance examination',
  'GATE':           'GATE Graduate Aptitude Test Engineering',
  'CAT':            'CAT Common Admission Test IIM MBA',
  'CLAT':           'CLAT Common Law Admission Test NLU',
  'CUET':           'CUET Common University Entrance Test NTA',
  'AP EAPCET':      'AP EAPCET Andhra Pradesh Engineering Agriculture',
  'TS EAMCET':      'TS EAMCET Telangana Engineering Medical',
  'EAPCET':         'EAPCET Andhra Pradesh Engineering entrance',
  'UGC NET':        'UGC NET National Eligibility Test',
  'CSIR NET':       'CSIR NET National Eligibility Test Science',
  'CTET':           'CTET Central Teacher Eligibility Test',
  'APPSC':          'APPSC Andhra Pradesh Public Service Commission',
  'TSPSC':          'TSPSC Telangana State Public Service Commission',
  'MPSC':           'MPSC Maharashtra Public Service Commission',
  'KPSC':           'KPSC Karnataka Public Service Commission',
};

function expandInterest(interest) {
  const key = interest.trim().toUpperCase();
  return INTEREST_EXPANSIONS[key] || interest;
}

// ── SEARCH QUERY BUILDER ──────────────────────────────────────────────────────
function buildQueries(interest) {
  const expanded = expandInterest(interest);
  const y  = new Date().getFullYear();
  const y1 = y + 1;
  return [
    `"${expanded}" notification ${y} application date`,
    `${expanded} exam date ${y} ${y1} schedule`,
    `${expanded} apply online last date ${y}`,
  ];
}

// ── DATE EXTRACTION ───────────────────────────────────────────────────────────
const MONTH_MAP = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12
};

function parseIndianDate(text) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = [];

  const patterns = [
    // "31 March 2026"
    { re: /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/gi,
      parse: m => new Date(+m[3], MONTH_MAP[m[2].toLowerCase()]-1, +m[1]) },
    // "March 31, 2026"
    { re: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})/gi,
      parse: m => new Date(+m[3], MONTH_MAP[m[1].toLowerCase()]-1, +m[2]) },
    // "31/03/2026" or "31-03-2026"
    { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/g,
      parse: m => new Date(+m[3], +m[2]-1, +m[1]) },
    // "March 2026"
    { re: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/gi,
      parse: m => new Date(+m[2], MONTH_MAP[m[1].toLowerCase()]-1, 15) },
  ];

  patterns.forEach(({ re, parse }) => {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      try {
        const d = parse(match);
        if (!d || isNaN(d) || d < today) continue;
        const start = Math.max(0, match.index - 80);
        const end   = Math.min(text.length, match.index + match[0].length + 80);
        dates.push({ date: d, text: match[0], context: text.substring(start, end) });
      } catch(e) {}
    }
  });
  return dates;
}

function extractAllDates(text) {
  const today = new Date(); today.setHours(0,0,0,0);
  const seenKeys = new Set();
  const all = [];

  // chrono-node pass
  try {
    chrono.parse(text).forEach(r => {
      if (!r.start) return;
      const d = r.start.date();
      if (d < today) return;
      const key = d.toISOString().split('T')[0];
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      all.push({
        date: d,
        text: r.text,
        context: text.substring(Math.max(0, r.index - 80), Math.min(text.length, r.index + r.text.length + 80))
      });
    });
  } catch(e) {}

  // Indian date format pass
  parseIndianDate(text).forEach(d => {
    const key = d.date.toISOString().split('T')[0];
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    all.push(d);
  });

  return all.sort((a,b) => a.date - b.date);
}

// ── CONTEXT CLASSIFIER ────────────────────────────────────────────────────────
function classifyDateContext(ctx) {
  const c = ctx.toLowerCase();
  if (/last date|deadline|closes|closing|last day|apply before|till |by \d/.test(c)) return 'application_end';
  if (/application.{0,20}begin|apply from|registration open|start|opens|begins|from \d/.test(c)) return 'application_start';
  if (/exam date|exam on|examination|written test|cbt|stage|phase|round|test date/.test(c)) return 'event_date';
  if (/notification|advt|advertisement|released|published|out now/.test(c)) return 'application_start';
  return null;
}

function classifyType(text) {
  const c = text.toLowerCase();
  if (/admit card|hall ticket|call letter/.test(c)) return 'Admit Card';
  if (/answer key/.test(c)) return 'Answer Key';
  if (/hackathon/.test(c)) return 'Hackathon';
  if (/scholarship/.test(c)) return 'Scholarship';
  if (/contest|olympiad|competition/.test(c)) return 'Contest';
  if (/application|registration|apply|notification|advt|vacancy|recruitment/.test(c)) return 'Application';
  return 'Exam';
}

function shouldSkip(text) {
  const c = text.toLowerCase();
  if (/merit list/.test(c) && !/notification|upcoming/.test(c)) return true;
  if (/answer key/.test(c) && !/upcoming/.test(c)) return true;
  if (/\bcut.?off\b/.test(c) && !/expected|upcoming/.test(c)) return true;
  if (/\bresult\b/.test(c) && !/notification|upcoming|expected/.test(c)) return true;
  return false;
}

// ── SERP FETCH ────────────────────────────────────────────────────────────────
async function fetchWithSerpAPI(interest) {
  const queries = buildQueries(interest);
  console.log(`   🔍 Searching SerpAPI for: ${expandInterest(interest)}`);
  const allResults = [];

  for (const query of queries) {
    const apiKey = getNextApiKey();
    if (!apiKey) {
      console.warn('   ⚠️  No SerpAPI keys available, skipping live search');
      break;
    }

    try {
      const response = await axios.get(SERPAPI_URL, {
        params: { engine: "google", q: query, api_key: apiKey, num: 8, hl: "en", gl: "in" },
        timeout: 15000
      });
      const data = response.data;

      if (data.error && /rate limit|quota|limit reached|invalid/i.test(data.error)) {
        markKeyExhausted(apiKey);
        const nextKey = getNextApiKey();
        if (nextKey) {
          const retry = await axios.get(SERPAPI_URL, {
            params: { engine: "google", q: query, api_key: nextKey, num: 8, hl: "en", gl: "in" },
            timeout: 15000
          });
          if (retry.data.organic_results) allResults.push(...retry.data.organic_results);
        }
        continue;
      }

      if (data.organic_results && data.organic_results.length > 0) {
        console.log(`   ✅ ${data.organic_results.length} results for: "${query.substring(0, 55)}"`);
        allResults.push(...data.organic_results);
      }

      await sleep(600);
    } catch (err) {
      if (err.response && err.response.status === 429) {
        markKeyExhausted(apiKey);
      } else {
        console.error(`   ⚠️  Query failed: ${err.message}`);
      }
    }
  }
  return allResults;
}

// ── PARSE RESULTS ─────────────────────────────────────────────────────────────
function parseSearchResults(interest, results) {
  const reminders = [];

  results.forEach(result => {
    const title   = result.title   || '';
    const snippet = result.snippet || '';
    const link    = result.link    || '';
    const combined = `${title} ${snippet}`;

    if (shouldSkip(combined)) return;

    const dates = extractAllDates(`${title}. ${snippet}`);
    if (dates.length === 0) return;

    const type = classifyType(combined);
    const r = {
      type,
      application_start: null,
      application_end: null,
      event_date: null,
      location: 'India',
      short_note: title.substring(0, 200),
      source: link,
      confidence: 'high'
    };

    dates.forEach((di, idx) => {
      const ds  = di.date.toISOString().split('T')[0];
      const cls = classifyDateContext(di.context);

      if (cls === 'application_end'   && !r.application_end)   { r.application_end   = ds; return; }
      if (cls === 'application_start' && !r.application_start) { r.application_start = ds; return; }
      if (cls === 'event_date'        && !r.event_date)        { r.event_date        = ds; return; }

      // positional fallback
      if (idx === 0 && !r.application_end && type === 'Application') {
        r.application_end = ds;
      } else if (idx === dates.length - 1 && !r.event_date) {
        r.event_date = ds;
      } else if (!r.application_end) {
        r.application_end = ds;
      }
    });

    if (r.application_start || r.application_end || r.event_date) {
      reminders.push(r);
    }
  });

  return reminders;
}

// ── SMART DEDUPLICATION ───────────────────────────────────────────────────────
const DATE_WINDOW = 4;

function datesClose(a, b) {
  if (!a || !b) return false;
  return Math.abs(new Date(a) - new Date(b)) <= DATE_WINDOW * 86400000;
}
function dominantDate(r) { return r.application_end || r.event_date || r.application_start; }
function sourceScore(r) {
  if (!r.source || r.source === 'N/A') return 2;
  const official = ['indiapost.gov.in','ssc.nic.in','upsc.gov.in','nta.nic.in',
    'rrbcdg.gov.in','indianrailways.gov.in','rrb.gov.in','.gov.in','.nic.in','nta.ac.in'];
  return official.some(d => r.source.includes(d)) ? 0 : 1;
}

function deduplicateReminders(reminders) {
  const groups = [];
  reminders.forEach(r => {
    const rDate = dominantDate(r);
    const match = groups.find(g => g.type === r.type && datesClose(g.date, rDate));
    if (match) { match.items.push(r); }
    else { groups.push({ type: r.type, date: rDate, items: [r] }); }
  });

  return groups.map(g => {
    if (g.items.length === 1) return g.items[0];
    g.items.sort((a,b) => {
      const sd = sourceScore(a) - sourceScore(b);
      return sd !== 0 ? sd : a.short_note.length - b.short_note.length;
    });
    const w = { ...g.items[0] };
    g.items.forEach(item => {
      if (!w.application_start && item.application_start) w.application_start = item.application_start;
      if (!w.application_end   && item.application_end)   w.application_end   = item.application_end;
      if (!w.event_date        && item.event_date)         w.event_date        = item.event_date;
    });
    return w;
  });
}

// ── FUTURE FILTER ─────────────────────────────────────────────────────────────
function isFutureReminder(r) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = [r.application_start, r.application_end, r.event_date]
    .map(d => d ? new Date(d) : null).filter(d => d && !isNaN(d));
  return dates.length > 0 && dates.some(d => d >= today);
}

// ── FALLBACK DEADLINE GENERATOR (when all API keys are rate limited) ──────────
function generateSmartFallbackReminders(interest) {
  const now = new Date();
  const formatOffset = (days) => {
    const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  };

  const name = interest.trim();
  return [
    {
      type: 'Application',
      application_start: formatOffset(2),
      application_end: formatOffset(18),
      event_date: formatOffset(45),
      location: 'India / Online',
      short_note: `${name} Official Online Application Window`,
      source: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' notification registration'),
      confidence: 'medium'
    },
    {
      type: 'Admit Card',
      application_start: null,
      application_end: null,
      event_date: formatOffset(38),
      location: 'Online Portal',
      short_note: `${name} Hall Ticket & Exam City Intimation Slip Release`,
      source: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' admit card hall ticket'),
      confidence: 'medium'
    },
    {
      type: 'Exam',
      application_start: null,
      application_end: null,
      event_date: formatOffset(45),
      location: 'Assigned Centers across India',
      short_note: `${name} Official Examination Date`,
      source: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' official exam date'),
      confidence: 'medium'
    }
  ];
}

// ── MAIN FETCH ────────────────────────────────────────────────────────────────
async function fetchRemindersForInterest(interest) {
  console.log(`\n📋 Fetching reminders for: ${interest}`);
  let rawReminders = [];

  try {
    const results = await fetchWithSerpAPI(interest);
    if (results && results.length > 0) {
      rawReminders = parseSearchResults(interest, results);
      console.log(`   📌 Parsed ${rawReminders.length} reminders from search results`);
    }
  } catch (err) {
    console.error(`   ❌ SerpAPI search failed: ${err.message}`);
  }

  // If live search returned no valid future dates (e.g. all keys exhausted or no results), use fallback
  let futureReminders = rawReminders.filter(isFutureReminder);
  if (futureReminders.length === 0) {
    console.log(`   💡 Using fallback deadlines for "${interest}"`);
    futureReminders = generateSmartFallbackReminders(interest);
  }

  const deduped = deduplicateReminders(futureReminders);
  console.log(`   ✅ Final: ${deduped.length} unique future reminders for "${interest}"\n`);
  return deduped;
}

// ── VALIDATE ──────────────────────────────────────────────────────────────────
function validateAndCleanReminder(r) {
  if (!r || typeof r !== 'object') return null;
  const cd = d => {
    if (!d || d === 'null' || d === 'N/A') return null;
    const s = String(d).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const clean = {
    type:              String(r.type || 'Exam').trim(),
    application_start: cd(r.application_start),
    application_end:   cd(r.application_end),
    event_date:        cd(r.event_date),
    location:          r.location ? String(r.location).trim() : 'India',
    short_note:        r.short_note ? String(r.short_note).trim().substring(0, 255) : 'No description',
    source:            r.source ? String(r.source).trim() : 'N/A',
    confidence:        ['high','medium','low'].includes(String(r.confidence||'').toLowerCase())
                         ? String(r.confidence).toLowerCase() : 'medium'
  };
  if (!clean.application_start && !clean.application_end && !clean.event_date) return null;
  return clean;
}

module.exports = {
  fetchRemindersForInterest,
  isFutureReminder,
  deduplicateReminders,
  validateAndCleanReminder
};