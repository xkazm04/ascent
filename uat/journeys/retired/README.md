# Retired journeys

`/uat run` selects from `uat/journeys/*.md`, so a journey parked one level down is out of the
active set — not scored, not scheduled, not counted in coverage.

Same rule as [`characters/retired/`](../../characters/retired/README.md): a journey is retired when
the **product surface its definition-of-done depends on no longer exists**, it keeps
`promotion: retired` + `retired:` + `retired_reason:` in frontmatter and a blockquote naming what is
preserved and what is now false, and everything below that blockquote is the original, unedited.

| Journey | Character | Retired | Why |
| --- | --- | --- | --- |
| [badge-my-oss-repo.md](badge-my-oss-repo.md) | [Mei](../../characters/retired/mei-oss-maintainer.md) | 2026-08-29 | The `/badge` generator and both SVG endpoints were removed from the product. |
