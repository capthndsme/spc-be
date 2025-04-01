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
      table.string('active_order_id').nullable()

    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}