---
name: trademark-check
description: >
  Use this skill when the user wants to check if a name, game title, character name, or brand is safe to use — i.e., does not conflict with existing trademarks or business names. Trigger phrases include: "check if this name is trademarked", "is [name] safe to use in my game", "trademark conflict check", "name risk analysis", "check for trademark issues", "is [name] already a trademark", "can I use the name [name]", "check business name conflict", "商标检查", "名称风险分析", "排查商标". Always use this skill when the user wants to assess legal or branding risk for a name they intend to use in a game or product.
version: 0.2.0
---

# Trademark & Business Name Risk Check

Analyse one or more names for potential trademark and business name conflicts, within a specific business field (e.g., video games, board games, entertainment). Run a structured pipeline: AI pre-reasoning → USPTO LIVE-mark search → business name search → manual verification links → risk report.

Support both Chinese and English input — detect the user's language and respond in the same language.

---

## Configuration

| Parameter | Source | Purpose |
|---|---|---|
| `MARKERAPI_USERNAME` | Environment variable | Marker API auth (USPTO search) |
| `MARKERAPI_PASSWORD` | Environment variable | Marker API auth (USPTO search) |
| `OPENCORPORATES_API_TOKEN` | Environment variable | OpenCorporates (optional, higher rate limits) |

### First-Time Setup

Before making any API calls, check which credentials are available:

```bash
echo "MARKERAPI: ${MARKERAPI_USERNAME:-NOT SET}"
echo "OPENCORPORATES: ${OPENCORPORATES_API_TOKEN:-NOT SET}"
```

**If `MARKERAPI_USERNAME` is not set:**

Inform the user:
> "Marker API credentials are not configured. This is a free service for the USPTO trademark database. Register at https://markerapi.com and set `MARKERAPI_USERNAME` and `MARKERAPI_PASSWORD`. I'll proceed using the USPTO web interface as fallback."

Continue in **web-fallback mode** (WebFetch on USPTO TMSEARCH).

**Persisting credentials (if user wants to save them):**

```bash
# macOS/Linux
echo 'export MARKERAPI_USERNAME="<value>"' >> ~/.bashrc   # or ~/.zshrc
echo 'export MARKERAPI_PASSWORD="<value>"' >> ~/.bashrc

# Windows PowerShell
[System.Environment]::SetEnvironmentVariable("MARKERAPI_USERNAME", "<value>", "User")
[System.Environment]::SetEnvironmentVariable("MARKERAPI_PASSWORD", "<value>", "User")

# Export for current session
export MARKERAPI_USERNAME="<value>"
export MARKERAPI_PASSWORD="<value>"
```

---

## Core Concept: LIVE vs DEAD Marks

A critical distinction in trademark risk assessment:

- **LIVE marks** (Active, Registered, Pending) = real risk. These are legally enforceable. A LIVE mark in the same IC class as your intended use is a genuine conflict.
- **DEAD marks** (Abandoned, Cancelled, Expired) = informational only. Dead marks are no longer legally protectable and are generally safe to use. Note them but do NOT drive risk levels from dead marks alone.

The manual USPTO TMSEARCH workflow filters out dead marks precisely because they are not blocking concerns. This skill mirrors that logic: **risk scoring is based on LIVE marks only**.

---

## Workflow

### Step 0: AI Pre-Analysis (Reasoning Before Search)

Before touching any external database, use your own knowledge to reason through each name. This replicates the "ask an AI first" step from the manual workflow.

For each name, consider:
- Is this name identical or very similar to a globally famous brand (e.g., Nike, Google, Pokémon, Minecraft)? Flag immediately.
- Is this name a well-known game, franchise, or studio? Flag immediately.
- Does the name contain generic descriptive words that are typically not trademarkable (e.g., "Arena", "Quest", "Legend")? Note as lower concern.
- Are there obvious phonetic near-matches to famous marks?
- Does the name reference real-world entities (countries, public figures, official bodies)? Flag as a separate concern.

Document your pre-analysis findings for each name before moving to database searches. This step catches obvious cases fast and gives context for interpreting database results.

---

### Step 1: Parse Input

Extract the list of names and the intended **business field** (e.g., "mobile game", "board game", "card game", "PC game", "game studio"). If not stated, ask:
> "What type of product will you use these names for? (e.g., video game, board game, company name)"

**IC class mapping by field:**

| Field | Primary Classes | Secondary Classes |
|---|---|---|
| Video / PC / mobile game | IC **009**, **041** | 042, 038 |
| Board game / card game / tabletop | IC **028**, **041** | 009 |
| Game studio / company name | IC **041** | 009, 028 |
| General (unspecified) | IC **009**, **028**, **041** | — |

The primary classes are the ones you filter by in USPTO. Secondary classes are worth checking if primary shows no results.

---

### Step 2: USPTO LIVE Trademark Search

For each name, search only for **LIVE marks** (Active or Pending). Ignore dead marks in risk assessment — they are noted but do not change the risk level.

#### Mode A: Marker API (preferred — if credentials are set)

