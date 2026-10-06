/**
 * One invoice in, the page's view of it out.
 *
 * Every number on the page comes from here, in plain arithmetic, after the model
 * has finished. Two lists come out, and the split between them is the point:
 *
 *   priced   lines we could turn into a price per kilogram, litre or each, with
 *            the working shown (how much product the line bought, in base units)
 *   aside    lines we could not, each with the reason in words
 *
 * A line is never priced on a guess. No pack printed, a pack we cannot read, a
 * credit, a missing amount, or a result so far outside what food costs that the
 * pack was almost certainly misread: each of those goes to the aside list where
 * the visitor can see it, instead of into a number that looks confident.
 */
import { unitCost, UnitError, BASE_LABEL } from "./invoices/units.js";

const LB_PER_KG = 0.45359237;

/**
 * Plausible price range per base unit, in cents. Outside it the pack was very
 * likely misread ("5 x 2.5" read as "52.5"), so the line is set aside with that
 * reason rather than published. Wide on purpose: saffron and caviar exist, and a
 * false alarm here costs one line in the aside list, not a wrong number. "Each"
 * gets no range, because an each can be a lemon or a stockpot.
 */
export const PLAUSIBLE = {
  kg: { min: 20, max: 40_000 },
  l: { min: 20, max: 20_000 },
};

const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

function priceLine(line) {
  if (line.lineTotalCents == null) return { aside: "no line amount could be read" };
  if (line.lineTotalCents < 0) return { aside: "a credit, not a purchase" };
  if (line.lineTotalCents === 0) return { aside: "billed at zero" };
  if (!line.pack) return { aside: "no pack size printed, so there is nothing to divide by" };
  if (!(line.cases > 0)) return { aside: "no quantity printed" };

  let u;
  try {
    u = unitCost(line);
  } catch (err) {
    if (!(err instanceof UnitError)) throw err;
    return { aside: `pack "${line.pack}" does not say how much is in it` };
  }

  const range = PLAUSIBLE[u.base];
  if (range && (u.unitCostCents < range.min || u.unitCostCents > range.max)) {
    return { aside: `works out to ${money(u.unitCostCents)}/${BASE_LABEL[u.base]}, which is almost certainly a misread pack` };
  }

  return {
    unit: {
      base: u.base,
      label: BASE_LABEL[u.base],
      cents: u.unitCostCents,
      // The same figure per pound, for kitchens that think in pounds. Weight only.
      perLbCents: u.base === "kg" ? u.unitCostCents * LB_PER_KG : null,
      quantity: u.baseQuantity,
      quantityLb: u.base === "kg" ? u.baseQuantity / LB_PER_KG : null,
    },
  };
}

export function readInvoice(invoice) {
  const priced = [];
  const aside = [];
  let linesCents = 0;

  invoice.lines.forEach((line, i) => {
    if (line.lineTotalCents != null) linesCents += line.lineTotalCents;
    const row = {
      n: i + 1,
      code: line.code,
      description: line.description,
      pack: line.pack,
      cases: line.cases,
      lineTotalCents: line.lineTotalCents,
    };
    const { unit, aside: reason } = priceLine(line);
    if (unit) priced.push({ ...row, unit });
    else aside.push({ ...row, reason });
  });

  // Against the goods subtotal where one is printed, otherwise the total. A one
  // cent tolerance for rounding on the supplier's side, and no more.
  const statedCents = invoice.subtotalCents ?? invoice.totalCents;
  const basis = invoice.subtotalCents != null ? "subtotal" : "total";
  const check = statedCents == null
    ? { status: "nothing-to-check", linesCents }
    : {
        status: Math.abs(linesCents - statedCents) <= 1 ? "adds-up" : "does-not-add-up",
        linesCents, statedCents, basis,
        differenceCents: linesCents - statedCents,
      };

  return {
    supplier: invoice.supplier,
    invoiceNumber: invoice.id,
    date: invoice.date,
    currency: invoice.currency,
    totalCents: invoice.totalCents,
    priced,
    aside,
    check,
    counts: { lines: invoice.lines.length, priced: priced.length, aside: aside.length },
  };
}
