# Trademark Check — API & Data Source Reference

## Sources Used

### 1. Marker API (Primary — USPTO US Trademarks)

**Website:** https://markerapi.com
**Coverage:** USPTO US trademark database (synced every ≤3 days)
**Auth:** Username + password (free account required)
**Base URL:** `https://markerapi.com/api/v2`

#### Key Endpoints

| Purpose | Endpoint |
|---|---|
| Search by name | `GET /trademarks/trademark/{name}/status/{status}/page/{page}` |
| Exact-match only | `GET /trademarks/trademark/{name}/status/all/page/1` |
| Active only | `GET /trademarks/trademark/{name}/status/active/page/1` |
| Serial number lookup | `GET /trademarks/serialnumber/{serial}/page/1` |

**Parameters:**
- `username` and `password` — query params or HTTP Basic auth
- `{status}` — `active` or `all` (all = active + pending + expired)
- `{page}` — pagination, 100 results per page; if `next` key in response, more pages exist

**Wildcard search:** Use `*` as wildcard, e.g., `fire*` matches "firebase", "firefox", etc.

**Example cURL:**
```bash
curl "https://markerapi.com/api/v2/trademarks/trademark/{NAME}/status/all/page/1?username=${MARKERAPI_USERNAME}&password=${MARKERAPI_PASSWORD}"
```

**Response fields (per trademark record):**
```json
{
  "trademark": "FIRESTORM",
  "serialnumber": "97123456",
  "status": "Active",
  "ic": "009",               // International Class codes, comma-separated
  "description": "Video game software",
  "owner": "Acme Corp",
  "filingdate": "2022-05-10",
  "registrationdate": "2023-01-15",
  "expirationdate": "2033-01-15"
}
```

**Free tier limits:** Varies; register at https://markerapi.com to get credentials.

---

### 2. OpenCorporates API (Business Name Conflicts)

**Website:** https://opencorporates.com
**Coverage:** 200+ million companies across 140+ jurisdictions worldwide
**Auth:** Optional `api_token` for higher rate limits; basic unauthenticated requests allowed
**Base URL:** `https://api.opencorporates.com/v0.4`

#### Key Endpoint

```
GET https://api.opencorporates.com/v0.4/companies/search?q={NAME}&per_page=20
```

**Optional parameters:**
- `api_token` — your token (env var `OPENCORPORATES_API_TOKEN`)
- `jurisdiction_code` — e.g., `us`, `gb`, `us_de` (US Delaware)
- `inactive` — `false` to filter active companies only
- `per_page` — max 100

**Example cURL:**
```bash
# Without token (limited rate)
curl "https://api.opencorporates.com/v0.4/companies/search?q={NAME}&per_page=20&inactive=false"

# With token
curl "https://api.opencorporates.com/v0.4/companies/search?q={NAME}&per_page=20&inactive=false&api_token=${OPENCORPORATES_API_TOKEN}"
```

**Response:** JSON with `results.companies[]`, each containing:
- `name`, `jurisdiction_code`, `company_number`, `current_status`, `incorporation_date`

---

### 3. USPTO TMSEARCH (Web Fallback)

**URL:** https://tmsearch.uspto.gov/search/search-information
**Coverage:** Full USPTO trademark database (official)
**Auth:** None (public web interface)
**Method:** WebFetch with search query parameters

Use as fallback if Marker API is not configured, or to verify/cross-check specific results. The skill uses WebFetch to fetch the search results page.

**Manual search URL pattern (for user reference):**
```
https://tmsearch.uspto.gov/search/search-information?query={NAME}&searchType=tm_name
```

---

### 4. WIPO Global Brand Database (Web Reference)

**URL:** https://branddb.wipo.int/en/
**Coverage:** International trademarks (Madrid System), EU marks, some national databases
**Auth:** None (public web)
**Note:** WIPO explicitly prohibits automated querying — use only for manual verification.

**Manual search URL (for user reference links only):**
```
https://branddb.wipo.int/en/quicksearch?strategy=text&field=brandName&input={NAME}&office=&lang=en&type=&status=&nature=&page=1&sorter=score+desc&maxRec=30
```

Always provide this URL as a manual check link in the output, but do NOT programmatically fetch it.

---

## IC Classes Relevant to Gaming

| IC Class | Description | Risk Relevance |
|---|---|---|
| **009** | Computer games, video game software, downloadable games, computer applications | 🔴 HIGH — covers most game software |
| **028** | Games, toys, board games, playing cards, physical game components | 🔴 HIGH — covers physical game products |
| **041** | Entertainment services, amusement arcade services, organizing gaming events | 🔴 HIGH — covers game studios and esports |
| **042** | Software as a service, cloud gaming platforms, software development | 🟡 MEDIUM — covers SaaS/platform versions |
| **035** | Advertising, retail store services for games | 🟡 MEDIUM — covers game storefronts |
| **038** | Telecommunications, streaming, online multiplayer services | 🟡 MEDIUM — covers game streaming |

Trademarks in classes **009, 028, 041** are the highest conflict risk for a video game.

---

## LIVE vs DEAD Trademark Status

Standard trademark clearance practice is to assess risk based on **LIVE marks only**. This mirrors the manual USPTO TMSEARCH workflow where "Dead" marks are explicitly unchecked in the status filter.

| Status | Category | Risk relevance |
|---|---|---|
| Active / Registered | LIVE | ✅ Counts toward risk scoring |
| Pending / Published for opposition | LIVE | ✅ Counts toward risk scoring (could become active) |
| Abandoned | DEAD | ℹ️ Informational only — no legal protection |
| Cancelled | DEAD | ℹ️ Informational only — no legal protection |
| Expired | DEAD | ℹ️ Informational only — no legal protection |

In the Marker API, `status/active` returns only LIVE marks. `status/all` returns both LIVE and DEAD — filter client-side by status field.

---

## Risk Score Matrix

| Finding | Risk Level |
|---|---|
| LIVE trademark, exact name match, IC 009/028/041 (primary gaming classes) | 🔴 HIGH |
| LIVE trademark, very similar / wildcard match, IC 009/028/041 | 🔴 HIGH |
| LIVE trademark, exact name match, IC 042/035/038 (secondary classes) | 🟡 MEDIUM |
| LIVE trademark, exact name match, unrelated IC class | 🟡 MEDIUM |
| Pending trademark in IC 009/028/041 (not yet registered, but filed) | 🟡 MEDIUM |
| Active gaming/tech company with exact same name | 🟡 MEDIUM |
| AI pre-analysis flagged a famous mark phonetic near-match | 🟡 MEDIUM |
| Only DEAD marks found in primary classes | 🟢 LOW |
| Minor business name match in unrelated field | 🟢 LOW |
| No LIVE trademark matches, no company conflicts | ✅ CLEAR |

---

## Setup Instructions for API Keys

### Marker API (Recommended — Free)
1. Register at https://markerapi.com (free account)
2. Note your username and password
3. Set environment variables:
   ```bash
   # macOS/Linux
   export MARKERAPI_USERNAME="your_username"
   export MARKERAPI_PASSWORD="your_password"

   # Windows (PowerShell)
   $env:MARKERAPI_USERNAME = "your_username"
   $env:MARKERAPI_PASSWORD = "your_password"
   ```

### OpenCorporates Token (Optional)
1. Register at https://opencorporates.com
2. Sign up for a self-service API plan (free tier available)
3. Set:
   ```bash
   export OPENCORPORATES_API_TOKEN="your_token"
   ```
