.PHONY: help up down logs ps reset seed migrate dev build test clean

help:
	@echo "OpenApplicantTracking — common commands"
	@echo "  make up       — start local infra (postgres x6, redis, redpanda, minio, mailhog)"
	@echo "  make down     — stop local infra"
	@echo "  make logs     — tail infra logs"
	@echo "  make reset    — destroy volumes & restart from scratch"
	@echo "  make migrate  — run prisma migrations on global + all regional DBs"
	@echo "  make seed     — seed skills catalog + demo Hays accounts (US/EU/SG)"
	@echo "  make dev      — run api + web + workers"
	@echo "  make test     — run unit + integration tests"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

reset:
	docker compose down -v
	docker compose up -d

migrate:
	pnpm db:migrate

seed:
	pnpm db:seed

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

clean:
	pnpm clean
