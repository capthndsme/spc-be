import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videorecords'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.string('video').notNullable()
      table.string('thumbnail').nullable()
      table.integer('order_id').nullable()
      
      table.timestamp('date_start').nullable()
      table.timestamp('date_end').nullable()
      table.enum('camera', ['outside', 'inside']).nullable()
      
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}