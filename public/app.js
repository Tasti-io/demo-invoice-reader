/**
 * The page: pick a file, send it, show what came back.
 *
 * No arithmetic happens here beyond formatting. Every figure on the screen is the
 * server's, computed in lib/shape.js, so what the visitor sees is what the
 * self-test checked. The one transformation is shrinking a phone photo before it
 * is sent, which changes the pixels and not the numbers printed in them.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (c) => (c == null ? "" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const qty = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString("en-CA", { maximumFractionDigits: 3 }));

const MAX_BYTES = 4 * 1024 * 1024;
let perLb = false;
let last = null;

/* ---------- tabs ---------- */

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab(id) {
  for (const t of tabs) {
    const on = t.id === id;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}
for (const t of tabs) t.addEventListener("click", () => showTab(t.id));
document.addEventListener("keydown", (e) => {
  if (!tabs.includes(document.activeElement)) return;
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = tabs[(tabs.indexOf(document.activeElement) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  showTab(next.id);
});

/* ---------- picking a file ---------- */

const zone = $("zone");
const input = $("file");
zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => input.files[0] && send(input.files[0]));
for (const ev of ["dragenter", "dragover"]) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("is-over"); });
for (const ev of ["dragleave", "drop"]) zone.addEventListener(ev, () => zone.classList.remove("is-over"));
zone.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) send(f);
});
$("sample").addEventListener("click", () => run(() => fetch("/api/read"), "Opening the sample invoice"));

/**
 * Phone photos run 3 to 12 MB and far more pixels than a model needs to read
 * printed text. Redraw anything that is not a PDF at most 2000 px on the long side
 * as a JPEG. This also turns an iPhone HEIC into something the reader accepts,
 * because the browser decodes it for us.
 */
async function shrink(file) {
  if (file.type === "application/pdf") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.88));
  } catch {
    return file; // the server checks the bytes and says so if it cannot use them
  }
}

async function send(file) {
  const body = await shrink(file);
  if (body.size > MAX_BYTES) {
    // Refused here only to save the upload; the server refuses it too.
    return show({ refusedLocally: `That file is ${(body.size / 1048576).toFixed(1)} MB and the demo reads up to 4 MB. A single page, or a photo of it, is plenty.` });
  }
  run(
    () => fetch("/api/read", { method: "POST", headers: { "content-type": "application/octet-stream" }, body }),
    `Reading ${file.name || "your invoice"}`,
  );
}

/* ---------- the request ---------- */

