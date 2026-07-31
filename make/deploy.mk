.PHONY: deploy deploy-stage
deploy: update-version
	@VITE_APP_ENV=prod $(PNPM) tauri:build

deploy-stage: update-version
	@VITE_APP_ENV=stage $(PNPM) tauri:build
