
import env from "#start/env";
import gpiox from "@iiot2k/gpiox";


class GPIOService {

  booted: boolean = false;
  inputBlocking: boolean = false;
  magnetState: boolean = false;
  readonly isPi: boolean = env.get('IS_PI');

  /** 
   *  || This lists a callback when magnetic state changes
   * 
   */
  
  
  #magnetStateCallbacks: ((state: boolean) => void)[] = [];

  registerMagnetStateCallback(callback: (state: boolean) => void): void {
    this.#magnetStateCallbacks.push(callback);
  }

  unregisterMagnetStateCallback(callback: (state: boolean) => void): void {
    this.#magnetStateCallbacks = this.#magnetStateCallbacks.filter(cb => cb !== callback);
  }

  notifyMagnetStateCallbacks(state: boolean): void {
    this.#magnetStateCallbacks.forEach(callback => callback(state));
  }
  



  public boot(): void {
    if (this.booted) return console.log("GPIO service already booted");
    this.booted = true;

    console.log("GPIO service booted");

    // Initialize SolenoidLock detection
    gpiox.init_gpio(this.map.input.MagnetDetection, gpiox.GPIO_MODE_INPUT_PULLUP, false)

    // Initialize MagnetLock detection
    gpiox.init_gpio(this.map.output.SolenoidLock, gpiox.GPIO_MODE_OUTPUT, false)
   
    // 
    // create timeout loop
    setInterval(() => {
      const state = gpiox.get_gpio(this.map.input.MagnetDetection);
      if (state !== this.magnetState) {
        this.magnetState = state;
        console.log(`Magnet state changed to ${state ? 'detected' : 'not detected'}`);
        this.notifyMagnetStateCallbacks(state);
      }
    }, 100);
    
    
  }

  writeLockState(state: boolean): void {
    gpiox.set_gpio(this.map.output.SolenoidLock, state);
  }




 
  map = {
    output: {
      SolenoidLock: 17,
    },
    input: {
      MagnetDetection: 27,

    }
  }
}



export default new GPIOService();