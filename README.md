# Headroom

Prototype web app for UK defined benefit pension schemes. It compares three options side by side:

- **Buyout**: de-risk and insure the scheme as soon as the insurer's price is affordable
- **Run-on**: keep running the scheme, with surplus building up inside it
- **Surplus release**: run on and release anything above a chosen funding level, shared between employer and members

For each option it shows funding level over time, the chance the employer has to pay in more, and expected surplus to the employer and members. It also has instant stress tests (gilt yield moves, longevity, a growth asset fall) and a reproducible run record that can be downloaded or printed.

Illustrative only. The model is deliberately simple and needs review by a qualified actuary before anyone relies on it.

## Assumptions

- **Gilt yields** come from the Bank of England's daily nominal zero coupon yields (5, 10 and 20 years). The app interpolates the curve at the liability duration. To refresh them, run:

  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\update-market-data.ps1
  ```

  This rewrites `data/market-data.js`. The Bank of England site doesn't allow browsers to fetch its data directly, which is why the download happens in a script.
- **Growth asset classes**: each has an expected return over gilts and a volatility, and a correlation matrix combines them. The built-in set is placeholder numbers only.
- **Quarterly assumption sets**: upload a CSV in the Growth assets panel. `templates/asset-class-assumptions-template.csv` shows the layout (it's the same as "Download as CSV" in the app). Uploads are checked (numbers, a symmetric matrix with 1s on the diagonal, internally consistent correlations) and saved in the browser they were uploaded in.
- **Funding bases**: liabilities are valued on a main basis of gilts plus a margin. An optional second basis (name and margin entered by the user) revalues the same benefits at its own margin using the liability duration. You choose which basis the surplus release test and the employer contribution trigger use.
- **Inflation**: part of the liabilities is inflation-linked and moves with market implied inflation, offset by the inflation hedge ratio.

## Files

- `index.html`: page layout
- `css/styles.css`: styling, including print layout
- `js/model.js`: the projection model (seeded, so the same inputs always give the same results)
- `js/assumptions.js`: asset class assumption sets, CSV import/export and validation
- `js/app.js`: inputs, charts and run record
- `data/market-data.js`: latest gilt yields (generated)
- `tools/update-market-data.ps1`: refreshes the gilt yields from the Bank of England
- `serve.ps1`: tiny local web server for previewing

## Preview locally

In PowerShell, from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8080. It's a plain static site with no build step. Charts use Chart.js from a CDN.
