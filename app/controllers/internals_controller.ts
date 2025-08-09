import type { HttpContext } from '@adonisjs/core/http'
import GPIOService from '../service/GPIOService.js'
import OrderingService from '../service/OrderingService.js';
import { StatusResponse } from '../response/StatusResponse.js';
import { Status } from '../enums/Status.js';
import LogService from '../service/LogService.js';

export default class InternalsController {
  /**
   * Wait Relock App
   */
  async waitRelock() {
    return await new Promise((res) => {
      GPIOService.unlockAndWaitForRelock(
        () => res(
          StatusResponse(true, Status.GENERIC_SUCCESS, false)
        ),
        () => res(
          StatusResponse(false, Status.MAGNET_ERROR, false)
        ),
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
  

  

 /**
  * triggers cancel order
  * 
  */
  async cancelOrder({ request }: HttpContext) {
    const { orderId } = request.body();
    const data = await OrderingService.cancelOrder(orderId);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }

  /**
   * triggers drop money
   */
  async dropMoney({ request }: HttpContext) {
    const { orderId } = request.body();
    const data = await OrderingService.dropMoney(orderId);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }

  /**
   * triggers finish order
   */
  async finishOrder({ request }: HttpContext) {
    const { orderId,

      initialWeight, 
      finalWeight
    } = request.body();
    const data = await OrderingService.finishOrder(orderId, initialWeight, finalWeight);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }
  

  async getLog({ request }: HttpContext) {
    const { beforeId, afterId, limit } = request.qs();
    const data = await LogService.getLogs(beforeId, afterId, limit);
    return StatusResponse(data, Status.GENERIC_SUCCESS, false);
  }
  


}
