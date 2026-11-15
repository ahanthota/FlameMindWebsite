# FlameMind

Fire safety insights for living beyond Earth. NASA Space Apps "Flame in Freefall" challenge, Team Spherical Flame.

Science data lives in `data/` as static JSON. `pipeline/` writes that JSON locally. `api/` is the FastAPI service. `web/` is the Next.js app. Accounts and a database are not part of this skeleton.

## Run locally

Each block starts at the repository root, so it works from `pipeline/`, `api/`, `web/`, or the root.

### Pipeline

```bash
cd "$(git rev-parse --show-toplevel)/pipeline"
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
cp ../.env.example ../.env   # then set every variable
pytest
python config.py             # prints "Pipeline config ok." or names the missing variables
```

`uv` works too: `uv sync` then `uv run pytest`, from `pipeline/`.

### API

```bash
cd "$(git rev-parse --show-toplevel)/api"
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn main:app --reload --port 8080
```

`GET http://127.0.0.1:8080/health` returns `{"status":"ok"}`.

The API reads `GCP_PROJECT`, `GCP_REGION`, `GEMINI_MODEL`, and `EMBED_MODEL` from the repo-root `.env`, plus:

- `WEB_ORIGIN`: the one browser origin allowed by CORS, for example `http://localhost:3000`. If unset, no browser origin is allowed.
- `FIREBASE_PROJECT_ID`: Firebase project for sign-in and saved chats. Defaults to `GCP_PROJECT`.

At startup it loads `data/chunks.json`, `embeddings.npy`, `investigations.json`, `habitats.json`, `gaps.json`, `insights.json`, `answer_cache.json`, and `derived_cache.json` into memory.

#### POST /chat

Guest. Nothing is saved; the client sends its own history (the last 8 messages are used). Limit: 10 requests a minute per IP.

```bash
curl -s -X POST http://127.0.0.1:8080/chat \
  -H 'Content-Type: application/json' \
  -d '{
        "message": "And what happens at very low airflow?",
        "history": [
          {"role": "user", "content": "How does flame spread over fabric change with airflow in microgravity?"},
          {"role": "assistant", "content": "In concurrent flow the spread rate rises with airflow speed."}
        ]
      }'
```

Signed in. Send a Firebase ID token. Omit `chat_id` to start a chat (it gets an AI-written title and starts from the saved `useCaseProfile`); pass it to continue one. Both messages and the chat's use case are saved under `users/{uid}/chats/{chat_id}`. Limit: 30 requests a minute per user.

```bash
curl -s -X POST http://127.0.0.1:8080/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -d '{"chat_id": "AbC123", "message": "Which fabrics data applies to a Moon base at 34% oxygen?"}'
```

Both return `{"chat_id": "...", "message": {...}}`. `message.answer` holds `summary`, `relevant_data`, `suggestions`, `follow_up_question`, `gaps_noted`, and `confidence`; `message.sources` lists the numbered sources that citations point to.

#### Custom filter

Both endpoints return filter definitions and values only. They take the same optional `Authorization` header and share the `/chat` rate limits.

`POST /filter/parse` turns free text into `mapped` (an existing schema field, converted to its unit), `derived` (no field holds it), or `unclear` (with one question):

```bash
curl -s -X POST http://127.0.0.1:8080/filter/parse \
  -H 'Content-Type: application/json' -d '{"text": "pressure between 50 and 101 kPa"}'
# {"kind":"mapped","field":"pressure_psi","level":"investigation","min":7.2519,"max":14.6488,"unit":"psi","interpretation":"Pressure between 7.2519 and 14.6488 psi"}
```

`POST /filter/derive` reads each investigation's top passages for a parameter (all 24 unless `investigation_ids` is given) and returns one row per value found: `{investigation_id, test_id, value, unit, status, citation}`. `status` is `match`, `no_match`, or `not_reported`. A value is kept only if the number is written in the cited passage; nothing is estimated.

```bash
curl -s -X POST http://127.0.0.1:8080/filter/derive \
  -H 'Content-Type: application/json' \
  -d '{"parameter": "sample thickness", "min": 0.1, "max": 1, "unit": "mm"}'
```

Values are cached by parameter name in memory and in `data/derived_cache.json`, so a repeated parameter makes no model calls, whatever the range or unit.

