# Chrome Web Store Submission Checklist — Athena Companion

Step-by-step for submitting `athena-companion-0.1.1.zip` to the Chrome Web Store.

---

## Phase 1 — Developer account setup (one-time, ~15 min)

- [ ] **Pay the $5 USD Chrome Web Store developer registration fee.**
      Go to <https://chrome.google.com/webstore/devconsole>, sign in with the Google account you want to publish under (recommend a dedicated account, NOT your personal Gmail), pay the one-time $5 fee.
- [ ] **Verify the publisher identity.** Google may require a confirmation email or, for some regions, additional KYC. Allow a few hours.
- [ ] **(Recommended) Set up a publisher group** if more than one team member needs publish access. Group publishers get reviewed once and shared across items.

---

## Phase 2 — Host the privacy policy (one-time, ~30 min)

The Web Store will reject submissions whose privacy policy URL 404s or points to a Markdown file in a public repo.

- [ ] **Decide where to host.** Two reasonable options:
      1. Add a `/privacy` route to `apps/admin-web` (Next.js) that renders `apps/chrome-extension/PRIVACY_POLICY.md`. Final URL: `https://athena-admin-web-production.up.railway.app/privacy`.
      2. Spin up a static site (e.g. Vercel + a Markdown renderer) at `https://athena-app.com/privacy`.
- [ ] **Confirm the URL is publicly reachable, returns HTTP 200, and includes the contact email.**
- [ ] **Update STORE_LISTING.md and PRIVACY_POLICY.md** to swap out the `[hosted URL — see PRIVACY_POLICY.md]` placeholder for the real URL.

---

## Phase 3 — Capture screenshots (~30 min)

Need at least one, recommended four. Each must be 1280×800 (or 640×400, but 1280 is much better).

- [ ] **Run a real Meet call** (you can do this solo with a second tab using a fake mic source if needed) and trigger the capture flow.
- [ ] Capture:
      1. Meet tab with active suggestion card + recording pill visible.
      2. Meet tab with the floating Athena history panel open.
      3. Extension popup with capture running ("● Live — listening for prompts").
      4. Extension popup with the sign-in card.
- [ ] Save as 1280×800 PNGs. macOS shortcut: `Cmd+Shift+4`, then resize in Preview if needed. For pixel-perfect dimensions: open the screenshot in Preview → Tools → Adjust Size → enter 1280×800.
- [ ] **(Optional but recommended)** Generate a 440×280 promo tile and a 1400×560 marquee tile in Figma using the brand colors documented in `store-listing.md`.

---

## Phase 4 — Upload and configure the listing (~45 min)

- [ ] In the Developer Console, click **New Item**.
- [ ] **Upload `apps/chrome-extension/athena-companion-0.1.1.zip`**. Wait for the manifest to be parsed (a few seconds).
- [ ] Fill out the **Store listing** tab:
      - Item name: `Athena Companion`
      - Short description: paste from `store-listing.md` (Short description section)
      - Detailed description: paste from `store-listing.md` (Detailed description section)
      - Category: **Productivity** → **Workflow & Planning Tools**
      - Language: English
      - Upload the 4 screenshots
      - Upload the 128×128 store icon (use `apps/chrome-extension/src/icons/icon-128.png`)
      - (Optional) Upload the 440×280 promo tile
- [ ] Fill out the **Privacy practices** tab:
      - Single purpose: paste from `store-listing.md` (Single-purpose description section)
      - For each permission used, paste the matching `Why we need it` row from the `store-listing.md` permissions table
      - Privacy policy URL: the URL from Phase 2
      - Check all three data-handling certifications
      - Disclose data collection (PII, authentication info, personal communications, user activity) per the table in `store-listing.md`
- [ ] Fill out the **Distribution** tab:
      - Visibility: **Unlisted** (recommended for v1 — see "Distribution decision" below)
      - Geographic distribution: All regions, OR restrict to where you plan to sell. Default: All.
      - Pricing: Free
- [ ] Click **Submit for review**.

---

## Phase 5 — After submission

- [ ] **Review timeline:** typically 1–3 business days for a first submission. Can stretch to 1–2 weeks if the reviewer asks follow-up questions or rejects on a fixable issue.
- [ ] **Watch the publish-status email** Google sends when the review completes. If rejected, the email will name the policy clause; fix and resubmit.
- [ ] **Once approved:**
      - For **Unlisted** distribution: the install URL is `https://chromewebstore.google.com/detail/<your-extension-id>`. Share manually with early customers.
      - For **Public** distribution: the listing appears in store search results.
- [ ] **Bump the manifest version** for every subsequent upload. The Web Store rejects re-uploads of the same version number.

---

## Distribution decision (REQUIRES YOUR JUDGEMENT)

| Mode | When to pick |
|---|---|
| **Unlisted** | v1, you want early customers only, you'll share install URLs manually, you don't want public reviews/ratings yet. **Recommended for the first submission.** |
| **Public** | You're ready for organic discovery, your support volume can absorb random Chrome users, your marketing site is ready to convert traffic. |
| **Private (Trusted Testers)** | Internal-only; you have a trusted-tester list configured in the dev console. |

You can switch from Unlisted → Public later without re-review, so Unlisted is the safer first move.

---

## Versioning strategy

- `0.1.1` — current. First Web Store submission.
- `0.1.x` — patch fixes that don't change permissions, manifest, or single purpose.
- `0.2.0` — minor feature additions (e.g. a new in-Meet UI element).
- `1.0.0` — bump when the extension is feature-complete for general public launch (post-review feedback addressed, screenshots refreshed, privacy policy URL stable).

---

## Re-build checklist (every release)

```bash
ATHENA_API_URL=https://athena-api-production-aa5b.up.railway.app \
ATHENA_GATEWAY_URL=https://athena-realtime-production.up.railway.app \
pnpm --filter @athena/chrome-extension build:prod

# Then zip dist/ to athena-companion-<version>.zip
cd apps/chrome-extension/dist
zip -r ../athena-companion-<version>.zip .
```

Verify before upload:
- [ ] `dist/manifest.json` version matches the file name
- [ ] No `.map` files in the zip (`unzip -l athena-companion-<version>.zip | grep .map` returns nothing)
- [ ] No `.DS_Store` or other dotfiles
- [ ] Total size well under 5MB
- [ ] `pnpm typecheck` passes
