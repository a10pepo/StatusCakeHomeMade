#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TERRAFORM_DIR="${ROOT_DIR}/terraform"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_bin terraform
require_bin docker
require_bin gcloud

echo "Initializing Terraform..."
cd "${TERRAFORM_DIR}"
terraform init

echo "Creating base GCP infrastructure..."
terraform apply -auto-approve -var="deploy_services=false"

BACKEND_REPO="$(terraform output -raw backend_artifact_registry_repository)"
FRONTEND_REPO="$(terraform output -raw frontend_artifact_registry_repository)"
REGION="${BACKEND_REPO%%-docker.pkg.dev*}"

echo "Configuring Docker auth for Artifact Registry in ${REGION}..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "Building backend image..."
cd "${ROOT_DIR}"
docker buildx build \
  --platform "${TARGET_PLATFORM}" \
  --push \
  -f backend/Dockerfile \
  -t "${BACKEND_REPO}/backend:latest" \
  .

echo "Building frontend image..."
docker buildx build \
  --platform "${TARGET_PLATFORM}" \
  --push \
  -f frontend/Dockerfile.cloudrun \
  -t "${FRONTEND_REPO}/frontend:latest" \
  ./frontend

echo "Deploying Cloud Run services..."
cd "${TERRAFORM_DIR}"
terraform apply -auto-approve -var="deploy_services=true"

echo
echo "Deployment completed."
echo "UI URL:"
terraform output -raw ui_url || true
