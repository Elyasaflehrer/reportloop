<style>
  body, p, li, td, th, code, pre { font-size: 18px; }
</style>

# GCP Deployment — ReportLoop

## Architecture

```mermaid
%%{init: {'theme': 'default', 'themeVariables': {'fontSize': '20px'}}}%%
flowchart LR
    subgraph Clients
        Browser["Browser\nAdmin · Manager · Participant"]
        Twilio["Twilio SMS"]
    end

    subgraph GCP["Google Cloud Platform"]
        Firebase["Firebase Hosting\n— React SPA —"]
        subgraph CR["Cloud Run  (min-instances=1)"]
            HTTP["Fastify API :3000"]
            Workers["Workers\nbroadcast · conversation · reminder"]
        end
        SM["Secret Manager"]
        AR["Artifact Registry"]
    end

    subgraph External
        DB["Supabase\nPostgreSQL + Auth"]
        Queue["Upstash Redis\nBullMQ"]
        AI["Anthropic Claude"]
    end

    Browser  --> Firebase --> HTTP
    Twilio   --> HTTP
    HTTP     --> Queue --> Workers
    HTTP     --> DB
    Workers  --> DB
    Workers  --> Twilio
    Workers  --> AI
    SM -.-> CR
    AR -.-> CR
```

## Services

| Service | What it does |
|---|---|
| Cloud Run (min-instances=1) | HTTP API + BullMQ workers in one container — always on |
| Upstash Redis | Job queue for BullMQ — no VPC Connector needed (~$2–15/month) |
| Supabase | PostgreSQL + Auth — stays as-is |
| Firebase Hosting | Static React SPA — global CDN, free tier |
| Secret Manager | Credentials injected into Cloud Run at startup |
| Artifact Registry | Private Docker image registry |

---

## Prerequisites

```bash
# Install tools
# gcloud CLI: https://cloud.google.com/sdk/docs/install
# Terraform:  https://developer.hashicorp.com/terraform/install
npm install -g firebase-tools

# Verify
gcloud version && terraform version && firebase --version
```

---

## Step 1 — Bootstrap

One-time manual setup. Terraform can't run until these exist.

```bash
# Set these — used in every command below
export PROJECT_ID=<your-gcp-project-id>
export REGION=us-central1
export DEPLOYER_EMAIL=$(gcloud config get-value account)

# Authenticate
gcloud auth login
gcloud auth application-default login   # separate from gcloud login — required by Terraform

# Create GCP project and set as default
gcloud projects create $PROJECT_ID --name="ReportLoop"
gcloud config set project $PROJECT_ID

# Link billing (required for Cloud Run — must be done in the console)
# https://console.cloud.google.com/billing

# Create GCS bucket for Terraform state (must exist before terraform init)
gsutil mb -p $PROJECT_ID -l $REGION gs://${PROJECT_ID}-tf-state
```

> `gcloud auth login` authenticates the CLI. `gcloud auth application-default login` is a separate credential used by Terraform — both are required.

---

## Step 2 — Fill Secrets

Cloud Run reads secrets at startup — missing or wrong values crash the container before it can listen on port 3000.

```bash
create_secret() {
  echo -n "$2" | gcloud secrets create "$1" --data-file=- --project=$PROJECT_ID
}

# Database (get from Supabase → Project Settings → Database → Connection string)
create_secret DATABASE_URL        "postgresql://..."
create_secret DATABASE_URL_DIRECT "postgresql://..."
create_secret DIRECT_URL          "postgresql://..."

# Supabase (get from Supabase → Project Settings → API)
create_secret SUPABASE_SERVICE_ROLE_KEY "eyJ..."
create_secret SUPABASE_JWT_SECRET       "..."

# Redis — create a database at upstash.com first, then paste the URL here
create_secret REDIS_URL "rediss://default:PASSWORD@HOST.upstash.io:6379"

# Twilio (get from Twilio Console → Account Info)
create_secret TWILIO_ACCOUNT_SID "ACxxxxx"
create_secret TWILIO_AUTH_TOKEN  "..."

# Anthropic (get from console.anthropic.com → API Keys)
create_secret ANTHROPIC_API_KEY "sk-ant-..."
```

> To update a secret value later:
> ```bash
> echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
> ```

> Plain env vars (SUPABASE_URL, TWILIO_FROM_NUMBER, APP_BASE_URL, FRONTEND_ORIGIN, operational config) are set directly in `cloudrun.tf` — they do NOT go in Secret Manager.

---

## Step 3 — Bootstrap Infrastructure

Terraform can't create Cloud Run without a Docker image. So first apply creates everything except Cloud Run.

```bash
cd terraform
terraform init

terraform apply \
  -target=google_project_service.apis \
  -target=google_artifact_registry_repository.backend \
  -target=google_secret_manager_secret.secrets \
  -target=google_project_iam_member.deployer_firebase_admin \
  -var="project_id=$PROJECT_ID" \
  -var="deployer_email=$DEPLOYER_EMAIL"
```

This enables all required APIs, creates the Docker registry, creates Secret Manager shells, and grants your account Firebase Admin.

---

## Step 4 — Build & Push First Docker Image

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/reportloop/reportloop-backend

gcloud auth configure-docker $REGION-docker.pkg.dev

