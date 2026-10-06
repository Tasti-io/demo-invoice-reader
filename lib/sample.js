/**
 * The prepared example, for when a live read is off, over budget or fails.
 *
 * It is stored as the model would have returned it, strings and all, and goes
 * through normalize() and readInvoice() exactly like a live read. So the fallback
 * is not a screenshot of success: it is the same arithmetic on a document we
 * typed in ourselves, and the page says so.
 *
 * Invented supplier, invented prices, billed to the fictional Harbour & Co that
 * every Tasti demo shares. Putting a real distributor's name next to invented
 * prices would be making a claim about their business.
 *
 * Deliberately not clean. It has a line sold by weight, a can size in ounces, a
 * line with no pack printed, and a produce line packed in a "banana box", because
 * the question a visitor actually has is what happens to the line nobody can read.
 */
export const SAMPLE_RAW = {
  isInvoice: true,
  supplier: "Pacific Foodservice",
  invoiceNumber: "PF-204417",
  date: "2026-10-02",
  currency: "CAD",
  subtotal: "1,881.96",
  total: "1,894.46",
  lines: [
    { code: "104417", description: "MOZZ SHRD WHL MLK", pack: "5 x 2.5 KG", cases: 4, lineTotal: "472.50" },
    { code: "220981", description: "FLOUR BREAD RED SPRING", pack: "20 KG", cases: 2, lineTotal: "76.00" },
    { code: "318840", description: "CHKN THGH BNLS SKNLS", pack: "4 KG", cases: 10, lineTotal: "536.00" },
    { code: "410022", description: "BUTTER UNSLTD 83% PRINTS", pack: "36 x 454 G", cases: 1, lineTotal: "198.72" },
    { code: "512330", description: "OIL CANOLA FRY CLEAR", pack: "16 L", cases: 3, lineTotal: "104.85" },
    { code: "610045", description: "TOMATO CRUSHED FANCY", pack: "6/100 OZ", cases: 1, lineTotal: "52.20" },
    { code: "701190", description: "AVOCADO HASS 48CT", pack: "48 CT", cases: 3, lineTotal: "189.00" },
    { code: "802211", description: "SALMON ATL FLT SKIN-ON", pack: "KG", cases: 6.82, lineTotal: "167.09" },
    { code: "905513", description: "PARSLEY ITALIAN BUNCH", pack: "", cases: 2, lineTotal: "24.00" },
    { code: "906120", description: "LEMON 140CT", pack: "banana box", cases: 1, lineTotal: "61.60" },
  ],
};
