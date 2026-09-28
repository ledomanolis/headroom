# Headroom

Prototype web app for UK defined benefit pension schemes. It compares three options side by side:

- **Buyout**: de-risk and insure the scheme as soon as the insurer's price is affordable
- **Run-on**: keep running the scheme, with surplus building up inside it
- **Surplus release**: run on and release anything above a chosen funding level, shared between employer and members

For each option it shows funding level over time, the chance the employer has to pay in more, and expected surplus to the employer and members. It also has instant stress tests (gilt yield moves, longevity, a growth asset fall) and a reproducible run record that can be downloaded or printed.

Illustrative only. The model is deliberately simple and needs review by a qualified actuary before anyone relies on it.

## Files

- `index.html`: page layout
- `css/styles.css`: styling, including print layout
- `js/model.js`: the projection model (seeded, so the same inputs always give the same results)
- `js/app.js`: inputs, charts and run record
- `serve.ps1`: tiny local web server for previewing

## Preview locally

In PowerShell, from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8080. It's a plain static site with no build step. Charts use Chart.js from a CDN.
