import { flags } from '@oclif/command'
import {
  CSVContext,
  SheetContext,
} from '../helpers/interfaces/report-interface'
import { SQLContext } from '../helpers/interfaces/query-interface'
import { cli } from 'cli-ux'
import {
  QueryArgsReports,
  SheetColumns,
} from '../helpers/interfaces/report-interface'
import { parse } from 'json2csv'
import Command from '../helpers/shared/base'
import * as fs from 'fs-extra'
import * as PublicGoogleSheetsParser from 'public-google-sheets-parser'
import SQLReports from '../helpers/shared/SQLReports'
import { Statement } from 'snowflake-sdk'

export default class Reports extends Command {
  static description = 'Generate automated reports via the Google Sheets API.'

  static flags = {
    help: flags.help({ char: 'h', description: `Help documentation` }),

    sheetName: flags.string({
      char: 's',
      description: 'Specified sheet name to process reports on',
      required: true,
    }),

    quiet: flags.boolean({
      char: 'q',
      description: 'Specified sheet name to process reports on',
      default: false,
    }),
  }

  static args = [
    {
      name: 'type',
      required: true,
      default: 'cpc',
      options: ['cpc'],
    },
  ]

  async run() {
    const { args, flags } = this.parse(Reports)
    const { sheetName: appId, quiet } = flags
    const { type } = args
    const intializationMessage = 'Generating report!'
    const quietNotif = 'quiet flag passed, will not print table to stdout'

    this.task.initiateTask(intializationMessage)
    quiet && this.chalk.primarylog(quietNotif)
    const configExists = fs.pathExistsSync(this.configPath)

    if (configExists) {
      this.chalk.primarylog('Config file exists... Continuing!')
      const sheetContext = this.readSheetConfig(appId)
      const contents: any[] = await this.getPublicSpreadsheet(sheetContext)

      contents.map(async (column: SheetColumns) => {
        const { UTM_CAMPAIGN: utmCampaign, RETAIL_ID: retailId } = column
        const reportsContext: QueryArgsReports = {
          retailId,
          utmCampaign,
          appId,
          type,
          quiet,
        }

        await this.generateReport(reportsContext)
      })
    } else {
      this.chalk.secondary('Error: Please check if your config file exists')
      this.exit
    }
  }

  private async generateReport(context: QueryArgsReports) {
    const sqlContext: SQLContext = new SQLReports(context).getStatement()
    const { appId, retailId, type, utmCampaign, quiet } = context
    const { sqlText, columns } = sqlContext
    const that = this
    const connection = await this.snowflakeConnection

    connection.execute({
      sqlText,
      fetchAsString: ['Date'],
      complete(err: Error, stmt: Statement, rows: any[]) {
        const result = that.task.tryTask(err, rows)
        !quiet && cli.table(result, columns)
        const csvContext: CSVContext = {
          appId,
          type,
          retailId,
          rows,
          utmCampaign,
        }
        that.writeCSV(csvContext)
        //Todo: implement finish task
      },
    })
  }

  protected writeCSV(context: CSVContext): void {
    const { appId, retailId, type, rows, utmCampaign } = context
    const attemptMessage = 'Attempting to parse sheet contents to csv'
    this.chalk.secondarylog(attemptMessage)
    const fields = Object.getOwnPropertyNames(rows[0])
    const opts = { fields }
    const csv = parse(rows, opts)
    const title = `${appId} ${type} report - utm_campaign:${utmCampaign} retail_id:${retailId}.csv`
    fs.writeFileSync(title, csv)
    const successMessage = `Successfully generated ${type} report : ${title}`
    this.chalk.secondarylog(successMessage)
  }

  protected readSheetConfig(sheetName: string): SheetContext {
    const configSync: string = fs.readFileSync(this.configPath, 'utf8')
    const config: ConfigJSON = JSON.parse(configSync)
    const spreadsheetId: string = config.GOOGLE_SPREADSHEET_ID
    const sheetContext: SheetContext = { spreadsheetId, sheetName }
    const attemptMessage = `Generating report for Sheet name: ${sheetName} from Sheet ID: ${spreadsheetId}`
    this.chalk.primarylog(attemptMessage)
    return sheetContext
  }

  protected async getPublicSpreadsheet(context: SheetContext): Promise<any[]> {
    const { sheetName, spreadsheetId } = context
    const parser = new PublicGoogleSheetsParser(spreadsheetId, sheetName)
    const attemptMessage = `Parsing contents of Sheet name: ${sheetName} to JSON`
    try {
      const spreadsheetContents = await parser.parse()
      this.chalk.primarylog(attemptMessage)
      return spreadsheetContents
    } catch (err) {
      this.chalk.secondary('Invalid sheet')
    }
  }
}
