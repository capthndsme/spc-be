/**
 * @file    Arduino_Mega_MultiSensor_Bridge.ino
 * @author  Gemini AI
 * @brief   Restructured firmware for Arduino Mega to control multiple sensors and a SIM800L module.
 * @version 2.0
 * @date    2023-10-27
 *
 * @details This code manages:
 *  - 4 continuous rotation servos.
 *  - 4 HX711-based weight sensors.
 *  - 1 IR sensor.
 *  - 1 SIM800L GSM module for SMS communication.
 *
 * ARCHITECTURAL CHANGES (v2.0):
 * 1.  **Target Platform:** Migrated from Arduino Uno to Arduino Mega 2560.
 * 2.  **Multi-Sensor Support:** Expanded from 1 to 4 HX711 weight sensors.
 * 3.  **Hardware Serial:** SIM800L communication now uses `Serial1` on the Mega,
 *     eliminating the need for `SoftwareSerial` for improved stability and performance.
 * 4.  **Robust Command Parser:** Replaced the fragile `if/else if` chain with an
 *     unambiguous, verb-based command dispatcher to prevent parsing errors.
 * 5.  **Scalable Commands:** Commands like `TARE` and `CAL` now require a sensor index.
 * 6.  **Updated Data Format:** Sensor data is now sent as a JSON object with a `weights` array.
 *     {"infrared":123,"weights":[10.1, 20.2, 30.3, 40.4]}
 */

// --- LIBRARIES ---
#include <Servo.h>
#include <HX711_ADC.h>
#include <EEPROM.h>
// #include <SoftwareSerial.h> // No longer needed on Arduino Mega

// --- PIN DEFINITIONS ---

// Servo Pins (PWM-capable)
const int SERVO_1_PIN = 3;
const int SERVO_2_PIN = 5;
const int SERVO_3_PIN = 6;
const int SERVO_4_PIN = 9;

// IR Sensor Pin
const int IR_SENSOR_PIN = A0;

// NEW: HX711 Weight Sensor Pins (4 sensors)
// Using a logical block of digital pins on the Mega
const int HX711_1_DOUT_PIN = 22;
const int HX711_1_SCK_PIN  = 23;
const int HX711_2_DOUT_PIN = 24;
const int HX711_2_SCK_PIN  = 25;
const int HX711_3_DOUT_PIN = 26;
const int HX711_3_SCK_PIN  = 27;
const int HX711_4_DOUT_PIN = 28;
const int HX711_4_SCK_PIN  = 29;

// SIM800L Pins
// Using Hardware Serial1 (TX1=18, RX1=19) on the Mega, so no pin definitions needed for RX/TX
const int SIM800L_RESET_PIN = 4;

// --- CONSTANTS ---
const int NUM_SERVOS = 4;
const int NUM_SENSORS = 4;
const int CALIBRATION_EEPROM_ADDR_START = 0; // Start address for storing calibration values
const unsigned long SEND_INTERVAL = 1000;    // Send data every 1 second

// --- OBJECT INSTANTIATION ---

// Servo Objects
Servo servo1;
Servo servo2;
Servo servo3;
Servo servo4;

// NEW: Array of Load Cell objects
HX711_ADC loadCells[NUM_SENSORS] = {
  HX711_ADC(HX711_1_DOUT_PIN, HX711_1_SCK_PIN),
  HX711_ADC(HX711_2_DOUT_PIN, HX711_2_SCK_PIN),
  HX711_ADC(HX711_3_DOUT_PIN, HX711_3_SCK_PIN),
  HX711_ADC(HX711_4_DOUT_PIN, HX711_4_SCK_PIN)
};

// NEW: Use Hardware Serial1 for SIM800L for stability
#define sim800l Serial1

// --- GLOBAL VARIABLES ---
int servoPositions[NUM_SERVOS] = { 90, 90, 90, 90 }; // 90 = stop for continuous rotation
int irSensorValue = 0;

// NEW: Arrays to hold data for all 4 weight sensors
float weightValues[NUM_SENSORS] = { 0.0, 0.0, 0.0, 0.0 };
float calibrationValues[NUM_SENSORS] = { 104.0, 104.0, 104.0, 104.0 }; // Default values
boolean newWeightDataReady = false;

