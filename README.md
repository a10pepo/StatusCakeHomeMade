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
make test
make deploy
make destroy
```

- `make run`: starts the Docker app
- `make build`: rebuilds the Docker app without deleting the database volume
- `make restart`: removes all containers and volumes, including the database, then rebuilds and starts everything from scratch
- `make test`: logs in as the generated admin user and triggers sample data loading
- `make deploy`: provisions the GCP base infrastructure, builds and pushes backend/frontend images, and deploys Cloud Run
- `make destroy`: destroys all GCP resources managed by the Terraform project

Frontend: [http://localhost:5173](http://localhost:5173)  
Backend: [http://localhost:8000](http://localhost:8000)  
Swagger: [http://localhost:8000/docs](http://localhost:8000/docs)

The backend prints the generated admin password at startup. New non-admin users can register from the UI.
