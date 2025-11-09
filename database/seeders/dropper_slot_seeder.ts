import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSeeder {
  async run() {
    // Write your database queries inside the run method
    /**
     * Creates four slots (1-4)
     */
    await db.table('dropper_slots').insert([
      {
        id: 1, slot_id: 1, is_occupied: false
        , length: 32, width: 35, height: 42
      },
      { id: 2, slot_id: 2, is_occupied: false, length: 32, width: 35, height: 42 },
      { id: 3, slot_id: 3, is_occupied: false, length: 32, width: 35, height: 25 },
      { id: 4, slot_id: 4, is_occupied: false, length: 32, width: 35, height: 65 },
    ])

  }
}