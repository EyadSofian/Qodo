# Send Offer

`/hr/recruitment/offers` adds template selection, candidate and contract fields,
salary component totals, a bilingual email message, document content preview,
saved Word downloads, and sending through the existing company SMTP transport.
The employee handbook is appended by the server to **every** send. HR can also
attach an employment application, with its basic identity fields filled in.

The supplied set contains Arabic and English job offers, the English Sales
Operations appendix, an Arabic employment contract, the freelance UI/UX offer,
the three-month LMS offer, and the bilingual employment application. Their terms
remain separate. The importer changes only mapped variable paragraphs and
preserves Word styles, tables, headers, footers and media. Signature spaces remain
unsigned. This feature does not certify or revise the legal wording of a source.

## Private document installation

This repository is public. **Never commit the HR source files, generated template
assets, candidate drafts, or recordings.** The ignored local assets directory is
only a development fixture. Production reads each organization's catalog from
`recruitmentOfferCatalogs` and its documents from the private blob store, with
authenticated downloads that repeat the offer access checks. Nothing is placed
under `public/` or exposed through a static file route.

Prepare the supplied documents locally, then install them using the intended
Qodo database connection (credentials supplied through the environment):

```sh
python3 scripts/hr/prepare-offer-templates.py /private/source/documents
node scripts/hr/install-offer-catalog.mjs /private/prepared/templates engosoft
```

The first command writes `server/hr/assets/offers/` locally. Use that absolute
directory for the second command. All original checksums are checked before
writing. Installation stores originals and prepared templates separately and
retains content-addressed blobs on replacement. Production never falls back to
filesystem fixtures. A missing catalog reports `offer_catalog_not_configured`.

The audio request says the official email wording will be supplied later. The
starter Arabic and English messages can be edited per offer. An authorized HR
settings owner can save the shared wording for future offers. Supported message
variables are `candidateName`, `jobTitle`, `joiningDate`, `project`, and
`companyName` inside double braces. An email template is text, never executable
code or arbitrary HTML.

## Access and sending

`hr.manage` or the dedicated `hr.recruitment.offers` permission opens the desk.
HR managers see the organization's offers; a user holding only the dedicated key
sees their own offers. Reading ordinary recruitment data does not authorize
sending offers. Shared email changes additionally require `hr.settings.manage`.

Saving creates an immutable version with its rendered content, email, exact
attachment bytes and checksums. Changing a saved version produces a new version.
The server validates required fields and expiration again before sending, and a
durable `recruitmentOfferSends` claim ensures concurrent callers send a saved
version at most once. All send attempts and template changes are audited.

`sent` means SMTP accepted the message, **not** confirmed inbox delivery.
`failed` means the recipient was rejected. A transport failure is `unknown`:
SMTP can lose its connection after accepting DATA, so that version is never
retried automatically. Check the sender's mailbox before explicitly making a new
version. A process interrupted after claiming remains `sending` and also needs
mailbox investigation. Missing SMTP configuration does not consume a claim.

Required server variables remain `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and optionally `SMTP_FROM`. They stay in the deployment environment.

## Validation

```sh
npm run build
npm test
```

The default offer tests generate synthetic, non-confidential fixtures so a fresh
checkout is reproducible. For a private-source verification run:

```sh
HR_OFFERS_REAL_FIXTURES=/private/prepared/templates node --test server/hrOffers.test.js server/hrOffers.integration.test.js
```

The integration test installs a catalog into an isolated store, starts the app
in production mode, and sends to a local SMTP fixture. It checks the actual MIME
attachments, the handbook bytes, authenticated downloads, and duplicate-send
prevention without contacting a real candidate.
