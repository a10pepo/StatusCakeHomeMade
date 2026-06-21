locals {
  labels = merge(
    {
      project     = var.name_prefix
      managed_by  = "terraform"
      environment = "sandbox"
    },
    var.tags,
  )

  artifact_registry_host = "${var.region}-docker.pkg.dev"
  backend_image          = "${local.artifact_registry_host}/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}/backend:${var.backend_image_tag}"
  frontend_image         = "${local.artifact_registry_host}/${var.project_id}/${google_artifact_registry_repository.frontend.repository_id}/frontend:${var.frontend_image_tag}"
  cloudsql_connection    = google_sql_database_instance.postgres.connection_name
  database_url           = "postgresql://${google_sql_user.app_user.name}:${urlencode(random_password.database.result)}@/${google_sql_database.app.name}?host=/cloudsql/${local.cloudsql_connection}"
}

resource "google_project_service" "services" {
  for_each = var.manage_project_services ? toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "iam.googleapis.com",
  ]) : toset([])

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

resource "random_password" "database" {
  length           = 32
  special          = true
  override_special = "_%@"
}

resource "random_password" "app_secret" {
  length           = 48
  special          = true
  override_special = "_%@"
}

resource "random_password" "admin" {
  length           = 24
  special          = true
  override_special = "_%@"
}

resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "${var.name_prefix}-backend"
  description   = "Backend Docker images"
  format        = "DOCKER"

  labels = local.labels

  depends_on = [google_project_service.services]
}

resource "google_artifact_registry_repository" "frontend" {
  location      = var.region
  repository_id = "${var.name_prefix}-frontend"
  description   = "Frontend Docker images"
  format        = "DOCKER"

  labels = local.labels

  depends_on = [google_project_service.services]
}

resource "google_service_account" "backend" {
  account_id   = "${var.name_prefix}-backend"
  display_name = "StatusCake backend runtime"

  depends_on = [google_project_service.services]
}

resource "google_service_account" "frontend" {
  account_id   = "${var.name_prefix}-frontend"
  display_name = "StatusCake frontend runtime"

  depends_on = [google_project_service.services]
}

resource "google_project_iam_member" "backend_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_sql_database_instance" "postgres" {
  name                = "${var.name_prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = false

  settings {
    tier              = var.db_tier
    disk_size         = var.db_disk_size_gb
    disk_type         = "PD_SSD"
    availability_type = var.db_availability_type

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ALLOW_UNENCRYPTED_AND_ENCRYPTED"
    }

    backup_configuration {
      enabled = true
    }

    user_labels = local.labels
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app_user" {
  name     = var.db_username
  instance = google_sql_database_instance.postgres.name
  password = random_password.database.result
}

resource "google_cloud_run_v2_service" "backend" {
  count    = var.deploy_services ? 1 : 0
  name     = "${var.name_prefix}-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend.email

    scaling {
      min_instance_count = var.backend_min_instances
      max_instance_count = var.backend_max_instances
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }

    containers {
      image = local.backend_image

      ports {
        container_port = 8000
      }

      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }

      env {
        name  = "SECRET_KEY"
        value = random_password.app_secret.result
      }

      env {
        name  = "FRONTEND_ORIGIN"
        value = var.frontend_origin
      }

      env {
        name  = "ADMIN_USERNAME"
        value = "admin"
      }

      env {
        name  = "ADMIN_PASSWORD"
        value = random_password.admin.result
      }

      env {
        name  = "ADMIN_PASSWORD_ENV_PATH"
        value = "/tmp/generated_admin_password.txt"
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      resources {
        limits = {
          cpu    = var.backend_cpu
          memory = var.backend_memory
        }
      }
    }

    max_instance_request_concurrency = 10
  }

  labels = local.labels

  depends_on = [
    google_project_service.services,
    google_project_iam_member.backend_cloudsql_client,
    google_sql_database.app,
    google_sql_user.app_user,
  ]
}

resource "google_cloud_run_v2_service" "frontend" {
  count    = var.deploy_services ? 1 : 0
  name     = "${var.name_prefix}-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.frontend.email

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = local.frontend_image

      ports {
        container_port = 8080
      }

      env {
        name  = "VITE_API_URL"
        value = google_cloud_run_v2_service.backend[0].uri
      }

      resources {
        limits = {
          cpu    = var.frontend_cpu
          memory = var.frontend_memory
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_project_service.services,
    google_cloud_run_v2_service.backend,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  count    = var.deploy_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  count    = var.deploy_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
