import env from "#start/env";
import gpiox from "@iiot2k/gpiox"; // Assuming this library handles GPIO interactions

class GPIOService {
  booted: boolean = false;
  inputBlocking: boolean = false; // Note: Still unused in this snippet
  magnetStates: boolean[] = [false, false, false, false]; // true = magnet detected (closed), false = magnet not detected (open)
  readonly isPi: boolean = env.get('IS_PI');

  #magnetStateCallbacks: ((states: boolean[]) => void)[] = [];

  // --- State for relock sequences ---
  #relockStates = Array(4).fill(null).map(() => ({
    isWaiting: false,
    timeout: null as NodeJS.Timeout | null,
    onRelock: null as (() => void) | null,
    onExpired: null as (() => void) | null,
    waitingForOpen: true,
  }));
  #isMasterRelockCallbackRegistered = false;
  // ---

  registerMagnetStateCallback(callback: (states: boolean[]) => void): void {
    this.#magnetStateCallbacks.push(callback);
  }

  unregisterMagnetStateCallback(callback: (states: boolean[]) => void): void {
    this.#magnetStateCallbacks = this.#magnetStateCallbacks.filter(cb => cb !== callback);
  }

  notifyMagnetStateCallbacks(states: boolean[]): void {
    this.#magnetStateCallbacks.forEach(callback => {
      try {
        callback(states);
      } catch (error) {
        console.error("Error executing magnet state callback:", error);
      }
    });
  }

  map = {
    output: {
      // Assuming HIGH/true = Locked, LOW/false = Unlocked.
      SolenoidLock: [17, 23, 22, 24], // Using common available GPIO pins
    },
    input: {
      // Assuming Pull-up: HIGH/true = open circuit (magnet far), LOW/false = closed circuit (magnet near)
      MagnetDetection: [27, 5, 6, 13], // Using common available GPIO pins
    }
  }

  public boot(): void {
    if (this.booted) {
      console.log("GPIO service already booted. Skipping initialization.");
      return;
    }
    this.booted = true;
    console.log("Booting GPIO service...");

    if (this.isPi) {
      try {
        // Initialize MagnetDetection pins as inputs with pull-up resistors
        this.map.input.MagnetDetection.forEach((pin, index) => {
          gpiox.init_gpio(pin, gpiox.GPIO_MODE_INPUT_PULLUP, false);
          this.magnetStates[index] = gpiox.get_gpio(pin);
          console.log(`Initial Magnet state for sensor ${index + 1} (pin ${pin}): ${this.magnetStates[index] ? 'detected (closed)' : 'not detected (open)'}`);
        });
        this.notifyMagnetStateCallbacks(this.magnetStates);

        // Initialize SolenoidLock pins as outputs
        this.map.output.SolenoidLock.forEach((pin, index) => {
          gpiox.init_gpio(pin, gpiox.GPIO_MODE_OUTPUT, true); // Start in locked state
          console.log(`Initialized SolenoidLock ${index + 1} (pin ${pin})`);
        });
        console.log("GPIO pins initialized.");

        // Start polling loop to detect magnet state changes
        setInterval(() => {
          const newStates = [...this.magnetStates];
          let changed = false;
          this.map.input.MagnetDetection.forEach((pin, index) => {
            const rawGpioState = gpiox.get_gpio(pin);
            if (rawGpioState !== newStates[index]) {
              console.log(`Magnet state for sensor ${index + 1} (pin ${pin}) changed to ${rawGpioState ? 'detected (closed)' : 'not detected (open)'}`);
              newStates[index] = rawGpioState;
              changed = true;
            }
          });

          if (changed) {
            this.magnetStates = newStates;
            this.notifyMagnetStateCallbacks(this.magnetStates);
          }
        }, 100); // Check every 100ms

      } catch (error) {
        console.error("Failed to initialize GPIO:", error);
        this.booted = false;
      }
    } else {
      console.log("Not running on Pi environment. GPIO functionality disabled.");
      // Simulate initial state for testing off-Pi if needed
      this.magnetStates = [true, true, true, true]; // Assume closed initially for simulation
      this.notifyMagnetStateCallbacks(this.magnetStates);
    }
    console.log("GPIO service boot sequence complete.");
  }

  /**
   * Sets the state of a specific Solenoid Lock.
   * @param lockIndex - The index of the lock (0-3).
   * @param lock - true to lock, false to unlock.
   */
  writeLockState(lockIndex: number, lock: boolean): void {
    if (lockIndex < 0 || lockIndex >= this.map.output.SolenoidLock.length) {
      console.error(`Invalid lock index: ${lockIndex}`);
      return;
    }

    if (!this.booted || !this.isPi) {
      console.warn(`GPIO service not ready. Simulating set lock ${lockIndex + 1} state to ${lock}.`);
      return;
    }

    const pin = this.map.output.SolenoidLock[lockIndex];
    console.log(`Setting SolenoidLock ${lockIndex + 1} (GPIO ${pin}) to ${lock ? 'Locked' : 'Unlocked'}`);
    try {
      gpiox.set_gpio(pin, lock);
    } catch (error) {
      console.error(`Failed to set GPIO state for SolenoidLock ${lockIndex + 1}:`, error);
    }
  }

  private _registerMasterRelockCallback() {
    if (this.#isMasterRelockCallbackRegistered) return;

    const masterCallback = (states: boolean[]) => {
      this.#relockStates.forEach((state, index) => {
        if (!state.isWaiting) return;

        const currentState = states[index];
        
        console.log(`Sequence Callback for lock ${index + 1}: Current magnet state: ${currentState ? 'detected (closed)' : 'not detected (open)'}, Waiting for open: ${state.waitingForOpen}`);

        if (state.waitingForOpen && currentState === false) {
          console.log(`Sequence Callback for lock ${index + 1}: Magnet NOT detected (opened). Now waiting for close.`);
          state.waitingForOpen = false;
        } else if (!state.waitingForOpen && currentState === true) {
          console.log(`Sequence Callback for lock ${index + 1}: Magnet DETECTED (closed/relocked). Sequence complete.`);
          console.log(`Re-locking solenoid ${index + 1}...`);
          this.writeLockState(index, true);

          if (state.timeout) clearTimeout(state.timeout);

          const onRelockCb = state.onRelock;

          // Reset state before calling back
          state.isWaiting = false;
          state.onRelock = null;
          state.onExpired = null;
          state.timeout = null;
          state.waitingForOpen = true;

          if (onRelockCb) {
            try {
              console.log(`Executing onRelock callback for lock ${index + 1}.`);
              onRelockCb();
            } catch (error) {
              console.error(`Error executing onRelock callback for lock ${index + 1}:`, error);
            }
          }
        }
      });
    };

    this.registerMagnetStateCallback(masterCallback);
    this.#isMasterRelockCallbackRegistered = true;
  }

  /**
   * Attempts to unlock a Solenoid Lock, waits for the corresponding magnet sensor to indicate
   * the lock has been physically opened and then closed again, then re-locks the solenoid.
   *
   * @param lockIndex - The index of the lock (0-3) to operate.
   * @param onRelock - Callback executed *after* the sequence completes and the lock is re-engaged.
   * @param onExpired - Callback executed if the sequence times out or cannot start.
   * @param timeoutDurationMs - Duration in milliseconds to wait for the sequence. Defaults to 40000.
   */
  public unlockAndWaitForRelock(
    lockIndex: number,
    onRelock: () => void,
    onExpired?: () => void,
    timeoutDurationMs: number = 40000
  ): void {
    if (lockIndex < 0 || lockIndex >= 4) {
      console.error(`Invalid lock index: ${lockIndex}`);
      onExpired?.();
      return;
    }

    if (!this.booted) {
      console.warn("GPIO service not booted. Cannot perform unlock sequence.");
      onExpired?.();
      return;
    }

    if (!this.isPi) {
      console.warn(`Not on Pi. Simulating unlock sequence for lock ${lockIndex + 1}.`);
      this.writeLockState(lockIndex, false);
      setTimeout(() => {
        console.log(`Simulated open->close sequence complete for lock ${lockIndex + 1}.`);
        this.writeLockState(lockIndex, true);
        onRelock();
      }, 1000);
      return;
    }

    const state = this.#relockStates[lockIndex];
    console.log("Our states", this.#relockStates)

    if (state.isWaiting) {
      console.warn(`Already waiting for a relock sequence on lock ${lockIndex + 1}. Ignoring new request.`);
      return;
    }

    if (this.magnetStates[lockIndex] === false) {
      console.warn(`Cannot start unlock sequence for lock ${lockIndex + 1}: Magnet not detected (already open?).`);
      onExpired?.();
      return;
    }

    console.log(`Starting unlock and wait for relock sequence for lock ${lockIndex + 1}...`);

    this._registerMasterRelockCallback();

    state.isWaiting = true;
    state.onRelock = onRelock;
    if (onExpired) state.onExpired = onExpired;
    state.waitingForOpen = true;

    state.timeout = setTimeout(() => {
      if (state.isWaiting) {
        console.warn(`Relock sequence for lock ${lockIndex + 1} timed out after ${timeoutDurationMs}ms.`);

        const onExpiredCb = state.onExpired;

        // Reset state
        state.isWaiting = false;
        state.onRelock = null;
        state.onExpired = null;
        state.timeout = null;
        state.waitingForOpen = true;

        if (onExpiredCb) {
          try {
            onExpiredCb();
          } catch (error) {
            console.error(`Error executing onExpired callback for lock ${lockIndex + 1}:`, error);
          }
        }
      }
    }, timeoutDurationMs);

    this.writeLockState(lockIndex, false);
    console.log(`Unlock command sent for lock ${lockIndex + 1}. Waiting for open -> close. Timeout in ${timeoutDurationMs}ms.`);
  }

  // Helper to get current magnet states if needed externally
  public getCurrentMagnetStates(): boolean[] {
    return [...this.magnetStates];
  }

  // Helper to check if a specific lock is in a waiting sequence
  public isWaiting(lockIndex: number): boolean {
    if (lockIndex < 0 || lockIndex >= 4) return false;
    return this.#relockStates[lockIndex].isWaiting;
  }
}

export default new GPIOService();
