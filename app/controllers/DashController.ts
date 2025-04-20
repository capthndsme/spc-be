import { HttpContext } from "@adonisjs/core/http";
import { StatusResponse } from "../response/StatusResponse.js";
import TheService from "../service/TheService.js";
import { Status } from "../enums/Status.js";
import ArduinoInputService from "../service/ArduinoInputService.js";
import SlotService from "../service/SlotService.js";
import Order from "#models/order";
import OrderingService from "../service/OrderingService.js";

export default class DashController {
  
  async getDash({  }: HttpContext) {
    const data = TheService.getStates()
    return StatusResponse(
      data,
      Status.GENERIC_SUCCESS,
      false
    )
  };

  async tare() {
    const tare = await ArduinoInputService.tare();
    return StatusResponse(
      tare,
      Status.GENERIC_SUCCESS,
      false
    )
    
  }

  async getSlots() {
    const data = await SlotService.getSlots()
    return StatusResponse(
      data,
      Status.GENERIC_SUCCESS,
      false
    )
    
  }

  async updateSlot({ request }: HttpContext) {

    const { moneyAmount, id } = request.body();
    const data = await SlotService.updateSlotCash(moneyAmount, id);
    return StatusResponse(
      data,
      Status.GENERIC_SUCCESS,
      false
    )
    
  }

  async upsertOrder({request}: HttpContext) {
    const { bindToSlot, orderInfo } = request.body() as {orderInfo: Order, bindToSlot?: number};
    
    await OrderingService.upsertOrder(orderInfo, bindToSlot);

    return StatusResponse(
      {},
      Status.GENERIC_SUCCESS,
      false
    )
    
  }

  async getOrder({ request }: HttpContext) {
    const { id } = request.params();
    const data = await OrderingService.findOrderId(id);
    return StatusResponse(
      data,
      Status.GENERIC_SUCCESS,
      false
    )
    }

  async getOrders({}) {

    const order = await OrderingService.getOrders();
    return StatusResponse(
      order,
      Status.GENERIC_SUCCESS,
      false
    )
    
  }
}


 