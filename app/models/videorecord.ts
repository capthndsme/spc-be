import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Videorecord extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column()
  declare thumbnail: string

  @column()
  declare video: string

  @column.dateTime()
  declare dateStart: DateTime

  @column.dateTime()
  declare dateEnd: DateTime

  
  /**
   * order id relating
   */
  @column()
  declare orderId: number

  /**
   * where?
   */

  @column()
  declare camera?: "outside" | "inside"


}