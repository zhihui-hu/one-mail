VERSION := $(shell node -e "\
  const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));\
  const y=String(d.getFullYear()).slice(-2);\
  const m=d.getMonth()+1;\
  const day=d.getDate();\
  const h=String(d.getHours()).padStart(2,'0');\
  const mn=String(d.getMinutes()).padStart(2,'0');\
  process.stdout.write(y+'.'+m+day+'.'+h+mn);\
")

.PHONY: update-version
update-version:
	@command -v node >/dev/null 2>&1 || { echo "node is not installed"; exit 1; }
	@test -f package.json || { echo "package.json not found"; exit 1; }
	@node -e "const fs=require('fs');const path='package.json';const pkg=JSON.parse(fs.readFileSync(path,'utf8'));pkg.version='$(VERSION)';fs.writeFileSync(path,JSON.stringify(pkg,null,2)+'\n')"
	@echo "Updated package.json to $(VERSION)"
