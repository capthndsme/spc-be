import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Log extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column()
  declare logType: LogType

  @column()
  declare dataMsg: string

  @column()
  declare photoImage: string | null



}


export type LogType = 
  | "ATTEMPT_LOGIN"
  | "ATTEMPT_OTP"
  | "ATTEMPT_ORDER_ID"
  | "ATTEMPT_ENTER_NUMBER"
  | "ATTEMPT_ENTER_OTP"
  | "ATTEMPT_CANCEL_ORDER"
  | "ATETMPT_UNLOCK_COMPARTMENT"
  | "ATTEMPT_DROP_MONEY"
  | "ATTEMPT_FINISH_ORDER"
  | "DELETE_ORDER"