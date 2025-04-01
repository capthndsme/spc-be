import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.string('name').nullable()
      table.string('username').nullable().unique()
      table.boolean('enabled').defaultTo(true).nullable()
      table.boolean('super_admin').defaultTo(false).nullable()
      table.string('password').nullable()
      
    })

    // init defolt. Username parcel. Password $2a$10$LZb84itmN4wC2OGqcGbq6.EsLEruWfzdA6BoZIF2h9ESFKcEVCj5m
    this.schema.raw(`INSERT INTO users (name, username, password, super_admin) VALUES ('Parcel Admin', 'parcel', '$2a$10$LZb84itmN4wC2OGqcGbq6.EsLEruWfzdA6BoZIF2h9ESFKcEVCj5m', true)`)
 

    

  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}