# Upload ManwhaTrack to the Chrome Web Store

This bundle contains the extension ZIP and the separately uploaded Store assets. Upload the **inner `manwhatrack-1.2.2.zip`**, not the outer submission bundle. The extension ZIP contains `manifest.json` at its root and a copy of `PRIVACY.md`.

## 1. Package

Open https://chrome.google.com/webstore/devconsole in your registered publisher account. Choose **Add new item → Choose file → Upload**, and select `manwhatrack-1.2.2.zip`. If updating an existing item, upload it under that item's Package tab instead.

The developer account's registration, contact verification and account security settings belong to your Google account and are not contained in the ZIP.

## 2. Store listing

Copy the name, summary and description from `dashboard-fields.txt` (plain text, ready to paste). `listing.json` contains the same fields in structured form. Choose English and the closest applicable reading/library/productivity category offered by the dashboard. Set the homepage and support URLs from the same file.

Upload the following files from `assets/`:

| Dashboard field | File |
| --- | --- |
| Icon | `icon-128.png` (also embedded in the extension) |
| Small promotional image | `promo-440x280.png` |
| Screenshot 1 | `01-library-1280x800.png` |
| Screenshot 2 | `02-lists-1280x800.png` |
| Screenshot 3 | `03-details-1280x800.png` |
| Screenshot 4 | `04-analytics-1280x800.png` |
| Screenshot 5 | `05-settings-1280x800.png` |

These screenshots show the actual production extension in an isolated demonstration profile. Fictional titles, procedural covers and example analytics illustrate the interface; they are not a user's reading history or promised results. The library and list screenshots show automatically tracked fixture pages. Analytics history is synthetic demonstration data.

## 3. Privacy practices

Copy the Single purpose and individually named Permission sections from `dashboard-fields.txt` into the matching fields. Use `host_permissions` for the website-access justification and `notifications` if the dashboard asks about the optional permission.

Select **No, I am not using remote code**. The explanation is in `remoteCodeExplanation`.

Disclose **Web history**, **User activity**, and **Website content**: reading URLs, progress/time interactions, extracted metadata and locally entered reading notes are handled on-device. Do not select a blanket “no user data” answer merely because storage is local. Use `dataUseExplanation` wherever supporting text is requested. The three `dataUseCertifications` describe the implemented practices; confirm them in the dashboard.

Privacy policy URL:

https://github.com/desenyon/ManwhaTrack/blob/main/PRIVACY.md

The public policy includes the Limited Use declaration, local data handling, direct source requests, retention/deletion, backups, Incognito behavior and support contact. The bundle includes the same policy for reference.

## 4. Test instructions

Paste the contents of `reviewer-instructions.txt` into the Test instructions field. No ManwhaTrack login, paid subscription or test credentials are required.

## 5. Distribution and review

Choose the audience, countries and visibility you want. The extension has no built-in payments. Save the listing, review the populated fields and submit for review. Choose deferred publishing if you want to approve the final publication yourself after review.

Google reviews the package and listing separately; a successful local package check does not guarantee Store approval.

## Rebuild

From the repository root:

```sh
STORE_ASSET_DIR=chrome-web-store/assets npm run test:e2e -- store-assets
npm run package:store
```

`package:store` validates the manifest, matching privacy text, listing fields, permission explanations and image dimensions, then writes both ZIPs to the repository root. `checksums.txt` records the upload ZIP and asset hashes.

Official requirements checked October 3, 2026:

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
