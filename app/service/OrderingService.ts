import Order from "#models/order";
import Slot from "#models/slot";
import { DateTime } from "luxon";

import SMSService from "./SMSService.js";
import TheService from "./TheService.js";

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
    return await Order.query()
      .preload('slot')
      .whereLike('orderId', `%${pid}%`)
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
    if (!order) return false;
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

    const order = await Order.query().whereLike('orderId', `%${orderId}%`).first();
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
    const order = await Order.query().whereLike('orderId', `%${orderId}%`).first();
    if (!order) throw new Error("Order not found");
    if (order.otpRider !== otp) throw new Error("Invalid OTP");


    return true;

  }

  /** Opens the door, and waits for RE-LOCK */
  async openAndLock() {
    await TheService
  }
}


export default new OrderingService();