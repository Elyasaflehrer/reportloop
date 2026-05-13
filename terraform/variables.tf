variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "backend_image" {
  description = "Full Docker image path including tag — set by CI after first build"
  type        = string
}

variable "app_base_url" {
  description = "Cloud Run URL — known after first deploy"
  type        = string
  default     = ""
}

variable "frontend_origin" {
  description = "Firebase Hosting URL — known after Firebase is configured"
  type        = string
  default     = ""
}

variable "deployer_email" {
  description = "Google account email of the person running Terraform — granted Firebase Admin"
  type        = string
}

variable "phone_max_number" {
  description = "Maxnumber of phone numbers that can be purchased from the provider"
}

variable "secret_values" {
  description = "Values for the secrets in local.secret_names — kept out of state via write-only attrs"
  type        = map(string)
  sensitive   = true
  default     = {}
}