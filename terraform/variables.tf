variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
  default     = "edem2526"
}

variable "region" {
  description = "Google Cloud region."
  type        = string
  default     = "europe-west1"
}

variable "name_prefix" {
  description = "Prefix used for all GCP resources."
  type        = string
  default     = "statuscake"
}

variable "deploy_services" {
  description = "When true, create the Cloud Run services. Keep false for the first apply to create Artifact Registry and Cloud SQL before pushing images."
  type        = bool
  default     = true
}

variable "backend_image_tag" {
  description = "Docker tag to deploy from the backend Artifact Registry repository."
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Docker tag to deploy from the frontend Artifact Registry repository."
  type        = string
  default     = "latest"
}

variable "frontend_origin" {
  description = "Allowed frontend origin for backend CORS. Use * or the deployed frontend URL."
  type        = string
  default     = "*"
}

variable "db_name" {
  description = "PostgreSQL database name."
  type        = string
  default     = "statuscake"
}

variable "db_username" {
  description = "PostgreSQL application username."
  type        = string
  default     = "statuscake"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. Defaults to the minimum shared-core option."
  type        = string
  default     = "db-f1-micro"
}

variable "db_disk_size_gb" {
  description = "Cloud SQL disk size in GB."
  type        = number
  default     = 20
}

variable "db_availability_type" {
  description = "Cloud SQL availability type, either ZONAL or REGIONAL."
  type        = string
  default     = "ZONAL"
}

variable "backend_cpu" {
  description = "Backend Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "backend_memory" {
  description = "Backend Cloud Run memory limit."
  type        = string
  default     = "2Gi"
}

variable "frontend_cpu" {
  description = "Frontend Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "frontend_memory" {
  description = "Frontend Cloud Run memory limit."
  type        = string
  default     = "1Gi"
}

variable "tags" {
  description = "Labels applied to all supported GCP resources."
  type        = map(string)
  default     = {}
}
