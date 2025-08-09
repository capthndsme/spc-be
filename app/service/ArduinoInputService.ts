import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import env from '#start/env';
import { exec } from 'child_process';

// --- Types ---
type SensorData = {
  infrared: number;
  /** An array of 4 weight sensor floats */
  weights: number[];
};

type SensorDataCallback = (data: SensorData) => void;

// Interface for items in the SMS queue
interface SmsJob {
  phoneNumber: string;
  message: string;
  resolve: (value: string) => void; // Function to call on success
  reject: (reason?: any) => void;   // Function to call on failure/timeout
}

// --- Constants ---
const SMS_SEND_TIMEOUT_MS = 30000; // 30 seconds timeout for SMS sending

// --- Class Definition ---
class ArduinoInputBridge extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private isConnected: boolean = false;
  private isMockMode: boolean = false;
  private lastSensorData: SensorData = { infrared: 0, weights: [0, 0, 0, 0] };
  private servoPositions: number[] = [90, 90, 90, 90];
  private mockTimer: NodeJS.Timeout | null = null;
  private callbacks: SensorDataCallback[] = [];

  pingReady = false;

  // --- SMS Queue related properties ---
  private smsQueue: SmsJob[] = [];
  private isSendingSms: boolean = false;
  private currentSmsJob: SmsJob | null = null;
  private smsTimeoutTimer: NodeJS.Timeout | null = null;
  private smsReady = false
  // ---

  constructor() {
    super();
    this.changePermission(() => {
      if (!env.get('IS_PI', false)) { // Optional: Add env var to force mock
        console.log('Forcing mock mode via environment variable.');
        this.enterMockMode();
        return;
      }
      try {
        this.port = new SerialPort({
          path: env.get('SERIAL_PATH'),
          baudRate: env.get('BAUD_RATE')
        });
        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        this.setupRealListeners();
      } catch (error) {
        console.warn(`Serial port ${env.get('SERIAL_PATH')} not available or error during init. Entering mock mode. Error:`, error);
        this.enterMockMode();
      }
    });


  }

  registerCallback(callback: SensorDataCallback): void {
    this.callbacks.push(callback);
  }

  unregisterCallback(callback: SensorDataCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  private notifyCallbacks(data: SensorData): void {
    this.callbacks.filter(e => typeof e === 'function').forEach(callback => callback(data));
  }


  private changePermission(call?: () => void) {
    const serialPath = env.get('SERIAL_PATH');
    console.log(`Attempting to set permissions for ${serialPath}...`);
    try {
      exec(`sudo chmod 666 ${serialPath}`, (error, stdout, stderr) => {
        if (error) {
          // Don't treat permission error as fatal, maybe it's already correct
          console.warn(`chmod warning (may be non-fatal): ${error.message}`);
          if (stderr) {
            console.warn(`chmod stderr: ${stderr}`);
          }
        } else {
          console.log(`Permissions set for ${serialPath}`);
          if (stdout) {
            console.log(`chmod stdout: ${stdout}`);
          }
        }
        call?.(); // Proceed regardless of chmod outcome
      });
    } catch (e) {
      console.warn(`Error executing chmod:`, e);
      call?.(); // Proceed if chmod command itself fails
    }
  }

  private setupRealListeners(): void {
    if (!this.port || !this.parser) return;

    this.port.on('open', () => {
      console.log('Serial connection established');
      this.isConnected = true;
      this.isMockMode = false;
      // Reset SMS state on connect
      this.isSendingSms = false;
      if (this.smsTimeoutTimer) clearTimeout(this.smsTimeoutTimer);
      this.smsTimeoutTimer = null;
      this.currentSmsJob = null;
      // Reject any jobs that might have been stuck in the queue from a previous session (optional)
      // this.smsQueue.forEach(job => job.reject('Connection re-established before sending.'));
      // this.smsQueue = [];
      this.emit('connected', { real: true });
      this._processSmsQueue(); // Try processing queue in case jobs were added before connection open
    });

    this.port.on('error', (err) => {
      console.error('Serial port error:', err.message);
      // Reject current SMS job if one was in progress
      if (this.currentSmsJob) {
        this.currentSmsJob.reject(`Serial port error: ${err.message}`);
        this._clearCurrentSmsState();
      }
      if (!this.isConnected) {
        console.log('Falling back to mock mode due to error');
        this.enterMockMode();
      } else {
        this.isConnected = false; // Mark as disconnected
        this.emit('error', err);
        // Don't automatically enter mock mode if it was previously connected
      }
    });

    this.port.on('close', () => {
      console.log('Serial connection closed');
      const wasConnected = this.isConnected;
      this.isConnected = false;

      // Reject current SMS job and clear state
      if (this.currentSmsJob) {
        this.currentSmsJob.reject('Serial connection closed during sending.');
        this._clearCurrentSmsState();
      }
      // Optionally reject all queued jobs
      // this.smsQueue.forEach(job => job.reject('Serial connection closed before sending.'));
      // this.smsQueue = [];

      this.emit('disconnected');

      if (wasConnected && !this.isMockMode) { // Only attempt reconnect if it was genuinely connected
        console.log('Attempting to reconnect...');
        // Implement reconnection logic here if needed, or rely on external process manager
        setTimeout(() => {
          if (!this.isConnected) { // Check again in case it reconnected quickly
            console.warn(`Failed to reconnect to serial port ${env.get('SERIAL_PATH')}. Exiting or relying on process manager.`);
            process.exit(1); // Or handle more gracefully
          }
        }, 5000); // Example reconnect attempt delay
      }
    });

    this.parser.on('data', (data: string) => {
      const trimmedData = data.trim();
      console.log('Arduino Raw:', trimmedData); // Log raw data for debugging
      if (trimmedData.toLowerCase().includes("arduino ready")) {
        this.pingReady = true;
        
      }
      // --- SMS Response Handling ---
      if (this.isSendingSms && this.currentSmsJob) {
        // Check for specific success/failure strings from *your* Arduino code
        if (trimmedData.includes("SMS sent successfully")) {
          console.log('SMS success confirmed by Arduino.');
          if (this.smsTimeoutTimer) clearTimeout(this.smsTimeoutTimer);
          this.currentSmsJob.resolve(`SMS sent successfully to ${this.currentSmsJob.phoneNumber}`);
          this._clearCurrentSmsState();
          this._processSmsQueue(); // Process next item
          return; // Don't process as JSON
        } else if (trimmedData.includes("SMS send failed") || trimmedData.includes("ERROR: Failed to send SMS")) {
          console.error('SMS failure confirmed by Arduino.');
          if (this.smsTimeoutTimer) clearTimeout(this.smsTimeoutTimer);
          this.currentSmsJob.reject(new Error(`Arduino reported SMS send failed for ${this.currentSmsJob.phoneNumber}. Response: ${trimmedData}`));
          this._clearCurrentSmsState();
          this._processSmsQueue(); // Process next item
          return; // Don't process as JSON
        }
        // NOTE: You might also want to check for low-level SIM800L errors if your Arduino code doesn't explicitly print "SMS send failed" for all cases.
      }
      // --- End SMS Response Handling ---


      // --- Sensor Data Handling ---
      try {
        // Attempt to parse as JSON only if it looks like JSON
        if (trimmedData.startsWith('{') && trimmedData.endsWith('}')) {
          const parsedData: SensorData = JSON.parse(trimmedData);
          // Basic validation
          if (typeof parsedData.infrared === 'number' && Array.isArray(parsedData.weights) && parsedData.weights.every(w => typeof w === 'number')) {
            this.lastSensorData = parsedData;
            // console.log('Received sensor data:', parsedData); // Reduce noise, log raw above
            this.emit('sensorData', parsedData);
            this.notifyCallbacks(parsedData);
          } else {
            console.warn('Parsed JSON data missing expected fields:', trimmedData);
          }

        } else {
          // Log other non-JSON, non-SMS responses if needed for debugging
          if (!trimmedData.startsWith("ACK:") && // Ignore simple acknowledgements
            !trimmedData.startsWith("ERR:") &&
            !trimmedData.startsWith("Sending SMS to:") && // Ignore our own debug msgs
            !trimmedData.includes("AT+") && // Ignore AT command echoes
            !trimmedData.includes(">") && // Ignore SMS prompt
            trimmedData !== "OK" &&
            trimmedData.length > 0) // Ignore empty lines
          {
            console.log('Arduino Info:', trimmedData);
            const isSMSreadyReceived = trimmedData.includes('initialized in SMS text mode');


            if (isSMSreadyReceived) {
              this.smsReady = true;
 
            }


          }
        }
      } catch (error) {
        // Only log parse error if it looked like JSON initially
        if (trimmedData.startsWith('{') && trimmedData.endsWith('}')) {
          console.error('Error parsing JSON data:', trimmedData, error);
        }
        // Otherwise, it was likely an info message already logged or handled.
      }
      // --- End Sensor Data Handling ---
    });
  }

  private enterMockMode(): void {
    if (this.isMockMode) return; // Already in mock mode

    console.log('Entering mock mode.');
    this.isMockMode = true;
    this.isConnected = true; // Mock mode implies a 'virtual' connection

    // Reject any pending real jobs
    if (this.currentSmsJob) {
      this.currentSmsJob.reject('Entering mock mode while SMS was pending.');
      this._clearCurrentSmsState();
    }
    this.smsQueue.forEach(job => job.reject('Entering mock mode before sending.'));
    this.smsQueue = [];


    // Start generating mock sensor data
    if (!this.mockTimer) { // Avoid multiple timers
      this.mockTimer = setInterval(() => {
        this.lastSensorData = {
          infrared: Math.floor(Math.random() * 1024),
          weights: [
            Math.random() * 2000,
            Math.random() * 2000,
            Math.random() * 2000,
            Math.random() * 2000,
          ]
        };
        // console.log('Mock sensor data:', this.lastSensorData);
        this.emit('sensorData', this.lastSensorData);
        this.notifyCallbacks(this.lastSensorData);
      }, 1000);
    }

    this.emit('connected', { real: false, mock: true });
  }

  /**
   * Sends an SMS message via the Arduino.
   * Queues the message if another SMS is already in progress.
   * @param phoneNumber The destination phone number (e.g., +1234567890)
   * @param message The text message content
   * @returns A Promise that resolves on successful confirmation from Arduino, or rejects on failure/timeout.
   */
  public sendSms(phoneNumber: string, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isMockMode) {
        console.log(`Mock SMS: To=${phoneNumber}, Msg=${message}`);
        // Simulate success after a short delay
        setTimeout(() => resolve(`Mock SMS sent successfully to ${phoneNumber}`), 500);
        return;
      }

      if (!this.isConnected || !this.port || !this.smsReady) {
        console.error('Cannot send SMS: Not connected to Arduino, or sms not ready.');
        reject(new Error('Not connected to Arduino'));
        return;
      }

      if (!phoneNumber || !message) {
        reject(new Error('Phone number and message cannot be empty.'));
        return;
      }

      // Basic validation (adjust regex as needed for international numbers)
      if (!/^\+?\d{10,}$/.test(phoneNumber)) {
        reject(new Error(`Invalid phone number format: ${phoneNumber}`));
        return;
      }


      const job: SmsJob = { phoneNumber, message, resolve, reject };
      this.smsQueue.push(job);
      console.log(`SMS queued for ${phoneNumber}. Queue size: ${this.smsQueue.length}`);

      // Trigger processing immediately if nothing is currently sending
      this._processSmsQueue();
    });
  }

  /** 
   * Tares a specific scale or all scales.
   * @param sensor The sensor index (1-4) or 'ALL'.
   * @returns A promise that resolves on success or rejects on failure/timeout.
  */
  async tare(sensor: number | 'ALL'): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isMockMode) {
        console.log(`Mock TARE for sensor: ${sensor}`);
        setTimeout(() => resolve(`Mock TARE success for ${sensor}`), 500);
        return;
      }

      if (!this.isConnected || !this.port) {
        console.error('Cannot TARE: Not connected to Arduino.');
        reject(new Error('Not connected to Arduino'));
        return;
      }

      if (typeof sensor !== 'string' && (sensor < 1 || sensor > 4)) {
        reject(new Error('Sensor index must be between 1 and 4 or "ALL".'));
        return;
      }

      const command = `TARE:${sensor}\n`;
      this.port?.write(command, (err) => {
        if (err) {
          console.error('Error writing TARE command to serial port:', err.message);
          reject(err);
        } else {
          console.log(`Command "${command.trim()}" sent to Arduino.`);
          const timeout = setTimeout(() => {
            this.parser?.removeListener('data', listener);
            reject(new Error(`Arduino did not acknowledge TARE for ${sensor} within 5s.`));
          }, 5000);

          const listener = (data: string) => {
            const trimmedData = data.trim();
            const expectedAck = `ACK:TARE:${sensor}`;
            if (trimmedData.includes(expectedAck)) {
              console.log(`TARE success for ${sensor} confirmed by Arduino.`);
              clearTimeout(timeout);
              this.parser?.removeListener('data', listener);
              resolve(`TARE success for ${sensor}`);
            }
          };
          this.parser?.on('data', listener);
        }
      });
    })


  }
  /**
   * Sets the calibration factor for a specific sensor.
   * @param sensorIndex The sensor index (1-4).
   * @param value The calibration value (float).
   * @returns A promise that resolves on success.
   */
  async setCalibration(sensorIndex: number, value: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isMockMode) {
        console.log(`Mock CAL: Sensor ${sensorIndex} to ${value}`);
        setTimeout(() => resolve(`Mock CAL success for sensor ${sensorIndex}`), 500);
        return;
      }

      if (!this.isConnected || !this.port) {
        console.error('Cannot CAL: Not connected to Arduino.');
        reject(new Error('Not connected to Arduino'));
        return;
      }

      if (sensorIndex < 1 || sensorIndex > 4) {
        reject(new Error('Sensor index must be between 1 and 4.'));
        return;
      }

      const command = `CAL:${sensorIndex}:${value}\n`;
      this.port?.write(command, (err) => {
        if (err) {
          console.error('Error writing CAL command to serial port:', err.message);
          reject(err);
        } else {
          console.log(`Command "${command.trim()}" sent to Arduino.`);
          const timeout = setTimeout(() => {
            this.parser?.removeListener('data', listener);
            reject(new Error('Arduino did not acknowledge CAL within 5s.'));
          }, 5000);

          const listener = (data: string) => {
            const trimmedData = data.trim();
            if (trimmedData.includes(`ACK:CAL:${sensorIndex}`)) {
              console.log(`CAL success for sensor ${sensorIndex} confirmed by Arduino.`);
              clearTimeout(timeout);
              this.parser?.removeListener('data', listener);
              resolve(`CAL success for sensor ${sensorIndex}`);
            }
          };
          this.parser?.on('data', listener);
        }
      });
    });
  }

  /**
   * Gets the calibration factor for a specific sensor.
   * @param sensorIndex The sensor index (1-4).
   * @returns A promise that resolves with the calibration value.
   */
  async getCalibration(sensorIndex: number): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.isMockMode) {
        const mockValue = 123.45;
        console.log(`Mock GETCAL: Sensor ${sensorIndex}, returning ${mockValue}`);
        setTimeout(() => resolve(mockValue), 500);
        return;
      }

      if (!this.isConnected || !this.port) {
        console.error('Cannot GETCAL: Not connected to Arduino.');
        reject(new Error('Not connected to Arduino'));
        return;
      }

      if (sensorIndex < 1 || sensorIndex > 4) {
        reject(new Error('Sensor index must be between 1 and 4.'));
        return;
      }

      const command = `GETCAL:${sensorIndex}\n`;
      this.port?.write(command, (err) => {
        if (err) {
          console.error('Error writing GETCAL command to serial port:', err.message);
          reject(err);
        } else {
          console.log(`Command "${command.trim()}" sent to Arduino.`);
          const timeout = setTimeout(() => {
            this.parser?.removeListener('data', listener);
            reject(new Error('Arduino did not respond to GETCAL within 5s.'));
          }, 5000);

          const listener = (data: string) => {
            const trimmedData = data.trim();
            // Assuming response format is "GETCAL:1:123.45"
            const prefix = `GETCAL:${sensorIndex}:`;
            if (trimmedData.startsWith(prefix)) {
              const valueStr = trimmedData.substring(prefix.length);
              const value = parseFloat(valueStr);
              if (!isNaN(value)) {
                console.log(`GETCAL success for sensor ${sensorIndex}, value: ${value}`);
                clearTimeout(timeout);
                this.parser?.removeListener('data', listener);
                resolve(value);
              } else {
                // Don't reject, wait for timeout in case of fragmented message
                console.error(`Failed to parse GETCAL response: ${trimmedData}`);
              }
            }
          };
          this.parser?.on('data', listener);
        }
      });
    });
  }

  // --- Private helper to process the SMS queue ---
  private _processSmsQueue(): void {
    // Don't process if in mock mode, already sending, not connected, or queue is empty
    if (this.isMockMode || this.isSendingSms || !this.isConnected || this.smsQueue.length === 0) {
      return;
    }

    this.isSendingSms = true;
    this.currentSmsJob = this.smsQueue.shift()!; // Dequeue the next job (non-null asserted as we checked length > 0)

    console.log(`Sending SMS to ${this.currentSmsJob.phoneNumber}...`);

    const command = `TXT:${this.currentSmsJob.phoneNumber}:${this.currentSmsJob.message}\n`;

    // Start a timeout timer
    this.smsTimeoutTimer = setTimeout(() => {
      console.error(`SMS timeout for ${this.currentSmsJob?.phoneNumber}. Arduino did not confirm within ${SMS_SEND_TIMEOUT_MS}ms.`);
      // It's possible the Arduino *did* send it but the confirmation was lost/delayed.
      // We assume failure from the Node.js perspective.
      this.currentSmsJob?.reject(new Error(`SMS send timeout (${SMS_SEND_TIMEOUT_MS}ms)`));
      this._clearCurrentSmsState();
      // Try processing the next item after a timeout
      this._processSmsQueue();
    }, SMS_SEND_TIMEOUT_MS);

    // Send command to Arduino
    this.port?.write(command, (err) => {
      if (err) {
        console.error(`Error writing SMS command to serial port for ${this.currentSmsJob?.phoneNumber}:`, err.message);
        if (this.smsTimeoutTimer) clearTimeout(this.smsTimeoutTimer);
        this.currentSmsJob?.reject(new Error(`Serial write error: ${err.message}`));
        this._clearCurrentSmsState();
        // Don't automatically requeue, the write failed.
        // Process the next item if any.
        this._processSmsQueue();
      } else {
        console.log(`Command "${command.trim()}" sent to Arduino.`);
      }
    });
  }

  // --- Private helper to clean up SMS state ---
  private _clearCurrentSmsState(): void {
    this.isSendingSms = false;
    this.currentSmsJob = null;
    if (this.smsTimeoutTimer) {
      clearTimeout(this.smsTimeoutTimer);
      this.smsTimeoutTimer = null;
    }
  }

  // --- Existing methods (setServoSpeed, etc.) ---

  public setServoSpeed(servoIndex: number, speed: number): boolean {
    // (Keep existing implementation, but add connection check)
    if (!this.isConnected) {
      console.error('Cannot set servo speed: Not connected.');
      return false;
    }
    if (this.isMockMode) {
      // ... (keep mock logic) ...
      const clampedSpeed = Math.max(-100, Math.min(100, speed));
      const servoValue = Math.round(90 + (clampedSpeed * 0.9));
      console.log(`Mock: Setting servo ${servoIndex} to speed ${clampedSpeed} (value: ${servoValue})`);
      return true;
    }

    if (servoIndex < 1 || servoIndex > 4) { /* ... error ... */ return false; }
    const clampedSpeed = Math.max(-100, Math.min(100, speed));
    const servoValue = Math.round(90 + (clampedSpeed * 0.9));
    this.servoPositions[servoIndex - 1] = servoValue;

    const command = `S:${servoIndex}:${servoValue}\n`;
    this.port?.write(command, (err) => {
      if (err) {
        console.error('Error writing servo command to serial port:', err.message);
        // Note: This doesn't return false synchronously, maybe emit an error?
      }
    });
    return true; // Command sent (write is async)
  }

  public setAllServoSpeeds(speeds: number[]): boolean {
    // (Keep existing implementation)
    if (speeds.length !== 4) { /* ... error ... */ return false; }
    let success = true;
    for (let i = 0; i < 4; i++) {
      const result = this.setServoSpeed(i + 1, speeds[i]);
      success = success && result;
    }
    return success;
  }

  public getSensorData(): SensorData {
    return { ...this.lastSensorData };
  }

  public getMode(): string {
    return this.isMockMode ? 'mock' : (this.isConnected ? 'real' : 'disconnected');
  }

  public forceMockMode(): void {
    if (this.isMockMode) {
      console.log('Already in mock mode');
      return;
    }
    console.log('Forcing mock mode...');
    this.close().then(() => {
      this.enterMockMode();
    }).catch(err => {
      console.error('Error closing connection before forcing mock mode:', err);
      // Attempt to enter mock mode anyway
      this.enterMockMode();
    });
  }


  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("Closing Arduino Bridge connection...");
      if (this.mockTimer) {
        clearInterval(this.mockTimer);
        this.mockTimer = null;
      }

      // Reject pending/current SMS jobs on close
      if (this.currentSmsJob) {
        this.currentSmsJob.reject('Connection closed by application.');
        this._clearCurrentSmsState();
      }
      this.smsQueue.forEach(job => job.reject('Connection closed by application before sending.'));
      this.smsQueue = [];


      if (!this.port || !this.port.isOpen || this.isMockMode) {
        console.log("Port already closed or in mock mode.");
        this.isConnected = false;
        this.isMockMode = false; // Ensure mock mode is off if we are explicitly closing
        resolve();
        return;
      }

      // Important: Remove listeners before closing to prevent errors/reconnect attempts
      this.port.removeAllListeners();
      this.parser?.removeAllListeners();


      this.port.close((err) => {
        if (err) {
          console.error("Error closing serial port:", err.message);
          reject(err);
        } else {
          console.log("Serial port closed successfully.");
          this.isConnected = false;
          this.port = null;
          this.parser = null;
          resolve();
        }
      });
    });
  }
}

// Export the singleton instance
export default new ArduinoInputBridge();
