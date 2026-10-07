# Graph Report - Tiny Fish  (2026-10-08)

## Corpus Check
- 90 files · ~56,529 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .example 1, .css 1)

## Summary
- 646 nodes · 1841 edges · 17 communities (13 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- client.js / Results.js / ScoutProvider.js
- service.js / json() / readJson()
- auth.js / http.js / handler()
- rank.js / parse.js / profile.js
- store.js / env() / env.js
- discover.js / llm.js / discover()
- Scout Security Policy / Deploying Scout to Hos / Scout (live job finder
- package.json / scripts / proxy.js
- analyze/route.js / POST / describe.js
- password.js / checkPassword() / AuthScreen.js
- resume.js / resume/route.js / readResume()
- typos.js / correctTerms() / correctTerm()
- compilerOptions / jsconfig.json / baseUrl
- next.config.mjs / next / headers()

## God Nodes (most connected - your core abstractions)
1. `json()` - 58 edges
2. `readJson()` - 38 edges
3. `forUser()` - 36 edges
4. `handler()` - 31 edges
5. `discover()` - 29 edges
6. `env()` - 29 edges
7. `useScout()` - 22 edges
8. `api()` - 21 edges
9. `emailAllowed()` - 20 edges
10. `POST` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Scout logo icon (purple rounded square with magnifier)` --conceptually_related_to--> `Scout (live job finder)`  [INFERRED]
  app/icon.svg → README.md
- `TinyFish Search, Fetch and Agent` --semantically_similar_to--> `Search/Fetch/Agent cost-ordered split`  [INFERRED] [semantically similar]
  README.md → docs/PRODUCT_OVERVIEW.md
- `Hard filters and weighted score` --semantically_similar_to--> `Match ranking (0-100)`  [INFERRED] [semantically similar]
  docs/PRODUCT_OVERVIEW.md → README.md
- `Gemini AI reading` --semantically_similar_to--> `Gemini AI reading`  [INFERRED] [semantically similar]
  docs/PRODUCT_OVERVIEW.md → README.md
- `Firestore permanent storage` --semantically_similar_to--> `SQLite and Firestore storage backends`  [INFERRED] [semantically similar]
  docs/DEPLOY.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Scout authentication system** — security_allow_list_auth, security_password_login, security_oauth, security_sealed_session, security_email_verification [EXTRACTED 1.00]
- **Parse, filter, score and dedupe pipeline** — docs_product_overview_feature_engineering, docs_product_overview_hard_filters_scoring, docs_product_overview_dedupe [EXTRACTED 1.00]
- **TinyFish discovery pipeline** — docs_product_overview_tinyfish_search, docs_product_overview_tinyfish_fetch, docs_product_overview_tinyfish_agent [EXTRACTED 1.00]

## Communities (17 total, 4 thin omitted)

### Community 0 - "client.js / Results.js / ScoutProvider.js"
Cohesion: 0.06
Nodes (74): dynamic, Alerts(), Bell(), Companies(), Openings(), Drawer(), PARTS, ChipGroup() (+66 more)

### Community 1 - "service.js / json() / readJson()"
Cohesion: 0.07
Nodes (70): GET, DELETE, GET, POST, refuse(), maxDuration, POST, POST (+62 more)

### Community 2 - "auth.js / http.js / handler()"
Cohesion: 0.09
Nodes (65): DELETE, dynamic, GET(), POST, POST, POST, dynamic, GET() (+57 more)

### Community 3 - "rank.js / parse.js / profile.js"
Cohesion: 0.06
Nodes (70): ago(), buildJob(), cleanTitle(), detectOptCpt(), detectSeniority(), detectType(), detectVisa(), detectWorkMode() (+62 more)

### Community 4 - "store.js / env() / env.js"
Cohesion: 0.06
Nodes (54): dynamic, GET, maxDuration, POST, run, dynamic, GET, maxDuration (+46 more)

### Community 5 - "discover.js / llm.js / discover()"
Cohesion: 0.08
Nodes (49): GET, ADAPTERS, ATS, boardName(), cachedSearch(), DEPTH, detectAts(), discover() (+41 more)

### Community 6 - "Scout Security Policy / Deploying Scout to Hos / Scout (live job finder"
Cohesion: 0.05
Nodes (53): Scout logo icon (purple rounded square with magnifier), Deploying Scout to Hostinger, Required credentials and env settings, Firestore permanent storage, GitHub OAuth setup, Google OAuth setup, Hostinger managed Node.js deployment, Nginx reverse proxy (+45 more)

### Community 7 - "package.json / scripts / proxy.js"
Cohesion: 0.06
Nodes (33): app_globals, body, display, metadata, dependencies, @google-cloud/firestore, next, react (+25 more)

### Community 8 - "analyze/route.js / POST / describe.js"
Cohesion: 0.12
Nodes (28): POST, refuse(), Blocks(), Description(), inline(), size(), descriptionText(), FACT_LABELS (+20 more)

### Community 9 - "password.js / checkPassword() / AuthScreen.js"
Cohesion: 0.12
Nodes (19): dynamic, metadata, dynamic, metadata, AuthFrame(), BLIPS, SOURCES, AuthScreen() (+11 more)

### Community 10 - "resume.js / resume/route.js / readResume()"
Cohesion: 0.23
Nodes (14): DELETE, POST, refuse(), checkResumeText(), bad(), docxText(), ext(), MAX_BYTES (+6 more)

### Community 11 - "typos.js / correctTerms() / correctTerm()"
Cohesion: 0.31
Nodes (8): correctTerm(), correctTerms(), distance(), KEEP, KNOWN, snap(), VOCAB, WORDS

### Community 12 - "compilerOptions / jsconfig.json / baseUrl"
Cohesion: 0.50
Nodes (3): compilerOptions, baseUrl, paths

## Knowledge Gaps
- **142 isolated node(s):** `dynamic`, `dynamic`, `maxDuration`, `maxDuration`, `dynamic` (+137 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 169 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `client.js / Results.js / ScoutProvider.js` to `analyze/route.js / POST / describe.js`, `password.js / checkPassword() / AuthScreen.js`, `package.json / scripts / proxy.js`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `next` connect `package.json / scripts / proxy.js` to `auth.js / http.js / handler()`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `json()` connect `service.js / json() / readJson()` to `auth.js / http.js / handler()`, `store.js / env() / env.js`, `discover.js / llm.js / discover()`, `analyze/route.js / POST / describe.js`, `resume.js / resume/route.js / readResume()`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **What connects `dynamic`, `dynamic`, `maxDuration` to the rest of the system?**
  _142 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `client.js / Results.js / ScoutProvider.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06118421052631579 - nodes in this community are weakly interconnected._
- **Should `service.js / json() / readJson()` be split into smaller, more focused modules?**
  _Cohesion score 0.07496580027359781 - nodes in this community are weakly interconnected._
- **Should `auth.js / http.js / handler()` be split into smaller, more focused modules?**
  _Cohesion score 0.09380071405387862 - nodes in this community are weakly interconnected._