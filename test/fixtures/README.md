# Release body fixtures

Trimmed GitHub Releases payloads (tag_name / published_at / html_url / body only) used by
test/changelog.test.mjs. They pin the body shapes the parser must keep handling:

- release-0.2.2-rc.1.json — newest body: four `<h3 id="cn-…">` sections, bilingual, long.
- release-0.2.2-alpha.3.json — Alpha channel, three sections.
- release-0.2.0-rc.1.json — emoji-prefixed section headings.
- release-markdown-headings.json — `###` markdown headings (older/compact bodies).
- release-0.1.0-rc.7.json — Chinese-only body (no English half).

Regenerate by re-reading the GitHub Releases API; do not hand-edit the bodies.
