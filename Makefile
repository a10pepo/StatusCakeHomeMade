DOCKER ?= $(shell command -v docker 2>/dev/null || printf /usr/local/bin/docker)
COMPOSE = $(DOCKER) compose

.PHONY: run build restart deploy destroy

run:
	$(COMPOSE) up

build:
	$(COMPOSE) up --build -d

restart:
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up --build -d

deploy:
	./scripts/deploy_gcp.sh

destroy:
	./scripts/destroy_gcp.sh
