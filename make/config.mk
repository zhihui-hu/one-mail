PNPM := pnpm

ifeq ($(strip $(shell command -v $(PNPM) 2>/dev/null)),)
$(error pnpm is not installed)
endif
