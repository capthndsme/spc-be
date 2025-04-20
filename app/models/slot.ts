import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import Order from './order.js'
import { type HasMany } from '@adonisjs/lucid/types/relations'

export default class Slot extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  

  /**
   * Slot details
   */

  @column() 
  declare isFilled: boolean;

  @column()
  declare moneyAmount: number;

  @column()
  declare lastTriggered: number | null;

  @column()
  declare num: number 


  /**
   * Active order id validation
   */
  @column()
  declare activeOrderId: number | null


  @hasMany(() => Order, {
    foreignKey: 'slotId',
    localKey: 'id',
  })
  /**
   * Collection of orders this slot had, before and after
   */
  declare orders: HasMany<typeof Order>


 
}