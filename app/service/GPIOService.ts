
import env from "#start/env";
import gpiox from "@iiot2k/gpiox";


class GPIOService {

  booted: boolean = false;
  inputBlocking: boolean = false;
  readonly isPi: boolean = env.get('IS_PI');

  public boot(): void {
    if (this.booted) return console.log("GPIO service already booted");
    this.booted = true;

    console.log("GPIO service booted");

    // Initialize SolenoidLock detection
    gpiox.init_gpio(this.map.input.MagnetDetection, gpiox.GPIO_MODE_INPUT_PULLUP, false)

    // Initialize MagnetLock detection
    gpiox.init_gpio(this.map.output.SolenoidLock, gpiox.GPIO_MODE_OUTPUT, false)



   /*  // Init LED output
    const leds = Object.keys(GPIOMap.LEDS);
    leds.forEach(led => {
      gpiox.init_gpio(GPIOMap.LEDS[led as keyof typeof GPIOMap['LEDS']], gpiox.GPIO_MODE_OUTPUT, false);
    });


    // init led ringlight

    gpiox.init_gpio(GPIOMap.ringLight, gpiox.GPIO_MODE_OUTPUT, false);




    // Init door
    gpiox.init_gpio(GPIOMap.door, gpiox.GPIO_MODE_OUTPUT, true);

    // Polling for button press with debouncing
  
    gpiox.watch_gpio(GPIOMap.BUTTONS.openBtn, gpiox.GPIO_MODE_INPUT_PULLUP, 4000, gpiox.GPIO_EDGE_FALLING, (state, edge, pin) => this.pollOpenBtn(pin)); */

    // @ts-ignore - ABYSMAL typings for gpiox. 
    gpiox.watch_gpio(this.map.input.MagnetDetection, gpiox.GPIO_MODE_INPUT_PULLUP, 4000, gpiox.GPIO_EDGE_FALLING, (state, edge, pin) => this.pollStartBtn(pin));

  }

  writeLockState(state: boolean): void {
    gpiox.set_gpio(this.map.output.SolenoidLock, state);
  }






  private pollStartBtn(pin: number): void {
 
    console.log("detected a magnet!", pin);


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