VERSION := $(shell node -e "\
  const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));\
  const y=String(d.getFullYear()).slice(-2);\
  const m=d.getMonth()+1;\
  const date=Number(String(m)+String(d.getDate()).padStart(2,'0'));\
  const time=d.getHours()*100+d.getMinutes();\
  process.stdout.write(y+'.'+date+'.'+time);\
")

.PHONY: update-version
update-version:
	@command -v node >/dev/null 2>&1 || { echo "node is not installed"; exit 1; }
	@test -f package.json || { echo "package.json not found"; exit 1; }
	@test -f src-tauri/tauri.conf.json || { echo "src-tauri/tauri.conf.json not found"; exit 1; }
	@node -e "const fs=require('fs');for(const path of ['package.json','src-tauri/tauri.conf.json']){const json=JSON.parse(fs.readFileSync(path,'utf8'));json.version='$(VERSION)';fs.writeFileSync(path,JSON.stringify(json,null,2)+'\n')}"
	@echo "Updated package.json and src-tauri/tauri.conf.json to $(VERSION)"

# 创建并推送标签
push-tag: update-version
	@echo "Creating and pushing tag v$(VERSION)"
	@git tag v$(VERSION) && \
		git push origin v$(VERSION) || \
		(echo "Failed to create and push tag"; exit 1)
