output "cloud_run_url" {
  description = "Backend API URL — use as APP_BASE_URL and VITE_API_BASE_URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "artifact_registry" {
  description = "Docker image path prefix for CI/CD"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/reportloop/backend"
}

output "ci_service_account" {
  description = "CI/CD service account email — download a key and add as GCP_SA_KEY GitHub secret"
  value       = google_service_account.ci.email
}
