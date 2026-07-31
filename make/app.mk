.PHONY: dev build
dev:
	@$(PNPM) tauri:dev

build:
	@$(PNPM) build
