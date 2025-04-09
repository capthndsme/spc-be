import env from "#start/env";
import gpiox from "@iiot2k/gpiox"; // Assuming this library handles GPIO interactions

class GPIOService {
  booted: boolean = false;
  inputBlocking: boolean = false; // Note: Still unused in this snippet
  magnetState: boolean = false; // true = magnet detected (closed), false = magnet not detected (open)
  readonly isPi: boolean = env.get('IS_PI');

  #magnetStateCallbacks: ((state: boolean) => void)[] = [];

  registerMagnetStateCallback(callback: (state: boolean) => void): void {
    this.#magnetStateCallbacks.push(callback);
  }

  unregisterMagnetStateCallback(callback: (state: boolean) => void): void {
    this.#magnetStateCallbacks = this.#magnetStateCallbacks.filter(cb => cb !== callback);
  }

  notifyMagnetStateCallbacks(state: boolean): void {
    this.#magnetStateCallbacks.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error("Error executing magnet state callback:", error);
      }
    });
  }

  map = {
    output: {
      // Assuming HIGH/true = Locked, LOW/false = Unlocked.
      SolenoidLock: 17,
    },
    input: {
      // Assuming Pull-up: HIGH/true = open circuit (magnet far/absent), LOW/false = closed circuit (magnet near/present)
      // *** Therefore, magnetState == false means magnet DETECTED (closed) ***
      // *** Let's adjust the logic and comments to reflect this standard pull-up behavior ***
      // If using PULLDOWN, the logic would be reversed.
      MagnetDetection: 27,
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
        // Initialize MagnetDetection pin as input with pull-up resistor
        // Reads HIGH (true) when open circuit (magnet far).
        // Reads LOW (false) when closed circuit (magnet near).
        gpiox.init_gpio(this.map.input.MagnetDetection, gpiox.GPIO_MODE_INPUT_PULLUP, false);
        // Read initial state. Remember: false means magnet detected (closed).
        this.magnetState = gpiox.get_gpio(this.map.input.MagnetDetection); // Invert reading for intuitive state (true = closed/detected)
        console.log(`Initial Magnet state: ${this.magnetState ? 'detected (closed)' : 'not detected (open)'}`);
        this.notifyMagnetStateCallbacks(this.magnetState); // Notify initial state


        // Initialize SolenoidLock pin as output.
        // Assuming HIGH/true = Locked state, LOW/false = Unlocked state.
        gpiox.init_gpio(this.map.output.SolenoidLock, gpiox.GPIO_MODE_OUTPUT, true); // Start in locked state
        console.log("GPIO pins initialized.");

        // Start polling loop to detect magnet state changes
        setInterval(() => {
          // Remember: GPIO read is true for open circuit (magnet far), false for closed (magnet near)
          const rawGpioState = gpiox.get_gpio(this.map.input.MagnetDetection);
          const currentState = rawGpioState; // Invert for intuitive state (true = closed/detected)

          if (currentState !== this.magnetState) {
            console.log(`Magnet state changed to ${currentState ? 'detected (closed)' : 'not detected (open)'}`);
            this.magnetState = currentState;
            this.notifyMagnetStateCallbacks(this.magnetState);
          }
        }, 100); // Check every 100ms

      } catch (error) {
        console.error("Failed to initialize GPIO:", error);
        this.booted = false;
      }
    } else {
      console.log("Not running on Pi environment. GPIO functionality disabled.");
      // Simulate initial state for testing off-Pi if needed
      this.magnetState = true; // Assume closed initially for simulation
      this.notifyMagnetStateCallbacks(this.magnetState);
    }
    console.log("GPIO service boot sequence complete.");
  }

  /**
   * Sets the state of the Solenoid Lock.
   * @param lock - true to lock, false to unlock.
   */
  writeLockState(lock: boolean): void {
    if (!this.booted || !this.isPi) {
      console.warn(`GPIO service not ready. Cannot set lock state to ${lock}.`);
      // Simulate state change if needed for testing off-Pi
      // For example: this.simulatedLockState = lock;
      return;
    }
    console.log(`Setting SolenoidLock (GPIO ${this.map.output.SolenoidLock}) to ${lock ? 'Locked' : 'Unlocked'}`);
    try {
      // Assuming true = Locked, false = Unlocked matches the hardware needs
      gpiox.set_gpio(this.map.output.SolenoidLock, lock);
    } catch (error) {
      console.error("Failed to set GPIO state for SolenoidLock:", error);
    }
  }

  #isWaitingForRelock = false;
  #relockTimeout: NodeJS.Timeout | null = null;
  #relockSequenceCallback: ((state: boolean) => void) | null = null;

  /**
   * Attempts to unlock the Solenoid Lock, waits for the magnet sensor to indicate
   * the lock mechanism has been physically opened (magnet not detected) and then
   * physically closed again (magnet detected), then re-locks the solenoid
   * and calls the provided callback function.
   *
   * Precondition: The magnet must be detected (indicating closed state) before starting.
   *
   * Assumptions (based on PULLUP resistor for input & standard lock):
   * - `writeLockState(false)` unlocks the solenoid.
   * - `writeLockState(true)` locks the solenoid.
   * - `this.magnetState == false` means magnet is *not detected* (e.g., door open).
   * - `this.magnetState == true` means magnet is *detected* (e.g., door closed/aligned).
   *
   * @param onRelock - Callback executed *after* the sequence completes and the lock is re-engaged.
   * @param onExpired - Callback executed if the sequence times out or cannot start (e.g., already open). The lock will be left *unlocked* in case of timeout.
   * @param timeoutDurationMs - Duration in milliseconds to wait for the sequence. Defaults to 30000 (30 seconds).
   */
  public unlockAndWaitForRelock(
    onRelock: () => void,
    onExpired?: () => void,
    timeoutDurationMs: number = 40000
  ): void {
    // 1. Pre-checks
    if (!this.booted) {
      console.warn("GPIO service not booted. Cannot perform unlock sequence.");
      if (onExpired) onExpired(); // Notify caller about failure
      return;
    }
     if (!this.isPi) {
        console.warn("Not on Pi. Simulating unlock sequence for testing.");
        // Basic simulation: unlock, wait, assume success, relock.
        this.writeLockState(false); // Simulate unlock
        setTimeout(() => {
            console.log("Simulated open->close sequence complete.");
            this.writeLockState(true); // Simulate relock
            onRelock();
        }, 1000); // Short delay for simulation
        return;
    }
    if (this.#isWaitingForRelock) {
      console.warn("Already waiting for a relock sequence. Ignoring new request.");
      // Do not call onExpired here, as the *previous* sequence is still active or timed out.
      return;
    }
    // **** Issue 1: Check Initial State ****
    if (this.magnetState === false) {
      console.warn("Cannot start unlock sequence: Magnet not detected (already open?). Please ensure it is closed first.");
      if (onExpired) onExpired(); // Use onExpired to signal failure to start
      return;
    }

    console.log("Starting unlock and wait for relock sequence...");
    this.#isWaitingForRelock = true;

    // Cleanup previous potential stray listeners/timeouts (belt-and-suspenders)
    if (this.#relockSequenceCallback) {
       this.unregisterMagnetStateCallback(this.#relockSequenceCallback);
       this.#relockSequenceCallback = null;
    }
    if (this.#relockTimeout) {
        clearTimeout(this.#relockTimeout);
        this.#relockTimeout = null;
    }


    // 2. Define the state-tracking callback
    let waitingForOpen = true; // State variable: initially, we wait for 'false' (open)
    this.#relockSequenceCallback = (currentState: boolean) => {
      // If no longer waiting (e.g., timeout occurred), do nothing.
      if (!this.#isWaitingForRelock) return;

      console.log(`Sequence Callback: Current magnet state: ${currentState ? 'detected (closed)' : 'not detected (open)'}, Waiting for open: ${waitingForOpen}`);

      if (waitingForOpen && currentState === false) {
        // Detected the 'open' state (magnet not detected)
        console.log("Sequence Callback: Magnet NOT detected (opened). Now waiting for close.");
        waitingForOpen = false; // Transition state: now wait for 'true' (closed)
      } else if (!waitingForOpen && currentState === true) {
        // Detected the 'close' state (magnet detected) AFTER the 'open' state
        console.log("Sequence Callback: Magnet DETECTED (closed/relocked). Sequence complete.");

        // --- Issue 2: Re-lock the solenoid ---
        console.log("Re-locking the solenoid...");
        this.writeLockState(true); // Command the lock to engage

        // Cleanup before calling user callback
        if (this.#relockTimeout) clearTimeout(this.#relockTimeout);
        this.#relockTimeout = null;
        if (this.#relockSequenceCallback) this.unregisterMagnetStateCallback(this.#relockSequenceCallback);
        this.#relockSequenceCallback = null;
        this.#isWaitingForRelock = false; // Reset the flag *after* cleanup

        // Execute the user's success callback
        try {
          console.log("Executing the onRelock callback.");
          onRelock();
        } catch (error) {
          console.error("Error executing onRelock callback:", error);
        }
      }
      // If currentState doesn't match the expected sequence step, do nothing and wait.
    };

    // 3. Register the tracking callback
    this.registerMagnetStateCallback(this.#relockSequenceCallback);

    // 4. Set up Timeout
    this.#relockTimeout = setTimeout(() => {
      // Check if the sequence is still waiting when timeout hits
      if (this.#isWaitingForRelock) {
        console.warn(`Relock sequence timed out after ${timeoutDurationMs}ms.`);

        // --- Issue 3: Timeout Behavior ---
        // DO NOT re-lock here. The lock was left unlocked by writeLockState(false) below.

        // Cleanup
        if (this.#relockSequenceCallback) this.unregisterMagnetStateCallback(this.#relockSequenceCallback);
        this.#relockSequenceCallback = null;
        this.#isWaitingForRelock = false; // Reset the flag

        // Notify the caller about the timeout
        if (onExpired) {
          try {
            onExpired();
          } catch (error) {
            console.error("Error executing onExpired callback:", error);
          }
        }
      }
       this.#relockTimeout = null; // Clear timeout reference
    }, timeoutDurationMs);

    // 5. Unlock the solenoid ONLY AFTER setting up listener and timeout
    // This prevents race conditions where the state changes before the listener is ready.
    this.writeLockState(false); // Send unlock command

    console.log(`Unlock command sent. Waiting for open (magnet false) -> close (magnet true). Timeout in ${timeoutDurationMs}ms.`);
  }

  // Helper to get current magnet state if needed externally
  public getCurrentMagnetState(): boolean {
    return this.magnetState;
  }

  // Helper to check if waiting
  public isWaiting(): boolean {
      return this.#isWaitingForRelock;
  }
}

export default new GPIOService();