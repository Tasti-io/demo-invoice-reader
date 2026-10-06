/**
 * What an anonymous stranger is allowed to spend.
 *
 * Same shape as the Avo demo, tuned for a heavier call: reading a document costs
 * far more than drafting a sentence. Guards, strongest first:
 *
 * 1. A spend limit on the Anthropic workspace the key belongs to. The only real
 *    ceiling, because the provider enforces it and code here cannot bypass it.
 * 2. A kill switch. DEMO_LIVE_READS=false and every upload gets the prepared
 *    example instead, with the swap stated on the page.
 * 3. Small documents only: a size cap, a page cap, and a check that the bytes are
 *    actually a PDF or an image and not something renamed.
 * 4. A per-address rate limit, and a per-instance daily count.
 *
 * Guard 4 is per running instance: serverless functions share no memory, so a busy
 * moment spreads across several. It stops one person leaning on the button; it is
 * not a global ceiling. That is why guard 1 exists.
 */

export const LIMITS = {
  // Vercel refuses request bodies over 4.5 MB, so the cap sits under it. The page
  // shrinks phone photos before sending, so a photo rarely gets near this.
  maxBytes: 4 * 1024 * 1024,
  maxPdfPages: 6,
  perAddressPerHour: 4,
  perInstancePerDay: 120,
};

export const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const seen = new Map(); // address -> { count, resetAt }
let dayCount = 0;
let dayStartedAt = Date.now();

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function liveReadsEnabled() {
  return process.env.DEMO_LIVE_READS !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);
}

/** What the bytes actually are, from their first few, regardless of what the name claims. */
export function sniff(bytes) {
  const b = bytes;
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * A rough page count without a PDF library: count page objects. Compressed object
 * streams can hide them, in which case this returns 0 and the size cap is what
 * holds. Rough is fine; it is a cost guard, not a parser.
 */
export function pdfPages(bytes) {
  return (bytes.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/** Check the file itself. Returns { mediaType } or { refused: reason }. */
export function checkFile(bytes) {
  if (!bytes?.length) return { refused: "no file arrived" };
  if (bytes.length > LIMITS.maxBytes) {
    return { refused: `that file is ${(bytes.length / 1048576).toFixed(1)} MB; the demo reads up to ${LIMITS.maxBytes / 1048576} MB` };
  }
  const mediaType = sniff(bytes);
  if (!mediaType) return { refused: "that does not look like a PDF or a photo" };
  if (mediaType === "application/pdf" && pdfPages(bytes) > LIMITS.maxPdfPages) {
    return { refused: `that PDF has ${pdfPages(bytes)} pages; the demo reads up to ${LIMITS.maxPdfPages}` };
  }
  return { mediaType };
}

/** Why this caller cannot have a live read right now, or null when they can. */
export function checkBudget({ address }) {
  if (!liveReadsEnabled()) return "live reading is off right now";

  if (Date.now() - dayStartedAt > DAY) {
    dayCount = 0;
    dayStartedAt = Date.now();
  }
  if (dayCount >= LIMITS.perInstancePerDay) return "the demo has read its share of invoices for today";

  const key = address || "unknown";
  const now = Date.now();
  const entry = seen.get(key);
  if (!entry || now > entry.resetAt) {
    seen.set(key, { count: 1, resetAt: now + HOUR });
  } else if (entry.count >= LIMITS.perAddressPerHour) {
    return `that is ${LIMITS.perAddressPerHour} invoices from one place this hour`;
  } else {
    entry.count += 1;
  }

  if (seen.size > 5000) for (const [k, v] of seen) if (now > v.resetAt) seen.delete(k);

  dayCount += 1;
  return null;
}

export function callerAddress(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd ?? "")).split(",")[0].trim() || "unknown";
}
