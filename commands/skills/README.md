# PX AI Skills

A shared library of [Claude Code](https://claude.ai/claude-code) custom skills for the PX team.

## What are skills?

Skills are prompt files that teach Claude Code how to perform specific, repeatable workflows — like fetching a Sentry report or summarising a deployment. Once installed, a skill is invoked as a slash command (e.g. `/sentry-summary`).

---

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [sentry-summary](./sentry-summary/SKILL.md) | `/sentry-summary` | Fetch and display an error/issue summary from our self-hosted Sentry at `sentry.yottastudios.com` |
| [trademark-check](./trademark-check/SKILL.md) | `/trademark-check` | Check if a name conflicts with existing trademarks or business names — risk analysis for game names using USPTO, OpenCorporates, and WIPO |
| [sentry-investigate](./sentry-investigate/SKILL.md) | `/sentry-investigate` | Investigate a Sentry issue — pull code, query logs, trace across services, and generate a root cause analysis report |
| [k8s-deploy](./k8s-deploy/SKILL.md) | `/k8s-deploy` | Deploy a new project to K8s — auto-generate Dockerfile, CI, kubernetes manifests, and gateway configs for both test and prod environments |

---

## Installation

### 1. Clone this repo

```bash
git clone <this-repo-url> ~/px-ai-skills
```

### 2. Install skills into Claude Code

Claude Code loads user-level skills from `~/.claude/commands/`. Create a symlink for each skill you want to use.

**macOS / Linux:**

```bash
mkdir -p ~/.claude/commands

# sentry-summary
ln -s ~/px-ai-skills/sentry-summary/SKILL.md ~/.claude/commands/sentry-summary.md

# trademark-check
ln -s ~/px-ai-skills/trademark-check/SKILL.md ~/.claude/commands/trademark-check.md

# sentry-investigate
ln -s ~/px-ai-skills/sentry-investigate/SKILL.md ~/.claude/commands/sentry-investigate.md

# k8s-deploy
ln -s ~/px-ai-skills/k8s-deploy/SKILL.md ~/.claude/commands/k8s-deploy.md
```

**Windows (run in PowerShell as Administrator or with Developer Mode enabled):**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\commands"

# sentry-summary
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.claude\commands\sentry-summary.md" `
  -Target "$env:USERPROFILE\px-ai-skills\sentry-summary\SKILL.md"

# trademark-check
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.claude\commands\trademark-check.md" `
  -Target "$env:USERPROFILE\px-ai-skills\trademark-check\SKILL.md"

# sentry-investigate
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.claude\commands\sentry-investigate.md" `
  -Target "$env:USERPROFILE\px-ai-skills\sentry-investigate\SKILL.md"
```

> Tip: Use symlinks so that a `git pull` in this repo automatically updates all your skills without re-running any install steps.

### 3. Verify

Open a new Claude Code session and type `/` — you should see `sentry-summary` in the autocomplete list.

---

## Staying up to date

```bash
cd ~/px-ai-skills
git pull
```

That's it — symlinks mean there's nothing else to do.

---

## Contributing a new skill

1. Create a folder for your skill: `my-skill/`
2. Add a `SKILL.md` file with the following frontmatter:

   ```markdown
   ---
   name: my-skill
   description: >
     One or two sentences describing when Claude should activate this skill.
     Include common phrasings a user might type.
   version: 0.1.0
   ---

   # My Skill

   Describe what Claude should do here...
   ```

3. Optionally add a `references/` subfolder for supporting docs the skill can reference.
4. Update the **Available Skills** table in this README.
5. Open a MR and ask for a review.

### Tips for writing good skills

- The `description` frontmatter is what Claude uses to decide when to auto-trigger the skill — make it specific and include common user phrasings.
- Keep workflow steps numbered and explicit. Claude follows them literally.
- Add a `references/` doc for any API or domain knowledge the skill needs — this keeps `SKILL.md` focused on *workflow* rather than *reference*.
- Handle errors explicitly (auth failures, missing env vars, bad inputs).

---

## Skill structure

```
skills/
├── README.md
└── <skill-name>/
    ├── SKILL.md          # Main skill definition (required)
    └── references/       # Supporting reference docs (optional)
        └── api.md
```
