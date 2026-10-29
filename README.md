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

  This rewrites `data/market-data.js`. It also works out **gilt yield volatility** and **implied inflation volatility** from the same Bank of England curves: the standard deviation of 12-month changes in month-end values over the last 10 years (change with `-LookbackYears 15`, for example). The app reads each at the liability duration. The Bank of England site doesn't allow browsers to fetch its data directly, which is why the download happens in a script.
- **Longevity**: the same script downloads the ONS national life tables (UK) and measures how much period life expectancy at 65 (average of men and women) changes from one year to the next over the last 20 years (`-LongevityLookbackYears` to change). Longevity uncertainty = that volatility × the scheme's liability increase per extra year of life expectancy, which the user enters. Both the uncertainty and the longevity stress stay off until it's entered, and the uncertainty can be overwritten.
- **Growth asset classes**: each has an expected return over gilts and a volatility, and a correlation matrix combines them. The built-in set is placeholder numbers only.
- **Quarterly assumption sets**: upload a CSV in the Growth assets panel. `templates/asset-class-assumptions-template.csv` shows the layout (it's the same as "Download as CSV" in the app). Uploads are checked (numbers, a symmetric matrix with 1s on the diagonal, internally consistent correlations) and saved in the browser they were uploaded in.
- **Funding bases**: liabilities are valued on a main basis of gilts plus a margin. An optional second basis (name and margin entered by the user) revalues the same benefits at its own margin using the liability duration. You choose which basis the surplus release test uses.
- **Buyout top-up**: optionally, the employer pays any shortfall to the insurer's price so the scheme buys out by a chosen year (blank by default, meaning the scheme waits until it can afford it). Top-ups count as employer contributions.
- **Recovery plans**: at each valuation (today, then every few years), a deficit on the main funding basis sets a level annual contribution, fixed until the next valuation, that clears the deficit over the recovery period at the discount rate. Optional: an investment outperformance allowance on the assets (reduces the contribution) and a trigger level (only set a plan if funding is below it). Both are blank by default.
- **Inflation**: part of the liabilities is inflation-linked and moves with market implied inflation, offset by the inflation hedge ratio.

## Hosting

The site is published with GitHub Pages by `.github/workflows/deploy.yml`:

- every push to `main` deploys the site;
- every weekday at 07:30 UTC (or on a manual run from the Actions tab) it refreshes the Bank of England and ONS data, commits it, and deploys.

On the hosted site the page reads `data/market-data.json`; locally, `serve.ps1` refreshes it on demand instead.

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

Then open http://localhost:8080. Market data is live: each time the page opens it asks the server for the latest, and the server re-runs `tools/update-market-data.ps1` if its copy is over an hour old (`-RefreshMinutes` to change). ONS life tables are re-downloaded only when the cached copy is over 30 days old. Inputs you've typed over are kept; the header shows the "as at" date. It's a plain static site with no build step. Charts use Chart.js from a CDN.
