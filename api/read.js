/**
 * /api/read
 *
 *   GET   the prepared example. No model, costs nothing.
 *   POST  one invoice as the raw request body (a PDF or an image), read live.
 *
 * Nothing is stored. The bytes live in this function's memory for the length of
 * one request, go to the model once to be transcribed, and are dropped when the
 * response is sent. There is no database, no file write and no logging of the
 * document or of what was read from it. The self-test checks this file and its
 * imports for any of those, so the claim on the page cannot quietly go stale.
 *
 * Every failure (off, over budget, wrong file, model unreachable, not an invoice)
 * still answers 200 with the prepared example and a notice saying why. A visitor
 * who arrives after somebody else spent the budget gets a working page that is
 * honest about what it is showing, not an error.
 */
import { readDocument, normalize } from "../lib/invoices/extract.js";
import { readInvoice } from "../lib/shape.js";
import { SAMPLE_RAW } from "../lib/sample.js";
import { LIMITS, checkFile, checkBudget, callerAddress } from "../lib/budget.js";

const send = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).end(JSON.stringify(body));
};

const sample = (notice) => ({ ...readInvoice(normalize(SAMPLE_RAW)), source: "prepared", notice: notice ?? null });

/** The raw body, capped while it streams so an oversized upload is never held whole. */
async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.maxBytes) return { tooBig: size };
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, sample());
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST only" });

  const body = await rawBody(req);
  if (body.tooBig) {
    return send(res, 200, sample(`that file is over ${LIMITS.maxBytes / 1048576} MB, so it was not read`));
  }

  const file = checkFile(body);
  if (file.refused) return send(res, 200, sample(`${file.refused}, so it was not read`));

  const blocked = checkBudget({ address: callerAddress(req) });
  if (blocked) return send(res, 200, sample(`${blocked}, so your file was not read`));

  try {
    const { raw } = await readDocument({ bytes: body, mediaType: file.mediaType });
    const invoice = normalize(raw);
    if (!invoice.isInvoice) {
      return send(res, 200, sample("the model read your file and found no invoice lines in it"));
    }
    return send(res, 200, { ...readInvoice(invoice), source: "live", notice: null });
  } catch (err) {
    const why = err?.name === "TimeoutError" ? "the read took too long" : "the reader could not finish just now";
    return send(res, 200, sample(`${why}, so your file was not read`));
  }
}
