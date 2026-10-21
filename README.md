# IntelHQ

OC Scanner's unified monitoring and newsroom command center.

## Election night board

The Politics & Elections tab includes a live results board for the 2026 midterms
(House, Senate and governors, nationwide), with desk tools for entering race calls.
Setup and election-night instructions are in [`elections/README.md`](elections/README.md).

## Newsroom workflow

The Newsroom module adds a private, device-local editorial workspace alongside
the existing live monitoring tools:

- Quick-capture story queue with desk, priority, verification, and pipeline states
- Automated discovery inbox fed by IntelHQ's existing news and alert sources
- Headline clustering, urgency/relevance scoring, filters, and one-click tracking
- Track actions embedded directly into local, political, military, election, and space feeds
- Research dossiers for confirmed facts, unknowns, claims, sources, and analysis
- Editorial review queue with readiness checks and an explicit approval gate
- Editorial task planner and weekly review
- Browsable archive of saved weekly reviews
- Publish-ready article builder with public-site Markdown front matter
- Formatted editorial preview matching the public site's story hierarchy
- Paragraph-led Daily Signal, weekly roundup, and single-incident formats
- Human approval gate that only releases sourced, corroborated or verified stories marked Ready
- Distribution Studio with editable public-site, email, X, and Instagram editions
- Per-channel scheduling, hold, failure, retry, published URL, and correction states
- Permanent publication IDs and a timestamped audit log
- JSON backup and restore

Newsroom records are stored in the current browser's `localStorage`. Use the
**Backup** action regularly, especially before clearing browser data or moving
to another device.

Discovery scores prioritize recent, locally relevant, urgent, and independently
corroborated signals. A high score is a review aid, not verification. Tracking a
candidate creates a research dossier; it does not publish anything.

## Verification language

- **Reported:** one credible source has made the claim
- **Corroborated:** multiple independent signals support the claim
- **Verified:** confirmed through primary evidence
- **Developing:** important facts remain uncertain or in conflict

## Distribution Studio

The first distribution milestone is included. Generate a briefing from stories
that are marked **Ready**, complete the human approval confirmation, and select
**Approve & create package**. IntelHQ creates editable versions for:

1. OC Scanner public-site article
2. Email edition of The Signal
3. Long-form X post or thread
4. Instagram caption and carousel outline

Use the channel controls to save final edits, copy or download an edition,
schedule it, record publication or failure, place it on hold, and log a
correction. A failed channel can be retried without altering successful channel
records. Stories move to Published only after all four channel records are
marked Published.

This release does not post directly to external platforms. Scheduling and
publication are operator records until platform accounts and a durable backend
are connected. Newsroom, briefing, and publication data remain in this
browser's `localStorage` and are included in JSON backups.

## Building a public-site article

The Article Builder writes from the reporting saved with Queue stories. For the
strongest finished copy, add a source URL plus a source summary or key facts in
Quick Capture, then expand the story's Research File with confirmed facts,
analysis, and unresolved details. The builder turns that material into clean
paragraphs and linked attribution without inventing missing facts.

Choose **Daily intelligence roundup** or **Weekly news roundup** to combine
multiple Queue stories under The Signal. Choose **Single-story incident report**
to turn the highest-priority matching story into its own article. The downloaded
Markdown file includes the `title`, `date`, `tag`, `author`, and `excerpt` front
matter expected by the PublicSiteTest blog. Upload it to that site's `posts`
folder to publish it.
