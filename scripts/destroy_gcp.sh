#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TERRAFORM_DIR="${ROOT_DIR}/terraform"

if ! command -v terraform >/dev/null 2>&1; then
  echo "Missing required command: terraform" >&2
  exit 1
fi

gcloud config set project edem2526

echo "Initializing Terraform..."
cd "${TERRAFORM_DIR}"
terraform init

echo "Destroying all GCP resources managed by Terraform..."
terraform destroy -auto-approve
