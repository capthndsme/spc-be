import { DateTime } from 'luxon'
import { BaseModel, column, hasOne } from '@adonisjs/lucid/orm'
import Slot from './slot.js'
import { type HasOne } from '@adonisjs/lucid/types/relations'

export default class Order extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

 

  @column()
  /**
   * This is the E-Commerce's ORDER ID
   * This will be used to search for users orders.
   */
  declare orderId: string;


  @column()
  declare otpRider: string | null;

  @column()
  declare riderName: string;

  @column()
  declare riderNumber?: string;

  @column()
  declare courier?: string;

  @column.dateTime()
  declare orderPlaced: DateTime;

  @column()
  declare itemDescription: string;
  

  @column.dateTime()
  declare orderReceived: DateTime;

  @column.dateTime()
  declare orderGetOut: DateTime;

  @column()
  declare slotId: number;

  @hasOne(() => Slot, {
    foreignKey: 'id',
    localKey: 'slotId',
  })
  declare slot: HasOne<typeof Slot>;

  @column()
  declare state: "PENDING" | "OTP_WAITING" | "DROP_PENDING" | "DELETED" | "DELIVERED" |  "FINISHED";

  @column()
  declare beforeWeight?: number;

  @column()
  declare afterWeight?: number;

  @column()
  declare moneyContent?: number

  @column()
  declare type: "COD" | "PAID"


}

