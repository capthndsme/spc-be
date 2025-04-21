import env from "#start/env";
import { exec } from "child_process";
import { SerialPort } from "serialport";
import { ReadlineParser } from '@serialport/parser-readline';
import { sleep } from "../utils.js"; // Assuming you have a sleep function like: export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Configuration ---
const SERIAL_PORT_PATH = env.get('SERIAL_PATH_SMS', '/dev/ttyUSB1'); // Use your actual path or env var
const BAUD_RATE = 9600;
const RECONNECT_DELAY_MS = 5000;
const COMMAND_TIMEOUT_MS = 10000; // Default timeout for most commands
const SMS_SEND_TIMEOUT_MS = 30000; // Longer timeout for the whole send operation including content

class SIM800LService {
    #port: SerialPort | null = null;
    #parser: ReadlineParser | null = null;
    #ready = false; // Port open state
    #isConnecting = false;
    #isReconnecting = false;
    #initialAtOk = false; // Track if the initial 'AT' command succeeded

    // --- Command Queue (for individual AT commands) ---
    #commandQueue: {
        command: string;
        expectedResponse: string | RegExp;
        timeout: number;
        resolve: (value: string) => void;
        reject: (reason?: any) => void;
        timer?: NodeJS.Timeout;
    }[] = [];

    #currentCommand: {
        command: string;
        expectedResponse: string | RegExp;
        timeout: number;
        resolve: (value: string) => void;
        reject: (reason?: any) => void;
        timer?: NodeJS.Timeout;
    } | null = null;

    // --- Message Sending Lock and Queue ---
    #isSendingMessage = false;
    #messageQueue: {
        content: string;
        number: string;
        resolve: (value: boolean) => void;
        reject: (reason?: any) => void;
    }[] = [];

    #dataBuffer = ''; // Buffer for accumulating response lines if needed

    constructor() {
        console.log("SIM800L Service: Initializing...");
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            // Set permissions - Consider doing this outside the script long-term
            await this.changePermission();
            console.log("SIM800L Service: Permissions checked/set.");
        } catch (error) {
            console.warn("SIM800L Service: Failed to set permissions (continuing attempt):", error);
        } finally {
            console.log("SIM800L Service: Attempting initial connection.");
            this.connect(); // Start connection process
        }
    }

    // Consider alternative permission methods (udev rules, add user to dialout group)
    private changePermission(): Promise<void> {
        return new Promise((resolve) => {
            const command = `sudo chmod 666 ${SERIAL_PORT_PATH}`;
            console.log(`SIM800L Service: Attempting to execute: ${command}`);
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`SIM800L Service: chmod error: ${error.message}`);
                    // Resolve anyway, maybe permissions are already okay
                    // Consider rejecting if permissions are absolutely mandatory: reject(error);
                    resolve();
                    return;
                }
                if (stderr) {
                    console.warn(`SIM800L Service: chmod stderr: ${stderr}`);
                }
                if (stdout) {
                    console.log(`SIM800L Service: chmod stdout: ${stdout}`);
                }
                console.log(`SIM800L Service: Permissions potentially updated for ${SERIAL_PORT_PATH}.`);
                resolve();
            });
        });
    }

    private connect(): void {
        if (this.#isConnecting || this.#port?.isOpen) {
            console.log("SIM800L Service: Connection attempt skipped (already connecting or connected).");
            return;
        }

        console.log(`SIM800L Service: Attempting to connect to ${SERIAL_PORT_PATH} at ${BAUD_RATE} baud.`);
        this.#isConnecting = true;
        this.#ready = false; // Mark as not ready until 'AT' check passes
        this.#initialAtOk = false;

        // Clean up previous instances if any
        if (this.#port) {
            if (this.#port.isOpen) {
                this.#port.close();
            }
            this.#port = null;
            this.#parser = null;
        }
        this.#dataBuffer = '';

        // Create the SerialPort instance
        this.#port = new SerialPort({
            path: SERIAL_PORT_PATH,
            baudRate: BAUD_RATE,
            autoOpen: false,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            rtscts: false,
            xon: false,
            xoff: false,
        });

        this.#parser = this.#port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

        // --- Event Handlers ---
        this.#port.on('open', this.handlePortOpen.bind(this));
        this.#port.on('close', this.handlePortClose.bind(this));
        this.#port.on('error', this.handlePortError.bind(this));
        this.#parser.on('data', this.handleData.bind(this));

        // --- Attempt to Open ---
        this.#port.open((err) => {
            if (err) {
                console.error(`SIM800L Service: Failed to open port ${SERIAL_PORT_PATH}: ${err.message}`);
                this.#isConnecting = false;
                this.#port = null;
                this.#parser = null;
                if (!this.#isReconnecting) {
                    this.scheduleReconnect();
                }
            }
            // Success is handled by the 'open' event
        });
    }

    private handlePortOpen(): void {
        console.log(`SIM800L Service: Serial port ${SERIAL_PORT_PATH} opened successfully.`);
        this.#isConnecting = false;
        this.#isReconnecting = false;
        this.#ready = true; // Mark port as physically open
        this.#initialAtOk = false; // Still needs AT check
        this.#dataBuffer = '';

        // Send initial 'AT' command to check module responsiveness
        // Short timeout for basic check
        this.sendCommand('AT', 'OK', 2000)
            .then(() => {
                console.log("SIM800L Service: Initial AT check successful. Module is responsive.");
                this.#initialAtOk = true; // Mark as fully ready
                this.processCommandQueue(); // Start processing any queued commands (should be empty now)
                this.processMessageQueue(); // Start processing any queued messages
            })
            .catch(err => {
                console.error("SIM800L Service: Initial AT check failed:", err.message || err);
                // Close the port and retry connection if AT fails
                this.close().catch(() => {}); // Attempt graceful close
                // Reconnect scheduling is handled by the 'close' event or error handler if close fails
            });
    }

    private handlePortClose(): void {
        console.warn(`SIM800L Service: Serial port ${SERIAL_PORT_PATH} closed.`);
        this.#ready = false;
        this.#isConnecting = false;
        this.#initialAtOk = false;

        // Fail the current command if port closes unexpectedly
        if (this.#currentCommand) {
            clearTimeout(this.#currentCommand.timer);
            this.#currentCommand.reject(new Error('Port closed unexpectedly'));
            this.#currentCommand = null;
        }
        // Fail all queued commands
        this.#commandQueue.forEach(cmd => cmd.reject(new Error('Port closed')));
        this.#commandQueue = [];

        // Fail all queued messages
        this.#messageQueue.forEach(msg => msg.reject(new Error('Port closed during message queue processing')));
        this.#messageQueue = [];
        this.#isSendingMessage = false;


        // Attempt to reconnect if not intentionally closing or already reconnecting
        if (!this.#isReconnecting) {
            this.scheduleReconnect();
        }
    }

    private handlePortError(err: Error): void {
        console.error(`SIM800L Service: Serial port error: ${err.message}`);
        this.#ready = false; // Port errored, not ready
        this.#isConnecting = false;
        this.#initialAtOk = false;

        // Fail the current command
        if (this.#currentCommand) {
            clearTimeout(this.#currentCommand.timer);
            this.#currentCommand.reject(new Error(`Serial port error: ${err.message}`));
            this.#currentCommand = null;
        }

        // Close the port if it's open but errored
        if (this.#port && this.#port.isOpen) {
            this.#port.close(closeErr => {
                if(closeErr) console.error("SIM800L Service: Error closing port after error:", closeErr);
                 // 'close' handler will trigger reconnect scheduling
            });
        } else if (!this.#isReconnecting) {
             // If port wasn't open or close failed silently, ensure reconnect is scheduled
             this.scheduleReconnect();
        }
    }

     private handleData(line: string | Buffer): void {
        const textLine = (typeof line === 'string' ? line : line.toString('utf8')).trim();

        if (!textLine) return; // Ignore empty lines

        console.log(`SIM800L Service: RX <--- ${textLine}`);
        this.#dataBuffer += textLine + '\n'; // Append to buffer (optional use)

        // Handle Unsolicited Result Codes (URCs) if needed here
        // Example: if (textLine.startsWith('+CMTI:')) { /* handle new SMS indication */ }
        // Example: if (textLine.startsWith('RING')) { /* handle incoming call */ }

        // Process response for the current command
        if (this.#currentCommand) {
            this.handleResponse(textLine);
        } else {
            // Optional: Log or handle unexpected data when no command is active
             console.log(`SIM800L Service: Received unexpected data: "${textLine}"`);
        }
    }


    private scheduleReconnect(): void {
        if (this.#isReconnecting) return; // Don't schedule multiple reconnects

        this.#isReconnecting = true;
        console.log(`SIM800L Service: Scheduling reconnect in ${RECONNECT_DELAY_MS / 1000} seconds...`);
        // Clear queues on reconnect schedule to avoid processing stale commands/messages on reconnect
        this.clearQueuesOnErrorOrClose();
        setTimeout(() => {
            console.log("SIM800L Service: Attempting to reconnect...");
            this.#isReconnecting = false;
            this.connect(); // Initiate connection attempt
        }, RECONNECT_DELAY_MS);
    }

    private clearQueuesOnErrorOrClose(): void {
        if (this.#currentCommand) {
            clearTimeout(this.#currentCommand.timer);
            // Don't necessarily reject here, handlePortClose/Error already does
            this.#currentCommand = null;
        }
        this.#commandQueue = []; // Clear pending commands

        // We might not want to reject messages here, but rather hold them until next connection?
        // For simplicity now, clear them. Consider persistence if needed.
        // this.#messageQueue.forEach(msg => msg.reject(new Error('Connection lost, message cancelled')));
        this.#messageQueue = [];
        this.#isSendingMessage = false;
    }


    private handleResponse(line: string): void {
         if (!this.#currentCommand) {
             console.warn("SIM800L Service: handleResponse called with no current command.");
             return;
         }

        const { expectedResponse, resolve, reject, timer, command } = this.#currentCommand;

        // Special case: SMS prompt '>'
        if (expectedResponse === '>' && line === '>') {
            console.log(`SIM800L Service: Matched expected prompt ">" for command "${command.trim()}"`);
            clearTimeout(timer);
            resolve(line);
            this.#currentCommand = null;
            this.#dataBuffer = '';
            this.processCommandQueue();
            return;
        }

        // Check for general ERROR response
        if (line.includes('ERROR')) {
            console.error(`SIM800L Service: Command "${command.trim()}" failed with ERROR response: ${line}`);
            clearTimeout(timer);
            reject(new Error(`Command failed: ${line}`));
            this.#currentCommand = null;
            this.#dataBuffer = '';
            this.processCommandQueue();
            return;
        }

        // Check for other expected responses (string or RegExp)
        let match = false;
        if (expectedResponse instanceof RegExp) {
            match = expectedResponse.test(line);
        } else {
            match = line.includes(expectedResponse);
        }

        if (match) {
            console.log(`SIM800L Service: Matched expected response "${expectedResponse}" for command "${command.trim()}"`);
            clearTimeout(timer);
            resolve(line);
            this.#currentCommand = null;
            this.#dataBuffer = '';
            this.processCommandQueue();
            // No return needed here
        }
        // If no match yet, wait for more lines or timeout
    }

    // Sends a single AT command and waits for a response
    private sendCommand(command: string, expectedResponse: string | RegExp = 'OK', timeout: number = COMMAND_TIMEOUT_MS): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            // *** CHANGE 1: Check only if port is physically open for QUEUING ***
            if (!this.#port?.isOpen) {
                 return reject(new Error("Cannot send command: Port is not open."));
            }

            // Use \r\n as it's more standard for AT commands, but \r might work for some modules
            const formattedCommand = command + '\r\n';

            console.log(`SIM800L Service: Queuing command: "${command.trim()}" (expect: "${expectedResponse}", timeout: ${timeout}ms)`);

            const commandTask = {
                command: formattedCommand,
                expectedResponse,
                timeout,
                resolve,
                reject,
                timer: undefined as NodeJS.Timeout | undefined
            };

            this.#commandQueue.push(commandTask);
            this.processCommandQueue(); // Attempt to process queue immediately
        });
    }

    // Processes the next command from the AT command queue
    private processCommandQueue(): void {
        // *** CHANGE 2: Check only if port is physically open for SENDING ***
        // The public isReady() check (which includes #initialAtOk) is done
        // implicitly by the fact that this won't run until the initial 'AT' command
        // succeeds and resolves, setting #initialAtOk=true via handlePortOpen's promise chain.
        if (this.#currentCommand || this.#commandQueue.length === 0 || !this.#port?.isOpen) {
            // Optional logging for debugging:
            // if (this.#currentCommand) console.log("processCommandQueue: Waiting for current command.");
            // if (this.#commandQueue.length === 0) console.log("processCommandQueue: Queue empty.");
            // if (!this.#port?.isOpen) console.log("processCommandQueue: Port not open.");
            return;
        }

        this.#currentCommand = this.#commandQueue.shift()!;
        console.log(`SIM800L Service: Sending command: ${this.#currentCommand.command.trim()}`);
        this.#dataBuffer = ''; // Clear buffer before sending new command

        // Set timeout for the command
        this.#currentCommand.timer = setTimeout(() => {
            if (!this.#currentCommand) return; // Command might have already finished
            console.error(`SIM800L Service: Command "${this.#currentCommand.command.trim()}" timed out after ${this.#currentCommand.timeout}ms.`);
            const cmd = this.#currentCommand; // Store before nulling
            this.#currentCommand = null; // Clear current command on timeout
            cmd.reject(new Error('Command timeout')); // Reject the promise
            this.processCommandQueue(); // Try processing next command
        }, this.#currentCommand.timeout);

        // Write command to serial port
        this.#port!.write(this.#currentCommand.command, (err) => {
            if (err) {
                console.error(`SIM800L Service: Error writing to port: ${err.message}`);
                if (!this.#currentCommand) return; // Command might have already timed out/failed
                clearTimeout(this.#currentCommand.timer); // Clear timer
                const cmd = this.#currentCommand; // Store before nulling
                this.#currentCommand = null;            // Clear current command
                cmd.reject(err);       // Reject promise
                this.processCommandQueue();            // Try processing next command
            } else {
                // Check if command is still current after async write callback
                if (this.#currentCommand) {
                    console.log(`SIM800L Service: TX ---> ${this.#currentCommand.command.trim()}`);
                    // Waiting for response handled by handleData -> handleResponse
                } else {
                    console.log(`SIM800L Service: TX ---> unknown task (nulled) (completed or timed out before write ack)`);
                }
            }
        });
    }

    // --- Public Methods ---

    /**
     * Checks if the service is connected, initialized (initial AT OK), and ready to accept commands.
     * Use this before attempting operations like sendMessage.
     */
    public isReady(): boolean {
        // Ready = port exists, port is open, AND initial 'AT' command was successful
        return !!this.#port?.isOpen && this.#ready && this.#initialAtOk;
    }

    /**
     * Queues an SMS message to be sent. Resolves with true on success, rejects on failure.
     * Handles locking to ensure only one message sending operation occurs at a time.
     */
    public sendMessage(content: string, number: string): Promise<boolean> {
        console.log(`SIM800L Service: Request received to send SMS to ${number}`);
        return new Promise((resolve, reject) => {
            if (!number || !content) {
                return reject(new Error("SMS requires recipient number and content."));
            }
            // Check readiness *before* queuing to provide immediate feedback if not ready
            if (!this.isReady()) {
                return reject(new Error("Cannot queue SMS: Service not ready (port closed or initial AT check failed)."));
            }

            // Add the message request to the queue
            this.#messageQueue.push({ content, number, resolve, reject });

            // Trigger processing if not already sending a message
            this.processMessageQueue();
        });
    }

    // Processes the next message from the message queue
    private processMessageQueue(): void {
         // Conditions to process: Not already sending, queue has items, service is FULLY ready
        if (this.#isSendingMessage || this.#messageQueue.length === 0 || !this.isReady()) {
            // Optional logging:
            // if (this.#isSendingMessage) console.log("processMessageQueue: Waiting for current message to finish.");
            // if (this.#messageQueue.length === 0) console.log("processMessageQueue: Message queue empty.");
            // if (!this.isReady()) console.log("processMessageQueue: Service not ready for message sending.");
            return;
        }

        this.#isSendingMessage = true; // Acquire lock
        const messageTask = this.#messageQueue.shift()!; // Get the next message task

        console.log(`SIM800L Service: Starting to send SMS to ${messageTask.number}...`);

        // Use a helper async function to handle the multi-step SMS process
        this.executeSendMessage(messageTask.content, messageTask.number)
            .then(success => {
                messageTask.resolve(success); // Resolve the original promise
            })
            .catch(error => {
                messageTask.reject(error); // Reject the original promise
            })
            .finally(() => {
                console.log(`SIM800L Service: Finished sending attempt to ${messageTask.number}.`);
                this.#isSendingMessage = false; // Release lock
                this.processMessageQueue(); // Check if there are more messages to send
            });
    }

    // The actual async logic for sending an SMS (called by processMessageQueue)
    private async executeSendMessage(content: string, number: string): Promise<boolean> {
        try {
            console.log("SIM800L Service: Setting SMS text mode (AT+CMGF=1)...");
            await this.sendCommand('AT+CMGF=1', 'OK');
            await sleep(100); // Small delay after mode set

            console.log(`SIM800L Service: Sending recipient command (AT+CMGS="${number}")...`);
            // Increase timeout for CMGS as network registration might add delay
            await this.sendCommand(`AT+CMGS="${number}"`, '>', 15000);
            await sleep(100); // Small delay after getting prompt '>'

            console.log("SIM800L Service: Sending message content...");
            // Send content + Ctrl+Z (\x1A). Expect +CMGS confirmation or OK.
            // Use a longer timeout here as sending can take time depending on network.
            // Regex allows for variations like "+CMGS: 123" or just "OK"
            await this.sendCommand(`${content}\x1A`, /\+CMGS:|\bOK\b/, SMS_SEND_TIMEOUT_MS);

            console.log(`SIM800L Service: SMS successfully sent or acknowledged by module for ${number}.`);
            return true;

        } catch (error: any) {
            console.error(`SIM800L Service: Failed to send SMS to ${number}:`, error.message || error);
            // Rethrow a specific error to ensure the promise returned by executeSendMessage rejects clearly
            throw new Error(`Failed to send SMS: ${error.message || error}`);
        }
    }


    /**
     * Closes the serial port connection gracefully.
     */
    public async close(): Promise<void> {
        console.log("SIM800L Service: Close requested.");
        this.#isReconnecting = true; // Prevent automatic reconnections during manual close

        // Clear queues and reject pending operations
        this.clearQueuesAndFailPending();


        if (this.#port && this.#port.isOpen) {
            return new Promise((resolve, reject) => {
                this.#port!.close((err) => {
                    // State reset (#ready, #initialAtOk etc.) is handled by the 'close' event handler
                    if (err) {
                        console.error("SIM800L Service: Error closing port:", err);
                        // Even if close fails, try to reset state
                        this.#port = null;
                        this.#parser = null;
                        this.#ready = false;
                        this.#initialAtOk = false;
                        reject(err);
                    } else {
                        console.log("SIM800L Service: Port closed successfully via close().");
                        resolve();
                    }
                });
            });
        } else {
            console.log("SIM800L Service: Port already closed or not initialized.");
            // Ensure state is correct even if port wasn't open
            this.#ready = false;
            this.#port = null;
            this.#parser = null;
            this.#initialAtOk = false;
            return Promise.resolve();
        }
    }

    // Helper to fail pending operations when closing or encountering critical errors
    private clearQueuesAndFailPending(): void {
         if (this.#currentCommand) {
            clearTimeout(this.#currentCommand.timer);
            this.#currentCommand.reject(new Error("Service closing or critical error"));
            this.#currentCommand = null;
        }
        this.#commandQueue.forEach(cmd => cmd.reject(new Error('Service closing or critical error')));
        this.#commandQueue = [];

        // Reject pending messages
        const pendingMessages = [...this.#messageQueue]; // Copy before clearing
        this.#messageQueue = [];
        this.#isSendingMessage = false; // Ensure lock is released
        pendingMessages.forEach(msg => msg.reject(new Error('Service closing or critical error')));

    }
}

export default new SIM800LService();