// Timing variables
unsigned long lastDataSent = 0;

// Function
/**
 * @brief Helper function to read and validate responses from the SIM800L.
 * @param timeout The maximum time to wait for a response in milliseconds.
 * @param expectedResponse A specific string to look for in the response.
 * @return True if the expected response is found (or any data if expected is empty), false on timeout or mismatch.
 */
bool readSimResponse(unsigned long timeout, String expectedResponse = "") {
  unsigned long startTime = millis();
  String response = "";
  while (millis() - startTime < timeout) {
    while (sim800l.available()) {
      char c = sim800l.read();
      response += c;
    }
    if (expectedResponse != "" && response.indexOf(expectedResponse) != -1) {
      // For debugging, print the full response that contained the expected string
      // Serial.println("\n---SIM800L Response---");
      // Serial.println(response);
      // Serial.println("----------------------");
      return true;
    }
  }
  // For debugging, print what was received on timeout
  // Serial.println("\n---SIM800L TIMEOUT---");
  // Serial.print("Expected: "); Serial.println(expectedResponse);
  // Serial.print("Received: "); Serial.println(response);
  // Serial.println("---------------------");
  return false;
}


// --- SETUP FUNCTION ---
void setup() {
  // Initialize serial communication for debugging and commands
  Serial.begin(9600);
  while (!Serial); // Wait for serial monitor to open
  Serial.println("Initializing Arduino Mega Multi-Sensor Command Bridge v2.0...");

  // --- Initialize SIM800L on Hardware Serial1 ---
  initializeSim800L();

  // --- Initialize Servos ---
  servo1.attach(SERVO_1_PIN);
  servo2.attach(SERVO_2_PIN);
  servo3.attach(SERVO_3_PIN);
  servo4.attach(SERVO_4_PIN);
  updateServos(); // Set initial positions

  // --- Initialize Weight Sensors ---
  initializeWeightSensors();

  Serial.println("\nArduino ready. Awaiting commands.");
}

// --- MAIN LOOP ---
void loop() {
  // Check for incoming commands from the Serial Monitor
  checkSerialCommands();

  // Update all weight sensors
  // The update() function should be called frequently
  for (int i = 0; i < NUM_SENSORS; i++) {
    if (loadCells[i].update()) {
      newWeightDataReady = true;
    }
  }

  // If new data is available, read it from all sensors
  if (newWeightDataReady) {
    for (int i = 0; i < NUM_SENSORS; i++) {
      weightValues[i] = loadCells[i].getData();
    }
    newWeightDataReady = false;
  }

  // Read other sensors
  irSensorValue = analogRead(IR_SENSOR_PIN);

  // Send all sensor data at a regular interval
  unsigned long currentTime = millis();
  if (currentTime - lastDataSent >= SEND_INTERVAL) {
    sendSensorData();
    lastDataSent = currentTime;
  }
}

// --- INITIALIZATION SUB-ROUTINES ---

void initializeSim800L() {
  Serial.println("Initializing SIM800L on Hardware Serial1...");
  pinMode(SIM800L_RESET_PIN, OUTPUT);

  // Perform a hardware reset on the SIM800L module
  digitalWrite(SIM800L_RESET_PIN, LOW);
  delay(1000);
  digitalWrite(SIM800L_RESET_PIN, HIGH);
  delay(6000); // Give module time to boot and connect to the network

  // Start communication with SIM800L
  sim800l.begin(9600);
  delay(1000);

  // Test AT command with retry to ensure module is responsive
  bool initialized = false;
  for (int i = 0; i < 5; i++) {
    sim800l.println("AT");
    if (readSimResponse(1000, "OK")) {
      initialized = true;
      break;
    }
    delay(500);
  }

  if (!initialized) {
    Serial.println("FATAL: SIM800L not responding. Check connections and power.");
    // In a real application, you might want to flash an LED or halt here.
  } else {
    Serial.println("SIM800L is responsive.");
    sim800l.println("ATE0"); // Turn off command echo
    readSimResponse(1000, "OK");
    
    sim800l.println("AT+CMGF=1"); // Set SMS mode to Text
    if (readSimResponse(1000, "OK")) {
      Serial.println("SIM800L configured for SMS text mode.");
    } else {
      Serial.println("WARNING: Could not set SMS text mode.");
    }
  }
}

