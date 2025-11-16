import { BaseSchema } from '@adonisjs/lucid/schema'

//Added "DELETE_ORDER" to the LogType definition in /home/captainhandsome/spc-be/app/models/log.ts
export default class extends BaseSchema {
  protected tableName = 'logs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.enum('log_type', ['ATTEMPT_LOGIN', 'ATTEMPT_OTP', 'ATTEMPT_ORDER_ID', 'ATTEMPT_ENTER_NUMBER', 'ATTEMPT_ENTER_OTP', 'ATTEMPT_CANCEL_ORDER', 'ATETMPT_UNLOCK_COMPARTMENT', 'ATTEMPT_DROP_MONEY', 'ATTEMPT_FINISH_ORDER', 'DELETE_ORDER']).notNullable().defaultTo('ATTEMPT_LOGIN')
    })
 
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('log_type')
    })
   
}