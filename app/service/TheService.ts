import ArduinoInputService from "./ArduinoInputService.js";
import GPIOService from "./GPIOService.js";
 

class TheService {
  booted = false;

  data: typeof ArduinoInputService['lastSensorData'] | null = null;
  /**
   * are we dispensing.
   */
  #dispensing: boolean = false;
  /**
   * anyone in the screen interacting.
   */
  #activeSession: boolean = false;

  #gpioService = GPIOService;

  /**
   * 
   */

  boot() {
    if (this.booted) return console.log("[THESERVICE] ALREADY BOOTED");
    this.booted = true;
    console.log(`THE SERVICE HAS BOOT`)
    // start segment.
    this.startup();
    this.#gpioService.boot();

 
 
  }

  async startup() {
    // load our AIS
    ArduinoInputService.registerCallback((d) => { 
      this.data = d;
    })
  }

  getCurrentSensorData() {
    return this.data;
  }


   getStates() {
    return {
      sensors: this.getCurrentSensorData(),
      hasActiveSession: this.#activeSession,
      isDispensing: this.#dispensing,
    

    }
  }

  /**
   * Capturing internal camera
   */
  
}



export default new TheService();