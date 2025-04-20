import Slot from "#models/slot";

class SlotService {
  async getSlots() {
    return Slot.query().orderBy('id', 'asc');
  }

  async updateSlotCash(cash: number, slotId: number) {

    const slot = await Slot.find(slotId);
    if (!slot) return;
    slot.moneyAmount = cash;
    await slot.save();
    console.log("Slotupdate", slot)
    return slot;

  }
}

export default new SlotService();