async function run(request, label) {
  const box = $("result");
  box.hidden = false;
  box.innerHTML = `<div class="working"><span class="spin"></span><span>${esc(label)}. Usually about thirty seconds.</span><span class="secs" id="secs">0 s</span></div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const started = Date.now();
  const tick = setInterval(() => { const s = $("secs"); if (s) s.textContent = `${Math.round((Date.now() - started) / 1000)} s`; }, 500);
  try {
    const res = await request();
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `request failed (${res.status})`);
    show(json);
  } catch (err) {
    show({ refusedLocally: `The page could not reach the reader (${err.message}). Try the sample invoice instead.` });
  } finally {
    clearInterval(tick);
    input.value = "";
  }
}

/* ---------- the result ---------- */

function unitCell(u) {
  const usePerLb = perLb && u.perLbCents != null;
  const cents = usePerLb ? u.perLbCents : u.cents;
  const label = usePerLb ? "lb" : u.label;
  const amount = usePerLb ? u.quantityLb : u.quantity;
  const work = `${qty(Math.round(amount * 1000) / 1000)} ${label} on this line`;
  return `<span class="unit">${money(cents)}/${esc(label)}</span><span class="work">${esc(work)}</span>`;
}

function show(r) {
  last = r;
  const box = $("result");
  box.hidden = false;

  if (r.refusedLocally) {
    box.innerHTML = `<div class="notice">${esc(r.refusedLocally)}</div><div class="again" style="padding-top:14px"><button class="btn" id="again">Try another file</button></div>`;
    $("again").addEventListener("click", () => input.click());
    return;
  }

  const prepared = r.source === "prepared";
  const notice = r.notice
    ? `<div class="notice"><b>This is the sample invoice, not yours.</b> ${esc(cap(r.notice))}. Everything below is the same arithmetic on a document we typed in for a fictional group, Harbour &amp; Co.</div>`
    : prepared
      ? `<div class="notice"><b>A sample invoice</b>, typed in for a fictional group, Harbour &amp; Co. It goes through exactly the same code as an upload.</div>`
      : "";

  const anyWeight = r.priced.some((p) => p.unit.perLbCents != null);
  const meta = `
    <div class="meta">
      <span><b>${esc(r.supplier || "Supplier not printed")}</b></span>
      ${r.invoiceNumber ? `<span>Invoice ${esc(r.invoiceNumber)}</span>` : ""}
      ${r.date ? `<span>${esc(r.date)}</span>` : ""}
      <span>${r.counts.priced} of ${r.counts.lines} lines priced</span>
      ${anyWeight ? `<span class="units" role="group" aria-label="Weight unit"><button data-u="kg" class="${perLb ? "" : "is-on"}">per kg</button><button data-u="lb" class="${perLb ? "is-on" : ""}">per lb</button></span>` : ""}
    </div>`;

  const rows = r.priced.map((p) => `
      <tr>
        <td class="code hide-sm">${esc(p.code ?? "")}</td>
        <td>${esc(p.description)}</td>
        <td class="pack hide-sm">${esc(p.pack ?? "")}</td>
        <td class="num hide-sm">${esc(qty(p.cases))}</td>
        <td class="num">${money(p.lineTotalCents)}</td>
        <td class="num">${unitCell(p.unit)}</td>
      </tr>`).join("");

  const table = r.priced.length
    ? `<div class="tablewrap"><table>
        <thead><tr><th class="hide-sm">Code</th><th>As printed</th><th class="hide-sm">Pack</th><th class="num hide-sm">Qty</th><th class="num">Line</th><th class="num">Per unit</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="check none">No line on this invoice printed enough to work out a unit price. They are all listed below with the reason.</div>`;

  const c = r.check;
  const check = c.status === "adds-up"
    ? `<div class="check ok">The ${c.basis} printed on the invoice is ${money(c.statedCents)}, and the lines read add up to exactly that, so the dollar amounts came through intact. This check does not cover pack sizes, so glance at those against the paper.</div>`
    : c.status === "does-not-add-up"
      ? `<div class="check bad">The lines add up to ${money(c.linesCents)}, but the invoice prints a ${c.basis} of ${money(c.statedCents)}, a difference of ${money(Math.abs(c.differenceCents))}. Either a line was misread or the invoice's own arithmetic is off. Check against the paper before trusting the prices above.</div>`
      : `<div class="check none">The invoice prints no subtotal or total, so there was nothing to check the lines against.</div>`;

  const aside = `
    <div class="aside">
      <div class="aside-head"><b>Set aside, ${r.aside.length}</b> &middot; lines read but not priced, and why</div>
      ${r.aside.length
        ? r.aside.map((a) => `<div class="aside-row"><span>${esc(a.description)}${a.pack ? ` <span class="pack">&middot; ${esc(a.pack)}</span>` : ""} &middot; ${money(a.lineTotalCents)}</span><span class="why">${esc(a.reason)}</span></div>`).join("")
        : `<div class="empty-aside">Nothing. Every line printed enough to be priced.</div>`}
    </div>`;

  box.innerHTML = `
    <div class="card-head" style="border-bottom:0;padding-bottom:0"><h2>${prepared ? "The sample invoice" : "Your invoice"}</h2><span class="stamp">${prepared ? "prepared example" : "read just now &middot; not kept"}</span></div>
    ${notice}${meta}${table}${check}${aside}
    <div class="again"><button class="btn" id="again">Read another invoice</button>${prepared ? "" : "<span>Your file has already been dropped. Reloading the page clears this table too.</span>"}</div>`;

  $("again").addEventListener("click", () => input.click());
  for (const b of box.querySelectorAll(".units button")) {
    b.addEventListener("click", () => { perLb = b.dataset.u === "lb"; show(last); });
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
