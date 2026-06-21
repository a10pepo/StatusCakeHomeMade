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

ensure_gcloud_auth() {
  echo "Verifying gcloud CLI credentials..."
  if gcloud auth print-access-token >/dev/null 2>&1; then
    return
  fi

  echo "gcloud CLI credentials are missing or expired. Starting interactive login..."
  gcloud auth login

  if ! gcloud auth print-access-token >/dev/null 2>&1; then
    echo "gcloud login did not produce a usable access token." >&2
    exit 1
  fi
}

ensure_terraform_auth() {
  if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    if [ ! -r "${GOOGLE_APPLICATION_CREDENTIALS}" ]; then
      echo "GOOGLE_APPLICATION_CREDENTIALS points to a file that cannot be read: ${GOOGLE_APPLICATION_CREDENTIALS}" >&2
      exit 1
    fi
    echo "Terraform credentials source: GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}"
    return
  fi

  echo "Verifying Terraform Application Default Credentials..."
  if gcloud auth application-default print-access-token >/dev/null 2>&1; then
    return
  fi

  echo "Terraform ADC credentials are missing or expired. Starting interactive ADC login..."
  gcloud auth application-default login

  if ! ADC_ERROR="$(gcloud auth application-default print-access-token 2>&1 1>/dev/null)"; then
    echo "Terraform ADC login is still not usable after reauthentication." >&2
    if [ -n "${ADC_ERROR}" ]; then
      echo "${ADC_ERROR}" >&2
    fi
    exit 1
  fi
}

PROJECT_ID="${PROJECT_ID:-edem2526}"

ensure_gcloud_auth
gcloud config set project "${PROJECT_ID}"
ensure_terraform_auth
echo "Initializing Terraform..."
cd "${TERRAFORM_DIR}"
terraform init

echo "Creating base GCP infrastructure..."
terraform apply -auto-approve -var="deploy_services=false"

BACKEND_REPO="$(terraform output -raw backend_artifact_registry_repository)"
FRONTEND_REPO="$(terraform output -raw frontend_artifact_registry_repository)"
REGION="${BACKEND_REPO%%-docker.pkg.dev*}"
PROJECT_ID="$(printf '%s' "${BACKEND_REPO}" | cut -d/ -f2)"
BACKEND_REPO_ID="$(printf '%s' "${BACKEND_REPO}" | cut -d/ -f3)"
FRONTEND_REPO_ID="$(printf '%s' "${FRONTEND_REPO}" | cut -d/ -f3)"

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
CURRENT_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"

echo "Terraform target project: ${PROJECT_ID}"
if [ -n "${ACTIVE_ACCOUNT}" ]; then
  echo "Active gcloud account: ${ACTIVE_ACCOUNT}"
fi
if [ -n "${CURRENT_PROJECT}" ] && [ "${CURRENT_PROJECT}" != "${PROJECT_ID}" ]; then
  echo "gcloud is configured for project ${CURRENT_PROJECT}, but Terraform is deploying to ${PROJECT_ID}." >&2
  echo "Switch with: gcloud config set project ${PROJECT_ID}" >&2
  exit 1
fi

check_artifact_repo_access() {
  REPO_ID="$1"

  if ! gcloud artifacts repositories describe "${REPO_ID}" \
    --location="${REGION}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Unable to access Artifact Registry repository ${PROJECT_ID}/${REPO_ID} in ${REGION}." >&2
    echo "The active gcloud identity needs at least roles/artifactregistry.writer on the project or repository." >&2
    exit 1
  fi
}

echo "Verifying Artifact Registry access..."
check_artifact_repo_access "${BACKEND_REPO_ID}"
check_artifact_repo_access "${FRONTEND_REPO_ID}"

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

BACKEND_SERVICE_NAME="$(terraform output -raw backend_service_name)"

echo "Applying backend service-level scaling..."
gcloud run services update "${BACKEND_SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --min-instances="${BACKEND_MIN_INSTANCES:-1}" \
  --max-instances="${BACKEND_MAX_INSTANCES:-3}" \
  --quiet

echo
echo "Deployment completed."
echo "UI URL:"
terraform output -raw ui_url || true
