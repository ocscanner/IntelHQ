# IntelHQ Distribution — Phase 2

The newsroom is the source of truth. Distribution begins only after a briefing
has been reviewed and explicitly approved by the operator.

## First distribution milestone — built

Create one approved briefing record and generate four channel-ready versions:

1. OC Scanner public-site article
2. Email edition of The Signal
3. Long-form X post or thread
4. Instagram caption and carousel outline

Each version should retain the same facts, verification language, source links,
corrections, and publication timestamp while adapting length and formatting to
the channel.

IntelHQ now creates these four editable editions after a ready-only briefing
passes the human approval gate. Each release receives a permanent publication
ID and independent channel states for draft, schedule, publication, failure,
hold, and correction handling.

## Recommended workflow

`Research file → Digest draft → Human review → Approve → Preview channels → Publish`

No breaking-news item should auto-publish directly from an AI or feed result.

## Distribution controls

- Required human approval and final edit
- Channel-specific preview before publishing
- Source and confidence checks
- Hold, schedule, publish, update, and correction states
- Permanent publication ID shared across every channel version
- Publication log with timestamp, destination, result, and canonical URL
- Retry failed channels without duplicating successful posts

## Build order

1. **Complete:** Generate and manage public-site, email, X, and Instagram editions.
2. Connect the public-site archive and email provider after durable storage and authentication are selected.
3. Enable direct X and Instagram publishing only after the approval and audit flow is reliable.
4. Add paid-member and business brief variants.
5. Add conversion and revenue analytics to the weekly review.

## Data migration

The phase-one newsroom is stored on the current device. Before multi-device or
automated distribution, move stories, dossiers, tasks, approvals, and
publication records into authenticated durable storage. Keep JSON import/export
as an operator-controlled backup path.
