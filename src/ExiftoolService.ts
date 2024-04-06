import {exec as callbackExec} from 'node:child_process'
import {promisify} from 'node:util'
import {ensureFileOrThrow} from './utils'

const exec = promisify(callbackExec)

export type ExiftoolServiceConfig = {
  debug: boolean
}

export class ExiftoolService {
  constructor(private config: ExiftoolServiceConfig) {}

  async exiftool({
    args,
    path,
    options,
  }: {
    args: string[]
    path: string
    options: {
      override: boolean
      ignoreMinorErrors: boolean
    }
  }): Promise<string> {
    await ensureFileOrThrow(path)

    return await this.rawExiftool(
      [
        ...(options.override ? ['-overwrite_original'] : []),
        ...(options.ignoreMinorErrors ? ['-m'] : []),
        ...args,
        `"${path}"`,
      ].join(' ')
    )
  }

  private async rawExiftool(command: string): Promise<string> {
    const fullCommand = `exiftool ${command}`

    if (this.config.debug) {
      console.log(fullCommand)
    }

    const {stdout} = await exec(fullCommand)
    return stdout
  }
}
