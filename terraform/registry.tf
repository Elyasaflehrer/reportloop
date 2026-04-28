resource "google_artifact_registry_repository" "backend" {
  repository_id = "reportloop"
  format        = "DOCKER"
  location      = var.region
  description   = "ReportLoop backend Docker images"

  depends_on = [google_project_service.apis]
}