Run three parallel searches per name:

```bash
# 1. Active trademarks only — the primary risk
curl -s "https://markerapi.com/api/v2/trademarks/trademark/{URL_ENCODED_NAME}/status/active/page/1?username=${MARKERAPI_USERNAME}&password=${MARKERAPI_PASSWORD}"

# 2. All statuses — to catch pending marks and provide dead-mark context
curl -s "https://markerapi.com/api/v2/trademarks/trademark/{URL_ENCODED_NAME}/status/all/page/1?username=${MARKERAPI_USERNAME}&password=${MARKERAPI_PASSWORD}"

# 3. Wildcard — catch composite marks (e.g., "FIRESTORM ONLINE", "FIRESTORM GAMES")
curl -s "https://markerapi.com/api/v2/trademarks/trademark/{URL_ENCODED_NAME}*/status/active/page/1?username=${MARKERAPI_USERNAME}&password=${MARKERAPI_PASSWORD}"
```

If response contains `"next"` key, fetch subsequent pages (cap at 3 pages / ~300 records).

**Class filtering:** From the results, **focus analysis on records whose `ic` field includes the primary IC classes** for the user's field (e.g., 009, 028, 041). Records in unrelated classes are lower priority.

For each result, extract:
- `trademark` — mark name
- `status` — Active / Pending / Expired / Cancelled / Abandoned
- `ic` — IC class codes (comma-separated)
- `description` — goods/services description
- `owner`
- `filingdate`, `registrationdate`, `expirationdate`
- `serialnumber`

Separate results into two buckets:
- **LIVE** (status = Active or Pending) → primary risk assessment
- **DEAD** (status = Expired / Cancelled / Abandoned) → note as informational

#### Mode B: Web Fallback (if Marker API not configured)

Use WebFetch on the USPTO TMSEARCH page. Focus the prompt on LIVE marks in the relevant class:

```
WebFetch URL: https://tmsearch.uspto.gov/search/search-information
Prompt: Search for trademark "{NAME}". Extract only LIVE/ACTIVE trademarks (exclude abandoned, cancelled, expired marks). For each live mark list: trademark name, status, IC class codes, owner, goods/services description, serial number, filing date.
```

Note: The web interface may need manual class filtering by the user. Provide the manual verification link (see Step 4) with instructions on which filters to apply.

---

### Step 3: Business Name Search (OpenCorporates)

For each name, search for active companies with the same or similar name:

```bash
# Without token (limited rate)
curl -s "https://api.opencorporates.com/v0.4/companies/search?q={URL_ENCODED_NAME}&per_page=20&inactive=false"

# With token
curl -s "https://api.opencorporates.com/v0.4/companies/search?q={URL_ENCODED_NAME}&per_page=20&inactive=false&api_token=${OPENCORPORATES_API_TOKEN}"
```

Extract: company name, jurisdiction, status, incorporation date.

**Flag as higher concern** if:
- Exact or near-exact name match (ignore "Inc", "LLC", "Ltd", "Corp", "GmbH" suffixes)
- Company operates in gaming, entertainment, software, or consumer tech
- Company is US-based (highest trademark jurisdiction relevance)

**Flag as low concern** if:
- Name match only shares a word with a clearly unrelated business (e.g., "FireStorm Plumbing")
- Company is inactive

---

### Step 4: Manual Verification Links

For each name, generate ready-to-use manual check links. The user can open these to verify your findings and apply filters the automated search may have missed.

**USPTO TMSEARCH (with guidance):**
```
URL:     https://tmsearch.uspto.gov/search/search-information
Search:  {NAME}
Filter:  ① In the left sidebar, UNCHECK "Dead" under Status — only keep Live marks
         ② In Class Filter, select IC {PRIMARY_CLASS_NUMBERS} (your field's primary classes)
```

**WIPO Global Brand Database** (manual only — automated queries prohibited):
```
URL: https://branddb.wipo.int/en/quicksearch?strategy=text&field=brandName&input={URL_ENCODED_NAME}&lang=en&page=1&sorter=score+desc&maxRec=30
```

**Google cross-check:**
```
URL: https://www.google.com/search?q="{NAME}"+game+trademark
```

---

### Step 5: Risk Assessment

Combine Step 0 (AI reasoning), Step 2 (USPTO), and Step 3 (OpenCorporates) results.

**Risk Levels:**

| Level | Symbol | Criteria |
|---|---|---|
| HIGH | 🔴 | LIVE (Active or Pending) trademark with exact or very similar name in the primary IC classes for the user's field |
| MEDIUM | 🟡 | LIVE trademark in secondary classes with same name; OR exact company name match in gaming/tech; OR AI pre-analysis flagged a famous mark near-match |
| LOW | 🟢 | Only DEAD marks found in primary classes; OR exact match only in clearly unrelated industry; OR minor company name match in unrelated field |
| CLEAR | ✅ | No LIVE trademark matches and no significant company name conflicts found |

**Important:** Dead marks (abandoned, cancelled, expired) do NOT raise the risk level. They are noted in the report as "informational" context only.

