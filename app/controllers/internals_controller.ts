import type { HttpContext } from '@adonisjs/core/http'
import GPIOService from '../service/GPIOService.js'
import OrderingService from '../service/OrderingService.js';
import { StatusResponse } from '../response/StatusResponse.js';
import { Status } from '../enums/Status.js';

export default class InternalsController {
  /**
   * Wait Relock App
   */
  async waitRelock() {
    await new Promise((res, rej) => {
      GPIOService.unlockAndWaitForRelock(
        () => res(true),
        () => rej(false),
        120000 /** 120 seconds */
      )
    });
  }

  /**
   * Finds order id
   */
  async findOrderId({ request }: HttpContext) {
    const id = request.param('id')
    const data = await OrderingService.findOrderId(id);
    if (!data) return
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }


  /**
   * Send and set OTP
   */

  async sendOTP({ request }: HttpContext) {

  }

  /**
   * Validate OTP
   */
  async validateOTP({ request }: HttpContext) {

  }
  

  




}
