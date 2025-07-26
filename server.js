// whatsapp-api-nodejs/server.js

// 1. Load environment variables from .env file
// Make sure your .env file is NOT uploaded to GitHub!
require('dotenv').config();

// 2. Import necessary libraries
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors'); // To allow requests from other frontends/backends

// 3. Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001; // Use port from .env or default 3001

// Enable middleware for JSON body parsing and CORS
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(cors()); // Allow all CORS (adjust in production with specific domains if needed)

// Get admin WhatsApp numbers from environment variables
// Ensure numbers are in '628xxxxxxxxx@c.us' format
const ADMIN_WHATSAPP_NUMBERS_RAW = process.env.ADMIN_WHATSAPP_NUMBERS;
const ADMIN_WHATSAPP_NUMBERS = ADMIN_WHATSAPP_NUMBERS_RAW
    ? ADMIN_WHATSAPP_NUMBERS_RAW.split(',').map(num => `${num.trim()}@c.us`)
    : [];

// Sender number (superadmin number)
const SENDER_WHATSAPP_NUMBER = process.env.SENDER_WHATSAPP_NUMBER;
if (!SENDER_WHATSAPP_NUMBER) {
    console.error('ERROR: SENDER_WHATSAPP_NUMBER not found in .env. Please set it.');
    process.exit(1); // Exit if sender number is not set
}

// 4. Initialize WhatsApp Client
// LocalAuth will save the login session in the .wwebjs_auth folder.
// This is important so you don't have to scan the QR code every time the application is redeployed.
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // These arguments are important for running Puppeteer (headless Chrome) in a server environment like GCP VM
        // Added more arguments for better compatibility
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Important for container/server environments
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Important for some environments
            '--disable-gpu',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-default-browser-check',
            '--no-first-run',
            '--no-pings',
            '--no-zygote',
            '--mute-audio',
            '--hide-scrollbars',
            '--disable-sync',
            '--disable-notifications',
            '--disable-infobars',
            '--disable-logging',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-features=VizDisplayCompositor',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-renderer-backgrounding',
            '--disable-site-isolation-trials',
            '--disable-speech-api',
            '--disable-web-security',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--metrics-recording-only',
            '--ignore-certificate-errors',
            '--allow-running-insecure-content',
            '--enable-automation',
            '--disable-blink-features=AutomationControlled'
        ],
        headless: true // Run browser without GUI (headless mode)
    }
});

// 5. Event Listener for QR Code
// This will be triggered when the client needs to be connected/re-authenticated.
// On GCP VM, you will need to view the logs to get this QR string.
client.on('qr', qr => {
    console.log('QR RECEIVED', qr); // Log QR string
    qrcode.generate(qr, { small: true }); // Display QR in terminal (if available)
    console.log('SCAN THIS QR CODE WITH WHATSAPP ON YOUR PHONE (superadmin number):');
    console.log('Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device, then scan this QR.');
});

// 6. Event Listener when client is ready
client.on('ready', () => {
    console.log('WhatsApp client is ready and connected!');
    console.log(`Sender number (superadmin): ${client.info.wid.user}`);
});

// 7. Event Listener when client is authenticated
client.on('authenticated', () => {
    console.log('WhatsApp client is authenticated!');
});

// 8. Event Listener for authentication failure
client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILED', msg);
    // You can add logic to send notifications or retry here
});

// 9. Event Listener when client is disconnected
client.on('disconnected', reason => {
    console.log('WhatsApp client disconnected:', reason);
    // Try to reinitialize the client after disconnection
    console.log('Attempting to reconnect WhatsApp Client...');
    client.initialize();
});

// 10. Initialize WhatsApp Client
client.initialize();

// 11. Express API Endpoint for sending WhatsApp notifications
// This is the endpoint that your PHP backend will call
app.post('/send-whatsapp-notification', async (req, res) => {
    // Ensure WhatsApp client is ready before sending messages
    if (!client.info) {
        console.warn('WhatsApp sending attempt failed: Client not ready.');
        return res.status(503).json({ success: false, message: 'WhatsApp client is not ready. Please try again later.' });
    }

    const { ticketId, subject, name, email, type, priority, description, createdAt, uploadedFiles, adminDashboardLink } = req.body;

    // Basic input validation
    if (!ticketId || !subject || !name || !email || !description || !adminDashboardLink) {
        console.error('Incomplete ticket data for WhatsApp notification:', req.body);
        return res.status(400).json({ success: false, message: 'Incomplete ticket data for WhatsApp notification.' });
    }

    // Build WhatsApp message
    let message = `*NEW SUPPORT TICKET RECEIVED*\n\n`;
    message += `*Ticket ID:* ${ticketId}\n`;
    message += `*Subject:* ${subject}\n`;
    message += `*Sender:* ${name} (${email})\n`;
    message += `*Ticket Type:* ${type}\n`;
    message += `*Priority:* ${priority}\n`;
    message += `*Created At:* ${createdAt}\n\n`;
    message += `*Description:*\n${description}\n\n`;

    // Add file links if any
    if (uploadedFiles && uploadedFiles.length > 0) {
        message += `*Attached Files:*\n`;
        uploadedFiles.forEach(file => {
            // Ensure the file URL is complete and publicly accessible
            message += `- ${file.name}: ${file.url}\n`;
        });
        message += `\n`;
    }

    message += `View ticket details in Admin Dashboard: ${adminDashboardLink}\n\n`;
    message += `Please follow up on this ticket immediately.`;

    let allMessagesSent = true;
    let failedNumbers = [];

    // Send message to each admin number
    for (const adminNumber of ADMIN_WHATSAPP_NUMBERS) {
        try {
            // Check if WhatsApp number is valid and registered
            const isValid = await client.isRegisteredUser(adminNumber);
            if (!isValid) {
                console.warn(`WhatsApp number ${adminNumber} is not registered or invalid. Skipping sending.`);
                failedNumbers.push(adminNumber);
                allMessagesSent = false;
                continue;
            }

            await client.sendMessage(adminNumber, message);
            console.log(`WhatsApp notification successfully sent to ${adminNumber} for ticket ${ticketId}`);
        } catch (error) {
            console.error(`Failed to send WhatsApp notification to ${adminNumber} for ticket ${ticketId}:`, error);
            failedNumbers.push(adminNumber);
            allMessagesSent = false;
        }
    }

    if (allMessagesSent) {
        res.status(200).json({ success: true, message: 'WhatsApp notification successfully sent to all admins.' });
    } else {
        res.status(500).json({ success: false, message: `Failed to send WhatsApp notification to some admins. Failed numbers: ${failedNumbers.join(', ')}` });
    }
});

// 12. Run the Express server
app.listen(PORT, () => {
    console.log(`Node.js server running on http://localhost:${PORT}`);
    console.log(`Endpoint for WhatsApp notifications: http://localhost:${PORT}/send-whatsapp-notification`);
    console.log('Ensure this port is open in your GCP firewall if accessed from outside.');
});
