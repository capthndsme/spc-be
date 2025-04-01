import Order from "#models/order";
import Slot from "#models/slot";

class OrderingService {
  

  //
  //  DEVICE SIDE USER INTERFACE FNS
  //

  async findOrderId(id: string) {
    return await Slot.query()
    .where('active_order_id', id)
    .first()
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