 
import SMSService from "./SMSService.js";

class OTPService {

 

  /**
   * test OTP
   */


  async testSendMessage() {
    const numberTests = [
      "+639760987511",
      "+639159105638" // sam
    ]
    const content = `Smart Parcel is Up and Running`
   
    // try [0]
 

    for (const number of numberTests) {
      await SMSService.sendSMS(content, number);
    }
    

    
  } 
}

export default new OTPService();