# Grant the deployer account Firebase Admin so it can initialize Firebase
# and manage Hosting sites (required before firebase CLI commands work)
resource "google_project_iam_member" "deployer_firebase_admin" {
  project = var.project_id
  role    = "roles/firebase.admin"
  member  = "user:${var.deployer_email}"
}

resource "google_service_account" "ci" {
  account_id   = "reportloop-ci"
  display_name = "ReportLoop CI/CD"
}

locals {
  ci_roles = [
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/secretmanager.secretAccessor",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_project_iam_member" "ci_roles" {
  for_each = toset(local.ci_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.ci.email}"
}

resource "google_service_account" "backend_runtime" {
  account_id   = "reportloop-backend-runtime"
  display_name = "ReportLoop backend Cloud Run runtime"
}

resource "google_project_iam_member" "backend_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.backend_runtime.email}"
}