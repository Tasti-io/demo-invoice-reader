# Invoice reader

Live at **[invoices.tasti.io](https://invoices.tasti.io)**. Part of the
[Tasti.io demos](https://demo.tasti.io).

Drop in one supplier invoice, as a PDF or a photo. You get your own lines back
with a price per kilogram, litre or each beside every line you can price, and a
second list of lines that could not be priced, each with the reason in words.

## The one rule

**The model transcribes. It never calculates.**

Claude reads the document and returns every amount as the string printed on the
page. From there it is ordinary code:

- `lib/invoices/extract.js` is the only place a model is called. It asks for a
  structured transcription and nothing else.
- `normalize()` turns printed strings into integer cents.
- `lib/invoices/units.js` parses packs (`5 x 2.5 KG`, `36 x 454 G`, ounces, dozens)
  and derives the base unit.
- `lib/shape.js` prices each line, adds the lines up and compares them with the
  invoice's own subtotal.

A line is never priced on a guess. No pack printed, a pack that cannot be read,
a credit, a missing amount, or a price so far outside what food costs that the
pack was almost certainly misread: each goes to the **aside** list. A misread
number therefore shows up as an invoice that does not add up, on the page,
instead of as a confident wrong price.

## Running it safely in public

`lib/budget.js` decides what an anonymous visitor may spend, strongest guard
first:

1. A spend limit on the Anthropic workspace the key belongs to. The provider
   enforces it, so code cannot bypass it.
2. A kill switch: `DEMO_LIVE_READS=false` serves the prepared example instead,
   and the page says so.
3. Small documents only: size and page caps, and a check that the bytes really
   are a PDF or an image.
4. A per-address rate limit and a per-instance daily count.

The prepared example (`lib/sample.js`) goes through the same `normalize()` and
pricing code as a live read, so the fallback exercises real logic rather than
showing a screenshot. Supplier, prices and the customer (Harbour & Co, see
[harbour-data](https://github.com/Tasti-io/harbour-data)) are invented.

## Layout

```
api/read.js            Vercel function: budget checks, read, shape, respond
lib/invoices/extract.js  model call + normalize()
lib/invoices/units.js    pack parsing and unit conversion
lib/shape.js             pricing, reconciliation, the aside list
lib/budget.js            limits for anonymous use
lib/sample.js            prepared example
public/                  the page
scripts/selftest.mjs     62 checks, no network
```

## Run

```bash
npm run check   # self-test, no API key needed
npm run dev     # local server; reads ANTHROPIC_API_KEY from the environment
```

No npm dependencies.
