import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.string('order_id').notNullable()
      table.string('rider_name').notNullable()
      table.string('rider_number').nullable()
      table.string('courier').nullable()
      table.timestamp('order_placed').notNullable()
      table.string('item_description').notNullable()
      table.timestamp('order_received').nullable()
      table.timestamp('order_get_out').nullable()
      table.integer('slot_id').notNullable()
      table.enum('state', ['PENDING', 'OTP_WAITING', 'DELETED', 'DELIVERED', 'FINISHED']).notNullable()
      table.integer('before_weight').nullable()
      table.integer('after_weight').nullable()
      table.integer('money_content').notNullable()
      
      
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}