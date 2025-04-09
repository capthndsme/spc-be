import Order from "#models/order";
import Slot from "#models/slot";
import SMSService from "./SMSService.js";

class OrderingService {
  

  //
  //  DEVICE SIDE USER INTERFACE FNS
  //

  async findOrderId(id: string) {
    return await Order.query()
    .where('id', id)
    .first()
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

  async createOrder(orderInfo: Partial<Order>, bindToSlot?: number) {

    if (bindToSlot) {
      
    }


  }

}


export default new OrderingService();