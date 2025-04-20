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
    const data = await OrderingService.findOrderByParcelId(id);
    
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }


  /**
   * Set phone nunmber and set OTP.
   */

  async sendOTP({ request }: HttpContext) {
    const { number, orderId } = request.body();
    const data = await OrderingService.changeNumberAndSendOTP(number, orderId);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
    
  }

  /**
   * Validate OTP
   */
  async validateOTP({ request }: HttpContext) {
    const { orderId, otp } = request.body();
    const data = await OrderingService.validateOtp(orderId, otp);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
    

  }
  

  




}