**Similarity rules:**
- Exact case-insensitive match = full risk weight
- Name as prefix of a composite mark (e.g., "{NAME} Online") = HIGH if in primary class
- Phonetic near-match = MEDIUM, note the similarity explicitly
- Name contains a famous brand as substring = HIGH, regardless of class

---

### Step 6: Generate the Report

Structure the report as follows, matched to the user's language.

---

## Report Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TRADEMARK & NAME RISK REPORT
 Date:    {date}
 Field:   {user's product field}  |  Primary IC Classes: {009, 041} etc.
 Sources: AI pre-analysis · USPTO (Marker API / TMSEARCH) · OpenCorporates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

For each name, use this block:

```
┌──────────────────────────────────────────────┐
│  NAME: "FireStorm"                Risk: 🔴 HIGH │
└──────────────────────────────────────────────┘

🤖 AI PRE-ANALYSIS
  "FireStorm" is phonetically similar to well-known technology and gaming
  brand names. No globally dominant franchise directly uses this exact name,
  but it is a common compound word used across many software products.
  Proceed to database results for definitive assessment.

📌 USPTO — LIVE MARKS (Active / Pending)
  1. FIRESTORM — Status: Active ✅ ← PRIMARY RISK
     Owner:    EA Games
     IC Class: 041 (Entertainment services)
     Goods:    Online interactive entertainment services, gaming events
     Filed:    2019-03-12 | Registered: 2020-01-08
     Serial:   #88123456
     🔗 https://tsdr.uspto.gov/#caseNumber=88123456&caseType=SERIAL_NO&searchType=statusSearch

  2. FIRESTORM ONLINE — Status: Pending ⏳
     Owner:    Unknown Studio LLC
     IC Class: 009 (Video game software)
     Filed:    2023-11-01
     Serial:   #98765432

📂 USPTO — DEAD MARKS (informational only, not a risk)
  • FIRESTORM (Abandoned 2018, IC 009) — Serial #87654321
    ℹ️ This mark is dead and does not block use.

🏢 BUSINESS NAME MATCHES (OpenCorporates)
  1. FireStorm Interactive LLC — Active
     Jurisdiction: US (California) | Incorporated: 2015-03-10
     ⚠️ Gaming/tech sector — elevated concern

⚠️  ASSESSMENT
  Two LIVE USPTO marks exist for "FIRESTORM": one Active in IC 041 (EA Games)
  and one Pending in IC 009 — both in the primary classes for a video game.
  This is a direct conflict. The active California gaming LLC adds further
  risk. Dead marks are noted but do not factor into the risk level.

  RECOMMENDATION: Do NOT use this name. High probability of trademark dispute.

🔍 VERIFY MANUALLY
  USPTO: https://tmsearch.uspto.gov/search/search-information
         → Search "FireStorm" → Uncheck "Dead" status → Filter: IC 009, 041
  WIPO:  https://branddb.wipo.int/en/quicksearch?strategy=text&field=brandName&input=FireStorm&lang=en&page=1&sorter=score+desc&maxRec=30
  Google: https://www.google.com/search?q="FireStorm"+game+trademark
```

---

After all names, print a **summary table**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Name            Risk     Key Finding
 ─────────────── ──────── ─────────────────────────────────────────────
 FireStorm       🔴 HIGH  Active trademark in IC041 (EA Games) + Pending IC009
 Shadow Realm    🟡 MED   No trademark; active tech company with same name
 PixelKnight     ✅ CLEAR No LIVE marks, no company conflicts found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  DISCLAIMER: This is not legal advice. Risk is assessed on LIVE trademarks only —
dead marks (abandoned/cancelled/expired) are excluded from risk scoring per standard
trademark clearance practice. Databases searched: USPTO, OpenCorporates. International
marks (WIPO, EU, CN) require manual verification via the links in each name's section.
Consult a qualified trademark attorney before commercialising any name.
```

---

## Language Guidelines

- Detect user's language from their input.
- Respond fully in Chinese if the request is in Chinese — use Chinese section headers, Chinese date formats.
- Keep trademark names, IC codes, serial numbers, and owner names in their original language regardless of response language.
- Chinese date format: `YYYY年MM月DD日`; English: `YYYY-MM-DD`

---

## Error Handling

| Error | Action |
|---|---|
| Marker API 401 / wrong credentials | Inform user, fall back to WebFetch web mode |
| Marker API rate limit | Add 1s delay between names, inform user of limitation |
| OpenCorporates 429 / rate limit | Skip business name check for remaining names, note in report |
| WebFetch fails on USPTO | Note unavailable, provide manual link, continue with available data |
| No names parseable from input | Ask: "Which names would you like me to check, and for what type of product?" |
| Marker API `"count": 0` | No US trademark matches — still run OpenCorporates and provide WIPO link |

---

## Additional Reference

See `references/apis.md` for:
- Full Marker API endpoint reference and response schemas
- OpenCorporates API reference
- Complete IC class list for gaming
- Full risk score matrix and setup instructions
