output "backend_artifact_registry_repository" {
  description = "Backend Artifact Registry repository path."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}

output "frontend_artifact_registry_repository" {
  description = "Frontend Artifact Registry repository path."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.frontend.repository_id}"
}

output "cloudsql_connection_name" {
  description = "Cloud SQL connection name."
  value       = google_sql_database_instance.postgres.connection_name
}

output "cloudsql_public_ip" {
  description = "Cloud SQL public IP."
  value       = google_sql_database_instance.postgres.public_ip_address
}

output "database_url" {
  description = "Backend DATABASE_URL value using the Cloud SQL Unix socket."
  value       = local.database_url
  sensitive   = true
}

output "admin_username" {
  description = "Initial admin username."
  value       = "admin"
}

output "admin_password" {
  description = "Initial admin password provisioned into the backend service."
  value       = random_password.admin.result
  sensitive   = true
}

output "backend_service_url" {
  description = "Backend Cloud Run URL when services are deployed."
  value       = var.deploy_services ? google_cloud_run_v2_service.backend[0].uri : null
}

output "backend_service_name" {
  description = "Backend Cloud Run service name when services are deployed."
  value       = var.deploy_services ? google_cloud_run_v2_service.backend[0].name : null
}

output "frontend_service_url" {
  description = "Frontend Cloud Run URL when services are deployed."
  value       = var.deploy_services ? google_cloud_run_v2_service.frontend[0].uri : null
}

output "ui_url" {
  description = "Public URL to access the frontend UI."
  value       = var.deploy_services ? google_cloud_run_v2_service.frontend[0].uri : null
}
