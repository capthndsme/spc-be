import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import env from '#start/env';

type SensorData = {
  infrared: number;
  /** Float */
  weight: number 
};

type SensorDataCallback = (data: SensorData) => void;



class ArduinoInputBridge extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private isConnected: boolean = false;
  private isMockMode: boolean = false;
  private lastSensorData: SensorData = { infrared: 0, weight: 0 };
  private servoPositions: number[] = [90, 90, 90, 90]; // Default servo positions
  private mockTimer: NodeJS.Timeout | null = null;
  private callbacks: SensorDataCallback[] = [];

  registerCallback(callback: SensorDataCallback): void {
    this.callbacks.push(callback);
  }

  unregisterCallback(callback: SensorDataCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  notifyCallbacks(data: SensorData): void {
    // can't be too sure
    this.callbacks.filter(e => typeof e === 'function').forEach(callback => callback(data))
  }

 



  constructor() {
    super();

    try {
      this.port = new SerialPort({
        path: env.get('SERIAL_PATH'),
        baudRate: env.get('BAUD_RATE')
      });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
      this.setupRealListeners();
    } catch (error) {
      console.warn(`Serial port ${env.get('SERIAL_PATH')} not available. Entering mock mode.`);
      this.enterMockMode();
    }
  }

  private setupRealListeners(): void {
    if (!this.port || !this.parser) return;

    this.port.on('open', () => {
      console.log('Serial connection established');
      this.isConnected = true;
      this.isMockMode = false;
      this.emit('connected', { real: true });
    });

    this.port.on('error', (err) => {
      console.error('Serial port error:', err.message);
      if (!this.isConnected) {
        console.log('Falling back to mock mode');
        this.enterMockMode();
      } else {
        this.isConnected = false;
        this.emit('error', err);
      }
    });

    this.port.on('close', () => {
      console.log('Serial connection closed');
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.parser.on('data', (data: string) => {
      try {
        const parsedData = JSON.parse(data.trim());
        this.lastSensorData = parsedData;
        console.log('Received sensor data:', parsedData);
        this.emit('sensorData', parsedData);
        this.notifyCallbacks(parsedData);
      } catch (error) {
        console.error('Error parsing data:', error);
      }
    });
  }

  private enterMockMode(): void {
    this.isMockMode = true;
    this.isConnected = true;
    console.log('Running in mock mode. Sensor data will be simulated.');

    // Start generating mock sensor data
    this.mockTimer = setInterval(() => {
      // Generate random sensor data
      this.lastSensorData = {
        infrared: Math.floor(Math.random() * 1024),// Random value between 0-1023,
        // Grams: 0g - 20kg (20000)
        weight: Math.floor(Math.random() * 20000) // Random value between 0-20000

      };

      console.log('Mock sensor data:', this.lastSensorData);
      this.emit('sensorData', this.lastSensorData);
      this.notifyCallbacks(this.lastSensorData);
    }, 1000);

    this.emit('connected', { real: false, mock: true });
  }

  /**
   * Set position for a specific servo motor
   * @param servoIndex - Servo number (1-4)
   * @param speed - Speed for continuous rotation servo (-100 to 100)
   */
  public setServoSpeed(servoIndex: number, speed: number): boolean {
    if (!this.isConnected) {
      console.error('Not connected to Arduino and mock mode not active');
      return false;
    }

    if (servoIndex < 1 || servoIndex > 4) {
      console.error('Invalid servo index. Must be 1-4');
      return false;
    }

    // Clamp speed between -100 and 100
    const clampedSpeed = Math.max(-100, Math.min(100, speed));

    // Map speed to servo value (for continuous rotation servos)
    // -100 -> 0, 0 -> 90 (stop), 100 -> 180
    const servoValue = Math.round(90 + (clampedSpeed * 0.9));

    this.servoPositions[servoIndex - 1] = servoValue;

    if (this.isMockMode) {
      console.log(`Mock: Setting servo ${servoIndex} to speed ${clampedSpeed} (value: ${servoValue})`);
      return true;
    }

    // Send command to Arduino
    const command = `S${servoIndex}:${servoValue}\n`;
    this.port?.write(command, (err) => {
      if (err) {
        console.error('Error writing to serial port:', err.message);
        return false;
      }
    });

    return true;
  }

  /**
   * Set speed for multiple servos at once
   * @param speeds - Array of speeds for servos 1-4 (-100 to 100)
   */
  public setAllServoSpeeds(speeds: number[]): boolean {
    if (speeds.length !== 4) {
      console.error('Must provide exactly 4 speed values');
      return false;
    }

    let success = true;
    for (let i = 0; i < 4; i++) {
      const result = this.setServoSpeed(i + 1, speeds[i]);
      success = success && result;
    }

    return success;
  }

  /**
   * Get the latest sensor data
   */
  public getSensorData(): SensorData {
    return { ...this.lastSensorData };
  }

  /**
   * Get current mode (real or mock)
   */
  public getMode(): string {
    return this.isMockMode ? 'mock' : 'real';
  }

  /**
   * Force mock mode even if a port was available
   */
  public forceMockMode(): void {
    if (this.isMockMode) {
      console.log('Already in mock mode');
      return;
    }

    // Close the real connection if it exists
    this.close().then(() => {
      this.enterMockMode();
    }).catch(err => {
      console.error('Error closing connection before entering mock mode:', err);
      this.enterMockMode();
    });
  }

  /**
   * Close the serial connection
   */
  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.mockTimer) {
        clearInterval(this.mockTimer);
        this.mockTimer = null;
      }

      if (!this.port || this.isMockMode) {
        this.isConnected = false;
        this.isMockMode = false;
        resolve();
        return;
      }

      this.port.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.isConnected = false;
          resolve();
        }
      });
    });
  }
}



// Uncomment to run the example
// main().catch(console.error);

// Export the class for use in other modules
export default new ArduinoInputBridge();