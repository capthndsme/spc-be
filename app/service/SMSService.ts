import env from "#start/env";
import ArduinoInputService from "./ArduinoInputService.js";
 
class SMSService { 

  readonly #smsUsername = env.get("SMS_USERNAME")
  readonly #smsPassword = env.get("SMS_PASSWORD")
 
 
  /**
   * This is the standard format for our SMS Gateway,
   * an Android-powered SMSgw.
   * curl -X POST \
    -u <username>:<password> \
    -H 'Content-Type: application/json' \
    https://api.sms-gate.app/3rdparty/v1/message \
    -d '{
        "message": "Hello from SIM2, Dr. Turk!",
        "phoneNumbers": ["+19162255887"],
        "simNumber": 2
    }'

    Lets transform it
   */
 

  async sendSMSAPI(message: string, number: string) {
    const url = "https://api.sms-gate.app/3rdparty/v1/message";
    const auth = Buffer.from(`${this.#smsUsername}:${this.#smsPassword}`).toString('base64');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    };
    const body = JSON.stringify({
      message: message,
      phoneNumbers: [number],
      simNumber: 2
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`SMS send failed: ${response.status} - ${text}`);
      return false;
    }

    const data = await response.json();
    console.log('SMS send success:', data);
    return true;
  }
  async sendSMS(
    message: string,
    number: string
  ) {
    await this.sendSMSAPI(message, number);
    await ArduinoInputService.sendSms(number, message)
  }
  
}


export default new SMSService();

