import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.timestamp('created_at')

      table.timestamp('updated_at')

      table.string('title').notNullable()
      table.string('message').notNullable()
      table.boolean('read').notNullable().defaultTo(false)
      table.integer('has_order_id').nullable()

      table.string('has_attachment').nullable()
      table.string('attachment_blur_hash').nullable()
      table.enum('attachment_type', ['PHOTO', 'VIDEO']).nullable()

      table.enum('where', ['outside', 'indside']).nullable()
      
      
      
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}