docker build -t $IMAGE:latest ./backend
docker push $IMAGE:latest
```

---

## Step 5 — Full Terraform Apply

The Cloud Run URL isn't known until after the first deploy — use a placeholder, then re-apply with the real URL.

**First apply:**
```bash
terraform apply \
  -var="project_id=$PROJECT_ID" \
  -var="deployer_email=$DEPLOYER_EMAIL" \
  -var="backend_image=$IMAGE:latest" \
  -var="app_base_url=https://placeholder.example.com" \
  -var="frontend_origin=https://placeholder.example.com"
```

**Get the real Cloud Run URL:**
```bash
export CLOUD_RUN_URL=$(terraform output -raw cloud_run_url)
echo $CLOUD_RUN_URL
```

**Re-apply with the real URL:**
```bash
terraform apply \
  -var="project_id=$PROJECT_ID" \
  -var="deployer_email=$DEPLOYER_EMAIL" \
  -var="backend_image=$IMAGE:latest" \
  -var="app_base_url=$CLOUD_RUN_URL" \
  -var="frontend_origin=https://placeholder.example.com"
```

**Verify:**
```bash
curl $CLOUD_RUN_URL/health
# Expected: { "status": "ok", "db": "ok", "redis": "ok" }
```

---

## Step 6 — Firebase Hosting

### Initialize

```bash
firebase login   # sign in with the same Google account as your GCP project

firebase projects:addfirebase $PROJECT_ID   # links Firebase to the GCP project

firebase hosting:sites:create $PROJECT_ID   # creates the Hosting site
```

> These three commands must run in order. Firebase and GCP are separate systems — having a GCP project does not create a Firebase project.

### Set frontend env vars

Vite bakes env vars into the JS bundle at **build time** — set them before running `npm run build`.

Edit **`frontend/.env.production`**:
```
VITE_API_BASE_URL=<Cloud Run URL from Step 5>
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon key>
```

> These values are safe to commit — they end up in the public JS bundle regardless. The Supabase anon key is designed to be public; security is enforced by Row Level Security policies in the database.

### Build and deploy

```bash
cd frontend
npm run build
firebase deploy --only hosting
```

Firebase prints the Hosting URL after deploy (e.g. `https://$PROJECT_ID.web.app`).

### Update FRONTEND_ORIGIN

The backend uses `FRONTEND_ORIGIN` to allow CORS from the frontend. Re-apply with the real Firebase URL:

```bash
cd terraform
terraform apply \
  -var="project_id=$PROJECT_ID" \
  -var="deployer_email=$DEPLOYER_EMAIL" \
  -var="backend_image=$IMAGE:latest" \
  -var="app_base_url=$CLOUD_RUN_URL" \
  -var="frontend_origin=https://$PROJECT_ID.web.app"
```

---

## Step 7 — Twilio Webhook

In the Twilio Console → Phone Numbers → your number → Messaging → Webhook URL:

```
$CLOUD_RUN_URL/webhooks/twilio
```

---

## Step 8 — CI/CD (GitHub Actions)

### Service account key

```bash
gcloud iam service-accounts keys create sa-key.json \
  --iam-account="reportloop-ci@$PROJECT_ID.iam.gserviceaccount.com"

cat sa-key.json   # copy the full JSON
rm sa-key.json    # delete immediately — never commit this file
```

### GitHub secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | your GCP project ID |
| `GCP_SA_KEY` | full JSON from `sa-key.json` above |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase SA JSON — Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `FIREBASE_PROJECT_ID` | your Firebase project ID (same as GCP project ID) |
| `VITE_API_BASE_URL` | Cloud Run URL |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

### Workflow file

Create **`.github/workflows/deploy.yml`**:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'
            frontend:
              - 'frontend/**'

  deploy-backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    env:
      REGION: us-central1
      IMAGE: us-central1-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/reportloop/reportloop-backend

    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      - name: Build and push image
        run: |
          docker build -t ${{ env.IMAGE }}:${{ github.sha }} -t ${{ env.IMAGE }}:latest ./backend
          docker push ${{ env.IMAGE }}:${{ github.sha }}
          docker push ${{ env.IMAGE }}:latest

      - name: Run database migrations
        run: |
          cd backend && npm ci
          DIRECT=$(gcloud secrets versions access latest --secret=DATABASE_URL_DIRECT)
          DATABASE_URL=$DIRECT DIRECT_URL=$DIRECT npx prisma migrate deploy

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy reportloop-backend \
            --image=${{ env.IMAGE }}:${{ github.sha }} \
            --region=${{ env.REGION }} \
            --platform=managed \
            --min-instances=1 \
            --max-instances=10 \
            --port=3000 \
            --allow-unauthenticated \
            --set-secrets=DATABASE_URL=DATABASE_URL:latest,DATABASE_URL_DIRECT=DATABASE_URL_DIRECT:latest,DIRECT_URL=DIRECT_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,SUPABASE_JWT_SECRET=SUPABASE_JWT_SECRET:latest,REDIS_URL=REDIS_URL:latest,TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest

  deploy-frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install and build
        run: cd frontend && npm ci && npm run build
        env:
          VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: ${{ secrets.FIREBASE_PROJECT_ID }}
          entryPoint: ./frontend
```

---

## Verification

```bash
# Backend health
curl $CLOUD_RUN_URL/health
# Expected: { "status": "ok", "db": "ok", "redis": "ok" }

# Frontend
# Open https://$PROJECT_ID.web.app → login screen loads
# Sign in → dashboard renders
# Create a schedule → fire it → participant receives SMS
```
