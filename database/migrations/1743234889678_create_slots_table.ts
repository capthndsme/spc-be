import type Slot from '#models/slot'
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'slots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.boolean('is_filled').notNullable().defaultTo(false)
      table.integer('money_amount').notNullable().defaultTo(0)
      table.integer('last_triggered').nullable()
      table.integer('active_order_id').nullable()
      table.integer('num')

    })

    /**
     * Create four basic slots 
     * Numbers: 1,2,3,4
     * isFilled all false
     * 0 money amount
     */
    this.defer(async (db) => {
      console.log("inserting...")
      await db.table<Slot>('slots')
      .multiInsert([
        {
          num: 1,
          is_filled: false,
          money_amount: 0,
        },
        {
          num: 2,
          is_filled: false,
          money_amount: 0,
        },
        {
          num: 3,
          is_filled: false,
          money_amount: 0,
        },
        {
          num: 4,
          is_filled: false,
          money_amount: 0,
        },
        
      ])
    })
    
  }
  async down() {
    this.schema.dropTable(this.tableName)
  }
}