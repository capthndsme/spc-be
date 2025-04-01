import { DateTime } from 'luxon'
import { BaseModel, column, hasOne } from '@adonisjs/lucid/orm'
import Order from './order.js'
import { type HasOne } from '@adonisjs/lucid/types/relations'

export default class Notification extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column()
  declare title: string;

  @column()
  declare message: string;

  @column()
  declare read: boolean;

  @column()
  declare hasOrderId?: number;
  
  @column()
  /**
   * where in the filesystem is this attachment.
   */
  declare hasAttachment?: string;

  @column()
  declare attachmentBlurHash?: string;

  @column()
  declare attachmentType?: "PHOTO" | "VIDEO"

  @column()
  declare where?: "outside" | "indside"
  

  @hasOne(() => Order, {
    foreignKey: 'id',
    localKey: 'hasOrderId',
  }) 
  declare order: HasOne<typeof Order>
}