void initializeWeightSensors() {
  Serial.println("Initializing weight sensors...");
  for (int i = 0; i < NUM_SENSORS; i++) {
    Serial.print("  Sensor "); Serial.print(i + 1); Serial.print(": ");
    loadCells[i].begin();

    // Load calibration value from EEPROM for this specific sensor
    // A float takes 4 bytes, so we offset the address for each sensor
    float storedCal;
    EEPROM.get(CALIBRATION_EEPROM_ADDR_START + (i * sizeof(float)), storedCal);

    // Sanity check the loaded value (modified to allow negative calibration for inverted sensors)
    if (storedCal != 0.0 && !isnan(storedCal) && abs(storedCal) > 10 && abs(storedCal) < 1000000) {
      calibrationValues[i] = storedCal;
      Serial.print("Using saved calibration ");
    } else {
      // Use the default value if EEPROM is invalid/empty
      Serial.print("Using default calibration ");
    }
    Serial.println(calibrationValues[i]);
    loadCells[i].setCalFactor(calibrationValues[i]);
  }

  // Tare all scales sequentially. This may take a few seconds.
  Serial.println("Taring all sensors...");
  unsigned long stabilizingTime = 2000;
  for (int i = 0; i < NUM_SENSORS; i++) {
    loadCells[i].start(stabilizingTime, true); // true = tare after stabilization
    if (loadCells[i].getTareTimeoutFlag()) {
      Serial.print("WARNING: Tare timeout on sensor "); Serial.println(i + 1);
    } else {
      Serial.print("Sensor "); Serial.print(i + 1); Serial.println(" tare complete.");
    }
  }
}


// --- COMMAND HANDLING ---

/**
 * @brief NEW: Robustly parses and handles incoming serial commands.
 * This function first isolates the command "verb" (e.g., "S", "TARE", "TXT")
 * and then dispatches to the correct handler, avoiding ambiguity.
 */
