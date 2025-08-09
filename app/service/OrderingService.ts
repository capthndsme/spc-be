import Order from "#models/order";
import Slot from "#models/slot";
import { DateTime } from "luxon";

import SMSService from "./SMSService.js";

import ArduinoInputService from "./ArduinoInputService.js";
import LogService from "./LogService.js";

class OrderingService {


  //
  //  DEVICE SIDE USER INTERFACE FNS
  //

  async findOrderId(id: string) {
    return await Order.query()
      .preload('slot')
      .where('id', id)
      .first() || null
  }


  async findOrderByParcelId(pid: string) {
    await LogService.createLogRecord(
      "ATTEMPT_ORDER_ID",
      `Attempted to find order id ${pid} by rider`

    )

    return await Order.query()
      .preload('slot')
      .where('orderId', pid)
      .first() || null
  }


  async bindRiderOTP(
    orderId: string,
    riderNumber: string,
    riderName?: string
  ) {
    // 1. find ordder id
    const order = await Order.query()
      .where('id', orderId)
      .first()

    if (!order) {
      await LogService.createLogRecord(
        "ATTEMPT_ORDER_ID",
        `Attempted to enter order id ${orderId}`

      )
      return false
    };
    // 2. generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // set phone number
    order.otpRider = otp;
    order.riderNumber = riderNumber;
    if (riderName) order.riderName = riderName;
    // set state
    order.state = "OTP_WAITING";

    // 3. save OTP
    await order.save();
    // 4. send OTP
    await SMSService.sendSMS(`Your OTP for SmartParcel app is ${otp}`, riderNumber)
    // 5. return true
    await LogService.createLogRecord(
      "ATTEMPT_ORDER_ID",
      `Found order ${orderId} and generated OTP!`

    )
    return true;

  }
  /**
   * Validates OTP.
  */

  async validateRiderOtp(
    orderId: string,
    otp: string
  ) {
    // 1. find order id
    const order = await Order.query()
      .where('id', orderId)
      .first()
    if (!order) return false;
    await LogService.createLogRecord(
      "ATTEMPT_ENTER_OTP",
      `OTP entered for order ${orderId} : Valid? ${otp === order.otpRider}. `

    )
    // 2. validate OTP
    if (order.otpRider !== otp) return false;


    // 5. return true
    return true;

  }






  //
  //  ADMIN SIDE FNS
  //


  async upsertOrder(orderInfo: Partial<Order>, bindToSlot?: number) {
    console.log({ orderInfo, bindToSlot });

    // --- Find or Create Order ---
    const order = orderInfo?.id
      ? await Order.query().where('id', orderInfo.id).firstOrFail()
      : new Order();

    // Store the original slot ID *before* making changes
    const originalSlotId = order.slotId; // Keep track of the old slot

    // --- Update Order Details ---
    // (Consider using merge if suitable for your framework/ORM for cleaner updates)
    order.type = orderInfo.type ?? order.type ?? "COD"; // Preserve existing if not provided
    order.riderName = orderInfo.riderName ?? order.riderName ?? "N/A";
    order.riderNumber = orderInfo.riderNumber ?? order.riderNumber;
    order.state = orderInfo.state ?? order.state ?? "PENDING";
    order.moneyContent = orderInfo.moneyContent ?? order.moneyContent;
    order.orderId = orderInfo.orderId ?? order.orderId ?? "N/A";
    order.itemDescription = orderInfo.itemDescription ?? order.itemDescription ?? "N/A";
    // We will set slotId conditionally later
    order.orderPlaced = order.orderPlaced || DateTime.now(); // Set only if not already set
    order.otpRider = null; // Reset OTP on updates? Adjust if needed.


    // --- Slot Binding Logic ---
    let newSlot: Slot | null = null;
    if (bindToSlot !== undefined && bindToSlot !== null && bindToSlot >= 0) { // Check if a valid slot is being assigned
      newSlot = await Slot.find(bindToSlot);

      if (!newSlot) {
        throw new Error(`Slot with ID ${bindToSlot} not found`);
      }

      // Check if PAID orders can be bound (your original check)
      if ((orderInfo.type ?? order.type) === "PAID") {
        // Allow binding PAID if needed, or keep the restriction
        console.warn("Binding a PAID order to a slot."); // Or throw error if strict
        // throw new Error("Cannot bind PAID orders to a slot.");
      }


      // Check if the *target* slot is occupied by a *different* order
      if (newSlot.activeOrderId && newSlot.activeOrderId !== order.id) {
        throw new Error(`Slot ${bindToSlot} is already occupied by order ${newSlot.activeOrderId}`);
      }

      // --- Unbind from the OLD Slot (if necessary) ---
      // Check if the order was previously in a *different* slot
      if (originalSlotId && originalSlotId !== newSlot.id) {
        console.log(`Order ${order.id} is moving from slot ${originalSlotId} to ${newSlot.id}. Unbinding old slot.`);
        const oldSlot = await Slot.find(originalSlotId);
        if (oldSlot) {
          // Only unbind if the old slot still points to *this* order
          if (oldSlot.activeOrderId === order.id) {
            oldSlot.activeOrderId = null;
            // Potentially update other flags on the old slot if needed (e.g., isFilled = false?)
            await oldSlot.save();
            console.log(`Old slot ${originalSlotId} unbound.`);
          } else {
            console.warn(`Old slot ${originalSlotId} was expected to hold order ${order.id}, but holds ${oldSlot.activeOrderId}. Skipping unbind.`);
          }
        } else {
          console.warn(`Original slot ${originalSlotId} for order ${order.id} not found. Cannot unbind.`);
        }
      }

      // --- Bind to the NEW Slot ---
      newSlot.activeOrderId = order.id; // Assign order to the new slot
      // Potentially update other flags (e.g., isFilled = true?)
      await newSlot.save();
      console.log(`New slot ${newSlot.id} bound to order ${order.id}.`);

      // Update the order's slotId
      order.slotId = newSlot.id;

    } else if (originalSlotId && (bindToSlot === undefined || bindToSlot === null || bindToSlot < 0)) {
      // --- Handle Unbinding (if bindToSlot is explicitly removed or invalid) ---
      console.log(`Order ${order.id} is being unbound from slot ${originalSlotId}.`);
      const oldSlot = await Slot.find(originalSlotId);
      if (oldSlot) {
        if (oldSlot.activeOrderId === order.id) {
          oldSlot.activeOrderId = null;
          // Potentially update other flags
          await oldSlot.save();
          console.log(`Slot ${originalSlotId} unbound.`);
        } else {
          console.warn(`Slot ${originalSlotId} was expected to hold order ${order.id}, but holds ${oldSlot.activeOrderId}. Skipping unbind.`);
        }
      } else {
        console.warn(`Original slot ${originalSlotId} for order ${order.id} not found. Cannot unbind.`);
      }
      order.slotId = -1; // Or null, depending on your schema/preference for 'unassigned'
    } else {
      // No slot binding requested, and order wasn't previously bound
      if (!order.slotId) { // Ensure consistency if it wasn't set
        order.slotId = -1; // Or null
      }
    }


    // --- Save the Order ---
    await order.save();
    console.log(`Order ${order.id} saved.`);

    // Return the updated order (optional, but often useful)
    // You might want to preload the slot again if you return it
    return await this.findOrderId(String(order.id));
  }

