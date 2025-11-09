import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class DropperSlot extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column()
  declare slotId: number

  @column()
  declare isOccupied: boolean

  @column()
  declare orderId: number

  /** Centimetres */
  @column()
  declare length: number

  @column() 
  declare width: number

  @column()
  declare height: number


}