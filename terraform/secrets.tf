# Secret shells — Terraform creates the resource, values are added manually.
# This keeps secret values out of Terraform state.
# Rule: only credentials and secrets here — public URLs and config go as plain env vars.

locals {
  secret_names = [
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "DIRECT_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "REDIS_URL",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secret_names)
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}
