.DEFAULT_GOAL := help

include make/config.mk
include make/version.mk
include make/app.mk
include make/deploy.mk

.PHONY: help
help:
	@echo "OneMail Tauri"
	@echo ""
	@echo "  make dev            Start Tauri development mode"
	@echo "  make build          Build the frontend"
	@echo "  make deploy         Build production desktop bundles"
	@echo "  make deploy-stage   Build testing desktop bundles"
	@echo "  make update-version Update package.json with a Shanghai-time version"
