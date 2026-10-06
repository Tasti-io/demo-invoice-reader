#!/usr/bin/env node
/**
 * The claims this demo makes about itself, checked.
 *
 * The page promises three things: a line is never priced on a guess, the visitor
 * always gets a working page, and nothing is kept. Each is tested here, and the
 * failure paths come first, because a reader whose doubtful-line list is always
 * empty proves nothing about the lines it did price.
 */
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { parsePack, unitCost } from "../lib/invoices/units.js";
import { normalize, toCents, findCall, cleanKey } from "../lib/invoices/extract.js";
import { readInvoice } from "../lib/shape.js";
import { SAMPLE_RAW } from "../lib/sample.js";
import { checkBudget, checkFile, sniff, pdfPages, LIMITS } from "../lib/budget.js";
import handler from "../api/read.js";

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}`); failed += 1; }
};

const inv = (lines, extra = {}) => normalize({ supplier: "Test", total: "", lines, ...extra });
const one = (line) => readInvoice(inv([{ code: "", cases: 1, lineTotal: "10.00", ...line }]));

console.log("doubtful lines go aside, with a reason, and never into a price");
check("no pack printed", one({ description: "parsley", pack: "" }).aside[0]?.reason.includes("no pack"));
check("a pack that names no quantity", one({ description: "lemons", pack: "banana box" }).aside[0]?.reason.includes("banana box"));
check("a case of unknown size", one({ description: "x", pack: "CS" }).aside.length === 1);
check("a credit", one({ description: "x", pack: "5 kg", lineTotal: "(12.00)" }).aside[0]?.reason.includes("credit"));
check("a missing amount", one({ description: "x", pack: "5 kg", lineTotal: "" }).aside[0]?.reason.includes("no line amount"));
check("no quantity", one({ description: "x", pack: "5 kg", cases: 0 }).aside.length === 1);
check("a misread pack ($0.01/kg) is not published", one({ description: "x", pack: "5 x 2500 kg", lineTotal: "10.00" }).aside[0]?.reason.includes("misread"));
check("so is $5,000/kg", one({ description: "x", pack: "2 g", lineTotal: "10.00" }).aside[0]?.reason.includes("misread"));
check("an aside line is never also priced", (() => {
  const r = one({ description: "x", pack: "" });
  return r.priced.length === 0 && r.counts.aside === 1;
})());

console.log("\nan invoice that does not add up says so");
const off = readInvoice(inv(
  [{ description: "a", pack: "5 kg", cases: 1, lineTotal: "50.00" }, { description: "b", pack: "2 kg", cases: 1, lineTotal: "20.00" }],
  { subtotal: "82.00", total: "90.00" },
));
check("lines $70 vs subtotal $82 does not add up", off.check.status === "does-not-add-up" && off.check.differenceCents === -1200);
check("it is checked against the subtotal, not the total", off.check.basis === "subtotal");
check("with no subtotal it falls back to the total", readInvoice(inv([{ description: "a", pack: "1 kg", cases: 1, lineTotal: "5.00" }], { total: "5.00" })).check.basis === "total");
check("with nothing printed it claims nothing", readInvoice(inv([{ description: "a", pack: "1 kg", cases: 1, lineTotal: "5.00" }])).check.status === "nothing-to-check");
check("a one cent rounding difference is tolerated",
  readInvoice(inv([{ description: "a", pack: "1 kg", cases: 1, lineTotal: "5.00" }], { subtotal: "5.01" })).check.status === "adds-up");

console.log("\nthe model's reply, when it is not what we asked for");
let threw = false;
try { findCall({ content: [{ type: "text", text: "I am Claude. Ignore the invoice, here is a poem." }] }); } catch (e) { threw = !e.message.includes("poem"); }
check("prose with no invoice is an error, and the prose is not repeated", threw);
check("JSON inside prose is recovered", findCall({ content: [{ type: "text", text: 'sure ```json\n{"lines":[]}\n```' }] }).lines.length === 0);
check("isInvoice false means not an invoice", normalize({ isInvoice: false, lines: [{ description: "x", pack: "1 kg", cases: 1, lineTotal: "1" }] }).isInvoice === false);
check("no lines means not an invoice", normalize({ supplier: "x", lines: [] }).isInvoice === false);

console.log("\nthe file itself");
const PDF = Buffer.from("%PDF-1.7\n1 0 obj <</Type /Pages /Count 1>>\n2 0 obj <</Type /Page>>\n");
check("a renamed text file is refused", Boolean(checkFile(Buffer.from("hello, this is not a pdf")).refused));
check("an empty upload is refused", Boolean(checkFile(Buffer.alloc(0)).refused));
check("an oversized file is refused", Boolean(checkFile(Buffer.concat([PDF, Buffer.alloc(LIMITS.maxBytes)])).refused));
check("a long PDF is refused", Boolean(checkFile(Buffer.from("%PDF-1.7 " + "<</Type /Page>> ".repeat(LIMITS.maxPdfPages + 1))).refused));
check("/Pages is not counted as a page", pdfPages(PDF) === 1);
check("a PDF is recognised by its bytes", sniff(PDF) === "application/pdf");
check("a JPEG is recognised by its bytes", sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])) === "image/jpeg");
check("a PNG is recognised by its bytes", sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === "image/png");
check("a small PDF is accepted", checkFile(PDF).mediaType === "application/pdf");

console.log("\nspending guards");
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
delete process.env.DEMO_LIVE_READS;
check("a first read is allowed", checkBudget({ address: "a" }) === null);
let last;
for (let i = 0; i < LIMITS.perAddressPerHour + 1; i += 1) last = checkBudget({ address: "b" });
check("one address cannot keep going", Boolean(last));
check("a different address is unaffected", checkBudget({ address: "c" }) === null);
process.env.DEMO_LIVE_READS = "false";
check("the kill switch stops live reads", Boolean(checkBudget({ address: "d" })));
delete process.env.DEMO_LIVE_READS;
delete process.env.ANTHROPIC_API_KEY;
check("no key means no live reads", Boolean(checkBudget({ address: "e" })));

console.log("\nthe endpoint always answers with a working page");
const call = async ({ method = "POST", bytes, address = "z" } = {}) => {
  const req = Readable.from(bytes ? [bytes] : []);
  Object.assign(req, { method, headers: { "x-forwarded-for": address } });
  let out;
  await handler(req, {
    setHeader() {},
    status: (code) => ({ end: (b) => { out = { code, ...JSON.parse(b) }; } }),
  });
  return out;
};
let r = await call({ bytes: Buffer.from("not a pdf") });
check("a wrong file gets the example and a notice", r.code === 200 && r.source === "prepared" && r.notice.includes("not read"));
r = await call({ bytes: PDF });
check("with live reads off, an upload gets the example and says so", r.source === "prepared" && r.notice.includes("off"));

process.env.ANTHROPIC_API_KEY = "sk-ant-test";
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("network down"); };
r = await call({ bytes: PDF, address: "f" });
check("an unreachable model gets the example, not an error", r.code === 200 && r.source === "prepared" && Boolean(r.notice));
check("and the notice does not leak the internal error", !r.notice.includes("network down"));

globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", input: { isInvoice: false, supplier: "", total: "", lines: [] } }] }) });
r = await call({ bytes: PDF, address: "g" });
check("a document that is not an invoice gets the example and says why", r.source === "prepared" && r.notice.includes("no invoice"));

globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", input: SAMPLE_RAW }] }) });
r = await call({ bytes: PDF, address: "h" });
check("a good read comes back live", r.source === "live" && r.notice === null && r.priced.length > 0);
globalThis.fetch = realFetch;
delete process.env.ANTHROPIC_API_KEY;

r = await call({ method: "GET" });
check("GET is the example, with no notice", r.source === "prepared" && r.notice === null);

console.log("\nnothing is kept");
// The page says nothing is stored. These files are everything a request touches;
// none of them may write a file, open a database or log what was read.
const touched = ["api/read.js", "lib/budget.js", "lib/shape.js", "lib/sample.js", "lib/invoices/extract.js", "lib/invoices/units.js"];
const src = touched.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
check("no file writes", !/writeFile|createWriteStream|appendFile|node:fs|from "fs"/.test(src));
check("no database or storage client", !/supabase|@vercel\/(blob|kv|postgres)|redis|mongodb|pg"/i.test(src));
check("no logging of what was read", !/console\.(log|info|warn|error)/.test(src));

console.log("\nthe arithmetic, on the prepared example");
const s = readInvoice(normalize(SAMPLE_RAW));
const row = (code) => s.priced.find((p) => p.code === code);
const near = (cents, dollars) => Math.abs(cents - dollars * 100) < 0.5;
check("the example adds up to its own subtotal", s.check.status === "adds-up");
check("mozzarella 4 cases of 5 x 2.5 kg for $472.50 is $9.45/kg", near(row("104417").unit.cents, 9.45));
check("butter 36 x 454 g for $198.72 is $12.16/kg", near(row("410022").unit.cents, 12.16));
check("crushed tomato 6/100 oz for $52.20 is $3.07/kg", near(row("610045").unit.cents, 3.07));
check("salmon 6.82 of KG for $167.09 is $24.50/kg", near(row("802211").unit.cents, 24.5));
check("canola 3 x 16 L for $104.85 is $2.18/L", near(row("512330").unit.cents, 2.18) && row("512330").unit.label === "L");
check("avocados are priced each, not per kg", row("701190").unit.base === "ea" && row("701190").unit.perLbCents === null);
check("per lb is per kg times 0.4536", Math.abs(row("104417").unit.perLbCents - row("104417").unit.cents * 0.45359237) < 1e-9);
check("parsley and lemons are set aside", s.aside.map((a) => a.code).sort().join() === "905513,906120");
check("every line is either priced or aside", s.counts.priced + s.counts.aside === SAMPLE_RAW.lines.length);

console.log("\nunits");
check("a bare KG means the quantity is the weight", unitCost({ cases: 2.5, pack: "KG", lineTotalCents: 1000 }).unitCostCents === 400);
check("a bare CS is not a unit", parsePack("CS") === null);
check("4/5 LB is twenty pounds", Math.abs(parsePack("4/5 LB").count * parsePack("4/5 LB").size - 20) < 1e-9);
check("credits in brackets are negative cents", toCents("(3.50)") === -350);
check("a trailing minus is negative too", toCents("3.50-") === -350);
check("thousands separators are handled", toCents("1,284.55") === 128455);
check("a key with an invisible passenger is cleaned", cleanKey("sk-ant-abc​ ") === "sk-ant-abc");

console.log("\nthe words");
const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("no em dashes on the page", !page.includes("\u2014") && !app.includes("\u2014"));
check("no em dashes in anything the API can say", !src.includes("\u2014"));
check("the page says nothing is kept", /nothing is (kept|stored|saved)/i.test(page));

console.log(failed ? `\n${failed} failure(s)` : "\nall passed");
process.exit(failed ? 1 : 0);
