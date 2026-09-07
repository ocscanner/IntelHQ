# IntelHQ

OC Scanner's unified monitoring and newsroom command center.

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
- Structured digest builder with copy and Markdown download
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

## Phase 2: distribution

Distribution is intentionally separate from the newsroom MVP. The next phase
will take an approved digest and publish channel-specific versions for the OC
Scanner public site, email, X, Instagram, and member products. No distribution
or external AI service is called by the current newsroom module.
