import {exec as callbackExec} from 'node:child_process'
import {promisify} from 'node:util'
import {
  ensureFileOrThrow,
  EXIF_DATE_TIME_FORMAT,
  EXIF_DATE_TIME_FORMAT_WITH_TZ,
  EXIF_DATE_TIME_REGEX,
  EXIF_DATE_TIME_SUBSEC_FORMAT,
  EXIF_DATE_TIME_SUBSEC_FORMAT_WITH_TZ,
  EXIF_DATE_TIME_SUBSEC_REGEX,
  EXIF_DATE_TIME_SUBSEC_WITH_TZ_REGEX,
  EXIF_DATE_TIME_WITH_TZ_REGEX,
  EXIF_DATE_TIME_WITH_UTC_REGEX,
} from './utils.js'
import {EXIF_TAGS, ExiftoolMetadata} from './types/ExiftoolMetadata.js'
import {DateTime} from 'luxon'

const exec = promisify(callbackExec)

export type ExiftoolServiceConfig = {
  debug: boolean
}

export class ExiftoolService {
  constructor(private config: ExiftoolServiceConfig) {}

  /**
   * Returns the exif metadata stored on the file provided
   */
  async extractExifMetadata(path: string): Promise<ExiftoolMetadata> {
    const rawResult = await this.exiftool({
      args: ['-G0:1', '-json'],
      path,
      options: {
        override: false,
        ignoreMinorErrors: false,
      },
    })
    return JSON.parse(rawResult)[0]
  }

  /**
   * Returns the time of capture from the exif metadata provided
   */
  extractDateTimeFromExif({
    metadata,
    timeZone,
    fileTimeFallback,
  }: {
    metadata: ExiftoolMetadata
    timeZone?: string
    fileTimeFallback: boolean
  }): string | null {
    const tags = [
      EXIF_TAGS.SUB_SEC_DATE_TIME_ORIGINAL,
      // Creation date is the ideal tag for videos as it contains the timezone offset.
      EXIF_TAGS.QUICKTIME_CREATION_DATE,
      EXIF_TAGS.DATE_TIME_ORIGINAL,
      EXIF_TAGS.GPS_DATE_TIME,
    ]
    for (const tag of tags) {
      const value = metadata[tag]
      if (value) {
        const parsed = this.parseDateTime({
          date: value,
          fallbackTimeZone: timeZone,
        })
        if (parsed && parsed.isValid) {
          return parsed.toISO()
        }
      }
    }

    // CreateDate is not as good because it is stored in UTC (per specification).
    // Some companies still store local date time despite the spec e.g. GoPro
    const createDate = metadata[EXIF_TAGS.QUICKTIME_CREATE_DATE]
    if (createDate) {
      if (metadata[EXIF_TAGS.GOPRO_MODEL]) {
        const date = this.parseDateTime({
          date: createDate,
          fallbackTimeZone: timeZone,
        })
        if (date && date.isValid) {
          return date.toISO()
        }
      } else {
        // Assuming UTC
        const date = this.parseDateTime({
          date: createDate,
          fallbackTimeZone: 'utc',
        })
        if (date && date.isValid) {
          return timeZone
            ? date.setZone(timeZone).toISO()
            : date.toLocal().toISO()
        }
      }
    }

    if (fileTimeFallback) {
      const fileModifyDate = metadata[EXIF_TAGS.FILE_MODIFICATION_DATE]
      if (fileModifyDate) {
        const date = this.parseDateTime({
          date: fileModifyDate,
        })

        if (date && date.isValid) {
          return date.toISO()
        }
      }
    }

    return null
  }

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

  private parseDateTime({
    date,
    fallbackTimeZone,
  }: {
    date: string
    fallbackTimeZone?: string
  }): DateTime | null {
    if (EXIF_DATE_TIME_SUBSEC_WITH_TZ_REGEX.test(date)) {
      return DateTime.fromFormat(date, EXIF_DATE_TIME_SUBSEC_FORMAT_WITH_TZ, {
        setZone: true,
      })
    }
    if (EXIF_DATE_TIME_SUBSEC_REGEX.test(date)) {
      return DateTime.fromFormat(date, EXIF_DATE_TIME_SUBSEC_FORMAT, {
        zone: fallbackTimeZone,
      })
    }
    if (EXIF_DATE_TIME_WITH_TZ_REGEX.test(date)) {
      return DateTime.fromFormat(date, EXIF_DATE_TIME_FORMAT_WITH_TZ, {
        setZone: true,
      })
    }
    if (EXIF_DATE_TIME_WITH_UTC_REGEX.test(date)) {
      // Remove Z at the end of the string
      return DateTime.fromFormat(date.slice(0, -1), EXIF_DATE_TIME_FORMAT, {
        zone: 'utc',
      })
    }
    if (EXIF_DATE_TIME_REGEX.test(date)) {
      return DateTime.fromFormat(date, EXIF_DATE_TIME_FORMAT, {
        zone: fallbackTimeZone,
      })
    }
    return null
  }
}
