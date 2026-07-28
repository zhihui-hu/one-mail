/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const { execFile } = require('node:child_process')
const { readFile } = require('node:fs/promises')
const { createRequire } = require('node:module')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const requireFromElectronBuilder = createRequire(require.resolve('electron-builder/package.json'))
const { getRceditBundle } = requireFromElectronBuilder('app-builder-lib/out/toolsets/windows')

exports.default = async function editWinExecutable(context) {
  if (context.electronPlatformName !== 'win32') return

  const projectDir = context.packager.projectDir
  const packageMetadata = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  const productName = context.packager.appInfo.productName
  const executableBaseName =
    context.packager.platformSpecificBuildOptions.executableName || productName
  const executableName = `${executableBaseName}.exe`
  const executablePath = join(context.appOutDir, executableName)
  const iconPath = join(projectDir, 'build', 'icon.ico')
  const rcedit = await getRceditBundle('1.0.0')
  const version = packageMetadata.version
  const author = getAuthorName(packageMetadata.author, productName)

  await execFileAsync(
    rcedit.x64,
    [
      executablePath,
      '--set-version-string',
      'FileDescription',
      productName,
      '--set-version-string',
      'ProductName',
      productName,
      '--set-version-string',
      'LegalCopyright',
      `Copyright (c) ${new Date().getFullYear()} ${author}`,
      '--set-version-string',
      'InternalName',
      productName,
      '--set-version-string',
      'OriginalFilename',
      executableName,
      '--set-file-version',
      version,
      '--set-product-version',
      toWindowsVersion(version),
      '--set-icon',
      iconPath
    ],
    { windowsHide: true }
  )
}

function toWindowsVersion(version) {
  const parts = version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter(Number.isInteger)
    .slice(0, 4)

  while (parts.length < 4) parts.push(0)
  return parts.join('.')
}

function getAuthorName(author, fallback) {
  if (typeof author === 'string' && author.trim()) return author.trim()
  if (author && typeof author.name === 'string' && author.name.trim()) return author.name.trim()
  return fallback
}
