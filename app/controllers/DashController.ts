import { HttpContext } from "@adonisjs/core/http";
import { StatusResponse } from "../response/StatusResponse.js";
import TheService from "../service/TheService.js";
import { Status } from "../enums/Status.js";
import ArduinoInputService from "../service/ArduinoInputService.js";
import SlotService from "../service/SlotService.js";
import Order from "#models/order";
import OrderingService from "../service/OrderingService.js";
import NotificationService from "../service/NotificationService.js";

export default class DashController {

  async getDash({ }: HttpContext) {
    const data = TheService.getStates()
    return StatusResponse(
      data,
      Status.GENERIC_SUCCESS,
      false
    )
  };

  async tare({request} : HttpContext) {
    const tare = await ArduinoInputService.tare(request.qs()['id']);
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

  async upsertOrder({ request }: HttpContext) {
    const { bindToSlot, orderInfo } = request.body() as { orderInfo: Order, bindToSlot?: number };

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

  async getOrders({ }) {

    const order = await OrderingService.getOrders();
    return StatusResponse(
      order,
      Status.GENERIC_SUCCESS,
      false
    )

  }

  /** Test servo speed */
  async testServo({ request }: HttpContext) {
    const { id } = request.params()
    if (!id) return null;
    /** Test for 10 seconds */
    ArduinoInputService.setServoSpeed(Number(id), -100);
    await new Promise(res => setTimeout(res, 8000));
    ArduinoInputService.setServoSpeed(Number(id), 100);
    await new Promise(res => setTimeout(res, 8000));
    ArduinoInputService.setServoSpeed(Number(id), 0);
    await new Promise(res => setTimeout(res, 2000));
    return StatusResponse(
      {},
      Status.GENERIC_SUCCESS,
      false
    )

  }


  async pingOkay() {
    const okay = ArduinoInputService.pingReady;
    if (okay) {
      return StatusResponse(
        {
          ping: "pong"
        },
        Status.GENERIC_SUCCESS,
        false
      )

    } else throw new Error("NOT_READY")
  }

  async registerToken({ request }: HttpContext) {
    const { token } = request.body();
    const userId = Number(request.header("X-user-id") ?? -1);
    if (userId < 0) throw new Error("Invalid user id");
    await NotificationService.upsertToken(userId, token);
    return StatusResponse(
      {},
      Status.GENERIC_SUCCESS,
      false
    )
    
  }
}


