import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'dropper_slots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.integer('slot_id').notNullable().unique()
      table.boolean('is_occupied').notNullable().defaultTo(false)
      table.integer('order_id').nullable().references('id').inTable('orders').onDelete('SET NULL')
      table.integer('length').notNullable()
      table.integer('width').notNullable()
      table.integer('height').notNullable()
      
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}