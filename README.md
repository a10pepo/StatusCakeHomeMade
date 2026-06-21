# StatusCakeHomeMade

Full-stack monitoring app inspired by StatusCake.

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Database: PostgreSQL

## Run

```bash
docker compose up --build
```

## Make Targets

```bash
make run
make build
make restart
make deploy
make destroy
```

- `make run`: starts the Docker app
- `make build`: rebuilds the Docker app without deleting the database volume
- `make restart`: removes all containers and volumes, including the database, then rebuilds and starts everything from scratch
- `make deploy`: provisions the GCP base infrastructure, builds and pushes backend/frontend images, and deploys Cloud Run
- `make destroy`: destroys all GCP resources managed by the Terraform project

`make deploy` now checks both `gcloud` CLI auth and Terraform ADC auth up front. If either is expired, it will launch the corresponding interactive `gcloud auth login` or `gcloud auth application-default login` flow before continuing.

Frontend: [http://localhost:5173](http://localhost:5173)  
Backend: [http://localhost:8000](http://localhost:8000)  
Swagger: [http://localhost:8000/docs](http://localhost:8000/docs)

The backend creates the `admin` and `readonly` users automatically. If no password is provided through environment variables, it generates one on first startup and prints it in the backend logs. New non-admin users can register from the UI as owner accounts.
