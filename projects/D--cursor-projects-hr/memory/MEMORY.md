# HR Project Memory

## User Preferences
- After each Q&A exchange, summarize the most recent changes made.
- Responses should be concise and direct.
- No emojis.

## Project Structure
- Backend: D:/cursor-projects/hr/hr-server (Laravel PHP)
- Frontend: D:/cursor-projects/hr/hr-frontend (Vue.js 2)
- Platform: Windows, shell: bash

## Key Notes
- `resume_experience.name` is encrypted in DB; use frontend's `candidateInfo.resume.get_resume_experience` (already decrypted)
- EncryptService requires `resume_id` in request body with `res_type: 'resume'`
- Do NOT run php-cs-fixer automatically after backend changes
- Background check skip reasons: `offline`, `no_need`, `not_resigned`
- Scene types: `create_offer` (3 skip options), `al_entry` (2 skip options)
