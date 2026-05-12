VERSION := $(shell node -e "\
  const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));\
  const y=String(d.getFullYear()).slice(-2);\
  const m=d.getMonth()+1;\
  const day=d.getDate();\
  const h=String(d.getHours()).padStart(2,'0');\
  const mn=String(d.getMinutes()).padStart(2,'0');\
  process.stdout.write(y+'.'+m+day+'.'+h+mn);\
")
# 默认提交消息
DEFAULT_MSG := "bump version to v$(VERSION)"



# 检查 npm 是否安装
NPM := $(shell command -v npm 2> /dev/null)
ifeq ($(strip $(NPM)),)
$(error npm is not installed. Please install Node.js and npm)
endif


# 更新版本号，增加错误处理
update-version:
	@if [ -f "package.json" ]; then \
		echo "Updating package.json version to $(VERSION)"; \
		node -e "const fs = require('fs'); \
			const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
			pkg.version = '$(VERSION)'; \
			fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));" || \
		(echo "Failed to update package.json"; exit 1); \
	else \
		echo "package.json not found"; \
		exit 1; \
	fi

# 提交版本变更到Git
push-version: update-version
	@echo "Committing version change"
	@git diff --quiet package.json || \
		(git add . && \
		git commit -m "bump version to v$(VERSION)" && \
		git push) || \
		(echo "Git commit failed"; exit 1)

# 创建并推送标签
push-tag: push-version
	@echo "Creating and pushing tag v$(VERSION)"
	@git tag v$(VERSION) && \
		git push origin v$(VERSION) || \
		(echo "Failed to create and push tag"; exit 1)

# 开发环境
dev:
	@$(NPM) run dev