  async getOrders() {
    return await Order.query().orderBy('id', 'asc');
  }




  async changeNumberAndSendOTP(number: string, orderId: string) {

    const order = await Order.query().where('orderId', orderId).first();
    await LogService.createLogRecord(
      "ATTEMPT_OTP",
      `Attempted to find order id ${orderId} by rider`

    )
    if (!order) throw new Error("Order not found");
    // when it's validated, set lock
    order.state = "OTP_WAITING"

    order.riderNumber = number;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    order.otpRider = otp;
    await order.save();
    await SMSService.sendSMS(`Your OTP for SafeDrop Rider is ${otp}`, number);
    return true;

  }

  async validateOtp(orderId: string, otp: string) {
    const order = await Order.query().where('orderId', orderId).first();

    if (!order) throw new Error("Order not found");
        await LogService.createLogRecord(
      "ATTEMPT_ENTER_OTP",
      `Attempted OTP ${otp} for order ${orderId} - OTP ${order.otpRider} and enter ${otp}` 

    )
    if (order.otpRider !== otp) throw new Error("Invalid OTP");


    return true;

  }

  /**
   * Cancels an order orderId,
   * by setting it to pending again
   */
  async cancelOrder(orderId: string) {
    const order = await Order.query().where('orderId', orderId).first();
    if (!order) throw new Error("Order not found");
        await LogService.createLogRecord(
      "ATTEMPT_CANCEL_ORDER",
      `Order id ${orderId} cancelled`

    )
    order.state = "PENDING";
    await order.save();
    return true;
  }

  /**
   * For COD, drops money by backwaring (-100) for 10 seconds,
   * then stops (0). Afterwhich, we write a servo stop command,
   * wait for 2 seconds, and return a true boolean. 
   * ServoIndex = SlotId 
   */
  async dropMoney(orderId: string) {
    const order = await Order.query().where('orderId', orderId).first();
    if (!order) throw new Error("Order not found");
    if (order.type !== "COD") throw new Error("Order is not COD");
    if (!order.slotId || order.slotId < 0) throw new Error("Order is not bound to a slot");
    // when it's validated, set lock

    await order.save();
    // set servo to -100 for 10 seconds

    await new Promise(res => setTimeout(res, 100));
    console.log(`Dropping money for order ${orderId} in slot ${order.slotId}`)
    const servoIndex = order.slotId;
    const servoSpeed = -100;
    const duration = 10000; // 10 seconds
    const stopDelay = 2000; // 2 seconds

    ArduinoInputService.setServoSpeed(servoIndex, servoSpeed);
    await new Promise(resolve => setTimeout(resolve, duration));
    ArduinoInputService.setServoSpeed(servoIndex, 0);
    await new Promise(resolve => setTimeout(resolve, stopDelay));


    return true;
  }






  /**
   * Mark order as finished (delivered), frees the slot, and A TODO to notify the USER
   */
  async finishOrder(orderId: string, initialWeight: string, finalWeight: string) {
    const order = await Order.query().where('orderId', orderId).first();
    if (!order) throw new Error("Order not found");
    if (!order.slotId || order.slotId < 0) throw new Error("Order is not bound to a slot");
    const slot = await Slot.find(order.slotId);
    if (!slot) throw new Error("Slot not found");
    slot.activeOrderId = null;
    slot.moneyAmount = 0;
    slot.isFilled = false;
    await slot.save();
    order.state = "DELIVERED";
    order.slotId = 0;
    order.beforeWeight = parseFloat(initialWeight)
    order.afterWeight = parseFloat(finalWeight)
    await LogService.createLogRecord(
      "ATTEMPT_FINISH_ORDER",
      `Order ${orderId} finished! Weight: ${initialWeight} -> ${finalWeight}, slot ${order.slotId}, type ${order.type}, pkg weight ${order.afterWeight - order.beforeWeight}  `

    )
    await order.save();
    return true;
  }






}


export default new OrderingService();