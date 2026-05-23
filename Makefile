DOCKER ?= $(shell command -v docker 2>/dev/null || printf /usr/local/bin/docker)
COMPOSE = $(DOCKER) compose

.PHONY: run build restart test deploy destroy

run:
	$(COMPOSE) up

build:
	$(COMPOSE) up --build -d

restart:
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up --build -d

test:
	./scripts/load_sample_data.sh

deploy:
	sh ./scripts/deploy_gcp.sh

destroy:
	sh ./scripts/destroy_gcp.sh
