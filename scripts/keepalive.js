const https = require('https');

// Replace with your Render app URL
const RENDER_URL = 'YOUR_RENDER_APP_URL.onrender.com';

function pingServer() {
    const options = {
        hostname: RENDER_URL,
        port: 443,
        path: '/ping',
        method: 'GET',
        headers: {
            'User-Agent': 'KeepAlive-Bot/1.0'
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] Ping successful: ${res.statusCode}`);
            try {
                const response = JSON.parse(data);
                if (response.pong) {
                    console.log(`[${timestamp}] Server responded with pong at ${response.timestamp}`);
                }
            } catch (e) {
                console.log(`[${timestamp}] Response: ${data}`);
            }
        });
    });

    req.on('error', (error) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] Ping failed:`, error.message);
    });

    req.on('timeout', () => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] Request timeout`);
        req.destroy();
    });

    req.setTimeout(30000); // 30 second timeout
    req.end();
}

// Initial ping
console.log('🔄 Starting keep-alive service...');
console.log(`📡 Target: https://${RENDER_URL}/ping`);
console.log('⏰ Interval: 60 seconds\n');

pingServer();

// Ping every 60 seconds
setInterval(pingServer, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Keep-alive service stopping...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Keep-alive service stopping...');
    process.exit(0);
});