# GitLab API Reference

## Base URL

```
https://pt-gitlab.yottastudios.com
```

## Authentication

All API requests require a private token header:

```
PRIVATE-TOKEN: $GITLAB_TOKEN
```

---

## Primary Method: git clone / pull

Prefer cloning the repository over using the API for file access. The API is a fallback for targeted lookups.

### Clone with token auth

```bash
git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git /home/username/Sentry/projects/{repo_name}
```

### Clone infra repo on a specific branch

```bash
git clone -b aio-service https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git /home/username/Sentry/projects/{repo_name}
```

### Update an existing local repo

```bash
cd /home/username/Sentry/projects/{repo_name} && git pull
```

After cloning, use standard filesystem tools (Read, Glob, Grep) to explore the code — no further API calls needed.

---

## Monorepo Note

Multiple Sentry projects may share a single GitLab repository. For example:

- `apitable-backend-server`
- `apitable-web-server`
- `apitable-room-server`

All map to the same repo: `px/apitable/apitable`

Clone the repo once, then navigate to the relevant subdirectory for each Sentry project. Check `project-mapping.json` for the `gitlabPath` and any `subdirectory` fields.

---

## API Endpoints (Fallback / Reference)

Use these when you need a targeted file lookup without cloning the full repo.

### Search for a project

```
GET /api/v4/projects?search={name}&simple=true
```

```bash
curl -s \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects?search=apitable&simple=true"
```

Returns an array of project objects. Each has `id`, `name`, `path_with_namespace`, `default_branch`.

### Read a single file

```
GET /api/v4/projects/{id}/repository/files/{file_path}?ref={branch}
```

The `file_path` must be URL-encoded (e.g. `src%2Fmain%2FApp.java`).

```bash
curl -s \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{id}/repository/files/src%2Fmain%2FApp.java?ref=main"
```

Response includes `content` as a **base64-encoded** string. Decode with:

```bash
echo "{base64_content}" | base64 -d
```

### List directory contents

```
GET /api/v4/projects/{id}/repository/tree?path={dir}&ref={branch}
```

```bash
curl -s \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{id}/repository/tree?path=src/main&ref=main"
```

Returns an array of objects with `id`, `name`, `type` (`blob` for files, `tree` for directories), `path`, `mode`.
