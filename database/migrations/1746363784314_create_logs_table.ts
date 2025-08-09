import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.enum('log_type', [
        "ATTEMPT_LOGIN",
        "ATTEMPT_OTP",
        "ATTEMPT_ORDER_ID",
        "ATTEMPT_ENTER_NUMBER",
        "ATTEMPT_ENTER_OTP",
        "ATTEMPT_CANCEL_ORDER",
        "ATETMPT_UNLOCK_COMPARTMENT",
        "ATTEMPT_DROP_MONEY",
        "ATTEMPT_FINISH_ORDER"
      ]).notNullable()
      table.string('data_msg').notNullable()
      table.string('photo_image').nullable()
      
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}