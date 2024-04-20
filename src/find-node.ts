import { spawn } from 'node:child_process'
import * as vscode from 'vscode'
import which from 'which'

export function noop() { }

const cwdToNodeJs = new Map<string, string>();

// based on https://github.com/microsoft/playwright-vscode/blob/main/src/utils.ts#L144
export async function findNode(cwd: string): Promise<string> {
  if (cwdToNodeJs.has(cwd))
    return cwdToNodeJs.get(cwd)!

  // Stage 1: Try to find Node.js via process.env.PATH
  let node = await which('node').catch(() => undefined)
  // Stage 2: When extension host boots, it does not have the right env set, so we might need to wait.
  for (let i = 0; i < 5 && !node; ++i) {
    await new Promise(f => setTimeout(f, 200))
    node = await which('node').catch(() => undefined)
  }
  // Stage 3: If we still haven't found Node.js, try to find it via a subprocess.
  // This evaluates shell rc/profile files and makes nvm work.
  node ??= await findNodeViaShell(cwd)
  if (!node)
    throw new Error(`Unable to find 'node' executable.\nMake sure to have Node.js installed and available in your PATH.\nCurrent PATH: '${process.env.PATH}'.`)
  cwdToNodeJs.set(cwd, node);
  return node
}

async function findNodeViaShell(cwd: string): Promise<string | undefined> {
  if (process.platform === 'win32')
    return undefined
  return new Promise<string | undefined>((resolve) => {
    const startToken = '___START_SHELL__'
    const endToken = '___END_SHELL__'
    const childProcess = spawn(`${vscode.env.shell} -i -c 'echo ${startToken} && which node && echo ${endToken}'`, {
      stdio: 'pipe',
      shell: true,
      cwd,
    })
    let output = ''
    childProcess.stdout.on('data', data => output += data.toString())
    childProcess.on('error', () => resolve(undefined))
    childProcess.on('exit', (exitCode) => {
      if (exitCode !== 0)
        return resolve(undefined)
      const start = output.indexOf(startToken)
      const end = output.indexOf(endToken)
      if (start === -1 || end === -1)
        return resolve(undefined)
      return resolve(output.substring(start + startToken.length, end).trim())
    })
  })
}
