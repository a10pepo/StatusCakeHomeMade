# Terraform Deployment

This folder deploys the application to Google Cloud with:

- `Cloud Run` for the backend container
- `Cloud Run` for the frontend container
- `Cloud SQL for PostgreSQL` for the database
- `Artifact Registry` for the backend and frontend images

## Architecture

- The backend and frontend run as separate public Cloud Run services.
- Each Cloud Run service is capped at `1` instance.
- The frontend receives the backend Cloud Run URL through the `VITE_API_URL` runtime environment variable.
- The backend connects to Cloud SQL through the Cloud SQL Unix socket mounted at `/cloudsql`.
- The backend service account gets the `Cloud SQL Client` role.

## Assumptions

- The backend image is built from [backend/Dockerfile](/Users/pedro.nieto/Documents/StatusCakeHomeMade/backend/Dockerfile:1).
- The frontend image is built from [frontend/Dockerfile.cloudrun](/Users/pedro.nieto/Documents/StatusCakeHomeMade/frontend/Dockerfile.cloudrun:1).
- The backend receives a fixed admin password from Terraform so Cloud Run revisions do not rotate credentials.
- Cloud SQL is provisioned with a public IP, but application traffic uses the Cloud SQL connection integration from Cloud Run rather than direct TCP.

## Flow

1. Create the base infrastructure and Artifact Registry repositories.

```bash
cd terraform
terraform init
terraform apply -var="deploy_services=false"
```

`deploy_services` defaults to `false`, so a plain first `terraform apply` creates the base infrastructure without trying to deploy Cloud Run before the container images exist.

2. Configure Docker to push to Artifact Registry.

```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev
```

3. Build and push the backend image.

```bash
docker buildx build --platform linux/amd64 --push -f backend/Dockerfile -t europe-west1-docker.pkg.dev/<project-id>/<backend-repo>/backend:latest ..
```

4. Build and push the frontend image.

```bash
docker buildx build --platform linux/amd64 --push -f frontend/Dockerfile.cloudrun -t europe-west1-docker.pkg.dev/<project-id>/<frontend-repo>/frontend:latest ../frontend
```

When building from an Apple Silicon machine, use `linux/amd64` for Cloud Run images. Otherwise the pushed image can be `arm64` and fail at runtime with a generic container startup error.

5. Deploy the Cloud Run services.

```bash
terraform apply -var="deploy_services=true"
```

## Important Variables

- `project_id`: Google Cloud project ID
- `region`: Google Cloud region, default `europe-west1`
- `name_prefix`: prefix for all resources
- `deploy_services`: create Artifact Registry and Cloud SQL first, then enable Cloud Run after images are pushed
- `frontend_origin`: backend CORS origin
- `db_tier`: Cloud SQL machine tier
- `backend_image_tag`: backend image tag
- `frontend_image_tag`: frontend image tag

## Outputs

- `backend_artifact_registry_repository`
- `frontend_artifact_registry_repository`
- `cloudsql_connection_name`
- `database_url`
- `admin_username`
- `admin_password`
- `backend_service_url`
- `frontend_service_url`
- `ui_url`
