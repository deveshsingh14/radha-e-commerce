// Analytics helpers: validation, privacy filters, IST days, anti-inflation cap,
// and batched ingestion (≈4 queries per batch; Neon is ~0.15 s per round trip).
const crypto = require("crypto");
const { z } = require("zod");
const { Prisma } = require("@prisma/client");

const MAX_BATCH = 25;
const VIEW_CAP_PER_IP = 3;          // new unique views per (network, product, day)
const EVENT_RETENTION_DAYS = 90;
const VIEW_DEDUPE_RETENTION_DAYS = 3;

const visitorId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const productId = z.coerce.number().int().positive();
const pincode = z.string().regex(/^\d{6}$/);
const SCHEMAS = {
  page_view: z.object({ page: z.string().regex(/^[a-z0-9._-]{1,40}$/i) }),
  product_view: z.object({ productId }),
  save: z.object({ productId }),
  add_to_cart: z.object({ productId }),
  search: z.object({ term: z.string().max(200), resultCount: z.coerce.number().int().min(0).max(100000) }),
  category_select: z.object({ categoryName: z.string().trim().min(1).max(60) }),
  checkout_start: z.object({}),
  area_select: z.object({ pincode }),
  area_request: z.object({ pincode }),
  install: z.object({}),
  notify_on: z.object({})
};
const EVENT_TYPES = Object.keys(SCHEMAS);

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|pingdom|uptime|curl|wget|python-requests|axios\/|go-http-client|headlesschrome\/[0-9.]+ \(compatible/i;
function isBot(userAgent) { return !userAgent || BOT_UA.test(String(userAgent)); }

// Search text: trimmed, lowercased, ≤80 chars. Things that look personal
// (emails, phone-like numbers) are dropped entirely.
function cleanSearchTerm(raw) {
  const t = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  if (t.length < 2) return null;
  if (/@/.test(t) || /\d(?:[\s-]?\d){6,}/.test(t)) return null; // email / phone-like (7+ digits)
  return t;
}

// The shop's day runs on Indian time; stored as a DATE.
function istDay(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Accepts the raw body (object, array, or text from sendBeacon); returns valid events only.
function parseEvents(body) {
  let data = body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { return []; } }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : []);
  const out = [];
  for (const raw of list.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object" || !EVENT_TYPES.includes(raw.type)) continue;
    const vid = visitorId.safeParse(raw.visitorId);
    const fields = SCHEMAS[raw.type].safeParse(raw);
    if (!vid.success || !fields.success) continue;
    const ev = { type: raw.type, visitorId: vid.data, ...fields.data };
    if (ev.type === "search") {
      ev.term = cleanSearchTerm(ev.term);
      if (!ev.term) continue;
    }
    out.push(ev);
  }
  return out;
}

// In-memory cap so one network can't inflate a product's 👁 count with
// made-up visitor ids. Keys use a salted hash of the IP (never stored).
const salt = crypto.randomBytes(16).toString("hex");
let capDay = "";
let capMap = new Map(); // key -> Set(visitorId)
function hashIp(ip) { return crypto.createHash("sha256").update(salt + String(ip)).digest("hex").slice(0, 16); }
function allowView(ipHash, pid, vid, dayKey) {
  if (dayKey !== capDay) { capDay = dayKey; capMap = new Map(); }
  const key = `${ipHash}|${pid}`;
  let seen = capMap.get(key);
  if (!seen) { seen = new Set(); capMap.set(key, seen); }
  if (seen.has(vid)) return true;
  if (seen.size >= VIEW_CAP_PER_IP) return false;
  seen.add(vid);
  return true;
}

let lastPruneDay = ""; // per process: resets on a Render cold start (harmless)
async function pruneOld(prisma, now = new Date()) {
  const dayKey = istDay(now).toISOString().slice(0, 10);
  if (dayKey === lastPruneDay) return false;
  lastPruneDay = dayKey;
  const eventCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 864e5);
  const viewCutoff = new Date(istDay(now).getTime() - VIEW_DEDUPE_RETENTION_DAYS * 864e5);
  await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } });
  await prisma.productView.deleteMany({ where: { day: { lt: viewCutoff } } });
  return true;
}

async function ingest(prisma, events, ipHash, now = new Date()) {
  if (!events.length) return { stored: 0, newViews: 0 };
  const day = istDay(now);
  const dayKey = day.toISOString().slice(0, 10);

  // only real products count (drops junk ids)
  const pids = [...new Set(events.filter(e => e.productId).map(e => e.productId))];
  const existing = pids.length
    ? new Set((await prisma.product.findMany({ where: { id: { in: pids } }, select: { id: true } })).map(p => p.id))
    : new Set();
  const usable = events.filter(e => !e.productId || existing.has(e.productId));

  await prisma.analyticsEvent.createMany({
    data: usable.map(e => ({
      type: e.type, visitorId: e.visitorId, productId: e.productId ?? null,
      categoryName: e.categoryName ?? null, term: e.term ?? null, resultCount: e.resultCount ?? null,
      pincode: e.pincode ?? null, page: e.page ?? null
    }))
  });

  const viewRows = [];
  const seenInBatch = new Set();
  for (const e of usable) {
    if (e.type !== "product_view") continue;
    const k = `${e.productId}|${e.visitorId}`;
    if (seenInBatch.has(k)) continue;
    seenInBatch.add(k);
    if (allowView(ipHash, e.productId, e.visitorId, dayKey)) viewRows.push({ productId: e.productId, visitorId: e.visitorId, day });
  }
  const created = viewRows.length
    ? await prisma.productView.createManyAndReturn({ data: viewRows, skipDuplicates: true, select: { productId: true } })
    : [];

  const per = new Map(); // productId -> {views, saves, carts}
  const bump = (pid, field) => { const r = per.get(pid) || { views: 0, saves: 0, carts: 0 }; r[field]++; per.set(pid, r); };
  created.forEach(r => bump(r.productId, "views"));
  usable.forEach(e => { if (e.type === "save") bump(e.productId, "saves"); if (e.type === "add_to_cart") bump(e.productId, "carts"); });

  const viewed = [...per].filter(([, r]) => r.views > 0);
  if (viewed.length) {
    await prisma.$executeRaw`UPDATE "product" AS p SET "viewCount" = p."viewCount" + v.n
      FROM (VALUES ${Prisma.join(viewed.map(([pid, r]) => Prisma.sql`(${pid}::int, ${r.views}::int)`))}) AS v(id, n)
      WHERE p.id = v.id`;
  }
  if (per.size) {
    await prisma.$executeRaw`INSERT INTO "product_daily_stat" ("productId", "day", "views", "saves", "carts")
      VALUES ${Prisma.join([...per].map(([pid, r]) => Prisma.sql`(${pid}::int, ${day}::date, ${r.views}::int, ${r.saves}::int, ${r.carts}::int)`))}
      ON CONFLICT ("productId", "day") DO UPDATE SET
        "views" = "product_daily_stat"."views" + EXCLUDED."views",
        "saves" = "product_daily_stat"."saves" + EXCLUDED."saves",
        "carts" = "product_daily_stat"."carts" + EXCLUDED."carts"`;
  }
  return { stored: usable.length, newViews: created.length };
}

module.exports = {
  EVENT_TYPES, MAX_BATCH, VIEW_CAP_PER_IP, isBot, cleanSearchTerm, istDay, parseEvents,
  hashIp, allowView, pruneOld, ingest,
  _resetCap: () => { capDay = ""; capMap = new Map(); lastPruneDay = ""; }
};
