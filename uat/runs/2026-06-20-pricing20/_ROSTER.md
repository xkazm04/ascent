# pricing-20 roster — 20 new Characters × `repeated-org-scans-worth-the-price`

Theme: **does *repeated* use of the org scan bring value worth the price**, judged across company sizes, stacks, and situations. L2 engine = `claude-cli`. Each Character hits a different facet of recurring-value-vs-price. Slugs map to `uat/characters/<slug>.md`.

| # | slug | who / size | stack | tier | recurring-value angle (the facet this Character owns) |
|---|------|------------|-------|------|------------------------------------------------------|
| 1 | `priyanka-indie-solo` | Priyanka, solo indie hacker, **1 dev** | Next.js/TS, 1 SaaS repo + a few public | Free→? | N=1: is paying *anything* worth it for a repo I wrote myself? does repetition mean anything at one repo? |
| 2 | `yusuf-bootstrapped-rails` | Yusuf, bootstrapped profitable, **7 eng** | Rails monolith (1 big private repo) | Pro | re-scanning ONE monolith weekly — flat or moving? is Pro's 100 credits mispriced for a monolith shop? |
| 3 | `lena-seed-node-cto` | Lena, seed-stage CTO, **15 eng** | Node/TS microservices, 12 private repos | Team | investor ROI line each quarter from the trajectory; just bought Cursor; weekly cadence, 48 cred/mo |
| 4 | `gabriel-seriesb-vp` | Gabriel, Series-B VP Eng, **120 eng** | polyglot Go+TS+Python, ~60 repos | Team→Ent | board wants the SAME trend each quarter; 60 repos × daily blows past 500 credits → forced upgrade |
| 5 | `anika-jvm-platform` | Anika, platform lead, **400 eng** | Java/Kotlin/Gradle, ~200 repos | Enterprise | does the model read JVM signals well *repeatedly*; recurring value = adoption curve across 200 repos |
| 6 | `robert-enterprise-dotnet` | Robert, Director, **2000 eng** | .NET + legacy | Enterprise+SSO | never logs in — lives on the DIGEST/alert; recurring value = the between-login artifact at renewal |
| 7 | `sasha-megacorp-buildvsbuy` | Sasha, DevEx/measurement lead, **10k eng** | every stack; already builds DORA dashboards | eval | why BUY vs extend our in-house platform? is the AI-maturity lens + trajectory enough of a moat |
| 8 | `bruno-agency-principal` | Bruno, dev-agency principal | scans **clients'** repos (~8 orgs) | Team | recurring value = a billable monthly client health report; segments=clients; resold deliverable |
| 9 | `helena-ma-techdd` | Helena, M&A tech due-diligence advisor | scans a **target's** repos per deal | resists sub | her use is BURSTY/one-shot per deal — challenges the *subscription* fit; wants pay-per-burst |
| 10 | `theo-pe-portfolio` | Theo, PE operating partner | **portfolio of ~15 companies**, quarterly | Enterprise | quarterly cadence → only ~4 points/yr → low trend confidence (R²); is quarterly enough for a trajectory |
| 11 | `mariam-fintech-audit` | Mariam, regulated fintech lead, **80 eng** | Java/Scala | Team→Ent | recurring value = the compliance AUDIT TRAIL; retention (365 vs custom) is the deciding feature |
| 12 | `owen-healthtech-privacy` | Owen, HIPAA platform eng, **60 eng** | wants Bedrock/self-host, not cloud Claude | Pro/Ent | recurring value GATED by privacy — does it survive a non-Claude engine; can't leak code to cloud weekly |
| 13 | `diane-gov-onprem` | Diane, gov/public-sector contractor | .NET/Java, **on-prem/air-gapped** | Enterprise | cloud Claude is out; recurring value = an audit artifact for the contracting officer; renewal=checkbox |
| 14 | `kenji-oss-foundation` | Kenji, OSS foundation maintainer | many **public** repos | Free forever | is Free TOO generous? unlimited public scans+badge+trend for $0 → any reason to ever pay? (monetization gap) |
| 15 | `camille-devtools-vendor` | Camille, PMM at a **rival** DevEx vendor | competitor-buyer | skeptic | is the recurring value sticky or a one-time novelty; where's the churn risk; does the trajectory differentiate |
| 16 | `arjun-ml-platform` | Arjun, data/ML platform lead, **50 eng** | Python/notebooks/ML, ~40 repos | Team | does the 9-dim model even FIT ML repos repeatedly (no tests, experiment churn) → is the trend just noise |
| 17 | `sofia-mobile-em` | Sofia, mobile org EM, **90 eng** | Swift/Kotlin monorepo + ~20 repos | Team | recurring value tied to RELEASE-TRAIN readiness; D3 CI/CD is her north star; cadence = per release |
| 18 | `klaus-embedded-firmware` | Klaus, embedded/firmware lead, **25 eng** | C/C++/Rust, infrequent commits | Pro | LOW VELOCITY: re-scanning a quarterly-changing repo → FLAT trajectory; is he paying for a flatline? |
| 19 | `tania-scaleup-costcut` | Tania, scaleup EM, **150 eng** | mixed | Team (renewal) | pure RENEW-OR-CUT under CFO pressure; has anyone OPENED/actioned it since last renewal (the churn signal) |
| 20 | `victor-finops-director` | Victor, FinOps-minded Eng Director, **300 eng** | mixed | Team | UNIT ECONOMICS: credit burn vs included 500; right-sized or overpaying/under-provisioned; lives in /usage |

Dispatch: one L1 subagent per row, inheriting `_L1-BRIEF.md` + the journey, writing the durable `characters/<slug>.md` + the L1 report. Synthesis subagent rolls up the pricing panel verdict + value ledger. L2 (claude-cli) confirms the live recurring output on a representative subset.