void checkSerialCommands() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    Serial.print("Received command: ");
    Serial.println(command);

    // Isolate the command verb from its arguments
    int firstColon = command.indexOf(':');
    String verb;
    String args;

    if (firstColon != -1) {
      verb = command.substring(0, firstColon);
      args = command.substring(firstColon + 1);
    } else {
      verb = command; // Command has no arguments
      args = "";
    }
    verb.toUpperCase(); // Make command case-insensitive

    // --- Command Dispatch based on the isolated verb ---

    if (verb == "S") { // Servo Command: S:<num>:<pos>
      int secondColon = args.indexOf(':');
      if (secondColon != -1) {
        int servoIndex = args.substring(0, secondColon).toInt();
        int position = args.substring(secondColon + 1).toInt();
        if (servoIndex >= 1 && servoIndex <= NUM_SERVOS && position >= 0 && position <= 180) {
          servoPositions[servoIndex - 1] = position;
          updateServos();
          Serial.println("ACK:S:" + String(servoIndex) + ":" + String(position));
        } else {
          Serial.println("ERR: Invalid servo index or position");
        }
      } else {
        Serial.println("ERR: Invalid servo command format. Use S:<num>:<pos>");
      }
    }
    else if (verb == "TARE") { // Tare Command: TARE:<index> or TARE:ALL
      args.toUpperCase();
      if (args == "ALL") {
        for (int i = 0; i < NUM_SENSORS; i++) {
          loadCells[i].tareNoDelay();
        }
        Serial.println("ACK:TARE:ALL");
      } else {
        int sensorIndex = args.toInt();
        if (sensorIndex >= 1 && sensorIndex <= NUM_SENSORS) {
          loadCells[sensorIndex - 1].tareNoDelay();
          Serial.println("ACK:TARE:" + String(sensorIndex));
        } else {
          Serial.println("ERR: Invalid sensor index for TARE");
        }
      }
    }
    else if (verb == "CAL") { // Calibration Command: CAL:<index>:<value>
      int secondColon = args.indexOf(':');
      if (secondColon != -1) {
        int sensorIndex = args.substring(0, secondColon).toInt();
        float newCalValue = args.substring(secondColon + 1).toFloat();
        if (sensorIndex >= 1 && sensorIndex <= NUM_SENSORS && newCalValue != 0.0) {
          calibrationValues[sensorIndex - 1] = newCalValue;
          loadCells[sensorIndex - 1].setCalFactor(newCalValue);
          EEPROM.put(CALIBRATION_EEPROM_ADDR_START + ((sensorIndex - 1) * sizeof(float)), newCalValue);
          Serial.println("ACK:CAL:" + String(sensorIndex) + ":" + String(newCalValue, 4));
        } else {
          Serial.println("ERR: Invalid sensor index or calibration value");
        }
      } else {
        Serial.println("ERR: Invalid CAL command format. Use CAL:<index>:<value>");
      }
    }
    else if (verb == "GETCAL") { // Get Calibration Command: GETCAL:<index>
      int sensorIndex = args.toInt();
      if (sensorIndex >= 1 && sensorIndex <= NUM_SENSORS) {
        float calVal = calibrationValues[sensorIndex - 1];
        Serial.println("CAL:" + String(sensorIndex) + ":" + String(calVal, 4));
      } else {
        Serial.println("ERR: Invalid sensor index for GETCAL");
      }
    }
    else if (verb == "TXT") { // SMS Command: TXT:<phone>:<message>
      int secondColon = args.indexOf(':');
      if (secondColon != -1) {
        String phoneNumber = args.substring(0, secondColon);
        String message = args.substring(secondColon + 1);
        if (phoneNumber.length() > 0 && message.length() > 0) {
          Serial.print("ACK:TXT:Sending to " + phoneNumber + "...");
          if (sendSMS(phoneNumber, message)) {
            Serial.println("SMS sent successfully.");
          } else {
            Serial.println("SMS send failed.");
          }
        } else {
          Serial.println("ERR: Invalid phone number or message");
        }
      } else {
        Serial.println("ERR: Invalid TXT command format. Use TXT:<phone>:<message>");
      }
    }
    else {
      Serial.println("ERR: Unknown command verb");
    }
  }
}


// --- HELPER FUNCTIONS ---

// Update all servos with current position values
void updateServos() {
  servo1.write(servoPositions[0]);
  servo2.write(servoPositions[1]);
  servo3.write(servoPositions[2]);
  servo4.write(servoPositions[3]);
}

/**
 * @brief NEW: Send all sensor data as JSON with a 'weights' array.
 * Format: {"infrared":<val>,"weights":[<w1>,<w2>,<w3>,<w4>]}
 */
void sendSensorData() {
  Serial.print("{\"infrared\":");
  Serial.print(irSensorValue);
  Serial.print(",\"weights\":[");
  for (int i = 0; i < NUM_SENSORS; i++) {
    Serial.print(weightValues[i], 2); // Print weight with 2 decimal places
    if (i < NUM_SENSORS - 1) {
      Serial.print(","); // Add comma between values
    }
  }
  Serial.println("]}");
}

/**
 * @brief Helper function to send an SMS via the SIM800L module.
 * @param phoneNumber The destination phone number in international format.
 * @param message The text message content.
 * @return True if the message was sent successfully, false otherwise.
 */
bool sendSMS(String phoneNumber, String message) {
  sim800l.print("AT+CMGS=\"");
  sim800l.print(phoneNumber);
  sim800l.println("\"");

  if (!readSimResponse(2000, ">")) {
    Serial.println("ERROR: SIM800L did not respond with '>' prompt");
    sim800l.write(27); // ESC character to cancel
    return false;
  }

  sim800l.print(message);
  delay(200);
  sim800l.write(26); // Ctrl+Z to send

  // Wait for "+CMGS:" response, which indicates success.
  return readSimResponse(10000, "+CMGS:");
}