#### Demo answer cache

```bash
python prewarm.py   # answers docs/demo_questions.txt, writes data/answer_cache.json
```

Re-run it after the data or the prompts in `api/ai/` change.

#### Docker

Build from the repo root so `data/` is copied into the image:

```bash
cd "$(git rev-parse --show-toplevel)"
docker build -f api/Dockerfile -t flamemind-api .
docker run --rm -p 8080:8080 -e PORT=8080 --env-file .env flamemind-api
```

### Web

```bash
cd "$(git rev-parse --show-toplevel)/web"
npm install
npm run dev
```

Open `http://localhost:3000`.

```bash
npm test        # vitest: filter logic in src/lib/filters.ts
npm run lint
npm run build   # type-checks and writes the static export to web/out/
```

The site makes no backend calls yet. `src/lib/data.ts` imports `data/investigations.json`, `habitats.json`, `gaps.json`, and `insights.json` at build time, so rebuild after the pipeline changes them. Types in `src/lib/types.ts` are written by hand to match `pipeline/schema.py`.

The site's front page (`/`) is the landing page at the repository root (`index.html`), served by `web/src/app/route.ts`; `npm run build` copies it to `web/out/index.html`. Its "Launch FlameMind" button opens the app at `/login/`. The app's own home page is `/home/`.

Pages: `/home/`, `/scenario/` (AI chat), `/explore/` (filter and sort investigations or tests), `/investigations/<PSI id>/`, `/login/`, and `/account/`.

The chat page calls the API's `POST /chat`. Set `NEXT_PUBLIC_API_URL` in `web/.env.local` (locally `http://127.0.0.1:8080`) and set the API's `WEB_ORIGIN` to the site's origin (locally `http://localhost:3000`), then run both. Guests keep the conversation in the browser tab and send their last 8 messages as history; nothing is saved. Signed-in chats are saved by the API and listed in the sidebar. Deep links: `/scenario/?chat=<id>` opens a saved chat and `/scenario/?ask=<text>` starts a new chat with that message. Compare, Gaps, and Earth applications are in the navigation as placeholders.


### Accounts (optional)

Sign-in uses Firebase Authentication (Google or email and password). User data lives in Cloud Firestore; science data never does. Guests can use every page, and anything that saves shows "Sign in to save".

```
users/{uid}                                {displayName, email, createdAt, useCaseProfile?}
users/{uid}/chats/{chatId}                 {title, createdAt, updatedAt, useCase}
users/{uid}/chats/{chatId}/messages/{id}   {role, text, structured, createdAt}
users/{uid}/savedFilters/{id}              {name, manualFilters, customFilters, createdAt}
```

`firestore.rules`: a user reads only their own documents. Chats and messages are created only by the API (service account); the owner may rename or delete a chat and delete its messages. The profile and saved filters are writable by their owner.

Setup:

1. Create a Firebase project, enable Authentication (Google and Email/Password) and Firestore.
2. Copy `web/.env.example` to `web/.env.local` and fill in the `NEXT_PUBLIC_FIREBASE_*` values. Without them the site builds and runs guest-only.
3. Deploy the rules: `firebase deploy --only firestore:rules --project <project id>`.
4. Give the API credentials for that project (Application Default Credentials) and set `FIREBASE_PROJECT_ID` if it differs from `GCP_PROJECT`.

The API verifies the Firebase ID token on every request that carries one; a bad token is a 401. Quick check:

```bash
curl -s http://127.0.0.1:8080/me                                               # {"signed_in": false, "uid": null}
curl -s http://127.0.0.1:8080/me -H "Authorization: Bearer $FIREBASE_ID_TOKEN"  # {"signed_in": true, "uid": "..."}
```

Tests that need the Firestore emulator (Firebase CLI and Java):

```bash
cd web && npm run test:rules        # security rules
cd .. && firebase emulators:exec --only firestore --project demo-flamemind \
  "cd api && python -m pytest tests/test_store_emulator.py"   # the API's Firestore store
```

Local sign-in without a real project: run `firebase emulators:start --only auth,firestore --project demo-flamemind`, set `NEXT_PUBLIC_FIREBASE_EMULATORS=1` with any placeholder values for the other four variables in `web/.env.local`, and start the API with `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_PROJECT_ID=demo-flamemind`.
