locals {
  secret_names = [
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "DIRECT_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
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

resource "google_secret_manager_secret_version" "values" {
  for_each               = google_secret_manager_secret.secrets
  secret                 = each.value.id
  secret_data_wo         = var.secret_values[each.key]
  secret_data_wo_version = 1
}