resource "google_cloud_run_v2_service" "backend" {
  name     = "reportloop-backend"
  location = var.region
  template {
    # Pinned to a single instance — required for the Redis sidecar to be the
    # single source of truth for BullMQ queue state. Scaling out would give
    # each instance its own isolated Redis and silently break the queue.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    service_account = google_service_account.backend_runtime.email

    # Ingress container must come first in the list — Cloud Run uses ordering
    # to identify the HTTP-receiving container in multi-container services.
    containers {
      name  = "backend"
      image = var.backend_image

      ports {
        container_port = 3000
      }

      # ── Plain config (non-sensitive) ──────────────────────────────────────
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "SMS_PROVIDER"
        value = "twilio"
      }
      env {
        name  = "PHONE_MAX_NUMBERS"
        value = "2"
      }
      env {
        name  = "SUPABASE_URL"
        value = "https://fwqdjyjabhojqdiyolul.supabase.co"
      }
      env {
        name  = "REDIS_URL"
        value = "redis://localhost:6379"
      }
      env {
        name  = "APP_BASE_URL"
        value = var.app_base_url
      }
      env {
        name  = "FRONTEND_ORIGIN"
        value = var.frontend_origin
      }
      env {
        name  = "SMS_MAX_LENGTH"
        value = "459"
      }
      env {
        name  = "BROADCAST_CONCURRENCY"
        value = "3"
      }
      env {
        name  = "BROADCAST_RETRY_COUNT"
        value = "3"
      }
      env {
        name  = "BROADCAST_RETRY_DELAY_MS"
        value = "5000"
      }
      env {
        name  = "CONVERSATION_REMINDER_INTERVAL_MINUTES"
        value = "60"
      }
      env {
        name  = "CONVERSATION_REMINDER_COUNT"
        value = "2"
      }
      env {
        name  = "CONVERSATION_STUCK_TIMEOUT_MINUTES"
        value = "30"
      }
      env {
        name  = "CONVERSATION_RETENTION_DAYS"
        value = "0"
      }

      # ── Secrets from Secret Manager ───────────────────────────────────────
      dynamic "env" {
        for_each = local.secret_names
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }

    # ── Redis sidecar ─────────────────────────────────────────────────────────
    # Runs alongside the backend container in the same instance; backend
    # reaches it at redis://localhost:6379. Data is in-memory and lost on
    # any revision deploy or instance restart — acceptable for a test env
    # where queue jobs complete within seconds.
    containers {
      name  = "redis"
      image = "redis:7-alpine"
      resources {
        limits = {
          cpu    = "500m"
          memory = "256Mi"
        }
      }
    }
  }
  deletion_protection = false
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret.secrets,
  ]
}

# Allow public unauthenticated access — the API validates its own JWT tokens
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
