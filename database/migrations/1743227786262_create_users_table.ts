import { Bcrypt } from '@adonisjs/core/hash/drivers/bcrypt'
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

    const crypt = new Bcrypt({})
    const defaultBCrypted = await crypt.make("Parcel123")
 

     
    this.defer(async (db) => {
      console.log("inserting...")
      const d = await db.table('users').insert({
        name: 'Parcel',
        username: 'parcel',
        password: defaultBCrypted,
        super_admin: true,
        enabled: true,
      })
     
      console.log("created?",d)
    })
    
    

  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}